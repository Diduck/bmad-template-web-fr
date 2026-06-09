import Component from './components/Component.js';
import ColorPicker from './components/ColorPicker.js';
import NotificationSystem from './components/NotificationSystem.js';
import loadingScreen from './components/LoadingScreen.js';
import SequenceSelector from './components/SequenceSelector.js';
import ClaudeAuthModal from './components/ClaudeAuthModal.js';
import PremiereAsync from './utils/premiereAsync.js';
import ErrorHandler from './utils/errorHandler.js';
import TitlesService from './services/titles.js';
import BrollsService from './services/brolls.js';
import SubtitlesService from './services/subtitles.js';
import SetupManager from './services/setup.js';
import ContextService from './services/context.js';
import MotionDesignService from './services/motiondesign.js';
import OpenAIClient from './api/openai.js';
import ClaudeClient from './api/claude.js';
import { COMPONENTS, PATHS, SEQUENCE, MESSAGES, SUCCESS, ERRORS, SUBTITLES, SELECTION_MODES, MOTION_DESIGN, AI_PROVIDERS } from './utils/constants.js';
import { safePayload, removeExtension } from './utils/helpers.js';

/**
 * Main application initialization
 */
document.addEventListener("DOMContentLoaded", async function () {
    // Initialize CSInterface
    const csInterface = new CSInterface();
    const jsxPath = csInterface.getSystemPath(SystemPath.EXTENSION) + "/src/jsx/Premiere.jsx";
    const normalizedPath = jsxPath.replace(/\\/g, "/");

    csInterface.evalScript(`$.evalFile("${normalizedPath}")`, function () {});

    // Check authentication
    const urlParams = new URLSearchParams(window.location.search);
    const isVerified = urlParams.get('verified') === 'true';

    // Always require verified=true parameter to access the app
    // This ensures verify.js validates the longpass before granting access
    if (!isVerified && window.location.pathname.endsWith("index.html")) {
        window.location.href = `auth.html`;
        return;
    }

    // Initialize global instances
    const premiereAsync = new PremiereAsync(csInterface);
    window.notifications = new NotificationSystem();
    window.ProductivityLoading = loadingScreen;

    // ── Setup: check & install dependencies on first launch ──
    const extensionRoot = csInterface.getSystemPath(SystemPath.EXTENSION);
    const setupManager = new SetupManager(loadingScreen, window.notifications, extensionRoot, premiereAsync);
    const setupOk = await setupManager.run();
    if (!setupOk) {
        console.warn('Setup incomplete – some features may not work');
    }

    // ── Console helpers for motion design debugging ──
    window.motionClear = async (sequenceName) => {
        if (!sequenceName) { console.error('Usage: motionClear("NomSequence")'); return; }
        const result = await premiereAsync.clearMotionDesignClips(sequenceName);
        if (result.error) { console.error('Erreur:', result.error); return; }
        console.log(`${result.removed} clips motion design supprimés de ${sequenceName}`);
        return result;
    };
    window.motionReimport = async (sequenceName) => {
        if (!sequenceName) { console.error('Usage: motionReimport("NomSequence")'); return; }
        const motionService = new MotionDesignService(premiereAsync, csInterface);
        const result = await motionService.reimportExistingMotions(sequenceName, {
            onSummary: (text) => console.log('[MOTION]', text)
        });
        console.log(`Re-import: ${result.succeeded}/${result.total} réussis`);
        if (result.errors.length > 0) console.table(result.errors);
        return result;
    };
    window.motionFix = async (sequenceName) => {
        if (!sequenceName) { console.error('Usage: motionFix("NomSequence")'); return; }
        console.log(`1/2 Nettoyage des clips motion de ${sequenceName}...`);
        await window.motionClear(sequenceName);
        console.log(`2/2 Re-import des .mov pour ${sequenceName}...`);
        await window.motionReimport(sequenceName);
        console.log('Done!');
    };

    // Phase labels for pipeline error messages
    const phaseLabels = { cuts: 'Découpe', subtitles: 'Sous-titres', titles: 'Titres', brolls: 'B-rolls', zoom: 'Zoom', motion: 'Motion Design' };

    // Initialize components
    const components = {
        [COMPONENTS.OPTION_AUDIO]: new Component(COMPONENTS.OPTION_AUDIO, false),
        [COMPONENTS.OPTION_CUT]: new Component(COMPONENTS.OPTION_CUT, false),
        [COMPONENTS.OPTION_ZOOM]: new Component(COMPONENTS.OPTION_ZOOM, false),
        [COMPONENTS.OPTION_FORMAT_PHONE]: new Component(COMPONENTS.OPTION_FORMAT_PHONE, false),
        [COMPONENTS.OPTION_FORMAT_SQUARE]: new Component(COMPONENTS.OPTION_FORMAT_SQUARE, false),
        [COMPONENTS.OPTION_FORMAT_PORTRAIT]: new Component(COMPONENTS.OPTION_FORMAT_PORTRAIT, false),
        [COMPONENTS.OPTION_FORMAT_HORIZONTAL]: new Component(COMPONENTS.OPTION_FORMAT_HORIZONTAL, false),
        [COMPONENTS.OPTION_BROLL]: new Component(COMPONENTS.OPTION_BROLL, false),
        [COMPONENTS.FORMAT_SELECTION]: new Component(COMPONENTS.FORMAT_SELECTION, "selectedFormatPhone"),
        [COMPONENTS.TEMPLATE_SELECTION]: new Component(COMPONENTS.TEMPLATE_SELECTION, "1"),
        [COMPONENTS.TITLE_COLOR_PICKER]: new ColorPicker(COMPONENTS.TITLE_COLOR_PICKER, "#ff4949ff"),
        [COMPONENTS.TOKEN_OPENAI]: new Component(COMPONENTS.TOKEN_OPENAI, "x"),
        [COMPONENTS.MARGE_CUTS]: new Component(COMPONENTS.MARGE_CUTS, 0.015),
        [COMPONENTS.LIMITE_CUTS]: new Component(COMPONENTS.LIMITE_CUTS, ""),
        [COMPONENTS.SUFFIX_AUDIO]: new Component(COMPONENTS.SUFFIX_AUDIO, "x"),
        [COMPONENTS.NEW_VERSION]: new Component(COMPONENTS.NEW_VERSION, "x"),
        [COMPONENTS.OPTION_SUBTITLES]: new Component(COMPONENTS.OPTION_SUBTITLES, false),
        [COMPONENTS.OPTION_TITLES]: new Component(COMPONENTS.OPTION_TITLES, false),
        [COMPONENTS.OPTION_PRESET_STYLE]: new Component(COMPONENTS.OPTION_PRESET_STYLE, "???"),
        [COMPONENTS.SUBTITLE_CHAR_LIMIT]: new Component(COMPONENTS.SUBTITLE_CHAR_LIMIT, SUBTITLES.DEFAULT_CHAR_LIMIT),
        [COMPONENTS.OPTION_MOTION]: new Component(COMPONENTS.OPTION_MOTION, false),
        [COMPONENTS.MOTION_COLOR_PICKER]: new ColorPicker(COMPONENTS.MOTION_COLOR_PICKER, MOTION_DESIGN.DEFAULT_COLOR),
        [COMPONENTS.AI_PROVIDER]: new Component(COMPONENTS.AI_PROVIDER, false)
    };

    // Make components globally accessible
    window.Components = components;

    // Initialize sequence selector (global popup dans le header)
    const sequenceSelector = new SequenceSelector('seqSelectorPopup');
    sequenceSelector.init();

    // Brancher le bouton toggle du sélecteur dans le header
    const seqToggleBtn = document.getElementById('seqSelectorToggle');
    if (seqToggleBtn) {
        seqToggleBtn.querySelector('.header-icon').addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            sequenceSelector.toggle();
        });
    }

    // Load sequences from Premiere at startup
    try {
        const sequences = await premiereAsync.getAllProjectSequences();
        sequenceSelector.loadSequences(sequences);
    } catch (error) {
        console.warn('Could not load sequences:', error);
        sequenceSelector.loadSequences([]);
    }

    // Reset SubtitleCharLimit to default
    document.getElementById('charLimitReset')?.addEventListener('click', () => {
        components[COMPONENTS.SUBTITLE_CHAR_LIMIT].setValue(SUBTITLES.DEFAULT_CHAR_LIMIT);
    });

    // Clear avatar target field
    document.getElementById('avatarClearBtn')?.addEventListener('click', () => {
        document.getElementById('BrollAvatarTarget').value = '';
    });

    // Load avatar presets from localStorage on page load
    loadAvatarPresets();

    /**
     * Get sequence list based on current selector mode
     * Returns Array<string> of sequence names, compatible with existing pipeline
     */
    async function getSequenceList() {
        const mode = sequenceSelector.getMode();
        if (mode === SELECTION_MODES.ACTIVE) {
            try {
                const sequences = await premiereAsync.getSelectedSequence("selectedSequence", false);
                if (!sequences || sequences.length === 0) {
                    window.notifications.error('Ouvre une s\u00e9quence dans Premiere d\'abord');
                    return [];
                }
                return sequences;
            } catch (error) {
                window.notifications.error('Ouvre une s\u00e9quence dans Premiere d\'abord');
                return [];
            }
        }
        const selected = sequenceSelector.getSelectedSequences();
        if (!selected || selected.length === 0) {
            window.notifications.error('Aucune s\u00e9quence s\u00e9lectionn\u00e9e');
            return [];
        }
        return selected;
    }

    // Set template video preview
    updateTemplatePreview(components[COMPONENTS.TEMPLATE_SELECTION].getValue());

    // Sync title color picker default color with stored template
    const initTemplateVal = components[COMPONENTS.TEMPLATE_SELECTION].getValue();
    if (initTemplateVal === "2") {
        components[COMPONENTS.TITLE_COLOR_PICKER].setDefaultColor("#FFA200ff");
    } else {
        components[COMPONENTS.TITLE_COLOR_PICKER].setDefaultColor("#ff4949ff");
    }

    // Listen to Premiere notifications
    csInterface.addEventListener("NOTIF", function(evt) {
        try {
            const payload = safePayload(evt.data);
            const type = (payload.type || "warning").toLowerCase();
            const msg = payload.message || "";

            if (type === "error") {
                notifications.error(msg);
            } else if (type === "success") {
                notifications.success(msg);
            } else {
                notifications.warning(msg);
            }
        } catch (error) {
            console.warn("NOTIF handler error:", error, evt && evt.data);
        }
    });

    // Listen to model download progress
    csInterface.addEventListener("MODEL_DOWNLOAD_PROGRESS", function(evt) {
        try {
            const payload = safePayload(evt.data);
            const percent = payload.percent || 0;

            if (payload.finished) {
                loadingScreen.hideProgress();
                loadingScreen.setMessage("Transcription en cours...");
                return;
            }

            if (!loadingScreen.isVisible()) {
                loadingScreen.show("Mise à jour du modèle de transcription");
            } else {
                loadingScreen.setMessage("Mise à jour du modèle de transcription");
            }
            loadingScreen.setProgress(percent, percent + "% téléchargé");
        } catch (error) {
            console.warn("MODEL_DOWNLOAD_PROGRESS handler error:", error);
        }
    });

    // Listen to step 2 progress events from JSX
    csInterface.addEventListener("STEP2_PROGRESS", function(evt) {
        try {
            const payload = safePayload(evt.data);
            const { phase, sequence, current, total } = payload;
            const percent = Math.round((current / total) * 100);
            const phaseLabel = phase === "titles" ? "Titres" : phase;
            loadingScreen.setProgress(percent, `${phaseLabel} ${sequence}: ${current}/${total}`);
        } catch (error) {
            console.warn("STEP2_PROGRESS handler error:", error);
        }
    });

    // ── AI Provider helpers ──

    /**
     * Returns true if the user has selected Claude Code as AI provider.
     */
    function isClaudeProvider() {
        const val = components[COMPONENTS.AI_PROVIDER].getValue();
        return val === true || val === 'true';
    }

    /**
     * Returns a pre-built AI client (OpenAIClient or ClaudeClient) based on the toggle.
     * Each call creates a new instance (no singleton).
     */
    function getAIClient() {
        if (isClaudeProvider()) {
            return new ClaudeClient(premiereAsync);
        }
        const apiKey = components[COMPONENTS.TOKEN_OPENAI].getValue();
        ErrorHandler.validateApiKey(apiKey);
        return new OpenAIClient(apiKey);
    }

    /**
     * Validates API key before AI-dependent operations.
     * Skips validation when Claude Code is selected (no API key needed).
     * @returns {boolean} true if valid or Claude selected, false otherwise
     */
    function validateApiKeyPreCheck() {
        const apiKey = components[COMPONENTS.TOKEN_OPENAI].getValue();
        try {
            ErrorHandler.validateApiKey(apiKey);
            return true;
        } catch (e) {
            window.notifications.error('Configure ta clé API OpenAI dans Paramètres');
            return false;
        }
    }

    // Event Handlers

    /**
     * Create workflow folders
     */
    async function handleCreateWorkflow() {
        loadingScreen.show(MESSAGES.CREATING_FOLDERS);
        try {
            await premiereAsync.createWorkflow();
            notifications.success(SUCCESS.FOLDERS_CREATED);
        } catch (error) {
            ErrorHandler.handle(error, 'handleCreateWorkflow');
        } finally {
            loadingScreen.hide();
        }
    }

    /**
     * Execute step 1: Create sequences
     */
    async function handleStep1Execute() {
        loadingScreen.show(MESSAGES.CREATING_SEQUENCES);
        try {
            const optionAudio = components[COMPONENTS.OPTION_AUDIO].getValue();
            const suffixAudio = components[COMPONENTS.SUFFIX_AUDIO].getValue();
            const selectedFormat = components[COMPONENTS.FORMAT_SELECTION].getValue();

            const result = await premiereAsync.executeStep1(
                optionAudio,
                suffixAudio,
                selectedFormat
            );

            if (result !== "Error") {
                notifications.success(SUCCESS.SEQUENCES_CREATED);
            }
        } catch (error) {
            ErrorHandler.handle(error, 'handleStep1Execute');
        } finally {
            loadingScreen.hide();
        }
    }

    // ── Pipeline State Tracking (Story 5.2) ──
    let pipelineState = null;
    let pipelineConfig = null;

    /**
     * Execute step 2: Process sequences
     */
    async function handleStep2Execute(analyzeCut = false) {
        // Pre-check: valider la clé API si une opération IA est sélectionnée (OpenAI uniquement)
        if (!isClaudeProvider()) {
            const optionTitlesPreCheck = components[COMPONENTS.OPTION_TITLES].getValue();
            const optionBrollPreCheck = components[COMPONENTS.OPTION_BROLL].getValue();
            const optionMotionPreCheck = components[COMPONENTS.OPTION_MOTION].getValue();
            const needsApiKey = optionTitlesPreCheck || optionBrollPreCheck || optionMotionPreCheck;

            if (needsApiKey && !validateApiKeyPreCheck()) {
                return;
            }
        }

        // Retry failed pipeline phases if previous execution had errors
        if (pipelineState && !analyzeCut) {
            const failedPhases = Object.entries(pipelineState)
                .filter(([_, v]) => v.status === 'error');
            if (failedPhases.length > 0) {
                await retryFailedPhases();
                return;
            }
        }

        loadingScreen.show(MESSAGES.LOADING_DEFAULT);
        try {
            const apiKey = components[COMPONENTS.TOKEN_OPENAI].getValue();
            const optionCut = components[COMPONENTS.OPTION_CUT].getValue();
            const optionSubtitles = components[COMPONENTS.OPTION_SUBTITLES].getValue();
            const optionTitles = components[COMPONENTS.OPTION_TITLES].getValue();
            const optionZoom = components[COMPONENTS.OPTION_ZOOM].getValue();
            const optionBroll = components[COMPONENTS.OPTION_BROLL].getValue();
            const optionMotion = components[COMPONENTS.OPTION_MOTION].getValue();
            const motionColor = components[COMPONENTS.MOTION_COLOR_PICKER].getValue();
            const suffixAudio = components[COMPONENTS.SUFFIX_AUDIO].getValue();
            const templateSelection = components[COMPONENTS.TEMPLATE_SELECTION].getValue();
            const titleColor = components[COMPONENTS.TITLE_COLOR_PICKER].getValue();
            const presetStyle = components[COMPONENTS.OPTION_PRESET_STYLE].getValue();
            const margeCuts = parseFloat(components[COMPONENTS.MARGE_CUTS].getValue());
            const limiteCutsRaw = parseFloat(components[COMPONENTS.LIMITE_CUTS].getValue());
            const limiteCuts = isNaN(limiteCutsRaw) ? null : limiteCutsRaw;
            const charLimit = Math.max(SUBTITLES.MIN_CHAR_LIMIT, Math.min(SUBTITLES.MAX_CHAR_LIMIT, parseInt(components[COMPONENTS.SUBTITLE_CHAR_LIMIT].getValue()) || SUBTITLES.DEFAULT_CHAR_LIMIT));

            // Initialize pipeline state tracking
            pipelineState = {
                cuts: { status: 'pending', error: null },
                subtitles: { status: 'pending', error: null },
                titles: { status: 'pending', error: null },
                brolls: { status: 'pending', error: null },
                zoom: { status: 'pending', error: null },
                motion: { status: 'pending', error: null }
            };

            // Get selected sequences via SequenceSelector
            let listSequences = [];
            if (optionSubtitles || optionTitles || optionCut || optionMotion) {
                listSequences = await getSequenceList();
                if (listSequences.length === 0) {
                    loadingScreen.hide();
                    return;
                }
            }

            // Store config for potential retry
            pipelineConfig = {
                apiKey, listSequences, optionCut, optionSubtitles, optionTitles,
                optionBroll, optionZoom, optionMotion, motionColor, suffixAudio,
                templateSelection, titleColor, presetStyle, margeCuts, limiteCuts, charLimit
            };

            // Phase 1: Generate transcriptions (already async)
            if (optionSubtitles || optionTitles) {
                try {
                    const subtitlesService = new SubtitlesService(premiereAsync, csInterface);
                    await subtitlesService.generateForFiles(
                        listSequences,
                        "SRT",
                        charLimit,
                        loadingScreen.setMessage.bind(loadingScreen)
                    );

                    if (optionTitles) {
                        try {
                            const titlesService = new TitlesService(premiereAsync, getAIClient());
                            await titlesService.generateForFiles(
                                listSequences,
                                loadingScreen.setMessage.bind(loadingScreen),
                                loadingScreen.setProgress.bind(loadingScreen)
                            );
                        } catch (error) {
                            pipelineState.titles = { status: 'error', error };
                            ErrorHandler.handleStructured(error, 'Génération des titres');
                        }
                    }
                } catch (error) {
                    pipelineState.subtitles = { status: 'error', error };
                    if (optionTitles) pipelineState.titles = { status: 'error', error };
                    ErrorHandler.handleStructured(error, 'Transcription');
                }
            }

            // Phase 2: Cut analysis (if requested)
            if (analyzeCut) {
                const outputs = [];
                for (let i = 0; i < listSequences.length; i++) {
                    const seq = listSequences[i];
                    const seqLabel = `${seq} (${i + 1}/${listSequences.length})`;
                    loadingScreen.setMessage(`${MESSAGES.ANALYZING_CUTS} ${seqLabel}`);
                    try {
                        const output = await premiereAsync.analyzeCutForSequence(
                            seq, suffixAudio, margeCuts, limiteCuts,
                            (message, percent) => {
                                loadingScreen.setMessage(`${message} ${seqLabel}`);
                                if (typeof percent === 'number') {
                                    loadingScreen.setProgress(percent, seqLabel);
                                }
                            }
                        );
                        outputs.push(output);
                    } catch (error) {
                        ErrorHandler.handle(error, 'analyzeCut', `Erreur analyse pour ${seq}`);
                    }
                }
                await displayCutAnalysis(JSON.stringify(outputs));
                return;
            }

            // Phase 3: Execute cuts
            if (optionCut) {
                try {
                    const projectPath = await premiereAsync.getProjectPath();
                    const cutData = await premiereAsync.readCutAnalysis(projectPath);
                    let cutsHadError = false;

                    if (cutData && Array.isArray(cutData)) {
                        for (let i = 0; i < cutData.length; i++) {
                            const item = cutData[i];
                            loadingScreen.setMessage(`${MESSAGES.CUTTING_SEQUENCE} : ${item.fileName} (${i + 1}/${cutData.length})`);
                            try {
                                await premiereAsync.executeCutForSequence(item.fileName, item.Value);
                            } catch (error) {
                                cutsHadError = true;
                                ErrorHandler.handleStructured(error, `Découpage ${item.fileName}`);
                            }
                        }
                    }
                    pipelineState.cuts.status = cutsHadError ? 'error' : 'success';
                } catch (error) {
                    pipelineState.cuts = { status: 'error', error };
                    ErrorHandler.handleStructured(error, 'Découpage des silences');
                }
            }

            // Phase 4: Import subtitles per sequence
            if (optionSubtitles && pipelineState.subtitles.status !== 'error') {
                let subtitlesHadError = false;
                for (let i = 0; i < listSequences.length; i++) {
                    const seq = listSequences[i];
                    loadingScreen.setMessage(`${MESSAGES.IMPORTING_SUBTITLES} : ${seq} (${i + 1}/${listSequences.length})`);
                    loadingScreen.hideProgress();
                    try {
                        await premiereAsync.createSubtitlesForSequence(seq, presetStyle);
                    } catch (error) {
                        subtitlesHadError = true;
                        ErrorHandler.handleStructured(error, `Import sous-titres ${seq}`);
                    }
                }
                if (pipelineState.subtitles.status !== 'error') {
                    pipelineState.subtitles.status = subtitlesHadError ? 'error' : 'success';
                }
            }

            // Phase 5: Import titles per sequence
            if (optionTitles && pipelineState.titles.status !== 'error') {
                let titlesHadError = false;
                for (let i = 0; i < listSequences.length; i++) {
                    const seq = listSequences[i];
                    loadingScreen.setMessage(`${MESSAGES.IMPORTING_TITLES} : ${seq} (${i + 1}/${listSequences.length})`);
                    loadingScreen.hideProgress();
                    try {
                        await premiereAsync.createTitlesForSequence(seq, templateSelection, titleColor);
                    } catch (error) {
                        titlesHadError = true;
                        ErrorHandler.handleStructured(error, `Import titres ${seq}`);
                    }
                }
                if (pipelineState.titles.status !== 'error') {
                    pipelineState.titles.status = titlesHadError ? 'error' : 'success';
                }
            }

            // Phase 6: B-rolls
            if (optionBroll) {
                try {
                    loadingScreen.setMessage(MESSAGES.CREATING_BROLLS);
                    loadingScreen.hideProgress();
                    await handleCreateBrolls();
                    pipelineState.brolls.status = 'success';
                } catch (error) {
                    pipelineState.brolls = { status: 'error', error };
                    ErrorHandler.handleStructured(error, 'Création des B-rolls');
                }
            }

            // Phase 7: Zoom
            if (optionZoom) {
                try {
                    loadingScreen.hideProgress();
                    const zoomSequences = listSequences.length > 0 ? listSequences : await getSequenceList();
                    for (const seq of zoomSequences) {
                        loadingScreen.setMessage('Création des zooms pour ' + seq);
                        await premiereAsync.createZoom(seq);
                    }
                    pipelineState.zoom.status = 'success';
                } catch (error) {
                    pipelineState.zoom = { status: 'error', error };
                    ErrorHandler.handleStructured(error, 'Création des zooms');
                }
            }

            // Phase 8: Motion Design
            if (optionMotion) {
                try {
                    loadingScreen.hideProgress();
                    const motionService = new MotionDesignService(premiereAsync, csInterface);
                    const motionAIClient = getAIClient();
                    const subtitlesServiceMotion = new SubtitlesService(premiereAsync, csInterface);
                    const motionSequences = listSequences.length > 0 ? listSequences : await getSequenceList();

                    for (const seq of motionSequences) {
                        // Check if this sequence already has motion designs on the timeline (V8+)
                        const clearCheck = await premiereAsync.clearMotionDesignClips(seq);
                        // clearCheck.removed > 0 means there were already clips — don't skip,
                        // but we cleared them so we can re-import or re-generate cleanly

                        // Try re-import from vault first (already generated .mov files for THIS sequence)
                        const safeSeqName = seq.replace(/[^a-zA-Z0-9_-]/g, '_');
                        const seqPrefix = `motion_${safeSeqName}_`;
                        let needsGeneration = true;
                        try {
                            const projectFolderPath = await premiereAsync.getProjectFolderPath();
                            const vaultDir = projectFolderPath + '03_Vault\\motion-design';
                            const existingFiles = await premiereAsync.listDir(vaultDir);
                            const seqFiles = existingFiles.filter(f => f.startsWith(seqPrefix) && f.endsWith('.mov'));
                            if (seqFiles.length > 0) {
                                loadingScreen.setMessage(`Re-import de ${seqFiles.length} motion designs existants pour ${seq}...`);
                                const reimportResult = await motionService.reimportExistingMotions(seq, {
                                    onSummary: (text) => loadingScreen.setMessage(text)
                                });
                                if (reimportResult.succeeded > 0) {
                                    needsGeneration = false;
                                    window.notifications.success(`${reimportResult.succeeded} motion designs re-importés pour ${seq}`);
                                }
                            }
                        } catch (e) {
                            console.log('[MOTION] Pas de vault existant, génération complète:', e.message);
                        }

                        if (needsGeneration) {
                            loadingScreen.setMessage(`${MESSAGES.DETECTING_MOTION} ${seq}`);
                            await motionService.executeMotionBatch(seq, motionColor, motionAIClient, subtitlesServiceMotion, {
                                onBatchStart: (items, onRemove) => loadingScreen.showBatch(items, onRemove),
                                onItemUpdate: (id, data) => loadingScreen.updateBatchItem(id, data),
                                onSummary: (text) => loadingScreen.setBatchSummary(text),
                                onSkipSetup: (skipFn) => loadingScreen.onBatchSkip(skipFn)
                            });
                        }
                    }
                    pipelineState.motion.status = 'success';
                } catch (error) {
                    // Kill any orphaned Claude processes
                    try { await premiereAsync.killClaudeProcess(); } catch (e) { /* ignore */ }
                    pipelineState.motion = { status: 'error', error };
                    ErrorHandler.handleStructured(error, 'Motion Design batch');
                }
            }

            // Pipeline summary
            const failedPhases = Object.entries(pipelineState)
                .filter(([_, v]) => v.status === 'error');

            if (failedPhases.length > 0) {
                const phaseNames = failedPhases.map(([k]) => phaseLabels[k] || k).join(', ');
                window.notifications.error(
                    `${failedPhases.length} phase(s) en erreur : ${phaseNames}. Corrige et relance le pipeline.`
                );
            } else {
                pipelineState = null;
                pipelineConfig = null;
                notifications.success(SUCCESS.EXECUTION_SUCCESS);
            }

        } catch (error) {
            ErrorHandler.handle(error, 'handleStep2Execute');
        } finally {
            loadingScreen.hideProgress();
            loadingScreen.hide();
        }
    }

    /**
     * Retry only the failed pipeline phases using stored config
     */
    async function retryFailedPhases() {
        if (!pipelineState || !pipelineConfig) return;

        const { apiKey, listSequences, optionCut, optionSubtitles, optionTitles,
            optionBroll, optionZoom, optionMotion, motionColor, templateSelection,
            titleColor, presetStyle, charLimit } = pipelineConfig;

        // Pre-check: valider la clé API si des phases IA sont en erreur (OpenAI uniquement)
        if (!isClaudeProvider()) {
            const needsApiForRetry =
                (pipelineState.titles.status === 'error' && optionTitles) ||
                (pipelineState.brolls.status === 'error' && optionBroll) ||
                (pipelineState.motion.status === 'error' && optionMotion);
            if (needsApiForRetry && !validateApiKeyPreCheck()) {
                return;
            }
        }

        loadingScreen.show('Relance des phases échouées...');

        try {
            // Retry subtitles if failed
            if (pipelineState.subtitles.status === 'error' && optionSubtitles) {
                try {
                    const subtitlesService = new SubtitlesService(premiereAsync, csInterface);
                    await subtitlesService.generateForFiles(listSequences, "SRT", charLimit, loadingScreen.setMessage.bind(loadingScreen));
                    for (let i = 0; i < listSequences.length; i++) {
                        const seq = listSequences[i];
                        loadingScreen.setMessage(`${MESSAGES.IMPORTING_SUBTITLES} : ${seq} (${i + 1}/${listSequences.length})`);
                        await premiereAsync.createSubtitlesForSequence(seq, presetStyle);
                    }
                    pipelineState.subtitles = { status: 'success', error: null };
                } catch (error) {
                    pipelineState.subtitles = { status: 'error', error };
                    ErrorHandler.handleStructured(error, 'Relance sous-titres');
                }
            }

            // Retry titles if failed
            if (pipelineState.titles.status === 'error' && optionTitles) {
                try {
                    const titlesService = new TitlesService(premiereAsync, getAIClient());
                    await titlesService.generateForFiles(listSequences, loadingScreen.setMessage.bind(loadingScreen), loadingScreen.setProgress.bind(loadingScreen));
                    for (let i = 0; i < listSequences.length; i++) {
                        const seq = listSequences[i];
                        loadingScreen.setMessage(`${MESSAGES.IMPORTING_TITLES} : ${seq} (${i + 1}/${listSequences.length})`);
                        await premiereAsync.createTitlesForSequence(seq, templateSelection, titleColor);
                    }
                    pipelineState.titles = { status: 'success', error: null };
                } catch (error) {
                    pipelineState.titles = { status: 'error', error };
                    ErrorHandler.handleStructured(error, 'Relance titres');
                }
            }

            // Retry cuts if failed (per-sequence error handling like main pipeline)
            if (pipelineState.cuts.status === 'error' && optionCut) {
                try {
                    const projectPath = await premiereAsync.getProjectPath();
                    const cutData = await premiereAsync.readCutAnalysis(projectPath);
                    let cutsHadError = false;
                    if (cutData && Array.isArray(cutData)) {
                        for (let i = 0; i < cutData.length; i++) {
                            const item = cutData[i];
                            loadingScreen.setMessage(`${MESSAGES.CUTTING_SEQUENCE} : ${item.fileName} (${i + 1}/${cutData.length})`);
                            try {
                                await premiereAsync.executeCutForSequence(item.fileName, item.Value);
                            } catch (error) {
                                cutsHadError = true;
                                ErrorHandler.handleStructured(error, `Relance découpage ${item.fileName}`);
                            }
                        }
                    }
                    pipelineState.cuts.status = cutsHadError ? 'error' : 'success';
                } catch (error) {
                    pipelineState.cuts = { status: 'error', error };
                    ErrorHandler.handleStructured(error, 'Relance découpage');
                }
            }

            // Retry brolls if failed (uses stored sequences for consistency)
            if (pipelineState.brolls.status === 'error' && optionBroll) {
                try {
                    loadingScreen.setMessage(MESSAGES.CREATING_BROLLS);
                    const brollSequences = listSequences.length > 0 ? listSequences : await getSequenceList();
                    const subtitlesService = new SubtitlesService(premiereAsync, csInterface);
                    const avatarTarget = document.getElementById('BrollAvatarTarget')?.value?.trim() || '';

                    let contextService = null;
                    if (!avatarTarget) {
                        contextService = new ContextService(premiereAsync, getAIClient());
                    }

                    const brollsService = new BrollsService(premiereAsync, getAIClient(), subtitlesService, avatarTarget, contextService);
                    await brollsService.createForFiles(brollSequences, loadingScreen.setMessage.bind(loadingScreen), loadingScreen.setProgress.bind(loadingScreen));
                    pipelineState.brolls = { status: 'success', error: null };
                } catch (error) {
                    pipelineState.brolls = { status: 'error', error };
                    ErrorHandler.handleStructured(error, 'Relance B-rolls');
                }
            }

            // Retry zoom if failed
            if (pipelineState.zoom.status === 'error' && optionZoom) {
                try {
                    const zoomSequences = listSequences.length > 0 ? listSequences : await getSequenceList();
                    for (const seq of zoomSequences) {
                        loadingScreen.setMessage('Création des zooms pour ' + seq);
                        await premiereAsync.createZoom(seq);
                    }
                    pipelineState.zoom = { status: 'success', error: null };
                } catch (error) {
                    pipelineState.zoom = { status: 'error', error };
                    ErrorHandler.handleStructured(error, 'Relance zooms');
                }
            }

            // Retry motion if failed
            if (pipelineState.motion.status === 'error' && optionMotion) {
                try {
                    loadingScreen.setMessage(MESSAGES.DETECTING_MOTION);
                    const motionService = new MotionDesignService(premiereAsync, csInterface);
                    const motionAIClient = getAIClient();
                    const subtitlesServiceMotion = new SubtitlesService(premiereAsync, csInterface);
                    const motionSequences = listSequences.length > 0 ? listSequences : await getSequenceList();

                    for (const seq of motionSequences) {
                        // Clear existing motion clips to avoid duplicates
                        await premiereAsync.clearMotionDesignClips(seq);

                        // Try re-import first
                        const safeSeqName = seq.replace(/[^a-zA-Z0-9_-]/g, '_');
                        const seqPrefix = `motion_${safeSeqName}_`;
                        let needsGeneration = true;
                        try {
                            const projectFolderPath = await premiereAsync.getProjectFolderPath();
                            const vaultDir = projectFolderPath + '03_Vault\\motion-design';
                            const existingFiles = await premiereAsync.listDir(vaultDir);
                            const seqFiles = existingFiles.filter(f => f.startsWith(seqPrefix) && f.endsWith('.mov'));
                            if (seqFiles.length > 0) {
                                const reimportResult = await motionService.reimportExistingMotions(seq, {
                                    onSummary: (text) => loadingScreen.setMessage(text)
                                });
                                if (reimportResult.succeeded > 0) needsGeneration = false;
                            }
                        } catch (e) { /* vault doesn't exist yet */ }

                        if (needsGeneration) {
                            await motionService.executeMotionBatch(seq, motionColor, motionAIClient, subtitlesServiceMotion, {
                                onBatchStart: (items, onRemove) => loadingScreen.showBatch(items, onRemove),
                                onItemUpdate: (id, data) => loadingScreen.updateBatchItem(id, data),
                                onSummary: (text) => loadingScreen.setBatchSummary(text),
                                onSkipSetup: (skipFn) => loadingScreen.onBatchSkip(skipFn)
                            });
                        }
                    }
                    pipelineState.motion = { status: 'success', error: null };
                } catch (error) {
                    pipelineState.motion = { status: 'error', error };
                    ErrorHandler.handleStructured(error, 'Relance Motion Design');
                }
            }

            // Check result
            const stillFailed = Object.entries(pipelineState)
                .filter(([_, v]) => v.status === 'error');

            if (stillFailed.length > 0) {
                const names = stillFailed.map(([k]) => phaseLabels[k] || k).join(', ');
                window.notifications.error(`${stillFailed.length} phase(s) toujours en erreur : ${names}`);
            } else {
                pipelineState = null;
                pipelineConfig = null;
                notifications.success(SUCCESS.EXECUTION_SUCCESS);
            }
        } finally {
            loadingScreen.hideProgress();
            loadingScreen.hide();
        }
    }

    /**
     * Load avatar presets from localStorage and display as clickable pills
     */
    function loadAvatarPresets() {
        const container = document.getElementById('avatarPresets');
        if (!container) return;
        let presets;
        try {
            presets = JSON.parse(localStorage.getItem('broll_avatar_presets') || '[]');
        } catch (e) {
            presets = [];
            localStorage.removeItem('broll_avatar_presets');
        }
        container.innerHTML = '';
        presets.forEach(text => {
            const pill = document.createElement('button');
            pill.type = 'button';
            pill.className = 'avatar-preset-pill';
            pill.textContent = text.length > 30 ? text.substring(0, 30) + '...' : text;
            pill.title = text;
            pill.addEventListener('click', () => {
                document.getElementById('BrollAvatarTarget').value = text;
            });
            container.appendChild(pill);
        });
    }

    /**
     * Create B-rolls for selected sequences
     */
    async function handleCreateBrolls() {
        // Read avatar target and update FIFO presets
        const avatarTarget = document.getElementById('BrollAvatarTarget')?.value?.trim() || '';
        if (avatarTarget) {
            let presets;
            try {
                presets = JSON.parse(localStorage.getItem('broll_avatar_presets') || '[]');
            } catch (e) {
                presets = [];
            }
            presets = presets.filter(p => p !== avatarTarget);
            presets.unshift(avatarTarget);
            if (presets.length > 3) presets.pop();
            localStorage.setItem('broll_avatar_presets', JSON.stringify(presets));
            loadAvatarPresets();
        }

        const listSequences = await getSequenceList();

        const subtitlesService = new SubtitlesService(premiereAsync, csInterface);

        // Create ContextService if no manual avatar
        let contextService = null;
        if (!avatarTarget) {
            contextService = new ContextService(premiereAsync, getAIClient());
        }

        const brollsService = new BrollsService(premiereAsync, getAIClient(), subtitlesService, avatarTarget, contextService);
        await brollsService.createForFiles(
            listSequences,
            loadingScreen.setMessage.bind(loadingScreen),
            loadingScreen.setProgress.bind(loadingScreen)
        );
    }

    /**
     * Display cut analysis results
     */
    async function displayCutAnalysis(resultJson) {
        loadingScreen.setMessage("Affichage de l'analyse...");

        const contentAllWav = document.getElementById("wavContent");
        const button = document.getElementById("AnalyseCut");

        if (!contentAllWav || !button) return;

        contentAllWav.innerHTML = "";
        button.innerHTML = "Analyser";

        try {
            const resultParsed = JSON.parse(resultJson);
            const projectPath = await premiereAsync.getProjectPath();

            // Déterminer le seuil effectif par séquence (auto ou manuel)
            const manualThreshold = parseFloat(components[COMPONENTS.LIMITE_CUTS].getValue());

            for (const item of resultParsed) {
                const effectiveThreshold = (item.autoThreshold !== null && item.autoThreshold !== undefined)
                    ? item.autoThreshold
                    : manualThreshold;
                await displayWaveform(item, contentAllWav, effectiveThreshold);
            }

            // Save analysis
            await premiereAsync.writeFile(
                `${projectPath}07_Audio\\CutZoneList.json`,
                JSON.stringify(resultParsed)
            );

            notifications.success("Analyse terminée");
        } catch (error) {
            ErrorHandler.handle(error, 'displayCutAnalysis');
        }
    }

    /**
     * Display waveform for a file
     */
    async function displayWaveform(data, container, threshold) {
        const { Message, fileName, AllValueWav, duration } = data;

        if (Message !== "Analyse réussie") {
            const errorDiv = document.createElement("div");
            errorDiv.className = "wav";
            errorDiv.setAttribute("file", fileName);
            errorDiv.innerHTML = `
                <div class="info-wav">
                    <p>${fileName}</p>
                    <p>${Message}</p>
                    <img src="../../assets/images/cross.png" alt="" class="remove-wav" file="${fileName}">
                </div>
            `;
            container.appendChild(errorDiv);
            return;
        }

        const safeFile = String(fileName).replace(/\s+/g, "_").replace(/[^\w-]/g, "");
        const len = Array.isArray(AllValueWav) ? AllValueWav.length : 0;
        const widthBar = len ? (100 / len) : 0;

        const thresholdLabel = (threshold !== undefined && threshold !== null && !isNaN(threshold))
            ? `<span class="auto-threshold-label">${Math.round(threshold * 10) / 10} dB</span>`
            : "";

        const wrapper = document.createElement("div");
        wrapper.className = "wav";
        wrapper.setAttribute("file", fileName);
        wrapper.innerHTML = `
            <div class="info-wav">
                <div>
                    <p>${fileName}</p>
                    <p class="time">${duration.hour}h${duration.minute}min${duration.second}s</p>
                </div>
                ${thresholdLabel}
                <img src="../../assets/images/cross.png" alt="" class="remove-wav" file="${fileName}">
            </div>
            <div class="wav-graph">
                <div class="wavegraph-container wavegraph-container-${safeFile}" file="${fileName}"></div>
            </div>
        `;

        const graph = wrapper.querySelector(`.wavegraph-container-${safeFile}`);
        if (len && graph) {
            const bars = [];
            for (let i = 0; i < len; i++) {
                const v = AllValueWav[i];
                const heightPct = Math.max(0, Math.min(200, (v.debit + 100)));
                const isOk = v.debit >= threshold;
                bars.push(`
                    <div class="content-bar"
                        data-file="${fileName}"
                        data-time="${v.time}"
                        style="height:100%;width:${widthBar}%${isOk ? "" : ";background-color:rgb(255,0,0)"};min-width:1px">
                        <div class="bar"
                            data-time="${v.time}"
                            data-file="${fileName}"
                            debit="${v.debit}"
                            style="height:${heightPct}%;width:100%"></div>
                    </div>
                `);
            }
            graph.innerHTML = bars.join("");
        }

        container.appendChild(wrapper);
    }

    /**
     * Update template preview video
     */
    function updateTemplatePreview(templateId) {
        const imgTemplate = document.querySelector(".imgTemplate");
        if (imgTemplate) {
            imgTemplate.innerHTML = `
                <video autoplay loop muted playsinline>
                    <source src="../../assets/templates/titles/previews/template-${templateId}.mp4" type="video/mp4">
                </video>
            `;
        }
    }

    /**
     * Remove waveform from display
     */
    async function removeWav(fileName) {
        const contentAllWav = document.getElementById("wavContent");
        if (!contentAllWav) return;

        const wav = contentAllWav.querySelector(`.wav[file="${fileName}"]`);
        if (wav) {
            wav.remove();

            try {
                const projectPath = await premiereAsync.getProjectPath();
                const listPath = `${projectPath}07_Audio\\CutZoneList.json`;
                const content = await premiereAsync.readFile(listPath);
                const resultParsed = JSON.parse(content);

                const filtered = resultParsed.filter(item => item.fileName !== fileName);
                await premiereAsync.writeFile(listPath, JSON.stringify(filtered));
            } catch (error) {
                ErrorHandler.handle(error, 'removeWav');
            }
        }
    }

    // Event Listeners

    // Form changes
    document.addEventListener("change", function (event) {
        const target = event.target;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") {
            const inputId = target.id;
            if (inputId && components[inputId]) {
                if (target.classList.contains("checkbox")) {
                    components[inputId].setValue(target.checked);
                } else {
                    components[inputId].setValue(target.value);
                }

                // Handle template selection change
                if (inputId === COMPONENTS.TEMPLATE_SELECTION) {
                    updateTemplatePreview(components[inputId].getValue());

                    // Basculer la couleur par défaut du color picker selon le template
                    const colorPicker = components[COMPONENTS.TITLE_COLOR_PICKER];
                    const templateVal = components[inputId].getValue();
                    if (templateVal === "2") {
                        colorPicker.setDefaultColor("#FFA200ff");
                    } else {
                        colorPicker.setDefaultColor("#ff4949ff");
                    }
                }

                // Clear pipeline retry state when user changes options (allows fresh pipeline start)
                if (pipelineState) {
                    pipelineState = null;
                    pipelineConfig = null;
                }
            }
        }
    });

    // Button clicks
    document.addEventListener("click", async function (event) {
        const target = event.target;
        const targetId = target.id;
        const targetClass = target.classList[0];

        if (target.tagName === "BUTTON" || target.tagName === "IMG" ||
            (target.tagName === "DIV" && (targetClass === "bar" || targetClass === "content-bar"))) {

            // Don't block navigation for images inside links (e.g. settings icon)
            if (target.tagName === "IMG" && target.closest('a[href]')) {
                return;
            }

            event.preventDefault();

            switch (targetId) {
                case "workflow":
                    await handleCreateWorkflow();
                    break;

                case "STEP1_EXECUTE":
                    await handleStep1Execute();
                    break;

                case "STEP2_EXECUTE":
                    await handleStep2Execute(false);
                    break;

                case "AnalyseCut":
                    await handleStep2Execute(true);
                    break;

                case "AddTitleHere":
                    target.disabled = true;
                    loadingScreen.show(MESSAGES.ADDING_TITLE_HERE);
                    try {
                        const templateSel = components[COMPONENTS.TEMPLATE_SELECTION].getValue();
                        const titleCol = components[COMPONENTS.TITLE_COLOR_PICKER].getValue();
                        const startBound = (document.getElementById('TitleBoundStart') || {}).value || '';
                        const endBound = (document.getElementById('TitleBoundEnd') || {}).value || '';
                        const titlesServiceHere = new TitlesService(premiereAsync, getAIClient());
                        await titlesServiceHere.addTitleAtCursor(templateSel, titleCol, startBound.trim(), endBound.trim(), loadingScreen);
                    } catch (error) {
                        ErrorHandler.handle(error, 'AddTitleHere', 'Erreur ajout titre ponctuel');
                    } finally {
                        loadingScreen.hide();
                        target.disabled = false;
                    }
                    break;

                case "AddMotionHere":
                    target.disabled = true;
                    loadingScreen.show(MESSAGES.ADDING_MOTION_HERE);
                    try {
                        const motionColor = components[COMPONENTS.MOTION_COLOR_PICKER].getValue();
                        const motionService = new MotionDesignService(premiereAsync, csInterface);
                        await motionService.addMotionAtCursor(motionColor, {
                            setMessage: loadingScreen.setMessage.bind(loadingScreen),
                            setProgress: loadingScreen.setProgress.bind(loadingScreen),
                            setStep: loadingScreen.setStep.bind(loadingScreen),
                            hideProgress: loadingScreen.hideProgress.bind(loadingScreen)
                        });
                    } catch (error) {
                        ErrorHandler.handle(error, 'AddMotionHere', 'Erreur ajout motion design');
                    } finally {
                        loadingScreen.hide();
                        target.disabled = false;
                    }
                    break;

                case "AssemblyButton":
                    loadingScreen.show(MESSAGES.ASSEMBLING);
                    try {
                        await csInterface.evalScript(
                            `STEP4_EXECUTE(${components[COMPONENTS.OPTION_FORMAT_PHONE].getValue()}, ` +
                            `${components[COMPONENTS.OPTION_FORMAT_HORIZONTAL].getValue()}, ` +
                            `${components[COMPONENTS.OPTION_FORMAT_SQUARE].getValue()}, ` +
                            `${components[COMPONENTS.OPTION_FORMAT_PORTRAIT].getValue()})`,
                            function () {}
                        );
                    } catch (error) {
                        ErrorHandler.handle(error, 'AssemblyButton');
                    } finally {
                        loadingScreen.hide();
                    }
                    break;
            }

            // Handle waveform clicks
            if (targetClass === "remove-wav") {
                const fileName = target.getAttribute("file");
                await removeWav(fileName);
            } else if (targetClass === "content-bar" || targetClass === "bar") {
                const bar = target.closest('.content-bar');
                if (bar) {
                    const file = bar.dataset.file;
                    const time = bar.dataset.time;
                    await premiereAsync.goToTime(parseFloat(time), file);
                }
            }
        }
    });
});
