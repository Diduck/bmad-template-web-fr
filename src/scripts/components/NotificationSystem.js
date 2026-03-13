import { NOTIFICATIONS } from '../utils/constants.js';

/**
 * Notification system for displaying user messages
 */
class NotificationSystem {
    constructor() {
        this.notifications = [];
        this.idCounter = 0;
        this.initContainer();
    }

    /**
     * Initialize notification container
     */
    initContainer() {
        this.container = document.getElementById('notification-container');

        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'notification-container';
            document.body.appendChild(this.container);
        }
    }

    /**
     * Show a notification
     * @param {string} message - Message to display
     * @param {string} type - Notification type (success, warning, error)
     * @param {number} duration - Duration in ms
     * @param {{ persistent?: boolean }} options - Options (persistent disables auto-dismiss)
     * @returns {number} Notification ID
     */
    show(message, type = 'success', duration = NOTIFICATIONS.DEFAULT_DURATION_MS, options = {}) {
        const id = this.idCounter++;
        const notification = this.createNotification(id, message, type, options.persistent);

        this.container.insertBefore(notification, this.container.firstChild);
        this.notifications.unshift({ id, element: notification });

        setTimeout(() => {
            notification.classList.add('show');
        }, 10);

        if (!options.persistent) {
            const timer = setTimeout(() => {
                this.hide(id);
            }, duration);

            notification.dataset.timer = timer;
        }

        return id;
    }

    /**
     * Create notification element
     * @param {number} id - Notification ID
     * @param {string} message - Message
     * @param {string} type - Type
     * @param {boolean} persistent - If true, no progress bar, shows close button
     * @returns {HTMLElement} Notification element
     */
    createNotification(id, message, type, persistent = false) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.dataset.id = id;

        if (persistent) {
            notification.classList.add('persistent');
        }

        const content = document.createElement('div');
        content.className = 'notification-content';
        content.textContent = message;

        notification.appendChild(content);

        if (persistent) {
            const closeBtn = document.createElement('button');
            closeBtn.className = 'notification-close';
            closeBtn.textContent = '\u00D7';
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.hide(id);
            });
            notification.appendChild(closeBtn);
        } else {
            const progressBar = document.createElement('div');
            progressBar.className = 'progress-bar';
            notification.appendChild(progressBar);

            notification.addEventListener('mouseenter', () => {
                progressBar.style.animationPlayState = 'paused';
            });

            notification.addEventListener('mouseleave', () => {
                progressBar.style.animationPlayState = 'running';
            });
        }

        notification.addEventListener('click', () => {
            this.hide(id);
        });

        return notification;
    }

    /**
     * Hide a notification
     * @param {number} id - Notification ID
     */
    hide(id) {
        const notificationData = this.notifications.find(n => n.id === id);
        if (!notificationData) return;

        const notification = notificationData.element;

        if (notification.dataset.timer) {
            clearTimeout(parseInt(notification.dataset.timer));
        }

        notification.classList.add('hide');

        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
            this.notifications = this.notifications.filter(n => n.id !== id);
        }, 400);
    }

    /**
     * Hide all notifications
     */
    hideAll() {
        this.notifications.forEach(notification => {
            this.hide(notification.id);
        });
    }

    /**
     * Show success notification
     * @param {string} message - Message
     * @param {number} duration - Duration in ms
     * @returns {number} Notification ID
     */
    success(message, duration = NOTIFICATIONS.DEFAULT_DURATION_MS) {
        if (window.ProductivityLoading && window.ProductivityLoading.isVisible()) {
            window.ProductivityLoading.setMessage(message);
        }
        return this.show(message, 'success', duration);
    }

    /**
     * Show warning notification
     * @param {string} message - Message
     * @param {number} duration - Duration in ms
     * @returns {number} Notification ID
     */
    warning(message, duration = NOTIFICATIONS.WARNING_DURATION_MS) {
        if (window.ProductivityLoading) {
            window.ProductivityLoading.setMessage(message);
        }
        // No HUD popup for warnings — only update loading screen message
        return -1;
    }

    /**
     * Show error notification (persistent by default — no auto-dismiss)
     * @param {string} message - Message
     * @param {number} duration - Duration in ms (used as fallback if not persistent)
     * @param {boolean} persistent - If true, notification stays until manual dismiss
     * @returns {number} Notification ID
     */
    error(message, duration = NOTIFICATIONS.ERROR_DURATION_MS, persistent = true) {
        return this.show(message, 'error', duration, { persistent });
    }
}

export default NotificationSystem;
