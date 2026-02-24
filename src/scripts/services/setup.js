import { SETUP } from '../utils/constants.js';

/**
 * Manages dependency checking and installation on first launch.
 * Uses JSX (Premiere.jsx) for shell commands and file checks.
 */
class SetupManager {
    /**
     * @param {object} loadingScreen - LoadingScreen instance
     * @param {object} notifications - NotificationSystem instance
     * @param {string} extensionPath - Root path of the CEP extension
     * @param {object} premiereAsync - PremiereAsync instance for JSX calls
     */
    constructor(loadingScreen, notifications, extensionPath, premiereAsync) {
        this.loading = loadingScreen;
        this.notifications = notifications;
        this.extensionPath = extensionPath;
        this.premiere = premiereAsync;
    }

    // ── public API ──────────────────────────────────────────

    /**
     * Run the full setup check. Resolves `true` if everything is OK,
     * `false` if a critical dependency is missing and could not be installed.
     * @param {boolean} force - Skip the localStorage cache and re-check
     * @returns {Promise<boolean>}
     */
    async run(force = false) {
        if (!force && localStorage.getItem(SETUP.STORAGE_KEY)) {
            return true;
        }

        this.loading.show(SETUP.MESSAGES.CHECKING);
        this.loading.setProgress(0, SETUP.MESSAGES.PYTHON_CHECK);

        try {
            // Step 1 – Python
            const hasPython = await this._checkPython();
            this.loading.setProgress(20, SETUP.MESSAGES.PYTHON_CHECK);

            if (!hasPython) {
                this.loading.setMessage(SETUP.MESSAGES.PYTHON_MISSING);
                this.loading.setProgress(100, SETUP.MESSAGES.PYTHON_MISSING);
                this.notifications.error(SETUP.MESSAGES.PYTHON_MISSING);
                await this._wait(4000);
                this.loading.hide();
                this.loading.hideProgress();
                return false;
            }

            // Step 2 – pip modules
            this.loading.setProgress(30, SETUP.MESSAGES.PIP_CHECK);

            const modulesToInstall = [];
            for (const mod of SETUP.PIP_MODULES) {
                const installed = await this._checkPipModule(mod);
                if (!installed) modulesToInstall.push(mod);
            }

            if (modulesToInstall.length > 0) {
                const total = modulesToInstall.length;
                for (let i = 0; i < total; i++) {
                    const mod = modulesToInstall[i];
                    const pct = 30 + Math.round(((i + 1) / total) * 50);
                    const detail = SETUP.MESSAGES.INSTALLING_MODULE(mod);

                    this.loading.setMessage(detail);
                    this.loading.setProgress(pct, detail);

                    const ok = await this._installModule(mod);
                    if (!ok) {
                        const errMsg = SETUP.MESSAGES.INSTALL_FAILED(mod);
                        this.loading.setMessage(errMsg);
                        this.loading.setProgress(100, errMsg);
                        this.notifications.error(errMsg);
                        await this._wait(4000);
                        this.loading.hide();
                        this.loading.hideProgress();
                        return false;
                    }
                }
            }

            // Step 3 – FFmpeg
            this.loading.setProgress(85, SETUP.MESSAGES.FFMPEG_CHECK);
            const hasFFmpeg = await this._checkFFmpeg();

            if (!hasFFmpeg) {
                this.loading.setMessage(SETUP.MESSAGES.FFMPEG_MISSING);
                this.loading.setProgress(100, SETUP.MESSAGES.FFMPEG_MISSING);
                this.notifications.warning(SETUP.MESSAGES.FFMPEG_MISSING);
                await this._wait(3000);
            }

            // Done
            this.loading.setMessage(SETUP.MESSAGES.READY);
            this.loading.setProgress(100, SETUP.MESSAGES.READY);

            localStorage.setItem(SETUP.STORAGE_KEY, Date.now().toString());

            await this._wait(800);
            this.loading.hide();
            this.loading.hideProgress();

            return true;

        } catch (err) {
            console.error('[SetupManager]', err);
            this.loading.hide();
            this.loading.hideProgress();
            return false;
        }
    }

    // ── private helpers ─────────────────────────────────────

    async _checkPython() {
        const out = await this.premiere.runSetupCommand(`${SETUP.PYTHON_CMD} --version`);
        return /python\s+3/i.test(out);
    }

    async _checkPipModule(moduleName) {
        const importName = moduleName === 'openai-whisper' ? 'whisper' : moduleName;
        const out = await this.premiere.runSetupCommand(`${SETUP.PYTHON_CMD} -c "import ${importName}"`);
        // Si l'import reussit, la sortie est vide ou sans erreur
        return !out.toLowerCase().includes('error') && !out.toLowerCase().includes('no module');
    }

    async _installModule(moduleName) {
        const out = await this.premiere.runSetupCommand(`${SETUP.PYTHON_CMD} -m pip install ${moduleName}`);
        return !out.toLowerCase().includes('error');
    }

    async _checkFFmpeg() {
        const binDir = this.extensionPath + '\\bin';
        return await this.premiere.checkFileInFolder(binDir, 'ffmpeg.exe');
    }

    _wait(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}

export default SetupManager;
