import OpenAIClient from '../api/openai.js';
import ErrorHandler from '../utils/errorHandler.js';
import { OPENAI, MESSAGES, SUCCESS } from '../utils/constants.js';
import { delay } from '../utils/helpers.js';

/**
 * B-roll generation service
 */
class BrollsService {
    constructor(premiereAsync, apiKey, subtitlesService = null) {
        this.premiere = premiereAsync;
        this.openai = new OpenAIClient(apiKey);
        this.subtitlesService = subtitlesService;
    }

    /**
     * Create B-rolls for multiple files
     * @param {Array<string>} files - File names
     * @param {Function} setProgress - Progress callback
     * @returns {Promise<void>}
     */
    async createForFiles(files, setProgress = null) {
        const projectPath = await this.premiere.getProjectPath();

        for (const file of files) {
            try {
                await this.createForFile(file, projectPath, setProgress);
            } catch (error) {
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

    /**
     * Create B-rolls for a single file
     * @param {string} file - File name
     * @param {string} projectPath - Project path
     * @param {Function} setProgress - Progress callback
     * @returns {Promise<Object>} B-roll data
     */
    async createForFile(file, projectPath, setProgress = null) {
        const fileJSONBroll = `${projectPath}07_Audio\\${file}_brolls.json`;

        // Check if already exists
        if (await this.premiere.fileExists(fileJSONBroll)) {
            if (setProgress) {
                setProgress(`B-rolls déjà analysé pour ${file}.`);
            }

            const content = await this.premiere.readFile(fileJSONBroll);
            await this.premiere.addBrollOnTimeline(content, file);

            return JSON.parse(content);
        }

        // Get JSON content from Premiere
        // Note: evalScript returns the string "null" when JSX returns null
        const audioFilePath = `${projectPath}07_Audio\\${file}.json`;
        let jsonContent = await this.premiere.createBrolls(file, audioFilePath);
        const isValidJson = (val) => val && val !== 'null' && val !== 'undefined';

        // If JSON doesn't exist, auto-trigger export + transcription
        if (!isValidJson(jsonContent) && this.subtitlesService) {
            if (setProgress) {
                setProgress(`Transcription automatique pour ${file}...`);
            }
            await this.subtitlesService.generateForFiles([file], "BROLL", setProgress);
            jsonContent = await this.premiere.createBrolls(file, audioFilePath);
        }

        if (!isValidJson(jsonContent)) {
            throw new Error(`Fichier JSON introuvable : ${audioFilePath}\nLa transcription a échoué ou n'a pas pu être lancée.`);
        }

        const subtitles = JSON.parse(jsonContent);

        // Analyze with AI
        const brollData = await this.analyzeBrollsBatch(
            subtitles,
            file,
            setProgress
        );

        // Save results
        await this.premiere.writeFile(fileJSONBroll, JSON.stringify(brollData));

        // Create markers in Premiere (pass file path, JSX reads from file)
        await this.premiere.createMarkers(file, fileJSONBroll);

        // Generate HTML preview
        await this.generateHtmlPreview(file, brollData, projectPath);

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
    async analyzeBrollsBatch(subtitles, file, setProgress = null) {
        const allResults = [];
        const batchSize = 50;

        const liste = subtitles.map(item => [item.index, item.text]);

        for (let b = 0; b < liste.length; b += batchSize) {
            const batch = liste.slice(b, b + batchSize);

            if (setProgress) {
                setProgress(
                    `${file} | Envoi du lot ${Math.floor(b / batchSize) + 1} (${Math.min(b + batchSize, liste.length)} / ${liste.length})`
                );
            }

            try {
                const response = await this.openai.analyzeBrolls(batch);
                if (Array.isArray(response)) {
                    allResults.push(...response);
                }
            } catch (error) {
                console.error("❌ Erreur analyse lot B-rolls:", error);
            }

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
     * Generate HTML preview for B-rolls
     * @param {string} file - File name
     * @param {Array} content - B-roll data
     * @param {string} projectPath - Project path
     * @returns {Promise<void>}
     */
    async generateHtmlPreview(file, content, projectPath) {
        const path = `${projectPath}07_Audio\\${file}_brolls.html`;

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
