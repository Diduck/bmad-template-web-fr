// ============================================================================
// PRODUCTIVITY EXTENSION - Premiere Pro JSX
// ============================================================================
// Refactorisé pour améliorer la lisibilité et la performance
// Toutes les fonctions publiques conservent leur signature d'origine

(function () {
    if (typeof JSON === "undefined") JSON = {};

    if (typeof JSON.stringify !== "function") {
        function esc(str) {
            return String(str)
                .replace(/\\/g, "\\\\")
                .replace(/"/g, '\\"')
                .replace(/\u0008/g, "\\b")
                .replace(/\u000C/g, "\\f")
                .replace(/\r/g, "\\r")
                .replace(/\n/g, "\\n")
                .replace(/\t/g, "\\t");
        }

        function isArray(v) {
            return v && typeof v === "object" && typeof v.length === "number" && typeof v.splice === "function";
        }

        function stringifyValue(v) {
            var t = typeof v;
            if (v === null) return "null";
            if (t === "number") return isFinite(v) ? String(v) : "null";
            if (t === "boolean") return v ? "true" : "false";
            if (t === "string") return '"' + esc(v) + '"';
            if (v instanceof Date) return '"' + esc(v.toUTCString()) + '"';
            if (t === "undefined" || t === "function") return "null";

            if (isArray(v)) {
                var a = [];
                for (var i = 0; i < v.length; i++) a.push(stringifyValue(v[i]));
                return "[" + a.join(",") + "]";
            }

            if (t === "object") {
                var parts = [];
                for (var k in v) {
                    if (!v.hasOwnProperty || v.hasOwnProperty(k)) {
                        var vv = v[k];
                        if (typeof vv === "undefined" || typeof vv === "function") continue;
                        parts.push('"' + esc(k) + '":' + stringifyValue(vv));
                    }
                }
                return "{" + parts.join(",") + "}";
            }

            return "null";
        }

        JSON.stringify = function (obj) {
            return stringifyValue(obj);
        };
    }

    if (typeof JSON.parse !== "function") {
        JSON.parse = function (str) {
            if (typeof str !== "string" || str === "") return null;
            return eval("(" + str + ")");
        };
    }
})();

// ============================================================================
// CONSTANTES
// ============================================================================

var CONSTANTS = {
    TICKS_PER_SECOND: 254016000000,
    AME_LAUNCH_TIMEOUT_MS: 20000,
    AME_QUEUE_MAX_ATTEMPTS: 30,
    AME_QUEUE_RETRY_DELAY_MS: 200,
    TRANSCRIPTION_TIMEOUT_MS: 20 * 60 * 1000,
    TRANSCRIPTION_CHECK_INTERVAL_MS: 6 * 1000,
    FOCUS_PREMIERE_DELAY_MS: 600,
    FOCUS_PREMIERE_RETRY_MS: 1800,
    EXPORT_WAIT_STEP_MS: 1000,
    MIN_EXPORT_WAIT_MS: 2000,
    EXPORT_STABLE_CHECKS: 3,
    EXPORT_MAX_WAIT_MS: 15 * 60 * 1000,
    EXPORT_POST_WAIT_MS: 20000,
    RMS_SILENCE_THRESHOLD: -60,
    AUTO_THRESHOLD_FALLBACK: -65,
    CUT_MARGIN_DEFAULT: 0.15,
    FRAME_GROUPING_THRESHOLD: 0.15
};

var PREMIERE_TITLES = [
    "Adobe Premiere Pro 2025",
    "Adobe Premiere Pro 2024",
    "Adobe Premiere Pro"
];

var BIN_NAMES = {
    SEQUENCES: "00_Sequences",
    VAULT: "01_Vault",
    RUSHS: "02_Rushs",
    SFX: "03_SFX",
    MUSIQUES: "04_Musiques",
    VFX: "05_VFX",
    OVERLAYS: "06_Overlays",
    TRASH: "07_Trash",
    SUBTITLES: "08_Subtitles",
    RUSH1: "Rush1",
    RUSH2: "Rush2",
    EXPORT: "Export",
    VERTICAL: "Vertical",
    HORIZONTAL: "Horizontal",
    CARRE: "Carre",
    PORTRAIT: "Portrait"
};

// ============================================================================
// VARIABLES GLOBALES
// ============================================================================

var project = app.project;
app.enableQE();
var MediaEncoder = app.encoder;

var __plugPlug = null;

// ============================================================================
// UTILITAIRES DE BASE
// ============================================================================

/**
 * S'assure que PlugPlugExternalObject est chargé pour CSXSEvent
 */
function ensurePlugPlug() {
    if (__plugPlug) {
        return true;
    }
    try {
        __plugPlug = new ExternalObject("lib:PlugPlugExternalObject");
    } catch (e) {
        __plugPlug = null;
        try {
            app.setSDKEventMessage("❌ PlugPlugExternalObject unavailable: " + e, "error");
        } catch (_) {}
        return false;
    }
    return (typeof CSXSEvent !== "undefined");
}

/**
 * Log un message dans la console Premiere
 */
function logMessage(message) {
    app.setSDKEventMessage(message, "info");
    return "true";
}

/**
 * Envoie une notification au CEP
 */
function notif(message, type) {
    try {
        var t = type || "warning";
        if (!ensurePlugPlug() || typeof CSXSEvent === "undefined") {
            return false;
        }
        var e = new CSXSEvent();
        e.type = "NOTIF";
        e.data = JSON.stringify({ message: String(message), type: String(t) });
        e.dispatch();
        return true;
    } catch (err) {
        $.writeln("notif error: " + err);
        return false;
    }
}

/**
 * Dispatch un événement CSXSEvent
 */
function dispatchEvent(eventType, data) {
    try {
        if (!ensurePlugPlug() || typeof CSXSEvent === "undefined") {
            return false;
        }
        var e = new CSXSEvent();
        e.type = eventType;
        e.data = JSON.stringify(data);
        e.dispatch();
        return true;
    } catch (err) {
        $.writeln("dispatchEvent error: " + err);
        return false;
    }
}

// ============================================================================
// GESTION DES CHEMINS ET FICHIERS
// ============================================================================

/**
 * Trouve le dossier de version le plus récent dans un répertoire
 */
function findLatestVersionFolder(rootFolder) {
    var items = rootFolder.getFiles(function (f) { return f instanceof Folder; });
    var best = null;
    var bestNum = -1;

    for (var i = 0; i < items.length; i++) {
        var name = items[i].name;
        var num = parseFloat(name);
        if (!isNaN(num) && num > bestNum) {
            bestNum = num;
            best = items[i];
        }
    }
    return best;
}

/**
 * Récupère le chemin du fichier preset AME
 */
function getAMEPresetFile(presetFilename) {
    var docs = Folder.myDocuments.fsName;
    var ameRoot = new Folder(docs + "/Adobe/Adobe Media Encoder");

    if (!ameRoot.exists) {
        throw new Error("Dossier AME introuvable: " + ameRoot.fsName);
    }

    var verFolder = findLatestVersionFolder(ameRoot);
    if (!verFolder) {
        throw new Error("Aucun dossier de version AME trouvé dans: " + ameRoot.fsName);
    }

    var presetFile = new File(verFolder.fsName + "/Presets/" + presetFilename);
    return presetFile;
}

/**
 * Obtient le chemin du dossier racine de l'extension
 */
function getExtensionRootFromThisFile() {
    var thisFile = new File($.fileName);
    var parent = thisFile.parent;

    // Remonte depuis src/jsx/ → src/ → racine extension
    if (parent && parent.name.toLowerCase() === "jsx") {
        var srcFolder = parent.parent;
        if (srcFolder && srcFolder.name.toLowerCase() === "src") {
            return srcFolder.parent.fsName;
        }
        return srcFolder.fsName;
    }
    return parent.fsName;
}

/**
 * Obtient le chemin du dossier parent du projet
 */
function getProjectFolderPath() {
    var fullPath = app.project.path;

    if (fullPath) {
        var withoutFile = fullPath.substring(0, fullPath.lastIndexOf("\\"));
        var parentFolder = withoutFile.substring(0, withoutFile.lastIndexOf("\\") + 1);
        return parentFolder;
    }

    return "";
}

/**
 * Obtient le chemin complet du fichier .prproj
 */
function getProjectFullPath() {
    return app.project.path || "";
}

/**
 * Obtient le dossier audio depuis un chemin de rush
 */
function getAudioFolderFromRushFolder(rushFilePath) {
    if (!rushFilePath || typeof rushFilePath !== "string") {
        logMessage("⚠️ Chemin rush invalide.");
        return null;
    }

    rushFilePath = rushFilePath.replace(/\\/g, "/");
    var rushFolder = rushFilePath.substring(0, rushFilePath.lastIndexOf("/"));
    var parentFolder = rushFolder.substring(0, rushFolder.lastIndexOf("/"));
    var audioFolder = parentFolder + "/07_Audio/";

    return audioFolder;
}

/**
 * Obtient le chemin du dossier contenant le clip
 */
function getFolderPath(clip) {
    var clipPath = clip.projectItem.getMediaPath();
    var folderPath = clipPath.substring(0, clipPath.lastIndexOf("\\") + 1);
    return folderPath;
}

// Chemins globaux
var EXT_ROOT = getExtensionRootFromThisFile();
var FFMPEGPATH = EXT_ROOT + "\\bin\\ffmpeg.exe";
var WAVFOLDERPRESET = getAMEPresetFile("ExportAudioWav.epr").fsName;

// ============================================================================
// GESTION DES FICHIERS
// ============================================================================

/**
 * Vérifie si un fichier existe
 */
function FileExists(path) {
    var file = new File(path);
    return file.exists.toString();
}

/**
 * Écrit dans un fichier
 */
function writeFile(path, content) {
    var file = new File(path);
    file.encoding = "UTF-8";

    if (file.open("w")) {
        file.write(content);
        file.close();
        return true;
    } else {
        notif("Impossible d'ouvrir le fichier pour écriture : " + path, "error");
        return false;
    }
}

/**
 * Lit un fichier
 */
function readFile(path) {
    var file = new File(path);
    file.encoding = "UTF-8";

    if (file.exists) {
        if (file.open("r")) {
            var content = file.read();
            file.close();
            return content;
        } else {
            notif("Impossible d'ouvrir le fichier pour lecture : " + path, "error");
            return null;
        }
    } else {
        notif("Fichier introuvable : " + path, "error");
        return null;
    }
}

// ============================================================================
// CONVERSION DE TEMPS
// ============================================================================

/**
 * Convertit les secondes en ticks
 */
function secondsToTicks(seconds) {
    var ticks = Math.round(seconds * CONSTANTS.TICKS_PER_SECOND);
    return ticks.toString();
}

/**
 * Convertit les ticks en secondes
 */
function ticksToSeconds(ticks, precision) {
    var sec = Number(ticks) / CONSTANTS.TICKS_PER_SECOND;
    return (precision != null) ? Number(sec.toFixed(precision)) : sec;
}

/**
 * Convertit les ticks en objet temps {hour, minute, second}
 */
function ticksToTime(ticksStr) {
    var ticks = ticksStr;
    var totalSeconds = Number(ticks / CONSTANTS.TICKS_PER_SECOND);

    var hours = Math.floor(totalSeconds / 3600);
    var remainingSeconds = totalSeconds % 3600;
    var minutes = Math.floor(remainingSeconds / 60);
    var seconds = Math.floor(remainingSeconds % 60);

    return {
        "hour": hours,
        "minute": minutes,
        "second": seconds
    };
}

/**
 * Convertit des secondes en timecode pour la séquence
 */
function secondsToTimecode(sec, seq, options) {
    options = options || {};
    if (!seq) seq = app.project.activeSequence;
    if (!seq) throw new Error("Aucune séquence active.");
    if (sec < 0) sec = 0;

    var tpf = Number(seq.timebase);
    var fpsExact = CONSTANTS.TICKS_PER_SECOND / tpf;
    var F = Math.round(fpsExact);

    var isDF = (options.dropFrame !== undefined) ? options.dropFrame
            : (Math.abs(fpsExact - 29.97) < 0.01 || Math.abs(fpsExact - 59.94) < 0.01);

    var totalFrames = Math.round(sec * fpsExact);
    var hh, mm, ss, ff;

    function zero2(n) { return (n < 10 ? "0" + n : "" + n); }

    if (!isDF) {
        var framesPerHour = F * 3600;
        var framesPerMinute = F * 60;

        hh = Math.floor(totalFrames / framesPerHour);
        var rem = totalFrames % framesPerHour;
        mm = Math.floor(rem / framesPerMinute);
        rem = rem % framesPerMinute;
        ss = Math.floor(rem / F);
        ff = rem % F;

        var sep = ":";
        return zero2(hh) + ":" + zero2(mm) + ":" + zero2(ss) + sep + zero2(ff);
    } else {
        var drop = Math.round(F * 0.0666667);
        var framesPer10Min = F * 600;
        var framesPerMinute = F * 60;

        var d = totalFrames % framesPer10Min;
        var m10 = Math.floor(totalFrames / framesPer10Min);
        var dropped = drop * (9 * m10 + Math.floor(Math.max(0, d - drop) / (framesPerMinute - drop)));
        var frameNumberDF = totalFrames + dropped;

        var framesPerHour = F * 3600;
        hh = Math.floor(frameNumberDF / framesPerHour);
        var rem2 = frameNumberDF % framesPerHour;
        mm = Math.floor(rem2 / framesPerMinute);
        rem2 = rem2 % framesPerMinute;
        ss = Math.floor(rem2 / F);
        ff = rem2 % F;

        var sepDF = (options.useSemicolon === true) ? ";" : ":";
        return zero2(hh) + ":" + zero2(mm) + ":" + zero2(ss) + sepDF + zero2(ff);
    }
}

// ============================================================================
// RECHERCHE DANS LE PROJET
// ============================================================================

/**
 * Recherche ou crée un bin
 */
function searchOrCreateBin(name, parentBin) {
    var bin = searchBinByName(name, parentBin);
    return bin ? bin : (parentBin || project.rootItem).createBin(name);
}

/**
 * Recherche un bin par son nom
 */
function searchBinByName(name, parentBin) {
    var bins = parentBin ? parentBin.children : project.rootItem.children;

    for (var i = 0; i < bins.numItems; i++) {
        var child = bins[i];
        if (child.name === name) {
            return child;
        }
    }
    return null;
}

/**
 * Recherche une séquence par son nom
 */
function searchSequenceByName(name) {
    var sequences = project.sequences;

    for (var i = 0; i < sequences.numSequences; i++) {
        var sequence = sequences[i];
        if (sequence.name === name) {
            return sequence;
        }
    }
    return null;
}

/**
 * Recherche un clip par son nom
 */
function searchClipByName(name, parentBin) {
    var bin = parentBin ? parentBin.children : project.rootItem.children;

    for (var i = 0; i < bin.numItems; i++) {
        var item = bin[i];
        if (item.type === ProjectItemType.CLIP && item.name && typeof item.name === "string") {
            if (removeExtension(name).toLowerCase() === removeExtension(item.name).toLowerCase()) {
                return item;
            }
        }
    }
    return null;
}

/**
 * Récupère le ProjectItem d'une séquence par son nom
 */
function getSequenceProjectItemByName(name, parentBin) {
    var bins = parentBin ? parentBin : project.rootItem;

    for (var i = 0; i < bins.children.numItems; i++) {
        var item = bins.children[i];
        if (item.name === name && item.type === 1) {
            return item;
        }
    }
    return null;
}

// ============================================================================
// UTILITAIRES DE TRAITEMENT
// ============================================================================

/**
 * Supprime l'extension d'un nom de fichier
 */
function removeExtension(name) {
    var lastDot = name.lastIndexOf(".");
    if (lastDot > 0) {
        return name.substring(0, lastDot);
    }
    return name;
}

/**
 * Extrait le nom de base et le numéro de partie d'un rush multi-parties
 * "interview" → { baseName: "interview", partNumber: 1 }
 * "interview-2" → { baseName: "interview", partNumber: 2 }
 */
function extractBaseName(clipName) {
    var match = clipName.match(/-(\d+)$/);
    if (match) {
        return {
            baseName: clipName.substring(0, clipName.length - match[0].length),
            partNumber: parseInt(match[1], 10)
        };
    }
    return { baseName: clipName, partNumber: 1 };
}

/**
 * Nettoie une chaîne pour comparaison
 */
function cleanString(str) {
    return str.toLowerCase().replace(/[_\-\s]/g, "");
}

/**
 * Convertit une couleur hexadécimale en tableau [alpha, r, g, b]
 */
function hexToColorArray(hex) {
    hex = String(hex).replace("#", "");
    var r = parseInt(hex.substring(0, 2), 16);
    var g = parseInt(hex.substring(2, 4), 16);
    var b = parseInt(hex.substring(4, 6), 16);
    return [1, r, g, b];
}

/**
 * Vérifie si un fichier a déjà été importé dans un chutier
 */
function isAlreadyImported(fileName, chutier) {
    for (var i = 0; i < chutier.children.numItems; i++) {
        if (chutier.children[i].name === fileName) {
            return true;
        }
    }
    return false;
}

// ============================================================================
// GESTION MEDIA ENCODER
// ============================================================================

// Configuration des bindings AME (une seule fois)
if (!$.global.__AME_BINDINGS__) {
    $.global.__AME_BINDINGS__ = true;
    $.global.__AME_READY__ = false;

    MediaEncoder.bind('onEncoderLaunched', function () {
        $.global.__AME_READY__ = true;
        try {
            $.writeln('[AME] Launched.');
        } catch (_) {}
    });

    MediaEncoder.bind('onEncoderJobComplete', function (jobID, outputFilePath) {
        dispatchEvent("ENCODER_WAV_DONE", { jobID: jobID, path: outputFilePath });
    });

    MediaEncoder.bind('onEncoderJobError', function (jobID, errorString) {
        dispatchEvent("ENCODER_WAV_ERROR", { jobID: jobID, error: errorString });
    });

    MediaEncoder.bind('onEncoderJobQueued', function (jobID) {
        dispatchEvent("ENCODER_WAV_QUEUED", { jobID: jobID });
    });
}

/**
 * Lance AME et attend qu'il soit prêt
 */
function launchAndWaitForAME() {
    $.global.__AME_READY__ = false;

    try {
        MediaEncoder.launchEncoder();
    } catch (e) {
        logMessage("AME launch error: " + e.message);
    }

    var waited = 0;
    while (!$.global.__AME_READY__ && waited < CONSTANTS.AME_LAUNCH_TIMEOUT_MS) {
        $.sleep(100);
        waited += 100;
    }

    if (!$.global.__AME_READY__) {
        throw new Error("Media Encoder n'a pas fini de se lancer (timeout " + CONSTANTS.AME_LAUNCH_TIMEOUT_MS + "ms).");
    }
}

/**
 * Ajoute un job d'encodage à la file AME avec retry
 */
function queueEncodingJob(seq, outPath, presetEprPath) {
    var jobID = null;
    var attempts = 0;

    while (jobID === null && attempts < CONSTANTS.AME_QUEUE_MAX_ATTEMPTS) {
        try {
            jobID = MediaEncoder.encodeSequence(seq, outPath, presetEprPath, 0);
        } catch (e) {
            $.sleep(CONSTANTS.AME_QUEUE_RETRY_DELAY_MS);
            attempts++;
            if (attempts === 1) {
                logMessage("encodeSequence retry...");
            }
        }
    }

    if (jobID === null) {
        throw new Error("Impossible d'ajouter le job à la file AME après " + CONSTANTS.AME_QUEUE_MAX_ATTEMPTS + " tentatives.");
    }

    return jobID;
}

/**
 * Attend qu'un fichier existe ET que son écriture soit terminée
 * (taille stable sur plusieurs vérifications consécutives)
 */
function waitForFileToExist(outPath) {
    var waited = 0;

    // 1) Attend que le fichier soit créé (borné par EXPORT_MAX_WAIT_MS)
    while (FileExists(outPath) !== "true") {
        if (waited >= CONSTANTS.EXPORT_MAX_WAIT_MS) {
            throw new Error("Timeout export : le fichier " + outPath + " n'a jamais été créé (" + CONSTANTS.EXPORT_MAX_WAIT_MS + "ms).");
        }
        $.sleep(CONSTANTS.EXPORT_WAIT_STEP_MS);
        waited += CONSTANTS.EXPORT_WAIT_STEP_MS;
    }

    // 2) Attend que la taille du fichier se stabilise (écriture terminée)
    var stableCount = 0;
    var lastSize = -1;
    while (stableCount < CONSTANTS.EXPORT_STABLE_CHECKS) {
        if (waited >= CONSTANTS.EXPORT_MAX_WAIT_MS) {
            throw new Error("Timeout export : l'écriture de " + outPath + " ne s'est jamais stabilisée (" + CONSTANTS.EXPORT_MAX_WAIT_MS + "ms).");
        }
        $.sleep(CONSTANTS.EXPORT_WAIT_STEP_MS);
        waited += CONSTANTS.EXPORT_WAIT_STEP_MS;
        var f = new File(outPath);
        var currentSize = f.exists ? f.length : 0;
        if (currentSize > 0 && currentSize === lastSize) {
            stableCount++;
        } else {
            stableCount = 0;
        }
        lastSize = currentSize;
    }
}

/**
 * Exporte une séquence en WAV silencieusement
 */
function exportSequenceWavSilently(seq, outDir, presetEprPath) {
    if (!seq) {
        throw new Error("No sequence provided.");
    }

    var outPath = outDir;

    // Supprime l'ancien fichier
    var f = new File(outPath);
    if (f.exists) {
        try {
            f.remove();
            $.sleep(200);
        } catch (e) {
            logMessage("Impossible de supprimer " + outPath + " : " + e);
        }
    }

    notif("Exportation audio de " + seq.name, "warning");

    // Lance AME et attend
    launchAndWaitForAME();

    // Queue le job
    var jobID = queueEncodingJob(seq, outPath, presetEprPath);

    // Démarre la file
    try {
        MediaEncoder.startBatch();
    } catch (e) {
        throw new Error("startBatch a échoué : " + e);
    }

    // Ramène Premiere au premier plan
    focusPremiereFront(CONSTANTS.FOCUS_PREMIERE_DELAY_MS);
    focusPremiereFront(CONSTANTS.FOCUS_PREMIERE_RETRY_MS);

    // Attend que le fichier existe
    waitForFileToExist(outPath);

    return { jobID: jobID, outPath: outPath };
}

// ============================================================================
// FOCUS PREMIERE (WINDOWS)
// ============================================================================

/**
 * Ramène Premiere Pro au premier plan (Windows uniquement)
 */
function focusPremiereFront(delayMs) {
    if ($.os.indexOf("Windows") === -1) {
        return;
    }

    var vbs =
        'Set sh = CreateObject("WScript.Shell")\r\n' +
        'WScript.Sleep ' + Math.max(0, delayMs | 0) + '\r\n' +
        'On Error Resume Next\r\n' +
        'Dim ret\r\n' +
        'ret = 0\r\n';

    for (var i = 0; i < PREMIERE_TITLES.length; i++) {
        var title = PREMIERE_TITLES[i].replace(/"/g, '""');
        if (i === 0) {
            vbs += 'ret = ret Or sh.AppActivate("' + title + '")\r\n';
        } else {
            vbs += 'If ret = 0 Then ret = sh.AppActivate("' + title + '")\r\n';
        }
    }
    vbs += 'On Error Goto 0\r\n';

    var tmpPath = Folder.temp.fsName + "\\focus_premiere.vbs";
    var file = new File(tmpPath);

    if (file.open("w")) {
        file.write(vbs);
        file.close();
        file.execute();
    }
}

// ============================================================================
// MANIPULATION DE CLIPS
// ============================================================================

/**
 * Récupère les informations média (largeur, hauteur) d'un clip
 */
function getMediaInfo(projectItem) {
    if (!projectItem) {
        logMessage("Aucun clip fourni.");
        return null;
    }

    var metadataString = projectItem.getProjectColumnsMetadata();
    var metadata = JSON.parse(metadataString);

    if (metadata && metadata.length > 0) {
        for (var i = 0; i < metadata.length; i++) {
            var column = metadata[i];
            if (column.ColumnName === "Infos vidéo") {
                var match = column.ColumnValue.match(/^(\d+)\s+x\s+(\d+)/);
                if (match) {
                    return {
                        width: parseInt(match[1]),
                        height: parseInt(match[2])
                    };
                }
            }
        }
    }

    logMessage("Aucune métadonnée trouvée.");
    return null;
}

/**
 * Échelle un clip pour remplir la séquence
 */
function scaleClipToFill(clip, sequence, clipWidth, clipHeight) {
    if (!clip || !sequence || !clipWidth || !clipHeight) {
        logMessage("Paramètres invalides pour scaleClipToFill.");
        return;
    }

    var sequenceWidth = sequence.frameSizeHorizontal;
    var sequenceHeight = sequence.frameSizeVertical;

    // Calcul de l'échelle pour remplir
    var scaleToFill = Math.max(
        (sequenceWidth / clipWidth) * 100,
        (sequenceHeight / clipHeight) * 100
    );

    // Ajustement progressif si nécessaire
    var scaledWidth = clipWidth * (scaleToFill / 100);
    var scaledHeight = clipHeight * (scaleToFill / 100);

    while (scaledWidth < sequenceWidth && scaledHeight < sequenceHeight) {
        scaleToFill += 1;
        scaledWidth = clipWidth * (scaleToFill / 100);
        scaledHeight = clipHeight * (scaleToFill / 100);
    }

    // Recherche du composant Motion/Trajectoire
    var motionEffect = null;
    for (var i = 0; i < clip.components.numItems; i++) {
        var component = clip.components[i];
        var displayName = (component.displayName || "").toLowerCase();
        if (displayName === "motion" || displayName === "trajectoire") {
            motionEffect = component;
            break;
        }
    }

    if (!motionEffect) {
        logMessage("Effet Motion/Trajectoire non trouvé.");
        return;
    }

    // Recherche de la propriété Scale
    var scaleProp = null;
    for (var j = 0; j < motionEffect.properties.numItems; j++) {
        var prop = motionEffect.properties[j];
        if (prop.displayName === "Scale" || prop.displayName === "Echelle") {
            scaleProp = prop;
            break;
        }
    }

    if (!scaleProp) {
        logMessage("Propriété Scale/Échelle non trouvée.");
        return;
    }

    var scale = Number(scaleToFill.toFixed(0));

    try {
        scaleProp.setValue(scale, true);
    } catch (e) {
        logMessage("❌ Erreur lors de setValue : " + e.message);
    }
}

/**
 * Insère une séquence imbriquée
 */
function insertNestedSequence(nestedSequence, targetSequence) {
    if (!nestedSequence) {
        logMessage("Séquence imbriquée introuvable !");
        return;
    }

    var track = targetSequence.videoTracks[0];
    if (track) {
        track.insertClip(nestedSequence, 0);
    } else {
        notif("Erreur : impossible d'insérer la séquence sur la piste [V1] !", "error");
    }
}

// ============================================================================
// NAVIGATION
// ============================================================================

/**
 * Va à un temps spécifique dans une séquence
 */
function goToTime(time, sequenceName) {
    var sequence = searchSequenceByName(sequenceName);
    if (sequence) {
        project.activeSequence = sequence;
        sequence.setPlayerPosition(secondsToTicks(time));
    }
}

// ============================================================================
// WORKFLOW - CRÉATION DES BINS
// ============================================================================

/**
 * Crée la structure de dossiers du workflow (FONCTION PUBLIQUE)
 */
function CreateWorkflow() {
    var binConfig = [
        { name: BIN_NAMES.SEQUENCES, children: [BIN_NAMES.RUSH1, BIN_NAMES.RUSH2] },
        { name: BIN_NAMES.VAULT },
        { name: BIN_NAMES.RUSHS },
        { name: BIN_NAMES.SFX },
        { name: BIN_NAMES.MUSIQUES },
        { name: BIN_NAMES.VFX },
        { name: BIN_NAMES.OVERLAYS },
        { name: BIN_NAMES.TRASH },
        { name: BIN_NAMES.SUBTITLES }
    ];

    for (var i = 0; i < binConfig.length; i++) {
        var config = binConfig[i];
        var bin = searchOrCreateBin(config.name);

        if (config.children) {
            for (var j = 0; j < config.children.length; j++) {
                searchOrCreateBin(config.children[j], bin);
            }
        }
    }
}

// ============================================================================
// STEP 1 - CRÉATION DES SÉQUENCES
// ============================================================================

/**
 * Crée les séquences à partir des rushs
 */
function createSequenceFromRush(targetClip, clipName, binRush2, format) {
    var sequence = searchSequenceByName(clipName);
    if (sequence) {
        return sequence;
    }

    sequence = project.createNewSequenceFromClips(clipName, targetClip, binRush2);
    var currentSetting = sequence.getSettings();

    currentSetting.videoFrameHeight = format.height;
    currentSetting.videoFrameWidth = format.width;
    currentSetting.frameRate = 60.0;

    sequence.setSettings(currentSetting);

    // Supprime les clips placeholder
    if (sequence.videoTracks[0].clips.numItems > 0) {
        sequence.videoTracks[0].clips[0].remove(0, 0);
    }
    if (sequence.audioTracks[0].clips.numItems > 0) {
        sequence.audioTracks[0].clips[0].remove(0, 0);
    }

    return sequence;
}

/**
 * Crée une séquence Rush avec scaling
 */
function createRushSequence(targetClip, clipName, binRush1, currentSetting) {
    var rushSequenceName = "Rush_" + clipName;

    if (searchSequenceByName(rushSequenceName)) {
        return null;
    }

    var rushSequence = project.createNewSequenceFromClips(rushSequenceName, targetClip, binRush1);
    rushSequence.setSettings(currentSetting);

    var trackClip = rushSequence.videoTracks[0].clips[0];
    if (!trackClip) {
        notif("Pas de clip sur la piste " + rushSequenceName + " !", "error");
        return null;
    }

    // Scale le clip
    var projectItem = trackClip.projectItem;
    try {
        var mediaInfo = getMediaInfo(projectItem);
        if (mediaInfo) {
            scaleClipToFill(trackClip, rushSequence, mediaInfo.width, mediaInfo.height);
        }
    } catch (e) {
        notif("Erreur lors de la récupération des métadonnées du clip pour scale (Active 'Infos vidéo')", "error");
    }

    return { sequence: rushSequence, clip: trackClip };
}

/**
 * Ajoute un clip à la fin d'une séquence Rush_ existante (multi-parties)
 */
function addClipToRushSequence(targetClip, rushSequence) {
    var videoTrack = rushSequence.videoTracks[0];
    if (!videoTrack || videoTrack.clips.numItems === 0) {
        return;
    }

    // Position = fin du dernier clip vidéo
    var lastClip = videoTrack.clips[videoTrack.clips.numItems - 1];
    var insertTime = lastClip.end.seconds;

    // Insère le clip sur V1
    videoTrack.insertClip(targetClip, insertTime);

    // Scale le nouveau clip
    var newClip = videoTrack.clips[videoTrack.clips.numItems - 1];
    if (newClip) {
        try {
            var mediaInfo = getMediaInfo(targetClip);
            if (mediaInfo) {
                scaleClipToFill(newClip, rushSequence, mediaInfo.width, mediaInfo.height);
            }
        } catch (e) {
            logMessage("Erreur scaling clip multi-partie : " + e.message);
        }
    }
}

/**
 * Exporte l'audio si l'option est activée
 */
function exportAudioIfNeeded(optionAudio, rushSequence, clipName, trackClip) {
    if (!optionAudio) {
        return;
    }

    var rushFolder = getFolderPath(trackClip);
    var audioFolder = getAudioFolderFromRushFolder(rushFolder);

    if (FileExists(WAVFOLDERPRESET) === "true") {
        var audioSubfolder = new Folder(audioFolder + "Audio");
        if (!audioSubfolder.exists) {
            audioSubfolder.create();
        }
        exportSequenceWavSilently(rushSequence, audioFolder + "Audio/" + clipName + ".wav", WAVFOLDERPRESET);
    } else {
        notif("Ajoutez un preset d'export audio WAV sous le nom 'ExportAudioWav'", "error");
    }
}

/**
 * Importe et configure les fichiers audio avec suffixe
 */
function importAudioUpgrades(suffixAudioUpgrade, binRush1) {
    if (!suffixAudioUpgrade) {
        return;
    }

    if (binRush1.children.numItems === 0) {
        return;
    }

    var trackClip = searchSequenceByName(binRush1.children[0].name).videoTracks[0].clips[0];
    var rushFolder = getFolderPath(trackClip);
    var audioFolderBin = getAudioFolderFromRushFolder(rushFolder);
    var audioFolder = new Folder(audioFolderBin + "Audio");

    if (!audioFolder || !(audioFolder instanceof Folder)) {
        return;
    }

    if (!audioFolder.exists) {
        if (audioFolder.create()) {
            notif("Dossier audio créé avec succès, Ajoutez le nécessaire maintenant puis relancez (.wav)", "success");
        } else {
            notif("Impossible de créer le dossier audio.", "error");
        }
        return;
    }

    var files = audioFolder.getFiles(function (file) {
        return decodeURIComponent(file.name).indexOf(suffixAudioUpgrade) !== -1;
    }) || [];

    for (var i = 0; i < files.length; i++) {
        var file = files[i];
        if (!(file instanceof File)) continue;

        if (!isAlreadyImported(file.name, binRush1)) {
            project.importFiles([file.fsName], 1, binRush1, 0);
        }

        var audioClip = searchClipByName(removeExtension(decodeURIComponent(file.name)), binRush1);
        var sequenceName = "Rush_" + removeExtension(decodeURIComponent(file.name)).replace(suffixAudioUpgrade, "");
        var sequence = searchSequenceByName(sequenceName);

        if (sequence) {
            var audioTrack = sequence.audioTracks[1];
            if (audioTrack && audioTrack.clips.numItems === 0) {
                audioTrack.insertClip(audioClip, 0);
            }

            var track0 = sequence.audioTracks[0];
            if (track0) {
                track0.setMute(1);
            }
        } else {
            notif(sequenceName + " introuvable", "error");
        }
    }
}

/**
 * Crée le dossier audio 07_Audio et ses sous-dossiers (Audio, Titles, Subtitles, Brolls, Context) dans le projet
 */
function ensureProjectAudioFolder() {
    var projetPath = getProjectFolderPath();
    if (projetPath && projetPath !== "") {
        var audioFolder = new Folder(projetPath + "07_Audio");
        if (!audioFolder.exists) {
            audioFolder.create();
        }
        if (!audioFolder.exists) {
            return;
        }
        // SYNC: ces noms doivent correspondre aux constantes PATHS.*_SUBFOLDER dans constants.js
        var subs = ["Audio", "Titles", "Subtitles", "Brolls", "Context"];
        for (var i = 0; i < subs.length; i++) {
            var sub = new Folder(projetPath + "07_Audio\\" + subs[i]);
            if (!sub.exists) {
                sub.create();
            }
        }
    }
}

/**
 * STEP1 - Exécution complète (FONCTION PUBLIQUE)
 */
function STEP1_EXECUTE(OptionAudio, suffixAudioUpgrade, selectedformat) {
    try {
        var sequenceBin = searchOrCreateBin(BIN_NAMES.SEQUENCES);
        var binRush1 = searchOrCreateBin(BIN_NAMES.RUSH1, sequenceBin);
        var binRush2 = searchOrCreateBin(BIN_NAMES.RUSH2, sequenceBin);
        var rushBin = searchBinByName(BIN_NAMES.RUSHS);

        if (!rushBin) {
            project.rootItem.createBin(BIN_NAMES.RUSHS);
            notif("Aucun rush dans [02_Rushs]", "error");
            return "Error";
        }

        if (rushBin.children.numItems === 0) {
            notif("Aucun rush dans [02_Rushs]", "error");
            return "Error";
        }

        var format = { width: 1080, height: 1920 };
        if (selectedformat === "selectedFormatDesktop") {
            format = { width: 1920, height: 1080 };
        }

        // Phase A : Grouper les rushes par nom de base (multi-parties)
        var groups = {};
        for (var i = 0; i < rushBin.children.numItems; i++) {
            var clipName = removeExtension(rushBin.children[i].name);
            clipName = clipName.replace(suffixAudioUpgrade, "");
            var info = extractBaseName(clipName);

            if (!groups[info.baseName]) {
                groups[info.baseName] = [];
            }
            groups[info.baseName].push({ clipName: clipName, partNumber: info.partNumber });
        }

        // Phase B : Traiter chaque groupe
        for (var baseName in groups) {
            // Skip si séquence existe déjà
            if (searchSequenceByName(baseName)) {
                continue;
            }

            // Trier les parties par numéro
            groups[baseName].sort(function(a, b) { return a.partNumber - b.partNumber; });
            var parts = groups[baseName];

            // Trouver le clip de base (part 1)
            var baseClip = searchClipByName(parts[0].clipName, rushBin);
            if (!baseClip) {
                notif("Clip " + parts[0].clipName + " introuvable.", "error");
                continue;
            }

            // 1. Crée la séquence principale
            var mainSeq = createSequenceFromRush(baseClip, baseName, binRush2, format);

            // 2. Crée la séquence Rush avec le clip de base
            var rushResult = createRushSequence(baseClip, baseName, binRush1, mainSeq.getSettings());
            if (!rushResult) {
                continue;
            }

            // 3. Ajouter les parties suivantes au Rush_
            for (var j = 1; j < parts.length; j++) {
                var partClip = searchClipByName(parts[j].clipName, rushBin);
                if (partClip) {
                    addClipToRushSequence(partClip, rushResult.sequence);
                }
            }

            // 4. Imbriquer le Rush_ COMPLET dans la séquence principale
            var rushItemSequence = getSequenceProjectItemByName("Rush_" + baseName, binRush1);
            insertNestedSequence(rushItemSequence, mainSeq);

            // 5. Export audio si nécessaire (clip de base)
            exportAudioIfNeeded(OptionAudio, rushResult.sequence, baseName, rushResult.clip);
        }

        notif("Execution réussie", "success");

        // Import des audios avec suffixe
        importAudioUpgrades(suffixAudioUpgrade, binRush1);

        // Crée le dossier audio
        ensureProjectAudioFolder();

    } catch (e) {
        logMessage("Erreur : " + e.message);
        return "Erreur : " + e.message;
    }

    return "Succès";
}

// ============================================================================
// DÉCOUPAGE DE SÉQUENCES
// ============================================================================

/**
 * Découpe une séquence selon les zones spécifiées
 */
function CutSecond(CutZones, sequence) {
    if (!sequence) {
        notif("Aucune séquence active", "error");
        return;
    }

    if (sequence.videoTracks[0].clips.numItems > 1) {
        notif("La séquence ne doit pas déjà être découpée", "error");
        return;
    }

    project.activeSequence = sequence;
    var qeSeq = qe.project.getActiveSequence();

    // Tri par ordre décroissant pour découper de la fin vers le début
    CutZones.sort(function (a, b) { return b[0] - a[0]; });

    for (var i = 0; i < CutZones.length; i++) {
        var startSec = CutZones[i][0];
        var endSec = CutZones[i][1];

        qeSeq = qe.project.getActiveSequence();

        var tcIn = secondsToTimecode(startSec);
        var tcOut = secondsToTimecode(endSec);

        $.sleep(15);
        qeSeq.setInPoint(tcIn);
        $.sleep(15);
        qeSeq.setOutPoint(tcOut);
        $.sleep(15);

        if (qeSeq.extract && tcIn !== tcOut) {
            qeSeq.extract();
        }
    }

    if (sequence.clearInPoint) sequence.clearInPoint();
    if (sequence.clearOutPoint) sequence.clearOutPoint();

    notif("Découpes effectuées", "success");
}

// ============================================================================
// SOUS-TITRES
// ============================================================================

/**
 * Importe les styles de texte .prtextstyle
 */
function importTextStyles(optionPresetStyle, trashChutier) {
    if (optionPresetStyle === "???") {
        return;
    }

    var folder = (optionPresetStyle instanceof Folder) ? optionPresetStyle : new Folder(optionPresetStyle);
    if (!folder.exists) {
        notif("Dossier introuvable : " + folder.fsName, "error");
        return;
    }

    var files = folder.getFiles(function (f) {
        return (f instanceof File) && /\.prtextstyle$/i.test(f.name);
    });

    for (var i = 0; i < files.length; i++) {
        var styleFile = files[i];
        var styleName = styleFile.name.replace(".prtextstyle", "");

        if (!isAlreadyImported(styleName, trashChutier)) {
            $.sleep(500);
            importFileWithRetry(styleFile.fsName, trashChutier, 3, 1000);
        }
    }
}

/**
 * Importe un fichier avec retry
 */
function importFileWithRetry(path, importBin, attempts, delayMs) {
    var lastErr = null;
    for (var i = 0; i < attempts; i++) {
        try {
            app.project.importFiles([path], 1, importBin, 0);
            return true;
        } catch (e) {
            lastErr = e;
            $.sleep(delayMs);
        }
    }
    if (lastErr) {
        logMessage("importFiles failed after retries: " + lastErr);
    }
    return false;
}

/**
 * Génère un fichier SRT à partir d'un JSON
 */
function generateSRT(jsonData, audioPath, sequenceName) {
    var EPS = 0;

    function snapToMs(t) {
        return Math.round(Number(t) * 1000);
    }

    function fmt(secFloat) {
        var msTotal = Math.max(0, Math.round(Number(secFloat) * 1000));
        var ms = msTotal % 1000;
        var s = Math.floor(msTotal / 1000) % 60;
        var m = Math.floor(msTotal / 60000) % 60;
        var h = Math.floor(msTotal / 3600000);

        function pad(n, z) {
            n = String(n);
            return (n.length < z ? ("0000" + n).slice(-z) : n);
        }
        return pad(h, 2) + ":" + pad(m, 2) + ":" + pad(s, 2) + "," + pad(ms, 3);
    }

    jsonData.sort(function (a, b) { return Number(a.start) - Number(b.start); });

    var srt = "";
    for (var i = 0; i < jsonData.length; i++) {
        var it = jsonData[i];
        var startMs = snapToMs(it.start);
        var endMs;

        if (i < jsonData.length - 1) {
            var nextStartMs = snapToMs(jsonData[i + 1].start);
            endMs = nextStartMs - EPS;
            if (endMs <= startMs) endMs = startMs + 1;
        } else {
            endMs = snapToMs(it.end) ? snapToMs(it.end) : startMs + 2000;
        }

        srt += (it.index || (i + 1)) + "\r\n" +
            fmt(startMs / 1000) + " --> " + fmt(endMs / 1000) + "\r\n" +
            it.text.toLowerCase() + "\r\n\r\n";
    }

    var srtPath = audioPath + sequenceName + ".srt";
    var f = new File(srtPath);
    f.encoding = "UTF-8";
    f.open("w");
    f.write(srt);
    f.close();

    return srtPath;
}

/**
 * Crée une piste de sous-titres (FONCTION PUBLIQUE)
 */
function CreateSTR(sequence, OptionPresetStyle) {
    var sequenceBin = searchBinByName(BIN_NAMES.SEQUENCES);
    if (!sequenceBin) {
        throw new Error("Bin " + BIN_NAMES.SEQUENCES + " introuvable dans le projet");
    }

    var binRush1 = searchBinByName(BIN_NAMES.RUSH1, sequenceBin);
    if (!binRush1 || binRush1.children.numItems === 0) {
        throw new Error("Bin Rush1 introuvable ou vide dans " + BIN_NAMES.SEQUENCES);
    }

    var subtitleChutier = searchOrCreateBin(BIN_NAMES.SUBTITLES);
    var trashChutier = searchOrCreateBin(BIN_NAMES.TRASH);

    var rushSeq = searchSequenceByName(binRush1.children[0].name);
    if (!rushSeq || !rushSeq.videoTracks[0] || rushSeq.videoTracks[0].clips.numItems === 0) {
        throw new Error("Séquence Rush introuvable ou vide : " + binRush1.children[0].name);
    }
    var trackClip = rushSeq.videoTracks[0].clips[0];
    if (trackClip.projectItem.isSequence() === true) {
        var nestedSeq = searchSequenceByName(trackClip.projectItem.name);
        if (!nestedSeq || !nestedSeq.videoTracks[0] || nestedSeq.videoTracks[0].clips.numItems === 0) {
            throw new Error("Séquence imbriquée introuvable ou vide : " + trackClip.projectItem.name);
        }
        trackClip = nestedSeq.videoTracks[0].clips[0];
    }

    var rushFolder = getFolderPath(trackClip);
    var audioFolderBin = getAudioFolderFromRushFolder(rushFolder);
    if (!audioFolderBin) {
        throw new Error("Impossible de déterminer le dossier audio depuis le rush");
    }
    var audioFolder = new Folder(audioFolderBin);
    var audioPath = audioFolder.fsName + "\\";

    var jsonFile = new File(audioPath + "Subtitles\\" + sequence.name + "SRT.json");
    jsonFile.encoding = "UTF-8";

    if (!jsonFile.exists) {
        throw new Error("Fichier JSON introuvable : " + audioPath + "Subtitles\\" + sequence.name + "SRT.json");
    }

    jsonFile.open("r");
    var data = jsonFile.read();
    jsonFile.close();

    var jsonData = JSON.parse(data);

    // Import des styles de texte
    importTextStyles(OptionPresetStyle, trashChutier);

    // Génère le SRT
    var srtPath = generateSRT(jsonData, audioPath, sequence.name);

    // Importe le SRT
    if (isAlreadyImported(sequence.name + ".srt", subtitleChutier)) {
        return;
    }

    app.project.importFiles([srtPath], 1, subtitleChutier, 0);
    var itemSRT = getSequenceProjectItemByName(sequence.name + ".srt", subtitleChutier);
    var sequenceitem = searchSequenceByName(sequence.name);

    if (!sequenceitem) {
        throw new Error("Séquence " + sequence.name + " introuvable après import");
    }

    project.activeSequence = sequenceitem;
    sequenceitem.createCaptionTrack(itemSRT, 0);

    notif("Piste de sous-titres créée pour la séquence : " + sequence.name, "success");
}

// ============================================================================
// TITRES ANIMÉS
// ============================================================================

/**
 * DEBUG: Liste toutes les propriétés du composant graphique d'un MOGRT sur la timeline
 * Appeler depuis la console: debugMogrtProperties("2")
 * Supprimable après diagnostic
 */
function debugMogrtProperties(TemplateSelection) {
    var sequence = app.project.activeSequence;
    if (!sequence) { return JSON.stringify({error: "Aucune séquence active"}); }

    // Chercher le dernier clip sur la piste vidéo 7 (index 6)
    var track = sequence.videoTracks[6];
    if (!track || track.clips.numItems === 0) {
        // Importer un MOGRT temporaire pour analyser
        var titleTemplatePath = EXT_ROOT + "\\assets\\templates\\titles\\TITRE-" + TemplateSelection + "-H.mogrt";
        var templateFile = new File(titleTemplatePath);
        if (!templateFile.exists) {
            return JSON.stringify({error: "MOGRT introuvable: " + titleTemplatePath});
        }
        var item = sequence.importMGT(titleTemplatePath, 0, 6, 1);
        if (!item) {
            return JSON.stringify({error: "Echec import MOGRT"});
        }
    }

    // Lire le dernier clip importé
    track = sequence.videoTracks[6];
    var clip = track.clips[track.clips.numItems - 1];
    var result = [];

    for (var i = 0; i < clip.components.numItems; i++) {
        var comp = clip.components[i];
        if (comp.displayName.toLowerCase().indexOf("graphi") !== -1) {
            for (var j = 0; j < comp.properties.numItems; j++) {
                var prop = comp.properties[j];
                var info = {
                    index: j,
                    displayName: prop.displayName,
                    displayNameLower: prop.displayName.toLowerCase()
                };
                // Essayer de lire la valeur
                try {
                    if (prop.displayName.toLowerCase() === "color") {
                        info.colorValue = prop.getColorValue().toString();
                    } else {
                        info.value = String(prop.getValue());
                    }
                } catch(e) {
                    info.value = "[erreur lecture: " + e.message + "]";
                }
                result.push(info);
            }
        }
    }

    return JSON.stringify(result);
}

/**
 * Configure les propriétés d'un MOGRT (titre animé)
 */
function setMogrtSourceText(item, time, text, index, TemplateSelection, nbr, color) {
    TemplateSelection = String(TemplateSelection);

    for (var i = 0; i < item.components.numItems; i++) {
        if (item.components[i].displayName.toLowerCase().indexOf("graphi") !== -1) {
            comp2 = item.components[i];
            var countText = 0;
            var countApparition = 0;
            var countopa = 0;
            var countPosition = 0;
            var countColor = 0;

            for (var j = 0; j < comp2.properties.numItems; j++) {
                var prop = comp2.properties[j];
                var propNameLower = prop.displayName.toLowerCase();

                // ── TEMPLATE 1 ──
                if (TemplateSelection === "1") {

                    // Couleur : propriété "Color", placeholder #FF0000
                    if (propNameLower === "color") {
                        var colorargb = hexToColorArray(color);
                        if (prop.getColorValue().toString() == hexToColorArray("#FF0000").toString()) {
                            prop.setColorValue(colorargb[0], colorargb[1], colorargb[2], colorargb[3], 1);
                        }
                    }

                    // Texte : propriété "Text"
                    if (propNameLower === "text") {
                        // 2 lignes : skip slot 1 pour que ligne 2 aille sur slot 2
                        if (nbr < 3) {
                            if (countText === 1) {
                                if (countText === index) {
                                    index += 1;
                                }
                            }
                        }
                        if (countText === index) {
                            prop.setValue(text, 1);
                        }
                        countText += 1;
                    }

                    // Déclencheur apparition
                    if (propNameLower === "déclencheur apparition") {
                        if (countApparition === index) {
                            prop.setValue(time, 1);
                        }
                        countApparition += 1;
                    }

                    // Masquer ligne 2 et ajuster position quand 2 lignes
                    if (nbr < 3) {
                        if (propNameLower === "visibility" || propNameLower === "opacity") {
                            if (countopa === 1) {
                                prop.setValue(0, 1);
                            }
                            countopa += 1;
                        }
                        if (propNameLower === "position") {
                            if (countPosition === 2) {
                                prop.setValue([0.5, 0.47], 1);
                            }
                            countPosition += 1;
                        }
                    }
                }

                // ── TEMPLATE 2 ──
                // Structure MOGRT : 6 groupes (Premier texte, TEXTE 1, Second texte, TEXTE 2, Troisième texte, TEXTE 3)
                // Groupes actifs : count 1 = TEXTE 1 (ligne 1), count 2 = Second texte (ligne 2), count 3 = TEXTE 2 (ligne 3)
                // Offset +1 sur l'index pour sauter le premier groupe "Premier texte"
                if (TemplateSelection === "2") {
                    var adjustedIndex = index + 1;

                    // Couleur : propriété "Couleur", placeholder #FFA200
                    if (propNameLower === "couleur") {
                        var colorargb2 = hexToColorArray(color);
                        if (prop.getColorValue().toString() == hexToColorArray("#FFA200").toString()) {
                            prop.setColorValue(colorargb2[0], colorargb2[1], colorargb2[2], colorargb2[3], 1);
                        }
                        countColor += 1;
                    }

                    // Texte : propriété "Mots"
                    if (propNameLower === "mots") {
                        if (countText === adjustedIndex) {
                            prop.setValue(text, 1);
                        }
                        countText += 1;
                    }

                    // Apparition
                    if (propNameLower === "apparition") {
                        if (countApparition === adjustedIndex) {
                            prop.setValue(time, 1);
                        }
                        countApparition += 1;
                    }

                    // Opacité : masquer le groupe "TEXTE 2" (countOpa 3) quand 2 lignes
                    if (propNameLower === "opacité") {
                        if (nbr < 3 && countopa === 3) {
                            prop.setValue(0, 1);
                        }
                        countopa += 1;
                    }
                }
            }
        }
    }
}

/**
 * Crée les titres animés dans une séquence (FONCTION PUBLIQUE)
 */
function CreateTitles(sequence, TemplateSelection, titleColor) {
    var projetPath = getProjectFolderPath();
    if (!projetPath) {
        throw new Error("Chemin du projet introuvable");
    }
    ensureProjectAudioFolder();

    var seqName = sequence.name;
    sequence = searchSequenceByName(seqName);
    if (!sequence) {
        throw new Error("Séquence " + seqName + " introuvable");
    }
    project.activeSequence = sequence;
    var qeSeq = qe.project.getActiveSequence();
    if (!qeSeq) {
        throw new Error("QE séquence introuvable pour " + seqName);
    }

    notif("Ajout des titres dans la timeline pour " + sequence.name, "warning");

    var titlesPath = projetPath + "07_Audio\\Titles\\" + sequence.name + "_titles.json";
    var titlesFile = new File(titlesPath);
    if (!titlesFile.exists) {
        throw new Error("Fichier titres introuvable : " + titlesPath);
    }

    var value = readFile(titlesPath);
    if (!value || value === "") {
        throw new Error("Fichier titres vide : " + titlesPath);
    }
    value = JSON.parse(value);

    // Ajoute des pistes vidéo si nécessaire
    while (sequence.videoTracks.numTracks <= 6) {
        qeSeq.addTracks(1, 2, 0);
    }

    if (sequence.videoTracks[6].clips.numItems > 0) {
        notif("La piste vidéo 8 doit être vide pour ajouter les titres.", "error");
        return;
    }

    if (!value || value === "") {
        return;
    }

    // Vérifier que le fichier MOGRT existe avant de commencer
    var titleTemplatePath = EXT_ROOT + "\\assets\\templates\\titles\\TITRE-" + TemplateSelection + "-H.mogrt";
    var templateFile = new File(titleTemplatePath);
    if (!templateFile.exists) {
        notif("Fichier MOGRT introuvable: TITRE-" + TemplateSelection + "-H.mogrt", "error");
        return;
    }

    // Utilise la couleur sélectionnée ou la couleur par défaut
    var color = titleColor || "#ff4949ff";
    var totalTitles = value.length;

    for (var i = 0; i < value.length; i++) {
        var nbr = value[i].length;
        if (nbr == 1) {
            continue;
        }

        try {
            var startTime = value[i][0]["start"] - 0.2;
            var item = sequence.importMGT(titleTemplatePath, secondsToTicks(startTime), 6, 1);

            if (!item) {
                notif("Echec import MOGRT pour titre " + (i + 1) + "/" + totalTitles, "error");
                continue;
            }

            var lastStart = value[i][value[i].length - 1]["start"];
            var duration = (lastStart - value[i][0]["start"] + 1.2);
            var durTicks = secondsToTicks(duration.toString());

            var newEnd = new Time();
            newEnd.ticks = String(Number(item.start.ticks) + Number(durTicks));
            item.end = newEnd;

            for (var j = 0; j < value[i].length; j++) {
                var time = (value[i][j]["start"]) - (value[i][0]["start"]);
                setMogrtSourceText(item, time * 100 - 20, value[i][j]["mots"], j, TemplateSelection, nbr, color);
            }
        } catch (err) {
            notif("Erreur import titre " + (i + 1) + "/" + totalTitles + " : " + err.message, "error");
        }

        // Progression intra-boucle MOGRT
        if ((i + 1) % 3 === 0 || i === value.length - 1) {
            dispatchEvent("STEP2_PROGRESS", {
                phase: "titles",
                sequence: sequence.name,
                current: i + 1,
                total: totalTitles
            });
        }
    }

    notif("Titres ajoutés pour " + sequence.name, "success");
}

// ============================================================================
// AJOUT DE TITRE PONCTUEL (AJOUTER ICI)
// ============================================================================

/**
 * Retourne la position du curseur (CTI) sur la séquence active
 */
function GetCTIPosition() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) {
            return JSON.stringify({error: "Aucune séquence active"});
        }
        var position = seq.getPlayerPosition();
        var seconds = ticksToSeconds(position.ticks, 3);
        return JSON.stringify({
            position: seconds,
            sequenceName: seq.name
        });
    } catch (e) {
        return JSON.stringify({error: e.toString()});
    }
}

/**
 * Lit le fichier SRT.json et retourne les sous-titres dans une fenêtre temporelle
 */
function GetSubtitlesAtTime(sequenceName, timeSeconds, windowSeconds) {
    try {
        var projetPath = getProjectFolderPath();
        var srtPath = projetPath + "07_Audio\\Subtitles\\" + sequenceName + "SRT.json";
        var srtFile = new File(srtPath);
        if (!srtFile.exists) {
            return JSON.stringify({error: "Fichier SRT introuvable pour " + sequenceName});
        }
        var content = readFile(srtPath);
        if (content === null) {
            return JSON.stringify({error: "Impossible de lire le fichier SRT : " + srtPath});
        }
        var subtitles = JSON.parse(content);
        var minTime = timeSeconds - windowSeconds;
        var maxTime = timeSeconds + windowSeconds;
        var result = [];
        for (var i = 0; i < subtitles.length; i++) {
            var sub = subtitles[i];
            if (sub.end >= minTime && sub.start <= maxTime) {
                result.push({start: sub.start, end: sub.end, text: sub.text, words: sub.words || []});
            }
        }
        return JSON.stringify({subtitles: result});
    } catch (e) {
        return JSON.stringify({error: e.toString()});
    }
}

/**
 * Importe un MOGRT unique à la position donnée avec gestion de collision inter-pistes
 * titleDataStr : JSON string [{"mots":"group1","start":1.5},{"mots":"group2","start":2.1}]
 */
function AddSingleTitle(sequenceName, titleDataStr, templateSelection, titleColor) {
    try {
        var seq = searchSequenceByName(sequenceName);
        if (!seq) {
            return JSON.stringify({error: "Séquence introuvable: " + sequenceName});
        }

        app.project.activeSequence = seq;
        var qeSeq = qe.project.getActiveSequence();

        var titleData = JSON.parse(titleDataStr);
        var nbr = titleData.length;
        if (nbr < 2) {
            return JSON.stringify({error: "Le titre doit avoir au moins 2 lignes"});
        }

        // Vérifier le template MOGRT
        var titleTemplatePath = EXT_ROOT + "\\assets\\templates\\titles\\TITRE-" + templateSelection + "-H.mogrt";
        var templateFile = new File(titleTemplatePath);
        if (!templateFile.exists) {
            return JSON.stringify({error: "Fichier MOGRT introuvable: TITRE-" + templateSelection + "-H.mogrt"});
        }

        var color = titleColor || "#ff4949ff";
        var startTime = titleData[0]["start"] - 0.2;
        var startTicks = secondsToTicks(startTime);

        // Calculer la durée réelle du titre (comme CreateTitles)
        var lastStart = titleData[titleData.length - 1]["start"];
        var titleDuration = (lastStart - titleData[0]["start"] + 1.2);
        var durTicks = secondsToTicks(titleDuration.toString());

        // S'assurer que les pistes cibles V7 et V8 (indices 6 et 7) existent
        var baseTrack = 6;
        while (seq.videoTracks.numTracks < baseTrack + 2) {
            qeSeq.addTracks(1, seq.videoTracks.numTracks - 1, 0);
        }

        // ===== ÉTAPE 1: Import sur piste staging (forcément vide) =====
        // Créer une nouvelle piste tout en haut (garantie vide, aucun conflit)
        var stagingTrackIndex = seq.videoTracks.numTracks;
        qeSeq.addTracks(1, seq.videoTracks.numTracks - 1, 0);

        var stagingItem = seq.importMGT(titleTemplatePath, startTicks, stagingTrackIndex, 1);
        if (!stagingItem) {
            return JSON.stringify({error: "Échec de l'import du MOGRT"});
        }

        // Ajuster la durée sur la piste staging (safe, aucun conflit)
        var stagingEnd = new Time();
        stagingEnd.ticks = String(Number(stagingItem.start.ticks) + Number(durTicks));
        stagingItem.end = stagingEnd;

        // Configurer le MOGRT sur la piste staging
        for (var j = 0; j < titleData.length; j++) {
            var time = (titleData[j]["start"]) - (titleData[0]["start"]);
            setMogrtSourceText(stagingItem, time * 100 - 20, titleData[j]["mots"], j, templateSelection, nbr, color);
        }

        // ===== ÉTAPE 2: Déplacer vers piste cible V7 ou V8 si libre =====
        var targetTrack = -1;
        for (var t = baseTrack; t <= baseTrack + 1; t++) {
            var track = seq.videoTracks[t];
            var hasCollision = false;
            for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                var clipStartSec = ticksToSeconds(clip.start.ticks, 3);
                var clipEndSec = ticksToSeconds(clip.end.ticks, 3);
                if (clipEndSec > startTime && clipStartSec < startTime + titleDuration) {
                    hasCollision = true;
                    break;
                }
            }
            if (!hasCollision) {
                targetTrack = t;
                break;
            }
        }

        if (targetTrack !== -1) {
            // Ré-importer sur la piste cible (vérifiée libre)
            var targetItem = seq.importMGT(titleTemplatePath, startTicks, targetTrack, 1);
            if (targetItem) {
                // Ajuster la durée sur la piste cible
                var targetEnd = new Time();
                targetEnd.ticks = String(Number(targetItem.start.ticks) + Number(durTicks));
                targetItem.end = targetEnd;

                // Configurer le MOGRT sur la piste cible
                for (var k = 0; k < titleData.length; k++) {
                    var time2 = (titleData[k]["start"]) - (titleData[0]["start"]);
                    setMogrtSourceText(targetItem, time2 * 100 - 20, titleData[k]["mots"], k, templateSelection, nbr, color);
                }

                // Supprimer le clip de la piste staging
                stagingItem.remove(false, false);

                return JSON.stringify({success: true, track: targetTrack + 1});
            }
        }

        // Si aucune piste cible libre, le titre reste sur la piste staging
        return JSON.stringify({success: true, track: stagingTrackIndex + 1});
    } catch (e) {
        return JSON.stringify({error: e.toString()});
    }
}

// ============================================================================
// ANALYSE AUDIO POUR DÉCOUPE AUTOMATIQUE
// ============================================================================

/**
 * Arrondit à la frame la plus proche
 */
function roundToFrame(time) {
    return Math.round(time * 30) / 30;
}

/**
 * Exécute FFmpeg pour analyser l'audio
 */
function runFFmpegAnalysis(audioPath, sequenceName) {
    var command = '""' + FFMPEGPATH + '"' + ' -hide_banner -loglevel info -i "' + audioPath + sequenceName + '.wav" ' +
        '-af "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level" ' +
        '-f null NUL > "' + audioPath + sequenceName + '.txt" 2>&1"';

    var batFilePath = audioPath + "execute_ffmpeg.vbs";
    var batFile = new File(batFilePath);

    if (batFile.open("w")) {
        batFile.write(
            'Set sh = CreateObject("WScript.Shell")\r\n' +
            'sh.Run "cmd.exe /c ' + command.replace(/"/g, '""') + '", 0, True\r\n'
        );
        batFile.close();

        if (batFile.exists) {
            batFile.execute();
            $.sleep(800);
            batFile.remove();
            return true;
        }
    }
    return false;
}

/**
 * Calcule le seuil auto silence/parole : moyenne entre -90 dB et la médiane RMS.
 * Exclut les -inf (stockés en -99).
 */
function calculateRmsMedian(AllValueWav) {
    var numericValues = [];
    for (var i = 0; i < AllValueWav.length; i++) {
        var val = AllValueWav[i].debit;
        if (val !== -99 && !isNaN(val)) {
            numericValues.push(val);
        }
    }
    if (numericValues.length === 0) {
        return CONSTANTS.AUTO_THRESHOLD_FALLBACK;
    }
    numericValues.sort(function(a, b) { return a - b; });

    var mid = Math.floor(numericValues.length / 2);
    var median = (numericValues.length % 2 === 0)
        ? (numericValues[mid - 1] + numericValues[mid]) / 2
        : numericValues[mid];

    return (-90 + median) / 2 + 1.5;
}

/**
 * Parse le fichier de résultat FFmpeg (parsing uniquement, sans filtrage)
 */
function parseFFmpegResults(audioPath, sequenceName, time) {
    var file = new File(audioPath + sequenceName + '.txt');
    if (!file.exists) {
        return null;
    }

    $.sleep((time / 84 + 3) * 1000);
    file.open("r");

    var AllValueWav = [];
    var currentTime = null;

    while (!file.eof) {
        var line = file.readln();

        var matchPts = line.match(/pts_time:([0-9.]+)/);
        if (matchPts && matchPts[1]) {
            currentTime = parseFloat(matchPts[1]);
            currentTime = roundToFrame(currentTime);
        }

        var matchRms = line.match(/RMS_level=([-0-9.inf]+)/);
        if (matchRms && matchRms[1]) {
            var rmsStr = matchRms[1];
            var rms = rmsStr === "-inf" ? -99 : parseFloat(rmsStr);

            AllValueWav.push({ 'time': currentTime, "debit": rms });
        }
    }

    file.close();
    return { AllValueWav: AllValueWav };
}

/**
 * Filtre les zones de silence à partir des valeurs RMS et d'un seuil
 */
function filterSilenceZones(AllValueWav, threshold) {
    var lowRmsTimes = [];
    for (var i = 0; i < AllValueWav.length; i++) {
        if (AllValueWav[i].debit < threshold && AllValueWav[i].time !== null) {
            lowRmsTimes.push(AllValueWav[i].time);
        }
    }
    return lowRmsTimes;
}

/**
 * Groupe les timestamps proches en blocs
 */
function groupCutZones(lowRmsTimes, margin) {
    var grouped = [];
    var groupStart = null;
    var lastTime = null;

    for (var i = 0; i < lowRmsTimes.length; i++) {
        var t = lowRmsTimes[i];
        if (groupStart === null) {
            groupStart = t;
        } else if (t - lastTime > CONSTANTS.FRAME_GROUPING_THRESHOLD) {
            grouped.push([groupStart, lastTime]);
            groupStart = t;
        }
        lastTime = t;
    }

    if (groupStart !== null && lastTime !== null) {
        grouped.push([groupStart, lastTime]);
    }

    // Applique la marge
    var CutZones = [];
    for (var j = 0; j < grouped.length; j++) {
        var start = grouped[j][0];
        var end = grouped[j][1];

        var startWithMargin = start + margin;
        var endWithMargin = end - margin;

        if (startWithMargin < endWithMargin) {
            CutZones.push([startWithMargin, endWithMargin]);
        }
    }

    return CutZones;
}

/**
 * Analyse une séquence pour déterminer les zones de coupe (FONCTION PUBLIQUE)
 */
function AnalyseCut(sequence, suffixAudioUpgrade, margin, rmsThreshold) {
    var sequenceBin = searchBinByName(BIN_NAMES.SEQUENCES);
    var binRush1 = searchBinByName(BIN_NAMES.RUSH1, sequenceBin);

    if (!binRush1 || !binRush1.children) {
        notif("Bin '" + BIN_NAMES.RUSH1 + "' introuvable pour localiser le dossier audio", "error");
        return { "Message": "Bin '" + BIN_NAMES.RUSH1 + "' introuvable", "fileName": sequence.name };
    }

    // Trouve la 1ere VRAIE sequence du bin Rush1 avec un clip video.
    // Le bin peut contenir des fichiers audio (.wav issus du mixage) qu'il
    // faut ignorer : children[0] n'est PAS forcement une sequence.
    var trackClip = null;
    for (var ci = 0; ci < binRush1.children.numItems; ci++) {
        var child = binRush1.children[ci];
        if (!child.isSequence || !child.isSequence()) continue;
        var childSeq = searchSequenceByName(child.name);
        if (childSeq && childSeq.videoTracks.numTracks > 0 && childSeq.videoTracks[0].clips.numItems > 0) {
            trackClip = childSeq.videoTracks[0].clips[0];
            break;
        }
    }

    if (!trackClip) {
        notif("Aucune sequence avec clip video dans le bin '" + BIN_NAMES.RUSH1 + "'", "error");
        return { "Message": "Aucune sequence valide dans '" + BIN_NAMES.RUSH1 + "'", "fileName": sequence.name };
    }

    var rushFolder = getFolderPath(trackClip);
    var audioFolderBin = getAudioFolderFromRushFolder(rushFolder);
    var audioFolder = new Folder(audioFolderBin);
    var audioPath = audioFolder.fsName + "\\";

    notif("Analyse de " + sequence.name, "warning");

    var time = ticksToSeconds(sequence.end);

    if (!audioFolder || !(audioFolder instanceof Folder)) {
        notif("Le dossier audio est invalide ou n'existe pas", "error");
        return;
    }

    var sequenceItem = searchSequenceByName(sequence.name);
    exportSequenceWavSilently(sequenceItem, audioPath + sequence.name + ".wav", WAVFOLDERPRESET);
    // Sécurité : waitForFileToExist() détecte la fin via "taille stable 3s",
    // mais AME peut marquer une pause >3s en cours de rendu (faux positif).
    // Ce délai garantit qu'AME a vraiment fini d'écrire avant que ffmpeg lise.
    $.sleep(CONSTANTS.EXPORT_POST_WAIT_MS);

    var files = audioFolder.getFiles(function (file) {
        return file.name.replace(/%20/g, " ").indexOf(suffixAudioUpgrade) === -1;
    }) || [];

    for (var i = 0; i < files.length; i++) {
        var file = files[i];
        if (!(file instanceof File)) continue;
        if (!(removeExtension(file.name.replace(/%20/g, " ")) === sequence.name)) continue;

        notif("Analyse de " + file.name.replace(".wav", ""), "warning");

        if (!runFFmpegAnalysis(audioPath, sequence.name)) {
            return {
                "Message": "Impossible de créer le fichier batch.",
                "fileName": sequence.name
            };
        }

        var parseResult = parseFFmpegResults(audioPath, sequence.name, time);
        if (!parseResult) {
            return {
                "Message": "Fichier " + audioPath + sequence.name + ".txt introuvable",
                "fileName": sequence.name
            };
        }

        // Auto-détection du seuil si null ou non-numérique
        var effectiveThreshold = rmsThreshold;
        var autoThreshold = null;
        if (rmsThreshold === null || rmsThreshold === undefined || isNaN(rmsThreshold)) {
            autoThreshold = calculateRmsMedian(parseResult.AllValueWav);
            autoThreshold = Math.round(autoThreshold * 10) / 10;
            effectiveThreshold = autoThreshold;
        }

        var lowRmsTimes = filterSilenceZones(parseResult.AllValueWav, effectiveThreshold);
        var CutZones = groupCutZones(lowRmsTimes, margin);

        return {
            "Message": "Analyse réussie",
            "Value": CutZones,
            "AllValueWav": parseResult.AllValueWav,
            "fileName": sequence.name,
            "duration": ticksToTime(sequence.end),
            "autoThreshold": autoThreshold
        };
    }
}

// ============================================================================
// STEP 2 - TRAITEMENT AVANCÉ
// ============================================================================

/**
 * Retourne toutes les séquences du projet avec nom et durée (FONCTION PUBLIQUE)
 * @returns {string} JSON array [{name, duration}] — durée en secondes
 */
function GetAllProjectSequences() {
    var sequences = new Array();
    var sequenceBin = searchBinByName(BIN_NAMES.SEQUENCES);
    if (!sequenceBin) {
        return JSON.stringify(sequences);
    }

    var binRush2 = searchBinByName(BIN_NAMES.RUSH2, sequenceBin);
    if (!binRush2 || !binRush2.children) {
        return JSON.stringify(sequences);
    }

    var seqMap = {};
    var allSeqs = project.sequences;
    for (var i = 0; i < allSeqs.numSequences; i++) {
        seqMap[allSeqs[i].name] = allSeqs[i];
    }

    for (var i = 0; i < binRush2.children.numItems; i++) {
        var item = binRush2.children[i];
        if (item.isSequence()) {
            var seq = seqMap[item.name];
            if (seq) {
                var durationSec = Number(seq.end) / CONSTANTS.TICKS_PER_SECOND;
                sequences.push({
                    name: seq.name,
                    duration: durationSec
                });
            }
        }
    }

    return JSON.stringify(sequences);
}

/**
 * Récupère les séquences sélectionnées (FONCTION PUBLIQUE)
 */
function getSelectedSequence(SequenceChoose, option) {
    var sequences = new Array();
    var sequenceBin = searchBinByName(BIN_NAMES.SEQUENCES);

    if (SequenceChoose !== "selectedSequence") {
        var binRush2 = searchOrCreateBin(BIN_NAMES.RUSH2, sequenceBin);

        for (var i = 0; i < binRush2.children.numItems; i++) {
            if (binRush2.children[i].isSequence()) {
                if (option == true) {
                    sequences.push(searchSequenceByName(binRush2.children[i].name));
                } else {
                    sequences.push(searchSequenceByName(binRush2.children[i].name).name);
                }
            }
        }
    } else {
        if (option == true) {
            sequences.push(project.activeSequence);
        } else {
            sequences.push(project.activeSequence.name);
        }
    }

    return JSON.stringify(sequences);
}

/**
 * STEP2 - Exécution complète (FONCTION PUBLIQUE)
 * @deprecated Utiliser les appels individuels depuis le JS (createSubtitlesForSequence, createTitlesForSequence, etc.)
 */
function STEP2_EXECUTE(Args) {
    var ArgsParse = JSON.parse(Args);
    var value = "";
    var path = getProjectFolderPath() + "07_Audio\\CutZoneList.json";

    if (FileExists(path) === "true" && ArgsParse["AnalyseCut"] === false && ArgsParse["OptionCut"] === true) {
        var s = readFile(path);
        value = JSON.parse(s);
    }

    // Analyse des cuts
    if (ArgsParse["AnalyseCut"] === true) {
        var sequences = JSON.parse(getSelectedSequence(ArgsParse["sequenceSelection"], false));
        var outputs = [];

        for (var i = 0; i < sequences.length; i++) {
            var sequence = searchSequenceByName(sequences[i]);
            var output = AnalyseCut(sequence, ArgsParse["OptionAudioSuffix"], ArgsParse["MargeCuts"], ArgsParse["LimiteCuts"]);
            outputs.push(output);
        }
        return JSON.stringify(outputs);
    }

    // Découpage
    if (ArgsParse["OptionCut"] == true) {
        var sequences = value;
        for (var i = 0; i < sequences.length; i++) {
            var sequence = searchSequenceByName(sequences[i].fileName);

            if (!sequence) {
                alert("Séquence " + sequences[i].fileName + " introuvable, découpes annulées.");
                return;
            }
            notif("Découpage de " + sequence.name + " en cours...", "warning");
            var Cutzone = sequences[i].Value;

            if (value !== "" && value.length > 0) {
                CutSecond(Cutzone, sequence);
            }
        }
    }

    // Sous-titres
    if (ArgsParse['OptionSubtitles'] === true) {
        var sequences = JSON.parse(getSelectedSequence(ArgsParse["sequenceSelection"], false));

        for (var i = 0; i < sequences.length; i++) {
            var sequence = searchSequenceByName(sequences[i]);
            if (sequence) {
                CreateSTR(sequence, ArgsParse["OptionPresetStyle"]);
            }
        }
    }

    // Titres
    if (ArgsParse['Optiontitles'] === true) {
        var sequences = JSON.parse(getSelectedSequence(ArgsParse["sequenceSelection"], false));

        for (var i = 0; i < sequences.length; i++) {
            var sequence = searchSequenceByName(sequences[i]);
            if (sequence) {
                CreateTitles(sequence, ArgsParse["TemplateSelection"], ArgsParse["TitleColor"]);
            }
        }
    }
}

// ============================================================================
// ZOOM (DÉSACTIVÉ)
// ============================================================================

/**
 * Crée un zoom (FONCTION PUBLIQUE - désactivée)
 */
function CreateZoom(sequence) {
    notif("Zoom non disponible dans cette version du plugin.", "error");
    return;
}

// ============================================================================
// TRANSCRIPTION PYTHON
// ============================================================================

/**
 * Attend que le log de transcription soit complet et charge le JSON
 */
function waitForLogAndLoadJSON(audioPath, goal, file, outputDir) {
    var audioDir = audioPath.substring(0, audioPath.lastIndexOf("\\"));
    var logFile = new File(audioDir + "\\stdout.log");
    var jsonDir = outputDir || audioDir;

    var jsonFile;
    if (outputDir) {
        // Si outputDir fourni, chercher le JSON dedans avec le basename du fichier
        if (goal === "BROLL") {
            jsonFile = new File(jsonDir + "\\" + file + ".json");
        } else {
            jsonFile = new File(jsonDir + "\\" + file + "SRT.json");
        }
    } else {
        if (goal === "BROLL") {
            jsonFile = new File(audioPath.replace(/\.\w+$/, ".json"));
        } else {
            jsonFile = new File(audioPath.replace(/\.\w+$/, "SRT.json"));
        }
    }

    var maxWait = CONSTANTS.TRANSCRIPTION_TIMEOUT_MS;
    var checkInterval = CONSTANTS.TRANSCRIPTION_CHECK_INTERVAL_MS;
    var waited = 0;
    var wasDownloading = false;

    while (waited < maxWait) {
        if (logFile.exists) {
            logFile.open("r");
            var logContent = logFile.read();
            logFile.close();

            if (logContent.indexOf("JSON create :") !== -1) {
                if (wasDownloading) {
                    dispatchEvent("MODEL_DOWNLOAD_PROGRESS", { percent: 100, finished: true });
                }
                if (jsonFile.exists) {
                    jsonFile.open("r");
                    var jsonContent = jsonFile.read();
                    jsonFile.close();

                    var data = JSON.parse(jsonContent);
                    return data;
                } else {
                    notif("⚠️ Fichier JSON introuvable.", "error");
                    return null;
                }
            }

            // Detect Python crash (Traceback in log = script has failed)
            if (logContent.indexOf("Traceback (most recent call last)") !== -1) {
                // Extract last line for error message
                var errLines = logContent.split("\n");
                var lastErrLine = "";
                for (var ei = errLines.length - 1; ei >= 0; ei--) {
                    var trimmed = errLines[ei].replace(/^\s+|\s+$/g, "");
                    if (trimmed.length > 0) {
                        lastErrLine = trimmed;
                        break;
                    }
                }
                notif("Transcription échouée : " + lastErrLine, "error");
                return null;
            }

            // Detect model download progress (e.g. "  1%|2   | 15.3M/2.88G")
            if (logContent.indexOf("re-downloading the file") !== -1 || logContent.indexOf("iB/s]") !== -1) {
                wasDownloading = true;
                var lastPercent = 0;
                // Find last percentage in the log (format: "  XX%|")
                var lines = logContent.split("\n");
                for (var i = lines.length - 1; i >= 0; i--) {
                    var line = lines[i];
                    // Match patterns like "  0%|", " 45%|", "100%|"
                    var pIdx = line.indexOf("%|");
                    if (pIdx !== -1) {
                        // Extract number before "%|"
                        var numStr = "";
                        for (var j = pIdx - 1; j >= 0; j--) {
                            var ch = line.charAt(j);
                            if (ch >= "0" && ch <= "9") {
                                numStr = ch + numStr;
                            } else {
                                break;
                            }
                        }
                        if (numStr.length > 0) {
                            lastPercent = parseInt(numStr, 10);
                            break;
                        }
                    }
                }
                dispatchEvent("MODEL_DOWNLOAD_PROGRESS", { percent: lastPercent, finished: false });
            }
        }

        $.sleep(checkInterval);
        if (!wasDownloading) {
            notif("Analyse de " + file + " en cours...", "warning");
        }
        waited += checkInterval;
    }

    notif("Timeout après 20 minutes, la transcription prend plus de temps ou a échoué.", "error");
    return null;
}

/**
 * Lance la transcription Python (FONCTION PUBLIQUE)
 */
function runPythonTranscription(extensionPath, audioPath, goal, file, charLimit, modelName, outputDir) {
    audioPath = audioPath + file + ".wav";
    var pythonScript = extensionPath + "\\scripts\\transcription\\transcribe.py";
    var batFilePath = extensionPath + "\\scripts\\transcription\\run_transcription.bat";
    var audioDir = audioPath.substring(0, audioPath.lastIndexOf("\\"));
    var logPath = audioDir + "\\stdout.log";

    var logFile = new File(logPath);
    if (logFile.exists) {
        logFile.remove();
    }

    // Creer le outputDir si fourni
    if (outputDir) {
        var outFolder = new Folder(outputDir);
        if (!outFolder.exists) {
            outFolder.create();
        }
    }

    // Retirer le backslash final pour éviter que \" casse le guillemet dans le .bat
    if (outputDir && outputDir.charAt(outputDir.length - 1) === "\\") {
        outputDir = outputDir.substring(0, outputDir.length - 1);
    }

    var ffmpegDir = EXT_ROOT + "\\bin";
    var charLimitArg = charLimit ? ' "' + charLimit + '"' : ' ""';
    var modelArg = modelName ? ' "' + modelName + '"' : ' ""';
    var outputDirArg = outputDir ? ' "' + outputDir + '"' : '';

    var command =
        '@echo off\n' +
        'setlocal\n' +
        'set "PATH=' + ffmpegDir + ';%PATH%"\n' +
        'python "' + pythonScript + '" "' + audioPath + '" "' + goal + '"' + charLimitArg + modelArg + outputDirArg + ' > "' + logPath + '" 2>&1\n' +
        'endlocal\n';

    var batFile = new File(batFilePath);

    if (batFile.open("w")) {
        batFile.write(command);
        batFile.close();

        if (batFile.exists) {
            var vbsFilePath = batFilePath.replace(/\.bat$/i, ".vbs");
            var vbsFile = new File(vbsFilePath);

            if (vbsFile.open("w")) {
                var vbs =
                    'Set sh = CreateObject("WScript.Shell")\r\n' +
                    'sh.Run "cmd.exe /c ""' + batFile.fsName.replace(/"/g, '""') + '""", 0, True\r\n';
                vbsFile.write(vbs);
                vbsFile.close();

                vbsFile.execute();
                notif("Lancement de la transcription, cela peut prendre plusieurs minutes...", "warning");
            }

            $.sleep(1000);

            var transcriptionData = waitForLogAndLoadJSON(audioPath, goal, file, outputDir);
            if (transcriptionData) {
                notif("Transcription terminée", "success");
                return JSON.stringify(transcriptionData);
            } else {
                notif("Transcription échouée, relancez à nouveau", "error");
                return "TRANSCRIPTION_FAILED";
            }
        } else {
            return "BATCH_NOT_FOUND";
        }
    } else {
        return "CANNOT_WRITE_BATCH";
    }
}

// ============================================================================
// B-ROLLS
// ============================================================================

/**
 * Crée les B-rolls (FONCTION PUBLIQUE)
 */
function createBrolls(file, audioPath) {
    var audioDir = audioPath.substring(0, audioPath.lastIndexOf("\\"));
    var filePathjson = audioDir + "\\" + file + ".json";
    var fileJson = new File(filePathjson);

    if (fileJson.exists) {
        fileJson.open("r");
        var jsonContent = fileJson.read();
        fileJson.close();
        return jsonContent;
    } else {
        return null;
    }
}

/**
 * Crée des markers (FONCTION PUBLIQUE)
 * @param {string} file - Nom de la séquence
 * @param {string} jsonFilePath - Chemin vers le fichier JSON
 */
function createMarkers(file, jsonFilePath) {
    var f = new File(jsonFilePath);
    f.encoding = "UTF-8";
    if (!f.exists) {
        notif("Fichier JSON introuvable pour markers : " + jsonFilePath, "error");
        return;
    }
    f.open("r");
    var content = f.read();
    f.close();
    var jsonData = JSON.parse(content);
    var sequence = searchSequenceByName(file);

    if (!sequence) {
        notif("Séquence introuvable : " + file, "error");
        return;
    }

    project.activeSequence = sequence;
    var counter = 0;

    for (var i = 0; i < jsonData.length; i++) {
        var timeStart = jsonData[i].start;
        var timeEnd = jsonData[i].end;
        var subtitle = jsonData[i].text;
        var reponse = jsonData[i].response;

        if (reponse !== false) {
            counter += 1;
            var marker = sequence.markers.createMarker(timeStart);
            marker.setTypeAsComment();
            marker.name = counter.toString();
            marker.comments = reponse + "\n" + subtitle;
            marker.end = timeEnd;
            marker.setColorByIndex(5, i);
        }
    }
}

/**
 * Exporte plusieurs fichiers WAV (FONCTION PUBLIQUE)
 */
function exportMultipleWav(listFiles, audioPath) {
    listFiles = JSON.parse(listFiles);

    for (var i = 0; i < listFiles.length; i++) {
        var file = listFiles[i];
        var seq = searchSequenceByName(file);

        if (seq) {
            try {
                exportSequenceWavSilently(seq, audioPath + file + ".wav", WAVFOLDERPRESET);
            } catch (error) {
                notif("Erreur : " + error, "error");
            }
        } else {
            notif("Aucune séquence trouvée", "error");
        }
    }
    return "true";
}

/**
 * Ajoute les B-rolls sur la timeline (FONCTION PUBLIQUE)
 */
function addBrollOnTimeline(content, name) {
    notif("Ajout des Brolls en cours...", "warning");

    var Vault = searchOrCreateBin(BIN_NAMES.VAULT);
    var sequence = searchSequenceByName(name);
    var contentParsed = JSON.parse(content);
    var contentJustBroll = [];

    var count = 1;
    for (var i = 0; i < contentParsed.length; i++) {
        var response = contentParsed[i].response;
        if (response !== false) {
            contentJustBroll.push({
                "start": contentParsed[i].start,
                "end": contentParsed[i].end,
                "response": response,
                "index": count
            });
            count++;
        }
    }

    if (sequence.videoTracks[1].clips.numItems === 0) {
        var count2 = 0;

        for (var i = 0; i < contentJustBroll.length; i++) {
            var clipName = name + "_" + contentJustBroll[i].index;
            if (searchClipByName(clipName, Vault) === null) {
                continue;
            }

            var clip = searchClipByName(clipName, Vault);
            if (!clip) continue;

            var startSec = contentJustBroll[i].start;
            var endSec = contentJustBroll[i].end;
            var durSec = endSec - startSec;

            var savedIn = 0, savedOut = 0;
            try {
                savedIn = clip.getInPoint();
                savedOut = clip.getOutPoint();
            } catch (e) {
                notif("Erreur lors du découpage [Auto-cuts]" + e.message, "error");
            }

            clip.setInPoint(0, 4);
            clip.setOutPoint(secondsToTicks(durSec), 4);

            sequence.videoTracks[1].insertClip(clip, secondsToTicks(startSec));

            var clipselect = sequence.videoTracks[1].clips[count2];
            if (clipselect) {
                var projectItemClip = clipselect.projectItem;
                try {
                    var MediaInfo = getMediaInfo(projectItemClip);
                    if (MediaInfo) {
                        scaleClipToFill(clipselect, sequence, MediaInfo['width'], MediaInfo['height']);
                    }
                } catch (e) {
                    notif("Erreur lors de la récupération des métadonnées du clip pour scale (Active 'Infos vidéo')", "error");
                }
            }

            count2 += 1;

            try {
                clip.setInPoint(savedIn, 4);
                clip.setOutPoint(savedOut, 4);
            } catch (e) {
                notif("Erreur lors de la restauration des points In/Out : " + e.message, "error");
            }
        }
        return 1;
    } else {
        return 0;
    }
}

// ============================================================================
// STEP 4 - GÉNÉRATION DES FORMATS D'EXPORT
// ============================================================================

/**
 * Génère un label pour Hook/CTA
 */
function labelFor(itemName, adsName, isCTA) {
    var lbl = itemName.replace(/\s+/g, "");
    try {
        lbl = lbl.replace(new RegExp(adsName, "gi"), "");
    } catch (_) {}
    if (!lbl || /^\W*$/.test(lbl)) lbl = isCTA ? "CTA" : "HOOK";
    return lbl;
}

/**
 * Vérifie si un item est spécifique à une Ad
 */
function isSpecificToAd(item, adItem) {
    var a = cleanString(adItem.name);
    var b = cleanString(item.name);
    return (b.indexOf(a) !== -1 || a.indexOf(b) !== -1);
}

/**
 * Filtre les items globaux (non spécifiques à une Ad)
 */
function filterGlobalItems(allItems, allAds) {
    var globalItems = [];
    try {
        for (var j = 0; j < allItems.length; j++) {
            var item = allItems[j];
            var isSpec = false;
            for (var k = 0; k < allAds.length; k++) {
                if (isSpecificToAd(item, allAds[k])) {
                    isSpec = true;
                    break;
                }
            }
            if (!isSpec) globalItems.push(item);
        }
    } catch (e) {
        notif("Erreur lors du filtrage des items globaux : " + e.message, "error");
    }
    return globalItems;
}

/**
 * Crée une séquence formatée (verticale, horizontale, carrée)
 */
function createFormattedSequence(seqName, ads, hook, cta, binRush2, binTarget, width, height) {
    if (!binTarget || searchSequenceByName(seqName)) return;

    var rushBin = searchBinByName(BIN_NAMES.RUSHS);
    if (!rushBin) {
        notif("Aucun fichier dans [02_Rushs]", "error");
        project.rootItem.createBin(BIN_NAMES.RUSHS);
        return;
    }

    var clip = searchClipByName(ads.name, rushBin);
    if (clip === null) {
        clip = rushBin.children[0];
    }

    var sequence = project.createNewSequenceFromClips(seqName, clip, binTarget);

    var settings = sequence.getSettings();
    settings.videoFrameWidth = width;
    settings.videoFrameHeight = height;
    settings.frameRate = 60.0;
    sequence.setSettings(settings);

    // Nettoie les clips placeholder
    try {
        if (sequence.videoTracks[0].clips.numItems > 0) sequence.videoTracks[0].clips[0].remove(0, 0);
        if (sequence.audioTracks[0].clips.numItems > 0) sequence.audioTracks[0].clips[0].remove(0, 0);
    } catch (_) {}

    // Ordre : CTA (dernier) -> Ad -> Hook (premier)
    if (cta) {
        var ctaItem = getSequenceProjectItemByName(cta.name, binRush2);
        if (ctaItem) {
            insertNestedSequence(ctaItem, sequence, true);
        }
    }

    var adsItem = getSequenceProjectItemByName(ads.name, binRush2);
    insertNestedSequence(adsItem, sequence, true);

    if (hook) {
        var hookItem = getSequenceProjectItemByName(hook.name, binRush2);
        if (hookItem) {
            insertNestedSequence(hookItem, sequence, true);
        }
    }
}

/**
 * Génère les combinaisons pour une Ad donnée
 */
function generateCombinationsForAd(ads, allHooks, allCTAs, globalHooks, globalCTAs, binRush2, binVertical, binHorizontal, binCarre, binPortrait, OptionVertical, OptionHorizontal, OptionCarre, OptionPortrait) {
    var adsName = ads.name;

    // Filtrage des hooks et CTAs spécifiques
    var specificHooks = [];
    var specificCTAs = [];

    for (var hj = 0; hj < allHooks.length; hj++) {
        if (isSpecificToAd(allHooks[hj], ads)) specificHooks.push(allHooks[hj]);
    }
    for (var cj = 0; cj < allCTAs.length; cj++) {
        if (isSpecificToAd(allCTAs[cj], ads)) specificCTAs.push(allCTAs[cj]);
    }

    // Cas 1 : Hooks spécifiques
    for (var h = 0; h < specificHooks.length; h++) {
        var hook = specificHooks[h];
        var hookLabel = labelFor(hook.name, adsName, false);

        // 1a) CTAs spécifiques
        for (var c1 = 0; c1 < specificCTAs.length; c1++) {
            var cta1 = specificCTAs[c1];
            var ctaLabel1 = labelFor(cta1.name, adsName, true);
            if (OptionVertical) createFormattedSequence("Vertical_" + hookLabel + "_" + adsName + "_" + ctaLabel1, ads, hook, cta1, binRush2, binVertical, 1080, 1920);
            if (OptionHorizontal) createFormattedSequence("Horizontal_" + hookLabel + "_" + adsName + "_" + ctaLabel1, ads, hook, cta1, binRush2, binHorizontal, 1920, 1080);
            if (OptionCarre) createFormattedSequence("Carre_" + hookLabel + "_" + adsName + "_" + ctaLabel1, ads, hook, cta1, binRush2, binCarre, 1080, 1080);
            if (OptionPortrait) createFormattedSequence("Portrait_" + hookLabel + "_" + adsName + "_" + ctaLabel1, ads, hook, cta1, binRush2, binPortrait, 1080, 1350);
        }

        // 1b) CTAs globaux
        for (var c2 = 0; c2 < globalCTAs.length; c2++) {
            var cta2 = globalCTAs[c2];
            var ctaLabel2 = labelFor(cta2.name, adsName, true);
            if (OptionVertical) createFormattedSequence("Vertical_" + hookLabel + "_" + adsName + "_" + ctaLabel2, ads, hook, cta2, binRush2, binVertical, 1080, 1920);
            if (OptionHorizontal) createFormattedSequence("Horizontal_" + hookLabel + "_" + adsName + "_" + ctaLabel2, ads, hook, cta2, binRush2, binHorizontal, 1920, 1080);
            if (OptionCarre) createFormattedSequence("Carre_" + hookLabel + "_" + adsName + "_" + ctaLabel2, ads, hook, cta2, binRush2, binCarre, 1080, 1080);
            if (OptionPortrait) createFormattedSequence("Portrait_" + hookLabel + "_" + adsName + "_" + ctaLabel2, ads, hook, cta2, binRush2, binPortrait, 1080, 1350);
        }

        // 1c) Aucun CTA
        if (specificCTAs.length === 0 && globalCTAs.length === 0) {
            if (OptionVertical) createFormattedSequence("Vertical_" + hookLabel + "_" + adsName, ads, hook, null, binRush2, binVertical, 1080, 1920);
            if (OptionHorizontal) createFormattedSequence("Horizontal_" + hookLabel + "_" + adsName, ads, hook, null, binRush2, binHorizontal, 1920, 1080);
            if (OptionCarre) createFormattedSequence("Carre_" + hookLabel + "_" + adsName, ads, hook, null, binRush2, binCarre, 1080, 1080);
            if (OptionPortrait) createFormattedSequence("Portrait_" + hookLabel + "_" + adsName, ads, hook, null, binRush2, binPortrait, 1080, 1350);
        }
    }

    // Cas 2 : Hooks globaux
    for (var hg = 0; hg < globalHooks.length; hg++) {
        var hookG = globalHooks[hg];
        var hookGLabel = labelFor(hookG.name, adsName, false);

        // 2a) CTAs spécifiques
        for (var c3 = 0; c3 < specificCTAs.length; c3++) {
            var cta3 = specificCTAs[c3];
            var ctaLabel3 = labelFor(cta3.name, adsName, true);
            if (OptionVertical) createFormattedSequence("Vertical_" + hookGLabel + "_" + adsName + "_" + ctaLabel3, ads, hookG, cta3, binRush2, binVertical, 1080, 1920);
            if (OptionHorizontal) createFormattedSequence("Horizontal_" + hookGLabel + "_" + adsName + "_" + ctaLabel3, ads, hookG, cta3, binRush2, binHorizontal, 1920, 1080);
            if (OptionCarre) createFormattedSequence("Carre_" + hookGLabel + "_" + adsName + "_" + ctaLabel3, ads, hookG, cta3, binRush2, binCarre, 1080, 1080);
            if (OptionPortrait) createFormattedSequence("Portrait_" + hookGLabel + "_" + adsName + "_" + ctaLabel3, ads, hookG, cta3, binRush2, binPortrait, 1080, 1350);
        }

        // 2b) CTAs globaux
        for (var c4 = 0; c4 < globalCTAs.length; c4++) {
            var cta4 = globalCTAs[c4];
            var ctaLabel4 = labelFor(cta4.name, adsName, true);
            if (OptionVertical) createFormattedSequence("Vertical_" + hookGLabel + "_" + adsName + "_" + ctaLabel4, ads, hookG, cta4, binRush2, binVertical, 1080, 1920);
            if (OptionHorizontal) createFormattedSequence("Horizontal_" + hookGLabel + "_" + adsName + "_" + ctaLabel4, ads, hookG, cta4, binRush2, binHorizontal, 1920, 1080);
            if (OptionCarre) createFormattedSequence("Carre_" + hookGLabel + "_" + adsName + "_" + ctaLabel4, ads, hookG, cta4, binRush2, binCarre, 1080, 1080);
            if (OptionPortrait) createFormattedSequence("Portrait_" + hookGLabel + "_" + adsName + "_" + ctaLabel4, ads, hookG, cta4, binRush2, binPortrait, 1080, 1350);
        }

        // 2c) Aucun CTA
        if (specificCTAs.length === 0 && globalCTAs.length === 0) {
            if (OptionVertical) createFormattedSequence("Vertical_" + hookGLabel + "_" + adsName, ads, hookG, null, binRush2, binVertical, 1080, 1920);
            if (OptionHorizontal) createFormattedSequence("Horizontal_" + hookGLabel + "_" + adsName, ads, hookG, null, binRush2, binHorizontal, 1920, 1080);
            if (OptionCarre) createFormattedSequence("Carre_" + hookGLabel + "_" + adsName, ads, hookG, null, binRush2, binCarre, 1080, 1080);
            if (OptionPortrait) createFormattedSequence("Portrait_" + hookGLabel + "_" + adsName, ads, hookG, null, binRush2, binPortrait, 1080, 1350);
        }
    }

    // Cas 3 : Aucun hook
    if (specificHooks.length === 0 && globalHooks.length === 0) {
        // 3a) CTAs spécifiques
        for (var c5 = 0; c5 < specificCTAs.length; c5++) {
            var cta5 = specificCTAs[c5];
            var ctaLabel5 = labelFor(cta5.name, adsName, true);
            if (OptionVertical) createFormattedSequence("Vertical_" + adsName + "_" + ctaLabel5, ads, null, cta5, binRush2, binVertical, 1080, 1920);
            if (OptionHorizontal) createFormattedSequence("Horizontal_" + adsName + "_" + ctaLabel5, ads, null, cta5, binRush2, binHorizontal, 1920, 1080);
            if (OptionCarre) createFormattedSequence("Carre_" + adsName + "_" + ctaLabel5, ads, null, cta5, binRush2, binCarre, 1080, 1080);
            if (OptionPortrait) createFormattedSequence("Portrait_" + adsName + "_" + ctaLabel5, ads, null, cta5, binRush2, binPortrait, 1080, 1350);
        }

        // 3b) CTAs globaux
        for (var c6 = 0; c6 < globalCTAs.length; c6++) {
            var cta6 = globalCTAs[c6];
            var ctaLabel6 = labelFor(cta6.name, adsName, true);
            if (OptionVertical) createFormattedSequence("Vertical_" + adsName + "_" + ctaLabel6, ads, null, cta6, binRush2, binVertical, 1080, 1920);
            if (OptionHorizontal) createFormattedSequence("Horizontal_" + adsName + "_" + ctaLabel6, ads, null, cta6, binRush2, binHorizontal, 1920, 1080);
            if (OptionCarre) createFormattedSequence("Carre_" + adsName + "_" + ctaLabel6, ads, null, cta6, binRush2, binCarre, 1080, 1080);
            if (OptionPortrait) createFormattedSequence("Portrait_" + adsName + "_" + ctaLabel6, ads, null, cta6, binRush2, binPortrait, 1080, 1350);
        }

        // 3c) Aucun CTA
        if (specificCTAs.length === 0 && globalCTAs.length === 0) {
            if (OptionVertical) createFormattedSequence("Vertical_" + adsName, ads, null, null, binRush2, binVertical, 1080, 1920);
            if (OptionHorizontal) createFormattedSequence("Horizontal_" + adsName, ads, null, null, binRush2, binHorizontal, 1920, 1080);
            if (OptionCarre) createFormattedSequence("Carre_" + adsName, ads, null, null, binRush2, binCarre, 1080, 1080);
            if (OptionPortrait) createFormattedSequence("Portrait_" + adsName, ads, null, null, binRush2, binPortrait, 1080, 1350);
        }
    }
}

/**
 * STEP4 - Génération des formats d'export (FONCTION PUBLIQUE)
 */
function STEP4_EXECUTE(OptionVertical, OptionHorizontal, OptionCarre, OptionPortrait) {
    var sequenceBin = searchOrCreateBin(BIN_NAMES.SEQUENCES);
    var binRush2 = searchBinByName(BIN_NAMES.RUSH2, sequenceBin);

    if (!binRush2) {
        notif("Le chutier [Rush2] n'existe pas dans [00_Sequences].", "error");
        return;
    }

    var binExport = searchOrCreateBin(BIN_NAMES.EXPORT, sequenceBin);
    var binVertical = OptionVertical ? searchOrCreateBin(BIN_NAMES.VERTICAL, binExport) : null;
    var binHorizontal = OptionHorizontal ? searchOrCreateBin(BIN_NAMES.HORIZONTAL, binExport) : null;
    var binCarre = OptionCarre ? searchOrCreateBin(BIN_NAMES.CARRE, binExport) : null;
    var binPortrait = OptionPortrait ? searchOrCreateBin(BIN_NAMES.PORTRAIT, binExport) : null;

    var allADS = [];
    var allHooks = [];
    var allCTAs = [];

    // Partition des séquences
    for (var i = 0; i < binRush2.children.numItems; i++) {
        var it = binRush2.children[i];
        if (!it.isSequence()) continue;

        var n = it.name.toLowerCase();
        if (n.indexOf("hook") !== -1 || n.match(/(^|[^a-z])h[0-9]+/i)) {
            allHooks.push(it);
        } else if (n.indexOf("cta") !== -1) {
            allCTAs.push(it);
        } else {
            allADS.push(it);
        }
    }

    // Filtrage des hooks et CTAs globaux
    var globalHooks = filterGlobalItems(allHooks, allADS);
    var globalCTAs = filterGlobalItems(allCTAs, allADS);

    // Génération des combinaisons pour chaque Ad
    for (var ai = 0; ai < allADS.length; ai++) {
        generateCombinationsForAd(
            allADS[ai],
            allHooks,
            allCTAs,
            globalHooks,
            globalCTAs,
            binRush2,
            binVertical,
            binHorizontal,
            binCarre,
            binPortrait,
            OptionVertical,
            OptionHorizontal,
            OptionCarre,
            OptionPortrait
        );
    }
}

// ============================================================================
// SETUP HELPERS
// ============================================================================

/**
 * Execute une commande shell de façon synchrone et retourne la sortie.
 * Utilise le pattern bat + vbs (sh.Run ... True = attend la fin).
 */
function runSetupCommand(cmd) {
    var tempDir = Folder.temp.fsName;
    var outFile = new File(tempDir + "\\productivity_setup_out.txt");
    var doneFile = new File(tempDir + "\\productivity_setup_done.txt");

    if (outFile.exists) outFile.remove();
    if (doneFile.exists) doneFile.remove();

    var bat = new File(tempDir + "\\productivity_setup.bat");
    bat.open("w");
    bat.write("@echo off\r\n" + cmd + ' > "' + outFile.fsName + '" 2>&1\r\necho done > "' + doneFile.fsName + '"\r\n');
    bat.close();

    var vbs = new File(tempDir + "\\productivity_setup.vbs");
    vbs.open("w");
    vbs.write('Set sh = CreateObject("WScript.Shell")\r\n');
    vbs.write('sh.Run "cmd.exe /c ""' + bat.fsName.replace(/"/g, '""') + '""", 0, True\r\n');
    vbs.close();

    vbs.execute();

    // Attendre la fin (max 10 min pour pip install)
    var waited = 0;
    while (waited < 600000) {
        $.sleep(1000);
        waited += 1000;
        if (doneFile.exists) break;
    }

    var result = "";
    if (outFile.exists) {
        outFile.open("r");
        result = outFile.read();
        outFile.close();
    }

    try { outFile.remove(); } catch (e) {}
    try { doneFile.remove(); } catch (e) {}
    try { bat.remove(); } catch (e) {}
    try { vbs.remove(); } catch (e) {}

    return result;
}

/**
 * Vérifie si un fichier existe dans un dossier (case-insensitive)
 */
function checkFileInFolder(folderPath, fileName) {
    var folder = new Folder(folderPath);
    if (!folder.exists) return false;
    var files = folder.getFiles();
    var target = fileName.toLowerCase();
    for (var i = 0; i < files.length; i++) {
        if (files[i].name.toLowerCase() === target) return true;
    }
    return false;
}

// ============================================================================
// CLAUDE CLI — COMMANDE BACKGROUND
// ============================================================================

/**
 * Lance une commande Claude CLI en arrière-plan (non-bloquant).
 * Crée un .bat + .vbs, le .vbs lance en mode async (False = n'attend pas).
 * Un fichier .done est créé quand la commande est terminée.
 * @param {string} promptPath - Chemin du fichier contenant le prompt
 * @param {string} outputPath - Chemin du fichier de sortie JSON
 * @returns {string} JSON {launched: true, donePath: "..."} ou {error: "..."}
 */
function runClaudeBackground(promptPath, outputPath) {
    try {
        var donePath = outputPath + ".done";

        // Nettoyer les anciens fichiers
        var oldOut = new File(outputPath);
        var oldDone = new File(donePath);
        if (oldOut.exists) oldOut.remove();
        if (oldDone.exists) oldDone.remove();

        // Construire la commande : lire le prompt et l'envoyer à claude -p
        // set CLAUDECODE= désactive la protection anti-nesting
        // CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000 : Lottie JSON riche (5-8 layers) dépasse les 32K tokens par défaut
        // --model sonnet --effort low : Sonnet 4.6 avec thinking minimal (sans effort low = 5-10min de thinking)
        // --tools "" : désactive tool_use inutile pour génération texte (réduit thinking + init)
        // stream-json --verbose --include-partial-messages : NDJSON avec stream_event text deltas
        var cmd = 'set "CLAUDECODE=" && set "CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000" && claude -p --model sonnet --effort low --tools "" --max-turns 1 --output-format stream-json --verbose --include-partial-messages < "' + promptPath + '"';

        // Créer le .bat (F1: new Date().getTime() au lieu de Date.now() — ES3)
        var tempDir = Folder.temp.fsName;
        var ts = new Date().getTime();
        var bat = new File(tempDir + "\\claude_lottie_" + ts + ".bat");
        bat.encoding = "UTF-8";
        bat.open("w");
        bat.write("@echo off\r\n");
        bat.write("chcp 65001 > nul\r\n");
        bat.write(cmd + ' > "' + outputPath + '" 2>"' + outputPath + '.err"\r\n');
        bat.write('echo done > "' + donePath + '"\r\n');
        bat.close();

        // Créer le .vbs — sh.Run avec False = async (ne bloque pas)
        var vbs = new File(tempDir + "\\claude_lottie_" + ts + ".vbs");
        vbs.encoding = "UTF-8";
        vbs.open("w");
        vbs.write('Set sh = CreateObject("WScript.Shell")\r\n');
        vbs.write('sh.Run "cmd.exe /c ""' + bat.fsName.replace(/"/g, '""') + '""", 0, False\r\n');
        vbs.close();

        // Lancer en arrière-plan
        vbs.execute();

        return JSON.stringify({
            launched: true,
            donePath: donePath,
            batPath: bat.fsName,
            vbsPath: vbs.fsName
        });
    } catch (e) {
        return JSON.stringify({error: "Erreur lancement Claude : " + e.message});
    }
}

/**
 * Vérifie si un fichier .done existe (polling depuis JS)
 * @param {string} donePath - Chemin du fichier .done
 * @returns {string} "true" ou "false"
 */
function checkClaudeDone(donePath) {
    var f = new File(donePath);
    return f.exists ? "true" : "false";
}

/**
 * Lit le contenu d'un fichier texte (pour lire la sortie Claude)
 * @param {string} filePath - Chemin du fichier
 * @returns {string} Contenu du fichier ou chaîne vide
 */
function readTextFile(filePath) {
    var f = new File(filePath);
    if (!f.exists) return "";
    f.encoding = "UTF-8";
    f.open("r");
    var content = f.read();
    f.close();
    return content;
}

/**
 * Tue les processus Claude CLI orphelins (en cas de timeout).
 * Utilise taskkill via WScript.Shell pour tuer les processus "claude" en arrière-plan.
 * @returns {string} "ok" ou message d'erreur
 */
function killClaudeProcess() {
    try {
        var sh = new ActiveXObject("WScript.Shell");
        // /F = force, /IM = image name, /T = kill child processes too
        // stderr redirigé vers nul pour éviter les erreurs si aucun process trouvé
        sh.Run('cmd.exe /c taskkill /F /IM claude.exe /T 2>nul', 0, true);
        return "ok";
    } catch (e) {
        return "error: " + e.message;
    }
}

/**
 * Nettoie les fichiers temporaires Claude (bat, vbs, done, err)
 * @param {string} outputPath - Chemin du fichier de sortie (base pour .done, .err)
 * @param {string} batPath - Chemin du .bat
 * @param {string} vbsPath - Chemin du .vbs
 */
function cleanupClaudeFiles(outputPath, batPath, vbsPath) {
    try {
        var files = [
            new File(outputPath),
            new File(outputPath + ".done"),
            new File(outputPath + ".err"),
            new File(batPath),
            new File(vbsPath)
        ];
        for (var i = 0; i < files.length; i++) {
            if (files[i].exists) files[i].remove();
        }
    } catch (e) {
        // Ignorer les erreurs de nettoyage
    }
    return "ok";
}

/**
 * Vérifie si Claude CLI est authentifié en lançant une commande test.
 * Lance une commande rapide (--help) et vérifie qu'elle ne retourne pas d'erreur d'auth.
 * @returns {string} JSON {authenticated: true|false, error: "..."} ou {error: "..."}
 */
function checkClaudeAuth() {
    try {
        var tempDir = Folder.temp.fsName;
        var ts = new Date().getTime();
        var outputPath = tempDir + "\\claude_auth_check_" + ts + ".txt";
        var errPath = outputPath + ".err";

        // Commande test rapide : juste demander l'aide (pas de génération)
        var cmd = 'set "CLAUDECODE=" && claude --help';

        // Créer un .bat pour la commande test
        var bat = new File(tempDir + "\\claude_auth_check_" + ts + ".bat");
        bat.encoding = "UTF-8";
        bat.open("w");
        bat.write("@echo off\r\n");
        bat.write("chcp 65001 > nul\r\n");
        bat.write(cmd + ' > "' + outputPath + '" 2>"' + errPath + '"\r\n');
        bat.close();

        // Exécuter de manière synchrone (attendre le résultat)
        var sh = new ActiveXObject("WScript.Shell");
        sh.Run('cmd.exe /c "' + bat.fsName + '"', 0, true); // true = wait

        // Lire le fichier d'erreur
        var errFile = new File(errPath);
        var errContent = "";
        if (errFile.exists) {
            errFile.encoding = "UTF-8";
            errFile.open("r");
            errContent = errFile.read();
            errFile.close();
        }

        // Nettoyer
        try { bat.remove(); } catch (e) {}
        try { new File(outputPath).remove(); } catch (e) {}
        try { errFile.remove(); } catch (e) {}

        // Détecter les patterns d'erreur d'authentification
        if (errContent) {
            var lower = errContent.toLowerCase();
            var authPatterns = [
                'not logged in',
                'authentication required',
                'authentication failed',
                'session expired',
                'invalid token',
                'unauthorized',
                'login required',
                'please log in',
                'you are not authenticated',
                'auth error'
            ];

            for (var i = 0; i < authPatterns.length; i++) {
                if (lower.indexOf(authPatterns[i]) !== -1) {
                    return JSON.stringify({
                        authenticated: false,
                        error: errContent.slice(0, 500)
                    });
                }
            }
        }

        // Si pas d'erreur d'auth détectée, considérer comme authentifié
        return JSON.stringify({ authenticated: true });

    } catch (e) {
        return JSON.stringify({error: "Erreur vérification auth Claude : " + e.message});
    }
}

// ============================================================================
// MOTION DESIGN — LOTTIE OVERLAY
// ============================================================================

/**
 * Importe un .mov overlay Lottie dans Premiere et le place sur la timeline
 * @param {string} sequenceName - Nom de la séquence cible
 * @param {string} movPath - Chemin du fichier .mov
 * @param {number} positionSeconds - Position en secondes sur la timeline
 * @returns {string} JSON {success, track} ou {error}
 */
function ImportLottieOverlay(sequenceName, movPath, positionSeconds) {
    var previousSequence = null;
    try {
        // 1. Trouver la séquence
        var sequence = searchSequenceByName(sequenceName);
        if (!sequence) {
            return JSON.stringify({error: "Séquence introuvable : " + sequenceName});
        }

        // Activer la séquence cible pour que QE DOM et insertClip opèrent dessus (pattern createMarkers)
        previousSequence = project.activeSequence;
        project.activeSequence = sequence;

        // 2. Vérifier que le fichier existe
        var movFile = new File(movPath);
        if (!movFile.exists) {
            return JSON.stringify({error: "Fichier .mov introuvable : " + movPath});
        }

        // 3. Importer le .mov dans le projet
        var importSuccess = app.project.importFiles([movPath]);
        if (!importSuccess) {
            return JSON.stringify({error: "Échec de l'import du fichier .mov"});
        }

        // 4. Trouver le clip importé (cherche dans le bin racine + sous-bins)
        var movFileName = movFile.name;
        var movBaseName = movFileName.replace(".mov", "");
        var importedClip = null;

        // Recherche récursive dans tous les bins
        function findClipRecursive(parentItem, targetName, targetBase) {
            for (var i = parentItem.children.numItems - 1; i >= 0; i--) {
                var child = parentItem.children[i];
                if (child.name === targetName || child.name === targetBase) {
                    return child;
                }
                // Chercher dans les sous-bins (type 2 = bin)
                if (child.type === 2 && child.children) {
                    var found = findClipRecursive(child, targetName, targetBase);
                    if (found) return found;
                }
            }
            return null;
        }

        importedClip = findClipRecursive(project.rootItem, movFileName, movBaseName);

        if (!importedClip) {
            return JSON.stringify({error: "Clip importé introuvable dans le projet : " + movFileName});
        }

        // 5. Créer/trouver le bin 01_Vault > Motion Design et y déplacer le clip
        var vaultBin = searchOrCreateBin(BIN_NAMES.VAULT);
        var motionBin = searchOrCreateBin("Motion Design", vaultBin);
        importedClip.moveBin(motionBin);

        // 6. Trouver la première piste vide >= V8 (index 7)
        var startIndex = 7;
        var maxSearch = 5;
        var emptyIndex = -1;

        for (var t = startIndex; t < startIndex + maxSearch; t++) {
            // Créer la piste si nécessaire
            if (t >= sequence.videoTracks.numTracks) {
                try {
                    var qeSeq = qe.project.getActiveSequence();
                    if (qeSeq) {
                        qeSeq.addTracks(1, sequence.videoTracks.numTracks, 0);
                    }
                } catch (qeErr) {
                    return JSON.stringify({error: "Impossible de créer la piste V" + (t+1) + " — QE DOM non disponible"});
                }
            }

            if (t < sequence.videoTracks.numTracks) {
                var track = sequence.videoTracks[t];
                // Vérifier si la piste est vide à la position du curseur
                var hasClipAtPosition = false;
                var insertTicks = Number(secondsToTicks(positionSeconds));
                var durationTicks = Number(secondsToTicks(3)); // 3 secondes

                for (var c = 0; c < track.clips.numItems; c++) {
                    var clip = track.clips[c];
                    var clipStart = Number(clip.start.ticks);
                    var clipEnd = Number(clip.end.ticks);
                    // Chevauchement ?
                    if (clipStart < (insertTicks + durationTicks) && clipEnd > insertTicks) {
                        hasClipAtPosition = true;
                        break;
                    }
                }

                if (!hasClipAtPosition) {
                    emptyIndex = t;
                    break;
                }
            }
        }

        if (emptyIndex === -1) {
            return JSON.stringify({error: "Aucune piste vidéo vide trouvée (V8 à V12)"});
        }

        // 7. Insérer le clip sur la piste
        sequence.videoTracks[emptyIndex].insertClip(importedClip, secondsToTicks(positionSeconds));

        return JSON.stringify({success: true, track: emptyIndex + 1});
    } catch (e) {
        return JSON.stringify({error: e.toString()});
    } finally {
        // Restaurer la séquence active précédente (tous chemins de sortie)
        if (previousSequence) {
            try { project.activeSequence = previousSequence; } catch(restoreErr) {
                logMessage("ImportLottieOverlay: échec restauration séquence active — " + restoreErr.toString());
            }
        }
    }
}

/**
 * Supprime tous les clips des pistes V8+ (motion design) dans une séquence
 * @param {string} sequenceName - Nom de la séquence
 * @returns {string} JSON { removed: number } ou { error: string }
 */
function ClearMotionDesignClips(sequenceName) {
    var previousSequence = null;
    try {
        var sequence = searchSequenceByName(sequenceName);
        if (!sequence) {
            return JSON.stringify({error: "Séquence introuvable : " + sequenceName});
        }

        // Activer la séquence cible (pattern createMarkers)
        previousSequence = project.activeSequence;
        project.activeSequence = sequence;

        var removed = 0;
        var startTrack = 7; // V8 (index 7)

        for (var t = startTrack; t < sequence.videoTracks.numTracks; t++) {
            var track = sequence.videoTracks[t];
            // Supprimer de la fin vers le début pour ne pas décaler les indices
            for (var c = track.clips.numItems - 1; c >= 0; c--) {
                track.clips[c].remove(false, false);
                removed++;
            }
        }

        return JSON.stringify({removed: removed});
    } catch (e) {
        return JSON.stringify({error: e.toString()});
    } finally {
        // Restaurer la séquence active précédente (tous chemins de sortie)
        if (previousSequence) {
            try { project.activeSequence = previousSequence; } catch(restoreErr) {
                logMessage("ClearMotionDesignClips: échec restauration séquence active — " + restoreErr.toString());
            }
        }
    }
}

// ============================================================================
// SMART CUT
// ============================================================================

function GetActiveSequenceInfo() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) {
            return JSON.stringify({ error: "Aucune sequence active" });
        }
        var result = {
            name: seq.name,
            duration: seq.end.seconds,
            sequenceId: seq.sequenceID
        };
        return JSON.stringify(result);
    } catch (e) {
        return JSON.stringify({ error: e.toString() });
    }
}

/**
 * Recherche recursive d'un project item par nom (type 1 = clip/sequence)
 */
function findProjectItemByName(parentItem, name) {
    for (var i = 0; i < parentItem.children.numItems; i++) {
        var child = parentItem.children[i];
        if (child.name === name && child.type === 1) {
            return child;
        }
        if (child.type === 2 && child.children) {
            var found = findProjectItemByName(child, name);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Cree une sequence Smart Cut par cut de la source imbriquee aux timecodes specifies
 * @param {string} name - Nom de la nouvelle sequence (ex: SHORT1)
 * @param {string} inPointSeconds - Point d'entree en secondes
 * @param {string} outPointSeconds - Point de sortie en secondes
 * @param {string} sourceSequenceName - Nom de la sequence source
 * @returns {string} JSON {success, name} ou {error}
 */
function CreateSmartCutSequence(name, inPointSeconds, outPointSeconds, sourceSequenceName) {
    try {
        // 1. Trouver le project item de la sequence source
        var sourceProjectItem = findProjectItemByName(project.rootItem, sourceSequenceName);
        if (!sourceProjectItem) {
            return JSON.stringify({ error: "Project item '" + sourceSequenceName + "' introuvable" });
        }

        // 2. Trouver/creer le bin 00_Sequences/Rush2
        var sequencesBin = searchOrCreateBin(BIN_NAMES.SEQUENCES);
        var rush2Bin = searchOrCreateBin(BIN_NAMES.RUSH2, sequencesBin);

        // 3. Creer la sequence (herite des parametres de la source)
        var newSeq = project.createNewSequenceFromClips(name, sourceProjectItem, rush2Bin);
        if (!newSeq) {
            return JSON.stringify({ error: "Echec creation sequence '" + name + "'" });
        }

        // 4. Supprimer les clips placeholder (video + audio)
        try {
            if (newSeq.videoTracks[0].clips.numItems > 0) newSeq.videoTracks[0].clips[0].remove(0, 0);
        } catch (e) {}
        try {
            if (newSeq.audioTracks[0].clips.numItems > 0) newSeq.audioTracks[0].clips[0].remove(0, 0);
        } catch (e) {}

        // 5. Sauvegarder les points In/Out originaux du source
        var savedIn = sourceProjectItem.getInPoint();
        var savedOut = sourceProjectItem.getOutPoint();

        // 6. Definir les points du segment desire (en ticks)
        sourceProjectItem.setInPoint(secondsToTicks(parseFloat(inPointSeconds)), 4);
        sourceProjectItem.setOutPoint(secondsToTicks(parseFloat(outPointSeconds)), 4);

        // 7. Inserer la source comme clip imbrique (respecte les In/Out)
        insertNestedSequence(sourceProjectItem, newSeq);

        // 8. Restaurer les points originaux
        try {
            sourceProjectItem.setInPoint(savedIn, 4);
            sourceProjectItem.setOutPoint(savedOut, 4);
        } catch (e) {}

        return JSON.stringify({ success: true, name: name });
    } catch (e) {
        // Restaurer les points en cas d'erreur
        try {
            sourceProjectItem.setInPoint(savedIn, 4);
            sourceProjectItem.setOutPoint(savedOut, 4);
        } catch (restoreErr) {}
        return JSON.stringify({ error: e.toString() });
    }
}

/**
 * Supprime les sequences Smart Cut du projet (undo)
 * @param {string} sequenceNamesJSON - JSON array des noms de sequences a supprimer
 * @returns {string} JSON {success, deleted, errors} ou {error}
 */
function UndoSmartCut(sequenceNamesJSON) {
    try {
        var names = JSON.parse(sequenceNamesJSON);
        var deleted = [];
        var errors = [];

        for (var i = 0; i < names.length; i++) {
            var seqName = names[i];
            var item = findProjectItemByName(project.rootItem, seqName);
            if (item) {
                item.remove();
                deleted.push(seqName);
            } else {
                errors.push(seqName + " introuvable");
            }
        }

        return JSON.stringify({ success: true, deleted: deleted, errors: errors });
    } catch (e) {
        return JSON.stringify({ error: e.toString() });
    }
}

/**
 * Retourne la liste des noms de sequences existantes (pour eviter les collisions)
 * @returns {string} JSON array de noms ou {error}
 */
function GetExistingSequenceNames() {
    try {
        var names = [];
        for (var i = 0; i < project.sequences.numSequences; i++) {
            names.push(project.sequences[i].name);
        }
        return JSON.stringify(names);
    } catch (e) {
        return JSON.stringify({ error: e.toString() });
    }
}

// ============================================================================
// FILE SYSTEM HELPERS (pour motiondesign.js)
// ============================================================================

/**
 * Crée un dossier (récursivement si nécessaire)
 * @param {string} dirPath - Chemin du dossier à créer
 * @returns {string} "true" ou "false"
 */
function CreateDirectory(dirPath) {
    var folder = new Folder(dirPath);
    if (!folder.exists) {
        folder.create();
    }
    return folder.exists.toString();
}

/**
 * Copie un fichier (binaire-safe)
 * @param {string} src - Chemin source
 * @param {string} dst - Chemin destination
 * @returns {string} "true" ou "false"
 */
function CopyFileTo(src, dst) {
    var srcFile = new File(src);
    if (!srcFile.exists) return "false";
    return srcFile.copy(dst).toString();
}

/**
 * Supprime un fichier
 * @param {string} filePath - Chemin du fichier
 * @returns {string} "true"
 */
function DeleteFileAt(filePath) {
    var f = new File(filePath);
    if (f.exists) f.remove();
    return "true";
}

/**
 * Liste les fichiers d'un dossier
 * @param {string} dirPath - Chemin du dossier
 * @returns {string} JSON array de noms de fichiers
 */
function ListDirectory(dirPath) {
    var folder = new Folder(dirPath);
    if (!folder.exists) return "[]";
    var files = folder.getFiles();
    var names = [];
    for (var i = 0; i < files.length; i++) {
        names.push(files[i].name);
    }
    return JSON.stringify(names);
}

/**
 * Supprime un dossier vide
 * @param {string} dirPath - Chemin du dossier
 * @returns {string} "true"
 */
function DeleteFolder(dirPath) {
    var folder = new Folder(dirPath);
    if (folder.exists) folder.remove();
    return "true";
}

// ============================================================================
// PROPRIÉTÉS MOGRT — Édition multi-clips
// ============================================================================

/**
 * PoC : teste getSelection() sur la séquence active
 * @returns {string} JSON avec les résultats du test
 */
function testGetSelection() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ error: "Pas de séquence active" });

        var selection;
        try {
            selection = seq.getSelection();
        } catch (e) {
            return JSON.stringify({ error: "getSelection not available", fallback: true, message: e.message });
        }

        if (!selection) {
            return JSON.stringify({ error: "getSelection returned null", fallback: true });
        }

        var info = { numItems: selection.numItems, items: [] };
        for (var i = 0; i < selection.numItems && i < 3; i++) {
            var clip = selection[i];
            var item = { name: clip.name, startTicks: String(clip.start.ticks) };
            try { item.componentsCount = clip.components.numItems; } catch (e2) { item.componentsCount = -1; }
            info.items.push(item);
        }
        return JSON.stringify(info);
    } catch (e) {
        return JSON.stringify({ error: e.message });
    }
}

/**
 * Récupère les clips MOGRT sélectionnés et leurs propriétés
 * Utilise getSelection() avec fallback sur isSelected()
 * @returns {string} JSON { clips, templateMatch, clipCount } ou { error }
 */
function getSelectedMogrtProperties() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ error: "Pas de séquence active" });

        // Obtenir la sélection
        var selectedClips = [];
        var useGetSelection = true;

        try {
            var selection = seq.getSelection();
            if (selection && typeof selection.numItems !== "undefined") {
                for (var si = 0; si < selection.numItems; si++) {
                    selectedClips.push({ clip: selection[si], trackIndex: -1 });
                }
            } else {
                useGetSelection = false;
            }
        } catch (e) {
            useGetSelection = false;
        }

        // Fallback : itérer tous les tracks et filtrer par isSelected()
        if (!useGetSelection || selectedClips.length === 0) {
            selectedClips = [];
            for (var t = 0; t < seq.videoTracks.numTracks; t++) {
                var track = seq.videoTracks[t];
                for (var c = 0; c < track.clips.numItems; c++) {
                    var cl = track.clips[c];
                    try {
                        if (cl.isSelected()) {
                            selectedClips.push({ clip: cl, trackIndex: t });
                        }
                    } catch (e2) { /* skip */ }
                }
            }
        }

        if (selectedClips.length === 0) {
            return JSON.stringify({ clips: [], templateMatch: true, clipCount: 0 });
        }

        // Si getSelection était utilisé, retrouver trackIndex pour chaque clip
        if (useGetSelection) {
            for (var fi = 0; fi < selectedClips.length; fi++) {
                var found = false;
                var fClip = selectedClips[fi].clip;
                var fTicks = String(fClip.start.ticks);
                for (var ft = 0; ft < seq.videoTracks.numTracks && !found; ft++) {
                    var fTrack = seq.videoTracks[ft];
                    for (var fc = 0; fc < fTrack.clips.numItems && !found; fc++) {
                        if (String(fTrack.clips[fc].start.ticks) === fTicks && fTrack.clips[fc].name === fClip.name) {
                            selectedClips[fi].trackIndex = ft;
                            found = true;
                        }
                    }
                }
            }
        }

        var clips = [];
        var matchNames = [];

        for (var i = 0; i < selectedClips.length; i++) {
            var clip = selectedClips[i].clip;
            var tIdx = selectedClips[i].trackIndex;
            var graphComp = null;
            var graphMatchName = "";

            // Trouver le composant Graphics
            for (var ci = 0; ci < clip.components.numItems; ci++) {
                var comp = clip.components[ci];
                if (comp.displayName.toLowerCase().indexOf("graphi") !== -1) {
                    graphComp = comp;
                    try { graphMatchName = comp.matchName; } catch (e3) { graphMatchName = comp.displayName; }
                    break;
                }
            }

            if (!graphComp) continue; // Pas un MOGRT, skip

            matchNames.push(graphMatchName);

            var properties = [];
            for (var j = 0; j < graphComp.properties.numItems; j++) {
                var prop = graphComp.properties[j];
                var propInfo = {
                    propIndex: j,
                    displayName: prop.displayName,
                    type: "unknown",
                    value: null
                };

                // Détection type par displayName d'abord
                var dnLower = prop.displayName.toLowerCase();
                if (dnLower.indexOf("color") !== -1 || dnLower.indexOf("couleur") !== -1) {
                    propInfo.type = "color";
                    try {
                        var cv = prop.getColorValue();
                        propInfo.value = String(cv[0]) + "," + String(cv[1]) + "," + String(cv[2]) + "," + String(cv[3]);
                    } catch (e4) {
                        propInfo.type = "unknown";
                        propInfo.value = null;
                    }
                } else {
                    // F10: Essayer getColorValue() en fallback pour les couleurs non détectées par nom
                    var detectedAsColor = false;
                    try {
                        var cvFallback = prop.getColorValue();
                        if (cvFallback && typeof cvFallback.length === "number" && cvFallback.length >= 4) {
                            propInfo.type = "color";
                            propInfo.value = String(cvFallback[0]) + "," + String(cvFallback[1]) + "," + String(cvFallback[2]) + "," + String(cvFallback[3]);
                            detectedAsColor = true;
                        }
                    } catch (eColor) {
                        // Pas une couleur, continuer avec getValue()
                    }

                    if (!detectedAsColor) {
                        try {
                            var val = prop.getValue();
                            var vType = typeof val;
                            if (vType === "string") {
                                // Détecter texte riche MOGRT (JSON avec textEditValue)
                                var isRichText = false;
                                try {
                                    var parsed = eval("(" + val + ")");
                                    if (parsed && typeof parsed === "object" && typeof parsed.textEditValue !== "undefined") {
                                        propInfo.type = "text";
                                        propInfo.value = val;
                                        propInfo.isRichText = true;
                                        isRichText = true;
                                    }
                                } catch (eRich) { /* pas du JSON, continuer */ }

                                if (!isRichText) {
                                    // Détecter groupe/dossier (GUIDs séparés par ;)
                                    var isGroup = false;
                                    if (val.length > 36 && val.indexOf(";") !== -1 && val.indexOf("-") !== -1) {
                                        // Vérifier pattern GUID : 8-4-4-4-12 hexadécimaux
                                        var guidPart = val.split(";")[0];
                                        if (guidPart.length >= 36 && guidPart.split("-").length === 5) {
                                            propInfo.type = "group";
                                            propInfo.value = val;
                                            isGroup = true;
                                        }
                                    }
                                    if (!isGroup) {
                                        propInfo.type = "text";
                                        propInfo.value = val;
                                    }
                                }
                            } else if (vType === "number") {
                                propInfo.type = "number";
                                propInfo.value = val;
                            } else if (vType === "boolean") {
                                propInfo.type = "boolean";
                                propInfo.value = val;
                            } else if (vType === "object" && val !== null && typeof val.length === "number") {
                                // Détecter position (array + nom contient "position")
                                if (dnLower.indexOf("position") !== -1) {
                                    propInfo.type = "position";
                                } else {
                                    propInfo.type = "array";
                                }
                                var arrParts = [];
                                for (var ai = 0; ai < val.length; ai++) {
                                    arrParts.push(String(val[ai]));
                                }
                                propInfo.value = arrParts.join(",");
                            } else {
                                propInfo.type = "text";
                                propInfo.value = String(val);
                            }
                        } catch (e5) {
                            propInfo.type = "unknown";
                            propInfo.value = null;
                        }
                    }
                }

                properties.push(propInfo);
            }

            clips.push({
                selectionIndex: i,
                name: clip.name,
                trackIndex: tIdx,
                startTicks: String(clip.start.ticks),
                matchName: graphMatchName,
                properties: properties
            });
        }

        // Vérifier si tous les clips ont la même structure de propriétés
        // (matchName seul ne suffit pas car tous les MOGRTs ont le même matchName)
        var templateMatch = true;
        if (clips.length > 1) {
            // Construire un fingerprint basé sur le nombre et les noms des propriétés
            var refFingerprint = "";
            for (var fp0 = 0; fp0 < clips[0].properties.length; fp0++) {
                refFingerprint += clips[0].properties[fp0].displayName + "|";
            }
            for (var mi = 1; mi < clips.length; mi++) {
                var curFingerprint = "";
                for (var fp1 = 0; fp1 < clips[mi].properties.length; fp1++) {
                    curFingerprint += clips[mi].properties[fp1].displayName + "|";
                }
                if (curFingerprint !== refFingerprint) {
                    templateMatch = false;
                    break;
                }
            }
        }

        var seqW = 1920;
        var seqH = 1080;
        try { seqW = parseInt(seq.frameSizeHorizontal, 10) || 1920; } catch (ew) {}
        try { seqH = parseInt(seq.frameSizeVertical, 10) || 1080; } catch (eh) {}

        return JSON.stringify({ clips: clips, templateMatch: templateMatch, clipCount: clips.length, sequenceWidth: seqW, sequenceHeight: seqH });
    } catch (e) {
        return JSON.stringify({ error: e.message });
    }
}

/**
 * Applique un batch de modifications sur les propriétés MOGRT
 * @param {string} changesJsonStr - JSON stringifié des changements
 * @returns {string} JSON { success, applied } ou { error }
 */
function setMogrtPropertiesBatch(changesJsonStr) {
    try {
        var changes = eval("(" + changesJsonStr + ")");
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ error: "Pas de séquence active" });

        var applied = 0;

        for (var i = 0; i < changes.length; i++) {
            var change = changes[i];

            // Retrouver le clip par trackIndex + startTicks
            var targetClip = null;
            var trackIdx = change.trackIndex;
            var targetTicks = change.startTicks;

            if (trackIdx >= 0 && trackIdx < seq.videoTracks.numTracks) {
                var track = seq.videoTracks[trackIdx];
                for (var c = 0; c < track.clips.numItems; c++) {
                    if (String(track.clips[c].start.ticks) === targetTicks) {
                        targetClip = track.clips[c];
                        break;
                    }
                }
            }

            // Fallback : chercher dans tous les tracks
            if (!targetClip) {
                for (var t = 0; t < seq.videoTracks.numTracks; t++) {
                    var tr = seq.videoTracks[t];
                    for (var tc = 0; tc < tr.clips.numItems; tc++) {
                        if (String(tr.clips[tc].start.ticks) === targetTicks) {
                            targetClip = tr.clips[tc];
                            break;
                        }
                    }
                    if (targetClip) break;
                }
            }

            if (!targetClip) continue;

            // Trouver le composant Graphics
            var graphComp = null;
            for (var gi = 0; gi < targetClip.components.numItems; gi++) {
                if (targetClip.components[gi].displayName.toLowerCase().indexOf("graphi") !== -1) {
                    graphComp = targetClip.components[gi];
                    break;
                }
            }
            if (!graphComp) continue;

            var prop = graphComp.properties[change.propIndex];
            if (!prop) continue;

            try {
                if (change.isColor) {
                    var parts = change.value;
                    prop.setColorValue(parts[0], parts[1], parts[2], parts[3], 1);
                } else if (change.isRichText) {
                    // Texte riche MOGRT : lire l'objet JSON actuel, remplacer textEditValue + font props
                    var currentVal = prop.getValue();
                    var richObj = null;
                    try { richObj = eval("(" + currentVal + ")"); } catch (eRich) {}

                    // Si getValue() retourne du texte brut (ex: plugin a fait setValue(text,1)),
                    // construire un objet riche from scratch
                    if (!richObj || typeof richObj !== "object") {
                        richObj = {
                            capPropFontEdit: true,
                            textEditValue: (typeof currentVal === "string") ? currentVal : "",
                            fontEditValue: ["Arial"],
                            fontSizeEditValue: [24],
                            fontFSBoldValue: [false],
                            fontFSItalicValue: [false],
                            fontFSAllCapsValue: [false],
                            fontFSSmallCapsValue: [false]
                        };
                    }

                    // Mettre à jour le texte si fourni
                    if (change.value !== undefined && change.value !== null) {
                        richObj.textEditValue = change.value;
                    }
                    // Appliquer les changements de police si présents
                    if (change.fontChanges) {
                        var fc = change.fontChanges;
                        if (fc.fontName !== undefined) {
                            if (!richObj.fontEditValue) richObj.fontEditValue = [];
                            richObj.fontEditValue[0] = fc.fontName;
                        }
                        if (fc.fontSize !== undefined) {
                            if (!richObj.fontSizeEditValue) richObj.fontSizeEditValue = [];
                            richObj.fontSizeEditValue[0] = fc.fontSize;
                        }
                        if (fc.bold !== undefined) {
                            if (!richObj.fontFSBoldValue) richObj.fontFSBoldValue = [];
                            richObj.fontFSBoldValue[0] = fc.bold;
                        }
                        if (fc.italic !== undefined) {
                            if (!richObj.fontFSItalicValue) richObj.fontFSItalicValue = [];
                            richObj.fontFSItalicValue[0] = fc.italic;
                        }
                        if (fc.allCaps !== undefined) {
                            if (!richObj.fontFSAllCapsValue) richObj.fontFSAllCapsValue = [];
                            richObj.fontFSAllCapsValue[0] = fc.allCaps;
                        }
                        if (fc.smallCaps !== undefined) {
                            if (!richObj.fontFSSmallCapsValue) richObj.fontFSSmallCapsValue = [];
                            richObj.fontFSSmallCapsValue[0] = fc.smallCaps;
                        }
                    }
                    prop.setValue(JSON.stringify(richObj), 1);
                } else if (change.isPosition) {
                    // Position en pixels → convertir en normalisé 0-1
                    var posVals = change.value;
                    var normVals = [];
                    var sW = change.seqWidth || 1920;
                    var sH = change.seqHeight || 1080;
                    for (var pi = 0; pi < posVals.length; pi++) {
                        if (pi === 0) normVals.push(posVals[pi] / sW);
                        else if (pi === 1) normVals.push(posVals[pi] / sH);
                        else normVals.push(posVals[pi]);
                    }
                    prop.setValue(normVals, 1);
                } else {
                    prop.setValue(change.value, 1);
                }
                applied++;
            } catch (e2) {
                // Skip erreur individuelle, continuer le batch
            }
        }

        return JSON.stringify({ success: true, applied: applied });
    } catch (e) {
        return JSON.stringify({ error: e.message });
    }
}

// ============================================================================
// MESSAGE DE FIN
// ============================================================================

"Premiere.jsx chargé avec succès (version refactorisée)";
