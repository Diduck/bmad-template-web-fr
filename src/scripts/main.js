import Component from './components/Component.js';
import ColorPicker from './components/ColorPicker.js';
import NotificationSystem from './components/NotificationSystem.js';
import loadingScreen from './components/LoadingScreen.js';
import PremiereAsync from './utils/premiereAsync.js';
import ErrorHandler from './utils/errorHandler.js';
import TitlesService from './services/titles.js';
import BrollsService from './services/brolls.js';
import SubtitlesService from './services/subtitles.js';
import SetupManager from './services/setup.js';
import { COMPONENTS, PATHS, SEQUENCE, MESSAGES, SUCCESS, ERRORS } from './utils/constants.js';
import { safePayload, removeExtension } from './utils/helpers.js';

/**
 * Main application initialization
 */
document.addEventListener("DOMContentLoaded", async function () {
    console.log("DOM fully loaded and parsed");

    // Initialize CSInterface
    const csInterface = new CSInterface();
    const jsxPath = csInterface.getSystemPath(SystemPath.EXTENSION) + "/src/jsx/Premiere.jsx";
    const normalizedPath = jsxPath.replace(/\\/g, "/");

    csInterface.evalScript(`$.evalFile("${normalizedPath}")`, function (result) {
        console.log(result);
    });

    // Check authentication
    const urlParams = new URLSearchParams(window.location.search);
    const isVerified = urlParams.get('verified') === 'true';

    // Debug logs
    console.log('=== AUTH DEBUG ===');
    console.log('Current pathname:', window.location.pathname);
    console.log('Current search:', window.location.search);
    console.log('isVerified:', isVerified);
    console.log('Ends with index.html:', window.location.pathname.endsWith("index.html"));

    // Always require verified=true parameter to access the app
    // This ensures verify.js validates the longpass before granting access
    if (!isVerified && window.location.pathname.endsWith("index.html")) {
        console.log('Redirecting to auth.html...');
        window.location.href = `auth.html`;
        return;
    }

    console.log('Authentication passed!');

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

    // Initialize components
    const components = {
        [COMPONENTS.OPTION_AUDIO]: new Component(COMPONENTS.OPTION_AUDIO, false),
        [COMPONENTS.OPTION_CUT]: new Component(COMPONENTS.OPTION_CUT, false),
        [COMPONENTS.OPTION_ZOOM]: new Component(COMPONENTS.OPTION_ZOOM, false),
        [COMPONENTS.OPTION_FORMAT_PHONE]: new Component(COMPONENTS.OPTION_FORMAT_PHONE, false),
        [COMPONENTS.OPTION_FORMAT_SQUARE]: new Component(COMPONENTS.OPTION_FORMAT_SQUARE, false),
        [COMPONENTS.OPTION_FORMAT_HORIZONTAL]: new Component(COMPONENTS.OPTION_FORMAT_HORIZONTAL, false),
        [COMPONENTS.OPTION_BROLL]: new Component(COMPONENTS.OPTION_BROLL, false),
        [COMPONENTS.SEQUENCE_SELECTION]: new Component(COMPONENTS.SEQUENCE_SELECTION, "selectedSequence"),
        [COMPONENTS.FORMAT_SELECTION]: new Component(COMPONENTS.FORMAT_SELECTION, "selectedFormatPhone"),
        [COMPONENTS.TEMPLATE_SELECTION]: new Component(COMPONENTS.TEMPLATE_SELECTION, "1"),
        [COMPONENTS.TITLE_COLOR_PICKER]: new ColorPicker(COMPONENTS.TITLE_COLOR_PICKER, "#ff4949ff"),
        [COMPONENTS.TOKEN_OPENAI]: new Component(COMPONENTS.TOKEN_OPENAI, "x"),
        [COMPONENTS.MARGE_CUTS]: new Component(COMPONENTS.MARGE_CUTS, 0.015),
        [COMPONENTS.LIMITE_CUTS]: new Component(COMPONENTS.LIMITE_CUTS, -65),
        [COMPONENTS.SUFFIX_AUDIO]: new Component(COMPONENTS.SUFFIX_AUDIO, "x"),
        [COMPONENTS.NEW_VERSION]: new Component(COMPONENTS.NEW_VERSION, "x"),
        [COMPONENTS.OPTION_SUBTITLES]: new Component(COMPONENTS.OPTION_SUBTITLES, false),
        [COMPONENTS.OPTION_TITLES]: new Component(COMPONENTS.OPTION_TITLES, false),
        [COMPONENTS.OPTION_PRESET_STYLE]: new Component(COMPONENTS.OPTION_PRESET_STYLE, "???")
    };

    // Make components globally accessible
    window.Components = components;

    // Set template video preview
    updateTemplatePreview(components[COMPONENTS.TEMPLATE_SELECTION].getValue());

    // Listen to Premiere notifications
    csInterface.addEventListener("NOTIF", function(evt) {
        try {
            const payload = safePayload(evt.data);
            const type = (payload.type || "warning").toLowerCase();
            const msg = payload.message || "";

            console.log("NOTIF received:", payload);

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

    /**
     * Execute step 2: Process sequences
     */
    async function handleStep2Execute(analyzeCut = false) {
        loadingScreen.show(MESSAGES.LOADING_DEFAULT);
        try {
            const apiKey = components[COMPONENTS.TOKEN_OPENAI].getValue();
            const optionCut = components[COMPONENTS.OPTION_CUT].getValue();
            const optionSubtitles = components[COMPONENTS.OPTION_SUBTITLES].getValue();
            const optionTitles = components[COMPONENTS.OPTION_TITLES].getValue();
            const optionZoom = components[COMPONENTS.OPTION_ZOOM].getValue();
            const optionBroll = components[COMPONENTS.OPTION_BROLL].getValue();
            const sequenceSelection = components[COMPONENTS.SEQUENCE_SELECTION].getValue();
            const suffixAudio = components[COMPONENTS.SUFFIX_AUDIO].getValue();
            const templateSelection = components[COMPONENTS.TEMPLATE_SELECTION].getValue();
            const titleColor = components[COMPONENTS.TITLE_COLOR_PICKER].getValue();
            const presetStyle = components[COMPONENTS.OPTION_PRESET_STYLE].getValue().replace(/\\/g, "\\\\");
            const margeCuts = parseFloat(components[COMPONENTS.MARGE_CUTS].getValue());
            const limiteCuts = parseFloat(components[COMPONENTS.LIMITE_CUTS].getValue());

            // Get selected sequences
            let listSequences = [];
            if (optionSubtitles || optionTitles || optionCut) {
                listSequences = await premiereAsync.getSelectedSequence(sequenceSelection, false);
            }

            // Phase 1: Generate transcriptions (already async)
            if (optionSubtitles || optionTitles) {
                const subtitlesService = new SubtitlesService(premiereAsync, csInterface);
                await subtitlesService.generateForFiles(
                    listSequences,
                    "SRT",
                    loadingScreen.setMessage.bind(loadingScreen)
                );

                if (optionTitles) {
                    const titlesService = new TitlesService(premiereAsync, apiKey);
                    await titlesService.generateForFiles(
                        listSequences,
                        loadingScreen.setMessage.bind(loadingScreen),
                        loadingScreen.setProgress.bind(loadingScreen)
                    );
                }
            }

            // Phase 2: Cut analysis (if requested)
            if (analyzeCut) {
                const outputs = [];
                for (let i = 0; i < listSequences.length; i++) {
                    const seq = listSequences[i];
                    loadingScreen.setMessage(`${MESSAGES.ANALYZING_CUTS} ${seq} (${i + 1}/${listSequences.length})`);
                    try {
                        const output = await premiereAsync.analyzeCutForSequence(seq, suffixAudio, margeCuts, limiteCuts);
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
                const projectPath = await premiereAsync.getProjectPath();
                const cutData = await premiereAsync.readCutAnalysis(projectPath);

                if (cutData && Array.isArray(cutData)) {
                    for (let i = 0; i < cutData.length; i++) {
                        const item = cutData[i];
                        loadingScreen.setMessage(`${MESSAGES.CUTTING_SEQUENCE} : ${item.fileName} (${i + 1}/${cutData.length})`);
                        try {
                            await premiereAsync.executeCutForSequence(item.fileName, item.Value);
                        } catch (error) {
                            ErrorHandler.handle(error, 'executeCut', `Erreur découpage pour ${item.fileName}`);
                        }
                    }
                }
            }

            // Phase 4: Import subtitles per sequence
            if (optionSubtitles) {
                for (let i = 0; i < listSequences.length; i++) {
                    const seq = listSequences[i];
                    loadingScreen.setMessage(`${MESSAGES.IMPORTING_SUBTITLES} : ${seq} (${i + 1}/${listSequences.length})`);
                    loadingScreen.hideProgress();
                    try {
                        await premiereAsync.createSubtitlesForSequence(seq, presetStyle);
                    } catch (error) {
                        ErrorHandler.handle(error, 'createSubtitles', `Erreur sous-titres pour ${seq}`);
                    }
                }
            }

            // Phase 5: Import titles per sequence
            if (optionTitles) {
                for (let i = 0; i < listSequences.length; i++) {
                    const seq = listSequences[i];
                    loadingScreen.setMessage(`${MESSAGES.IMPORTING_TITLES} : ${seq} (${i + 1}/${listSequences.length})`);
                    loadingScreen.hideProgress();
                    try {
                        await premiereAsync.createTitlesForSequence(seq, templateSelection, titleColor);
                    } catch (error) {
                        ErrorHandler.handle(error, 'createTitles', `Erreur titres pour ${seq}`);
                    }
                }
            }

            // Phase 6: B-rolls
            if (optionBroll) {
                loadingScreen.setMessage(MESSAGES.CREATING_BROLLS);
                loadingScreen.hideProgress();
                await handleCreateBrolls();
            }

            // Phase 7: Zoom
            if (optionZoom) {
                const sequences = await premiereAsync.getSelectedSequence(sequenceSelection, false);
                for (const seq of sequences) {
                    loadingScreen.setMessage('Création des zooms pour ' + seq);
                    await premiereAsync.createZoom(seq);
                }
            }

            notifications.success(SUCCESS.EXECUTION_SUCCESS);

        } catch (error) {
            ErrorHandler.handle(error, 'handleStep2Execute');
        } finally {
            loadingScreen.hideProgress();
            loadingScreen.hide();
        }
    }

    /**
     * Create B-rolls for selected sequences
     */
    async function handleCreateBrolls() {
        try {
            const apiKey = components[COMPONENTS.TOKEN_OPENAI].getValue();
            const sequenceSelection = components[COMPONENTS.SEQUENCE_SELECTION].getValue();

            const listSequences = await premiereAsync.getSelectedSequence(sequenceSelection, false);

            const subtitlesService = new SubtitlesService(premiereAsync, csInterface);
            const brollsService = new BrollsService(premiereAsync, apiKey, subtitlesService);
            await brollsService.createForFiles(
                listSequences,
                loadingScreen.setMessage.bind(loadingScreen)
            );
        } catch (error) {
            ErrorHandler.handle(error, 'handleCreateBrolls');
        }
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

            for (const item of resultParsed) {
                await displayWaveform(item, contentAllWav);
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
    async function displayWaveform(data, container) {
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
        const threshold = components[COMPONENTS.LIMITE_CUTS].getValue();

        const wrapper = document.createElement("div");
        wrapper.className = "wav";
        wrapper.setAttribute("file", fileName);
        wrapper.innerHTML = `
            <div class="info-wav">
                <div>
                    <p>${fileName}</p>
                    <p class="time">${duration.hour}h${duration.minute}min${duration.second}s</p>
                </div>
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

                case "createBrolls":
                    loadingScreen.show(MESSAGES.CREATING_BROLLS);
                    await handleCreateBrolls();
                    loadingScreen.hide();
                    break;

                case "AssemblyButton":
                    loadingScreen.show(MESSAGES.ASSEMBLING);
                    try {
                        await csInterface.evalScript(
                            `STEP4_EXECUTE(${components[COMPONENTS.OPTION_FORMAT_PHONE].getValue()}, ` +
                            `${components[COMPONENTS.OPTION_FORMAT_HORIZONTAL].getValue()}, ` +
                            `${components[COMPONENTS.OPTION_FORMAT_SQUARE].getValue()})`,
                            console.log
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
