import NotificationSystem from '../components/NotificationSystem.js';
import ErrorHandler from '../utils/errorHandler.js';
import SequenceSelector from '../components/SequenceSelector.js';
import PremiereAsync from '../utils/premiereAsync.js';
import OpenAIClient from '../api/openai.js';
import ClaudeClient from '../api/claude.js';
import SmartCutService from '../services/smartcut.js';
import loadingScreen from '../components/LoadingScreen.js';
import { SMART_CUT, SMART_CUT_MESSAGES, COMPONENTS, SELECTION_MODES, TEMPLATE_PATHS } from '../utils/constants.js';
import { loadTemplate } from '../utils/templateLoader.js';

// Composants initialisés au DOMContentLoaded
var sequenceSelector = null;
var premiereAsync = null;
var csInterfaceRef = null;

// Clé projet pour localStorage (initialisée dans DOMContentLoaded)
var currentProjectKey = '';
// Chemin projet pour persistance fichier (initialisé dans DOMContentLoaded)
var currentProjectPath = '';

/**
 * Hash djb2 — produit une clé courte déterministe
 */
function hashString(str) {
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

/**
 * Retourne la clé localStorage Smart Cut (globale ou par projet)
 */
function getStorageKey() {
    if (!currentProjectKey) return SMART_CUT.LOCAL_STORAGE_KEY;
    return SMART_CUT.LOCAL_STORAGE_KEY + '_' + hashString(currentProjectKey);
}

// État Smart Cut en mémoire
const state = {
    phase: 'config',
    intention: null,
    segments: [],
    streamingAborted: false,
    createdSequences: [],
    sourceSequenceName: '',
    undoAvailable: false,
    selectionMode: SELECTION_MODES.ACTIVE,
    selectedSequences: []
};

/**
 * Affiche la phase demandée et masque les autres
 * @param {string} phaseName - 'config' | 'streaming' | 'review'
 */
function showPhase(phaseName) {
    const phases = ['config', 'streaming', 'review'];
    phases.forEach(function (p) {
        const el = document.getElementById('Phase' + p.charAt(0).toUpperCase() + p.slice(1));
        if (el) {
            el.style.display = (p === phaseName) ? 'flex' : 'none';
        }
    });
    state.phase = phaseName;
    saveState();
}

/**
 * Sélectionne une intention (pattern radio exclusif)
 * @param {string} intentionId - ID de l'intention sélectionnée
 */
function selectIntention(intentionId) {
    // Toggle : re-clic sur la carte selectionnee = deselection
    if (state.intention === intentionId) {
        document.querySelectorAll('.intention-card').forEach(function (card) {
            card.classList.remove('intention-card--selected');
            card.setAttribute('aria-checked', 'false');
        });
        state.intention = null;
        updateLaunchButton();
        saveState();
        return;
    }
    // Désélectionner toutes les cards
    document.querySelectorAll('.intention-card').forEach(function (card) {
        card.classList.remove('intention-card--selected');
        card.setAttribute('aria-checked', 'false');
    });
    // Sélectionner la card cliquée
    var selected = document.querySelector('[data-intention="' + intentionId + '"]');
    if (selected) {
        selected.classList.add('intention-card--selected');
        selected.setAttribute('aria-checked', 'true');
    }
    state.intention = intentionId;
    updateLaunchButton();
    saveState();
}

/**
 * Met à jour l'état du bouton Lancer
 */
function updateLaunchButton() {
    var launchBtn = document.getElementById(COMPONENTS.SMART_CUT_LAUNCH);
    if (!launchBtn) return;
    var hasIntention = !!state.intention;
    var customPromptEl = document.getElementById('SmartCutCustomPrompt');
    var hasCustomPrompt = customPromptEl && customPromptEl.value.trim().length > 0;
    var enabled = hasIntention || hasCustomPrompt;
    launchBtn.disabled = !enabled;
    launchBtn.setAttribute('aria-disabled', !enabled ? 'true' : 'false');
}

/**
 * Récupère les séquences cibles selon le mode de sélection
 * @returns {{mode: string, sequences: string[]|null}} Mode et séquences sélectionnées
 */
function getTargetSequences() {
    if (!sequenceSelector) {
        return { mode: SELECTION_MODES.ACTIVE, sequences: null };
    }
    var mode = sequenceSelector.getMode();
    var selected = sequenceSelector.getSelectedSequences();

    if (mode === SELECTION_MODES.ACTIVE || selected === null) {
        return { mode: SELECTION_MODES.ACTIVE, sequences: null };
    }
    return { mode: mode, sequences: selected };
}

/**
 * Collecte les transcriptions pour les séquences sélectionnées
 * @param {string[]} sequenceNames - Noms des séquences à traiter
 * @returns {Promise<{sequences: Array, missingTranscriptions: string[]}|null>} Transcriptions collectées ou null si annulé
 */
async function collectTranscriptions(sequenceNames) {
    var result = {
        sequences: [],
        missingTranscriptions: []
    };

    var projectPath;
    try {
        projectPath = await premiereAsync.getProjectPath();
    } catch (error) {
        ErrorHandler.handle(error, 'SmartCut.collectTranscriptions', 'Impossible de récupérer le chemin du projet');
        return null;
    }

    for (var i = 0; i < sequenceNames.length; i++) {
        var seqName = sequenceNames[i];
        var transcriptionFound = false;
        var transcriptionData = null;

        // Chercher le fichier de transcription (pattern {nom}.json ou {nom}SRT.json)
        var patterns = [
            '07_Audio/' + seqName + '.json',
            '07_Audio/' + seqName + 'SRT.json',
            '07_Audio/Smartcut/' + seqName + 'SRT.json'
        ];

        for (var p = 0; p < patterns.length; p++) {
            var filePath = projectPath + '/' + patterns[p];
            try {
                var exists = await premiereAsync.fileExists(filePath);
                if (exists) {
                    var content = await premiereAsync.readFile(filePath);
                    var segments = JSON.parse(content);
                    // Tagger chaque segment avec la séquence source
                    if (Array.isArray(segments)) {
                        for (var s = 0; s < segments.length; s++) {
                            segments[s].sourceSequence = seqName;
                        }
                    }
                    transcriptionData = segments;
                    transcriptionFound = true;
                    break;
                }
            } catch (error) {
                ErrorHandler.handle(error, 'SmartCut.collectTranscriptions', 'Erreur lecture transcription ' + seqName);
            }
        }

        if (transcriptionFound && transcriptionData) {
            result.sequences.push({
                name: seqName,
                transcription: transcriptionData
            });
        } else {
            // Auto-transcription pour cette sequence
            if (csInterfaceRef && premiereAsync) {
                try {
                    loadingScreen.show('Export audio de ' + seqName + '...');
                    var extensionPath = csInterfaceRef
                        .getSystemPath(SystemPath.EXTENSION)
                        .replace(/\//g, '\\');
                    var normalizedProjectPath = projectPath.replace(/\//g, '\\');
                    if (normalizedProjectPath.charAt(normalizedProjectPath.length - 1) !== '\\') {
                        normalizedProjectPath += '\\';
                    }
                    var audioPath = normalizedProjectPath + '07_Audio\\';
                    var outputDir = normalizedProjectPath + '07_Audio\\Smartcut';

                    // Exporter le WAV de la sequence avant transcription
                    await premiereAsync.exportMultipleWav([seqName], audioPath);

                    loadingScreen.setMessage('Transcription de ' + seqName + '...');

                    var autoResult = await premiereAsync.runSmartCutTranscription(
                        extensionPath, audioPath, seqName, outputDir
                    );

                    loadingScreen.hide();

                    if (autoResult && autoResult !== 'TRANSCRIPTION_FAILED' && autoResult !== 'BATCH_NOT_FOUND' && autoResult !== 'CANNOT_WRITE_BATCH') {
                        // Recharger depuis le fichier cree
                        var smartcutFilePath = projectPath + '/07_Audio/Smartcut/' + seqName + 'SRT.json';
                        var newExists = await premiereAsync.fileExists(smartcutFilePath);
                        if (newExists) {
                            var newContent = await premiereAsync.readFile(smartcutFilePath);
                            var newSegments = JSON.parse(newContent);
                            if (Array.isArray(newSegments)) {
                                for (var ns = 0; ns < newSegments.length; ns++) {
                                    newSegments[ns].sourceSequence = seqName;
                                }
                            }
                            result.sequences.push({
                                name: seqName,
                                transcription: newSegments
                            });
                            continue;
                        }
                    }
                    result.missingTranscriptions.push(seqName);
                } catch (autoError) {
                    loadingScreen.hide();
                    ErrorHandler.handle(autoError, 'SmartCut.collectTranscriptions', 'Auto-transcription echouee pour ' + seqName);
                    result.missingTranscriptions.push(seqName);
                }
            } else {
                result.missingTranscriptions.push(seqName);
            }
        }
    }

    // Notification si des transcriptions manquent encore apres auto-transcription
    if (result.missingTranscriptions.length > 0) {
        var missing = result.missingTranscriptions.join(', ');
        window.notifications.warning(
            'Transcription manquante pour : ' + missing + ' — Lancez la transcription depuis la page Montage, ou continuez sans ces séquences.'
        );

        // Si aucune transcription disponible, annuler
        if (result.sequences.length === 0) {
            window.notifications.error('Aucune transcription disponible pour les séquences sélectionnées');
            return null;
        }
    }

    return result;
}

/**
 * Génère les cards d'intention dans la grille
 */
function renderIntentionCards() {
    var grid = document.querySelector('.intention-grid');
    if (!grid) return;

    grid.innerHTML = '';

    SMART_CUT.INTENTIONS.forEach(function (intention) {
        var card = document.createElement('div');
        card.className = 'intention-card';
        card.setAttribute('role', 'radio');
        card.setAttribute('aria-checked', 'false');
        card.setAttribute('tabindex', '0');
        card.setAttribute('data-intention', intention.id);

        var label = document.createElement('p');
        label.className = 'intention-card__label';
        label.textContent = intention.label;

        var desc = document.createElement('p');
        desc.className = 'intention-card__description';
        desc.textContent = intention.description;

        card.appendChild(label);
        card.appendChild(desc);

        // Click
        card.addEventListener('click', function () {
            selectIntention(intention.id);
        });

        // Clavier : Enter/Space pour sélectionner
        card.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectIntention(intention.id);
            }
            // Navigation flèches
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                e.preventDefault();
                var next = card.nextElementSibling;
                if (next && next.classList.contains('intention-card')) {
                    next.focus();
                }
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                e.preventDefault();
                var prev = card.previousElementSibling;
                if (prev && prev.classList.contains('intention-card')) {
                    prev.focus();
                }
            }
        });

        grid.appendChild(card);
    });
}

/**
 * Sauvegarde l'état dans localStorage
 */
function saveState() {
    try {
        var serialized = JSON.stringify({
            phase: state.phase,
            intention: state.intention,
            segments: state.segments,
            streamingAborted: state.streamingAborted,
            createdSequences: state.createdSequences,
            sourceSequenceName: state.sourceSequenceName,
            undoAvailable: state.undoAvailable
        });
        localStorage.setItem(getStorageKey(), serialized);
    } catch (e) {
        ErrorHandler.handle(e, 'SmartCut.saveState', 'Erreur sauvegarde état Smart Cut');
    }
}

/**
 * Restaure l'état depuis localStorage
 * Resynchronise la sélection depuis le SequenceSelector (source de vérité)
 * @returns {boolean} true si un état a été restauré
 */
function restoreState() {
    try {
        var saved = localStorage.getItem(getStorageKey());
        if (!saved) return false;

        var parsed = JSON.parse(saved);
        state.phase = parsed.phase || 'config';
        state.intention = parsed.intention || null;
        state.segments = parsed.segments || [];
        state.streamingAborted = parsed.streamingAborted || false;
        state.createdSequences = parsed.createdSequences || [];
        state.sourceSequenceName = parsed.sourceSequenceName || '';
        state.undoAvailable = parsed.undoAvailable || false;

        // Resynchroniser la sélection depuis le SequenceSelector (source de vérité)
        if (sequenceSelector) {
            state.selectionMode = sequenceSelector.getMode();
            state.selectedSequences = sequenceSelector.getSelectedSequences() || [];
        }

        return true;
    } catch (e) {
        ErrorHandler.handle(e, 'SmartCut.restoreState', 'Erreur restauration état Smart Cut');
        return false;
    }
}

// ============================================================================
// Persistance fichier — crash recovery
// ============================================================================

var STATE_FILE_NAME = '_smartcut_state.json';

/**
 * Retourne le chemin du fichier de state Smart Cut dans le projet
 * @returns {string|null} Chemin absolu ou null si projet non ouvert
 */
function getStateFilePath() {
    if (!currentProjectPath) return null;
    var normalized = currentProjectPath.replace(/\//g, '\\').replace(/\\$/, '');
    return normalized + '\\07_Audio\\Smartcut\\' + STATE_FILE_NAME;
}

/**
 * Sauvegarde l'état en fichier dans le dossier projet (crash recovery)
 */
function saveStateToFile() {
    var path = getStateFilePath();
    if (!path) return;
    try {
        var dir = path.replace(/\\[^\\]+$/, '');
        var mkResult = window.cep.fs.makedir(dir);
        if (mkResult.err !== 0) {
            var checkResult = window.cep.fs.readdir(dir);
            if (checkResult.err !== 0) {
                console.warn('[SC] Impossible de créer le dossier state:', dir);
                return;
            }
        }
        var data = JSON.stringify({
            phase: state.phase,
            intention: state.intention,
            segments: state.segments,
            sourceSequenceName: state.sourceSequenceName,
            createdSequences: state.createdSequences,
            undoAvailable: state.undoAvailable,
            timestamp: Date.now()
        });
        var writeResult = window.cep.fs.writeFile(path, data);
        if (writeResult.err !== 0) {
            console.warn('[SC] Écriture state échouée:', path, 'err:', writeResult.err);
        }
    } catch (e) {
        console.warn('[SC] saveStateToFile failed:', e.message || e);
    }
}

/**
 * Charge l'état depuis le fichier projet
 * @returns {Object|null} État restauré ou null
 */
function loadStateFromFile() {
    var path = getStateFilePath();
    if (!path) return null;
    try {
        var result = window.cep.fs.readFile(path);
        if (result.err !== 0) return null;
        var parsed = JSON.parse(result.data);
        if (!parsed || !parsed.segments) return null;
        return parsed;
    } catch (e) {
        return null;
    }
}

/**
 * Supprime le fichier de state (après validation réussie ou annulation)
 */
function clearStateFile() {
    var path = getStateFilePath();
    if (!path) return;
    try { window.cep.fs.deleteFile(path); } catch (e) { /* ignore */ }
}

// ============================================================================
// Fonctions utilitaires
// ============================================================================

/**
 * Echappe les caractères HTML pour éviter les injections XSS
 * @param {string} str - Chaîne à échapper
 * @returns {string} Chaîne échappée
 */
function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Formate des secondes en timecode MM:SS
 */
function formatTimecode(seconds) {
    var min = Math.floor(seconds / 60);
    var sec = Math.floor(seconds % 60);
    return String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

/**
 * Formate une duree en M:SS
 */
function formatDuration(seconds) {
    var min = Math.floor(seconds / 60);
    var sec = Math.floor(seconds % 60);
    return min + ':' + String(sec).padStart(2, '0');
}

/**
 * Met a jour l'UI de progression streaming
 * @param {string} intentionLabel - Label de l'intention
 * @param {number} count - Nombre de segments identifiés
 * @param {string} [sourceSequence] - Nom de la séquence source (multi-séquence)
 */
function updateStreamingUI(intentionLabel, count, sourceSequence) {
    var label = document.getElementById('StreamingIntentionLabel');
    if (label) label.textContent = 'Analyse en cours — ' + intentionLabel;
    var counter = document.getElementById('SmartCutCounter');
    if (counter) {
        var text = count + ' segments identifies...';
        if (sourceSequence) {
            text += ' (' + sourceSequence + ')';
        }
        counter.textContent = text;
    }
}

/**
 * Met a jour le resume de la phase review
 */
function updateReviewSummary(count, minutes) {
    var summary = document.getElementById('ReviewSummary');
    if (summary) {
        summary.textContent = count + ' segments identifies' + (minutes > 0 ? ' en ' + minutes + ' min' : '');
    }
    var validateBtn = document.getElementById('SmartCutValidate');
    if (validateBtn) {
        validateBtn.textContent = 'Valider (' + count + ' shorts)';
        validateBtn.disabled = count === 0;
    }
}

// ============================================================================
// Rendu ShortCard (Task 8)
// ============================================================================

/**
 * Cree un element DOM ShortCard pour un segment
 */
function createShortCard(segment, displayIndex) {
    var card = document.createElement('div');
    card.className = 'short-card short-card--appearing';
    card.setAttribute('role', 'article');
    card.setAttribute('aria-label', 'SHORT' + displayIndex + ' — ' + segment.title);
    card.dataset.segmentIndex = String(segment.index);

    var duration = formatDuration(segment.end - segment.start);
    var startTC = formatTimecode(segment.start);
    var endTC = formatTimecode(segment.end);

    var safeTitle = escapeHtml(segment.title);
    var safeDescription = escapeHtml(segment.description);
    var safeTranscription = escapeHtml(segment.transcription || '');

    card.innerHTML =
        '<div class="short-card__header">' +
            '<span class="short-card__title">SHORT' + displayIndex + ' — ' + safeTitle + '</span>' +
            '<button class="short-card__delete" aria-label="Supprimer SHORT' + displayIndex + '">&times;</button>' +
        '</div>' +
        '<p class="short-card__description">' + safeDescription + '</p>' +
        '<p class="short-card__timecodes">' + startTC + ' — ' + endTC + ' (' + duration + ')</p>' +
        '<div class="short-card__transcription">' +
            '<button class="short-card__toggle" aria-expanded="false">Transcription</button>' +
            '<div class="short-card__transcript-content" style="display:none;">' +
                '<p>' + safeTranscription + '</p>' +
            '</div>' +
        '</div>';

    // Event : supprimer la card
    card.querySelector('.short-card__delete').addEventListener('click', function () {
        handleDeleteCard(segment.index);
    });

    // Event : toggle transcription
    card.querySelector('.short-card__toggle').addEventListener('click', function (e) {
        var content = e.target.nextElementSibling;
        var expanded = content.style.display !== 'none';
        content.style.display = expanded ? 'none' : 'block';
        e.target.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    });

    // Retirer l'animation apres 300ms
    setTimeout(function () {
        card.classList.remove('short-card--appearing');
    }, 300);

    return card;
}

/**
 * Supprime une card par index de segment et renumerote
 */
function handleDeleteCard(segmentIndex) {
    state.segments = state.segments.filter(function (s) {
        return s.index !== segmentIndex;
    });

    // Retirer du DOM
    var zone = getActiveZone();
    var cards = zone.querySelectorAll('.short-card');
    cards.forEach(function (card) {
        if (card.dataset.segmentIndex === String(segmentIndex)) {
            card.remove();
        }
    });

    renumberCards();
    updateReviewSummary(state.segments.length, 0);
    saveState();
}

/**
 * Renumerote toutes les cards SHORT1, SHORT2...
 */
function renumberCards() {
    var zone = getActiveZone();
    var cards = zone.querySelectorAll('.short-card');
    cards.forEach(function (card, idx) {
        var num = idx + 1;
        var title = card.querySelector('.short-card__title');
        if (title) {
            var segTitle = title.textContent.replace(/^SHORT\d+ — /, '');
            title.textContent = 'SHORT' + num + ' — ' + segTitle;
        }
        card.setAttribute('aria-label', 'SHORT' + num + ' — ' + (title ? title.textContent.replace(/^SHORT\d+ — /, '') : ''));
        var deleteBtn = card.querySelector('.short-card__delete');
        if (deleteBtn) {
            deleteBtn.setAttribute('aria-label', 'Supprimer SHORT' + num);
        }
    });
}

/**
 * Retourne la zone de streaming active (StreamingZone ou ReviewZone)
 */
function getActiveZone() {
    if (state.phase === 'review') {
        return document.getElementById('ReviewZone') || document.getElementById('StreamingZone');
    }
    return document.getElementById('StreamingZone');
}

// ============================================================================
// Auto-scroll StreamingZone (Task 9)
// ============================================================================

var userHasScrolled = false;

function initAutoScroll() {
    var zone = document.getElementById('StreamingZone');
    if (!zone) return;
    zone.addEventListener('scroll', function () {
        var isAtBottom = zone.scrollHeight - zone.scrollTop - zone.clientHeight < 50;
        userHasScrolled = !isAtBottom;
    });
}

function scrollToBottom() {
    if (userHasScrolled) return;
    var zone = document.getElementById('StreamingZone');
    if (zone) {
        zone.scrollTop = zone.scrollHeight;
    }
}

// ============================================================================
// Transfert des cards entre phases
// ============================================================================

/**
 * Deplace les cards de StreamingZone vers ReviewZone
 */
function moveCardsToReview() {
    var streamingZone = document.getElementById('StreamingZone');
    var reviewZone = document.getElementById('ReviewZone');
    if (!streamingZone || !reviewZone) return;
    while (streamingZone.firstChild) {
        reviewZone.appendChild(streamingZone.firstChild);
    }
}

/**
 * Re-render les cards depuis state.segments dans la zone active
 */
function renderCardsFromState() {
    var zone = getActiveZone();
    if (!zone) return;
    zone.innerHTML = '';
    state.segments.forEach(function (segment, idx) {
        var card = createShortCard(segment, idx + 1);
        card.classList.remove('short-card--appearing');
        zone.appendChild(card);
    });
}

// ============================================================================
// UndoBanner (Story 3.3)
// ============================================================================

/**
 * Affiche l'UndoBanner avec le nombre de shorts crees
 */
function showUndoBanner() {
    var banner = document.getElementById(COMPONENTS.UNDO_BANNER);
    if (banner) {
        var msg = banner.querySelector('.undo-banner__message');
        if (msg) {
            msg.textContent = SMART_CUT_MESSAGES.UNDO_BANNER_MESSAGE.replace('{count}', state.createdSequences.length);
        }
        banner.style.display = 'flex';
    }
}

/**
 * Masque l'UndoBanner et reinitialise l'etat undo
 */
function hideUndoBanner() {
    var banner = document.getElementById(COMPONENTS.UNDO_BANNER);
    if (banner) {
        banner.style.display = 'none';
    }
    state.undoAvailable = false;
    state.createdSequences = [];
    saveState();
}

// ============================================================================
// Initialisation
// ============================================================================

/**
 * Initialisation de la page Smart Cut
 */
document.addEventListener('DOMContentLoaded', async function () {
    // 1. Initialiser CSInterface et charger Premiere.jsx
    var csInterface = new CSInterface();
    csInterfaceRef = csInterface;
    var jsxPath = csInterface.getSystemPath(SystemPath.EXTENSION) + '/src/jsx/Premiere.jsx';
    var normalizedPath = jsxPath.replace(/\\/g, '/');

    try {
        csInterface.evalScript('$.evalFile("' + normalizedPath + '")', function (result) {
            if (result === 'EvalScript error.' || result === '') {
                ErrorHandler.handle(new Error('Échec chargement Premiere.jsx'), 'SmartCut.init', 'Impossible de charger le moteur Premiere');
            }
        });
    } catch (e) {
        ErrorHandler.handle(e, 'SmartCut.init', 'Erreur lors du chargement de Premiere.jsx');
    }

    // 2. Vérifier authentification (seul index.html redirige vers auth, pattern main.js)
    // smartcut.html n'est jamais le point d'entrée — l'auth est gérée par index.html

    // 3. Initialiser notifications
    window.notifications = new NotificationSystem();

    // 4. Initialiser PremiereAsync
    premiereAsync = new PremiereAsync(csInterface);

    // 5. Initialiser SequenceSelector (global popup dans le header)
    sequenceSelector = new SequenceSelector('seqSelectorPopup');
    sequenceSelector.init();

    // Brancher le bouton toggle du sélecteur dans le header
    var seqToggleBtn = document.getElementById('seqSelectorToggle');
    if (seqToggleBtn) {
        seqToggleBtn.querySelector('.header-icon').addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            sequenceSelector.toggle();
        });
    }

    // 6. Brancher le textarea listener + bouton Lancer AVANT le state restore
    // (Fix Task 1 : le listener doit TOUJOURS être attaché, même si le state restore crash)
    updateLaunchButton();
    var customPromptTextarea = document.getElementById('SmartCutCustomPrompt');
    if (customPromptTextarea) {
        customPromptTextarea.addEventListener('input', updateLaunchButton);
    }

    // 7. Charger séquences (fallback gracieux si projet non ouvert ou bins manquants)
    console.log('[SC] Init: loading sequences...');
    try {
        var sequences = await premiereAsync.getAllProjectSequences();
        console.log('[SC] Init: loaded', sequences.length, 'sequences');
        sequenceSelector.loadSequences(sequences);
    } catch (seqError) {
        console.warn('[SC] Init: sequences load failed (graceful):', seqError.message || seqError);
        sequenceSelector.loadSequences([]);
    }

    // 8. Résoudre le chemin projet pour la clé localStorage + persistance fichier
    try {
        currentProjectKey = await premiereAsync.getProjectFullPath();
    } catch (e) {
        currentProjectKey = '';
    }
    try {
        currentProjectPath = await premiereAsync.getProjectPath();
    } catch (e) {
        currentProjectPath = '';
    }

    // 9. Intention cards et restauration d'état
    renderIntentionCards();
    console.log('[SC] Init: intention cards rendered, state restore...');

    var restored = restoreState();

    // Crash recovery : si localStorage vide ou moins de segments que le fichier, utiliser le fichier
    var fileState = loadStateFromFile();
    if (fileState && fileState.segments && fileState.segments.length > 0) {
        var localSegments = state.segments ? state.segments.length : 0;
        if (!restored || fileState.segments.length > localSegments) {
            console.log('[SC] Crash recovery: restoring', fileState.segments.length, 'segments from file (localStorage had', localSegments, ')');
            state.phase = 'review';
            state.intention = fileState.intention || state.intention;
            state.segments = fileState.segments;
            state.sourceSequenceName = fileState.sourceSequenceName || state.sourceSequenceName;
            state.createdSequences = fileState.createdSequences || [];
            state.undoAvailable = fileState.undoAvailable || false;
            restored = true;
        }
    }

    if (restored) {
        if (state.intention) {
            selectIntention(state.intention);
        }
        if (state.phase === 'review' && state.segments.length > 0) {
            showPhase('review');
            renderCardsFromState();
            updateReviewSummary(state.segments.length, 0);
        } else if (state.phase === 'streaming') {
            showPhase('config');
        } else {
            showPhase(state.phase);
        }
    } else {
        showPhase('config');
    }

    // 11. Événement bouton Lancer — câblage SmartCutService + multi-séquence
    var launchBtn = document.getElementById(COMPONENTS.SMART_CUT_LAUNCH);
    if (launchBtn) {
        launchBtn.addEventListener('click', async function () {
            console.log('[SC] Launch clicked');
            // Validation : carte OU prompt custom requis
            var customPromptEl = document.getElementById('SmartCutCustomPrompt');
            var customPrompt = customPromptEl ? customPromptEl.value.trim() : '';
            var hasIntention = !!state.intention;
            var hasCustomPrompt = customPrompt.length > 0;

            if (!hasIntention && !hasCustomPrompt) {
                window.notifications.error('Sélectionne une intention ou écris un prompt personnalisé');
                return;
            }

            var isClaude = localStorage.getItem('AIProvider') === 'true';
            var aiClient;

            if (isClaude) {
                aiClient = new ClaudeClient(premiereAsync);
                console.log('[SC] Using Claude CLI provider');
            } else {
                var apiKey = localStorage.getItem('TokenOpenAI') || '';
                try {
                    ErrorHandler.validateApiKey(apiKey);
                    console.log('[SC] API key valid');
                } catch (e) {
                    console.error('[SC] API key invalid:', e.message);
                    window.notifications.error(SMART_CUT_MESSAGES.ERROR_NO_API_KEY);
                    return;
                }
                aiClient = new OpenAIClient(apiKey);
            }

            var service = new SmartCutService(aiClient, premiereAsync, window.notifications, csInterfaceRef, loadingScreen);

            // Assembler le prompt d'intention combine (carte + custom)
            var intention = hasIntention
                ? SMART_CUT.INTENTIONS.find(function (i) { return i.id === state.intention; })
                : null;

            // Charger le template de l'intention selectionnee
            var intentionParts = [];
            if (intention && intention.templatePath) {
                var tpl = loadTemplate(intention.templatePath);
                if (tpl) {
                    intentionParts.push(tpl);
                } else {
                    window.notifications.warning('Template introuvable : ' + intention.templatePath);
                }
            }
            if (hasCustomPrompt) {
                // Si custom prompt SEUL (pas de carte), ajouter le pre-prompt contextuel
                if (!hasIntention) {
                    var contextPrompt = loadTemplate(TEMPLATE_PATHS.SMART_CUT_CUSTOM_CONTEXT);
                    if (contextPrompt) {
                        intentionParts.push(contextPrompt);
                    }
                }
                intentionParts.push(customPrompt);
            }
            var finalIntentionPrompt = intentionParts.join('\n\n');

            console.log('[SC] Assembled prompt length:', finalIntentionPrompt.length, 'chars');
            // Bloquer si aucun prompt assemble (template manquant + pas de custom)
            if (!finalIntentionPrompt) {
                window.notifications.error('Template introuvable et aucun prompt personnalisé — impossible de lancer l\'analyse');
                return;
            }

            // Creer un objet intention avec le prompt assemble pour le service
            var effectiveIntention = {
                id: intention ? intention.id : 'custom',
                label: intention ? intention.label : 'Prompt personnalisé',
                description: intention ? intention.description : customPrompt.substring(0, 50),
                templatePath: null,
                assembledPrompt: finalIntentionPrompt
            };

            // Verifier le system prompt (warning seulement — le fallback hardcode prend le relais)
            var systemTemplate = loadTemplate(TEMPLATE_PATHS.SMART_CUT_SYSTEM);
            if (!systemTemplate) {
                window.notifications.warning('Template manquant : ' + TEMPLATE_PATHS.SMART_CUT_SYSTEM + ' — prompt par defaut utilise');
            }

            // Récupérer la sélection de séquences
            var target = getTargetSequences();
            state.selectionMode = target.mode;
            state.selectedSequences = target.sequences || [];

            // Vérifier qu'au moins une séquence est sélectionnée en mode custom
            if (target.mode === SELECTION_MODES.CUSTOM && target.sequences && target.sequences.length === 0) {
                window.notifications.warning('Aucune séquence sélectionnée. Coche au moins une séquence ou utilise le mode "Séquence active".');
                return;
            }

            // Capturer le nom de la sequence source pour la creation
            if (target.mode === SELECTION_MODES.ACTIVE || !target.sequences || target.sequences.length === 0) {
                try {
                    var seqInfo = await premiereAsync.getActiveSequenceInfo();
                    if (seqInfo && seqInfo.name) {
                        state.sourceSequenceName = seqInfo.name;
                    }
                } catch (seqErr) {
                    ErrorHandler.handle(seqErr, 'SmartCut', 'Impossible de recuperer la sequence active');
                }
            }

            var controller = new AbortController();
            state.abortController = controller;
            state.segments = [];
            state.streamingAborted = false;

            // Masquer l'UndoBanner d'un précédent run
            hideUndoBanner();

            // Vider les zones de cards
            var streamingZone = document.getElementById('StreamingZone');
            if (streamingZone) streamingZone.innerHTML = '';
            var reviewZone = document.getElementById('ReviewZone');
            if (reviewZone) reviewZone.innerHTML = '';

            var startTime = Date.now();
            loadingScreen.show('Chargement de la transcription...');
            showPhase('streaming');
            updateStreamingUI(effectiveIntention.label, 0);
            userHasScrolled = false;

            var callbacks = {
                abortSignal: controller.signal,
                onSegment: function (segment) {
                    loadingScreen.hide();
                    console.log('[SC] Segment received:', segment.index, segment.title, '(' + segment.start + '-' + segment.end + 's)');
                    state.segments.push(segment);
                    var card = createShortCard(segment, state.segments.length);
                    var zone = document.getElementById('StreamingZone');
                    if (zone) zone.appendChild(card);
                    updateStreamingUI(effectiveIntention.label, state.segments.length, segment.sourceSequence);
                    scrollToBottom();
                    // Crash recovery : sauvegarder tous les 5 segments
                    if (state.segments.length % 5 === 0) {
                        saveStateToFile();
                    }
                },
                onProgress: function (count) {
                    // Progression mise a jour via onSegment
                },
                onError: function (error) {
                    console.error('[SC] Streaming error:', error.message || error);
                    ErrorHandler.handle(error, 'SmartCut', 'Erreur analyse Smart Cut');
                    window.notifications.error(SMART_CUT_MESSAGES.ERROR_API_INTERRUPTED);
                },
                onComplete: function (total) {
                    loadingScreen.hide();
                    console.log('[SC] Analysis complete! Total segments:', total);
                    state.abortController = null;
                    var elapsed = Math.round((Date.now() - startTime) / 60000);
                    moveCardsToReview();
                    showPhase('review');
                    updateReviewSummary(total, elapsed);
                    saveState();
                    saveStateToFile();
                },
                onStepChange: function (step, detail) {
                    if (step === 'transcription_loaded') {
                        loadingScreen.setMessage(detail + ' segments chargés — lancement de l\'analyse...');
                    } else if (step === 'batch_start') {
                        var label = document.getElementById('StreamingIntentionLabel');
                        if (label) {
                            label.textContent = 'Analyse en cours — ' + effectiveIntention.label + ' | ' + detail;
                        }
                        if (state.segments.length === 0) {
                            loadingScreen.setMessage('Analyse IA : ' + detail);
                        }
                    }
                }
            };

            console.log('[SC] Starting analysis, mode:', target.mode, 'sequences:', target.sequences ? target.sequences.length : 0);
            try {
                if (target.mode !== SELECTION_MODES.ACTIVE && target.sequences && target.sequences.length > 0) {
                    // Multi-séquence : collecter les transcriptions puis lancer l'analyse multi
                    var collected = await collectTranscriptions(target.sequences);
                    if (!collected) return;
                    await service.startMultiAnalysis(effectiveIntention, collected, callbacks);
                } else {
                    // Mono-séquence : flow existant via séquence active
                    await service.startAnalysis(effectiveIntention, callbacks);
                }
            } catch (error) {
                loadingScreen.hide();
                state.abortController = null;
                if (error.name === 'AbortError') {
                    state.streamingAborted = true;
                    moveCardsToReview();
                    showPhase('review');
                    updateReviewSummary(state.segments.length, 0);
                } else {
                    ErrorHandler.handle(error, 'SmartCut', 'Erreur analyse Smart Cut');
                    window.notifications.error(error.message);
                    if (state.segments.length > 0) {
                        moveCardsToReview();
                        showPhase('review');
                        updateReviewSummary(state.segments.length, 0);
                    } else {
                        showPhase('config');
                    }
                }
                saveState();
                if (state.segments.length > 0) saveStateToFile();
            }
        });
    }

    // 12. Événement bouton Arreter
    var stopBtn = document.getElementById('SmartCutStop');
    if (stopBtn) {
        stopBtn.addEventListener('click', function () {
            if (state.abortController) {
                state.abortController.abort();
            }
            // Kill Claude CLI process if running
            if (premiereAsync && premiereAsync.killClaudeProcess) {
                try { premiereAsync.killClaudeProcess(); } catch (e) { /* ignore */ }
            }
        });
    }

    // 13. Événement bouton Valider — creation des sequences Smart Cut
    var validateBtn = document.getElementById('SmartCutValidate');
    if (validateBtn) {
        validateBtn.addEventListener('click', async function () {
            var activeSegments = state.segments;
            if (activeSegments.length === 0) return;

            if (!state.sourceSequenceName) {
                try {
                    var fallbackSeq = await premiereAsync.getActiveSequenceInfo();
                    if (fallbackSeq && fallbackSeq.name) {
                        state.sourceSequenceName = fallbackSeq.name;
                        saveState();
                    }
                } catch (e) { /* ignore */ }
            }
            if (!state.sourceSequenceName) {
                window.notifications.error('Séquence source introuvable — ouvrez une séquence dans le timeline');
                return;
            }

            // Afficher LoadingScreen
            loadingScreen.show(SMART_CUT_MESSAGES.CREATING_PREPARING);
            loadingScreen.setProgress(0, SMART_CUT_MESSAGES.CREATING_PROGRESS.replace('{current}', '0').replace('{total}', String(activeSegments.length)));

            state.createdSequences = [];
            var total = activeSegments.length;

            // Creer le service SmartCut
            var service = new SmartCutService(null, premiereAsync, window.notifications, csInterfaceRef);

            try {
                await service.createSequences(activeSegments, state.sourceSequenceName, {
                    onCreated: function (seqName, current, totalCount) {
                        state.createdSequences.push(seqName);
                        var percent = Math.round((current / totalCount) * 100);
                        loadingScreen.setProgress(percent, SMART_CUT_MESSAGES.CREATING_PROGRESS.replace('{current}', String(current)).replace('{total}', String(totalCount)));
                        saveState();
                    },
                    onError: function (error, seqName, index) {
                        ErrorHandler.handle(error, 'SmartCut', SMART_CUT_MESSAGES.CREATING_ERROR.replace('{name}', seqName).replace('{error}', error.message));
                    },
                    onComplete: function (names) {
                        // Gere dans le try ci-dessous
                    }
                });

                // Succes total
                loadingScreen.hide();
                window.notifications.success(SMART_CUT_MESSAGES.CREATING_SUCCESS.replace('{count}', String(total)));
                state.undoAvailable = true;
                showPhase('config');
                showUndoBanner();
                saveState();
                clearStateFile();

            } catch (error) {
                // Echec — undo automatique des sequences partiellement creees
                loadingScreen.setMessage(SMART_CUT_MESSAGES.CREATING_ROLLBACK);

                if (state.createdSequences.length > 0) {
                    try {
                        await premiereAsync.undoSmartCut(state.createdSequences);
                    } catch (undoError) {
                        ErrorHandler.handle(undoError, 'SmartCut', SMART_CUT_MESSAGES.UNDO_ERROR.replace('{error}', undoError.message));
                    }
                }

                loadingScreen.hide();
                state.createdSequences = [];
                state.undoAvailable = false;
                ErrorHandler.handle(error, 'SmartCut', 'Erreur creation sequences');
                window.notifications.error(error.message);
                showPhase('review');
                saveState();
            }
        });
    }

    // 14. Événement bouton Annuler tout
    var cancelAllBtn = document.getElementById('SmartCutCancelAll');
    if (cancelAllBtn) {
        cancelAllBtn.addEventListener('click', function () {
            state.segments = [];
            var reviewZone = document.getElementById('ReviewZone');
            if (reviewZone) reviewZone.innerHTML = '';
            var streamingZone = document.getElementById('StreamingZone');
            if (streamingZone) streamingZone.innerHTML = '';
            showPhase('config');
            saveState();
            clearStateFile();
        });
    }

    // 15. Événement bouton Relancer
    var relaunchBtn = document.getElementById('SmartCutRelaunch');
    if (relaunchBtn) {
        relaunchBtn.addEventListener('click', function () {
            state.segments = [];
            var reviewZone = document.getElementById('ReviewZone');
            if (reviewZone) reviewZone.innerHTML = '';
            var streamingZone = document.getElementById('StreamingZone');
            if (streamingZone) streamingZone.innerHTML = '';
            clearStateFile();
            // Re-cliquer le bouton Lancer pour relancer avec la meme intention
            var launchBtnEl = document.getElementById(COMPONENTS.SMART_CUT_LAUNCH);
            if (launchBtnEl) launchBtnEl.click();
        });
    }

    // 16. Événement bouton Undo (UndoBanner)
    var undoBtn = document.getElementById(COMPONENTS.UNDO_BUTTON);
    if (undoBtn) {
        undoBtn.addEventListener('click', async function () {
            if (!state.undoAvailable || state.createdSequences.length === 0) return;

            try {
                var result = await premiereAsync.undoSmartCut(state.createdSequences);
                if (result.error) throw new Error(result.error);
                window.notifications.success(SMART_CUT_MESSAGES.UNDO_SUCCESS.replace('{count}', String(state.createdSequences.length)));
                hideUndoBanner();
                showPhase('config');
            } catch (error) {
                ErrorHandler.handle(error, 'SmartCut', SMART_CUT_MESSAGES.UNDO_ERROR.replace('{error}', error.message));
                window.notifications.error(SMART_CUT_MESSAGES.UNDO_ERROR.replace('{error}', error.message));
            }
        });
    }

    // 17. Initialiser auto-scroll
    initAutoScroll();

    // 18. Collapsible géré par collaps.js (chargé dans smartcut.html)

    // 19. Restaurer l'UndoBanner si undo disponible apres navigation
    if (state.undoAvailable && state.createdSequences.length > 0) {
        showUndoBanner();
    }

    // 20. Persistance avant changement de page
    window.addEventListener('beforeunload', function () {
        saveState();
        if (state.segments.length > 0) saveStateToFile();
    });

});
