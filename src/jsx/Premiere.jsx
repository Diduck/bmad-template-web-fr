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
    RMS_SILENCE_THRESHOLD: -60,
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
    CARRE: "Carre"
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
    var extensions = [".mov", ".MOV", ".mp4", ".MP4", ".wav"];

    for (var i = 0; i < extensions.length; i++) {
        if (name.indexOf(extensions[i]) !== -1) {
            return name.substring(0, name.lastIndexOf("."));
        }
    }
    return name;
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
    // 1) Attend que le fichier soit créé
    while (FileExists(outPath) !== "true") {
        $.sleep(CONSTANTS.EXPORT_WAIT_STEP_MS);
    }

    // 2) Attend que la taille du fichier se stabilise (écriture terminée)
    var stableCount = 0;
    var lastSize = -1;
    while (stableCount < CONSTANTS.EXPORT_STABLE_CHECKS) {
        $.sleep(CONSTANTS.EXPORT_WAIT_STEP_MS);
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
 * Exporte l'audio si l'option est activée
 */
function exportAudioIfNeeded(optionAudio, rushSequence, clipName, trackClip) {
    if (!optionAudio) {
        return;
    }

    var rushFolder = getFolderPath(trackClip);
    var audioFolder = getAudioFolderFromRushFolder(rushFolder);

    if (FileExists(WAVFOLDERPRESET) === "true") {
        exportSequenceWavSilently(rushSequence, audioFolder + clipName + ".wav", WAVFOLDERPRESET);
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
    var audioFolder = new Folder(audioFolderBin);

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
 * Crée le dossier audio dans le projet
 */
function ensureProjectAudioFolder() {
    var projetPath = getProjectFolderPath();
    if (projetPath && projetPath !== "") {
        var audioFolder = new Folder(projetPath + "07_Audio");
        if (!audioFolder.exists) {
            audioFolder.create();
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

        for (var i = 0; i < rushBin.children.numItems; i++) {
            var clipName = removeExtension(rushBin.children[i].name);
            clipName = clipName.replace(suffixAudioUpgrade, "");

            var targetClip = searchClipByName(clipName, rushBin);
            if (!targetClip) {
                notif("Clip " + clipName + " introuvable.", "error");
                continue;
            }

            if (searchSequenceByName(clipName)) {
                continue;
            }

            // Crée la séquence principale
            var mainSeq = createSequenceFromRush(targetClip, clipName, binRush2, format);

            // Crée la séquence Rush
            var rushResult = createRushSequence(targetClip, clipName, binRush1, mainSeq.getSettings());
            if (!rushResult) {
                continue;
            }

            var rushItemSequence = getSequenceProjectItemByName("Rush_" + clipName, binRush1);
            insertNestedSequence(rushItemSequence, mainSeq);

            // Export audio si nécessaire
            exportAudioIfNeeded(OptionAudio, rushResult.sequence, clipName, rushResult.clip);
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
    var binRush1 = searchBinByName(BIN_NAMES.RUSH1, sequenceBin);
    var subtitleChutier = searchOrCreateBin(BIN_NAMES.SUBTITLES);
    var trashChutier = searchOrCreateBin(BIN_NAMES.TRASH);

    var trackClip = searchSequenceByName(binRush1.children[0].name).videoTracks[0].clips[0];
    if (trackClip.projectItem.isSequence() === true) {
        var nestedSeq = searchSequenceByName(trackClip.projectItem.name);
        trackClip = nestedSeq.videoTracks[0].clips[0];
    }

    var rushFolder = getFolderPath(trackClip);
    var audioFolderBin = getAudioFolderFromRushFolder(rushFolder);
    var audioFolder = new Folder(audioFolderBin);
    var audioPath = audioFolder.fsName + "\\";

    if (!audioFolder || !(audioFolder instanceof Folder)) {
        notif("Le dossier audio est invalide ou n'existe pas", "error");
        return;
    }

    var jsonFile = new File(audioPath + sequence.name + "SRT.json");
    jsonFile.encoding = "UTF-8";

    if (!jsonFile.exists) {
        notif("Fichier JSON introuvable : " + audioPath + sequence.name + "SRT.json", "error");
        return;
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

    project.activeSequence = sequenceitem;
    sequenceitem.createCaptionTrack(itemSRT, 0);

    notif("Piste de sous-titres créée pour la séquence : " + sequence.name, "success");
}

// ============================================================================
// TITRES ANIMÉS
// ============================================================================

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

            for (var j = 0; j < comp2.properties.numItems; j++) {
                var prop = comp2.properties[j];
                var propNameLower = prop.displayName.toLowerCase();

                // Gestion de la couleur
                if (propNameLower === "color") {
                    var colorargb = hexToColorArray(color);
                    if (prop.getColorValue().toString() == hexToColorArray("#FF0000").toString()) {
                        prop.setColorValue(colorargb[0], colorargb[1], colorargb[2], colorargb[3], 1);
                    }
                }

                // Gestion du texte
                if (propNameLower === "text") {
                    // Template 1 avec 2 lignes : skip la ligne 2 du modèle
                    // On saute index 1 pour que ligne 2 du texte aille sur ligne 3 du modèle
                    if (TemplateSelection === "1") {
                        if (nbr < 3) {
                            if (countText === 1) {
                                if (countText === index) {
                                    index += 1;
                                }
                            }
                        }
                    }

                    if (countText === index) {
                        prop.setValue(text, 1);
                    }
                    countText += 1;
                }

                // Déclencheur d'apparition
                if (propNameLower === "déclencheur apparition") {
                    if (countApparition === index) {
                        prop.setValue(time, 1);
                    }
                    countApparition += 1;
                }

                // Gestion spécifique template 1 : masquer ligne 2 et ajuster position
                if (TemplateSelection === "1") {
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
            }
        }
    }
}

/**
 * Crée les titres animés dans une séquence (FONCTION PUBLIQUE)
 */
function CreateTitles(sequence, TemplateSelection, titleColor) {
    var projetPath = getProjectFolderPath();
    sequence = searchSequenceByName(sequence.name);
    project.activeSequence = sequence;
    var qeSeq = qe.project.getActiveSequence();

    notif("Ajout des titres dans la timeline pour " + sequence.name, "warning");

    var titlesFile = new File(projetPath + "07_Audio\\" + sequence.name + "_titles.json");
    if (!titlesFile.exists) {
        notif("Fichier titres introuvable pour " + sequence.name, "error");
        return;
    }

    var value = readFile(projetPath + "07_Audio\\" + sequence.name + "_titles.json");
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
 * Parse le fichier de résultat FFmpeg
 */
function parseFFmpegResults(audioPath, sequenceName, rmsThreshold, time) {
    var file = new File(audioPath + sequenceName + '.txt');
    if (!file.exists) {
        return null;
    }

    $.sleep((time / 84 + 3) * 1000);
    file.open("r");

    var lowRmsTimes = [];
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

            if (rms < rmsThreshold && currentTime !== null) {
                lowRmsTimes.push(currentTime);
            }
        }
    }

    file.close();
    return { lowRmsTimes: lowRmsTimes, AllValueWav: AllValueWav };
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
    var trackClip = searchSequenceByName(binRush1.children[0].name).videoTracks[0].clips[0];
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
    $.sleep(20000);

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

        var parseResult = parseFFmpegResults(audioPath, sequence.name, rmsThreshold, time);
        if (!parseResult) {
            return {
                "Message": "Fichier " + audioPath + sequence.name + ".txt introuvable",
                "fileName": sequence.name
            };
        }

        var CutZones = groupCutZones(parseResult.lowRmsTimes, margin);

        return {
            "Message": "Analyse réussie",
            "Value": CutZones,
            "AllValueWav": parseResult.AllValueWav,
            "fileName": sequence.name,
            "duration": ticksToTime(sequence.end)
        };
    }
}

// ============================================================================
// STEP 2 - TRAITEMENT AVANCÉ
// ============================================================================

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
function waitForLogAndLoadJSON(audioPath, goal, file) {
    var audioDir = audioPath.substring(0, audioPath.lastIndexOf("\\"));
    var logFile = new File(audioDir + "\\stdout.log");

    var jsonFile;
    if (goal === "BROLL") {
        jsonFile = new File(audioPath.replace(/\.\w+$/, ".json"));
    } else {
        jsonFile = new File(audioPath.replace(/\.\w+$/, "SRT.json"));
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
function runPythonTranscription(extensionPath, audioPath, goal, file) {
    audioPath = audioPath + file + ".wav";
    var pythonScript = extensionPath + "\\scripts\\transcription\\transcribe.py";
    var batFilePath = extensionPath + "\\scripts\\transcription\\run_transcription.bat";
    var audioDir = audioPath.substring(0, audioPath.lastIndexOf("\\"));
    var logPath = audioDir + "\\stdout.log";

    var logFile = new File(logPath);
    if (logFile.exists) {
        logFile.remove();
    }

    var ffmpegDir = EXT_ROOT + "\\bin";

    var command =
        '@echo off\n' +
        'setlocal\n' +
        'set "PATH=' + ffmpegDir + ';%PATH%"\n' +
        'python "' + pythonScript + '" "' + audioPath + '" "' + goal + '" > "' + logPath + '" 2>&1\n' +
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

            var transcriptionData = waitForLogAndLoadJSON(audioPath, goal, file);
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
function generateCombinationsForAd(ads, allHooks, allCTAs, globalHooks, globalCTAs, binRush2, binVertical, binHorizontal, binCarre, OptionVertical, OptionHorizontal, OptionCarre) {
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
        }

        // 1b) CTAs globaux
        for (var c2 = 0; c2 < globalCTAs.length; c2++) {
            var cta2 = globalCTAs[c2];
            var ctaLabel2 = labelFor(cta2.name, adsName, true);
            if (OptionVertical) createFormattedSequence("Vertical_" + hookLabel + "_" + adsName + "_" + ctaLabel2, ads, hook, cta2, binRush2, binVertical, 1080, 1920);
            if (OptionHorizontal) createFormattedSequence("Horizontal_" + hookLabel + "_" + adsName + "_" + ctaLabel2, ads, hook, cta2, binRush2, binHorizontal, 1920, 1080);
            if (OptionCarre) createFormattedSequence("Carre_" + hookLabel + "_" + adsName + "_" + ctaLabel2, ads, hook, cta2, binRush2, binCarre, 1080, 1080);
        }

        // 1c) Aucun CTA
        if (specificCTAs.length === 0 && globalCTAs.length === 0) {
            if (OptionVertical) createFormattedSequence("Vertical_" + hookLabel + "_" + adsName, ads, hook, null, binRush2, binVertical, 1080, 1920);
            if (OptionHorizontal) createFormattedSequence("Horizontal_" + hookLabel + "_" + adsName, ads, hook, null, binRush2, binHorizontal, 1920, 1080);
            if (OptionCarre) createFormattedSequence("Carre_" + hookLabel + "_" + adsName, ads, hook, null, binRush2, binCarre, 1080, 1080);
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
        }

        // 2b) CTAs globaux
        for (var c4 = 0; c4 < globalCTAs.length; c4++) {
            var cta4 = globalCTAs[c4];
            var ctaLabel4 = labelFor(cta4.name, adsName, true);
            if (OptionVertical) createFormattedSequence("Vertical_" + hookGLabel + "_" + adsName + "_" + ctaLabel4, ads, hookG, cta4, binRush2, binVertical, 1080, 1920);
            if (OptionHorizontal) createFormattedSequence("Horizontal_" + hookGLabel + "_" + adsName + "_" + ctaLabel4, ads, hookG, cta4, binRush2, binHorizontal, 1920, 1080);
            if (OptionCarre) createFormattedSequence("Carre_" + hookGLabel + "_" + adsName + "_" + ctaLabel4, ads, hookG, cta4, binRush2, binCarre, 1080, 1080);
        }

        // 2c) Aucun CTA
        if (specificCTAs.length === 0 && globalCTAs.length === 0) {
            if (OptionVertical) createFormattedSequence("Vertical_" + hookGLabel + "_" + adsName, ads, hookG, null, binRush2, binVertical, 1080, 1920);
            if (OptionHorizontal) createFormattedSequence("Horizontal_" + hookGLabel + "_" + adsName, ads, hookG, null, binRush2, binHorizontal, 1920, 1080);
            if (OptionCarre) createFormattedSequence("Carre_" + hookGLabel + "_" + adsName, ads, hookG, null, binRush2, binCarre, 1080, 1080);
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
        }

        // 3b) CTAs globaux
        for (var c6 = 0; c6 < globalCTAs.length; c6++) {
            var cta6 = globalCTAs[c6];
            var ctaLabel6 = labelFor(cta6.name, adsName, true);
            if (OptionVertical) createFormattedSequence("Vertical_" + adsName + "_" + ctaLabel6, ads, null, cta6, binRush2, binVertical, 1080, 1920);
            if (OptionHorizontal) createFormattedSequence("Horizontal_" + adsName + "_" + ctaLabel6, ads, null, cta6, binRush2, binHorizontal, 1920, 1080);
            if (OptionCarre) createFormattedSequence("Carre_" + adsName + "_" + ctaLabel6, ads, null, cta6, binRush2, binCarre, 1080, 1080);
        }

        // 3c) Aucun CTA
        if (specificCTAs.length === 0 && globalCTAs.length === 0) {
            if (OptionVertical) createFormattedSequence("Vertical_" + adsName, ads, null, null, binRush2, binVertical, 1080, 1920);
            if (OptionHorizontal) createFormattedSequence("Horizontal_" + adsName, ads, null, null, binRush2, binHorizontal, 1920, 1080);
            if (OptionCarre) createFormattedSequence("Carre_" + adsName, ads, null, null, binRush2, binCarre, 1080, 1080);
        }
    }
}

/**
 * STEP4 - Génération des formats d'export (FONCTION PUBLIQUE)
 */
function STEP4_EXECUTE(OptionVertical, OptionHorizontal, OptionCarre) {
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
            OptionVertical,
            OptionHorizontal,
            OptionCarre
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
// MESSAGE DE FIN
// ============================================================================

"Premiere.jsx chargé avec succès (version refactorisée)";
