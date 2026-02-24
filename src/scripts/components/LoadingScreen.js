import { MESSAGES } from '../utils/constants.js';

/**
 * Loading screen manager
 */
class LoadingScreen {
    constructor() {
        this.loadingScreen = null;
        this.messageElement = null;
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

#loading-screen .loading-msg{
  margin-top: 12px;
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
        if (!this.loadingScreen) return;

        this.loadingScreen.classList.remove('is-visible');
        document.body.classList.remove('productivity-is-loading');
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

        container.classList.add('is-visible');
        if (fill) fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        if (detailEl) detailEl.textContent = detail;
    }

    /**
     * Hide progress bar
     */
    hideProgress() {
        if (!this.loadingScreen) return;

        const container = this.loadingScreen.querySelector('.progress-container');
        if (container) container.classList.remove('is-visible');
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
