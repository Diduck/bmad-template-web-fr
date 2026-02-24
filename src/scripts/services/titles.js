import OpenAIClient from '../api/openai.js';
import ErrorHandler from '../utils/errorHandler.js';
import { MESSAGES, SUCCESS, OPENAI } from '../utils/constants.js';

/**
 * Title generation service
 */
class TitlesService {
    constructor(premiereAsync, apiKey) {
        this.premiere = premiereAsync;
        this.openai = new OpenAIClient(apiKey);
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
            const srtPath = `${projectPath}07_Audio\\${file}SRT.json`;
            const titlesPath = `${projectPath}07_Audio\\${file}_titles.json`;

            const srtExists = await this.premiere.fileExists(srtPath);
            if (!srtExists) {
                console.warn(`[Titles] SRT introuvable pour ${file}, skip`);
                if (window.notifications) {
                    window.notifications.warning(`Titres : fichier SRT introuvable pour ${file}`);
                }
                continue;
            }

            const titlesExist = await this.premiere.fileExists(titlesPath);
            if (titlesExist) {
                console.log(`[Titles] Titres déjà existants pour ${file}`);
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

            try {
                const titles = await this.openai.generateTitlesBatch(subtitles, setMessage, file, onStreamProgress, onBatchComplete, onBatchStart);
                const titlesPath = `${projectPath}07_Audio\\${file}_titles.json`;
                await this.premiere.writeFile(titlesPath, JSON.stringify(titles));

                if (window.notifications) {
                    window.notifications.success(`${SUCCESS.TITLES_GENERATED} : ${file}`);
                }
            } catch (error) {
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

export default TitlesService;
