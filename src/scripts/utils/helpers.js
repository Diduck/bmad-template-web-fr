import { FILE_EXTENSIONS, TICKS } from './constants.js';

/**
 * Utility helper functions
 */

/**
 * Remove file extension from filename
 * @param {string} name - Filename
 * @returns {string} Filename without extension
 */
export function removeExtension(name) {
    for (const ext of FILE_EXTENSIONS.VIDEO.concat(FILE_EXTENSIONS.AUDIO)) {
        if (name.indexOf(ext) !== -1) {
            return name.substring(0, name.lastIndexOf("."));
        }
    }
    return name;
}

/**
 * Convert seconds to ticks
 * @param {number} seconds - Seconds
 * @returns {string} Ticks as string
 */
export function secondsToTicks(seconds) {
    const ticks = Math.round(seconds * TICKS.PER_SECOND);
    return ticks.toString();
}

/**
 * Convert ticks to seconds
 * @param {string|number} ticks - Ticks
 * @param {number|null} precision - Decimal precision
 * @returns {number} Seconds
 */
export function ticksToSeconds(ticks, precision = null) {
    const sec = Number(ticks) / TICKS.PER_SECOND;
    return (precision != null) ? Number(sec.toFixed(precision)) : sec;
}

/**
 * Convert ticks to time object
 * @param {string|number} ticks - Ticks
 * @returns {Object} Time object with hour, minute, second
 */
export function ticksToTime(ticks) {
    const totalSeconds = Number(ticks) / TICKS.PER_SECOND;

    const hours = Math.floor(totalSeconds / 3600);
    const remainingSeconds = totalSeconds % 3600;
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = Math.floor(remainingSeconds % 60);

    return {
        hour: hours,
        minute: minutes,
        second: seconds
    };
}

/**
 * Delay execution
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Clean string for comparison (lowercase, remove spaces and special chars)
 * @param {string} str - String to clean
 * @returns {string} Cleaned string
 */
export function cleanString(str) {
    return str.toLowerCase().replace(/[_\-\s]/g, "");
}

/**
 * Safe JSON parse with fallback
 * @param {string} jsonString - JSON string
 * @param {*} fallback - Fallback value if parse fails
 * @returns {*} Parsed object or fallback
 */
export function safeJsonParse(jsonString, fallback = null) {
    try {
        return JSON.parse(jsonString);
    } catch (error) {
        console.error('JSON parse error:', error);
        return fallback;
    }
}

/**
 * Safe payload parser for events
 * @param {*} data - Data to parse
 * @returns {Object} Parsed payload
 */
export function safePayload(data) {
    if (data && typeof data === "object") {
        return data;
    }

    if (typeof data === "string") {
        try {
            return JSON.parse(data);
        } catch {
            return { message: String(data), type: "warning" };
        }
    }

    return {};
}

/**
 * Normalize JSON response from OpenAI (extract main array)
 * @param {string} raw - Raw response
 * @returns {string} Normalized JSON
 */
export function normalizeTitlesJsonBatch(raw) {
    if (!raw) return raw;
    const match = raw.match(/\[\s*\[[\s\S]*\]\s*\]/);
    return match ? match[0] : raw;
}

/**
 * Coerce response to valid JSON array
 * @param {string} str - String to coerce
 * @returns {string} Valid JSON string
 */
export function coerceToJsonArray(str) {
    const match = str.match(/\[\s*\[[\s\S]*\]\s*\]/);
    if (!match) return str;

    let inner = match[0];

    inner = inner.replace(
        /\[\s*(\d+)\s*,\s*([\s\S]*?)\s*,\s*([^\]]+?)\s*\]/g,
        (_, idx, phrase, resp) => {
            let p = String(phrase).trim();
            p = p.replace(/^"+|"+$/g, "");
            p = p.replace(/"/g, '\\"');

            let r = String(resp).trim();
            r = r.replace(/^"+|"+$/g, "");
            if (/^(false|null|true)$/i.test(r)) {
                r = r.toLowerCase() === "false" ? "false" : r.toLowerCase();
            }
            r = r.replace(/"/g, '\\"');

            return `[${idx}, "${p}", "${r}"]`;
        }
    );

    return inner;
}

/**
 * Validate email format (simple check)
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid
 */
export function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Debounce function execution
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function execution
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in ms
 * @returns {Function} Throttled function
 */
export function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Get file extension
 * @param {string} filename - Filename
 * @returns {string} Extension including dot
 */
export function getFileExtension(filename) {
    return filename.substring(filename.lastIndexOf('.'));
}

/**
 * Format time as HH:MM:SS
 * @param {number} seconds - Total seconds
 * @returns {string} Formatted time
 */
export function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Generate random ID
 * @param {number} length - Length of ID
 * @returns {string} Random ID
 */
export function generateId(length = 8) {
    return Math.random().toString(36).substring(2, 2 + length);
}
