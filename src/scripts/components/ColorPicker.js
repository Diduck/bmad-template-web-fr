import Component from './Component.js';
import Storage from '../utils/storage.js';

/**
 * ColorPicker component using Coloris library
 * Simple wrapper that uses Coloris directly
 */
class ColorPicker extends Component {
    /**
     * Create a new ColorPicker
     * @param {string} id - Element ID for the color preview square
     * @param {string} defaultColor - Default color in hex format (e.g., "#ff4949ff")
     */
    constructor(id, defaultColor = "#ff4949ff") {
        super(id, defaultColor);
        this.defaultColor = defaultColor;
        this.colorHistory = Storage.get(`${id}_history`, []);

        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.initialize());
        } else {
            this.initialize();
        }
    }

    /**
     * Initialize the color picker after DOM is ready
     */
    initialize() {
        this.updatePreviewColor();
        this.initializeColoris();
        this.attachEventListeners();
    }

    /**
     * Initialize Coloris library
     */
    initializeColoris() {
        if (typeof Coloris !== 'undefined') {
            Coloris({
                el: '.color-picker-square',
                theme: 'large',
                themeMode: 'dark',
                alpha: true,
                formatToggle: false,
                format: 'hex',
                clearButton: false,
                swatches: this.getSwatches()
            });
        }
    }

    /**
     * Get swatches from color history
     */
    getSwatches() {
        // If no history, return default swatches with default color at the end
        if (this.colorHistory.length === 0) {
            return [
                '#264653',
                '#2a9d8f',
                '#e9c46a',
                '#f4a261',
                '#e76f51',
                '#d62828',
                '#023e8a',
                '#0077b6',
                '#0096c7',
                '#00b4d8',
                this.defaultColor
            ];
        }

        // Always add default color at the end
        const swatches = [...this.colorHistory];
        // Remove default color if it exists in history
        const filteredSwatches = swatches.filter(c => c !== this.defaultColor);
        // Add default color at the end
        filteredSwatches.push(this.defaultColor);

        return filteredSwatches;
    }

    /**
     * Add color to history
     */
    addToHistory(color) {
        // Don't add default color to history (it's always at the end)
        if (color === this.defaultColor) {
            return;
        }

        // Remove if already exists
        this.colorHistory = this.colorHistory.filter(c => c !== color);

        // Add to beginning
        this.colorHistory.unshift(color);

        // Keep only 10 most recent (+ default color = 11 total)
        if (this.colorHistory.length > 10) {
            this.colorHistory = this.colorHistory.slice(0, 10);
        }

        // Save to storage
        Storage.set(`${this.id}_history`, this.colorHistory);

        // Update Coloris swatches
        this.updateColorisSwatches();
    }

    /**
     * Update Coloris swatches
     */
    updateColorisSwatches() {
        if (typeof Coloris !== 'undefined') {
            Coloris({
                el: '.color-picker-square',
                swatches: this.colorHistory
            });
        }
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        const element = this.getElement();

        if (element) {
            // Update stored value and background when color changes
            element.addEventListener('input', (e) => {
                const newColor = e.target.value;
                this.value = newColor;
                this.updatePreviewColor();
                Storage.set(this.id, newColor);
            });

            element.addEventListener('change', (e) => {
                const newColor = e.target.value;
                this.value = newColor;
                this.updatePreviewColor();
                Storage.set(this.id, newColor);
                // Add to history when color is confirmed (on change, not input)
                this.addToHistory(newColor);
            });
        }
    }

    /**
     * Update the color preview square
     */
    updatePreviewColor() {
        const element = this.getElement();
        if (element) {
            element.style.backgroundColor = this.value;
        }
    }

    /**
     * Override setValue to update preview
     */
    setValue(value) {
        super.setValue(value);
        this.updatePreviewColor();
    }
}

export default ColorPicker;
