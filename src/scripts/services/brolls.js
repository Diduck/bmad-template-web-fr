import ErrorHandler from '../utils/errorHandler.js';
import { OPENAI, MESSAGES, SUCCESS, PATHS } from '../utils/constants.js';
import { delay, handleClaudeAuthError } from '../utils/helpers.js';
import { ClaudeAuthError } from '../api/claude.js';

/**
 * B-roll generation service
 * Accepts any AI client implementing analyzeBrolls() (duck typing).
 */
class BrollsService {
    constructor(premiereAsync, aiClient, subtitlesService = null, avatarTarget = '', contextService = null) {
        this.premiere = premiereAsync;
        this.openai = aiClient;
        this.subtitlesService = subtitlesService;
        this.avatarTarget = avatarTarget;
        this.contextService = contextService;
    }

    /**
     * Create B-rolls for multiple files
     * @param {Array<string>} files - File names
     * @param {Function} setProgress - Progress callback
     * @returns {Promise<void>}
     */
    async createForFiles(files, setProgress = null, setProgressBar = null) {
        const projectPath = await this.premiere.getProjectPath();

        for (const file of files) {
            // Helper pour la génération avec retry en cas d'erreur d'auth
            const createBrollsForFile = async () => {
                await this.createForFile(file, projectPath, setProgress, setProgressBar);
            };

            try {
                await createBrollsForFile();
            } catch (error) {
                // Gestion spéciale pour les erreurs d'auth Claude
                const wasAuthError = await handleClaudeAuthError(error, async () => {
                    // Retry après reconnexion
                    if (setProgress) {
                        setProgress(`Reconnexion réussie, reprise B-rolls : ${file}`);
                    }
                    await createBrollsForFile();
                });

                // Si ce n'était pas une erreur d'auth ou si le retry a échoué, logger
                if (!wasAuthError) {
                    if (setProgress) {
                        setProgress(`Erreur B-rolls pour ${file}: ${error.message}`);
                    }
                    ErrorHandler.handle(
                        error,
                        'BrollsService.createForFile',
                        `Erreur création B-rolls pour ${file}`
                    );
                }
            }
        }
    }

    /**
     * Create B-rolls for a single file
     * @param {string} file - File name
     * @param {string} projectPath - Project path
     * @param {Function} setProgress - Progress callback
     * @returns {Promise<Object>} B-roll data
     */
    async createForFile(file, projectPath, setProgress = null, setProgressBar = null) {
        const fileJSONBroll = `${projectPath}07_Audio\\Brolls\\${file}_brolls.json`;

        // Check if already exists
        if (await this.premiere.fileExists(fileJSONBroll)) {
            if (setProgress) {
                setProgress(`B-rolls déjà analysé pour ${file}.`);
            }

            const content = await this.premiere.readFile(fileJSONBroll);
            const brollData = JSON.parse(content);
            await this.premiere.addBrollOnTimeline(content, file);

            // Generate missing files (resume after interruption)
            await this._ensureArtifacts(file, brollData, projectPath, setProgress);

            return brollData;
        }

        // Get JSON content from Premiere
        // Note: evalScript returns the string "null" when JSX returns null
        const audioFilePath = `${projectPath}07_Audio\\Audio\\${file}.json`;
        let jsonContent = await this.premiere.createBrolls(file, audioFilePath);
        const isValidJson = (val) => val && val !== 'null' && val !== 'undefined';

        // If JSON doesn't exist, auto-trigger export + transcription
        if (!isValidJson(jsonContent) && this.subtitlesService) {
            if (setProgress) {
                setProgress(`Transcription automatique pour ${file}...`);
            }
            await this.subtitlesService.generateForFiles([file], "BROLL", null, setProgress);
            jsonContent = await this.premiere.createBrolls(file, audioFilePath);
        }

        if (!isValidJson(jsonContent)) {
            throw new Error(`Fichier JSON introuvable : ${audioFilePath}\nLa transcription a échoué ou n'a pas pu être lancée.`);
        }

        const subtitles = JSON.parse(jsonContent);

        // Load video context if no manual avatar target
        let videoContext = null;
        if (!this.avatarTarget && this.contextService) {
            if (setProgress) {
                setProgress(`${file} | Génération du contexte vidéo...`);
            }
            try {
                videoContext = await this.contextService.generateForFile(file, projectPath);
            } catch (e) {
                console.warn(`[BrollsService] Contexte non disponible pour ${file}:`, e.message);
            }
        }

        // Analyze with AI (retry up to 3 times if no B-rolls found)
        const maxAttempts = 3;
        let brollData = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            brollData = await this.analyzeBrollsBatch(
                subtitles,
                file,
                setProgress,
                setProgressBar,
                videoContext
            );

            const hasBrolls = brollData.some(item => item.response !== false);

            if (hasBrolls) {
                break;
            }

            if (attempt < maxAttempts) {
                if (setProgress) {
                    setProgress(`${file} | Aucun B-roll trouvé, nouvelle tentative (${attempt}/${maxAttempts})...`);
                }
                await delay(OPENAI.DELAY_BETWEEN_BATCHES_MS);
            } else {
                if (setProgress) {
                    setProgress(`${file} | Aucun B-roll après ${maxAttempts} tentatives, vidéo ignorée.`);
                }
                return brollData;
            }
        }

        // Save results
        await this.premiere.writeFile(fileJSONBroll, JSON.stringify(brollData));

        // Create markers in Premiere (pass file path, JSX reads from file)
        await this.premiere.createMarkers(file, fileJSONBroll);

        // Generate HTML + context artifacts
        await this._ensureArtifacts(file, brollData, projectPath, setProgress, videoContext);

        if (setProgress) {
            setProgress(SUCCESS.BROLLS_ANALYZED);
        }

        return brollData;
    }

    /**
     * Analyze B-rolls in batches
     * @param {Array} subtitles - Subtitle data
     * @param {string} file - File name
     * @param {Function} setProgress - Progress callback
     * @returns {Promise<Array>} B-roll analysis
     */
    async analyzeBrollsBatch(subtitles, file, setProgress = null, setProgressBar = null, videoContext = null) {
        const allResults = [];
        const batchSize = 50;

        const liste = subtitles.map(item => [item.index, item.text]);
        const totalSubtitles = liste.length;
        let processedSubtitles = 0;
        let lastProgressUpdate = 0;
        const CHARS_PER_SUBTITLE = 40;
        const THROTTLE_MS = 80;
        const FAKE_INCREMENT = 2;
        const FAKE_INTERVAL_MS = 1000;
        const FAKE_MAX_FRACTION = 0.20;

        let fakeExtra = 0;
        let fakeTimer = null;

        const updateBar = (effective) => {
            if (!setProgressBar || totalSubtitles <= 0) return;
            const clamped = Math.min(effective, totalSubtitles);
            const percent = Math.round((clamped / totalSubtitles) * 100);
            setProgressBar(percent, `${Math.round(clamped)}/${totalSubtitles} sous-titres analysés`);
        };

        if (setProgressBar && totalSubtitles > 0) {
            setProgressBar(0, `0/${totalSubtitles} sous-titres analysés`);
        }

        for (let b = 0; b < liste.length; b += batchSize) {
            const batch = liste.slice(b, b + batchSize);
            const currentBatchSize = batch.length;

            if (setProgress) {
                setProgress(
                    `${file} | Analyse B-rolls (lot ${Math.floor(b / batchSize) + 1} — ${Math.min(b + batchSize, liste.length)} / ${liste.length})`
                );
            }

            // Start fake progress for this batch
            if (setProgressBar) {
                fakeExtra = 0;
                if (fakeTimer) clearInterval(fakeTimer);
                const maxFake = currentBatchSize * FAKE_MAX_FRACTION;
                fakeTimer = setInterval(() => {
                    fakeExtra = Math.min(fakeExtra + FAKE_INCREMENT, maxFake);
                    updateBar(processedSubtitles + fakeExtra);
                }, FAKE_INTERVAL_MS);
            }

            const onDelta = setProgressBar ? (accText) => {
                const now = Date.now();
                if (now - lastProgressUpdate < THROTTLE_MS) return;
                lastProgressUpdate = now;

                const estimatedOutput = currentBatchSize * CHARS_PER_SUBTITLE;
                const streamFraction = Math.min(accText.length / estimatedOutput, 0.95);
                const realExtra = currentBatchSize * streamFraction;

                if (realExtra < fakeExtra) return;

                if (fakeTimer) { clearInterval(fakeTimer); fakeTimer = null; }
                updateBar(processedSubtitles + realExtra);
            } : null;

            try {
                // Inject context/avatar into user content
                let batchContent = String(batch);
                if (this.avatarTarget) {
                    // Manual override — priority
                    batchContent += `\n\nCIBLE CLIENT : ${this.avatarTarget}`;
                } else if (videoContext && videoContext.target) {
                    // AI-generated context
                    batchContent += `\n\nCONTEXTE VIDEO :\n- Cible : ${videoContext.target.gender}, ${videoContext.target.age}\n- Motivations : ${videoContext.target.motivations}\n- Peurs : ${videoContext.target.fears}\n- Intention : ${videoContext.intention}\n- Resume : ${videoContext.summary}\n\nCIBLE CLIENT : ${videoContext.target.gender}`;
                }
                const response = await this.openai.analyzeBrolls(batchContent, onDelta);
                if (Array.isArray(response)) {
                    allResults.push(...response);
                }
            } catch (error) {
                console.error("❌ Erreur analyse lot B-rolls:", error);
            }

            // Batch complete
            if (fakeTimer) { clearInterval(fakeTimer); fakeTimer = null; }
            fakeExtra = 0;
            processedSubtitles += currentBatchSize;
            updateBar(processedSubtitles);

            await delay(OPENAI.DELAY_BETWEEN_BATCHES_MS);
        }

        if (setProgress) {
            setProgress(`${file} | Récupération de toutes les réponses terminée.`);
        }

        // Clean responses
        for (let j = 0; j < allResults.length; j++) {
            const val = allResults[j][2];
            if (typeof val === 'string' && val.toUpperCase().includes("FALSE")) {
                allResults[j][2] = false;
            }
        }

        // Build final JSON
        const jsonReturn = [];
        for (let i = 0; i < subtitles.length; i++) {
            const item = subtitles[i];
            const itemBefore = jsonReturn[i - 1] ? jsonReturn[i - 1].response : false;
            const match = allResults.find(r => r[0] === item.index);

            let response;
            if (itemBefore !== false) {
                response = false; // No consecutive B-rolls
            } else {
                response = match ? match[2] : false;
            }

            jsonReturn.push({
                index: item.index,
                text: item.text,
                start: item.start,
                end: item.end,
                response: response
            });
        }

        return jsonReturn;
    }

    /**
     * Ensure all artifacts (HTML + context MD) exist for a file.
     * Generates missing ones, loading context from cache if needed (resume scenario).
     * @param {string} file - File name
     * @param {Array} brollData - B-roll data
     * @param {string} projectPath - Project path
     * @param {Function|null} setProgress - Progress callback
     * @param {Object|null} videoContext - Already-loaded video context (null on resume)
     */
    async _ensureArtifacts(file, brollData, projectPath, setProgress = null, videoContext = null) {
        // HTML preview
        await this.generateHtmlPreview(file, brollData, projectPath);

        // Context: load from cache if not provided (resume scenario)
        if (!videoContext && this.contextService) {
            try {
                videoContext = await this.contextService.generateForFile(file, projectPath);
            } catch (e) {
                console.warn(`[BrollsService] Contexte non disponible pour ${file}:`, e.message);
            }
        }

        // Markdown context file
        try {
            await this.generateMarkdownPreview(file, projectPath, videoContext);
        } catch (e) {
            console.warn(`[BrollsService] Erreur génération .md pour ${file}:`, e.message);
        }

        if (setProgress && videoContext) {
            setProgress(`Contexte vidéo généré pour ${file}.`);
        }
    }

    /**
     * Generate Markdown preview with video context in Context folder
     * @param {string} file - File name
     * @param {string} projectPath - Project path
     * @param {Object|null} videoContext - Video context from ContextService
     * @returns {Promise<void>}
     */
    async generateMarkdownPreview(file, projectPath, videoContext = null) {
        if (!videoContext || !videoContext.target) return;

        const contextDir = `${projectPath}${PATHS.AUDIO_FOLDER}\\${PATHS.CONTEXT_SUBFOLDER}`;
        const path = `${contextDir}\\${file}_context.md`;

        if (await this.premiere.fileExists(path)) {
            return;
        }

        let md = `# Contexte Video — ${file}\n\n`;
        md += `**Cible :** ${videoContext.target.gender}, ${videoContext.target.age}\n`;
        md += `**Motivations :** ${videoContext.target.motivations}\n`;
        md += `**Peurs :** ${videoContext.target.fears}\n`;
        md += `**Intention :** ${videoContext.intention}\n`;
        md += `**Resume :** ${videoContext.summary}\n`;

        await this.premiere.writeFile(path, md);
    }

    async generateHtmlPreview(file, content, projectPath) {
        const path = `${projectPath}07_Audio\\Brolls\\${file}_brolls.html`;

        if (await this.premiere.fileExists(path)) {
            return; // Already exists
        }

        const css = `h1{text-align:center;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;color:#333}.styled-table{border-collapse:collapse;margin:20px auto;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;min-width:600px;box-shadow:0 4px 8px rgba(0,0,0,0.1)}.styled-table thead tr{background-color:#009879;color:#ffffff;text-align:left}.styled-table th,.styled-table td{padding:12px 15px}.styled-table tbody tr{border-bottom:1px solid #dddddd}.styled-table tbody tr:nth-of-type(even){background-color:#f3f3f3}.styled-table tbody tr:last-of-type{border-bottom:2px solid #009879}.styled-table tbody tr:hover{background-color:#009879;color:#ffffff}.styled-table tbody tr:hover a{color:#ffffff}`;

        let html = `<style>${css}</style><h1>${file}</h1><table border="1" cellpadding="5" cellspacing="0" class="styled-table"><thead><tr><th>#</th><th>Heure</th><th>Réponse</th><th>Avant</th><th>Texte</th><th>Après</th></tr></thead><tbody>`;

        let count = 1;
        for (let i = 0; i < content.length; i++) {
            const { response, start, text } = content[i];
            const before = i > 0 ? content[i - 1].text : "";
            const after = i < content.length - 1 ? content[i + 1].text : "";

            if (response) {
                html += `<tr><td>${count}</td><td>${start}</td><td><a href="https://app.envato.com/search?itemType=stock-video&term=${response}" target="_blank">${count} - ${response}</a></td><td>${before}</td><td>${text}</td><td>${after}</td></tr>`;
                count += 1;
            }
        }

        html += `</tbody></table>`;

        await this.premiere.writeFile(path, html);
    }
}

export default BrollsService;
