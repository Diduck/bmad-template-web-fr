import ErrorHandler from '../utils/errorHandler.js';
import { MESSAGES } from '../utils/constants.js';

/**
 * Subtitle generation service
 */
class SubtitlesService {
    constructor(premiereAsync, csInterface) {
        this.premiere = premiereAsync;
        this.csInterface = csInterface;
    }

    /**
     * Generate subtitles for multiple files
     * @param {Array<string>} files - File names
     * @param {string} goal - Goal type (SRT or BROLL)
     * @param {number|null} charLimit - Max characters per subtitle line (default 19)
     * @param {Function} setProgress - Progress callback
     * @returns {Promise<void>}
     */
    async generateForFiles(files, goal, charLimit = 19, setProgress = null) {
        if (setProgress) {
            setProgress(MESSAGES.GENERATING_SUBTITLES);
        }

        const projectPath = await this.premiere.getProjectPath();
        const audioPath = `${projectPath}07_Audio\\Audio\\`;

        // Filter files that don't already have subtitles
        const filesToProcess = [];
        for (const file of files) {
            const exists = await this.checkSubtitleExists(file, goal, projectPath);
            if (!exists) {
                filesToProcess.push(file);
            }
        }

        if (filesToProcess.length === 0) {
            return;
        }

        // Export WAV files
        await this.premiere.exportMultipleWav(filesToProcess, audioPath);

        // Transcribe each file
        for (const file of filesToProcess) {
            try {
                if (setProgress) {
                    setProgress('Génération de la transcription');
                }

                await this.transcribeFile(file, audioPath, goal, charLimit, projectPath);
            } catch (error) {
                ErrorHandler.handle(
                    error,
                    'SubtitlesService.transcribeFile',
                    `Erreur transcription pour ${file}`
                );
            }
        }
    }

    /**
     * Check if subtitle file already exists
     * @param {string} file - File name
     * @param {string} goal - Goal type
     * @param {string} projectPath - Project path
     * @returns {Promise<boolean>} True if exists
     */
    async checkSubtitleExists(file, goal, projectPath) {
        let path;
        if (goal === "BROLL") {
            path = `${projectPath}07_Audio\\Audio\\${file}.json`;
        } else {
            path = `${projectPath}07_Audio\\Subtitles\\${file}SRT.json`;
        }

        return await this.premiere.fileExists(path);
    }

    /**
     * Transcribe a single file with Python
     * @param {string} file - File name
     * @param {string} audioPath - Audio folder path
     * @param {string} goal - Goal type
     * @param {number} charLimit - Max characters per subtitle line (default 19)
     * @param {string} projectPath - Project path for outputDir routing
     * @returns {Promise<void>}
     */
    async transcribeFile(file, audioPath, goal, charLimit = 19, projectPath = '') {
        const extensionPath = this.csInterface
            .getSystemPath(SystemPath.EXTENSION);

        // SRT → output dans Subtitles/, BROLL → reste dans Audio/ (même dossier que WAV)
        const outputDir = (goal === "SRT" && projectPath)
            ? `${projectPath}07_Audio\\Subtitles\\`
            : null;

        const result = await this.premiere.runPythonTranscription(
            extensionPath,
            audioPath,
            goal,
            file,
            charLimit,
            outputDir
        );

        if (!result || result === "TRANSCRIPTION_FAILED" || result === "BATCH_NOT_FOUND" || result === "CANNOT_WRITE_BATCH") {
            throw new Error(`Transcription échouée pour ${file}: ${result}`);
        }
    }
}

export default SubtitlesService;
