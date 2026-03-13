import { OPENAI, TEMPLATE_PATHS } from '../utils/constants.js';
import { loadTemplate } from '../utils/templateLoader.js';
import ErrorHandler from '../utils/errorHandler.js';
import { normalizeTitlesJsonBatch, coerceToJsonArray, delay } from '../utils/helpers.js';

/**
 * OpenAI API client
 */
class OpenAIClient {
    constructor(apiKey) {
        ErrorHandler.validateApiKey(apiKey);
        this.apiKey = apiKey;
    }

    /**
     * Call OpenAI API with retry logic
     * @param {Object} params - API parameters
     * @returns {Promise<*>} Parsed response
     */
    async call(params) {
        const maxAttempts = params.maxAttempts || OPENAI.MAX_RETRY_ATTEMPTS;
        const setProgress = params.setProgress || null;
        const onDelta = params.onDelta || null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                if (attempt > 1 && setProgress) {
                    setProgress(`OpenAI : tentative ${attempt}/${maxAttempts}...`);
                }

                const requestBody = {
                    model: params.model || OPENAI.MODEL,
                    max_output_tokens: params.maxTokens || OPENAI.MAX_TOKENS,
                    input: params.input
                };

                // Only include reasoning for models that support it (gpt-5 family)
                if (params.reasoning) {
                    requestBody.reasoning = params.reasoning;
                }

                // JSON mode (Responses API) : force une sortie JSON parsable
                if (params.responseFormat) {
                    requestBody.text = { format: params.responseFormat };
                }

                let result;
                if (onDelta) {
                    result = await this.requestStream(requestBody, onDelta);
                } else {
                    const data = await this.request(requestBody);
                    result = this.extractResponse(data);
                }

                if (!result || !result.trim()) {
                    console.warn('OpenAI réponse vide');
                    if (attempt < maxAttempts) {
                        if (window.notifications) {
                            window.notifications.warning(
                                `OpenAI: tentative ${attempt} sans réponse, nouvel essai...`
                            );
                        }
                        await delay(OPENAI.DELAY_BETWEEN_BATCHES_MS * attempt);
                        continue;
                    }
                    throw new Error("OpenAI: réponse vide après " + maxAttempts + " tentatives");
                }

                return result;
            } catch (error) {
                console.error(`[OpenAI] Tentative ${attempt}/${maxAttempts} échouée:`, error.message);
                if (attempt === maxAttempts) {
                    throw error;
                }
                if (window.notifications) {
                    window.notifications.warning(
                        `OpenAI: erreur tentative ${attempt}, nouvel essai dans ${attempt}s...`
                    );
                }
                await delay(OPENAI.DELAY_BETWEEN_BATCHES_MS * attempt);
            }
        }
    }

    /**
     * Make HTTP request using fetch
     * @param {Object} body - Request body
     * @returns {Promise<Object>} Parsed JSON response
     */
    async request(body) {
        const response = await fetch(OPENAI.API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`OpenAI ${response.status}: ${text}`);
        }

        return await response.json();
    }

    /**
     * Make streaming HTTP request using SSE
     * @param {Object} body - Request body
     * @param {Function} onDelta - Called with accumulated text on each delta
     * @returns {Promise<string>} Full accumulated text
     */
    async requestStream(body, onDelta) {
        const response = await fetch(OPENAI.API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ...body, stream: true })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`OpenAI ${response.status}: ${text}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Handle both \r\n and \n line endings
            const normalized = buffer.replace(/\r\n/g, '\n');
            const parts = normalized.split('\n\n');
            buffer = parts.pop();

            for (const part of parts) {
                for (const line of part.split('\n')) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data:')) continue;

                    const eventData = trimmed.slice(5).trim();
                    if (!eventData || eventData === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(eventData);
                        if (parsed.type === 'response.output_text.delta' && parsed.delta) {
                            fullText += parsed.delta;
                            if (onDelta) onDelta(fullText);
                        }
                    } catch (e) {
                        // ignore non-JSON SSE lines
                    }
                }
            }
        }

        return fullText;
    }

    /**
     * Extract text response from OpenAI data structure
     * @param {Object} data - API response data
     * @returns {string} Extracted text
     */
    extractResponse(data) {
        const items = Array.isArray(data.output) ? data.output : [];
        const messageItem = items.find(
            it => it?.type === "message" && Array.isArray(it.content)
        );
        const textBlock = messageItem?.content?.find?.(
            c => c?.type === "output_text" && typeof c.text === "string"
        );
        return textBlock?.text ?? "";
    }

    /**
     * Generate titles from subtitles
     * @param {Array} subtitles - Subtitle data
     * @param {Function} setProgress - Progress callback
     * @returns {Promise<Array>} Generated titles
     */
    async generateTitles(subtitles, onDelta = null) {
        const systemPrompt = this.getTitlesSystemPrompt();

        const result = await this.call({
            input: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: JSON.stringify(subtitles) }
            ],
            model: OPENAI.MODEL_REASONING,
            reasoning: { effort: 'low' },
            maxTokens: 16000,
            onDelta
        });

        const normalized = normalizeTitlesJsonBatch(result);
        return JSON.parse(normalized);
    }

    /**
     * Generate titles in batches
     * @param {Array} subtitles - All subtitles
     * @param {Function} setProgress - Progress callback
     * @returns {Promise<Array>} Generated titles
     */
    async generateTitlesBatch(subtitles, setMessage = null, sequenceName = '', onStreamProgress = null, onBatchComplete = null, onBatchStart = null) {
        const chunks = [];
        for (let i = 0; i < subtitles.length; i += OPENAI.BATCH_SIZE) {
            chunks.push(subtitles.slice(i, i + OPENAI.BATCH_SIZE));
        }

        const allTitles = [];
        for (let i = 0; i < chunks.length; i++) {
            if (setMessage) {
                const label = sequenceName
                    ? `Génération des titres (lot ${i + 1}/${chunks.length}) | ${sequenceName}`
                    : `Génération des titres (lot ${i + 1}/${chunks.length})`;
                setMessage(label);
            }

            if (onBatchStart) {
                onBatchStart(chunks[i].length);
            }

            const onDelta = onStreamProgress
                ? (accText) => onStreamProgress(chunks[i].length, accText.length)
                : null;

            const batchResult = await this.generateTitles(chunks[i], onDelta);
            if (Array.isArray(batchResult)) {
                allTitles.push(...batchResult);
            }

            if (onBatchComplete) {
                onBatchComplete(chunks[i].length);
            }

            await delay(OPENAI.DELAY_BETWEEN_BATCHES_MS);
        }

        return allTitles;
    }

    /**
     * Analyze subtitles for B-roll placement
     * @param {Array} subtitlesBatch - Batch of subtitles
     * @returns {Promise<Array>} B-roll analysis
     */
    async analyzeBrolls(subtitlesBatch, onDelta = null) {
        const systemPrompt = this.getBrollsSystemPrompt();

        const result = await this.call({
            input: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: String(subtitlesBatch) }
            ],
            model: OPENAI.MODEL_REASONING,
            reasoning: { effort: 'low' },
            maxTokens: 16000,
            onDelta
        });

        // Parse and validate
        let parsed = null;
        try {
            const val = JSON.parse(result);
            if (Array.isArray(val)) {
                parsed = val;
            }
        } catch {
            const fixed = coerceToJsonArray(result);
            const val = JSON.parse(fixed);
            if (!Array.isArray(val)) {
                throw new Error("Format de sortie invalide");
            }
            parsed = val;
        }

        return parsed;
    }

    /**
     * Generate video context (target, intention, summary) from subtitles
     * @param {string} subtitlesText - Full subtitle text
     * @returns {Promise<Object>} Parsed context JSON {target, intention, summary}
     */
    async generateVideoContext(subtitlesText) {
        const systemPrompt = this.getContextSystemPrompt();

        const result = await this.call({
            input: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: subtitlesText }
            ],
            maxTokens: 500
        });

        // Parse et validation
        let parsed;
        try {
            parsed = JSON.parse(result);
        } catch (e) {
            parsed = this._extractJsonFromRaw(result);
        }

        // Validation structure minimale
        if (!parsed || !parsed.target || !parsed.intention || !parsed.summary) {
            throw new Error('Contexte video invalide : champs target, intention ou summary manquants');
        }

        // Validation sous-champs target
        const validGenders = ['women', 'men', 'people'];
        if (!parsed.target.gender || !validGenders.includes(parsed.target.gender)) {
            throw new Error('Contexte video invalide : target.gender doit etre women, men ou people (recu : ' + parsed.target.gender + ')');
        }
        if (!parsed.target.age || !parsed.target.motivations || !parsed.target.fears) {
            throw new Error('Contexte video invalide : target.age, target.motivations ou target.fears manquant');
        }

        return parsed;
    }

    /**
     * Get system prompt for video context generation
     * @returns {string} System prompt
     */
    getContextSystemPrompt() {
        const loaded = loadTemplate(TEMPLATE_PATHS.CONTEXT_SYSTEM);
        if (loaded) return loaded;
        // Fallback hardcode
        return `Tu es un analyste de contenu video. Tu recois les sous-titres d'une video et tu dois determiner le contexte semantique.

Retourne UNIQUEMENT un objet JSON avec cette structure exacte :
{
  "target": {
    "gender": "women",
    "age": "tranche d'age estimee",
    "motivations": "motivations principales de la cible",
    "fears": "peurs ou freins de la cible"
  },
  "intention": "objectif principal de la video en 1 phrase",
  "summary": "resume du contenu en 1 phrase"
}

REGLES :
- gender doit etre exactement "women", "men" ou "people"
- Toutes les valeurs en francais sauf gender
- Aucun commentaire, aucun markdown, uniquement le JSON
- Guillemets doubles uniquement`;
    }

    /**
     * Analyze transcription for Smart Cut segments via JSONL streaming
     * @param {Array} transcription - Transcription segments
     * @param {Object} intention - Intention object with promptTemplate
     * @param {Object} callbacks - {onSegment, onProgress, onError, onComplete, onAbort}
     * @param {AbortSignal} abortSignal - AbortController signal for user stop
     * @returns {Promise<void>}
     */
    async analyzeSmartCut(transcription, intention, callbacks = {}, abortSignal = null, overrides = {}) {
        const { onSegment, onProgress, onError, onComplete } = callbacks;

        const systemPrompt = overrides.systemPrompt || this.getSmartCutSystemPrompt();
        const intentionText = intention.assembledPrompt || (intention.templatePath ? loadTemplate(intention.templatePath) : null);
        const userData = overrides.userData || {
            intention: intentionText || 'Identifie les segments les plus pertinents.',
            transcription: transcription
        };

        const body = {
            model: OPENAI.MODEL,
            max_output_tokens: OPENAI.MAX_TOKENS,
            input: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: JSON.stringify(userData) }
            ],
            stream: true
        };

        const fetchOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + this.apiKey
            },
            body: JSON.stringify(body)
        };
        if (abortSignal) {
            fetchOptions.signal = abortSignal;
        }

        const response = await fetch(OPENAI.API_URL, fetchOptions);

        if (!response.ok) {
            const text = await response.text();
            throw new Error('OpenAI ' + response.status + ': ' + text);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';
        let jsonlBuffer = '';
        let segmentCount = 0;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                sseBuffer += decoder.decode(value, { stream: true });

                const normalized = sseBuffer.replace(/\r\n/g, '\n');
                const parts = normalized.split('\n\n');
                sseBuffer = parts.pop();

                for (const part of parts) {
                    for (const line of part.split('\n')) {
                        const trimmed = line.trim();
                        if (!trimmed.startsWith('data:')) continue;

                        const eventData = trimmed.slice(5).trim();
                        if (!eventData || eventData === '[DONE]') continue;

                        try {
                            const event = JSON.parse(eventData);
                            if (event.type === 'response.output_text.delta' && event.delta) {
                                jsonlBuffer += event.delta;

                                let newlineIdx;
                                while ((newlineIdx = jsonlBuffer.indexOf('\n')) !== -1) {
                                    const jsonLine = jsonlBuffer.substring(0, newlineIdx).trim();
                                    jsonlBuffer = jsonlBuffer.substring(newlineIdx + 1);

                                    if (jsonLine) {
                                        try {
                                            const segment = JSON.parse(jsonLine);
                                            if (segment && typeof segment.start === 'number' && typeof segment.end === 'number' && segment.title) {
                                                segmentCount++;
                                                if (onSegment) onSegment(segment);
                                                if (onProgress) onProgress(segmentCount, false);
                                            }
                                        } catch (e) {
                                            // Ligne JSON invalide — ignorer et continuer
                                        }
                                    }
                                }
                            }
                        } catch (e) {
                            // Ligne SSE invalide — ignorer
                        }
                    }
                }
            }
        } catch (streamError) {
            if (streamError.name === 'AbortError') throw streamError;
            if (onError) onError(streamError);
            throw streamError;
        } finally {
            reader.releaseLock();
        }

        // Traiter le buffer restant (dernier segment potentiel sans \n final)
        if (jsonlBuffer.trim()) {
            try {
                const segment = JSON.parse(jsonlBuffer.trim());
                if (segment && typeof segment.start === 'number' && typeof segment.end === 'number' && segment.title) {
                    segmentCount++;
                    if (onSegment) onSegment(segment);
                }
            } catch (e) {
                // Ignorer
            }
        }

        if (onComplete) onComplete(segmentCount);
    }

    /**
     * Select title words from subtitles at cursor position
     * @param {Array} subtitles - Array of {start, end, text} around cursor
     * @param {number} cursorPosition - Cursor position in seconds
     * @param {string} startBound - Mot de début (optionnel)
     * @param {string} endBound - Mot de fin (optionnel)
     * @returns {Promise<Array>} Array of {mots, start} objects (2-3 lines)
     */
    async selectTitleWords(subtitles, cursorPosition, startBound = '', endBound = '') {
        const systemPrompt = this.getAddTitleHereSystemPrompt();

        const userPayload = {
            cursor_position: cursorPosition,
            subtitles: subtitles
        };
        if (startBound) userPayload.start_word = startBound;
        if (endBound) userPayload.end_word = endBound;

        const result = await this.call({
            input: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: JSON.stringify(userPayload) }
            ],
            model: OPENAI.MODEL_REASONING,
            reasoning: { effort: 'low' }
        });

        const normalized = normalizeTitlesJsonBatch(result);
        const parsed = JSON.parse(normalized);

        if (!Array.isArray(parsed) || parsed.length === 0 || !Array.isArray(parsed[0]) || parsed[0].length < 2) {
            throw new Error('Format de réponse OpenAI invalide pour le titre ponctuel');
        }

        const titleLines = parsed[0];
        for (let i = 0; i < titleLines.length; i++) {
            const line = titleLines[i];
            if (!line || typeof line.mots !== 'string' || !line.mots.trim() || typeof line.start !== 'number' || isNaN(line.start)) {
                throw new Error('Ligne de titre invalide : chaque ligne doit contenir "mots" (string) et "start" (number)');
            }
        }

        return titleLines;
    }

    /**
     * Get system prompt for "Add Title Here" word selection
     * @returns {string} System prompt
     */
    getAddTitleHereSystemPrompt() {
        const loaded = loadTemplate(TEMPLATE_PATHS.ADD_TITLE_HERE);
        if (loaded) return loaded;
        return `Tu es un assistant de montage video. Tu recois des sous-titres autour de la position du curseur et tu dois selectionner les mots les plus impactants pour creer UN titre anime.

ENTREE :
Un objet JSON avec :
- "cursor_position" : la position exacte du curseur en secondes (float). C'est l'endroit precis ou l'utilisateur veut placer le titre.
- "subtitles" : un tableau de sous-titres [{"start": float, "end": float, "text": "string"}]
Ces sous-titres representent une fenetre de ~4 secondes autour du curseur.

REGLE D'INTENTION DU CURSEUR (PRIORITAIRE) :
- La position du curseur indique OU l'utilisateur veut que le titre apparaisse
- Tu DOIS selectionner des mots qui se trouvent AUTOUR de cette position temporelle
- Identifie quel sous-titre contient le curseur (cursor_position entre start et end)
- Selectionne les mots de CE sous-titre en priorite, puis etends aux sous-titres adjacents si necessaire
- Le titre doit etre centre sur l'intention de l'utilisateur, pas sur les extremites de la fenetre

SORTIE :
Un tableau JSON contenant UN SEUL sous-tableau (un seul titre) avec 2 ou 3 objets (lignes) :
[[{"mots": "groupe 1", "start": timestamp1}, {"mots": "groupe 2", "start": timestamp2}]]

=======================================
REGLE CRITIQUE — COPIE VERBATIM
=======================================
Les mots selectionnes DOIVENT etre copies EXACTEMENT depuis la transcription source, caractere par caractere.
- AUCUNE modification (pas de conjugaison, pas de synonyme, pas de reformulation)
- AUCUN ajout de mot qui n'existe pas dans la transcription
- AUCUNE omission de mot entre le premier et le dernier mot selectionnes
- Si tu selectionnes du mot N au mot N+5, TOUS les mots entre N et N+5 doivent etre presents

=======================================
REGLE DE CONTIGUITE ABSOLUE
=======================================
- Les mots selectionnes DOIVENT etre contigus dans la transcription originale, sans aucun trou
- Si le texte est "je vais sur la mer demain", tu peux selectionner "sur la mer" mais PAS "sur mer" (il manque "la")
- Entre deux lignes du titre, les mots doivent se suivre exactement : la ligne 2 reprend la ou la ligne 1 s'arrete
- La ligne 3 (si elle existe) reprend exactement apres le dernier mot de la ligne 2
- Aucun mot ne peut etre saute entre les lignes

EXEMPLE CORRECT :
Transcription : "je vais vous montrer la methode pour gagner"
Ligne 1 : "je vais vous"  ->  Ligne 2 : "montrer la methode"
(les mots se suivent parfaitement, aucun trou)

EXEMPLE INTERDIT :
Transcription : "je vais vous montrer la methode pour gagner"
Ligne 1 : "je vais"  ->  Ligne 2 : "la methode"
(il manque "vous montrer" entre les deux lignes)

=======================================
REGLE DES 20 CARACTERES PAR LIGNE (STRICTE)
=======================================
Chaque groupe de mots (chaque ligne du titre) doit faire MAXIMUM 20 caracteres (espaces inclus).
COMPTE les caracteres de chaque groupe AVANT de l'inclure. Si un groupe depasse 20 caracteres, decoupe-le en une ligne supplementaire.
- 1 a 4 mots par ligne
- Si tu ne peux pas respecter 20 caracteres avec 2 lignes, passe a 3 lignes

REGLES DE SELECTION :
- Selectionne les mots les plus percutants qui forment une phrase coherente
- Prefere 2 lignes, 3 lignes si le contenu le justifie (jamais 1 seule ligne)
- Privilegier : chiffres, methodes, resultats concrets, actions fortes, mots puissants
- Le "start" de chaque ligne = timestamp du premier mot de cette ligne dans la transcription

=======================================
CHECKLIST AVANT ENVOI (verifie le titre)
=======================================
Pour le titre genere, verifie :
- Chaque ligne fait <= 20 caracteres (espaces inclus) ?
- La ligne 2 reprend EXACTEMENT apres le dernier mot de la ligne 1 ?
- La ligne 3 (si elle existe) reprend EXACTEMENT apres le dernier mot de la ligne 2 ?
- Aucun mot n'est manquant entre les lignes ?
- Tous les mots sont copies VERBATIM depuis la transcription (pas de modification) ?
Si une seule reponse est NON, corrige le titre avant de l'inclure.

REGLES DE FORMAT :
- Retourne UNIQUEMENT le tableau JSON, aucun commentaire ni explication
- Utilise UNIQUEMENT des guillemets doubles
- UN SEUL titre (un seul sous-tableau dans le tableau externe)
- Les timestamps doivent correspondre exactement aux timestamps des sous-titres fournis`;
    }

    /**
     * Get system prompt for titles generation
     * @returns {string} System prompt
     */
    getTitlesSystemPrompt() {
        const loaded = loadTemplate(TEMPLATE_PATHS.TITLES_SYSTEM);
        if (loaded) return loaded;
        // Fallback : prompt hardcode en dernier recours
        return `Tu es un expert en création de titres impactants pour vidéos courtes.

Ton objectif : sélectionner des groupes de mots contigus pour composer des titres en 1 à 3 lignes MAX.

═══════════════════════════════════════════
RÈGLE CRITIQUE — COPIE VERBATIM
═══════════════════════════════════════════
Les mots que tu sélectionnes DOIVENT être copiés EXACTEMENT depuis la transcription source, caractère par caractère.
- AUCUNE modification (pas de conjugaison, pas de synonyme, pas de reformulation)
- AUCUN ajout de mot qui n'existe pas dans la transcription
- AUCUNE omission de mot entre le premier et le dernier mot sélectionnés
- Si tu sélectionnes du mot N au mot N+5, TOUS les mots entre N et N+5 doivent être présents

═══════════════════════════════════════════
RÈGLE DE CONTIGUÏTÉ ABSOLUE
═══════════════════════════════════════════
Si un titre fait plusieurs lignes :
- La ligne 2 DOIT reprendre EXACTEMENT au mot suivant après le dernier mot de la ligne 1
- La ligne 3 DOIT reprendre EXACTEMENT au mot suivant après le dernier mot de la ligne 2
- AUCUN mot ne peut être sauté entre les lignes
- La concaténation de toutes les lignes doit former un extrait EXACT et CONTINU de la transcription

EXEMPLE CORRECT :
Transcription : "je vais vous montrer la méthode pour gagner"
✅ Ligne 1 : "je vais vous"  →  Ligne 2 : "montrer la méthode"
(les mots se suivent parfaitement, aucun trou)

EXEMPLE INTERDIT :
Transcription : "je vais vous montrer la méthode pour gagner"
❌ Ligne 1 : "je vais"  →  Ligne 2 : "la méthode"
(il manque "vous montrer" entre les deux lignes)

❌ Ligne 1 : "vous montrer"  →  Ligne 2 : "pour gagner"
(il manque "la méthode" entre les deux lignes)

═══════════════════════════════════════════
RÈGLE DES 20 CARACTÈRES PAR LIGNE (STRICTE)
═══════════════════════════════════════════
Chaque groupe de mots (chaque ligne du titre) doit faire MAXIMUM 20 caractères (espaces inclus).
COMPTE les caractères de chaque groupe AVANT de l'inclure. Si un groupe dépasse 20 caractères, découpe-le en une ligne supplémentaire.
- 1 à 4 mots par ligne
- Si tu ne peux pas respecter 20 caractères avec 2 lignes, passe à 3 lignes

Critères de sélection (priorité) :
- Chiffre
- Méthode
- Résultat concret
- Action forte
- Bénéfice clair
- Mots puissants (ex : "incroyable", "révolutionnaire", "incontournable", "essentiel", "ultime"...)
- Verbes d'action (ex : "découvre", "transforme", "booste", "révèle"...)
- Questions percutantes (ex : "Tu veux…?", "Comment…?", "Pourquoi…?"...)
- Adjectifs marquants (ex : "rapide", "facile", "efficace", "imparable"...)

Tu es assez libre niveau critère de sélection, donc mets le plus de titre possible si c'est pertinent.

Pour chaque ligne (groupe) sélectionnée, tu vas retourner :
- Le groupe de mots (max 20 caractères)
- Le timestamp de départ (start) du PREMIER mot du groupe

IMPORTANT (qualité) :
- Les groupes doivent être courts mais doivent préserver le sens.
- Tu privilégies l'impact, mais JAMAIS au prix d'une phrase incorrecte ou incomplète.
- Sélectionne dans l'ordre (titre à 0s avant titre à 10s dans la liste)

═══════════════════════════════════════════
CHECKLIST AVANT ENVOI (vérifie CHAQUE titre)
═══════════════════════════════════════════
Pour chaque titre généré, vérifie :
☐ Chaque ligne fait ≤ 20 caractères (espaces inclus) ?
☐ La ligne 2 reprend EXACTEMENT après le dernier mot de la ligne 1 ?
☐ La ligne 3 (si elle existe) reprend EXACTEMENT après le dernier mot de la ligne 2 ?
☐ Aucun mot n'est manquant entre les lignes ?
☐ Tous les mots sont copiés VERBATIM depuis la transcription (pas de modification) ?
Si une seule réponse est NON, corrige le titre avant de l'inclure.

Retourne UNIQUEMENT un tableau JSON avec cette structure :
[
  [
    {"mots": "groupe 1", "start": timestamp1},
    {"mots": "groupe 2", "start": timestamp2}
  ],
  [
    {"mots": "groupe 3", "start": timestamp3},
    {"mots": "groupe 4", "start": timestamp4}
  ]
]

Chaque sous-tableau représente un TITRE complet (1 à 3 lignes), et chaque objet est une ligne dans l'ordre.
N'ajoute aucun commentaire, aucune explication.
Utilise UNIQUEMENT des guillemets doubles.
70% de la transcription seront des titres
70% des titres seront en 2 lignes`;
    }

    /**
     * Get system prompt for B-rolls analysis
     * @returns {string} System prompt
     */
    getBrollsSystemPrompt() {
        const loaded = loadTemplate(TEMPLATE_PATHS.BROLLS_SYSTEM);
        if (loaded) return loaded;
        // Fallback : prompt hardcode en dernier recours
        return `Tu es un sélecteur de B-roll pour vidéos courtes.

Paramètres

TARGET_AUDIENCE = women | men | people

GOAL_PERCENT = 0.30

Entrée
Une liste complète de sous-titres : [[index, phrase], [index, phrase], …]

But
Marquer environ GOAL_PERCENT des lignes en B-roll, réparties régulièrement, en respectant la cible (TARGET_AUDIENCE). Ne jamais mettre deux B-roll consécutifs. S'il y a trop peu de lignes éligibles, reste en dessous de 30% (n'invente pas).

Comment décider
Un B-roll est pertinent si la phrase contient ≥1 dimension tangible :

Actions visibles
parler, écrire, marcher, applaudir, regarder, offrir, recevoir, réagir, appeler, prendre des notes, présenter.

Émotions visibles
concentration, doute, stress, joie, soulagement, surprise, frustration, fatigue.

Environnements identifiables
bureau, call/visioconférence, formation/classe, sport/gym, commerce, hôpital, maison, voiture, école, nature.

Rôles incarnables
coach, client, étudiant, enfant, entrepreneur, salarié, athlète, médecin, couple, parent.

Objets / symboles simples
temps → clock, calendar animation, hourglass
données → grow graph, down graph, spreadsheet, smartphone notification
métaphores simples → step by step, light bulb
libre -> free man

⚠️ Si la phrase est abstraite, purement générique, méta (« on va voir », « c'est important », « mindset » sans image), réponds false.
⚠️ Ne force jamais un visuel conceptuel :
« simplifier la prise de décision » → TARGET_AUDIENCE + thinking (ex : woman thinking)
« dans deux semaines » → calendar animation (et non « uncertainty loop »)

Ciblage genre

Ne te contente pas des exemples que tu vois ici, soit créatif et adapte-toi à TARGET_AUDIENCE.

Préfixe les visuels humains par TARGET_AUDIENCE :
women → woman … | men → man … | people → people …

Si la phrase mentionne explicitement un genre (ex : « cliente », « elle »), aligne le visuel sur ce genre, sinon utilise TARGET_AUDIENCE.

Les objets/temps (clock, calendar animation, money euro, etc.) restent neutres.

Répartition 30% (à appliquer mentalement)

Calcule N = nombre de lignes, B = round(N * GOAL_PERCENT).

Donne un score interne aux lignes éligibles (plus de points si action + émotion + environnement/objet).

Sélectionne au plus B lignes en visant une distance régulière ≈ N/B entre B-roll.

Interdiction de B-rolls consécutifs : si deux lignes adjacentes sont éligibles, garde la mieux scorée et mets false à l'autre.

Règles d'output

Réponds uniquement au format : [[index, phrase, "réponse"], [index, phrase, "réponse"], …]

La réponse est soit "false", soit un libellé simple à inventer en fonction du texte.

N'ajoute aucun commentaire.

Ne change pas l'ordre.

N'utilise jamais de guillemets simples.

Ne réexplique rien.

CONTRAINTES DE FORMAT JSON
- Utilise UNIQUEMENT des guillemets doubles pour toutes les chaînes.
- Le 2e (phrase) ET le 3e (réponse) éléments DOIVENT être des chaînes JSON.
- Si la décision est négative, écris exactement "false" (chaîne), pas le booléen false.
- Ne renvoie rien d'autre que le tableau JSON.`;
    }

    /**
     * Get system prompt for Smart Cut analysis (mono-sequence)
     * @returns {string} System prompt
     */
    getSmartCutSystemPrompt() {
        const loaded = loadTemplate(TEMPLATE_PATHS.SMART_CUT_SYSTEM);
        if (loaded) return loaded;
        // Fallback : prompt hardcode en dernier recours
        return `Tu es un assistant de montage video professionnel. Tu analyses une transcription et identifies des segments selon l'intention donnee.

REGLES DE FORMAT (STRICTES) :
- Retourne UN objet JSON par segment, UN par ligne (format JSONL)
- PAS de wrapper array, PAS de texte avant/apres, PAS de markdown
- Format : {"index":N,"title":"string","description":"string","start":number,"end":number,"transcription":"string"}
- start et end en secondes (float, precision 1 decimale)
- index commence a 1, incrementiel
- title : titre accrocheur, max 8 mots, en francais
- description : resume en 1 phrase, en francais
- transcription : texte complet du segment (copie exacte de la transcription source)

REGLES DE SEGMENTATION :
- Segments de 15 a 90 secondes (format shorts)
- Chaque segment doit etre autonome et comprehensible seul
- Ne pas couper au milieu d'une phrase
- Aligner start/end sur les timecodes des segments de transcription fournis
- Ne pas inclure de longs silences ou transitions creuses
- Privilegier les segments avec un debut accrocheur (hook dans les 3 premieres secondes)`;
    }

    /**
     * Valide la structure minimale d'un JSON Lottie
     * @param {Object} json - Objet parsé à valider
     * @returns {{valid: boolean, errors: string[]}}
     */
    _validateLottieJson(json) {
        const errors = [];
        if (!json || typeof json !== 'object') {
            return { valid: false, errors: ['Pas un objet JSON'] };
        }
        const requiredRoot = ['v', 'fr', 'ip', 'op', 'w', 'h', 'layers'];
        for (const key of requiredRoot) {
            if (!(key in json)) errors.push(`Champ racine manquant : "${key}"`);
        }
        if (json.fr !== 30) errors.push('fr doit être 30, reçu : ' + json.fr);
        if (json.ip !== 0) errors.push('ip doit être 0, reçu : ' + json.ip);
        if (json.op !== 90) errors.push('op doit être 90, reçu : ' + json.op);
        if (json.w !== 1000) errors.push('w doit être 1000, reçu : ' + json.w);
        if (json.h !== 1000) errors.push('h doit être 1000, reçu : ' + json.h);
        if (!Array.isArray(json.layers)) {
            errors.push('layers doit être un array');
        } else if (json.layers.length < 2) {
            errors.push('Minimum 2 layers requis, reçu : ' + json.layers.length);
        } else {
            for (let i = 0; i < json.layers.length; i++) {
                const l = json.layers[i];
                if (!l || typeof l !== 'object') {
                    errors.push(`Layer ${i} : pas un objet`);
                    continue;
                }
                if (l.ty !== 4) errors.push(`Layer ${i} (${l.nm || '?'}) : ty doit être 4, reçu ${l.ty}`);
                if (!l.ks) errors.push(`Layer ${i} (${l.nm || '?'}) : ks (transform) manquant`);
                if (!Array.isArray(l.shapes) || l.shapes.length === 0) {
                    errors.push(`Layer ${i} (${l.nm || '?'}) : shapes manquant ou vide`);
                }
            }
        }
        return { valid: errors.length === 0, errors };
    }

    /**
     * Extrait un objet JSON depuis du texte brut (strip markdown, trailing comma fix)
     * @param {string} raw - Texte brut contenant du JSON
     * @returns {Object} Objet parsé
     * @throws {Error} Si aucun JSON valide trouvé
     */
    _extractJsonFromRaw(raw) {
        // Tentative directe
        try {
            return JSON.parse(raw);
        } catch (e) { /* continue */ }

        // Strip markdown code blocks
        let cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();

        // Extraire le premier objet JSON { ... }
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('Pas de JSON valide trouvé dans la réponse');
        }

        cleaned = jsonMatch[0];

        // Fix trailing commas : ,] → ] et ,} → }
        cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

        return JSON.parse(cleaned);
    }

    /**
     * Generate a Lottie animation JSON from a subtitle text
     * Pipeline: Prompt 1 (Creative Director) → Prompt 2 (Lottie Generator)
     * Retry jusqu'à 3x si le JSON Lottie est invalide
     * @param {string} subtitleText - Subtitle text to animate
     * @param {Object} callbacks - { onScenarioProgress, onLottieProgress, onStepChange }
     * @returns {Promise<Object>} Parsed Lottie JSON
     */
    async generateLottieAnimation(subtitleText, callbacks = {}) {
        const { onScenarioProgress, onLottieProgress, onStepChange } = callbacks;
        const MAX_LOTTIE_ATTEMPTS = 3;

        // ── Appel 1 — Creative Director : sous-titre → scénario créatif JSON ──
        const creativePrompt = loadTemplate(TEMPLATE_PATHS.LOTTIE_CREATIVE_DIRECTOR);
        if (!creativePrompt) {
            throw new Error('Template Creative Director introuvable : ' + TEMPLATE_PATHS.LOTTIE_CREATIVE_DIRECTOR);
        }

        if (onStepChange) onStepChange('scenario');

        const onDelta1 = onScenarioProgress
            ? (acc) => onScenarioProgress(acc.length)
            : null;

        const scenarioRaw = await this.call({
            input: [
                { role: 'system', content: creativePrompt },
                { role: 'user', content: subtitleText }
            ],
            onDelta: onDelta1,
            maxTokens: 4000
        });

        // Valider le scénario JSON
        let scenario;
        try {
            scenario = this._extractJsonFromRaw(scenarioRaw);
        } catch (e) {
            throw new Error('Scénario créatif invalide : ' + e.message);
        }

        // ── Appel 2 — Lottie Generator : scénario → JSON Lottie (avec retry) ──
        const lottiePrompt = loadTemplate(TEMPLATE_PATHS.LOTTIE_STYLE_IMPACT);
        if (!lottiePrompt) {
            throw new Error('Template Lottie Generator introuvable : ' + TEMPLATE_PATHS.LOTTIE_STYLE_IMPACT);
        }

        let lastError = null;
        let lastRawResponse = null;

        for (let attempt = 1; attempt <= MAX_LOTTIE_ATTEMPTS; attempt++) {
            if (onStepChange) onStepChange('lottie', attempt, MAX_LOTTIE_ATTEMPTS);

            // Construire les messages (ajouter le feedback d'erreur + réponse précédente en cas de retry)
            const messages = [
                { role: 'system', content: lottiePrompt },
                { role: 'user', content: JSON.stringify(scenario) }
            ];

            if (attempt > 1 && lastError) {
                // Inclure la réponse précédente pour que le modèle corrige au lieu de regénérer
                const prevResponse = lastRawResponse
                    ? '\n\nTA REPONSE PRECEDENTE (à corriger) :\n' + lastRawResponse.slice(0, 12000)
                    : '';
                messages.push({
                    role: 'user',
                    content: 'ERREUR PRECEDENTE — ta réponse contenait ces erreurs :\n' + lastError + prevResponse + '\n\nCorrige UNIQUEMENT les erreurs et renvoie le JSON Lottie complet et VALIDE.'
                });
            }

            const onDelta2 = onLottieProgress
                ? (acc) => onLottieProgress(acc.length, attempt)
                : null;

            try {
                const lottieRaw = await this.call({
                    input: messages,
                    model: OPENAI.MODEL_GENERATION,
                    onDelta: onDelta2,
                    maxTokens: 16384,
                    responseFormat: { type: 'json_object' }
                });

                // Stocker la réponse brute pour le retry contextuel
                lastRawResponse = lottieRaw;

                // Parser le JSON Lottie
                let lottieJson;
                try {
                    lottieJson = this._extractJsonFromRaw(lottieRaw);
                } catch (e) {
                    lastError = 'JSON non parsable : ' + e.message;
                    if (attempt < MAX_LOTTIE_ATTEMPTS) {
                        if (window.notifications) {
                            window.notifications.warning(
                                `JSON Lottie invalide (tentative ${attempt}/${MAX_LOTTIE_ATTEMPTS}), nouvel essai...`
                            );
                        }
                        await delay(OPENAI.DELAY_BETWEEN_BATCHES_MS);
                        continue;
                    }
                    throw new Error('JSON Lottie non parsable après ' + MAX_LOTTIE_ATTEMPTS + ' tentatives : ' + e.message);
                }

                // Valider la structure Lottie
                const validation = this._validateLottieJson(lottieJson);
                if (!validation.valid) {
                    lastError = validation.errors.join('\n');
                    if (attempt < MAX_LOTTIE_ATTEMPTS) {
                        if (window.notifications) {
                            window.notifications.warning(
                                `Structure Lottie invalide (tentative ${attempt}/${MAX_LOTTIE_ATTEMPTS}), nouvel essai...`
                            );
                        }
                        await delay(OPENAI.DELAY_BETWEEN_BATCHES_MS);
                        continue;
                    }
                    throw new Error('Structure Lottie invalide après ' + MAX_LOTTIE_ATTEMPTS + ' tentatives :\n' + lastError);
                }

                // Succès
                return lottieJson;

            } catch (callError) {
                // Erreur réseau ou API — ne pas retry pour ça
                if (callError.message.includes('après ' + MAX_LOTTIE_ATTEMPTS + ' tentatives')) {
                    throw callError;
                }
                lastError = callError.message;
                if (attempt === MAX_LOTTIE_ATTEMPTS) {
                    throw callError;
                }
                if (window.notifications) {
                    window.notifications.warning(
                        `Erreur génération Lottie (tentative ${attempt}/${MAX_LOTTIE_ATTEMPTS}), nouvel essai...`
                    );
                }
                await delay(OPENAI.DELAY_BETWEEN_BATCHES_MS);
            }
        }
    }

    /**
     * Analyze subtitles for motion design placement
     * @param {Array} subtitlesBatch - Batch of subtitles as [[index, phrase], ...]
     * @param {Function} onDelta - Streaming progress callback
     * @returns {Promise<Array>} Analysis results [[index, phrase, "true"|"false"], ...]
     */
    async analyzeMotionDesign(subtitlesBatch, onDelta = null) {
        const systemPrompt = this.getMotionDesignSystemPrompt();

        const result = await this.call({
            input: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: String(subtitlesBatch) }
            ],
            model: OPENAI.MODEL_NANO,
            onDelta
        });

        let parsed = null;
        try {
            const val = JSON.parse(result);
            if (Array.isArray(val)) {
                parsed = val;
            }
        } catch {
            const fixed = coerceToJsonArray(result);
            const val = JSON.parse(fixed);
            if (!Array.isArray(val)) {
                throw new Error("Format de sortie invalide");
            }
            parsed = val;
        }

        return parsed;
    }

    /**
     * Get system prompt for motion design detection
     * @returns {string} System prompt
     */
    getMotionDesignSystemPrompt() {
        const loaded = loadTemplate(TEMPLATE_PATHS.MOTION_DESIGN_SYSTEM);
        if (loaded) return loaded;
        return `Tu es un sélecteur de moments clés pour des overlays motion design dans des vidéos courtes.
GOAL_PERCENT = 0.15
Entrée : [[index, phrase], ...]
Marquer environ 15% des lignes pour y placer un overlay motion design animé.
Critères : mots concrets et animables, moments d'impact émotionnel, chiffres et données, transitions.
Interdiction de motion designs consécutifs.
Réponds uniquement au format : [[index, phrase, "true"|"false"], ...]
Utilise UNIQUEMENT des guillemets doubles. Ne renvoie rien d'autre que le tableau JSON.`;
    }

    getSmartCutMultiSystemPrompt() {
        const loaded = loadTemplate(TEMPLATE_PATHS.SMART_CUT_MULTI_SYSTEM);
        if (loaded) return loaded;
        // Fallback : prompt hardcode en dernier recours
        return `Tu es un assistant de montage video professionnel. Tu analyses les transcriptions de PLUSIEURS sequences et identifies des segments selon l'intention donnee.

REGLES DE FORMAT (STRICTES) :
- Retourne UN objet JSON par segment, UN par ligne (format JSONL)
- PAS de wrapper array, PAS de texte avant/apres, PAS de markdown
- Format : {"index":N,"title":"string","sourceSequence":"string","description":"string","start":number,"end":number,"transcription":"string"}
- sourceSequence : nom EXACT de la sequence source (tel que fourni dans les donnees)
- start et end en secondes (float, precision 1 decimale) — timecodes relatifs a la sequence source
- index commence a 1, incrementiel
- title : titre accrocheur, max 8 mots, en francais
- description : resume en 1 phrase, en francais
- transcription : texte complet du segment (copie exacte de la transcription source)

REGLES DE SEGMENTATION :
- Segments de 15 a 90 secondes (format shorts)
- Chaque segment doit etre autonome et comprehensible seul
- Ne pas couper au milieu d'une phrase
- Aligner start/end sur les timecodes des segments de transcription fournis
- Ne pas inclure de longs silences ou transitions creuses
- Privilegier les segments avec un debut accrocheur (hook dans les 3 premieres secondes)
- Les segments peuvent provenir de n'importe quelle sequence — choisir les meilleurs moments toutes sequences confondues`;
    }
}

export default OpenAIClient;
