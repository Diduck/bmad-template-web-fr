import { SMART_CUT_MESSAGES } from '../utils/constants.js';
import { loadTemplate } from '../utils/templateLoader.js';
import ErrorHandler from '../utils/errorHandler.js';
import { handleClaudeAuthError } from '../utils/helpers.js';
import { ClaudeAuthError } from '../api/claude.js';

/**
 * Service d'orchestration Smart Cut — analyse IA streaming
 */
class SmartCutService {
    constructor(openaiClient, premiereAsync, notifications, csInterface, loadingScreen) {
        this.openai = openaiClient;
        this.premiere = premiereAsync;
        this.notifications = notifications;
        this.csInterface = csInterface;
        this.loadingScreen = loadingScreen || null;
    }

    /**
     * Lance l'analyse Smart Cut complete
     * @param {Object} intention - Intention selectionnee (avec promptTemplate)
     * @param {Object} callbacks - {onSegment, onProgress, onError, onComplete, onAbort, abortSignal}
     * @returns {Promise<void>}
     */
    async startAnalysis(intention, callbacks) {
        // 1. Obtenir info sequence active
        console.log('[SC-Service] startAnalysis: getting active sequence...');
        const seqInfo = await this.premiere.getActiveSequenceInfo();
        if (seqInfo.error) {
            throw new Error(seqInfo.error);
        }
        console.log('[SC-Service] Active sequence:', seqInfo.name);

        // 2. Trouver la transcription existante (avec auto-transcription si absente)
        console.log('[SC-Service] Loading transcription for:', seqInfo.name);
        const transcription = await this.loadTranscription(seqInfo.name, true, callbacks.onProgress || null);
        if (!transcription) {
            throw new Error(
                SMART_CUT_MESSAGES.ERROR_NO_TRANSCRIPTION.replace('{name}', seqInfo.name)
            );
        }

        console.log('[SC-Service] Transcription loaded:', transcription.length, 'segments');
        // 3. Formater la transcription (retirer words pour reduire les tokens)
        const formatted = this.formatTranscription(transcription);

        // 4. Notifier la progression et lancer l'analyse IA
        if (callbacks.onStepChange) {
            callbacks.onStepChange('transcription_loaded', transcription.length);
        } else if (this.loadingScreen) {
            this.loadingScreen.setMessage('Lancement de l\'analyse IA...');
        }
        console.log('[SC-Service] Launching OpenAI analysis...');

        try {
            return await this.openai.analyzeSmartCut(
                formatted,
                intention,
                callbacks,
                callbacks.abortSignal
            );
        } catch (error) {
            // Gestion spéciale pour les erreurs d'auth Claude
            const wasAuthError = await handleClaudeAuthError(error, async () => {
                if (this.loadingScreen) {
                    this.loadingScreen.setMessage('Reconnexion réussie, reprise de l\'analyse...');
                }
                return this.openai.analyzeSmartCut(
                    formatted,
                    intention,
                    callbacks,
                    callbacks.abortSignal
                );
            });

            // Si ce n'était pas une erreur d'auth, propager l'erreur
            if (!wasAuthError) {
                throw error;
            }
        }
    }

    /**
     * Charge la transcription existante depuis le dossier projet
     * Auto-transcrit avec Whisper medium si aucune transcription trouvee
     * @param {string} sequenceName - Nom de la sequence active
     * @param {boolean} autoTranscribe - Lancer auto-transcription si absent (defaut true)
     * @param {Function|null} setProgress - Callback pour afficher la progression
     * @returns {Promise<Array|null>} Transcription ou null
     */
    async loadTranscription(sequenceName, autoTranscribe = true, setProgress = null) {
        const projectPath = await this.premiere.getProjectPath();
        console.log('[SC-Service] loadTranscription: projectPath=', projectPath, 'seq=', sequenceName);
        const paths = [
            projectPath + '07_Audio/' + sequenceName + '.json',
            projectPath + '07_Audio/' + sequenceName + 'SRT.json',
            projectPath + '07_Audio/Smartcut/' + sequenceName + 'SRT.json'
        ];

        for (const path of paths) {
            const exists = await this.premiere.fileExists(path);
            if (exists) {
                console.log('[SC-Service] Found transcription at:', path);
                try {
                    const content = await this.premiere.readFile(path);
                    return JSON.parse(content);
                } catch (e) {
                    ErrorHandler.handle(e, 'SmartCut', 'Erreur lecture transcription');
                }
            }
        }

        // Fallback : scan du dossier 07_Audio pour match partiel (sequence renommee)
        try {
            const audioDir = projectPath + '07_Audio/';
            const files = await this.premiere.listDir(audioDir);
            const seqLower = sequenceName.toLowerCase();

            for (var i = 0; i < files.length; i++) {
                var f = files[i];
                if (!f.endsWith('SRT.json') && !f.endsWith('.json')) continue;
                if (f.endsWith('_titles.json')) continue;
                var baseName = f.replace(/SRT\.json$/i, '').replace(/\.json$/i, '');
                var baseLower = baseName.toLowerCase();
                if (seqLower.indexOf(baseLower) !== -1 || baseLower.indexOf(seqLower) !== -1) {
                    console.log('[SC-Service] Fuzzy match:', f, '(base:', baseName, ') matches seq:', sequenceName);
                    const matchPath = audioDir + f;
                    const matchExists = await this.premiere.fileExists(matchPath);
                    if (matchExists) {
                        const content = await this.premiere.readFile(matchPath);
                        return JSON.parse(content);
                    }
                }
            }
        } catch (e) {
            // Scan fallback echoue — continuer vers auto-transcription
        }

        // Aucune transcription trouvee — auto-transcription si activee
        if (autoTranscribe && this.csInterface) {
            if (this.loadingScreen) {
                this.loadingScreen.show('Export audio de ' + sequenceName + '...');
            }

            const extensionPath = this.csInterface
                .getSystemPath(SystemPath.EXTENSION)
                .replace(/\//g, '\\');
            const normalizedPath = projectPath.replace(/\//g, '\\').replace(/\\$/, '') + '\\';
            const audioPath = normalizedPath + '07_Audio\\';
            const outputDir = normalizedPath + '07_Audio\\Smartcut';

            // Exporter le WAV de la sequence avant transcription
            await this.premiere.exportMultipleWav([sequenceName], audioPath);

            if (this.loadingScreen) {
                this.loadingScreen.setMessage('Transcription de ' + sequenceName + '...');
            }

            const result = await this.premiere.runSmartCutTranscription(
                extensionPath, audioPath, sequenceName, outputDir
            );

            if (this.loadingScreen) {
                this.loadingScreen.hide();
            }

            if (!result || result === 'TRANSCRIPTION_FAILED' || result === 'BATCH_NOT_FOUND' || result === 'CANNOT_WRITE_BATCH') {
                throw new Error('Auto-transcription SmartCut echouee pour ' + sequenceName + ' : ' + result);
            }

            // Recharger la transcription depuis le nouveau fichier
            const smartcutPath = projectPath + '07_Audio/Smartcut/' + sequenceName + 'SRT.json';
            const newExists = await this.premiere.fileExists(smartcutPath);
            if (newExists) {
                const content = await this.premiere.readFile(smartcutPath);
                return JSON.parse(content);
            }

            throw new Error('Transcription SmartCut generee mais fichier introuvable: ' + smartcutPath);
        }

        return null;
    }

    /**
     * Lance l'analyse Smart Cut multi-sequences
     * @param {Object} intention - Intention selectionnee (avec promptTemplate)
     * @param {Object} collectedData - {sequences: [{name, transcription}], missingTranscriptions: string[]}
     * @param {Object} callbacks - {onSegment, onProgress, onError, onComplete, abortSignal}
     * @returns {Promise<void>}
     */
    async startMultiAnalysis(intention, collectedData, callbacks) {
        var self = this;
        var formatted = collectedData.sequences.map(function(seq) {
            return {
                name: seq.name,
                transcription: self.formatTranscription(seq.transcription)
            };
        });

        var multiSystemPrompt = this.openai.getSmartCutMultiSystemPrompt();
        var intentionText = intention.assembledPrompt || (intention.templatePath ? loadTemplate(intention.templatePath) : null);

        try {
            return await this.openai.analyzeSmartCut(null, intention, callbacks, callbacks.abortSignal, {
                systemPrompt: multiSystemPrompt,
                userData: {
                    intention: intentionText || 'Identifie les segments les plus pertinents.',
                    sequences: formatted
                }
            });
        } catch (error) {
            // Gestion spéciale pour les erreurs d'auth Claude
            const wasAuthError = await handleClaudeAuthError(error, async () => {
                if (self.loadingScreen) {
                    self.loadingScreen.setMessage('Reconnexion réussie, reprise de l\'analyse multi-séquences...');
                }
                return self.openai.analyzeSmartCut(null, intention, callbacks, callbacks.abortSignal, {
                    systemPrompt: multiSystemPrompt,
                    userData: {
                        intention: intentionText || 'Identifie les segments les plus pertinents.',
                        sequences: formatted
                    }
                });
            });

            // Si ce n'était pas une erreur d'auth, propager l'erreur
            if (!wasAuthError) {
                throw error;
            }
        }
    }

    /**
     * Orchestre la creation iterative des sequences Smart Cut
     * @param {Array} segments - Segments valides (non-supprimes)
     * @param {string} sourceSequenceName - Nom de la sequence source
     * @param {Object} callbacks - {onCreated(name, current, total), onError(error), onComplete(createdNames)}
     * @returns {Promise<string[]>} Noms des sequences creees
     */
    async createSequences(segments, sourceSequenceName, callbacks = {}) {
        const { onCreated, onError, onComplete } = callbacks;

        const existingNames = await this.premiere.getExistingSequenceNames();
        const createdNames = [];

        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];

            // Valider les timecodes avant l'appel JSX
            if (typeof segment.start !== 'number' || typeof segment.end !== 'number' ||
                isNaN(segment.start) || isNaN(segment.end) ||
                segment.start < 0 || segment.start >= segment.end) {
                throw new Error('Segment ' + (i + 1) + ' invalide: timecodes incorrects (start=' + segment.start + ', end=' + segment.end + ')');
            }

            const seqName = this.generateSequenceName(existingNames, i + 1);

            try {
                const result = await this.premiere.createSmartCutSequence(
                    seqName,
                    String(segment.start),
                    String(segment.end),
                    sourceSequenceName
                );

                if (result.error) throw new Error(result.error);

                createdNames.push(seqName);
                existingNames.push(seqName);
                if (onCreated) onCreated(seqName, i + 1, segments.length);
            } catch (error) {
                if (onError) onError(error, seqName, i + 1);
                throw error;
            }
        }

        if (onComplete) onComplete(createdNames);
        return createdNames;
    }

    /**
     * Supprime les sequences creees (undo)
     * @param {string[]} sequenceNames - Noms des sequences a supprimer
     * @returns {Promise<Object>} Resultat de l'undo
     */
    async undoCreation(sequenceNames) {
        return await this.premiere.undoSmartCut(sequenceNames);
    }

    /**
     * Genere un nom de sequence SHORT{N} en evitant les collisions
     * Demarre apres le plus grand SHORTX existant pour eviter les doublons multi-run
     * @param {string[]} existingNames - Noms existants
     * @param {number} index - Index de depart (dans le batch courant)
     * @returns {string} Nom unique (ex: SHORT1, SHORT2...)
     */
    generateSequenceName(existingNames, index) {
        var maxExisting = 0;
        for (var j = 0; j < existingNames.length; j++) {
            var match = existingNames[j].match(/^SHORT(\d+)$/);
            if (match) {
                var num = parseInt(match[1], 10);
                if (num > maxExisting) maxExisting = num;
            }
        }
        var startIdx = Math.max(index, maxExisting + 1);
        var name = 'SHORT' + startIdx;
        while (existingNames.indexOf(name) !== -1) {
            startIdx++;
            name = 'SHORT' + startIdx;
        }
        return name;
    }

    /**
     * Formate la transcription pour l'envoi a OpenAI
     * Retire le champ words pour reduire les tokens
     * @param {Array} transcription - Transcription brute
     * @returns {Array} Transcription formatee
     */
    formatTranscription(transcription) {
        return transcription.map(function(seg) {
            return {
                index: seg.index,
                start: seg.start,
                end: seg.end,
                text: seg.text
            };
        });
    }
}

export default SmartCutService;
