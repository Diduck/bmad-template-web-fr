/**
 * Modal de reconnexion Claude CLI OAuth
 * Affiche un message clair quand l'authentification expire et propose de se reconnecter.
 */
class ClaudeAuthModal {
    constructor() {
        this.modalElement = null;
        this.onRetryCallback = null;
        this.isShowing = false;
    }

    /**
     * Affiche le modal de reconnexion
     * @param {Function} onRetry - Callback appelé quand l'utilisateur clique sur "Réessayer"
     */
    show(onRetry) {
        if (this.isShowing) {
            console.log('[ClaudeAuthModal] Modal déjà affiché');
            return;
        }

        this.onRetryCallback = onRetry;
        this.isShowing = true;

        // Créer le modal si nécessaire
        if (!this.modalElement) {
            this._createModal();
        }

        this.modalElement.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    /**
     * Masque le modal
     */
    hide() {
        if (!this.isShowing) return;

        this.isShowing = false;
        if (this.modalElement) {
            this.modalElement.style.display = 'none';
        }
        document.body.style.overflow = '';
    }

    /**
     * Crée la structure HTML du modal
     */
    _createModal() {
        const modal = document.createElement('div');
        modal.className = 'claude-auth-modal';
        modal.innerHTML = `
            <div class="claude-auth-modal__overlay"></div>
            <div class="claude-auth-modal__content">
                <div class="claude-auth-modal__header">
                    <svg class="claude-auth-modal__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                        <path d="M9 12l2 2 4-4"/>
                    </svg>
                    <h2 class="claude-auth-modal__title">Authentification Claude expirée</h2>
                </div>

                <div class="claude-auth-modal__body">
                    <p class="claude-auth-modal__message">
                        Votre session Claude Code a expiré. Pour continuer à utiliser les fonctionnalités IA de l'extension, vous devez vous reconnecter.
                    </p>

                    <div class="claude-auth-modal__steps">
                        <div class="claude-auth-modal__step">
                            <span class="claude-auth-modal__step-number">1</span>
                            <span class="claude-auth-modal__step-text">Cliquez sur "Se reconnecter" ci-dessous</span>
                        </div>
                        <div class="claude-auth-modal__step">
                            <span class="claude-auth-modal__step-number">2</span>
                            <span class="claude-auth-modal__step-text">Authentifiez-vous dans votre navigateur</span>
                        </div>
                        <div class="claude-auth-modal__step">
                            <span class="claude-auth-modal__step-number">3</span>
                            <span class="claude-auth-modal__step-text">Revenez ici et cliquez sur "Réessayer"</span>
                        </div>
                    </div>
                </div>

                <div class="claude-auth-modal__actions">
                    <button class="claude-auth-modal__button claude-auth-modal__button--secondary" data-action="cancel">
                        Annuler
                    </button>
                    <button class="claude-auth-modal__button claude-auth-modal__button--primary" data-action="login">
                        Se reconnecter
                    </button>
                    <button class="claude-auth-modal__button claude-auth-modal__button--success" data-action="retry" style="display: none;">
                        ✓ Réessayer
                    </button>
                </div>

                <div class="claude-auth-modal__hint">
                    <small>Problème persistant ? Essayez <code>claude login</code> dans votre terminal.</small>
                </div>
            </div>
        `;

        // Ajouter les styles inline si pas déjà présents
        if (!document.getElementById('claude-auth-modal-styles')) {
            const style = document.createElement('style');
            style.id = 'claude-auth-modal-styles';
            style.textContent = this._getStyles();
            document.head.appendChild(style);
        }

        // Attacher les événements
        const loginBtn = modal.querySelector('[data-action="login"]');
        const retryBtn = modal.querySelector('[data-action="retry"]');
        const cancelBtn = modal.querySelector('[data-action="cancel"]');

        loginBtn.addEventListener('click', () => this._handleLogin(loginBtn, retryBtn));
        retryBtn.addEventListener('click', () => this._handleRetry());
        cancelBtn.addEventListener('click', () => this.hide());

        document.body.appendChild(modal);
        this.modalElement = modal;
    }

    /**
     * Gère le clic sur "Se reconnecter"
     */
    async _handleLogin(loginBtn, retryBtn) {
        try {
            loginBtn.disabled = true;
            loginBtn.textContent = 'Ouverture du navigateur...';

            // Lancer la commande claude login qui ouvre le navigateur
            // On utilise CSInterface pour exécuter une commande système
            const csi = new CSInterface();

            // Créer un fichier batch temporaire pour lancer claude login
            const tempBat = `${csi.getSystemPath(SystemPath.EXTENSION)}\\temp\\claude_login_${Date.now()}.bat`;

            // Écrire le fichier batch
            const batContent = '@echo off\nstart cmd /k "claude login"\n';
            const writeResult = window.cep.fs.writeFile(tempBat, batContent);

            if (writeResult.err === 0) {
                // Exécuter le batch
                const batFile = new window.cep.fs.FileSystem.File(tempBat);
                batFile.execute();

                // Nettoyer après 5 secondes
                setTimeout(() => {
                    try { window.cep.fs.deleteFile(tempBat); } catch (e) { /* ignore */ }
                }, 5000);
            }

            // Afficher le bouton "Réessayer"
            loginBtn.style.display = 'none';
            retryBtn.style.display = 'inline-flex';

            if (window.notifications) {
                window.notifications.info('Authentifiez-vous dans le navigateur, puis cliquez sur Réessayer');
            }

        } catch (error) {
            console.error('[ClaudeAuthModal] Erreur lors de l\'ouverture du login:', error);
            loginBtn.disabled = false;
            loginBtn.textContent = 'Se reconnecter';

            if (window.notifications) {
                window.notifications.error('Impossible d\'ouvrir le navigateur. Essayez "claude login" dans votre terminal.');
            }
        }
    }

    /**
     * Gère le clic sur "Réessayer"
     */
    _handleRetry() {
        this.hide();
        if (this.onRetryCallback) {
            this.onRetryCallback();
        }
    }

    /**
     * Retourne les styles CSS du modal
     */
    _getStyles() {
        return `
            .claude-auth-modal {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }

            .claude-auth-modal__overlay {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                backdrop-filter: blur(4px);
            }

            .claude-auth-modal__content {
                position: relative;
                background: #1e1e1e;
                border-radius: 12px;
                padding: 32px;
                max-width: 520px;
                width: 90%;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                border: 1px solid rgba(255, 255, 255, 0.1);
            }

            .claude-auth-modal__header {
                display: flex;
                align-items: center;
                gap: 16px;
                margin-bottom: 24px;
            }

            .claude-auth-modal__icon {
                width: 48px;
                height: 48px;
                color: #e8a87c;
                flex-shrink: 0;
            }

            .claude-auth-modal__title {
                font-size: 24px;
                font-weight: 600;
                color: #ffffff;
                margin: 0;
            }

            .claude-auth-modal__body {
                margin-bottom: 24px;
            }

            .claude-auth-modal__message {
                color: #b0b0b0;
                font-size: 15px;
                line-height: 1.6;
                margin: 0 0 24px 0;
            }

            .claude-auth-modal__steps {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .claude-auth-modal__step {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px;
                background: rgba(232, 168, 124, 0.1);
                border-radius: 8px;
                border-left: 3px solid #e8a87c;
            }

            .claude-auth-modal__step-number {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 24px;
                height: 24px;
                background: #e8a87c;
                color: #1e1e1e;
                font-weight: 700;
                font-size: 14px;
                border-radius: 50%;
                flex-shrink: 0;
            }

            .claude-auth-modal__step-text {
                color: #d0d0d0;
                font-size: 14px;
            }

            .claude-auth-modal__actions {
                display: flex;
                gap: 12px;
                justify-content: flex-end;
            }

            .claude-auth-modal__button {
                padding: 12px 24px;
                border-radius: 8px;
                border: none;
                font-size: 15px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
            }

            .claude-auth-modal__button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            .claude-auth-modal__button--secondary {
                background: rgba(255, 255, 255, 0.1);
                color: #ffffff;
            }

            .claude-auth-modal__button--secondary:hover:not(:disabled) {
                background: rgba(255, 255, 255, 0.15);
            }

            .claude-auth-modal__button--primary {
                background: #e8a87c;
                color: #1e1e1e;
            }

            .claude-auth-modal__button--primary:hover:not(:disabled) {
                background: #f0b58a;
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(232, 168, 124, 0.3);
            }

            .claude-auth-modal__button--success {
                background: #4caf50;
                color: #ffffff;
            }

            .claude-auth-modal__button--success:hover:not(:disabled) {
                background: #66bb6a;
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
            }

            .claude-auth-modal__hint {
                margin-top: 16px;
                padding-top: 16px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                text-align: center;
                color: #808080;
                font-size: 13px;
            }

            .claude-auth-modal__hint code {
                background: rgba(255, 255, 255, 0.1);
                padding: 2px 6px;
                border-radius: 4px;
                font-family: 'Courier New', monospace;
                font-size: 12px;
                color: #e8a87c;
            }
        `;
    }

    /**
     * Détruit le modal et nettoie
     */
    destroy() {
        this.hide();
        if (this.modalElement) {
            this.modalElement.remove();
            this.modalElement = null;
        }
        const styles = document.getElementById('claude-auth-modal-styles');
        if (styles) {
            styles.remove();
        }
    }
}

// Instance singleton globale
if (!window.claudeAuthModal) {
    window.claudeAuthModal = new ClaudeAuthModal();
}

export default ClaudeAuthModal;
