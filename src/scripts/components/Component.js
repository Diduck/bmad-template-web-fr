import Storage from '../utils/storage.js';

/**
 * Component class for managing form elements with localStorage persistence
 */
class Component {
    /**
     * Create a new component
     * @param {string} id - Element ID
     * @param {*} defaultValue - Default value
     */
    constructor(id, defaultValue) {
        this.id = id;
        this.value = Storage.get(this.id, defaultValue);
        this.setValue(this.value);
    }

    /**
     * Get current value
     * @returns {*} Current value
     */
    getValue() {
        return this.value;
    }

    /**
     * Get DOM element
     * @returns {HTMLElement|null} DOM element
     */
    getElement() {
        return document.getElementById(this.id);
    }

    /**
     * Set value and update DOM
     * @param {*} value - New value
     */
    setValue(value) {
        Storage.set(this.id, value);
        this.value = value;

        const element = this.getElement();
        if (element) {
            if (element.classList.contains("checkbox")) {
                element.checked = Boolean(value);
            } else {
                element.value = value;
            }
        }

        this.verifyCollapsible();
    }

    /**
     * Verify and update collapsible sections
     */
    verifyCollapsible() {
        if (this.id.includes("Option")) {
            const collapsElement = document.querySelector(`.${this.id}Collaps`);
            if (collapsElement) {
                collapsElement.style.display = this.getValue() === true ? "block" : "none";
            }
        }
    }

    /**
     * Add event listener to element
     * @param {string} event - Event name
     * @param {Function} callback - Event callback
     */
    on(event, callback) {
        const element = this.getElement();
        if (element) {
            element.addEventListener(event, callback);
        }
    }

    /**
     * Remove event listener from element
     * @param {string} event - Event name
     * @param {Function} callback - Event callback
     */
    off(event, callback) {
        const element = this.getElement();
        if (element) {
            element.removeEventListener(event, callback);
        }
    }
}

export default Component;
