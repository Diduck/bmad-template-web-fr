import NotificationSystem from '../components/NotificationSystem.js';
import ErrorHandler from '../utils/errorHandler.js';
import SequenceSelector from '../components/SequenceSelector.js';
import PremiereAsync from '../utils/premiereAsync.js';
import ProprietesService from '../services/propriete.js';
import { PROPRIETE } from '../utils/constants.js';

// ============================================================================
// Variables globales
// ============================================================================

var premiereAsync = null;
var service = null;
var currentClips = null;
var currentMergedProps = null;
var isLoading = false;
var seqWidth = 1920;
var seqHeight = 1080;

// Stockage des valeurs éditées (propIndex → value)
var editedValues = {};

// Arrow image path (relative from propriete.html)
var ARROW_IMG = '../../assets/images/arrow.png';

// ============================================================================
// Drag Value — système global
// ============================================================================

var dragState = null;

document.addEventListener('mousemove', function(e) {
    if (!dragState) return;
    e.preventDefault();
    var dx = e.clientX - dragState.startX;
    var sensitivity = e.shiftKey ? 0.1 : 1;
    var newVal = dragState.startValue + dx * sensitivity;
    if (dragState.step >= 1) newVal = Math.round(newVal);
    dragState.el.textContent = formatDragValue(newVal, dragState.suffix);
    dragState.el.dataset.value = newVal;
    dragState.currentValue = newVal;
    // Callback custom (ex: font size) ou stockage standard
    if (dragState.onUpdate) {
        dragState.onUpdate(newVal);
    } else {
        var propIdx = parseInt(dragState.el.dataset.propIndex, 10);
        var arrIdx = dragState.el.dataset.arrayIndex;
        if (arrIdx !== undefined && arrIdx !== '') {
            if (!editedValues[propIdx]) editedValues[propIdx] = {};
            editedValues[propIdx][parseInt(arrIdx, 10)] = newVal;
        } else {
            editedValues[propIdx] = newVal;
        }
    }
});

document.addEventListener('mouseup', function() {
    if (dragState) {
        document.body.style.cursor = '';
        document.body.classList.remove('dragging');
        dragState = null;
    }
});

function formatDragValue(val, suffix) {
    var rounded = Math.round(val * 10) / 10;
    if (rounded === Math.round(rounded)) rounded = Math.round(rounded);
    return String(rounded) + (suffix || '');
}

function createDragValue(value, propIndex, opts) {
    opts = opts || {};
    var suffix = opts.suffix || '';
    var step = opts.step || 1;
    var arrayIndex = opts.arrayIndex;
    var label = opts.label || '';

    var wrapper = document.createElement('span');
    wrapper.className = 'drag-value-wrapper';

    var span = document.createElement('span');
    span.className = 'drag-value';
    span.textContent = formatDragValue(value, suffix);
    span.dataset.value = value;
    span.dataset.propIndex = propIndex;
    if (arrayIndex !== undefined) span.dataset.arrayIndex = arrayIndex;
    span.title = 'Glisser pour modifier, double-clic pour éditer';

    // Mousedown → start drag
    span.addEventListener('mousedown', function(e) {
        if (e.detail >= 2) return; // ignore dblclick mousedown
        e.preventDefault();
        dragState = {
            el: span,
            startX: e.clientX,
            startValue: parseFloat(span.dataset.value) || 0,
            currentValue: parseFloat(span.dataset.value) || 0,
            step: step,
            suffix: suffix
        };
        document.body.style.cursor = 'ew-resize';
        document.body.classList.add('dragging');
    });

    // Dblclick → edit mode
    span.addEventListener('dblclick', function() {
        var input = document.createElement('input');
        input.type = 'number';
        input.className = 'drag-value-edit';
        input.value = parseFloat(span.dataset.value) || 0;
        input.step = step < 1 ? '0.1' : '1';
        span.style.display = 'none';
        span.parentElement.insertBefore(input, span.nextSibling);
        input.focus();
        input.select();

        function finishEdit() {
            var newVal = parseFloat(input.value);
            if (!isNaN(newVal)) {
                span.dataset.value = newVal;
                span.textContent = formatDragValue(newVal, suffix);
                var pIdx = parseInt(span.dataset.propIndex, 10);
                var aIdx = span.dataset.arrayIndex;
                if (aIdx !== undefined && aIdx !== '') {
                    if (!editedValues[pIdx]) editedValues[pIdx] = {};
                    editedValues[pIdx][parseInt(aIdx, 10)] = newVal;
                } else {
                    editedValues[pIdx] = newVal;
                }
            }
            span.style.display = '';
            if (input.parentElement) input.remove();
        }

        input.addEventListener('blur', finishEdit);
        input.addEventListener('keydown', function(ev) {
            if (ev.key === 'Enter') { ev.preventDefault(); finishEdit(); }
            if (ev.key === 'Escape') { span.style.display = ''; input.remove(); }
        });
    });

    if (label) {
        var lbl = document.createElement('span');
        lbl.className = 'drag-value-label';
        lbl.textContent = label;
        wrapper.appendChild(span);
        wrapper.appendChild(lbl);
    } else {
        wrapper.appendChild(span);
    }

    return wrapper;
}

// ============================================================================
// Utilitaires couleur
// ============================================================================

function argbToHexRgb(argbStr) {
    var parts = argbStr.split(',');
    var r = parseInt(parts[1], 10);
    var g = parseInt(parts[2], 10);
    var b = parseInt(parts[3], 10);
    return '#' + hex2(r) + hex2(g) + hex2(b);
}

function hex2(n) {
    return ('0' + (n & 0xFF).toString(16)).slice(-2);
}

function hexToArgb(hex) {
    hex = hex.replace('#', '');
    var r = parseInt(hex.substring(0, 2), 16);
    var g = parseInt(hex.substring(2, 4), 16);
    var b = parseInt(hex.substring(4, 6), 16);
    var a = hex.length >= 8 ? parseInt(hex.substring(6, 8), 16) : 255;
    return [a, r, g, b];
}

// ============================================================================
// Utilitaire texte riche
// ============================================================================

function extractTextEditValue(jsonStr) {
    try {
        var obj = JSON.parse(jsonStr);
        return obj.textEditValue || '';
    } catch (e) {
        return jsonStr || '';
    }
}

// ============================================================================
// Détection des noms spéciaux
// ============================================================================

function isVisibilityProp(displayName) {
    var lower = displayName.toLowerCase();
    return lower.indexOf('visib') !== -1 || lower.indexOf('opaci') !== -1;
}

function isTriggerProp(displayName) {
    var lower = displayName.toLowerCase();
    return lower.indexOf('déclencheur') !== -1 || lower.indexOf('declencheur') !== -1 || lower.indexOf('trigger') !== -1 || lower.indexOf('apparition') !== -1;
}

function getUnitSuffix(displayName) {
    var lower = displayName.toLowerCase();
    if (lower.indexOf('rotation') !== -1 || lower.indexOf('angle') !== -1) return ' °';
    if (lower.indexOf('scale') !== -1 || lower.indexOf('échelle') !== -1 || lower.indexOf('echelon') !== -1) return ' %';
    if (lower.indexOf('opaci') !== -1 || lower.indexOf('intensi') !== -1) return ' %';
    return '';
}

// ============================================================================
// Rendu des propriétés
// ============================================================================

async function loadAndRender() {
    if (isLoading) return;
    isLoading = true;

    var container = document.getElementById(PROPRIETE.DOM.CONTAINER);
    var statusEl = document.getElementById(PROPRIETE.DOM.STATUS);
    var saveBtn = document.getElementById(PROPRIETE.DOM.SAVE_BTN);

    container.innerHTML = '<div class="propriete-loading"><p>Chargement des propriétés...</p></div>';
    saveBtn.disabled = true;
    editedValues = {};

    try {
        var data = await service.loadProperties();

        if (data.sequenceWidth) seqWidth = data.sequenceWidth;
        if (data.sequenceHeight) seqHeight = data.sequenceHeight;

        if (data.clipCount === 0) {
            container.innerHTML = '<div class="propriete-empty">' +
                '<p>Sélectionnez des clips MOGRT dans la timeline Premiere Pro</p>' +
                '<p class="desc">Les propriétés des clips sélectionnés s\'afficheront ici</p></div>';
            statusEl.textContent = '';
            return;
        }

        if (data.clipCount > PROPRIETE.MAX_CLIPS_WARNING) {
            window.notifications.warning('Beaucoup de clips sélectionnés (' + data.clipCount + '), le chargement peut être lent');
        }

        if (!data.templateMatch) {
            container.innerHTML = '<div class="propriete-error">' +
                '<p>Les clips sélectionnés utilisent des templates différents.</p>' +
                '<p class="desc">Sélectionnez des MOGRTs identiques.</p></div>';
            statusEl.textContent = data.clipCount + ' clips sélectionnés (templates mixtes)';
            return;
        }

        currentClips = data.clips;
        renderProperties(data.clips);
        statusEl.textContent = data.clipCount + ' clip' + (data.clipCount > 1 ? 's' : '') + ' sélectionné' + (data.clipCount > 1 ? 's' : '');

    } catch (err) {
        container.innerHTML = '';
        var errDiv = document.createElement('div');
        errDiv.className = 'propriete-error';
        var errP = document.createElement('p');
        errP.textContent = err.message;
        errDiv.appendChild(errP);
        container.appendChild(errDiv);
        statusEl.textContent = '';
        ErrorHandler.handle(err, 'Propriete.loadAndRender', 'Erreur lors du chargement des propriétés');
    } finally {
        isLoading = false;
    }
}

// ============================================================================
// Construction de la structure groupée
// ============================================================================

/**
 * Compte le nombre d'enfants directs d'un groupe à partir de ses GUIDs
 * La valeur d'un groupe est une chaîne de GUIDs séparés par ";"
 */
function countGroupChildren(groupValue) {
    if (!groupValue || typeof groupValue !== 'string') return 0;
    var parts = groupValue.split(';');
    var count = 0;
    for (var i = 0; i < parts.length; i++) {
        if (parts[i].trim().length > 0) count++;
    }
    return count;
}

/**
 * Construit la structure hiérarchique des propriétés.
 * Utilise le nombre de GUIDs dans chaque groupe pour déterminer
 * combien de propriétés lui appartiennent.
 * Seuls les sous-groupes (ex: GLOW) sont imbriqués dans leur parent.
 */
function buildGroupStructure(mergedProps) {
    var result = [];
    var i = 0;

    // Annoter les indices
    for (var k = 0; k < mergedProps.length; k++) {
        mergedProps[k]._index = k;
    }

    while (i < mergedProps.length) {
        var prop = mergedProps[i];

        if (prop.type === PROPRIETE.TYPES.GROUP) {
            var group = { prop: prop, children: [] };
            var childCount = countGroupChildren(prop.mergedValue);
            i++;
            var consumed = 0;

            while (i < mergedProps.length && consumed < childCount) {
                var child = mergedProps[i];

                if (child.type === PROPRIETE.TYPES.GROUP) {
                    // Sous-groupe (ex: GLOW dans TEXT 1)
                    var subgroup = { prop: child, children: [] };
                    var subChildCount = countGroupChildren(child.mergedValue);
                    i++;
                    consumed++; // le sous-groupe compte comme 1 enfant du parent

                    var subConsumed = 0;
                    while (i < mergedProps.length && subConsumed < subChildCount) {
                        subgroup.children.push({ prop: mergedProps[i] });
                        i++;
                        subConsumed++;
                    }

                    group.children.push(subgroup);
                } else {
                    group.children.push({ prop: child });
                    i++;
                    consumed++;
                }
            }

            result.push(group);
        } else {
            // Propriété orpheline (pas dans un groupe)
            result.push({ prop: prop });
            i++;
        }
    }

    return { children: result };
}

function renderProperties(clips) {
    var container = document.getElementById(PROPRIETE.DOM.CONTAINER);
    var saveBtn = document.getElementById(PROPRIETE.DOM.SAVE_BTN);

    currentMergedProps = service.mergePropertyValues(clips);
    container.innerHTML = '';
    editedValues = {};

    var structure = buildGroupStructure(currentMergedProps);
    renderGroupChildren(container, structure.children, clips, 0);

    // Init Coloris pour les color swatches
    if (typeof Coloris !== 'undefined') {
        Coloris({
            el: '.prop-color-hidden-input',
            theme: 'polaroid',
            themeMode: 'dark',
            alpha: true,
            format: 'hex',
            formatToggle: false,
            swatches: []
        });
    }

    saveBtn.disabled = false;
}

function renderGroupChildren(container, children, clips, depth) {
    // Séparer les propriétés en paires flexibles
    var i = 0;
    while (i < children.length) {
        var child = children[i];

        // C'est un groupe → collapse
        if (child.children) {
            renderCollapsibleGroup(container, child, clips, depth);
            i++;
            continue;
        }

        var prop = child.prop;
        var nextChild = (i + 1 < children.length && !children[i + 1].children) ? children[i + 1] : null;
        var nextProp = nextChild ? nextChild.prop : null;

        // Pairing : color + text → flex row
        if (prop.type === PROPRIETE.TYPES.COLOR && nextProp && nextProp.type === PROPRIETE.TYPES.TEXT) {
            var flexRow = document.createElement('div');
            flexRow.className = 'prop-flex-pair';
            renderSingleProperty(flexRow, prop, clips);
            renderSingleProperty(flexRow, nextProp, clips);
            container.appendChild(flexRow);
            i += 2;
            continue;
        }

        // Pairing : two numbers / number+visibility → flex row
        if (canFlexPair(prop, nextProp)) {
            var flexRow2 = document.createElement('div');
            flexRow2.className = 'prop-flex-pair';
            renderSingleProperty(flexRow2, prop, clips);
            renderSingleProperty(flexRow2, nextProp, clips);
            container.appendChild(flexRow2);
            i += 2;
            continue;
        }

        // Single property
        renderSingleProperty(container, prop, clips);
        i++;
    }
}

function canFlexPair(a, b) {
    if (!a || !b) return false;
    var aType = a.type;
    var bType = b.type;
    // Deux nombres consécutifs
    if (aType === PROPRIETE.TYPES.NUMBER && bType === PROPRIETE.TYPES.NUMBER) return true;
    // Nombre + boolean
    if (aType === PROPRIETE.TYPES.NUMBER && bType === PROPRIETE.TYPES.BOOLEAN) return true;
    if (aType === PROPRIETE.TYPES.BOOLEAN && bType === PROPRIETE.TYPES.NUMBER) return true;
    return false;
}

// ============================================================================
// Collapsible group
// ============================================================================

function isGlowGroup(displayName) {
    var lower = displayName.toLowerCase();
    return lower.indexOf('glow') !== -1 || lower.indexOf('lueur') !== -1 || lower.indexOf('shadow') !== -1 || lower.indexOf('ombre') !== -1;
}

function renderCollapsibleGroup(container, group, clips, depth) {
    var block = document.createElement('div');
    block.className = 'block-collaps prop-collaps-group' + (depth > 0 ? ' prop-collaps-nested' : '');

    var boxCollaps = document.createElement('div');
    boxCollaps.className = 'box-collaps';

    var title = document.createElement('p');
    title.textContent = group.prop.displayName;
    boxCollaps.appendChild(title);

    // GLOW et effets similaires : fermés par défaut, le reste : ouvert
    var startOpen = !isGlowGroup(group.prop.displayName);

    var btn = document.createElement('button');
    btn.className = 'collapsible' + (startOpen ? ' active' : '');
    var arrow = document.createElement('img');
    arrow.src = ARROW_IMG;
    arrow.alt = '';
    btn.appendChild(arrow);
    boxCollaps.appendChild(btn);

    block.appendChild(boxCollaps);

    var content = document.createElement('div');
    content.className = 'content';
    content.style.display = startOpen ? 'block' : 'none';

    renderGroupChildren(content, group.children, clips, depth + 1);

    block.appendChild(content);
    container.appendChild(block);
}

// ============================================================================
// Rendu d'une propriété individuelle
// ============================================================================

function renderSingleProperty(container, prop, clips) {
    var row = document.createElement('div');
    row.className = 'prop-row';
    row.dataset.propIndex = prop.propIndex;
    row.dataset.mergedIndex = prop._index;

    var label = document.createElement('div');
    label.className = 'prop-label';
    label.textContent = prop.displayName;
    label.title = prop.displayName;
    row.appendChild(label);

    var control = document.createElement('div');
    control.className = 'prop-control';

    switch (prop.type) {
        case PROPRIETE.TYPES.TEXT:
            control.appendChild(createTextArea(prop));
            break;
        case PROPRIETE.TYPES.COLOR:
            control.appendChild(createColorSwatch(prop));
            break;
        case PROPRIETE.TYPES.NUMBER:
            if (isVisibilityProp(prop.displayName)) {
                control.appendChild(createVisibilityCheckbox(prop));
            } else if (isTriggerProp(prop.displayName)) {
                control.appendChild(createRangeSlider(prop));
            } else {
                control.appendChild(createDragNumber(prop));
            }
            break;
        case PROPRIETE.TYPES.POSITION:
            control.appendChild(createPositionDrag(prop, clips));
            break;
        case PROPRIETE.TYPES.ARRAY:
            control.appendChild(createArrayDrag(prop, clips));
            break;
        case PROPRIETE.TYPES.BOOLEAN:
            control.appendChild(createBooleanInput(prop));
            break;
        default:
            control.appendChild(createUnknownInput(prop));
            break;
    }

    row.appendChild(control);
    container.appendChild(row);
}

// ============================================================================
// Composants de contrôle
// ============================================================================

// Liste de polices courantes pour le select
var COMMON_FONTS = [
    'Arial', 'Arial-Bold', 'Arial-BoldItalic', 'Arial-Italic',
    'Helvetica', 'Helvetica-Bold', 'HelveticaNeue', 'HelveticaNeue-Bold',
    'TimesNewRomanPS-BoldMT', 'TimesNewRomanPSMT',
    'Georgia', 'Georgia-Bold', 'Verdana', 'Verdana-Bold',
    'TrebuchetMS', 'TrebuchetMS-Bold', 'CourierNewPS-BoldMT',
    'Impact', 'Tahoma', 'Tahoma-Bold',
    'Futura-Medium', 'Futura-Bold', 'Futura-CondensedExtraBold',
    'AvenirNext-Bold', 'AvenirNext-DemiBold', 'AvenirNext-Regular',
    'Montserrat-Bold', 'Montserrat-Regular', 'Montserrat-SemiBold',
    'Roboto-Bold', 'Roboto-Regular', 'Roboto-Medium',
    'OpenSans-Bold', 'OpenSans-Regular', 'OpenSans-SemiBold',
    'Lato-Bold', 'Lato-Regular', 'Oswald-Bold', 'Oswald-Regular',
    'Raleway-Bold', 'Raleway-Regular', 'Poppins-Bold', 'Poppins-Regular',
    'BebasNeue-Regular', 'Gotham-Bold', 'Gotham-Book', 'Gotham-Medium',
    'ProximaNova-Bold', 'ProximaNova-Regular'
];

function ensureEditEntry(propIndex, isRichText) {
    if (!editedValues[propIndex]) {
        editedValues[propIndex] = { isRichText: isRichText || false };
    }
    if (!editedValues[propIndex].fontChanges) {
        editedValues[propIndex].fontChanges = {};
    }
    return editedValues[propIndex];
}

function createTextArea(prop) {
    var wrapper = document.createElement('div');
    wrapper.className = 'prop-text-wrapper';

    // Toolbar de police pour tous les textes (riche ou non)
    if (prop.mergedValue && !prop.isMixed) {
        var toolbar = buildFontToolbar(prop);
        if (toolbar) wrapper.appendChild(toolbar);
    }

    var textarea = document.createElement('textarea');
    textarea.className = 'prop-textarea';
    textarea.setAttribute('data-prop-index', prop.propIndex);
    textarea.rows = 2;
    textarea.setAttribute('data-rich-text', '1');

    if (prop.isMixed) {
        textarea.placeholder = PROPRIETE.MIXED_VALUE_PLACEHOLDER;
    } else {
        if (prop.isRichText && prop.mergedValue) {
            textarea.value = extractTextEditValue(prop.mergedValue);
        } else {
            textarea.value = prop.mergedValue || '';
        }
    }

    textarea.addEventListener('input', function() {
        var entry = ensureEditEntry(prop.propIndex, true);
        entry.text = textarea.value;
    });

    wrapper.appendChild(textarea);
    return wrapper;
}

function buildFontToolbar(prop) {
    try {
        var obj = null;
        try { obj = JSON.parse(prop.mergedValue); } catch (ep) { /* plain text */ }

        // Valeurs par défaut si JSON manquant ou incomplet (texte ajouté par le plugin)
        var currentFont = (obj && obj.fontEditValue) ? (obj.fontEditValue[0] || '') : '';
        var currentSize = (obj && obj.fontSizeEditValue && obj.fontSizeEditValue[0]) ? obj.fontSizeEditValue[0] : 24;
        var isBold = obj && obj.fontFSBoldValue && obj.fontFSBoldValue[0];
        var isItalic = obj && obj.fontFSItalicValue && obj.fontFSItalicValue[0];
        var isAllCaps = obj && obj.fontFSAllCapsValue && obj.fontFSAllCapsValue[0];
        var isSmallCaps = obj && obj.fontFSSmallCapsValue && obj.fontFSSmallCapsValue[0];

        var bar = document.createElement('div');
        bar.className = 'prop-font-toolbar';

        // ---- Input police avec dropdown custom filtrable ----
        var fontWrap = document.createElement('div');
        fontWrap.className = 'prop-font-select-wrap';

        var fontInput = document.createElement('input');
        fontInput.type = 'text';
        fontInput.className = 'prop-font-input';
        fontInput.value = currentFont;
        fontInput.placeholder = 'Police...';

        var dropdown = document.createElement('div');
        dropdown.className = 'prop-font-dropdown';

        // Polices système (chargées dans propriete.html) ou fallback
        var fontList = (window.systemFonts && window.systemFonts.length > 0) ? window.systemFonts : COMMON_FONTS;
        if (currentFont && fontList.indexOf(currentFont) === -1) {
            fontList = [currentFont].concat(fontList);
        }

        function populateDropdown(filter) {
            dropdown.innerHTML = '';
            var lower = (filter || '').toLowerCase();
            var count = 0;
            for (var fi = 0; fi < fontList.length; fi++) {
                if (lower && fontList[fi].toLowerCase().indexOf(lower) === -1) continue;
                if (count >= 80) break; // limiter pour la performance
                var item = document.createElement('div');
                item.className = 'prop-font-dropdown-item';
                item.textContent = fontList[fi];
                item.dataset.font = fontList[fi];
                item.addEventListener('mousedown', function(ev) {
                    ev.preventDefault(); // empêcher le blur de l'input
                    fontInput.value = this.dataset.font;
                    dropdown.style.display = 'none';
                    var entry = ensureEditEntry(prop.propIndex, true);
                    entry.fontChanges.fontName = this.dataset.font;
                });
                dropdown.appendChild(item);
                count++;
            }
        }

        fontInput.addEventListener('focus', function() {
            populateDropdown(fontInput.value);
            dropdown.style.display = 'block';
        });

        fontInput.addEventListener('input', function() {
            populateDropdown(fontInput.value);
            dropdown.style.display = 'block';
        });

        fontInput.addEventListener('blur', function() {
            dropdown.style.display = 'none';
            var entry = ensureEditEntry(prop.propIndex, true);
            entry.fontChanges.fontName = fontInput.value;
        });

        fontWrap.appendChild(fontInput);
        fontWrap.appendChild(dropdown);
        bar.appendChild(fontWrap);

        // ---- Taille — draggable value avec onUpdate callback ----
        var pIdx = prop.propIndex;
        var sizeSpan = document.createElement('span');
        sizeSpan.className = 'drag-value';
        sizeSpan.textContent = Math.round(currentSize) + 'px';
        sizeSpan.dataset.value = currentSize;
        sizeSpan.title = 'Glisser pour modifier, double-clic pour éditer';

        sizeSpan.addEventListener('mousedown', function(e) {
            if (e.detail >= 2) return;
            e.preventDefault();
            dragState = {
                el: sizeSpan,
                startX: e.clientX,
                startValue: parseFloat(sizeSpan.dataset.value) || 0,
                currentValue: parseFloat(sizeSpan.dataset.value) || 0,
                step: 1,
                suffix: 'px',
                onUpdate: function(val) {
                    var entry = ensureEditEntry(pIdx, true);
                    entry.fontChanges.fontSize = Math.round(val);
                }
            };
            document.body.style.cursor = 'ew-resize';
            document.body.classList.add('dragging');
        });

        sizeSpan.addEventListener('dblclick', function() {
            var input = document.createElement('input');
            input.type = 'number';
            input.className = 'drag-value-edit';
            input.value = parseFloat(sizeSpan.dataset.value) || 0;
            input.step = '1';
            sizeSpan.style.display = 'none';
            sizeSpan.parentElement.insertBefore(input, sizeSpan.nextSibling);
            input.focus();
            input.select();

            function finishEdit() {
                var newVal = parseFloat(input.value);
                if (!isNaN(newVal)) {
                    sizeSpan.dataset.value = newVal;
                    sizeSpan.textContent = Math.round(newVal) + 'px';
                    var entry = ensureEditEntry(pIdx, true);
                    entry.fontChanges.fontSize = Math.round(newVal);
                }
                sizeSpan.style.display = '';
                if (input.parentElement) input.remove();
            }
            input.addEventListener('blur', finishEdit);
            input.addEventListener('keydown', function(ev) {
                if (ev.key === 'Enter') { ev.preventDefault(); finishEdit(); }
                if (ev.key === 'Escape') { sizeSpan.style.display = ''; input.remove(); }
            });
        });

        var sizeWrap = document.createElement('span');
        sizeWrap.className = 'prop-font-size-drag';
        sizeWrap.appendChild(sizeSpan);
        bar.appendChild(sizeWrap);

        // ---- Séparateur ----
        var sep = document.createElement('span');
        sep.className = 'prop-font-sep';
        sep.textContent = '|';
        bar.appendChild(sep);

        // ---- Badges de style cliquables ----
        var badgeConfigs = [
            { key: 'bold', label: 'B', active: isBold },
            { key: 'italic', label: 'I', active: isItalic },
            { key: 'allCaps', label: 'AA', active: isAllCaps },
            { key: 'smallCaps', label: 'aA', active: isSmallCaps }
        ];

        for (var bi = 0; bi < badgeConfigs.length; bi++) {
            (function(cfg) {
                var badge = document.createElement('span');
                badge.className = 'prop-font-badge' + (cfg.active ? ' active' : '');
                badge.textContent = cfg.label;
                if (cfg.key === 'bold') badge.style.fontWeight = 'bold';
                if (cfg.key === 'italic') badge.style.fontStyle = 'italic';
                badge.title = cfg.label;

                badge.addEventListener('click', function() {
                    var isActive = badge.classList.toggle('active');
                    var entry = ensureEditEntry(pIdx, true);
                    entry.fontChanges[cfg.key] = isActive;
                });

                bar.appendChild(badge);
            })(badgeConfigs[bi]);
        }

        return bar;
    } catch (e) {
        return null;
    }
}

function createColorSwatch(prop) {
    var hexVal = '#ffffff';
    if (!prop.isMixed && prop.mergedValue) {
        hexVal = argbToHexRgb(prop.mergedValue);
    }

    var wrapper = document.createElement('div');
    wrapper.className = 'prop-color-swatch-only';

    var swatch = document.createElement('div');
    swatch.className = 'prop-color-swatch';
    swatch.style.backgroundColor = hexVal;
    swatch.dataset.propIndex = prop.propIndex;

    // Input caché pour Coloris
    var hiddenInput = document.createElement('input');
    hiddenInput.type = 'text';
    hiddenInput.className = 'prop-color-hidden-input';
    hiddenInput.setAttribute('data-coloris', '');
    hiddenInput.value = hexVal;

    swatch.addEventListener('click', function() {
        hiddenInput.click();
        hiddenInput.focus();
    });

    hiddenInput.addEventListener('input', function() {
        swatch.style.backgroundColor = hiddenInput.value;
        editedValues[prop.propIndex] = { color: hiddenInput.value };
    });

    wrapper.appendChild(swatch);
    wrapper.appendChild(hiddenInput);
    return wrapper;
}

function createDragNumber(prop) {
    var val = prop.isMixed ? 0 : (parseFloat(prop.mergedValue) || 0);
    var suffix = getUnitSuffix(prop.displayName);
    return createDragValue(val, prop.propIndex, { suffix: suffix, step: 1 });
}

function createPositionDrag(prop, clips) {
    var wrapper = document.createElement('div');
    wrapper.className = 'prop-position-drag';

    var labels = ['X', 'Y', 'Z', 'W'];
    var elementCount = 2;
    var rawVals = [];

    if (!prop.isMixed && prop.mergedValue) {
        rawVals = String(prop.mergedValue).split(',');
        elementCount = rawVals.length;
    } else if (prop.isMixed && clips && clips.length > 0) {
        for (var ci = 0; ci < clips.length; ci++) {
            var clipProp = clips[ci].properties[prop._index];
            if (clipProp && clipProp.value !== null) {
                elementCount = String(clipProp.value).split(',').length;
                break;
            }
        }
    }

    for (var a = 0; a < elementCount; a++) {
        var dim = (a === 0) ? seqWidth : seqHeight;
        var pxVal = rawVals[a] ? Math.round(parseFloat(rawVals[a]) * dim) : 0;
        var dv = createDragValue(pxVal, prop.propIndex, {
            label: labels[a] || String(a),
            step: 1,
            arrayIndex: a
        });
        wrapper.appendChild(dv);
    }

    return wrapper;
}

function createArrayDrag(prop, clips) {
    var wrapper = document.createElement('div');
    wrapper.className = 'prop-position-drag';

    var labels = ['X', 'Y', 'Z', 'W'];
    var elementCount = 2;
    var values = [];

    if (!prop.isMixed && prop.mergedValue) {
        values = String(prop.mergedValue).split(',');
        elementCount = values.length;
    } else if (prop.isMixed && clips && clips.length > 0) {
        for (var ci = 0; ci < clips.length; ci++) {
            var clipProp = clips[ci].properties[prop._index];
            if (clipProp && clipProp.value !== null) {
                elementCount = String(clipProp.value).split(',').length;
                break;
            }
        }
    }

    for (var a = 0; a < elementCount; a++) {
        var val = values[a] ? parseFloat(values[a]) : 0;
        var suffix = getUnitSuffix(prop.displayName);
        var dv = createDragValue(val, prop.propIndex, {
            label: labels[a] || String(a),
            step: 1,
            suffix: suffix,
            arrayIndex: a
        });
        wrapper.appendChild(dv);
    }

    return wrapper;
}

function createVisibilityCheckbox(prop) {
    var wrapper = document.createElement('div');
    wrapper.className = 'prop-checkbox-wrapper';

    var input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'checkbox';
    input.dataset.propIndex = prop.propIndex;

    if (!prop.isMixed) {
        var val = parseFloat(prop.mergedValue) || 0;
        input.checked = val >= 50;
    }

    var checkmark = document.createElement('div');
    checkmark.className = 'checkmark';

    input.addEventListener('change', function() {
        editedValues[prop.propIndex] = input.checked ? 100 : 0;
    });

    wrapper.appendChild(input);
    wrapper.appendChild(checkmark);
    return wrapper;
}

function createRangeSlider(prop) {
    var wrapper = document.createElement('div');
    wrapper.className = 'prop-range-wrapper';

    var val = prop.isMixed ? 0 : (parseFloat(prop.mergedValue) || 0);

    var range = document.createElement('input');
    range.type = 'range';
    range.className = 'prop-range';
    range.min = '0';
    range.max = '100';
    range.step = '1';
    range.value = val;
    range.dataset.propIndex = prop.propIndex;

    var valueLabel = document.createElement('span');
    valueLabel.className = 'prop-range-value';
    valueLabel.textContent = Math.round(val);

    range.addEventListener('input', function() {
        valueLabel.textContent = Math.round(range.value);
        editedValues[prop.propIndex] = parseFloat(range.value);
    });

    wrapper.appendChild(range);
    wrapper.appendChild(valueLabel);
    return wrapper;
}

function createBooleanInput(prop) {
    var wrapper = document.createElement('div');
    wrapper.className = 'prop-checkbox-wrapper';

    var input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'checkbox';
    input.dataset.propIndex = prop.propIndex;

    if (!prop.isMixed && prop.mergedValue) {
        input.checked = prop.mergedValue === true || prop.mergedValue === 'true';
    }

    var checkmark = document.createElement('div');
    checkmark.className = 'checkmark';

    input.addEventListener('change', function() {
        editedValues[prop.propIndex] = input.checked;
    });

    wrapper.appendChild(input);
    wrapper.appendChild(checkmark);
    return wrapper;
}

function createUnknownInput(prop) {
    var span = document.createElement('span');
    span.className = 'prop-unknown-value';
    span.textContent = prop.mergedValue !== null ? String(prop.mergedValue) : '—';
    return span;
}

// ============================================================================
// Gestion Save / Undo / Refresh
// ============================================================================

async function handleSave() {
    if (!currentClips || !currentMergedProps) return;

    var changes = [];

    for (var propIndex in editedValues) {
        if (!editedValues.hasOwnProperty(propIndex)) continue;
        var pIdx = parseInt(propIndex, 10);
        var edited = editedValues[pIdx];
        var prop = null;

        // Trouver la prop correspondante
        for (var mi = 0; mi < currentMergedProps.length; mi++) {
            if (currentMergedProps[mi].propIndex === pIdx) {
                prop = currentMergedProps[mi];
                break;
            }
        }
        if (!prop) continue;

        var change = null;

        if (prop.type === PROPRIETE.TYPES.COLOR) {
            if (edited && edited.color) {
                change = { propIndex: pIdx, value: hexToArgb(edited.color), isColor: true };
            }
        } else if (prop.type === PROPRIETE.TYPES.TEXT) {
            if (edited && (typeof edited.text === 'string' || edited.fontChanges)) {
                // isRichText dès qu'il y a des fontChanges (même pour texte brut du plugin)
                var hasFont = edited.fontChanges && Object.keys(edited.fontChanges).length > 0;
                change = {
                    propIndex: pIdx,
                    value: edited.text !== undefined ? edited.text : null,
                    isRichText: edited.isRichText || hasFont || prop.isRichText || false
                };
                if (edited.fontChanges) {
                    change.fontChanges = edited.fontChanges;
                }
            }
        } else if (prop.type === PROPRIETE.TYPES.POSITION) {
            if (typeof edited === 'object' && !Array.isArray(edited)) {
                // Position : objet { 0: px, 1: px }
                var rawVals = prop.mergedValue ? String(prop.mergedValue).split(',') : [];
                var posArr = [];
                for (var pi = 0; pi < rawVals.length; pi++) {
                    if (edited[pi] !== undefined) {
                        posArr.push(edited[pi]);
                    } else {
                        var dim = (pi === 0) ? seqWidth : seqHeight;
                        posArr.push(Math.round(parseFloat(rawVals[pi]) * dim));
                    }
                }
                change = { propIndex: pIdx, value: posArr, isPosition: true, seqWidth: seqWidth, seqHeight: seqHeight };
            }
        } else if (prop.type === PROPRIETE.TYPES.ARRAY) {
            if (typeof edited === 'object' && !Array.isArray(edited)) {
                var rawArr = prop.mergedValue ? String(prop.mergedValue).split(',') : [];
                var arrVals = [];
                for (var ai = 0; ai < rawArr.length; ai++) {
                    arrVals.push(edited[ai] !== undefined ? edited[ai] : parseFloat(rawArr[ai]) || 0);
                }
                change = { propIndex: pIdx, value: arrVals, isColor: false };
            }
        } else if (prop.type === PROPRIETE.TYPES.BOOLEAN) {
            change = { propIndex: pIdx, value: edited, isColor: false };
        } else if (prop.type === PROPRIETE.TYPES.NUMBER) {
            change = { propIndex: pIdx, value: edited, isColor: false };
        }

        if (change) changes.push(change);
    }

    if (changes.length === 0) {
        window.notifications.success('Aucune modification détectée');
        return;
    }

    try {
        service.createSnapshot(currentClips);
        var result = await service.applyChanges(changes, currentClips);

        if (result.success) {
            window.notifications.success('Modifications appliquées (' + result.applied + ' propriétés)');
            document.getElementById(PROPRIETE.DOM.UNDO_BTN).classList.add('active');
        } else {
            window.notifications.error('Erreur: ' + (result.error || 'Inconnue'));
        }

        await loadAndRender();
    } catch (err) {
        ErrorHandler.handle(err, 'Propriete.handleSave', 'Erreur lors de la sauvegarde');
    }
}

async function handleUndo() {
    if (!service.hasUndo()) return;

    try {
        var result = await service.applyUndo();
        if (result.success) {
            window.notifications.success('Modifications annulées');
            document.getElementById(PROPRIETE.DOM.UNDO_BTN).classList.remove('active');
        } else {
            window.notifications.error('Erreur: ' + (result.error || 'Inconnue'));
        }
        await loadAndRender();
    } catch (err) {
        ErrorHandler.handle(err, 'Propriete.handleUndo', 'Erreur lors de l\'annulation');
    }
}

// ============================================================================
// Initialisation
// ============================================================================

document.addEventListener('DOMContentLoaded', async function () {
    var csInterface = new CSInterface();
    var jsxPath = csInterface.getSystemPath(SystemPath.EXTENSION) + '/src/jsx/Premiere.jsx';
    var normalizedPath = jsxPath.replace(/\\/g, '/');

    try {
        csInterface.evalScript('$.evalFile("' + normalizedPath + '")', function (result) {
            if (result === 'EvalScript error.' || result === '') {
                ErrorHandler.handle(new Error('Échec chargement Premiere.jsx'), 'Propriete.init', 'Impossible de charger le moteur Premiere');
            }
        });
    } catch (e) {
        ErrorHandler.handle(e, 'Propriete.init', 'Erreur lors du chargement de Premiere.jsx');
    }

    window.notifications = new NotificationSystem();
    premiereAsync = new PremiereAsync(csInterface);
    service = new ProprietesService(premiereAsync);

    var sequenceSelector = new SequenceSelector('seqSelectorPopup');
    sequenceSelector.init();

    var seqToggleBtn = document.getElementById('seqSelectorToggle');
    if (seqToggleBtn) {
        seqToggleBtn.querySelector('.header-icon').addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            sequenceSelector.toggle();
        });
    }

    document.getElementById(PROPRIETE.DOM.SAVE_BTN).addEventListener('click', handleSave);
    document.getElementById(PROPRIETE.DOM.UNDO_BTN).addEventListener('click', handleUndo);
    document.getElementById(PROPRIETE.DOM.REFRESH_BTN).addEventListener('click', function() {
        loadAndRender();
    });

    // Polling sélection (2s)
    var lastSelectionSignature = '';
    setInterval(function() {
        if (isLoading) return;
        premiereAsync._evalWithTimeout('getSelectedMogrtProperties()', 5000).then(function(result) {
            try {
                var data = JSON.parse(result);
                var sig = data.clipCount + ':';
                if (data.clips) {
                    var ticks = [];
                    for (var i = 0; i < data.clips.length; i++) {
                        ticks.push(data.clips[i].startTicks);
                    }
                    sig += ticks.join(',');
                }
                if (sig !== lastSelectionSignature) {
                    lastSelectionSignature = sig;
                    loadAndRender();
                }
            } catch (e) { /* ignore polling errors */ }
        }).catch(function() { /* ignore */ });
    }, 2000);

    try {
        var sequences = await premiereAsync.getAllProjectSequences();
        sequenceSelector.loadSequences(sequences);
    } catch (e) {
        // Pas bloquant
    }

    await loadAndRender();
});
