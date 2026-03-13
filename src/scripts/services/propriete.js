import { PROPRIETE } from '../utils/constants.js';

/**
 * Service de gestion des propriétés MOGRT multi-clips
 */
export default class ProprietesService {

    constructor(premiereAsync) {
        this.premiereAsync = premiereAsync;
        this._undoSnapshot = null;
        this._lastClips = null;
    }

    /**
     * Charge les propriétés des MOGRTs sélectionnés
     * @returns {Promise<{clips: Array, templateMatch: boolean, clipCount: number}>}
     */
    async loadProperties() {
        var result = await this.premiereAsync._evalWithTimeout(
            'getSelectedMogrtProperties()',
            PROPRIETE.REFRESH_TIMEOUT_MS
        );
        var data = JSON.parse(result);
        if (data.error) throw new Error(data.error);
        this._lastClips = data.clips;
        return data;
    }

    /**
     * Fusionne les valeurs des propriétés entre tous les clips
     * @param {Array} clips - Tableau de clips depuis loadProperties
     * @returns {Array<{displayName, type, mergedValue, isMixed, propIndex}>}
     */
    mergePropertyValues(clips) {
        if (!clips || clips.length === 0) return [];

        var refProps = clips[0].properties;
        var merged = [];

        for (var p = 0; p < refProps.length; p++) {
            var refProp = refProps[p];
            var isMixed = false;

            if (clips.length > 1) {
                for (var c = 1; c < clips.length; c++) {
                    var otherProp = clips[c].properties[p];
                    if (!otherProp || String(otherProp.value) !== String(refProp.value)) {
                        isMixed = true;
                        break;
                    }
                }
            }

            var entry = {
                displayName: refProp.displayName,
                type: refProp.type,
                mergedValue: isMixed ? null : refProp.value,
                isMixed: isMixed,
                propIndex: refProp.propIndex
            };
            if (refProp.isRichText) entry.isRichText = true;
            merged.push(entry);
        }

        return merged;
    }

    /**
     * Crée un snapshot pour l'undo
     * @param {Array} clips - État actuel des clips
     */
    createSnapshot(clips) {
        this._undoSnapshot = JSON.parse(JSON.stringify(clips));
    }

    /**
     * @returns {boolean} true si un undo est disponible
     */
    hasUndo() {
        return this._undoSnapshot !== null;
    }

    /**
     * Applique les modifications sur tous les clips
     * @param {Array} changes - [{propIndex, value, isColor}]
     * @param {Array} clips - Clips actuels
     * @returns {Promise<{success: boolean, applied: number}>}
     */
    async applyChanges(changes, clips) {
        var batch = [];
        for (var c = 0; c < clips.length; c++) {
            var clip = clips[c];
            for (var ch = 0; ch < changes.length; ch++) {
                var entry = {
                    trackIndex: clip.trackIndex,
                    startTicks: clip.startTicks,
                    propIndex: changes[ch].propIndex,
                    value: changes[ch].value,
                    isColor: changes[ch].isColor || false
                };
                if (changes[ch].isRichText) {
                    entry.isRichText = true;
                    if (changes[ch].fontChanges) entry.fontChanges = changes[ch].fontChanges;
                }
                if (changes[ch].isPosition) {
                    entry.isPosition = true;
                    entry.seqWidth = changes[ch].seqWidth;
                    entry.seqHeight = changes[ch].seqHeight;
                }
                batch.push(entry);
            }
        }

        var safeJson = JSON.stringify(batch).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        var result = await this.premiereAsync._evalWithTimeout(
            'setMogrtPropertiesBatch("' + safeJson + '")',
            PROPRIETE.SAVE_TIMEOUT_MS
        );
        return JSON.parse(result);
    }

    /**
     * Restaure les valeurs du snapshot (undo)
     * @returns {Promise<{success: boolean, applied: number}>}
     */
    async applyUndo() {
        if (!this._undoSnapshot) throw new Error('Pas de snapshot disponible');

        var batch = [];
        for (var c = 0; c < this._undoSnapshot.length; c++) {
            var clip = this._undoSnapshot[c];
            for (var p = 0; p < clip.properties.length; p++) {
                var prop = clip.properties[p];
                var isColor = prop.type === PROPRIETE.TYPES.COLOR;
                var value = prop.value;

                if (isColor && typeof value === 'string') {
                    var parts = value.split(',');
                    value = [];
                    for (var pi = 0; pi < parts.length; pi++) {
                        value.push(parseInt(parts[pi], 10));
                    }
                }

                batch.push({
                    trackIndex: clip.trackIndex,
                    startTicks: clip.startTicks,
                    propIndex: prop.propIndex,
                    value: value,
                    isColor: isColor
                });
            }
        }

        var safeJson = JSON.stringify(batch).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        var result = await this.premiereAsync._evalWithTimeout(
            'setMogrtPropertiesBatch("' + safeJson + '")',
            PROPRIETE.SAVE_TIMEOUT_MS
        );
        var data = JSON.parse(result);
        if (data.success) {
            this._undoSnapshot = null;
        }
        return data;
    }
}
