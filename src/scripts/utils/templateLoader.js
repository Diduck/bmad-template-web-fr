// Chargement de templates .md via XHR synchrone (compatible ES6 modules CEP)
import ErrorHandler from './errorHandler.js';

function getExtensionRoot() {
    const cs = new CSInterface();
    return cs.getSystemPath(SystemPath.EXTENSION);
}

/**
 * Charge un fichier template .md depuis le dossier de l'extension
 * @param {string} relativePath - Chemin relatif depuis la racine de l'extension (ex: 'config/templates/xxx.md')
 * @returns {string|null} Contenu du fichier ou null si introuvable/vide
 */
export function loadTemplate(relativePath) {
    try {
        const root = getExtensionRoot();
        const fullPath = (root + '/' + relativePath).replace(/\\/g, '/');
        const url = 'file:///' + encodeURI(fullPath).replace(/#/g, '%23');
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, false);
        xhr.overrideMimeType('text/plain; charset=utf-8');
        xhr.send();
        if (xhr.status === 0 || xhr.status === 200) {
            const content = (xhr.responseText || '').trim();
            return content || null;
        }
        return null;
    } catch (error) {
        ErrorHandler.handle(error, 'loadTemplate', `Template non trouvé : ${relativePath}`);
        return null;
    }
}
