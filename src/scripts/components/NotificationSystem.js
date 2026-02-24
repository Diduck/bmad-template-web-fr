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
     * @returns {number} Notification ID
     */
    show(message, type = 'success', duration = NOTIFICATIONS.DEFAULT_DURATION_MS) {
        const id = this.idCounter++;
        const notification = this.createNotification(id, message, type);

        this.container.insertBefore(notification, this.container.firstChild);
        this.notifications.unshift({ id, element: notification });

        setTimeout(() => {
            notification.classList.add('show');
        }, 10);

        const timer = setTimeout(() => {
            this.hide(id);
        }, duration);

        notification.dataset.timer = timer;

        return id;
    }

    /**
     * Create notification element
     * @param {number} id - Notification ID
     * @param {string} message - Message
     * @param {string} type - Type
     * @returns {HTMLElement} Notification element
     */
    createNotification(id, message, type) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.dataset.id = id;

        const content = document.createElement('div');
        content.className = 'notification-content';
        content.textContent = message;

        const progressBar = document.createElement('div');
        progressBar.className = 'progress-bar';

        notification.appendChild(content);
        notification.appendChild(progressBar);

        notification.addEventListener('click', () => {
            this.hide(id);
        });

        notification.addEventListener('mouseenter', () => {
            progressBar.style.animationPlayState = 'paused';
        });

        notification.addEventListener('mouseleave', () => {
            progressBar.style.animationPlayState = 'running';
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
     */
    warning(message, duration = NOTIFICATIONS.WARNING_DURATION_MS) {
        if (window.ProductivityLoading) {
            window.ProductivityLoading.setMessage(message);
        }
    }

    /**
     * Show error notification
     * @param {string} message - Message
     * @param {number} duration - Duration in ms
     * @returns {number} Notification ID
     */
    error(message, duration = NOTIFICATIONS.ERROR_DURATION_MS) {
        return this.show(message, 'error', duration);
    }
}

export default NotificationSystem;
