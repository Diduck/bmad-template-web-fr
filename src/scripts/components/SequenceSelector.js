import Storage from '../utils/storage.js';
import { SELECTION_MODES } from '../utils/constants.js';

const STORAGE_KEY_MODE = 'sequenceSelectorMode';
const STORAGE_KEY_SELECTED = 'sequenceSelectorSelected';

class SequenceSelector {
    constructor(containerId) {
        this.containerId = containerId;
        this.mode = Storage.get(STORAGE_KEY_MODE, SELECTION_MODES.ACTIVE);
        this.selectedNames = Storage.get(STORAGE_KEY_SELECTED, []);
        if (!Array.isArray(this.selectedNames)) {
            this.selectedNames = [];
        }
        this.sequences = [];
        this.container = null;
        this.summaryEl = null;
        this.wrapper = null;
        this.toggleBtn = null;
        this._bound = {
            onModeChange: this._onModeChange.bind(this),
            onCheckboxChange: this._onCheckboxChange.bind(this),
            onSelectAll: this._onSelectAll.bind(this),
            onDeselectAll: this._onDeselectAll.bind(this),
            handleSearch: this._handleSearch.bind(this),
            clearSearch: this._clearSearch.bind(this)
        };
    }

    init() {
        this.container = document.getElementById(this.containerId);
        if (!this.container) return;
        this.summaryEl = document.getElementById('statusBarText');
        this.wrapper = document.getElementById('seqSelectorToggle');
        this._render();
        this._attachEvents();
        this._initOutsideClick();
    }

    toggle() {
        if (!this.container) return;
        var isHidden = this.container.style.display === 'none';
        this.container.style.display = isHidden ? 'block' : 'none';
        var btn = this.wrapper ? this.wrapper.querySelector('.header-icon') : null;
        if (btn) {
            btn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
        }
    }

    close() {
        if (!this.container) return;
        this.container.style.display = 'none';
        var btn = this.wrapper ? this.wrapper.querySelector('.header-icon') : null;
        if (btn) {
            btn.setAttribute('aria-expanded', 'false');
        }
    }

    _initOutsideClick() {
        var self = this;
        document.addEventListener('click', function(e) {
            if (!self.container || self.container.style.display === 'none') return;
            var wrapper = self.wrapper || self.container.parentElement;
            if (wrapper && !wrapper.contains(e.target)) {
                self.close();
            }
        });
    }

    loadSequences(sequences) {
        var list = Array.isArray(sequences) ? sequences : [];
        this.sequences = list.filter(function(s) {
            return s.name && !s.name.startsWith('Rush_');
        });
        this._reconcileSelection();
        this._renderChecklist();
        this._updateVisibility();
        this._updateSummary();
    }

    getSelectedSequences() {
        if (this.mode === SELECTION_MODES.ACTIVE) {
            return null;
        }
        if (this.mode === SELECTION_MODES.ALL) {
            return this.sequences.map(function(s) { return s.name; });
        }
        return this.selectedNames.slice();
    }

    getMode() {
        return this.mode;
    }

    _reconcileSelection() {
        var availableNames = this.sequences.map(function(s) { return s.name; });
        this.selectedNames = this.selectedNames.filter(function(name) {
            return availableNames.indexOf(name) !== -1;
        });
        this._persistSelection();
    }

    _persistMode() {
        Storage.set(STORAGE_KEY_MODE, this.mode);
    }

    _persistSelection() {
        Storage.set(STORAGE_KEY_SELECTED, this.selectedNames);
    }

    _render() {
        this.container.innerHTML = '';

        var wrapper = document.createElement('div');
        wrapper.className = 'seq-selector';

        wrapper.innerHTML =
            '<div class="seq-selector-modes" role="radiogroup" aria-label="Mode de s\u00e9lection">' +
                '<label class="seq-mode-label">' +
                    '<input type="radio" name="seq-mode" value="' + SELECTION_MODES.ACTIVE + '"' +
                    (this.mode === SELECTION_MODES.ACTIVE ? ' checked' : '') + '>' +
                    '<span>S\u00e9quence active</span>' +
                '</label>' +
                '<label class="seq-mode-label">' +
                    '<input type="radio" name="seq-mode" value="' + SELECTION_MODES.ALL + '"' +
                    (this.mode === SELECTION_MODES.ALL ? ' checked' : '') + '>' +
                    '<span>Toutes les s\u00e9quences</span>' +
                '</label>' +
                '<label class="seq-mode-label">' +
                    '<input type="radio" name="seq-mode" value="' + SELECTION_MODES.CUSTOM + '"' +
                    (this.mode === SELECTION_MODES.CUSTOM ? ' checked' : '') + '>' +
                    '<span>S\u00e9lection personnalis\u00e9e</span>' +
                '</label>' +
            '</div>' +
            '<div class="seq-selector-actions" style="display:none;">' +
                '<button type="button" class="seq-btn-select-all">Tout s\u00e9lectionner</button>' +
                '<button type="button" class="seq-btn-deselect-all">Tout d\u00e9s\u00e9lectionner</button>' +
            '</div>' +
            '<div class="seq-search-wrapper" style="display:none;">' +
                '<input type="search" class="seq-search-input" placeholder="Rechercher..." aria-label="Rechercher des s\u00e9quences">' +
                '<button type="button" class="seq-search-clear" aria-label="Effacer la recherche" style="display:none;">\u00d7</button>' +
            '</div>' +
            '<div class="seq-selector-list" role="group" aria-label="S\u00e9lection de s\u00e9quences"></div>' +
            '<div class="seq-selector-empty" style="display:none;"></div>';

        this.container.appendChild(wrapper);
    }

    _attachEvents() {
        var self = this;

        var radios = this.container.querySelectorAll('input[name="seq-mode"]');
        for (var i = 0; i < radios.length; i++) {
            radios[i].addEventListener('change', this._bound.onModeChange);
        }

        var btnAll = this.container.querySelector('.seq-btn-select-all');
        if (btnAll) btnAll.addEventListener('click', this._bound.onSelectAll);

        var btnNone = this.container.querySelector('.seq-btn-deselect-all');
        if (btnNone) btnNone.addEventListener('click', this._bound.onDeselectAll);

        var searchInput = this.container.querySelector('.seq-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', this._bound.handleSearch);
            searchInput.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    self._clearSearch();
                    searchInput.blur();
                }
            });
        }

        var clearBtn = this.container.querySelector('.seq-search-clear');
        if (clearBtn) clearBtn.addEventListener('click', this._bound.clearSearch);
    }

    _onModeChange(e) {
        this.mode = e.target.value;
        this._persistMode();
        this._clearSearch();
        this._updateVisibility();
        this._updateSummary();
    }

    _onCheckboxChange(e) {
        var name = e.target.dataset.seqName;
        if (!name) return;

        if (e.target.checked) {
            if (this.selectedNames.indexOf(name) === -1) {
                this.selectedNames.push(name);
            }
        } else {
            var idx = this.selectedNames.indexOf(name);
            if (idx !== -1) {
                this.selectedNames.splice(idx, 1);
            }
        }
        this._persistSelection();
        this._updateSummary();
    }

    _onSelectAll() {
        this.selectedNames = this.sequences.map(function(s) { return s.name; });
        this._persistSelection();
        this._updateCheckboxes(true);
        this._updateSummary();
    }

    _onDeselectAll() {
        this.selectedNames = [];
        this._persistSelection();
        this._updateCheckboxes(false);
        this._updateSummary();
    }

    _updateCheckboxes(checked) {
        var checkboxes = this.container.querySelectorAll('.seq-item-checkbox');
        for (var i = 0; i < checkboxes.length; i++) {
            checkboxes[i].checked = checked;
        }
    }

    _handleSearch(e) {
        var query = e.target.value.toLowerCase();
        var items = this.container.querySelectorAll('.seq-item');
        var clearBtn = this.container.querySelector('.seq-search-clear');
        var emptyEl = this.container.querySelector('.seq-selector-empty');

        if (clearBtn) {
            clearBtn.style.display = query ? '' : 'none';
        }

        var visibleCount = 0;
        for (var i = 0; i < items.length; i++) {
            var nameEl = items[i].querySelector('.seq-item-name');
            var name = nameEl ? nameEl.textContent.toLowerCase() : '';
            var matches = name.indexOf(query) !== -1;
            items[i].style.display = matches ? '' : 'none';
            if (matches) visibleCount++;
        }

        if (emptyEl) {
            if (query && visibleCount === 0) {
                emptyEl.textContent = 'Aucun r\u00e9sultat';
                emptyEl.style.display = 'block';
            } else {
                emptyEl.style.display = 'none';
            }
        }
    }

    _clearSearch() {
        var searchInput = this.container.querySelector('.seq-search-input');
        if (searchInput) {
            searchInput.value = '';
        }
        var items = this.container.querySelectorAll('.seq-item');
        for (var i = 0; i < items.length; i++) {
            items[i].style.display = '';
        }
        var clearBtn = this.container.querySelector('.seq-search-clear');
        if (clearBtn) {
            clearBtn.style.display = 'none';
        }
        var emptyEl = this.container.querySelector('.seq-selector-empty');
        if (emptyEl) {
            emptyEl.style.display = 'none';
        }
    }

    _updateSummary() {
        if (!this.summaryEl) return;

        if (this.mode === SELECTION_MODES.ACTIVE) {
            this.summaryEl.textContent = '1 s\u00e9quence active';
            return;
        }

        if (this.mode === SELECTION_MODES.ALL) {
            var totalDuration = 0;
            for (var i = 0; i < this.sequences.length; i++) {
                totalDuration += this.sequences[i].duration || 0;
            }
            var count = this.sequences.length;
            this.summaryEl.textContent = count + ' s\u00e9quence' + (count > 1 ? 's' : '') +
                ' (' + this._formatDurationSummary(totalDuration) + ')';
            return;
        }

        // Mode personnalise
        var selectedCount = this.selectedNames.length;
        var totalCount = this.sequences.length;
        var selectedDuration = 0;
        for (var i = 0; i < this.sequences.length; i++) {
            if (this.selectedNames.indexOf(this.sequences[i].name) !== -1) {
                selectedDuration += this.sequences[i].duration || 0;
            }
        }

        if (selectedCount === 0) {
            this.summaryEl.textContent = '0/' + totalCount + ' s\u00e9quences';
        } else {
            this.summaryEl.textContent = selectedCount + '/' + totalCount +
                ' s\u00e9quence' + (selectedCount > 1 ? 's' : '') +
                ' (' + this._formatDurationSummary(selectedDuration) + ')';
        }
    }

    _formatDurationSummary(seconds) {
        if (!seconds || seconds <= 0) return '0s';
        var totalSec = Math.floor(seconds);
        var h = Math.floor(totalSec / 3600);
        var m = Math.floor((totalSec % 3600) / 60);
        var s = totalSec % 60;

        if (h > 0) {
            return h + 'h ' + (m < 10 ? '0' : '') + m + 'min';
        }
        if (m > 0) {
            return m + 'min ' + (s < 10 ? '0' : '') + s + 's';
        }
        return s + 's';
    }

    _renderChecklist() {
        var listEl = this.container.querySelector('.seq-selector-list');
        var emptyEl = this.container.querySelector('.seq-selector-empty');
        if (!listEl || !emptyEl) return;

        listEl.innerHTML = '';

        if (this.sequences.length === 0) {
            emptyEl.textContent = 'Aucune s\u00e9quence dans le projet';
            emptyEl.style.display = 'block';
            listEl.style.display = 'none';
            return;
        }

        emptyEl.style.display = 'none';
        listEl.style.display = '';

        for (var i = 0; i < this.sequences.length; i++) {
            var seq = this.sequences[i];
            var isChecked = this.selectedNames.indexOf(seq.name) !== -1;
            var durationStr = this._formatDuration(seq.duration);

            var row = document.createElement('label');
            row.className = 'seq-item';

            row.innerHTML =
                '<input type="checkbox" class="seq-item-checkbox" data-seq-name="' +
                this._escapeAttr(seq.name) + '"' +
                (isChecked ? ' checked' : '') + '>' +
                '<div class="checkmark"></div>' +
                '<span class="seq-item-name">' + this._escapeHtml(seq.name) + '</span>' +
                '<span class="seq-item-duration">' + durationStr + '</span>';

            row.querySelector('.seq-item-checkbox').addEventListener('change', this._bound.onCheckboxChange);
            listEl.appendChild(row);
        }
    }

    _updateVisibility() {
        var actionsEl = this.container.querySelector('.seq-selector-actions');
        var listEl = this.container.querySelector('.seq-selector-list');
        var searchWrapper = this.container.querySelector('.seq-search-wrapper');

        var showCustom = this.mode === SELECTION_MODES.CUSTOM;
        if (actionsEl) actionsEl.style.display = showCustom ? '' : 'none';
        if (listEl) listEl.style.display = showCustom ? '' : 'none';
        if (searchWrapper) searchWrapper.style.display = showCustom ? '' : 'none';
    }

    _formatDuration(seconds) {
        if (!seconds || seconds <= 0) return '0:00';
        var totalSec = Math.floor(seconds);
        var h = Math.floor(totalSec / 3600);
        var m = Math.floor((totalSec % 3600) / 60);
        var s = totalSec % 60;

        if (h > 0) {
            return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
        }
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    _escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    _escapeAttr(str) {
        return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
}

export default SequenceSelector;
