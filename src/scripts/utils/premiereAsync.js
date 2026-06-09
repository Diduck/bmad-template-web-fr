/**
 * Async wrappers for CSInterface Premiere Pro interactions
 */
class PremiereAsync {
    constructor(csInterface) {
        this.csInterface = csInterface;
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
     * Get full project file path (.prproj)
     * @returns {Promise<string>} Full project path
     */
    async getProjectFullPath() {
        return new Promise((resolve) => {
            this.csInterface.evalScript('getProjectFullPath()', resolve);
        });
    }

    /**
     * Get extension root path (synchronous)
     * @returns {string} Extension path with backslashes
     */
    getExtensionPath() {
        return this.csInterface.getSystemPath(SystemPath.EXTENSION).replace(/\//g, '\\');
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
     * Get all project sequences with name and duration
     * @returns {Promise<Array<{name: string, duration: number}>>} Array of sequences
     */
    async getAllProjectSequences() {
        const result = await this._evalWithTimeout('GetAllProjectSequences()', 60000);
        return JSON.parse(result);
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
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r');
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
     * Get active sequence info (name, duration, sequenceId)
     * @returns {Promise<Object>} Sequence info or {error: string}
     */
    async getActiveSequenceInfo() {
        const result = await this._evalWithTimeout('GetActiveSequenceInfo()', 60000);
        return JSON.parse(result);
    }

    /**
     * Create a Smart Cut sequence by nested cut of the source
     * @param {string} name - Sequence name (e.g. SHORT1)
     * @param {string} inPoint - In point in seconds
     * @param {string} outPoint - Out point in seconds
     * @param {string} sourceSequenceName - Source sequence name
     * @returns {Promise<Object>} {success, name} or {error}
     */
    async createSmartCutSequence(name, inPoint, outPoint, sourceSequenceName) {
        const safeName = name.replace(/"/g, '\\"');
        const safeSource = sourceSequenceName.replace(/"/g, '\\"');
        const result = await this._evalWithTimeout(
            'CreateSmartCutSequence("' + safeName + '", "' + inPoint + '", "' + outPoint + '", "' + safeSource + '")',
            60000
        );
        return JSON.parse(result);
    }

    /**
     * Undo Smart Cut — delete created sequences
     * @param {string[]} sequenceNames - Array of sequence names to delete
     * @returns {Promise<Object>} {success, deleted, errors} or {error}
     */
    async undoSmartCut(sequenceNames) {
        const namesJSON = JSON.stringify(sequenceNames).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const result = await this._evalWithTimeout(
            'UndoSmartCut("' + namesJSON + '")',
            60000
        );
        return JSON.parse(result);
    }

    /**
     * Get existing sequence names to avoid naming collisions
     * @returns {Promise<string[]>} Array of sequence names
     */
    async getExistingSequenceNames() {
        const result = await this._evalWithTimeout('GetExistingSequenceNames()', 60000);
        return JSON.parse(result);
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
            600000
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
            0
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
        const result = await this._evalWithTimeout(
            `(function(){ var seq = searchSequenceByName("${safeName}"); if(!seq){return JSON.stringify({error:"Séquence ${safeName} introuvable"});} try { CreateSTR(seq, "${safePreset}"); return "ok"; } catch(e) { return JSON.stringify({error: e.message || String(e)}); } })()`,
            30000
        );
        if (result !== 'ok') {
            try {
                const parsed = JSON.parse(result);
                if (parsed.error) throw new Error('JSX CreateSTR: ' + parsed.error);
            } catch (e) {
                if (e.message.startsWith('JSX CreateSTR:')) throw e;
            }
        }
        return result;
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
        const result = await this._evalWithTimeout(
            `(function(){ var seq = searchSequenceByName("${safeName}"); if(!seq){return JSON.stringify({error:"Séquence ${safeName} introuvable"});} try { CreateTitles(seq, "${templateSelection}", "${safeColor}"); return "ok"; } catch(e) { return JSON.stringify({error: e.message || String(e)}); } })()`,
            60000
        );
        if (result !== 'ok') {
            try {
                const parsed = JSON.parse(result);
                if (parsed.error) throw new Error('JSX CreateTitles: ' + parsed.error);
            } catch (e) {
                if (e.message.startsWith('JSX CreateTitles:')) throw e;
            }
        }
        return result;
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
     * @param {number|null} charLimit - Max characters per subtitle line (null = use Python default)
     * @param {string|null} outputDir - Output directory for transcription JSON (null = same as WAV)
     * @returns {Promise<string>} Result
     */
    async runPythonTranscription(extensionPath, audioPath, goal, file, charLimit = null, outputDir = null) {
        return new Promise((resolve) => {
            const escapedExt = extensionPath.replace(/[\\/]/g, "\\\\");
            const escapedAudio = audioPath.replace(/\\/g, "\\\\");
            const escapedFile = file.replace(/\\/g, "\\\\");
            const charLimitArg = charLimit != null ? `, "${charLimit}"` : ', ""';
            const modelArg = ', ""';
            const outputDirArg = outputDir
                ? `, "${outputDir.replace(/\\/g, "\\\\")}"`
                : '';

            this.csInterface.evalScript(
                `runPythonTranscription("${escapedExt}", "${escapedAudio}", "${goal}", "${escapedFile}"${charLimitArg}${modelArg}${outputDirArg})`,
                resolve
            );
        });
    }

    /**
     * Run Python transcription for SmartCut (Whisper medium, output in Smartcut subfolder)
     * @param {string} extensionPath - Extension root path
     * @param {string} audioPath - Audio folder path (07_Audio/)
     * @param {string} file - File name without extension
     * @param {string} outputDir - Output directory for the transcription JSON
     * @returns {Promise<string>} Transcription result
     */
    async runSmartCutTranscription(extensionPath, audioPath, file, outputDir) {
        return new Promise((resolve) => {
            const escapedExt = extensionPath.replace(/[\\/]/g, "\\\\");
            const escapedAudio = audioPath.replace(/\\/g, "\\\\");
            const escapedFile = file.replace(/\\/g, "\\\\");
            const escapedOutputDir = outputDir.replace(/\\/g, "\\\\");

            this.csInterface.evalScript(
                `runPythonTranscription("${escapedExt}", "${escapedAudio}", "SRT", "${escapedFile}", "", "medium", "${escapedOutputDir}")`,
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
     * Get CTI (Current Time Indicator) position
     * @returns {Promise<Object>} {position: seconds, sequenceName: string} or {error: string}
     */
    async getCTIPosition() {
        const result = await this._evalWithTimeout('GetCTIPosition()', 10000);
        return JSON.parse(result);
    }

    /**
     * Get subtitles at a given time within a window
     * @param {string} sequenceName - Sequence name
     * @param {number} timeSeconds - Time in seconds
     * @param {number} windowSeconds - Window size in seconds (+/-)
     * @returns {Promise<Object>} {subtitles: Array} or {error: string}
     */
    async getSubtitlesAtTime(sequenceName, timeSeconds, windowSeconds) {
        const safeName = sequenceName.replace(/"/g, '\\"');
        const result = await this._evalWithTimeout(
            `GetSubtitlesAtTime("${safeName}", ${timeSeconds}, ${windowSeconds})`,
            10000
        );
        return JSON.parse(result);
    }

    /**
     * Add a single title MOGRT at cursor position with track collision handling
     * @param {string} sequenceName - Sequence name
     * @param {Array} titleData - Array of {mots, start} objects
     * @param {string} templateSelection - Template ID
     * @param {string} titleColor - Hex color
     * @returns {Promise<Object>} {success: true, track: number} or {error: string}
     */
    async addSingleTitle(sequenceName, titleData, templateSelection, titleColor) {
        const safeName = sequenceName.replace(/"/g, '\\"');
        const safeData = JSON.stringify(titleData).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const safeColor = titleColor.replace(/"/g, '\\"');
        const result = await this._evalWithTimeout(
            `AddSingleTitle("${safeName}", "${safeData}", "${templateSelection}", "${safeColor}")`,
            30000
        );
        return JSON.parse(result);
    }

    /**
     * Import a Lottie overlay .mov into Premiere and place on timeline
     * @param {string} sequenceName - Sequence name
     * @param {string} movPath - Path to the .mov file
     * @param {number} positionSeconds - Position in seconds on timeline
     * @returns {Promise<Object>} {success: true, track: number} or {error: string}
     */
    async importLottieOverlay(sequenceName, movPath, positionSeconds) {
        const safeName = sequenceName.replace(/"/g, '\\"');
        const safePath = movPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const result = await this._evalWithTimeout(
            `ImportLottieOverlay("${safeName}", "${safePath}", ${positionSeconds})`,
            60000
        );
        return JSON.parse(result);
    }

    /**
     * Remove all clips from V8+ tracks (motion design) in a sequence
     * @param {string} sequenceName - Sequence name
     * @returns {Promise<Object>} { removed: number } or { error: string }
     */
    async clearMotionDesignClips(sequenceName) {
        const safeName = sequenceName.replace(/"/g, '\\"');
        const result = await this._evalWithTimeout(
            `ClearMotionDesignClips("${safeName}")`,
            30000
        );
        return JSON.parse(result);
    }

    /**
     * Get project folder path (filesystem path, not bin)
     * @returns {Promise<string>} Project folder path
     */
    async getProjectFolderPath() {
        const result = await this._evalWithTimeout('getProjectFolderPath()', 5000);
        return result.replace(/"/g, '');
    }

    // ── File System Helpers (pour motiondesign.js) ──

    /**
     * Create a directory (recursive)
     * @param {string} dirPath - Directory path
     * @returns {Promise<boolean>} True if created/exists
     */
    async createDirectory(dirPath) {
        const escaped = dirPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const result = await this._evalWithTimeout(`CreateDirectory("${escaped}")`, 10000);
        return result === 'true';
    }

    /**
     * Vérifie/crée un dossier. Throw si critical (défaut), warn+false sinon.
     * @param {string} dirPath - Chemin du dossier
     * @param {Object} [options]
     * @param {boolean} [options.critical=true] - true = throw, false = warn + return false
     * @returns {Promise<boolean>}
     */
    async ensureDir(dirPath, { critical = true } = {}) {
        if (!dirPath || typeof dirPath !== 'string') {
            const msg = 'ensureDir: chemin invalide';
            if (critical) throw new Error(msg);
            console.warn('[ensureDir]', msg, dirPath);
            return false;
        }
        const created = await this.createDirectory(dirPath);
        if (!created) {
            const msg = `Impossible de créer le dossier : ${dirPath}`;
            if (critical) {
                throw new Error(msg);
            }
            console.warn('[ensureDir]', msg);
            return false;
        }
        return true;
    }

    /**
     * Copy a file (binary-safe, via ExtendScript File.copy)
     * @param {string} src - Source path
     * @param {string} dst - Destination path
     * @returns {Promise<boolean>} True if copied
     */
    async copyFile(src, dst) {
        const eSrc = src.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const eDst = dst.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const result = await this._evalWithTimeout(`CopyFileTo("${eSrc}", "${eDst}")`, 30000);
        return result === 'true';
    }

    /**
     * Delete a file
     * @param {string} filePath - File path
     * @returns {Promise<void>}
     */
    async deleteFile(filePath) {
        const escaped = filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        await this._evalWithTimeout(`DeleteFileAt("${escaped}")`, 10000);
    }

    /**
     * List files in a directory
     * @param {string} dirPath - Directory path
     * @returns {Promise<string[]>} Array of file names
     */
    async listDir(dirPath) {
        const escaped = dirPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const result = await this._evalWithTimeout(`ListDirectory("${escaped}")`, 10000);
        return JSON.parse(result);
    }

    /**
     * Delete an empty folder
     * @param {string} dirPath - Directory path
     * @returns {Promise<void>}
     */
    async deleteFolder(dirPath) {
        const escaped = dirPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        await this._evalWithTimeout(`DeleteFolder("${escaped}")`, 10000);
    }

    /**
     * Run a shell command synchronously via JSX (bat+vbs pattern)
     * @param {string} cmd - Command to execute
     * @param {number} timeoutMs - Timeout (default 120s)
     * @returns {Promise<string>} Command output
     */
    async runCommand(cmd, timeoutMs = 120000) {
        const escaped = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return this._evalWithTimeout(`runSetupCommand("${escaped}")`, timeoutMs);
    }

    /**
     * Échappe un chemin Windows pour injection sûre dans evalScript (backslash + guillemets)
     * @param {string} path - Chemin à échapper
     * @returns {string} Chemin échappé
     */
    _escPath(path) {
        return path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    /**
     * Lance une commande Claude CLI en arrière-plan (non-bloquant)
     * @param {string} promptPath - Chemin du fichier prompt
     * @param {string} outputPath - Chemin du fichier de sortie
     * @returns {Promise<Object>} {launched, donePath, batPath, vbsPath} ou {error}
     */
    async runClaudeBackground(promptPath, outputPath) {
        const result = await this._evalWithTimeout(
            `runClaudeBackground("${this._escPath(promptPath)}", "${this._escPath(outputPath)}")`, 30000
        );
        return JSON.parse(result);
    }

    /**
     * Vérifie si la commande Claude est terminée (fichier .done existe)
     * @param {string} donePath - Chemin du fichier .done
     * @returns {Promise<boolean>}
     */
    async isClaudeDone(donePath) {
        return new Promise((resolve) => {
            this.csInterface.evalScript(
                `checkClaudeDone("${this._escPath(donePath)}")`,
                (result) => resolve(result === 'true')
            );
        });
    }

    /**
     * Lit un fichier texte via JSX
     * @param {string} filePath - Chemin du fichier
     * @returns {Promise<string>} Contenu
     */
    async readTextFileJSX(filePath) {
        return this._evalWithTimeout(`readTextFile("${this._escPath(filePath)}")`, 10000);
    }

    /**
     * Nettoie les fichiers temporaires Claude
     * @param {string} outputPath
     * @param {string} batPath
     * @param {string} vbsPath
     * @returns {Promise<string>}
     */
    async cleanupClaudeFiles(outputPath, batPath, vbsPath) {
        return this._evalWithTimeout(
            `cleanupClaudeFiles("${this._escPath(outputPath)}", "${this._escPath(batPath)}", "${this._escPath(vbsPath)}")`,
            5000
        );
    }

    /**
     * Tue les processus Claude CLI orphelins (en cas de timeout)
     * @returns {Promise<string>}
     */
    async killClaudeProcess() {
        return this._evalWithTimeout('killClaudeProcess()', 10000);
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

    /**
     * Vérifie si Claude CLI est authentifié
     * @returns {Promise<{authenticated: boolean, error?: string}>}
     */
    async checkClaudeAuth() {
        const result = await this._evalWithTimeout('checkClaudeAuth()', 15000);
        return JSON.parse(result);
    }
}

export default PremiereAsync;
