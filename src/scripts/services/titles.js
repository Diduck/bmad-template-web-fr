import ErrorHandler from '../utils/errorHandler.js';
import { MESSAGES, SUCCESS, ERRORS, OPENAI, ADD_TITLE } from '../utils/constants.js';
import { handleClaudeAuthError } from '../utils/helpers.js';
import { ClaudeAuthError } from '../api/claude.js';

/**
 * Title generation service
 * Accepts any AI client implementing generateTitlesBatch() and selectTitleWords() (duck typing).
 */
class TitlesService {
    constructor(premiereAsync, aiClient) {
        this.premiere = premiereAsync;
        this.openai = aiClient;
    }

    /**
     * Generate titles for multiple files
     * @param {Array<string>} files - File names
     * @param {Function} setMessage - Message callback
     * @param {Function} setProgressBar - Progress bar callback (percent, detail)
     * @returns {Promise<void>}
     */
    async generateForFiles(files, setMessage = null, setProgressBar = null) {
        if (setMessage) {
            setMessage(MESSAGES.GENERATING_TITLES);
        }

        const projectPath = await this.premiere.getProjectPath();

        // Pre-scan: count total batches across all eligible files
        const eligible = [];
        for (const file of files) {
            const srtPath = `${projectPath}07_Audio\\Subtitles\\${file}SRT.json`;
            const titlesPath = `${projectPath}07_Audio\\Titles\\${file}_titles.json`;

            let srtExists = await this.premiere.fileExists(srtPath);
            if (!srtExists) {
                // Auto-transcription quand le SRT est absent
                if (window.notifications) {
                    window.notifications.warning(`Titres : SRT introuvable pour ${file}, transcription auto...`);
                }
                if (setMessage) {
                    setMessage(`Transcription automatique : ${file}`);
                }
                try {
                    const extensionPath = this.premiere.getExtensionPath();
                    const audioPath = `${projectPath}07_Audio\\Audio\\`;
                    const outputDir = `${projectPath}07_Audio\\Subtitles\\`;

                    // Créer les dossiers si absents
                    await this.premiere.createDirectory(audioPath);
                    await this.premiere.createDirectory(outputDir);

                    await this.premiere.exportMultipleWav([file], audioPath);

                    const transcriptionResult = await this.premiere.runPythonTranscription(
                        extensionPath, audioPath, 'SRT', file, 19, outputDir
                    );

                    if (!transcriptionResult || transcriptionResult === 'TRANSCRIPTION_FAILED' ||
                        transcriptionResult === 'BATCH_NOT_FOUND' || transcriptionResult === 'CANNOT_WRITE_BATCH') {
                        console.warn(`[Titles] Transcription échouée pour ${file}, skip`);
                        if (window.notifications) {
                            window.notifications.warning(`Titres : transcription échouée pour ${file}`);
                        }
                        continue;
                    }

                    // Retry pour flush disque
                    for (let attempt = 0; attempt < 3; attempt++) {
                        if (attempt > 0) await new Promise(r => setTimeout(r, 500));
                        srtExists = await this.premiere.fileExists(srtPath);
                        if (srtExists) break;
                    }

                    if (!srtExists) {
                        console.warn(`[Titles] SRT toujours introuvable après transcription pour ${file}, skip`);
                        if (window.notifications) {
                            window.notifications.warning(`Titres : SRT introuvable après transcription pour ${file}`);
                        }
                        continue;
                    }

                    if (window.notifications) {
                        window.notifications.success(`Transcription terminée pour ${file}`);
                    }
                } catch (transcriptionError) {
                    console.warn(`[Titles] Erreur transcription pour ${file}:`, transcriptionError);
                    if (window.notifications) {
                        window.notifications.warning(`Titres : erreur transcription pour ${file}`);
                    }
                    continue;
                }
            }

            const titlesExist = await this.premiere.fileExists(titlesPath);
            if (titlesExist) {
                continue;
            }

            const content = await this.premiere.readFile(srtPath);
            const subtitles = JSON.parse(content);
            const batchCount = Math.ceil(subtitles.length / OPENAI.BATCH_SIZE);
            eligible.push({ file, subtitles, batchCount });
        }

        const totalSubtitles = eligible.reduce((sum, e) => sum + e.subtitles.length, 0);
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
            setProgressBar(percent, `${Math.round(clamped)}/${totalSubtitles} sous-titres traités`);
        };

        const onBatchStart = setProgressBar ? (batchSize) => {
            fakeExtra = 0;
            if (fakeTimer) clearInterval(fakeTimer);
            const maxFake = batchSize * FAKE_MAX_FRACTION;
            fakeTimer = setInterval(() => {
                fakeExtra = Math.min(fakeExtra + FAKE_INCREMENT, maxFake);
                updateBar(processedSubtitles + fakeExtra);
            }, FAKE_INTERVAL_MS);
        } : null;

        const onStreamProgress = setProgressBar ? (batchSize, streamedChars) => {
            const now = Date.now();
            if (now - lastProgressUpdate < THROTTLE_MS) return;
            lastProgressUpdate = now;

            const estimatedOutput = batchSize * CHARS_PER_SUBTITLE;
            const streamFraction = Math.min(streamedChars / estimatedOutput, 0.95);
            const realExtra = batchSize * streamFraction;

            if (realExtra < fakeExtra) return;

            if (fakeTimer) { clearInterval(fakeTimer); fakeTimer = null; }
            updateBar(processedSubtitles + realExtra);
        } : null;

        const onBatchComplete = (batchSize) => {
            if (fakeTimer) { clearInterval(fakeTimer); fakeTimer = null; }
            fakeExtra = 0;
            processedSubtitles += batchSize;
            updateBar(processedSubtitles);
        };

        if (setProgressBar && totalSubtitles > 0) {
            setProgressBar(0, `0/${totalSubtitles} sous-titres traités`);
        }

        for (let i = 0; i < eligible.length; i++) {
            const { file, subtitles } = eligible[i];

            if (setMessage) {
                setMessage(`${MESSAGES.GENERATING_TITLES} (${i + 1}/${eligible.length}) : ${file}`);
            }

            // Helper pour la génération avec retry en cas d'erreur d'auth
            const generateTitlesForFile = async () => {
                const titles = await this.openai.generateTitlesBatch(subtitles, setMessage, file, onStreamProgress, onBatchComplete, onBatchStart);
                const titlesPath = `${projectPath}07_Audio\\Titles\\${file}_titles.json`;
                await this.premiere.writeFile(titlesPath, JSON.stringify(titles));

                if (window.notifications) {
                    window.notifications.success(`${SUCCESS.TITLES_GENERATED} : ${file}`);
                }
            };

            try {
                await generateTitlesForFile();
            } catch (error) {
                // Gestion spéciale pour les erreurs d'auth Claude
                const wasAuthError = await handleClaudeAuthError(error, async () => {
                    // Retry après reconnexion
                    if (setMessage) {
                        setMessage(`Reconnexion réussie, reprise : ${file}`);
                    }
                    await generateTitlesForFile();
                });

                // Si ce n'était pas une erreur d'auth ou si le retry a échoué, logger
                if (!wasAuthError) {
                    ErrorHandler.handle(
                        error,
                        'TitlesService.generateForFile',
                        `Erreur génération titres pour ${file}`
                    );
                    if (window.notifications) {
                        window.notifications.warning(`Titres échoués pour ${file}, passage au suivant...`);
                    }
                }
            }
        }
    }
    /**
     * Add a single title at cursor position
     * @param {string} templateSelection - Template ID
     * @param {string} titleColor - Hex color
     * @param {string} startBound - Mot de début (optionnel)
     * @param {string} endBound - Mot de fin (optionnel)
     * @param {Object} loadingScreen - LoadingScreen instance (optionnel)
     * @returns {Promise<void>}
     */
    async addTitleAtCursor(templateSelection, titleColor, startBound = '', endBound = '', loadingScreen = null) {
        // 1. Get CTI position
        const ctiResult = await this.premiere.getCTIPosition();
        if (ctiResult.error) {
            window.notifications.error(ctiResult.error);
            return;
        }

        const { position, sequenceName } = ctiResult;

        // 2. Get subtitles at cursor position
        let subtitlesResult = await this.premiere.getSubtitlesAtTime(
            sequenceName,
            position,
            ADD_TITLE.SUBTITLE_WINDOW_SEC
        );

        // SRT introuvable = pas encore transcrit → lancer auto-transcription
        const srtMissing = subtitlesResult.error && subtitlesResult.error.includes('SRT introuvable');
        if (subtitlesResult.error && !srtMissing) {
            window.notifications.error(subtitlesResult.error);
            return;
        }

        if (srtMissing || !subtitlesResult.subtitles || subtitlesResult.subtitles.length === 0) {
            // Auto-transcription Whisper
            if (loadingScreen) loadingScreen.setMessage('Transcription automatique en cours...');
            window.notifications.warning('Aucun sous-titre — transcription automatique...');

            try {
                const extensionPath = this.premiere.getExtensionPath();
                const projectPath = await this.premiere.getProjectPath();
                const audioPath = projectPath + '07_Audio\\Audio\\';
                const outputDir = projectPath + '07_Audio\\Subtitles\\';

                // 0. Créer les dossiers si absents
                await this.premiere.createDirectory(audioPath);
                await this.premiere.createDirectory(outputDir);

                // 1. Exporter le WAV de la séquence
                await this.premiere.exportMultipleWav([sequenceName], audioPath);

                // 2. Lancer la transcription Whisper (charLimit=19 comme le standard)
                const transcriptionResult = await this.premiere.runPythonTranscription(
                    extensionPath, audioPath, 'SRT', sequenceName, 19, outputDir
                );

                if (!transcriptionResult || transcriptionResult === 'TRANSCRIPTION_FAILED' ||
                    transcriptionResult === 'BATCH_NOT_FOUND' || transcriptionResult === 'CANNOT_WRITE_BATCH') {
                    window.notifications.error('Transcription échouée : ' + (transcriptionResult || 'erreur inconnue'));
                    return;
                }

                // 3. Relire les sous-titres à la position du curseur (avec retry pour flush disque)
                let retryResult = null;
                for (let attempt = 0; attempt < 3; attempt++) {
                    if (attempt > 0) await new Promise(r => setTimeout(r, 500));
                    retryResult = await this.premiere.getSubtitlesAtTime(
                        sequenceName, position, ADD_TITLE.SUBTITLE_WINDOW_SEC
                    );
                    if (retryResult.subtitles && retryResult.subtitles.length > 0) break;
                }

                if (!retryResult || !retryResult.subtitles || retryResult.subtitles.length === 0) {
                    window.notifications.error('Transcription terminée mais aucun sous-titre à cette position');
                    return;
                }

                // 4. Remplacer le résultat pour continuer le flow normal
                subtitlesResult = retryResult;
                if (loadingScreen) loadingScreen.setMessage(MESSAGES.ADDING_TITLE_HERE);
                window.notifications.success('Transcription terminée');
            } catch (transcriptionError) {
                console.error('[AddTitle] Erreur transcription:', transcriptionError);
                window.notifications.error('Erreur transcription : ' + transcriptionError.message);
                return;
            }
        }

        // 3. Ask AI to select title words (with cursor position + optional bounds)
        const titleLines = await this.openai.selectTitleWords(subtitlesResult.subtitles, position, startBound, endBound);

        if (!titleLines || titleLines.length < 2) {
            window.notifications.error('Pas assez de mots pour créer un titre');
            return;
        }

        // 4. Import MOGRT at cursor position
        const importResult = await this.premiere.addSingleTitle(
            sequenceName,
            titleLines,
            templateSelection,
            titleColor
        );

        if (importResult.error) {
            window.notifications.error(importResult.error);
            return;
        }

        window.notifications.success(SUCCESS.TITLE_ADDED_HERE);
    }
}

export default TitlesService;
