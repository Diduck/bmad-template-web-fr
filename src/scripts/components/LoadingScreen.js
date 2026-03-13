import { MESSAGES } from '../utils/constants.js';

/**
 * Loading screen manager
 */
class LoadingScreen {
    constructor() {
        this.loadingScreen = null;
        this.messageElement = null;
        this._fakeTimer = null;
        this._currentPercent = 0;
        this._lastDetail = '';
        this.ensureElements();
    }

    /**
     * Ensure loading screen elements exist
     */
    ensureElements() {
        this.loadingScreen = document.getElementById('loading-screen');

        if (!this.loadingScreen) {
            console.warn('Loading screen element not found');
            return;
        }

        this.ensureStyles();
        this.ensureMarkup();
        this.messageElement = this.loadingScreen.querySelector('.loading-msg');
    }

    /**
     * Ensure styles are injected
     */
    ensureStyles() {
        const styleId = 'productivity-loading-style';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
#loading-screen{
  position: fixed;
  inset: 0;
  z-index: 999999;
  background: rgba(0,0,0,.5);
  display: none;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}
#loading-screen.is-visible{ display:flex; }

body.productivity-is-loading{ overflow: hidden; }
body.productivity-is-loading > :not(#loading-screen){
  pointer-events: none;
  user-select: none;
}

#loading-screen .loading-card{
  background: rgba(20,20,20,.92);
  border: 1px solid rgba(255,255,255,.10);
  border-radius: 14px;
  padding: 20px 22px;
  min-width: 260px;
  max-width: 420px;
  text-align: center;
  box-shadow: 0 14px 50px rgba(0,0,0,.55);
}

#loading-screen .spinner{
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 4px solid rgba(255,255,255,.25);
  border-top-color: rgba(255,255,255,.95);
  animation: product-loading-spin .9s linear infinite;
  margin: 0 auto;
}

#loading-screen .step-indicator{
  margin-top: 14px;
  font: 600 11px/1.3 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  color: rgba(74,158,255,.85);
  letter-spacing: 1.2px;
  text-transform: uppercase;
  display: none;
}
#loading-screen .step-indicator.is-visible{ display: block; }

#loading-screen .loading-msg{
  margin-top: 6px;
  font: 600 14px/1.35 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  color: rgba(255,255,255,.92);
}

#loading-screen .progress-container{
  margin-top: 16px;
  width: 100%;
  display: none;
}

#loading-screen .progress-container.is-visible{ display: block; }

#loading-screen .progress-bar-bg{
  width: 100%;
  height: 6px;
  background: rgba(255,255,255,.12);
  border-radius: 3px;
  overflow: hidden;
}

#loading-screen .progress-bar-fill{
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #4a9eff, #6cb8ff);
  border-radius: 3px;
  transition: width .4s ease;
}

#loading-screen .progress-detail{
  margin-top: 8px;
  font: 400 12px/1.3 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  color: rgba(255,255,255,.55);
}

@keyframes product-loading-spin{ to{ transform: rotate(360deg); } }

#loading-screen .batch-list{
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 300px;
  overflow-y: auto;
  margin-top: 12px;
  text-align: left;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,.2) transparent;
}
#loading-screen .batch-list::-webkit-scrollbar{ width: 4px; }
#loading-screen .batch-list::-webkit-scrollbar-thumb{ background: rgba(255,255,255,.2); border-radius: 2px; }

#loading-screen .batch-item{
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255,255,255,.06);
}
#loading-screen .batch-item:last-child{ border-bottom: none; }

#loading-screen .batch-item-label{
  flex: 1;
  font: 400 12px/1.3 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  color: rgba(255,255,255,.7);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

#loading-screen .batch-item-bar{
  width: 80px;
  height: 4px;
  background: rgba(255,255,255,.12);
  border-radius: 2px;
  overflow: hidden;
  flex-shrink: 0;
}

#loading-screen .batch-item-fill{
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #4a9eff, #6cb8ff);
  border-radius: 2px;
  transition: width .3s ease;
}

#loading-screen .batch-item-status{
  width: 20px;
  text-align: center;
  font-size: 14px;
  flex-shrink: 0;
}

#loading-screen .batch-item-remove{
  background: none;
  border: none;
  color: rgba(255,255,255,.35);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
  line-height: 1;
  flex-shrink: 0;
  transition: color .2s;
}
#loading-screen .batch-item-remove:hover{ color: #ff5555; }
#loading-screen .batch-item-remove:disabled{ opacity: 0.3; cursor: default; }

#loading-screen .batch-item-removed{
  opacity: 0.3;
  text-decoration: line-through;
}
#loading-screen .batch-item-removed .batch-item-fill{ width: 0 !important; }

#loading-screen .batch-skip-btn{
  display: block;
  margin: 14px auto 0;
  padding: 8px 20px;
  background: rgba(255,255,255,.1);
  color: rgba(255,255,255,.7);
  border: 1px solid rgba(255,255,255,.15);
  border-radius: 6px;
  font: 400 12px/1.3 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  cursor: pointer;
  transition: background .2s, color .2s;
}
#loading-screen .batch-skip-btn:hover{
  background: rgba(255,255,255,.18);
  color: rgba(255,255,255,.9);
}
`;
        document.head.appendChild(style);
    }

    /**
     * Ensure markup exists
     */
    ensureMarkup() {
        if (!this.loadingScreen) return;
        if (this.loadingScreen.querySelector('.loading-card')) return;

        const card = document.createElement('div');
        card.className = 'loading-card';

        const spinner = document.createElement('div');
        spinner.className = 'spinner';

        const stepIndicator = document.createElement('div');
        stepIndicator.className = 'step-indicator';

        const msg = document.createElement('div');
        msg.className = 'loading-msg';
        msg.textContent = MESSAGES.LOADING_DEFAULT;

        const progressContainer = document.createElement('div');
        progressContainer.className = 'progress-container';

        const progressBg = document.createElement('div');
        progressBg.className = 'progress-bar-bg';

        const progressFill = document.createElement('div');
        progressFill.className = 'progress-bar-fill';

        const progressDetail = document.createElement('div');
        progressDetail.className = 'progress-detail';

        progressBg.appendChild(progressFill);
        progressContainer.appendChild(progressBg);
        progressContainer.appendChild(progressDetail);

        card.appendChild(spinner);
        card.appendChild(stepIndicator);
        card.appendChild(msg);
        card.appendChild(progressContainer);

        this.loadingScreen.textContent = '';
        this.loadingScreen.appendChild(card);
    }

    /**
     * Show loading screen
     * @param {string} message - Loading message
     */
    show(message = MESSAGES.LOADING_DEFAULT) {
        if (!this.loadingScreen) {
            this.ensureElements();
        }

        if (!this.loadingScreen) return;

        if (this.messageElement) {
            this.messageElement.textContent = message;
        }

        document.body.classList.add('productivity-is-loading');
        this.loadingScreen.classList.add('is-visible');

        this.loadingScreen.setAttribute('role', 'dialog');
        this.loadingScreen.setAttribute('aria-live', 'polite');
        this.loadingScreen.setAttribute('aria-label', 'Chargement');
    }

    /**
     * Hide loading screen
     */
    hide() {
        this._stopFakeProgress();
        this._currentPercent = 0;
        this._batchMode = false;
        this._batchSkipCallback = null;

        if (!this.loadingScreen) return;

        this.loadingScreen.classList.remove('is-visible');
        document.body.classList.remove('productivity-is-loading');

        // Reset step indicator
        const stepEl = this.loadingScreen.querySelector('.step-indicator');
        if (stepEl) stepEl.classList.remove('is-visible');

        // Cleanup batch list and skip button if present
        const batchList = this.loadingScreen.querySelector('.batch-list');
        if (batchList) batchList.remove();
        const skipBtn = this.loadingScreen.querySelector('.batch-skip-btn');
        if (skipBtn) skipBtn.remove();

        // Re-show spinner if hidden by batch mode
        const spinner = this.loadingScreen.querySelector('.spinner');
        if (spinner) spinner.style.display = '';
    }

    /**
     * Set loading message
     * @param {string} message - Message to display
     */
    setMessage(message) {
        if (!this.loadingScreen) {
            this.ensureElements();
        }

        if (this.messageElement) {
            this.messageElement.textContent = String(message ?? '');
        }
    }

    /**
     * Set current step — updates indicator, message, and resets progress bar to 0%
     * @param {number} current - Current step number (1-based)
     * @param {number} total - Total number of steps
     * @param {string} label - Step label (e.g. "Scénario créatif")
     */
    setStep(current, total, label) {
        if (!this.loadingScreen) return;

        // Update step indicator
        const stepEl = this.loadingScreen.querySelector('.step-indicator');
        if (stepEl) {
            stepEl.textContent = `Étape ${current} sur ${total}`;
            stepEl.classList.add('is-visible');
        }

        // Update message
        if (this.messageElement) {
            this.messageElement.textContent = label;
        }

        // Reset progress bar to 0% (sans animation de retour)
        this._stopFakeProgress();
        this._currentPercent = 0;

        const fill = this.loadingScreen.querySelector('.progress-bar-fill');
        if (fill) {
            fill.style.transition = 'none';
            fill.style.width = '0%';
            fill.offsetHeight; // Force reflow
            fill.style.transition = '';
        }

        const container = this.loadingScreen.querySelector('.progress-container');
        if (container) container.classList.add('is-visible');

        const detailEl = this.loadingScreen.querySelector('.progress-detail');
        if (detailEl) detailEl.textContent = '';

        this._startFakeProgress();
    }

    /**
     * Show progress bar with percentage
     * @param {number} percent - Progress percentage (0-100)
     * @param {string} detail - Detail text below bar
     */
    setProgress(percent, detail = '') {
        if (!this.loadingScreen) return;

        const container = this.loadingScreen.querySelector('.progress-container');
        const fill = this.loadingScreen.querySelector('.progress-bar-fill');
        const detailEl = this.loadingScreen.querySelector('.progress-detail');

        if (!container) return;

        const clamped = Math.max(0, Math.min(100, percent));
        this._currentPercent = clamped;
        this._lastDetail = detail;

        container.classList.add('is-visible');
        if (fill) fill.style.width = `${clamped}%`;
        if (detailEl) detailEl.textContent = detail;

        this._startFakeProgress();
    }

    /**
     * Start fake progress timer: advances 1% every 4.5s if no real update arrives.
     * Caps at 99% so the bar never reaches 100% on its own.
     */
    _startFakeProgress() {
        this._stopFakeProgress();
        this._fakeTimer = setInterval(() => {
            if (this._currentPercent >= 99) return;
            this._currentPercent = Math.min(99, this._currentPercent + 1);

            const fill = this.loadingScreen?.querySelector('.progress-bar-fill');
            if (fill) fill.style.width = `${this._currentPercent}%`;
        }, 4500);
    }

    /**
     * Stop fake progress timer
     */
    _stopFakeProgress() {
        if (this._fakeTimer) {
            clearInterval(this._fakeTimer);
            this._fakeTimer = null;
        }
    }

    /**
     * Hide progress bar
     */
    hideProgress() {
        this._stopFakeProgress();
        this._currentPercent = 0;

        if (!this.loadingScreen) return;

        const container = this.loadingScreen.querySelector('.progress-container');
        if (container) container.classList.remove('is-visible');
    }

    /**
     * Show batch mode with a list of items (replaces spinner)
     * @param {Array<{id: string, label: string}>} items - List of batch items
     * @param {Function|null} onRemoveItem - Called with item id when user removes an item
     */
    showBatch(items, onRemoveItem = null) {
        if (!this.loadingScreen) this.ensureElements();
        if (!this.loadingScreen) return;

        this._batchMode = true;
        this._stopFakeProgress();

        // Show the loading screen if not visible
        if (!this.loadingScreen.classList.contains('is-visible')) {
            document.body.classList.add('productivity-is-loading');
            this.loadingScreen.classList.add('is-visible');
        }

        const card = this.loadingScreen.querySelector('.loading-card');
        if (!card) return;

        // Hide spinner in batch mode
        const spinner = card.querySelector('.spinner');
        if (spinner) spinner.style.display = 'none';

        // Hide single progress bar
        const progressContainer = card.querySelector('.progress-container');
        if (progressContainer) progressContainer.classList.remove('is-visible');

        // Remove existing batch list and skip button
        const existing = card.querySelector('.batch-list');
        if (existing) existing.remove();
        const existingSkip = card.querySelector('.batch-skip-btn');
        if (existingSkip) existingSkip.remove();
        this._batchSkipCallback = null;

        // Build batch list
        const list = document.createElement('div');
        list.className = 'batch-list';

        for (const item of items) {
            const row = document.createElement('div');
            row.className = 'batch-item';
            row.dataset.batchId = item.id;

            // Cross button to remove item
            const removeBtn = document.createElement('button');
            removeBtn.className = 'batch-item-remove';
            removeBtn.textContent = '\u2715';
            removeBtn.title = 'Retirer ce motion design';
            removeBtn.addEventListener('click', () => {
                row.classList.add('batch-item-removed');
                removeBtn.disabled = true;
                if (onRemoveItem) onRemoveItem(item.id);
            });

            const label = document.createElement('div');
            label.className = 'batch-item-label';
            label.textContent = item.label;
            label.title = item.label;

            const barBg = document.createElement('div');
            barBg.className = 'batch-item-bar';
            const barFill = document.createElement('div');
            barFill.className = 'batch-item-fill';
            barBg.appendChild(barFill);

            const status = document.createElement('div');
            status.className = 'batch-item-status';
            status.textContent = '\u23F3'; // hourglass (pending)

            row.appendChild(removeBtn);
            row.appendChild(label);
            row.appendChild(barBg);
            row.appendChild(status);
            list.appendChild(row);
        }

        // Skip button
        const skipBtn = document.createElement('button');
        skipBtn.className = 'batch-skip-btn';
        skipBtn.textContent = 'Passer et continuer \u25B6';
        skipBtn.addEventListener('click', () => {
            if (this._batchSkipCallback) {
                skipBtn.disabled = true;
                skipBtn.textContent = 'Interruption en cours...';
                this._batchSkipCallback();
            }
        });

        card.appendChild(list);
        card.appendChild(skipBtn);
    }

    /**
     * Set callback for batch skip button
     * @param {Function} callback - Called when user clicks "Passer et continuer"
     */
    onBatchSkip(callback) {
        this._batchSkipCallback = callback;
    }

    /**
     * Update a specific batch item
     * @param {string} id - Item ID
     * @param {Object} data - { status, percent, detail }
     */
    updateBatchItem(id, data = {}) {
        if (!this.loadingScreen) return;

        const safeId = CSS.escape(id);
        const row = this.loadingScreen.querySelector(`.batch-item[data-batch-id="${safeId}"]`);
        if (!row) return;

        if (data.percent !== undefined) {
            const fill = row.querySelector('.batch-item-fill');
            if (fill) fill.style.width = `${Math.max(0, Math.min(100, data.percent))}%`;
        }

        if (data.status) {
            const statusEl = row.querySelector('.batch-item-status');
            if (statusEl) {
                const statusEmojis = {
                    pending: '\u23F3',
                    generating: '\uD83D\uDD04',
                    done: '\u2705',
                    error: '\u274C'
                };
                statusEl.textContent = statusEmojis[data.status] || data.status;
            }
        }
    }

    /**
     * Set batch summary message
     * @param {string} text - Summary text (e.g. "3/7 terminés")
     */
    setBatchSummary(text) {
        if (this.messageElement) {
            this.messageElement.textContent = String(text ?? '');
        }
    }

    /**
     * Check if loading screen is visible
     * @returns {boolean} True if visible
     */
    isVisible() {
        return !!this.loadingScreen?.classList.contains('is-visible');
    }
}

// Export singleton instance
const loadingScreen = new LoadingScreen();

// Dispatch ready event
try {
    window.dispatchEvent(new Event('ProductivityLoadingReady'));
} catch (e) {
    // Ignore
}

export default loadingScreen;
