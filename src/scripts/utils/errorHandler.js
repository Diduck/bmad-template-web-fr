import { ERRORS } from './constants.js';

/**
 * Centralized error handling system
 */
class ErrorHandler {
    /**
     * Handle an error with logging and user notification
     * @param {Error} error - The error object
     * @param {string} context - Context where the error occurred
     * @param {string|null} userMessage - Custom message for the user
     */
    static handle(error, context = '', userMessage = null) {
        // Log for debugging
        console.error(`[${context}]`, error);

        // Notify user
        const message = userMessage || this.getDefaultMessage(error);
        if (window.notifications) {
            window.notifications.error(message);
        }

        // Optional: Send to monitoring service
        this.reportToMonitoring(error, context);
    }

    /**
     * Get a user-friendly error message based on the error
     * @param {Error} error - The error object
     * @returns {string} User-friendly message
     */
    static getDefaultMessage(error) {
        const message = error.message || '';

        if (message.includes('API') || message.includes('OpenAI')) {
            return ERRORS.NETWORK_ERROR;
        }
        if (message.includes('File') || message.includes('fichier')) {
            return ERRORS.FILE_NOT_FOUND;
        }
        if (message.includes('Sequence') || message.includes('séquence')) {
            return ERRORS.SEQUENCE_NOT_FOUND;
        }
        if (message.includes('Clip')) {
            return ERRORS.CLIP_NOT_FOUND;
        }

        return 'Une erreur est survenue : ' + message;
    }

    /**
     * Report error to monitoring service (placeholder)
     * @param {Error} error - The error object
     * @param {string} context - Context information
     */
    static reportToMonitoring(error, context) {
        // TODO: Implement monitoring service integration if needed
        // Example: Sentry, LogRocket, etc.
    }

    /**
     * Wrap an async function with error handling
     * @param {Function} fn - Async function to wrap
     * @param {string} context - Context for error handling
     * @returns {Function} Wrapped function
     */
    static async wrap(fn, context = '') {
        return async (...args) => {
            try {
                return await fn(...args);
            } catch (error) {
                this.handle(error, context);
                throw error;
            }
        };
    }

    /**
     * Validate API key format
     * @param {string} apiKey - API key to validate
     * @throws {Error} If API key is invalid
     */
    static validateApiKey(apiKey) {
        if (!apiKey || typeof apiKey !== 'string') {
            throw new Error(ERRORS.INVALID_API_KEY);
        }
        if (!apiKey.startsWith('sk-')) {
            throw new Error(ERRORS.INVALID_API_KEY);
        }
    }
}

export default ErrorHandler;
