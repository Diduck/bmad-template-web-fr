import { SETUP } from '../utils/constants.js';
import ErrorHandler from '../utils/errorHandler.js';

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
            // Charger les resultats caches pour l'affichage settings
            this._loadCachedResults();
            return true;
        }

        this.loading.show(SETUP.MESSAGES.CHECKING);
        this.loading.setProgress(0, SETUP.MESSAGES.PYTHON_CHECK);

        const missingDeps = [];

        try {
            // Step 1 – Python
            const hasPython = await this._checkPython();
            this.loading.setProgress(20, SETUP.MESSAGES.PYTHON_CHECK);

            if (!hasPython) {
                missingDeps.push(SETUP.MESSAGES.PYTHON_MISSING);
            }

            // Step 2 – pip modules (seulement si Python est present)
            this.loading.setProgress(30, SETUP.MESSAGES.PIP_CHECK);

            if (hasPython) {
                const modulesToInstall = [];
                for (const mod of SETUP.PIP_MODULES) {
                    const installed = await this._checkPipModule(mod);
                    if (!installed) modulesToInstall.push(mod);
                }

                if (modulesToInstall.length > 0) {
                    const total = modulesToInstall.length;
                    for (let i = 0; i < total; i++) {
                        const mod = modulesToInstall[i];
                        const pct = 30 + Math.round(((i + 1) / total) * 25);
                        const detail = SETUP.MESSAGES.INSTALLING_MODULE(mod);

                        this.loading.setMessage(detail);
                        this.loading.setProgress(pct, detail);

                        const ok = await this._installModule(mod);
                        if (!ok) {
                            missingDeps.push(SETUP.MESSAGES.WHISPER_MISSING);
                        }
                    }
                }
            }

            // Step 3 – FFmpeg
            this.loading.setProgress(60, SETUP.MESSAGES.FFMPEG_CHECK);
            const hasFFmpeg = await this._checkFFmpeg();

            if (!hasFFmpeg) {
                missingDeps.push(SETUP.MESSAGES.FFMPEG_MISSING);
            }

            // Step 4 – CUDA (GPU) check + auto-install torch CUDA
            let hasCuda = false;
            const hasWhisper = hasPython && missingDeps.every(function (m) { return m !== SETUP.MESSAGES.WHISPER_MISSING; });

            if (hasPython && hasWhisper) {
                this.loading.setProgress(70, SETUP.MESSAGES.CUDA_CHECK);
                hasCuda = await this._checkCuda();

                if (!hasCuda && await this._hasNvidiaGpu()) {
                    this.loading.setProgress(75, SETUP.MESSAGES.CUDA_INSTALLING);
                    this.loading.setMessage(SETUP.MESSAGES.CUDA_INSTALLING);
                    hasCuda = await this._installTorchCuda();

                    if (hasCuda) {
                        this.notifications.success(SETUP.MESSAGES.CUDA_INSTALL_OK);
                    } else {
                        this.notifications.warning(SETUP.MESSAGES.CUDA_INSTALL_FAILED);
                    }
                }
            }

            this.loading.setProgress(95, '');

            // Store per-dependency results for external consumers (e.g. settings page)
            this.lastResults = {
                python: hasPython,
                whisper: hasWhisper,
                ffmpeg: hasFFmpeg,
                cuda: hasCuda
            };

            // Persister les resultats pour les prochains lancements
            this._saveCachedResults();

            // Resume des dependances manquantes
            if (missingDeps.length > 0) {
                const summary = 'Dépendances manquantes :\n' + missingDeps.join('\n');
                this.loading.setMessage(summary);
                this.loading.setProgress(100, summary);

                for (const msg of missingDeps) {
                    this.notifications.error(msg);
                }

                await this._wait(5000);
                this.loading.hide();
                this.loading.hideProgress();
                return false;
            }

            // Done — tout est OK
            this.loading.setMessage(SETUP.MESSAGES.READY);
            this.loading.setProgress(100, SETUP.MESSAGES.READY);

            localStorage.setItem(SETUP.STORAGE_KEY, Date.now().toString());

            await this._wait(800);
            this.loading.hide();
            this.loading.hideProgress();

            return true;

        } catch (err) {
            ErrorHandler.handle(err, 'SetupManager', 'Erreur lors de la vérification des dépendances');
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
        // Si l'import reussit, la sortie est vide. Verifier les patterns d'echec specifiques
        const lower = out.toLowerCase();
        return !lower.includes('no module named') && !lower.includes('modulenotfounderror') && !lower.includes('importerror');
    }

    async _installModule(moduleName) {
        await this.premiere.runSetupCommand(`${SETUP.PYTHON_CMD} -m pip install ${moduleName}`);
        // Verifier que le module s'importe apres installation
        return await this._checkPipModule(moduleName);
    }

    async _checkFFmpeg() {
        const binDir = this.extensionPath + '\\bin';
        return await this.premiere.checkFileInFolder(binDir, 'ffmpeg.exe');
    }

    async _hasNvidiaGpu() {
        try {
            const out = await this.premiere.runCommand('nvidia-smi --query-gpu=name --format=csv,noheader', 10000);
            return out.trim().length > 0 && !out.toLowerCase().includes('not recognized');
        } catch (e) {
            return false;
        }
    }

    async _checkCuda() {
        try {
            const out = await this.premiere.runCommand(
                `${SETUP.PYTHON_CMD} -c "import torch; print(torch.cuda.is_available())"`,
                30000
            );
            return out.trim().toLowerCase() === 'true';
        } catch (e) {
            return false;
        }
    }

    async _installTorchCuda() {
        try {
            await this.premiere.runCommand(
                `${SETUP.PYTHON_CMD} -m pip install torch torchvision torchaudio --index-url ${SETUP.TORCH_CUDA_INDEX}`,
                600000
            );
            // Verifier que CUDA fonctionne apres install
            return await this._checkCuda();
        } catch (e) {
            return false;
        }
    }

    _saveCachedResults() {
        try {
            localStorage.setItem(SETUP.RESULTS_KEY, JSON.stringify(this.lastResults));
        } catch (e) { /* ignore */ }
    }

    _loadCachedResults() {
        try {
            const raw = localStorage.getItem(SETUP.RESULTS_KEY);
            if (raw) {
                this.lastResults = JSON.parse(raw);
                return;
            }
        } catch (e) { /* ignore */ }
        // Fallback : pas de resultats caches, marquer tout OK (setup avait reussi)
        this.lastResults = { python: true, whisper: true, ffmpeg: true, cuda: false };
    }

    _wait(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}

export default SetupManager;
