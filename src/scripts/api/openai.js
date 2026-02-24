import { OPENAI } from '../utils/constants.js';
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
                    reasoning: params.reasoning || { effort: OPENAI.REASONING_EFFORT },
                    input: params.input
                };

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
    async analyzeBrolls(subtitlesBatch) {
        const systemPrompt = this.getBrollsSystemPrompt();

        const result = await this.call({
            input: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: String(subtitlesBatch) }
            ]
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
     * Get system prompt for titles generation
     * @returns {string} System prompt
     */
    getTitlesSystemPrompt() {
        return `Tu es un expert en création de titres impactants pour vidéos courtes.

Ton objectif : sélectionner des groupes de mots (1 à 4 mots) pour composer des titres en 1 à 3 lignes MAX.

RÈGLE ABSOLUE (anti-mots manquants) :
- Si un titre fait plusieurs lignes, la ligne 2 DOIT être la suite directe de la ligne précédente pour former UNE PHRASE COMPLÈTE (max 3 lignes mais priorise que 2 lignes).
- Entre {"ligne 1"} et {"ligne 2"}, il ne doit pas manquer de mot indispensable : la jonction doit être naturelle et correcte.
- Si un petit mot de liaison est nécessaire pour relier deux groupes, tu DOIS l'inclure dans l'un des groupes, même si ce mot est peu "impactant".
- Interdiction de faire des "sauts" : les lignes suivantes doivent reprendre exactement là où la précédente s'arrête, sans trou grammatical.
- Si tu ne peux pas faire une phrase complète et correcte sans dépasser 4 mots par groupe, alors tu dois créer 3 lignes au lieu de 2 (toujours 1 à 4 mots par ligne).

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
}

export default OpenAIClient;
