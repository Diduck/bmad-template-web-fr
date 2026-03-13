import Component from '../components/Component.js';
import NotificationSystem from '../components/NotificationSystem.js';
import loadingScreen from '../components/LoadingScreen.js';
import SetupManager from '../services/setup.js';
import PremiereAsync from '../utils/premiereAsync.js';
import ErrorHandler from '../utils/errorHandler.js';
import { COMPONENTS, AI_PROVIDERS } from '../utils/constants.js';

/**
 * Settings page initialization
 */
document.addEventListener("DOMContentLoaded", async function () {
    try {
        // Initialize CSInterface
        const csInterface = new CSInterface();
        const jsxPath = csInterface.getSystemPath(SystemPath.EXTENSION) + "/src/jsx/Premiere.jsx";
        const normalizedPath = jsxPath.replace(/\\/g, "/");

        csInterface.evalScript(`$.evalFile("${normalizedPath}")`, function () {});

        // Initialize global instances
        const premiereAsync = new PremiereAsync(csInterface);
        window.notifications = new NotificationSystem();
        window.ProductivityLoading = loadingScreen;

        // Initialize components — SAME IDs and defaults as main.js
        const components = {
            [COMPONENTS.TOKEN_OPENAI]: new Component(COMPONENTS.TOKEN_OPENAI, "x"),
            [COMPONENTS.OPTION_PRESET_STYLE]: new Component(COMPONENTS.OPTION_PRESET_STYLE, "???"),
            [COMPONENTS.AI_PROVIDER]: new Component(COMPONENTS.AI_PROVIDER, false)
        };

        // Prevent form submission on Enter key (no server-side handler)
        document.querySelectorAll('form').forEach(function (form) {
            form.addEventListener('submit', function (e) { e.preventDefault(); });
        });

        // Validation inline du champ TokenOpenAI au blur
        const tokenInput = document.getElementById('TokenOpenAI');
        if (tokenInput) {
            tokenInput.addEventListener('blur', function () {
                const value = tokenInput.value.trim();
                try {
                    ErrorHandler.validateApiKey(value);
                    tokenInput.style.borderColor = '#0D66D0';
                } catch (e) {
                    tokenInput.style.borderColor = '#BD0000';
                }
            });
        }

        // ═══ AI Provider toggle ═══
        function updateProviderUI(isClaude) {
            const apiSection = document.getElementById('apiOpenAISection');
            const tokenInput = document.getElementById('TokenOpenAI');
            const labelOpenAI = document.getElementById('labelOpenAI');
            const labelClaude = document.getElementById('labelClaude');

            if (apiSection) {
                if (isClaude) {
                    apiSection.classList.add('api-section-disabled');
                } else {
                    apiSection.classList.remove('api-section-disabled');
                }
            }
            if (tokenInput) {
                tokenInput.disabled = !!isClaude;
            }
            if (labelOpenAI) {
                labelOpenAI.className = 'toggle-label ' + (isClaude ? 'toggle-label-inactive' : 'toggle-label-active');
            }
            if (labelClaude) {
                labelClaude.className = 'toggle-label ' + (isClaude ? 'toggle-label-active' : 'toggle-label-inactive');
            }
        }

        // Apply saved state on load
        const aiToggle = document.getElementById('AIProvider');
        const savedProvider = components[COMPONENTS.AI_PROVIDER].getValue();
        const isClaude = savedProvider === true || savedProvider === 'true';
        if (aiToggle) {
            aiToggle.checked = isClaude;
            aiToggle.addEventListener('change', function () {
                updateProviderUI(aiToggle.checked);
            });
        }
        updateProviderUI(isClaude);

        // Handler change generique pour sync Component <-> localStorage
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
                }
            }
        });

        // Setup: check & install dependencies
        const extensionRoot = csInterface.getSystemPath(SystemPath.EXTENSION);
        const setupManager = new SetupManager(loadingScreen, window.notifications, extensionRoot, premiereAsync);
        await setupManager.run();

        // Display dependency status in #depsStatus
        updateDepsStatus(setupManager);

        // Handler bouton recheckDeps
        const recheckBtn = document.getElementById('recheckDeps');
        if (recheckBtn) {
            recheckBtn.addEventListener('click', async function () {
                await setupManager.run(true);
                updateDepsStatus(setupManager);
            });
        }

    } catch (error) {
        ErrorHandler.handle(error, 'Settings', 'Erreur lors de l\'initialisation de la page Paramètres');
    }

    /**
     * Update the #depsStatus div with per-dependency check results
     * @param {SetupManager} manager - SetupManager instance with lastResults
     */
    function updateDepsStatus(manager) {
        const depsDiv = document.getElementById('depsStatus');
        if (!depsDiv) return;

        const results = manager.lastResults || { python: false, whisper: false, ffmpeg: false, cuda: false };

        const deps = [
            { name: 'Python', ok: results.python, status: 'binary' },
            { name: 'Whisper', ok: results.whisper, status: 'binary' },
            { name: 'FFmpeg', ok: results.ffmpeg, status: 'binary' },
            { name: 'CUDA (GPU)', ok: results.cuda, status: 'optional' }
        ];

        depsDiv.textContent = '';

        deps.forEach(function (dep) {
            var stateClass;
            var iconChar;
            var label;

            if (dep.ok) {
                stateClass = 'dep-ok';
                iconChar = '\u2713';
                label = dep.name + ' install\u00e9';
            } else if (dep.status === 'optional') {
                stateClass = 'dep-warning';
                iconChar = '\u26A0';
                label = dep.name + ' \u2014 mode CPU (lent)';
            } else {
                stateClass = 'dep-error';
                iconChar = '\u2717';
                label = dep.name + ' manquant';
            }

            const div = document.createElement('div');
            div.className = 'dep-status ' + stateClass;

            const icon = document.createElement('span');
            icon.className = 'dep-icon';
            icon.textContent = iconChar;

            const text = document.createElement('span');
            text.textContent = label;

            div.appendChild(icon);
            div.appendChild(text);
            depsDiv.appendChild(div);
        });
    }
});
