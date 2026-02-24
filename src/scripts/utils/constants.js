// API Configuration
export const OPENAI = {
    KEY_PREFIX: 'sk-',
    API_URL: 'https://api.openai.com/v1/responses',
    MODEL: 'gpt-5-mini',
    MAX_TOKENS: 9000,
    REASONING_EFFORT: 'low',
    BATCH_SIZE: 100,
    DELAY_BETWEEN_BATCHES_MS: 1000,
    MAX_RETRY_ATTEMPTS: 3
};

// Notification Settings
export const NOTIFICATIONS = {
    DEFAULT_DURATION_MS: 6000,
    WARNING_DURATION_MS: 6000,
    ERROR_DURATION_MS: 6000
};

// Cut Analysis Settings
export const CUTS = {
    DEFAULT_MARGIN: 0.015,
    DEFAULT_THRESHOLD: -65,
    TICK_SLEEP_MS: 15,
    GROUP_MAX_GAP_SEC: 0.15
};

// File Paths
export const PATHS = {
    AUDIO_FOLDER: '07_Audio',
    SEQUENCES_BIN: '00_Sequences',
    VAULT_BIN: '01_Vault',
    RUSH_BIN: '02_Rushs',
    SFX_BIN: '03_SFX',
    MUSIC_BIN: '04_Musiques',
    VFX_BIN: '05_VFX',
    OVERLAY_BIN: '06_Overlays',
    TRASH_BIN: '07_Trash',
    SUBTITLES_BIN: '08_Subtitles',
    RUSH1_BIN: 'Rush1',
    RUSH2_BIN: 'Rush2',
    EXPORT_BIN: 'Export'
};

// Sequence Settings
export const SEQUENCE = {
    FORMATS: {
        PHONE: { width: 1080, height: 1920 },
        DESKTOP: { width: 1920, height: 1080 },
        SQUARE: { width: 1080, height: 1080 }
    },
    DEFAULT_FRAMERATE: 60.0
};

// Loading Messages
export const MESSAGES = {
    LOADING_DEFAULT: 'Chargement...',
    CREATING_SEQUENCES: 'Création des séquences...',
    CREATING_FOLDERS: 'Création des chutiers...',
    GENERATING_SUBTITLES: 'Génération des sous-titres...',
    GENERATING_TITLES: 'Génération des titres...',
    CREATING_BROLLS: 'Création des B-rolls...',
    IMPORTING_SUBTITLES: 'Import des sous-titres',
    IMPORTING_TITLES: 'Import des titres',
    CUTTING_SEQUENCE: 'Découpage en cours',
    ANALYZING_CUTS: 'Analyse des cuts...',
    EXPORTING_AUDIO: 'Exportation audio...',
    ADDING_BROLLS: 'Ajout des B-rolls sur la timeline...',
    ASSEMBLING: 'Lancement de l\'assemblage...'
};

// Error Messages
export const ERRORS = {
    INVALID_API_KEY: 'Clé API OpenAI invalide',
    NO_SEQUENCE: 'Aucune séquence active',
    NO_RUSH_BIN: 'Aucun rush dans [02_Rushs]',
    EMPTY_RUSH_BIN: 'Le chutier [02_Rushs] est vide',
    FILE_NOT_FOUND: 'Fichier introuvable',
    NETWORK_ERROR: 'Erreur de connexion',
    SEQUENCE_NOT_FOUND: 'Séquence introuvable',
    CLIP_NOT_FOUND: 'Clip introuvable'
};

// Success Messages
export const SUCCESS = {
    SEQUENCES_CREATED: 'Séquences créées avec succès !',
    FOLDERS_CREATED: 'Tous les chutiers necessaires ont été créés !',
    SUBTITLES_GENERATED: 'Sous-titres générés avec succès',
    TITLES_GENERATED: 'Titres générés pour',
    CUTS_COMPLETED: 'Découpes effectuées',
    BROLLS_ANALYZED: 'B-rolls analysés',
    EXECUTION_SUCCESS: 'Execution réussie'
};

// File Extensions
export const FILE_EXTENSIONS = {
    VIDEO: ['.mov', '.MOV', '.mp4', '.MP4'],
    AUDIO: ['.wav', '.WAV'],
    SUBTITLE: ['.srt', '.SRT'],
    JSON: ['.json']
};

// Ticks Conversion
export const TICKS = {
    PER_SECOND: 254016000000,
    PER_FRAME_30FPS: 254016000000 / 30
};

// Marker Colors
export const MARKER_COLORS = {
    BROLL: 5
};

// Component IDs (pour localStorage)
export const COMPONENTS = {
    OPTION_AUDIO: 'OptionAudio',
    OPTION_CUT: 'OptionCut',
    OPTION_ZOOM: 'OptionZoom',
    OPTION_FORMAT_PHONE: 'OptionformatPhone',
    OPTION_FORMAT_SQUARE: 'OptionformatCarre',
    OPTION_FORMAT_HORIZONTAL: 'OptionformatHorizontal',
    OPTION_BROLL: 'OptionBroll',
    SEQUENCE_SELECTION: 'sequenceSelection',
    FORMAT_SELECTION: 'formatSelection',
    TEMPLATE_SELECTION: 'TemplateSelection',
    TITLE_COLOR_PICKER: 'TitleColorPicker',
    TOKEN_OPENAI: 'TokenOpenAI',
    MARGE_CUTS: 'MargeCuts',
    LIMITE_CUTS: 'LimiteCuts',
    SUFFIX_AUDIO: 'SuffixAudio',
    NEW_VERSION: 'NewVersion',
    OPTION_SUBTITLES: 'OptionSubtitles',
    OPTION_TITLES: 'Optiontitles',
    OPTION_PRESET_STYLE: 'OptionPresetStyle'
};

// Authentication
export const AUTH = {
    POLLING_INTERVAL_MS: 2000,
    MAX_POLLING_ATTEMPTS: 150,
    BASE_URL: 'http://localhost/Productivity_php'
};

// Setup / Dependency Installation
export const SETUP = {
    PYTHON_CMD: 'python',
    PIP_MODULES: ['openai-whisper'],
    MESSAGES: {
        CHECKING: 'Vérification des dépendances...',
        PYTHON_CHECK: 'Vérification de Python...',
        PYTHON_MISSING: 'Python n\'est pas installé. Veuillez installer Python 3.8+ depuis python.org',
        PIP_CHECK: 'Vérification des modules Python...',
        INSTALLING_MODULE: (name) => `Installation de ${name}...`,
        INSTALL_SUCCESS: 'Toutes les dépendances sont installées !',
        INSTALL_FAILED: (name) => `Échec de l'installation de ${name}`,
        FFMPEG_CHECK: 'Vérification de FFmpeg...',
        FFMPEG_MISSING: 'FFmpeg non trouvé dans le dossier bin/',
        READY: 'Environnement prêt !'
    },
    STORAGE_KEY: 'setup_completed_v1'
};
