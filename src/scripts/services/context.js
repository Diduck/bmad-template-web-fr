import ErrorHandler from '../utils/errorHandler.js';
import { PATHS } from '../utils/constants.js';
import { handleClaudeAuthError } from '../utils/helpers.js';
import { ClaudeAuthError } from '../api/claude.js';

/**
 * Service de generation de contexte video IA
 * Analyse les sous-titres pour determiner la cible, l'intention et un resume
 */
class ContextService {
    constructor(premiereAsync, aiClient) {
        this.premiere = premiereAsync;
        this.aiClient = aiClient;
    }

    /**
     * Genere le contexte video pour un fichier (avec cache)
     * @param {string} file - Nom du fichier (sans extension)
     * @param {string} projectPath - Chemin du projet Premiere
     * @returns {Promise<Object|null>} Contexte JSON ou null si erreur
     */
    async generateForFile(file, projectPath) {
        const contextPath = `${projectPath}${PATHS.AUDIO_FOLDER}\\${PATHS.CONTEXT_SUBFOLDER}\\${file}_context.json`;

        // Check cache
        if (await this.premiere.fileExists(contextPath)) {
            try {
                const cached = await this.premiere.readFile(contextPath);
                const parsed = JSON.parse(cached);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    return parsed;
                }
                console.warn(`[ContextService] Cache invalide (format inattendu), regeneration : ${contextPath}`);
            } catch (e) {
                console.warn(`[ContextService] Cache corrompu, regeneration : ${contextPath}`);
            }
        }

        // Lire le SRT
        const srtPath = `${projectPath}${PATHS.AUDIO_FOLDER}\\${PATHS.SUBTITLES_SUBFOLDER}\\${file}SRT.json`;
        if (!(await this.premiere.fileExists(srtPath))) {
            console.warn(`[ContextService] SRT introuvable : ${srtPath}`);
            return null;
        }

        let subtitlesText;
        try {
            const srtContent = await this.premiere.readFile(srtPath);
            const srtData = JSON.parse(srtContent);
            if (!Array.isArray(srtData)) {
                throw new Error(`SRT invalide (pas un tableau) pour ${file}`);
            }
            // Extraire le texte des segments
            const MAX_CONTEXT_CHARS = 20000;
            subtitlesText = srtData
                .filter(seg => seg && typeof seg === 'object')
                .map(seg => seg.text || '')
                .filter(t => t.trim())
                .join(' ');
            if (subtitlesText.length > MAX_CONTEXT_CHARS) {
                console.info(`[ContextService] Texte tronque de ${subtitlesText.length} a ${MAX_CONTEXT_CHARS} caracteres pour ${file}`);
                subtitlesText = subtitlesText.slice(0, MAX_CONTEXT_CHARS);
            }
        } catch (e) {
            ErrorHandler.handle(e, 'ContextService.generateForFile', `Erreur lecture SRT pour ${file}`);
            return null;
        }

        if (!subtitlesText || !subtitlesText.trim()) {
            console.warn(`[ContextService] SRT vide pour ${file}`);
            return null;
        }

        // Appel IA (OpenAI ou Claude selon le provider) avec gestion d'auth
        const generateContext = async () => {
            const context = await this.aiClient.generateVideoContext(subtitlesText);
            // Sauvegarder dans le cache
            await this.premiere.writeFile(contextPath, JSON.stringify(context, null, 2));
            return context;
        };

        try {
            return await generateContext();
        } catch (e) {
            // Gestion spéciale pour les erreurs d'auth Claude
            const wasAuthError = await handleClaudeAuthError(e, async () => {
                console.log(`[ContextService] Reconnexion réussie, reprise génération contexte pour ${file}`);
                return generateContext();
            });

            // Si ce n'était pas une erreur d'auth, logger et retourner null
            if (!wasAuthError) {
                console.warn(`[ContextService] Erreur generation contexte pour ${file}:`, e.message);
                if (window.notifications) {
                    window.notifications.warning(`Contexte video non genere pour ${file} — les B-rolls seront generes sans contexte`);
                }
                return null;
            }
        }
    }
}

export default ContextService;
