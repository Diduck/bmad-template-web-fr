import { loadTemplate } from '../utils/templateLoader.js';
import { MOTION_DESIGN, ERRORS, SUCCESS, TEMPLATE_PATHS, OPENAI } from '../utils/constants.js';
import { delay, handleClaudeAuthError } from '../utils/helpers.js';
import ClaudeClient, { ClaudeAuthError } from '../api/claude.js';

/**
 * Service Motion Design — pipeline complet sous-titre → Lottie → .mov → timeline
 * Utilise Claude CLI (abonnement Claude, pas API) pour la génération Lottie.
 * Utilise cep.fs (API native CEP) pour l'écriture binaire des frames PNG
 * et JSX via premiereAsync pour les opérations fichiers/dossiers/ffmpeg.
 */
class MotionDesignService {
    constructor(premiereAsync, csInterface) {
        this.premiere = premiereAsync;
        this.csInterface = csInterface;
        this.claude = new ClaudeClient(premiereAsync);
    }

    /**
     * Extrait un objet JSON depuis du texte brut Claude (strip markdown, fix trailing commas)
     * @param {string} raw - Texte brut contenant du JSON
     * @returns {Object} Objet parsé
     */
    _extractJsonFromRaw(raw) {
        // Tentative directe
        try { return JSON.parse(raw); } catch (e) { /* continue */ }

        // Strip markdown code blocks
        let cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();

        // Extraire le premier objet JSON { ... }
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('Pas de JSON valide trouvé dans la réponse Claude');
        cleaned = jsonMatch[0];

        // Fix trailing commas
        cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

        return JSON.parse(cleaned);
    }

    /**
     * Valide la structure minimale d'un JSON Lottie
     * @param {Object} json - Objet parsé à valider
     * @returns {{valid: boolean, errors: string[]}}
     */
    _validateLottieJson(json) {
        const errors = [];
        if (!json || typeof json !== 'object') return { valid: false, errors: ['Pas un objet JSON'] };

        for (const key of ['v', 'fr', 'ip', 'op', 'w', 'h', 'layers']) {
            if (!(key in json)) errors.push(`Champ racine manquant : "${key}"`);
        }
        if (json.fr !== 30) errors.push('fr doit être 30, reçu : ' + json.fr);
        if (json.ip !== 0) errors.push('ip doit être 0, reçu : ' + json.ip);
        if (json.op !== 90) errors.push('op doit être 90, reçu : ' + json.op);
        if (json.w !== 1000) errors.push('w doit être 1000, reçu : ' + json.w);
        if (json.h !== 1000) errors.push('h doit être 1000, reçu : ' + json.h);
        if (!Array.isArray(json.layers)) {
            errors.push('layers doit être un array');
        } else if (json.layers.length < 2) {
            errors.push('Minimum 2 layers requis, reçu : ' + json.layers.length);
        } else {
            for (let i = 0; i < json.layers.length; i++) {
                const l = json.layers[i];
                if (!l || typeof l !== 'object') { errors.push(`Layer ${i} : pas un objet`); continue; }
                if (l.ty !== 4) errors.push(`Layer ${i} (${l.nm || '?'}) : ty doit être 4, reçu ${l.ty}`);
                if (!l.ks) errors.push(`Layer ${i} (${l.nm || '?'}) : ks (transform) manquant`);
                if (!Array.isArray(l.shapes) || l.shapes.length === 0) {
                    errors.push(`Layer ${i} (${l.nm || '?'}) : shapes manquant ou vide`);
                }
            }
        }
        return { valid: errors.length === 0, errors };
    }

    /**
     * Trouve le mot le plus proche du curseur parmi les sous-titres.
     * Si le mot le plus proche est un mot-outil (le, la, de, et, ...), cherche le mot
     * de contenu le plus proche à la place.
     * @param {Array} subtitles - Sous-titres avec leurs mots [{words: [{word, start, end}]}]
     * @param {number} cursorTime - Position du curseur en secondes
     * @returns {string|null} Le mot le plus pertinent, ou null
     */
    _findClosestWord(subtitles, cursorTime) {
        // Collecter tous les mots avec leur distance au curseur
        const allWords = [];
        for (const sub of subtitles) {
            if (!Array.isArray(sub.words)) continue;
            for (const w of sub.words) {
                // Distance = min(|cursor - start|, |cursor - end|, |cursor - midpoint|)
                const mid = (w.start + w.end) / 2;
                const dist = Math.min(
                    Math.abs(cursorTime - w.start),
                    Math.abs(cursorTime - w.end),
                    Math.abs(cursorTime - mid)
                );
                allWords.push({ word: w.word, dist });
            }
        }
        if (allWords.length === 0) return null;

        // Trier par distance
        allWords.sort((a, b) => a.dist - b.dist);

        // Mots-outils à éviter comme mot principal
        const stopWords = new Set([
            'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'da',
            'et', 'ou', 'mais', 'donc', 'car', 'ni', 'or',
            'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles',
            'me', 'te', 'se', 'ce', 'ça', 'qui', 'que', 'quoi',
            'à', 'a', 'au', 'aux', 'en', 'dans', 'sur', 'sous', 'par', 'pour', 'avec', 'sans',
            'ne', 'pas', 'plus', 'est', 'sont', 'ai', 'as', 'ont',
            'mon', 'ton', 'son', 'ma', 'ta', 'sa', 'mes', 'tes', 'ses',
            'the', 'a', 'an', 'is', 'it', 'in', 'on', 'to', 'of', 'and', 'or', 'but',
            'this', 'that', 'my', 'your', 'his', 'her'
        ]);

        // Le mot le plus proche
        const closest = allWords[0].word;

        // Si c'est un mot-outil, chercher le premier mot de contenu dans les 5 plus proches
        if (stopWords.has(closest.toLowerCase())) {
            const contentWord = allWords.find(w => !stopWords.has(w.word.toLowerCase()));
            if (contentWord) return contentWord.word;
        }

        return closest;
    }

    /**
     * Génère un JSON Lottie via Claude CLI (2 étapes : scénario + Lottie)
     * @param {string} subtitleText - Texte du sous-titre
     * @param {string} tempDir - Dossier temporaire
     * @param {Object} callbacks - { onScenarioProgress, onLottieProgress, onStepChange }
     * @param {string|null} focusWord - Mot le plus proche du curseur (optionnel)
     * @returns {Promise<Object>} JSON Lottie parsé et validé
     */
    async _generateLottieViaClaude(subtitleText, tempDir, callbacks = {}, focusWord = null) {
        const { onScenarioProgress, onLottieProgress, onStepChange } = callbacks;
        const MAX_ATTEMPTS = 3;

        // ── Étape 1 : Creative Director — sous-titre → scénario créatif ──
        const creativePrompt = loadTemplate(TEMPLATE_PATHS.LOTTIE_CREATIVE_DIRECTOR);
        if (!creativePrompt) {
            throw new Error('Template Creative Director introuvable : ' + TEMPLATE_PATHS.LOTTIE_CREATIVE_DIRECTOR);
        }

        if (onStepChange) onStepChange('scenario');

        let scenarioPromptContent = creativePrompt + '\n\n---\n\nSous-titre à animer :\n' + subtitleText;
        if (focusWord) {
            scenarioPromptContent += '\n\nMOT-CLÉ PRIORITAIRE : « ' + focusWord + ' » — ce mot est celui sur lequel le curseur est positionné dans la vidéo. L\'animation doit mettre l\'accent sur ce mot ou son concept. Si ce mot est un mot-outil sans sens visuel propre, utilise le contexte de la phrase pour trouver l\'objet concret le plus pertinent.';
        }
        const scenarioRaw = await this.claude._runAndPoll(scenarioPromptContent, tempDir, {
            onProgress: onScenarioProgress ? (charCount) => onScenarioProgress(charCount) : null
        }, 120000);

        console.log('=== CLAUDE ÉTAPE 1 — SCÉNARIO RAW ===');
        console.log(scenarioRaw);
        console.log('=== FIN SCÉNARIO RAW ===');

        let scenario;
        try {
            scenario = this._extractJsonFromRaw(scenarioRaw);
            console.log('=== SCÉNARIO PARSÉ ===');
            console.log(JSON.stringify(scenario, null, 2));
        } catch (e) {
            console.error('=== ERREUR PARSE SCÉNARIO ===', e.message);
            throw new Error('Scénario créatif invalide : ' + e.message);
        }

        // ── Étape 2 : Lottie Generator — scénario → JSON Lottie (avec retry) ──
        const lottiePrompt = loadTemplate(TEMPLATE_PATHS.LOTTIE_STYLE_IMPACT);
        if (!lottiePrompt) {
            throw new Error('Template Lottie Generator introuvable : ' + TEMPLATE_PATHS.LOTTIE_STYLE_IMPACT);
        }

        let lastError = null;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            if (onStepChange) onStepChange('lottie', attempt, MAX_ATTEMPTS);

            // Construire le prompt Lottie
            let lottiePromptContent = lottiePrompt + '\n\n---\n\nScénario à transformer en JSON Lottie :\n' + JSON.stringify(scenario, null, 2);

            // Si retry, ajouter le feedback d'erreur
            if (attempt > 1 && lastError) {
                lottiePromptContent += '\n\n⚠️ ERREUR PRÉCÉDENTE — ta réponse contenait ces erreurs :\n' + lastError + '\n\nCorrige UNIQUEMENT les erreurs et renvoie le JSON Lottie complet et VALIDE.';
            }

            console.log(`=== LANCEMENT ÉTAPE 2 — CLAUDE LOTTIE (tentative ${attempt}) ===`);
            console.log(`Prompt Lottie: ${lottiePromptContent.length} chars`);
            console.log(`tempDir: ${tempDir}`);

            try {
                const lottieRaw = await this.claude._runAndPoll(lottiePromptContent, tempDir, {
                    onProgress: onLottieProgress ? (charCount) => onLottieProgress(charCount, attempt) : null
                }, 1000000);

                console.log(`=== CLAUDE ÉTAPE 2 — LOTTIE RAW (tentative ${attempt}) ===`);
                console.log(lottieRaw);
                console.log('=== FIN LOTTIE RAW ===');

                // Parser le JSON Lottie
                let lottieJson;
                try {
                    lottieJson = this._extractJsonFromRaw(lottieRaw);
                    console.log(`=== LOTTIE PARSÉ (tentative ${attempt}) — ${lottieJson.layers?.length || 0} layers ===`);
                } catch (e) {
                    lastError = 'JSON non parsable : ' + e.message;
                    console.error(`=== ERREUR PARSE LOTTIE (tentative ${attempt}) ===`, e.message);
                    console.log('Raw début:', lottieRaw?.slice(0, 200));
                    console.log('Raw fin:', lottieRaw?.slice(-200));
                    if (attempt < MAX_ATTEMPTS) {
                        window.notifications?.warning(`JSON Lottie invalide (tentative ${attempt}/${MAX_ATTEMPTS}), nouvel essai...`);
                        continue;
                    }
                    throw new Error('JSON Lottie non parsable après ' + MAX_ATTEMPTS + ' tentatives : ' + e.message);
                }

                // Valider la structure Lottie
                const validation = this._validateLottieJson(lottieJson);
                if (!validation.valid) {
                    lastError = validation.errors.join('\n');
                    console.error(`=== VALIDATION LOTTIE ÉCHOUÉE (tentative ${attempt}) ===`);
                    console.error(validation.errors);
                    if (attempt < MAX_ATTEMPTS) {
                        window.notifications?.warning(`Structure Lottie invalide (tentative ${attempt}/${MAX_ATTEMPTS}), nouvel essai...`);
                        continue;
                    }
                    throw new Error('Structure Lottie invalide après ' + MAX_ATTEMPTS + ' tentatives :\n' + lastError);
                }

                console.log(`=== LOTTIE VALIDÉ (tentative ${attempt}) ===`);
                return lottieJson;

            } catch (err) {
                if (err.message.includes('après ' + MAX_ATTEMPTS + ' tentatives')) throw err;
                lastError = err.message;
                if (attempt === MAX_ATTEMPTS) throw err;
                window.notifications?.warning(`Erreur génération Lottie (tentative ${attempt}/${MAX_ATTEMPTS}), nouvel essai...`);
            }
        }
    }

    /**
     * Pipeline principal : ajouter un overlay motion design au curseur
     * @param {string} color - Couleur hex (#RRGGBBAA ou #RRGGBB)
     * @param {Object} progress - { setMessage, setProgress, hideProgress }
     * @returns {Promise<void>}
     */
    async addMotionAtCursor(color, progress) {
        const bar = progress?.setProgress || (() => {});
        const step = progress?.setStep || (() => {});

        // 1. Récupérer la position du curseur
        const ctiResult = await this.premiere.getCTIPosition();
        if (ctiResult.error) {
            window.notifications.error(ctiResult.error);
            return;
        }
        const { position, sequenceName } = ctiResult;

        // 2. Récupérer les sous-titres au curseur
        const subtitlesResult = await this.premiere.getSubtitlesAtTime(
            sequenceName,
            position,
            MOTION_DESIGN.SUBTITLE_WINDOW_SEC
        );
        if (subtitlesResult.error) {
            window.notifications.error(subtitlesResult.error);
            return;
        }
        if (!subtitlesResult.subtitles || subtitlesResult.subtitles.length === 0) {
            window.notifications.error(ERRORS.NO_SUBTITLES_AT_CURSOR);
            return;
        }

        // 3. Concaténer les textes des sous-titres + trouver le mot-focus
        const subtitleText = subtitlesResult.subtitles.map(s => s.text).join(' ');
        const focusWord = this._findClosestWord(subtitlesResult.subtitles, position);

        // F9: Vérifier que lottie-web est disponible avant de lancer le pipeline lourd
        if (typeof lottie === 'undefined') {
            window.notifications.error('lottie-web non chargé — vérifie ta connexion internet et recharge l\'extension');
            return;
        }

        // F3: Dossier temporaire unique par invocation (dans l'extension)
        const extensionRoot = this.csInterface.getSystemPath(SystemPath.EXTENSION);
        const framesDir = this.claude._pathJoin(extensionRoot, 'temp', 'lottie-' + Date.now());
        await this.premiere.ensureDir(framesDir);

        // Suivi pour cleanup-on-error (F5)
        let anim = null;
        let outputPath = null;

        try {
            // ── Étape 1 sur 4 — Scénario créatif ──
            // ── Étape 2 sur 4 — Génération de l'animation ──
            // ── Étape 3 sur 4 — Export des frames ──
            // ── Étape 4 sur 4 — Conversion vidéo ──
            // Chaque étape a sa propre barre 0-100%, reset automatique via step()

            const MAX_RENDER_ATTEMPTS = 3;
            let lottieJson = null;

            for (let renderAttempt = 1; renderAttempt <= MAX_RENDER_ATTEMPTS; renderAttempt++) {
                const attemptLabel = renderAttempt > 1
                    ? ` (tentative ${renderAttempt}/${MAX_RENDER_ATTEMPTS})`
                    : '';

                // ── ÉTAPE 1 — Scénario créatif ──
                step(1, 4, 'Scénario créatif' + attemptLabel);

                // Helper pour la génération avec retry en cas d'erreur d'auth
                const generateLottie = async () => {
                    lottieJson = await this._generateLottieViaClaude(subtitleText, framesDir, {
                        onScenarioProgress: (charCount) => {
                            bar(Math.min(95, Math.round(charCount / 4000 * 95)), 'Génération du scénario...');
                        },
                        onLottieProgress: (charCount, attempt) => {
                            const detail = attempt > 1
                                ? `Correction ${attempt}/3...`
                                : 'Génération en cours...';
                            // 100000 : ralentir la barre 2x (Lottie JSON riche = longue génération)
                            bar(Math.min(95, Math.round(charCount / 100000 * 95)), detail);
                        },
                        onStepChange: (stepName, attempt, maxAttempts) => {
                            if (stepName === 'lottie') {
                                // ── ÉTAPE 2 — Génération de l'animation ──
                                const label = attempt > 1
                                    ? `Génération de l'animation (correction ${attempt}/${maxAttempts})`
                                    : 'Génération de l\'animation';
                                step(2, 4, label + attemptLabel);
                            }
                        }
                    }, focusWord);

                    // Test lottie-web (toujours dans l'étape 2)
                    bar(90, 'Vérification du rendu...');
                    await this._testLottieLoad(lottieJson);
                };

                try {
                    await generateLottie();
                    // Succès — sortir de la boucle
                    break;

                } catch (genError) {
                    // Gestion spéciale pour les erreurs d'auth Claude
                    const wasAuthError = await handleClaudeAuthError(genError, async () => {
                        step(1, 4, 'Reconnexion réussie, reprise...');
                        await generateLottie();
                    });

                    // Si c'était une erreur d'auth et qu'on a réessayé, sortir de la boucle
                    if (wasAuthError && lottieJson) {
                        break;
                    }

                    // Erreur normale (pas d'auth) — retry selon la logique existante
                    if (!wasAuthError) {
                        if (renderAttempt < MAX_RENDER_ATTEMPTS) {
                            window.notifications.warning(
                                `Animation invalide (tentative ${renderAttempt}/${MAX_RENDER_ATTEMPTS}) : ${genError.message.slice(0, 80)}. Nouvelle génération...`
                            );
                            lottieJson = null;
                            continue;
                        }
                        throw new Error(
                            `Impossible de générer une animation valide après ${MAX_RENDER_ATTEMPTS} tentatives : ${genError.message}`
                        );
                    }
                }
            }

            // ── ÉTAPE 3 — Export des frames ──
            step(3, 4, 'Export des frames');
            this.applyColorToLottie(lottieJson, color);
            bar(2, 'Couleur appliquée');

            const renderResult = await this.renderAndExportFrames(lottieJson, framesDir, (frameIdx, total) => {
                bar(Math.round(frameIdx / total * 100), `Frame ${frameIdx}/${total}`);
            });
            anim = renderResult.anim;

            // F10: Vérifier que toutes les frames ont été écrites
            const expectedFrames = MOTION_DESIGN.DURATION_FRAMES;
            if (renderResult.framesWritten !== expectedFrames) {
                throw new Error(`Export incomplet : ${renderResult.framesWritten}/${expectedFrames} frames`);
            }

            // ── ÉTAPE 4 — Conversion vidéo ──
            step(4, 4, 'Conversion vidéo');
            bar(0, 'Conversion ffmpeg...');
            const safeSeqName = sequenceName.replace(/[^a-zA-Z0-9_-]/g, '_');
            const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
            const fileName = `motion_${safeSeqName}_cursor_${timestamp}.mov`;
            outputPath = this.claude._pathJoin(framesDir, fileName);
            await this.convertToMov(framesDir, outputPath, extensionRoot);

            bar(50, 'Import Premiere...');

            // F4: Valider le chemin projet avant de construire les paths
            const projectFolderPath = await this.premiere.getProjectFolderPath();
            if (!projectFolderPath || projectFolderPath.length < 3) {
                throw new Error('Chemin projet invalide — sauvegarde le projet Premiere avant de continuer');
            }

            // Copier dans les emplacements de stockage
            await this.copyToStorageLocations(outputPath, fileName, projectFolderPath);

            bar(75, 'Import sur la timeline...');

            // Importer sur la timeline (F6: import depuis vault, après copie confirmée)
            const vaultPath = this.claude._pathJoin(projectFolderPath, '03_Vault', 'motion-design', fileName);
            const importResult = await this.premiere.importLottieOverlay(sequenceName, vaultPath, position);
            if (importResult.error) {
                window.notifications.error(importResult.error);
                return;
            }

            bar(100, 'Terminé !');
            window.notifications.success(SUCCESS.MOTION_ADDED_HERE);

        } catch (error) {
            // F5: Cleanup l'animation lottie en cas d'erreur
            if (anim) {
                try { anim.destroy(); } catch (e) { /* ignore */ }
            }
            const container = document.getElementById('lottie-render-container');
            if (container) container.innerHTML = '';
            throw error;
        } finally {
            // 10. Nettoyer les frames temporaires (toujours, succès ou erreur)
            await this._cleanupTempDir(framesDir, outputPath);
        }
    }

    /**
     * Supprime les fichiers temporaires (frames PNG + .mov temp)
     */
    async _cleanupTempDir(framesDir, outputPath) {
        try {
            const files = await this.premiere.listDir(framesDir);
            for (const f of files) {
                if (f.startsWith('frame_') && f.endsWith('.png')) {
                    await this.premiere.deleteFile(this.claude._pathJoin(framesDir, f));
                }
            }
            // F6: Supprimer le .mov temp seulement si copie + import réussis
            if (outputPath) {
                await this.premiere.deleteFile(outputPath);
            }
            // Tenter de supprimer le dossier temp lui-même (F3: dossier unique)
            await this.premiere.deleteFolder(framesDir);
        } catch (e) {
            console.warn('Nettoyage frames temporaires échoué:', e);
        }
    }

    /**
     * Test rapide de chargement lottie-web (DOMLoaded) sans export de frames.
     * Permet de détecter un JSON sémantiquement invalide AVANT le rendu complet.
     * @param {Object} lottieJson - Objet Lottie JSON parsé et validé structurellement
     * @param {number} timeoutMs - Timeout en ms (défaut 5000)
     * @returns {Promise<void>} Résout si ok, rejette si timeout/erreur
     */
    async _testLottieLoad(lottieJson, timeoutMs = 5000) {
        let container = document.getElementById('lottie-render-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'lottie-render-container';
            container.style.cssText = 'position:absolute;left:-9999px;width:100px;height:100px;';
            document.body.appendChild(container);
        }
        container.innerHTML = '';

        const anim = lottie.loadAnimation({
            container: container,
            renderer: 'svg',
            loop: false,
            autoplay: false,
            animationData: JSON.parse(JSON.stringify(lottieJson))
        });

        try {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout chargement lottie-web : le JSON est probablement sémantiquement invalide'));
                }, timeoutMs);
                anim.addEventListener('DOMLoaded', () => {
                    clearTimeout(timeout);
                    resolve();
                });
                anim.addEventListener('error', () => {
                    clearTimeout(timeout);
                    reject(new Error('lottie-web a rejeté le JSON (erreur de rendu)'));
                });
            });
        } finally {
            try { anim.destroy(); } catch (e) { /* ignore */ }
            container.innerHTML = '';
        }
    }

    /**
     * Applique une couleur hex à un JSON Lottie en remplaçant le blanc [1,1,1,1]
     * @param {Object} json - Objet Lottie JSON (muté en place)
     * @param {string} hexColor - Couleur hex (#RRGGBB ou #RRGGBBAA)
     */
    applyColorToLottie(json, hexColor) {
        const hex = hexColor.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16) / 255;
        const g = parseInt(hex.substring(2, 4), 16) / 255;
        const b = parseInt(hex.substring(4, 6), 16) / 255;
        const a = hex.length >= 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1;
        const newColor = [r, g, b, a];

        this._replaceColorsRecursive(json, newColor);
    }

    /**
     * F7: Vérifie si une valeur est proche de 1.0 (tolérance pour float)
     */
    _isWhiteComponent(val) {
        return typeof val === 'number' && val >= 0.99;
    }

    /**
     * Parcourt récursivement le JSON Lottie et remplace les couleurs blanches
     * F7: Gère les couleurs statiques (a=0) et animées (a=1), avec tolérance float
     */
    _replaceColorsRecursive(obj, newColor) {
        if (!obj || typeof obj !== 'object') return;

        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                this._replaceColorsRecursive(obj[i], newColor);
            }
            return;
        }

        for (const key of Object.keys(obj)) {
            if (key === 'c' && obj[key] && typeof obj[key] === 'object') {
                const colorObj = obj[key];
                if (colorObj.a === 0 && Array.isArray(colorObj.k)) {
                    // Couleur statique
                    const k = colorObj.k;
                    if (k.length >= 3 && this._isWhiteComponent(k[0]) && this._isWhiteComponent(k[1]) && this._isWhiteComponent(k[2])) {
                        colorObj.k = [...newColor];
                    }
                } else if (colorObj.a === 1 && Array.isArray(colorObj.k)) {
                    // Couleur animée (keyframes) — remplacer chaque keyframe
                    for (let i = 0; i < colorObj.k.length; i++) {
                        const kf = colorObj.k[i];
                        if (kf && Array.isArray(kf.s) && kf.s.length >= 3) {
                            if (this._isWhiteComponent(kf.s[0]) && this._isWhiteComponent(kf.s[1]) && this._isWhiteComponent(kf.s[2])) {
                                kf.s = [...newColor];
                            }
                        }
                        if (kf && Array.isArray(kf.e) && kf.e.length >= 3) {
                            if (this._isWhiteComponent(kf.e[0]) && this._isWhiteComponent(kf.e[1]) && this._isWhiteComponent(kf.e[2])) {
                                kf.e = [...newColor];
                            }
                        }
                    }
                }
            }
            this._replaceColorsRecursive(obj[key], newColor);
        }
    }

    /**
     * Rendu lottie-web frame-by-frame → export PNG dans un dossier
     * IMPORTANT : utilise SVG visible → sérialisation → canvas (jamais canvas offscreen)
     * Écriture binaire via cep.fs avec encodage Base64
     * @param {Object} lottieJson - Animation Lottie JSON
     * @param {string} framesDir - Dossier de sortie pour les PNG
     * @param {Function} onFrameProgress - Callback (frameIdx, totalFrames)
     * @returns {Promise<{anim: Object, framesWritten: number}>}
     */
    async renderAndExportFrames(lottieJson, framesDir, onFrameProgress = null) {
        const size = MOTION_DESIGN.CANVAS_SIZE;
        const totalFrames = MOTION_DESIGN.DURATION_FRAMES;

        // Créer un container SVG caché dans le DOM
        let container = document.getElementById('lottie-render-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'lottie-render-container';
            container.style.cssText = 'position:absolute;left:-9999px;width:' + size + 'px;height:' + size + 'px;';
            document.body.appendChild(container);
        }
        container.innerHTML = '';

        // Charger l'animation
        const anim = lottie.loadAnimation({
            container: container,
            renderer: 'svg',
            loop: false,
            autoplay: false,
            animationData: lottieJson
        });

        // F2: Attendre DOMLoaded avec timeout de 10s
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout : l\'animation Lottie n\'a pas pu se charger (JSON probablement invalide)'));
            }, 10000);
            anim.addEventListener('DOMLoaded', () => {
                clearTimeout(timeout);
                resolve();
            });
            anim.addEventListener('error', () => {
                clearTimeout(timeout);
                reject(new Error('Erreur de chargement de l\'animation Lottie'));
            });
        });

        // Canvas pour l'export
        let canvas = document.getElementById('lottie-export-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'lottie-export-canvas';
            canvas.width = size;
            canvas.height = size;
            canvas.style.display = 'none';
            document.body.appendChild(canvas);
        }
        const ctx = canvas.getContext('2d');

        // F10: Compteur de frames écrites
        let framesWritten = 0;

        // Exporter frame par frame
        for (let frame = 0; frame < totalFrames; frame++) {
            anim.goToAndStop(frame, true);

            // Sérialiser le SVG
            const svgElement = container.querySelector('svg');
            const serializer = new XMLSerializer();
            const svgString = serializer.serializeToString(svgElement);
            const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(svgBlob);

            // Dessiner sur canvas
            const img = new Image();
            await new Promise((resolve, reject) => {
                img.onload = () => {
                    ctx.clearRect(0, 0, size, size);
                    ctx.drawImage(img, 0, 0, size, size);
                    URL.revokeObjectURL(url);
                    resolve();
                };
                img.onerror = reject;
                img.src = url;
            });

            // Exporter en PNG via canvas → base64 → cep.fs (écriture binaire)
            const dataUrl = canvas.toDataURL('image/png');
            const base64Data = dataUrl.split(',')[1];
            const frameNum = String(frame + 1).padStart(3, '0');
            const framePath = this.claude._pathJoin(framesDir, 'frame_' + frameNum + '.png');

            const writeResult = window.cep.fs.writeFile(framePath, base64Data, cep.encoding.Base64);
            if (writeResult.err !== 0) {
                throw new Error(`Échec écriture frame ${frame + 1} : erreur cep.fs ${writeResult.err}`);
            }
            framesWritten++;
            if (onFrameProgress) onFrameProgress(framesWritten, totalFrames);
        }

        // Nettoyer l'animation
        anim.destroy();
        container.innerHTML = '';

        return { anim: null, framesWritten };
    }

    /**
     * Convertit les frames PNG en .mov ProRes 4444 via ffmpeg (JSX runSetupCommand)
     * @param {string} framesDir - Dossier contenant les frames
     * @param {string} outputPath - Chemin de sortie du .mov
     * @param {string} extensionRoot - Racine de l'extension CEP
     * @returns {Promise<void>}
     */
    async convertToMov(framesDir, outputPath, extensionRoot) {
        const ffmpegPath = this.claude._pathJoin(extensionRoot, 'bin', 'ffmpeg.exe');
        // %%03d : dans un .bat, %0 est interprété comme le nom du script → il faut doubler le %
        const inputPattern = this.claude._pathJoin(framesDir, 'frame_%%03d.png');

        // -start_number 1 doit précéder -i (option du demuxer image2)
        const cmd = `"${ffmpegPath}" -y -framerate ${MOTION_DESIGN.FPS} -start_number 1 -i "${inputPattern}" -frames:v ${MOTION_DESIGN.DURATION_FRAMES} -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -color_range pc -an "${outputPath}"`;

        console.log(`[FFMPEG] cmd: ${cmd}`);
        const ffmpegOutput = await this.premiere.runCommand(cmd, 120000);
        console.log(`[FFMPEG] output: ${ffmpegOutput ? ffmpegOutput.slice(-500) : '(vide)'}`);

        // Vérifier que le fichier a été créé et n'est pas vide
        const exists = await this.premiere.fileExists(outputPath);
        if (!exists) {
            const detail = ffmpegOutput ? ffmpegOutput.trim().split('\n').pop() : 'aucun détail';
            throw new Error(`ffmpeg n'a pas produit de fichier de sortie — ${detail}`);
        }
    }

    /**
     * Copie le .mov dans les emplacements de stockage (app data + vault projet)
     * @param {string} movPath - Chemin source du .mov
     * @param {string} fileName - Nom du fichier
     * @param {string} projectFolderPath - Chemin du dossier projet
     */
    async copyToStorageLocations(movPath, fileName, projectFolderPath) {
        // App data historique permanent
        const appDataDir = this.claude._pathJoin(
            this.csInterface.getSystemPath(SystemPath.USER_DATA),
            'Productivity', 'motion-design'
        );
        const appDataOk = await this.premiere.ensureDir(appDataDir, { critical: false });
        if (appDataOk) {
            const copied = await this.premiere.copyFile(movPath, this.claude._pathJoin(appDataDir, fileName));
            if (!copied) console.warn('[MotionDesign] Copie AppData échouée:', appDataDir);
        }

        // Vault projet
        const vaultDir = this.claude._pathJoin(projectFolderPath, '03_Vault', 'motion-design');
        const vaultOk = await this.premiere.ensureDir(vaultDir, { critical: false });
        if (vaultOk) {
            const copied = await this.premiere.copyFile(movPath, this.claude._pathJoin(vaultDir, fileName));
            if (!copied) console.warn('[MotionDesign] Copie Vault échouée:', vaultDir);
        }

        // .Productivity dynamique (chemin caché dans AppData)
        const appDataRoaming = this.csInterface.getSystemPath(SystemPath.USER_DATA);
        const dotProductivityDir = this.claude._pathJoin(appDataRoaming, '.Productivity', 'motion-design');
        const dotProdOk = await this.premiere.ensureDir(dotProductivityDir, { critical: false });
        if (dotProdOk) {
            const copied = await this.premiere.copyFile(movPath, this.claude._pathJoin(dotProductivityDir, fileName));
            if (!copied) console.warn('[MotionDesign] Copie .Productivity échouée:', dotProductivityDir);
        }
    }

    /**
     * Re-import existing .mov files from vault onto the timeline without regenerating
     * Scans 03_Vault/motion-design/ for motion_batch_*.mov files,
     * matches them to subtitle positions, and imports onto the timeline.
     * @param {string} sequenceName - Nom de la séquence Premiere
     * @param {Object} callbacks - { onSummary }
     * @returns {Promise<{total: number, succeeded: number, failed: number, errors: Array}>}
     */
    async reimportExistingMotions(sequenceName, callbacks = {}) {
        const { onSummary } = callbacks;

        if (onSummary) onSummary('Recherche des motion designs existants...');

        // Load subtitles to map indices to positions
        const projectPath = await this.premiere.getProjectPath();
        const audioFilePath = `${projectPath}07_Audio\\Audio\\${sequenceName}.json`;
        const jsonContent = await this.premiere.createBrolls(sequenceName, audioFilePath);

        if (!jsonContent || jsonContent === 'null' || jsonContent === 'undefined') {
            throw new Error('Fichier sous-titres introuvable — impossible de re-importer');
        }

        const subtitles = JSON.parse(jsonContent);

        // Scan vault for existing .mov files
        const projectFolderPath = await this.premiere.getProjectFolderPath();
        const vaultDir = this.claude._pathJoin(projectFolderPath, '03_Vault', 'motion-design');
        let files;
        try {
            files = await this.premiere.listDir(vaultDir);
        } catch (e) {
            throw new Error('Dossier vault motion-design introuvable — aucun motion design généré précédemment');
        }

        // Filter .mov files matching this sequence
        // New format: motion_{seqName}_{index}_{timestamp}.mov
        // Legacy format: motion_batch_{index}_{timestamp}.mov
        const safeSeqName = sequenceName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const seqPrefix = `motion_${safeSeqName}_`;
        const movFiles = files.filter(f => f.startsWith(seqPrefix) && f.endsWith('.mov'));

        if (movFiles.length === 0) {
            // No files for this sequence
            return { total: 0, succeeded: 0, failed: 0, errors: [] };
        }

        if (onSummary) onSummary(`${movFiles.length} motion designs trouvés pour ${sequenceName}, import en cours...`);

        let succeeded = 0;
        const errors = [];

        for (const movFile of movFiles) {
            try {
                // Extract index from filename: motion_{seqName}_{index}_{timestamp}.mov
                const match = movFile.match(new RegExp(`^motion_${safeSeqName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)_`));
                if (!match) {
                    errors.push({ file: movFile, error: 'Format de nom invalide' });
                    continue;
                }

                const subIndex = parseInt(match[1], 10);
                const subtitle = subtitles.find(s => s.index === subIndex);
                if (!subtitle) {
                    errors.push({ file: movFile, error: `Sous-titre index ${subIndex} introuvable` });
                    continue;
                }

                const vaultPath = this.claude._pathJoin(vaultDir, movFile);
                const importResult = await this.premiere.importLottieOverlay(sequenceName, vaultPath, subtitle.start);

                if (importResult && importResult.error) {
                    errors.push({ file: movFile, error: importResult.error });
                } else {
                    succeeded++;
                }
            } catch (e) {
                errors.push({ file: movFile, error: e.message });
            }
        }

        if (onSummary) onSummary(`Re-import terminé : ${succeeded}/${movFiles.length} placés sur la timeline`);

        return { total: movFiles.length, succeeded, failed: errors.length, errors };
    }

    /**
     * Workflow batch : détection IA + génération parallèle + rendu séquentiel + import
     * @param {string} sequenceName - Nom de la séquence Premiere
     * @param {string} color - Couleur hex (#RRGGBB ou #RRGGBBAA)
     * @param {Object} openaiClient - Instance OpenAIClient
     * @param {Object} subtitlesService - Instance SubtitlesService (pour auto-transcription)
     * @param {Object} callbacks - { onBatchStart, onItemUpdate, onSummary }
     * @returns {Promise<{total: number, succeeded: number, failed: number, errors: Array}>}
     */
    async executeMotionBatch(sequenceName, color, openaiClient, subtitlesService, callbacks = {}) {
        const { onBatchStart, onItemUpdate, onSummary, onSkipSetup, onRemoveSetup } = callbacks;
        const removedItems = new Set();

        // ═══════════════════════════════════════════════════
        // PHASE 1 : Détection des positions via OpenAI
        // ═══════════════════════════════════════════════════
        if (onSummary) onSummary('Chargement des sous-titres...');

        const projectPath = await this.premiere.getProjectPath();
        const audioFilePath = `${projectPath}07_Audio\\Audio\\${sequenceName}.json`;
        let jsonContent = await this.premiere.createBrolls(sequenceName, audioFilePath);
        const isValidJson = (val) => val && val !== 'null' && val !== 'undefined';

        // Auto-transcription si JSON manquant
        if (!isValidJson(jsonContent) && subtitlesService) {
            if (onSummary) onSummary(`Transcription automatique pour ${sequenceName}...`);
            await subtitlesService.generateForFiles([sequenceName], "BROLL", null, (msg) => {
                if (onSummary) onSummary(msg);
            });
            jsonContent = await this.premiere.createBrolls(sequenceName, audioFilePath);
        }

        if (!isValidJson(jsonContent)) {
            throw new Error(`Fichier JSON introuvable : ${audioFilePath}`);
        }

        const subtitles = JSON.parse(jsonContent);
        if (onSummary) onSummary('Détection des positions motion design...');

        // Découper en batches de 50 et analyser
        const batchSize = 50;
        const liste = subtitles.map(item => [item.index, item.text]);
        const allResults = [];

        for (let b = 0; b < liste.length; b += batchSize) {
            const batch = liste.slice(b, b + batchSize);
            try {
                const response = await openaiClient.analyzeMotionDesign(batch);
                if (Array.isArray(response)) {
                    allResults.push(...response);
                }
            } catch (error) {
                console.error('Erreur analyse lot motion design:', error);
            }
            if (b + batchSize < liste.length) {
                await delay(OPENAI.DELAY_BETWEEN_BATCHES_MS);
            }
        }

        // Construire la liste des positions sélectionnées avec règle "pas de consécutifs"
        const positions = [];
        let lastSelectedIndex = -2; // -2 pour que l'index 0 ne soit jamais "consécutif"

        for (let i = 0; i < subtitles.length; i++) {
            const item = subtitles[i];
            const match = allResults.find(r => r[0] === item.index);
            const selected = match && typeof match[2] === 'string' && match[2].toLowerCase() === 'true';

            if (selected && item.index !== lastSelectedIndex + 1) {
                positions.push({
                    index: item.index,
                    text: item.text,
                    start: item.start,
                    focusWord: this._findClosestWord(subtitles, item.start)
                });
                lastSelectedIndex = item.index;
            }
        }

        // Forcer le 1er sous-titre (index 0) s'il n'est pas déjà sélectionné
        if (subtitles.length > 0 && !positions.find(p => p.index === subtitles[0].index)) {
            const first = subtitles[0];
            positions.unshift({
                index: first.index,
                text: first.text,
                start: first.start,
                focusWord: this._findClosestWord(subtitles, first.start)
            });
            // Retirer le 2ème si maintenant consécutif au 1er
            if (positions.length > 1 && positions[1].index === first.index + 1) {
                positions.splice(1, 1);
            }
        }

        console.log(`[MOTION-BATCH] ${positions.length} positions détectées pour ${sequenceName}`);

        if (positions.length === 0) {
            return { total: 0, succeeded: 0, failed: 0, errors: [] };
        }

        // ═══════════════════════════════════════════════════
        // PHASE 2 : Génération parallèle Claude CLI (stagger 10s)
        // ═══════════════════════════════════════════════════
        const batchItems = positions.map((pos, i) => ({
            id: `motion-${i}`,
            label: pos.text.length > 30 ? pos.text.substring(0, 30) + '...' : pos.text
        }));

        if (onBatchStart) onBatchStart(batchItems, (id) => removedItems.add(id));
        if (onSummary) onSummary(`Génération de ${positions.length} motion designs...`);

        const extensionRoot = this.csInterface.getSystemPath(SystemPath.EXTENSION);
        const results = new Map();
        const indexToItemId = new Map();
        const promises = [];

        for (let i = 0; i < positions.length; i++) {
            const pos = positions[i];
            const itemId = `motion-${i}`;
            indexToItemId.set(pos.index, itemId);

            const promise = (async (index, position, id) => {
                // Stagger : attendre i * 10s avant de lancer
                if (index > 0) {
                    // Check every second during stagger if user removed this item
                    const staggerMs = index * MOTION_DESIGN.STAGGER_INTERVAL_MS;
                    const staggerEnd = Date.now() + staggerMs;
                    while (Date.now() < staggerEnd) {
                        if (removedItems.has(id)) {
                            results.set(position.index, { status: 'error', error: new Error('Retiré par l\'utilisateur'), tempDir: null });
                            return;
                        }
                        await delay(Math.min(1000, staggerEnd - Date.now()));
                    }
                }

                // Final check before launching Claude
                if (removedItems.has(id)) {
                    results.set(position.index, { status: 'error', error: new Error('Retiré par l\'utilisateur'), tempDir: null });
                    return;
                }

                if (onItemUpdate) onItemUpdate(id, { status: 'generating', percent: 0 });

                const tempDir = this.claude._pathJoin(extensionRoot, 'temp', `lottie-batch-${Date.now()}-${position.index}`);
                await this.premiere.ensureDir(tempDir);

                for (let attempt = 1; attempt <= MOTION_DESIGN.BATCH_RETRY_ATTEMPTS; attempt++) {
                    try {
                        const lottieJson = await this._generateLottieViaClaude(position.text, tempDir, {
                            onScenarioProgress: (charCount) => {
                                if (onItemUpdate) {
                                    const pct = Math.min(40, Math.round(charCount / 4000 * 40));
                                    onItemUpdate(id, { status: 'generating', percent: pct, detail: 'Scénario...' });
                                }
                            },
                            onLottieProgress: (charCount) => {
                                if (onItemUpdate) {
                                    const pct = 40 + Math.min(50, Math.round(charCount / 100000 * 50));
                                    onItemUpdate(id, { status: 'generating', percent: pct, detail: 'Animation...' });
                                }
                            }
                        }, position.focusWord);

                        // Stocker sans test lottie-web (le test sera fait en Phase 3 séquentielle
                        // car _testLottieLoad utilise un conteneur DOM singleton)
                        results.set(position.index, { status: 'success', lottieJson, tempDir });
                        if (onItemUpdate) onItemUpdate(id, { status: 'generating', percent: 92, detail: 'Prêt' });
                        return;

                    } catch (error) {
                        console.error(`[MOTION-BATCH] Erreur position ${position.index} tentative ${attempt}:`, error.message);
                        if (attempt < MOTION_DESIGN.BATCH_RETRY_ATTEMPTS) {
                            if (onItemUpdate) onItemUpdate(id, { status: 'generating', percent: 0, detail: `Retry ${attempt + 1}/3...` });
                            await delay(5000);
                        } else {
                            results.set(position.index, { status: 'error', error, tempDir });
                            if (onItemUpdate) onItemUpdate(id, { status: 'error', percent: 0, detail: error.message.slice(0, 50) });
                        }
                    }
                }
            })(i, pos, itemId);

            promises.push(promise);
        }

        // Skip mechanism: user can click "Passer et continuer" to abort waiting
        let skipResolve;
        const skipPromise = new Promise(resolve => { skipResolve = resolve; });
        if (onSkipSetup) onSkipSetup(() => skipResolve('skipped'));

        const raceResult = await Promise.race([
            Promise.allSettled(promises).then(() => 'completed'),
            skipPromise
        ]);

        if (raceResult === 'skipped') {
            // Kill all running Claude processes
            try { await this.premiere.killClaudeProcess(); } catch (e) { /* ignore */ }
            await delay(2000); // Laisser le temps aux process de mourir

            // Mark pending items as skipped in the UI
            for (let i = 0; i < positions.length; i++) {
                const pos = positions[i];
                if (!results.has(pos.index)) {
                    results.set(pos.index, { status: 'error', error: new Error('Passé par l\'utilisateur'), tempDir: null });
                    if (onItemUpdate) onItemUpdate(`motion-${i}`, { status: 'error', percent: 0, detail: 'Passé' });
                }
            }
        }

        const succeeded = [...results.values()].filter(r => r.status === 'success');
        const failed = [...results.values()].filter(r => r.status === 'error');

        if (onSummary) onSummary(`${succeeded.length}/${positions.length} générés, rendu en cours...`);

        // ═══════════════════════════════════════════════════
        // PHASE 3 : Rendu séquentiel + import timeline
        // ═══════════════════════════════════════════════════
        const projectFolderPath = await this.premiere.getProjectFolderPath();
        if (!projectFolderPath || projectFolderPath.length < 3) {
            throw new Error('Chemin projet invalide — sauvegarde le projet Premiere avant de continuer');
        }

        // Trier par start croissant pour import dans l'ordre
        const sortedPositions = positions
            .filter(p => results.has(p.index) && results.get(p.index).status === 'success')
            .sort((a, b) => a.start - b.start);

        let renderCount = 0;
        const renderErrors = [];

        for (const pos of sortedPositions) {
            const itemId = indexToItemId.get(pos.index);
            const result = results.get(pos.index);

            try {
                // Test lottie-web (séquentiel — conteneur DOM singleton)
                if (onItemUpdate) onItemUpdate(itemId, { status: 'generating', percent: 93, detail: 'Vérification Lottie...' });
                await this._testLottieLoad(result.lottieJson);

                if (onItemUpdate) onItemUpdate(itemId, { status: 'generating', percent: 95, detail: 'Rendu frames...' });

                // Appliquer couleur avec contraste garanti
                this.applyColorToLottie(result.lottieJson, color);

                // Rendu frames
                const renderResult = await this.renderAndExportFrames(result.lottieJson, result.tempDir, (frameIdx, total) => {
                    if (onItemUpdate) {
                        const pct = 95 + Math.round(frameIdx / total * 4);
                        onItemUpdate(itemId, { status: 'generating', percent: pct, detail: `Frame ${frameIdx}/${total}` });
                    }
                });

                if (renderResult.framesWritten !== MOTION_DESIGN.DURATION_FRAMES) {
                    throw new Error(`Export incomplet : ${renderResult.framesWritten}/${MOTION_DESIGN.DURATION_FRAMES} frames`);
                }

                // Conversion ffmpeg
                const safeSeqName = sequenceName.replace(/[^a-zA-Z0-9_-]/g, '_');
                const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
                const fileName = `motion_${safeSeqName}_${pos.index}_${timestamp}.mov`;
                const outputPath = this.claude._pathJoin(result.tempDir, fileName);
                await this.convertToMov(result.tempDir, outputPath, extensionRoot);

                // Copier dans les emplacements de stockage
                await this.copyToStorageLocations(outputPath, fileName, projectFolderPath);

                // Import sur la timeline
                const vaultPath = this.claude._pathJoin(projectFolderPath, '03_Vault', 'motion-design', fileName);
                const importResult = await this.premiere.importLottieOverlay(sequenceName, vaultPath, pos.start);
                if (importResult && importResult.error) {
                    console.error(`[MOTION-BATCH] Import timeline échoué position ${pos.index}:`, importResult.error);
                    throw new Error(`Import timeline : ${importResult.error}`);
                }

                if (onItemUpdate) onItemUpdate(itemId, { status: 'done', percent: 100, detail: 'OK' });
                renderCount++;

                // Cleanup
                await this._cleanupTempDir(result.tempDir, outputPath);

            } catch (renderError) {
                console.error(`[MOTION-BATCH] Erreur rendu position ${pos.index}:`, renderError.message);
                if (onItemUpdate) onItemUpdate(itemId, { status: 'error', percent: 0, detail: renderError.message.slice(0, 50) });
                renderErrors.push({ index: pos.index, text: pos.text, error: renderError.message });
                // Cleanup même en erreur
                try { await this._cleanupTempDir(result.tempDir, null); } catch (e) { /* ignore */ }
            }
        }

        // Cleanup les tempDir des positions échouées en phase 2
        for (const [, result] of results) {
            if (result.status === 'error' && result.tempDir) {
                try { await this._cleanupTempDir(result.tempDir, null); } catch (e) { /* ignore */ }
            }
        }

        const totalSucceeded = renderCount;
        const totalFailed = positions.length - totalSucceeded;
        const generationErrors = [...results.entries()]
            .filter(([, r]) => r.status === 'error')
            .map(([idx, r]) => {
                const pos = positions.find(p => p.index === idx);
                return { index: idx, text: pos?.text, error: r.error?.message || 'Erreur inconnue' };
            });
        const allErrors = [...generationErrors, ...renderErrors];

        const summary = `${totalSucceeded}/${positions.length} motion designs réussis`;
        if (onSummary) onSummary(summary);

        return { total: positions.length, succeeded: totalSucceeded, failed: totalFailed, errors: allErrors };
    }
}

export default MotionDesignService;
