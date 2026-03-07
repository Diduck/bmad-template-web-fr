import { OPENAI, TEMPLATE_PATHS } from '../utils/constants.js';
import { loadTemplate } from '../utils/templateLoader.js';
import { normalizeTitlesJsonBatch, coerceToJsonArray, delay, extractJsonFromRaw } from '../utils/helpers.js';

/**
 * Erreur d'authentification Claude CLI spécifique.
 * Permet de détecter et gérer les problèmes d'auth différemment des autres erreurs.
 */
class ClaudeAuthError extends Error {
    constructor(message, errContent) {
        super(message);
        this.name = 'ClaudeAuthError';
        this.errContent = errContent;
        this.isAuthError = true;
    }
}

/**
 * Client Claude CLI — interface compatible OpenAIClient pour les services texte.
 * Utilise le pattern bat+vbs+poll (même mécanique que motiondesign.js).
 */
class ClaudeClient {
    constructor(premiereAsync) {
        this.premiere = premiereAsync;
        this._streamDebugDone = false;
        this._extensionRoot = new CSInterface().getSystemPath(SystemPath.EXTENSION);
    }

    /**
     * Détecte si une erreur CLI est liée à l'authentification.
     * @param {string} errContent - Contenu du fichier .err
     * @returns {boolean} true si c'est une erreur d'auth
     */
    _detectAuthError(errContent) {
        if (!errContent) return false;
        const lower = errContent.toLowerCase();
        const authPatterns = [
            'not logged in',
            'authentication required',
            'authentication failed',
            'session expired',
            'invalid token',
            'unauthorized',
            'login required',
            'please log in',
            'you are not authenticated',
            'auth error'
        ];
        return authPatterns.some(pattern => lower.includes(pattern));
    }

    /**
     * Helper : join de chemins Windows
     */
    _pathJoin(...parts) {
        return parts.join('\\').replace(/\//g, '\\').replace(/\\+/g, '\\');
    }

    /**
     * Retourne le dossier temporaire de l'extension, le crée si nécessaire.
     */
    _getTempDir() {
        const tempDir = this._pathJoin(this._extensionRoot, 'temp');
        try { window.cep.fs.makedir(tempDir); } catch (e) { /* existe déjà */ }
        return tempDir;
    }

    /**
     * Parse le contenu NDJSON (stream-json --verbose) de Claude CLI.
     * @param {string} raw - Contenu brut du fichier (NDJSON lines)
     * @returns {{ text: string, charCount: number, phase: string, isComplete: boolean }}
     */
    _parseStreamJson(raw) {
        if (!raw || !raw.trim()) return { text: '', charCount: 0, phase: 'waiting', isComplete: false };

        const lines = raw.split('\n').filter(l => l.trim());
        let accumulatedText = '';
        let thinkingChars = 0;
        let completeText = null;
        let isComplete = false;
        let jsonLineCount = 0;

        for (const line of lines) {
            try {
                const event = JSON.parse(line);
                jsonLineCount++;

                if (!this._streamDebugDone && jsonLineCount <= 3) {
                    console.log(`[STREAM-JSON] Event #${jsonLineCount}: type="${event.type}"`);
                    if (jsonLineCount === 3) this._streamDebugDone = true;
                }

                if (event.type === 'stream_event' && event.event?.delta) {
                    const delta = event.event.delta;
                    if (delta.type === 'text_delta') {
                        accumulatedText += delta.text;
                    } else if (delta.type === 'thinking_delta') {
                        thinkingChars += (delta.thinking || '').length;
                    }
                }

                if (event.type === 'assistant' && event.message?.content) {
                    for (const block of event.message.content) {
                        if (block.type === 'text') {
                            completeText = block.text;
                        }
                    }
                }

                if (event.type === 'result') {
                    isComplete = true;
                    // Extraire le texte final depuis le result event
                    if (event.result) {
                        // result peut être une string directe ou un objet
                        if (typeof event.result === 'string') {
                            completeText = event.result;
                        } else if (Array.isArray(event.result)) {
                            // Array de content blocks
                            for (const block of event.result) {
                                if (block.type === 'text' && block.text) {
                                    completeText = block.text;
                                }
                            }
                        }
                    }
                    // Si result vide, accumulatedText sera utilisé via le fallback
                }
            } catch (e) {
                // Ligne non-JSON, ignorer
            }
        }

        let phase = 'waiting';
        if (isComplete || completeText) phase = 'complete';
        else if (accumulatedText.length > 0) phase = 'generating';
        else if (thinkingChars > 0) phase = 'thinking';

        if (jsonLineCount > 0) {
            const text = completeText || accumulatedText;
            return { text, charCount: text.length, thinkingChars, phase, isComplete };
        }

        // Fallback : contenu brut (compat --output-format text)
        return { text: raw, charCount: raw.length, thinkingChars: 0, phase: 'generating', isComplete: false };
    }

    /**
     * Lance Claude CLI en background et poll le fichier de sortie jusqu'à complétion.
     * @param {string} promptContent - Contenu complet du prompt
     * @param {string} tempDir - Dossier temporaire
     * @param {Object} callbacks - { onProgress(charCount) }
     * @param {number} timeoutMs - Timeout max en ms (défaut 180s)
     * @returns {Promise<string>} Contenu brut de la réponse Claude
     */
    async _runAndPoll(promptContent, tempDir, callbacks = {}, timeoutMs = 180000) {
        const { onProgress } = callbacks;
        this._streamDebugDone = false;
        const timestamp = Date.now();
        const promptPath = this._pathJoin(tempDir, `claude_prompt_${timestamp}.txt`);
        const outputPath = this._pathJoin(tempDir, `claude_output_${timestamp}.txt`);

        console.log(`[CLAUDE-POLL] _runAndPoll: prompt=${promptContent.length} chars`);

        const writeResult = window.cep.fs.writeFile(promptPath, promptContent);
        if (writeResult.err !== 0) {
            throw new Error(`Impossible d'écrire le prompt Claude : erreur cep.fs ${writeResult.err}`);
        }

        const launchResult = await this.premiere.runClaudeBackground(promptPath, outputPath);
        if (launchResult.error) {
            throw new Error(launchResult.error);
        }

        const { donePath, batPath, vbsPath } = launchResult;

        const POLL_INTERVAL = 500;
        const STABLE_TIMEOUT = 20000;
        const startTime = Date.now();
        let lastContent = '';
        let lastContentChangeTime = startTime;
        let timedOut = false;
        let stableFinish = false;
        let pollCount = 0;
        let lastParsedChars = 0;

        try {
            while (true) {
                await new Promise(r => setTimeout(r, POLL_INTERVAL));
                pollCount++;

                const elapsed = Date.now() - startTime;

                if (elapsed >= timeoutMs) {
                    console.log(`[CLAUDE-POLL] TIMEOUT atteint après ${elapsed}ms`);
                    timedOut = true;
                    break;
                }

                let done;
                try {
                    done = await this.premiere.isClaudeDone(donePath);
                } catch (doneErr) {
                    done = false;
                }

                let currentContent;
                try {
                    currentContent = await this.premiere.readTextFileJSX(outputPath);
                } catch (readErr) {
                    currentContent = '';
                }

                // Vérifier les erreurs d'auth en temps réel (toutes les 5 polls)
                if (pollCount % 5 === 0) {
                    try {
                        const errContent = await this.premiere.readTextFileJSX(outputPath + '.err');
                        if (errContent && this._detectAuthError(errContent)) {
                            console.log('[CLAUDE-POLL] Erreur d\'auth détectée en temps réel');
                            throw new ClaudeAuthError(
                                'Authentification Claude expirée. Veuillez vous reconnecter.',
                                errContent
                            );
                        }
                    } catch (authErr) {
                        if (authErr instanceof ClaudeAuthError) throw authErr;
                        // Ignorer autres erreurs de lecture
                    }
                }

                if (currentContent && currentContent.length > lastContent.length) {
                    lastContent = currentContent;
                    lastContentChangeTime = Date.now();
                }

                const parsed = currentContent ? this._parseStreamJson(currentContent) : null;
                if (parsed && parsed.charCount > lastParsedChars) {
                    lastParsedChars = parsed.charCount;
                    if (onProgress) onProgress(parsed.charCount, parsed.text);
                }

                // Si le parser détecte isComplete (result event reçu) et qu'on a du texte, sortir directement
                if (parsed && parsed.isComplete && parsed.charCount > 0) {
                    console.log(`[CLAUDE-POLL] RESULT EVENT détecté avec ${parsed.charCount} chars — sortie immédiate`);
                    stableFinish = true;
                    break;
                }

                const stableMs = Date.now() - lastContentChangeTime;
                if (lastParsedChars > 100 && stableMs >= STABLE_TIMEOUT) {
                    console.log(`[CLAUDE-POLL] CONTENT STABLE depuis ${Math.round(stableMs/1000)}s`);
                    stableFinish = true;
                    break;
                }

                if (pollCount % 10 === 0) {
                    console.log(`[CLAUDE-POLL] Poll #${pollCount} | ${Math.round(elapsed/1000)}s | done=${done} | texte=${lastParsedChars} | phase=${parsed?.phase || 'waiting'}`);
                }

                if (done) {
                    console.log(`[CLAUDE-POLL] DONE détecté après ${Math.round(elapsed/1000)}s`);
                    const finalContent = await this.premiere.readTextFileJSX(outputPath);
                    const parsed = this._parseStreamJson(finalContent || '');
                    if (!parsed.text || !parsed.text.trim()) {
                        const errContent = await this.premiere.readTextFileJSX(outputPath + '.err');
                        // Détection spécifique des erreurs d'authentification
                        if (this._detectAuthError(errContent)) {
                            throw new ClaudeAuthError(
                                'Authentification Claude expirée. Veuillez vous reconnecter.',
                                errContent
                            );
                        }
                        throw new Error('Claude n\'a produit aucune sortie' + (errContent ? ' : ' + errContent.slice(0, 200) : ''));
                    }
                    return parsed.text.trim();
                }
            }

            if (stableFinish) {
                try { await this.premiere.killClaudeProcess(); } catch (e) { /* ignore */ }
                const finalContent = await this.premiere.readTextFileJSX(outputPath);
                const rawResult = (finalContent && finalContent.length > lastContent.length) ? finalContent : lastContent;
                const parsed = this._parseStreamJson(rawResult);
                return parsed.text.trim();
            }

            if (timedOut) {
                try { await this.premiere.killClaudeProcess(); } catch (e) { /* ignore */ }
                const parsedTimeout = this._parseStreamJson(lastContent);
                if (parsedTimeout.charCount > 100) {
                    return parsedTimeout.text.trim();
                }
                throw new Error(`Timeout Claude CLI (${timeoutMs / 1000}s) — la génération a pris trop de temps`);
            }

        } catch (pollError) {
            throw pollError;
        } finally {
            try { await this.premiere.cleanupClaudeFiles(outputPath, batPath, vbsPath); } catch (e) { /* ignore */ }
            try { window.cep.fs.deleteFile(promptPath); } catch (e) { /* ignore */ }
        }
    }

    /**
     * Interface compatible OpenAIClient.call() — combine les messages en prompt texte.
     * @param {Object} params - { input: [{role,content}], onDelta, maxAttempts }
     * @returns {Promise<string>} Texte de la réponse
     */
    async call(params) {
        const maxAttempts = params.maxAttempts || OPENAI.MAX_RETRY_ATTEMPTS;
        const onDelta = params.onDelta || null;

        // Combiner les messages en un seul prompt texte
        const messages = params.input || [];
        const parts = [];
        for (const msg of messages) {
            if (msg.role === 'system') {
                parts.push(msg.content);
            } else {
                parts.push(msg.content);
            }
        }
        const promptContent = parts.join('\n\n---\n\n');

        const tempDir = this._getTempDir();

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const result = await this._runAndPoll(promptContent, tempDir, {
                    onProgress: onDelta ? (charCount, text) => {
                        onDelta(text || '');
                    } : null
                }, 180000);

                if (!result || !result.trim()) {
                    if (attempt < maxAttempts) {
                        if (window.notifications) {
                            window.notifications.warning(`Claude: tentative ${attempt} sans réponse, nouvel essai...`);
                        }
                        await delay(OPENAI.DELAY_BETWEEN_BATCHES_MS * attempt);
                        continue;
                    }
                    throw new Error("Claude: réponse vide après " + maxAttempts + " tentatives");
                }

                return result;
            } catch (error) {
                console.error(`[Claude] Tentative ${attempt}/${maxAttempts} échouée:`, error.message);
                if (attempt === maxAttempts) throw error;
                if (window.notifications) {
                    window.notifications.warning(`Claude: erreur tentative ${attempt}, nouvel essai...`);
                }
                await delay(OPENAI.DELAY_BETWEEN_BATCHES_MS * attempt);
            }
        }
    }

    // ══════════════════════════════════════════════════════
    // Méthodes miroir — même interface que OpenAIClient
    // ══════════════════════════════════════════════════════

    /**
     * Generate titles from subtitles (miroir de OpenAIClient.generateTitles)
     */
    async generateTitles(subtitles, onDelta = null) {
        const systemPrompt = this._getTitlesSystemPrompt();

        const result = await this.call({
            input: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: JSON.stringify(subtitles) }
            ],
            onDelta
        });

        const normalized = normalizeTitlesJsonBatch(result);
        if (!normalized) {
            throw new Error('Impossible d\'extraire le JSON des titres depuis la réponse Claude. Format attendu: [[ ... ]]');
        }
        return JSON.parse(normalized);
    }

    /**
     * Generate titles in batches (miroir de OpenAIClient.generateTitlesBatch)
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
                    ? `Génération des titres via Claude (lot ${i + 1}/${chunks.length}) | ${sequenceName}`
                    : `Génération des titres via Claude (lot ${i + 1}/${chunks.length})`;
                setMessage(label);
            }

            if (onBatchStart) onBatchStart(chunks[i].length);

            const onDelta = onStreamProgress
                ? (accText) => onStreamProgress(chunks[i].length, accText.length)
                : null;

            const batchResult = await this.generateTitles(chunks[i], onDelta);
            if (Array.isArray(batchResult)) {
                allTitles.push(...batchResult);
            }

            if (onBatchComplete) onBatchComplete(chunks[i].length);
            await delay(OPENAI.DELAY_BETWEEN_BATCHES_MS);
        }

        return allTitles;
    }

    /**
     * Analyze subtitles for B-roll placement (miroir de OpenAIClient.analyzeBrolls)
     */
    async analyzeBrolls(subtitlesBatch, onDelta = null) {
        const systemPrompt = this._getBrollsSystemPrompt();

        const result = await this.call({
            input: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: String(subtitlesBatch) }
            ],
            onDelta
        });

        let parsed = null;
        try {
            const val = JSON.parse(result);
            if (Array.isArray(val)) parsed = val;
        } catch {
            const fixed = coerceToJsonArray(result);
            const val = JSON.parse(fixed);
            if (!Array.isArray(val)) throw new Error("Format de sortie invalide");
            parsed = val;
        }

        return parsed;
    }

    /**
     * Select title words at cursor position (miroir de OpenAIClient.selectTitleWords)
     */
    async selectTitleWords(subtitles, cursorPosition, startBound = '', endBound = '') {
        const systemPrompt = this._getAddTitleHereSystemPrompt();

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
            ]
        });

        const normalized = normalizeTitlesJsonBatch(result);
        const parsed = JSON.parse(normalized);

        if (!Array.isArray(parsed) || parsed.length === 0 || !Array.isArray(parsed[0]) || parsed[0].length < 2) {
            throw new Error('Format de réponse Claude invalide pour le titre ponctuel');
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
     * Analyze transcription for Smart Cut segments (miroir de OpenAIClient.analyzeSmartCut)
     * Pseudo-streaming par polling — émet les segments JSONL au fur et à mesure.
     */
    async analyzeSmartCut(transcription, intention, callbacks = {}, abortSignal = null, overrides = {}) {
        const { onSegment, onProgress, onError, onComplete } = callbacks;

        const systemPrompt = overrides.systemPrompt || this._getSmartCutSystemPrompt();
        const intentionText = intention.assembledPrompt || (intention.templatePath ? loadTemplate(intention.templatePath) : null);
        const userData = overrides.userData || {
            intention: intentionText || 'Identifie les segments les plus pertinents.',
            transcription: transcription
        };

        const promptContent = systemPrompt + '\n\n---\n\n' + JSON.stringify(userData);
        const tempDir = this._getTempDir();

        this._streamDebugDone = false;
        const timestamp = Date.now();
        const promptPath = this._pathJoin(tempDir, `claude_prompt_${timestamp}.txt`);
        const outputPath = this._pathJoin(tempDir, `claude_output_${timestamp}.txt`);

        const writeResult = window.cep.fs.writeFile(promptPath, promptContent);
        if (writeResult.err !== 0) {
            throw new Error(`Impossible d'écrire le prompt Claude : erreur cep.fs ${writeResult.err}`);
        }

        const launchResult = await this.premiere.runClaudeBackground(promptPath, outputPath);
        if (launchResult.error) throw new Error(launchResult.error);

        const { donePath, batPath, vbsPath } = launchResult;

        const POLL_INTERVAL = 500;
        const STABLE_TIMEOUT = 20000;
        const TIMEOUT_MS = 300000; // 5 minutes pour Smart Cut
        const startTime = Date.now();
        let lastContent = '';
        let lastContentChangeTime = startTime;
        let segmentCount = 0;
        let processedUpTo = 0; // Track how much of the text we've already parsed for segments
        let aborted = false;

        try {
            while (true) {
                await new Promise(r => setTimeout(r, POLL_INTERVAL));

                // Check abort
                if (abortSignal && abortSignal.aborted) {
                    aborted = true;
                    try { await this.premiere.killClaudeProcess(); } catch (e) { /* ignore */ }
                    break;
                }

                const elapsed = Date.now() - startTime;
                if (elapsed >= TIMEOUT_MS) break;

                let done;
                try { done = await this.premiere.isClaudeDone(donePath); } catch (e) { done = false; }

                let currentContent;
                try { currentContent = await this.premiere.readTextFileJSX(outputPath); } catch (e) { currentContent = ''; }

                if (currentContent && currentContent.length > lastContent.length) {
                    lastContent = currentContent;
                    lastContentChangeTime = Date.now();
                }

                // Parse le texte accumulé pour extraire les segments JSONL
                const parsed = currentContent ? this._parseStreamJson(currentContent) : null;
                if (parsed && parsed.text && parsed.text.length > processedUpTo) {
                    const newText = parsed.text.substring(processedUpTo);
                    const jsonLines = newText.split('\n');

                    let consumedChars = 0;
                    for (const jsonLine of jsonLines) {
                        const trimmed = jsonLine.trim();
                        if (!trimmed) {
                            consumedChars += jsonLine.length + 1;
                            continue;
                        }
                        try {
                            const segment = JSON.parse(trimmed);
                            if (segment && typeof segment.start === 'number' && typeof segment.end === 'number' && segment.title) {
                                segmentCount++;
                                if (onSegment) onSegment(segment);
                                if (onProgress) onProgress(segmentCount, false);
                            }
                            consumedChars += jsonLine.length + 1;
                        } catch (e) {
                            // Ligne JSON incomplète — ne pas avancer processedUpTo au-delà
                            break;
                        }
                    }
                    processedUpTo += consumedChars;
                }

                // Content-stable detection
                const stableMs = Date.now() - lastContentChangeTime;
                if (parsed && parsed.charCount > 100 && stableMs >= STABLE_TIMEOUT) {
                    try { await this.premiere.killClaudeProcess(); } catch (e) { /* ignore */ }
                    break;
                }

                if (done) break;
            }

            // Parse final pour les segments restants
            if (!aborted && lastContent) {
                const finalParsed = this._parseStreamJson(lastContent);
                if (finalParsed && finalParsed.text && finalParsed.text.length > processedUpTo) {
                    const remaining = finalParsed.text.substring(processedUpTo);
                    for (const jsonLine of remaining.split('\n')) {
                        const trimmed = jsonLine.trim();
                        if (!trimmed) continue;
                        try {
                            const segment = JSON.parse(trimmed);
                            if (segment && typeof segment.start === 'number' && typeof segment.end === 'number' && segment.title) {
                                segmentCount++;
                                if (onSegment) onSegment(segment);
                            }
                        } catch (e) { /* ignorer */ }
                    }
                }
            }

            if (aborted) {
                const err = new Error('Analyse arrêtée par l\'utilisateur');
                err.name = 'AbortError';
                throw err;
            }

            if (onComplete) onComplete(segmentCount);

        } catch (error) {
            if (error.name === 'AbortError') throw error;
            if (onError) onError(error);
            throw error;
        } finally {
            try { await this.premiere.cleanupClaudeFiles(outputPath, batPath, vbsPath); } catch (e) { /* ignore */ }
            try { window.cep.fs.deleteFile(promptPath); } catch (e) { /* ignore */ }
        }
    }

    // ══════════════════════════════════════════════════════
    // Chargement des prompts système (templates .md)
    // ══════════════════════════════════════════════════════

    _getTitlesSystemPrompt() {
        return loadTemplate(TEMPLATE_PATHS.TITLES_SYSTEM) || 'Tu es un expert en création de titres impactants pour vidéos courtes.';
    }

    _getBrollsSystemPrompt() {
        return loadTemplate(TEMPLATE_PATHS.BROLLS_SYSTEM) || 'Tu es un sélecteur de B-roll pour vidéos courtes.';
    }

    _getAddTitleHereSystemPrompt() {
        return loadTemplate(TEMPLATE_PATHS.ADD_TITLE_HERE) || 'Tu es un assistant de montage video.';
    }

    _getSmartCutSystemPrompt() {
        return loadTemplate(TEMPLATE_PATHS.SMART_CUT_SYSTEM) || 'Tu es un assistant de montage video professionnel.';
    }

    getSmartCutMultiSystemPrompt() {
        return loadTemplate(TEMPLATE_PATHS.SMART_CUT_MULTI_SYSTEM) || 'Tu es un assistant de montage video professionnel pour plusieurs séquences.';
    }

    /**
     * Generate video context (target, intention, summary) from subtitles
     * Miroir de OpenAIClient.generateVideoContext
     */
    async generateVideoContext(subtitlesText) {
        const systemPrompt = this._getContextSystemPrompt();

        const result = await this.call({
            input: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: subtitlesText }
            ]
        });

        let parsed;
        try {
            parsed = JSON.parse(result);
        } catch (e) {
            parsed = extractJsonFromRaw(result);
        }

        if (!parsed || !parsed.target || !parsed.intention || !parsed.summary) {
            throw new Error('Contexte video invalide : champs target, intention ou summary manquants');
        }

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
     * Analyze subtitles for motion design placement
     * Miroir de OpenAIClient.analyzeMotionDesign
     */
    async analyzeMotionDesign(subtitlesBatch, onDelta = null) {
        const systemPrompt = this._getMotionDesignSystemPrompt();

        const result = await this.call({
            input: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: String(subtitlesBatch) }
            ],
            onDelta
        });

        let parsed = null;
        try {
            const val = JSON.parse(result);
            if (Array.isArray(val)) parsed = val;
        } catch {
            const fixed = coerceToJsonArray(result);
            const val = JSON.parse(fixed);
            if (!Array.isArray(val)) throw new Error("Format de sortie invalide");
            parsed = val;
        }

        return parsed;
    }

    _getContextSystemPrompt() {
        return loadTemplate(TEMPLATE_PATHS.CONTEXT_SYSTEM) || `Tu es un analyste de contenu video. Tu recois les sous-titres d'une video et tu dois determiner le contexte semantique.

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

    _getMotionDesignSystemPrompt() {
        return loadTemplate(TEMPLATE_PATHS.MOTION_DESIGN_SYSTEM) || `Tu es un sélecteur de moments clés pour des overlays motion design dans des vidéos courtes.
GOAL_PERCENT = 0.15
Entrée : [[index, phrase], ...]
Marquer environ 15% des lignes pour y placer un overlay motion design animé.
Critères : mots concrets et animables, moments d'impact émotionnel, chiffres et données, transitions.
Interdiction de motion designs consécutifs.
Réponds uniquement au format : [[index, phrase, "true"|"false"], ...]
Utilise UNIQUEMENT des guillemets doubles. Ne renvoie rien d'autre que le tableau JSON.`;
    }
}

export default ClaudeClient;
export { ClaudeAuthError };
