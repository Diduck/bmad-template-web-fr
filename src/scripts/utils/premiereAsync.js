/**
 * Async wrappers for CSInterface Premiere Pro interactions
 */
class PremiereAsync {
    constructor(csInterface) {
        this.csInterface = csInterface;
    }

    /**
     * Wrap a csInterface.evalScript call with a timeout
     * @param {string} script - ExtendScript to evaluate
     * @param {number} timeoutMs - Timeout in milliseconds (default 30s)
     * @returns {Promise<string>} Result from evalScript
     */
    _evalWithTimeout(script, timeoutMs = 30000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`evalScript timeout (${timeoutMs}ms) pour: ${script.substring(0, 80)}`));
            }, timeoutMs);

            this.csInterface.evalScript(script, (result) => {
                clearTimeout(timer);
                resolve(result);
            });
        });
    }

    /**
     * Get project folder path
     * @returns {Promise<string>} Project folder path
     */
    async getProjectPath() {
        return new Promise((resolve) => {
            this.csInterface.evalScript('getProjectFolderPath()', resolve);
        });
    }

    /**
     * Get selected sequences
     * @param {string} selection - Selection type
     * @param {boolean} returnObjects - Return objects or names
     * @returns {Promise<Array>} Array of sequences
     */
    async getSelectedSequence(selection, returnObjects = false) {
        return new Promise((resolve, reject) => {
            this.csInterface.evalScript(
                `getSelectedSequence("${selection}", ${returnObjects})`,
                (result) => {
                    try {
                        resolve(JSON.parse(result));
                    } catch (error) {
                        reject(error);
                    }
                }
            );
        });
    }

    /**
     * Check if file exists
     * @param {string} filePath - Path to check
     * @returns {Promise<boolean>} True if file exists
     */
    async fileExists(filePath) {
        const escapedPath = filePath.replace(/\\/g, "\\\\");
        const result = await this._evalWithTimeout(`FileExists("${escapedPath}")`);
        return result === "true";
    }

    /**
     * Write file
     * @param {string} filePath - Path to write to
     * @param {string} content - Content to write
     * @returns {Promise<boolean>} True if successful
     */
    async writeFile(filePath, content) {
        const safeContent = content
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"');
        const safePath = filePath.replace(/\\/g, "\\\\");

        const result = await this._evalWithTimeout(`writeFile("${safePath}", "${safeContent}")`);
        return result === "true";
    }

    /**
     * Read file
     * @param {string} filePath - Path to read from
     * @returns {Promise<string>} File content
     */
    async readFile(filePath) {
        const safePath = filePath.replace(/\\/g, "\\\\");
        return await this._evalWithTimeout(`readFile("${safePath}")`);
    }

    /**
     * Create workflow folders
     * @returns {Promise<string>} Result
     */
    async createWorkflow() {
        return new Promise((resolve) => {
            this.csInterface.evalScript('CreateWorkflow()', resolve);
        });
    }

    /**
     * Execute step 1
     * @param {boolean} optionAudio - Audio option
     * @param {string} suffixAudio - Audio suffix
     * @param {string} selectedFormat - Selected format
     * @returns {Promise<string>} Result
     */
    async executeStep1(optionAudio, suffixAudio, selectedFormat) {
        return new Promise((resolve) => {
            this.csInterface.evalScript(
                `STEP1_EXECUTE(${optionAudio}, "${suffixAudio}", "${selectedFormat}")`,
                resolve
            );
        });
    }

    /**
     * Evaluate JSX with timeout and error rejection
     * @param {string} script - JSX expression to evaluate
     * @param {number} timeoutMs - Timeout in milliseconds (0 = no timeout)
     * @returns {Promise<string>} Result from JSX
     */
    _evalWithTimeout(script, timeoutMs = 60000) {
        return new Promise((resolve, reject) => {
            let settled = false;
            let timer = null;

            if (timeoutMs > 0) {
                timer = setTimeout(() => {
                    if (!settled) {
                        settled = true;
                        reject(new Error(`JSX timeout (${timeoutMs}ms)`));
                    }
                }, timeoutMs);
            }

            this.csInterface.evalScript(script, (result) => {
                if (!settled) {
                    settled = true;
                    if (timer) clearTimeout(timer);
                    if (result === 'EvalScript error.') {
                        reject(new Error('JSX evaluation error'));
                    } else {
                        resolve(result);
                    }
                }
            });
        });
    }

    /**
     * Read cut analysis data from file
     * @param {string} projectPath - Project folder path
     * @returns {Promise<Array|null>} Parsed cut zone data, or null
     */
    async readCutAnalysis(projectPath) {
        const safePath = projectPath.replace(/\\/g, "\\\\");
        const result = await this._evalWithTimeout(
            `(function(){ var p="${safePath}07_Audio\\\\CutZoneList.json"; if(FileExists(p)==="true"){return readFile(p);}return "null"; })()`,
            10000
        );
        if (result === 'null' || !result) return null;
        return JSON.parse(result);
    }

    /**
     * Analyze cuts for a single sequence
     * @param {string} sequenceName - Sequence name
     * @param {string} audioSuffix - Audio suffix
     * @param {number} margin - Cut margin
     * @param {number} threshold - RMS threshold
     * @returns {Promise<Object>} Analysis result
     */
    async analyzeCutForSequence(sequenceName, audioSuffix, margin, threshold) {
        const safeName = sequenceName.replace(/"/g, '\\"');
        const result = await this._evalWithTimeout(
            `(function(){ var seq = searchSequenceByName("${safeName}"); if(!seq) return JSON.stringify({Message:"Séquence introuvable",fileName:"${safeName}"}); return JSON.stringify(AnalyseCut(seq, "${audioSuffix}", ${margin}, ${threshold})); })()`,
            120000
        );
        return JSON.parse(result);
    }

    /**
     * Execute cuts for a single sequence
     * @param {string} sequenceName - Sequence name
     * @param {Array} cutZones - Cut zone data
     * @returns {Promise<string>} Result
     */
    async executeCutForSequence(sequenceName, cutZones) {
        const safeName = sequenceName.replace(/"/g, '\\"');
        const safeCutZones = JSON.stringify(cutZones).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return this._evalWithTimeout(
            `(function(){ var seq = searchSequenceByName("${safeName}"); if(!seq){notif("Séquence ${safeName} introuvable","error"); return "error";} CutSecond(JSON.parse('${safeCutZones}'), seq); return "ok"; })()`,
            60000
        );
    }

    /**
     * Create subtitle track for a single sequence
     * @param {string} sequenceName - Sequence name
     * @param {string} presetStyle - Preset style path
     * @returns {Promise<string>} Result
     */
    async createSubtitlesForSequence(sequenceName, presetStyle) {
        const safeName = sequenceName.replace(/"/g, '\\"');
        const safePreset = presetStyle.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return this._evalWithTimeout(
            `(function(){ var seq = searchSequenceByName("${safeName}"); if(!seq){notif("Séquence ${safeName} introuvable","error"); return "error";} CreateSTR(seq, "${safePreset}"); return "ok"; })()`,
            30000
        );
    }

    /**
     * Create animated titles for a single sequence
     * @param {string} sequenceName - Sequence name
     * @param {string} templateSelection - Template ID
     * @param {string} titleColor - Hex color
     * @returns {Promise<string>} Result
     */
    async createTitlesForSequence(sequenceName, templateSelection, titleColor) {
        const safeName = sequenceName.replace(/"/g, '\\"');
        const safeColor = titleColor.replace(/"/g, '\\"');
        return this._evalWithTimeout(
            `(function(){ var seq = searchSequenceByName("${safeName}"); if(!seq){notif("Séquence ${safeName} introuvable","error"); return "error";} CreateTitles(seq, "${templateSelection}", "${safeColor}"); return "ok"; })()`,
            60000
        );
    }

    /**
     * Create zoom
     * @param {string} sequence - Sequence name
     * @returns {Promise<string>} Result
     */
    async createZoom(sequence) {
        return new Promise((resolve) => {
            this.csInterface.evalScript(
                `CreateZoom("${sequence}")`,
                resolve
            );
        });
    }

    /**
     * Go to time in sequence
     * @param {number} time - Time in seconds
     * @param {string} sequence - Sequence name
     * @returns {Promise<void>}
     */
    async goToTime(time, sequence) {
        return new Promise((resolve) => {
            this.csInterface.evalScript(
                `goToTime(${time}, "${sequence}")`,
                resolve
            );
        });
    }

    /**
     * Export multiple WAV files
     * @param {Array<string>} files - File names
     * @param {string} audioPath - Audio folder path
     * @returns {Promise<string>} Result
     */
    async exportMultipleWav(files, audioPath) {
        return new Promise((resolve) => {
            const safeFiles = JSON.stringify(files).replace(/"/g, '\\"');
            const safePath = audioPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

            this.csInterface.evalScript(
                `exportMultipleWav("${safeFiles}", "${safePath}")`,
                resolve
            );
        });
    }

    /**
     * Create B-rolls
     * @param {string} file - File name
     * @param {string} audioPath - Audio file path
     * @returns {Promise<string>} JSON content
     */
    async createBrolls(file, audioPath) {
        return new Promise((resolve) => {
            const escapedAudio = audioPath.replace(/\\/g, "\\\\");
            this.csInterface.evalScript(
                `createBrolls("${file}", "${escapedAudio}")`,
                resolve
            );
        });
    }

    /**
     * Create markers
     * @param {string} file - File name
     * @param {string} jsonFilePath - Path to JSON file (JSX reads from file)
     * @returns {Promise<void>}
     */
    async createMarkers(file, jsonFilePath) {
        return new Promise((resolve) => {
            const safePath = jsonFilePath.replace(/\\/g, "\\\\");
            this.csInterface.evalScript(
                `createMarkers("${file}", "${safePath}")`,
                resolve
            );
        });
    }

    /**
     * Add B-rolls to timeline
     * @param {string} content - B-roll content
     * @param {string} name - Sequence name
     * @returns {Promise<boolean>} Success status
     */
    async addBrollOnTimeline(content, name) {
        return new Promise((resolve) => {
            const safeContent = content
                .replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"');
            const safeName = name.replace(/\\/g, "\\\\");

            this.csInterface.evalScript(
                `addBrollOnTimeline("${safeContent}", "${safeName}")`,
                (result) => resolve(result === "1")
            );
        });
    }

    /**
     * Run Python transcription
     * @param {string} extensionPath - Extension path
     * @param {string} audioPath - Audio path
     * @param {string} goal - Goal type
     * @param {string} file - File name
     * @returns {Promise<string>} Result
     */
    async runPythonTranscription(extensionPath, audioPath, goal, file) {
        return new Promise((resolve) => {
            const escapedExt = extensionPath.replace(/\//g, "\\\\");
            const escapedAudio = audioPath.replace(/\\/g, "\\\\");
            const escapedFile = file.replace(/\\/g, "\\\\");

            this.csInterface.evalScript(
                `runPythonTranscription("${escapedExt}", "${escapedAudio}", "${goal}", "${escapedFile}")`,
                resolve
            );
        });
    }


    /**
     * Run a shell command synchronously and return output (for setup checks)
     * @param {string} cmd - Command to execute
     * @returns {Promise<string>} Command output
     */
    async runSetupCommand(cmd) {
        return new Promise((resolve) => {
            const escaped = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            this.csInterface.evalScript(`runSetupCommand("${escaped}")`, resolve);
        });
    }

    /**
     * Check if a file exists in a folder (case-insensitive)
     * @param {string} folderPath - Folder path
     * @param {string} fileName - File name to look for
     * @returns {Promise<boolean>} True if found
     */
    async checkFileInFolder(folderPath, fileName) {
        return new Promise((resolve) => {
            const escapedFolder = folderPath.replace(/\\/g, '\\\\');
            const escapedFile = fileName.replace(/\\/g, '\\\\');
            this.csInterface.evalScript(
                `checkFileInFolder("${escapedFolder}", "${escapedFile}")`,
                (result) => resolve(result === 'true')
            );
        });
    }
}

export default PremiereAsync;
