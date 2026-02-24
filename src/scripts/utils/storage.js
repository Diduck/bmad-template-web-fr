/**
 * LocalStorage wrapper with type safety and default values
 */
class Storage {
    /**
     * Get item from localStorage with type conversion
     * @param {string} key - Storage key
     * @param {*} defaultValue - Default value if not found
     * @returns {*} Stored value or default
     */
    static get(key, defaultValue = null) {
        const stored = localStorage.getItem(key);

        if (stored === null) {
            return defaultValue;
        }

        // Handle booleans
        if (stored === "true") return true;
        if (stored === "false") return false;

        // Handle numbers
        if (!isNaN(stored) && stored !== '') {
            return parseFloat(stored);
        }

        // Try to parse JSON
        try {
            return JSON.parse(stored);
        } catch {
            return stored;
        }
    }

    /**
     * Set item in localStorage
     * @param {string} key - Storage key
     * @param {*} value - Value to store
     */
    static set(key, value) {
        if (typeof value === 'object') {
            localStorage.setItem(key, JSON.stringify(value));
        } else {
            localStorage.setItem(key, String(value));
        }
    }

    /**
     * Remove item from localStorage
     * @param {string} key - Storage key
     */
    static remove(key) {
        localStorage.removeItem(key);
    }

    /**
     * Clear all items from localStorage
     */
    static clear() {
        localStorage.clear();
    }

    /**
     * Check if key exists in localStorage
     * @param {string} key - Storage key
     * @returns {boolean} True if exists
     */
    static has(key) {
        return localStorage.getItem(key) !== null;
    }

    /**
     * Get all keys from localStorage
     * @returns {Array<string>} Array of keys
     */
    static keys() {
        return Object.keys(localStorage);
    }

    /**
     * Get multiple items at once
     * @param {Array<string>} keys - Array of keys
     * @param {*} defaultValue - Default value for missing keys
     * @returns {Object} Object with key-value pairs
     */
    static getMultiple(keys, defaultValue = null) {
        const result = {};
        keys.forEach(key => {
            result[key] = this.get(key, defaultValue);
        });
        return result;
    }

    /**
     * Set multiple items at once
     * @param {Object} items - Object with key-value pairs
     */
    static setMultiple(items) {
        Object.entries(items).forEach(([key, value]) => {
            this.set(key, value);
        });
    }
}

export default Storage;
