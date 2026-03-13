// AI Provider Selection
export const AI_PROVIDERS = {
    OPENAI: 'openai',
    CLAUDE: 'claude'
};

// API Configuration
export const OPENAI = {
    KEY_PREFIX: 'sk-',
    API_URL: 'https://api.openai.com/v1/responses',
    MODEL: 'gpt-4.1-mini',
    MODEL_NANO: 'gpt-4.1-nano',
    MODEL_REASONING: 'gpt-5.2',
    MODEL_GENERATION: 'gpt-4.1',
    MAX_TOKENS: 9000,
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
    AUDIO_SUBFOLDER: 'Audio',
    TITLES_SUBFOLDER: 'Titles',
    SUBTITLES_SUBFOLDER: 'Subtitles',
    BROLLS_SUBFOLDER: 'Brolls',
    CONTEXT_SUBFOLDER: 'Context',
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
    ASSEMBLING: 'Lancement de l\'assemblage...',
    ADDING_TITLE_HERE: 'Ajout du titre en cours...',
    ADDING_MOTION_HERE: 'Génération du motion design...',
    DETECTING_MOTION: 'Détection des positions motion design...',
    GENERATING_MOTIONS: 'Génération des motion designs...',
    RENDERING_MOTIONS: 'Rendu des animations...'
};

// Error Messages
export const ERRORS = {
    INVALID_API_KEY: 'Clé API OpenAI invalide',
    NO_SEQUENCE: 'Aucune séquence active',
    NO_SUBTITLES_AT_CURSOR: 'Aucun sous-titre trouvé à la position du curseur',
    NO_RUSH_BIN: 'Aucun rush dans [02_Rushs]',
    EMPTY_RUSH_BIN: 'Le chutier [02_Rushs] est vide',
    FILE_NOT_FOUND: 'Fichier introuvable',
    NETWORK_ERROR: 'Erreur de connexion',
    SEQUENCE_NOT_FOUND: 'Séquence introuvable',
    CLIP_NOT_FOUND: 'Clip introuvable',
    MOTION_GENERATION_FAILED: 'Erreur lors de la génération du motion design'
};

// Structured Error Catalog — type + message + action + match patterns
// IMPORTANT: Ordre du plus spécifique au plus générique (premier match retourné)
export const STRUCTURED_ERRORS = {
    // --- API OpenAI (spécifique avant générique) ---
    API_KEY_INVALID: {
        type: 'Clé API invalide',
        message: 'La clé API OpenAI n\'est pas valide',
        action: 'Va dans Paramètres et entre ta clé API OpenAI (format sk-...)',
        match: ['401', 'Unauthorized', 'invalid_api_key', 'API invalide']
    },
    API_QUOTA_EXCEEDED: {
        type: 'Quota API dépassé',
        message: 'Le quota de l\'API OpenAI est épuisé',
        action: 'Vérifie ton quota sur platform.openai.com et recharge si nécessaire',
        match: ['insufficient_quota', 'billing']
    },
    API_RATE_LIMIT: {
        type: 'Limite API',
        message: 'Trop de requêtes envoyées à OpenAI',
        action: 'Attends quelques secondes puis relance',
        match: ['429', 'rate limit', 'Rate limit', 'too many requests']
    },
    API_TIMEOUT: {
        type: 'Timeout API',
        message: 'L\'API OpenAI n\'a pas répondu dans le délai imparti',
        action: 'Vérifie ta connexion internet et réessaie',
        match: ['ETIMEDOUT', 'AbortError', 'timeout exceeded']
    },
    // --- JSX Premiere (spécifique avant générique) ---
    JSX_TIMEOUT: {
        type: 'Timeout Premiere',
        message: 'Premiere Pro n\'a pas répondu dans les 60 secondes',
        action: 'Vérifie que Premiere Pro n\'est pas occupé et réessaie',
        match: ['evalScript timeout', 'JSX timeout', 'Premiere timeout']
    },
    JSX_CLIP_NOT_FOUND: {
        type: 'Clip introuvable',
        message: 'Le clip demandé n\'existe pas dans la séquence',
        action: 'Vérifie que le clip est présent sur la timeline',
        match: ['Clip introuvable', 'clip introuvable']
    },
    JSX_SEQUENCE_NOT_FOUND: {
        type: 'Séquence introuvable',
        message: 'La séquence demandée n\'existe pas dans le projet Premiere',
        action: 'Vérifie que la séquence est bien ouverte dans Premiere Pro',
        match: ['Séquence introuvable', 'sequence introuvable', 'Aucune séquence']
    },
    // --- Transcription (spécifique — patterns précis) ---
    TRANSCRIPTION_AUDIO_NOT_FOUND: {
        type: 'Audio introuvable',
        message: 'Le fichier audio pour la transcription est introuvable',
        action: 'Vérifie que le fichier audio existe dans le dossier 07_Audio',
        match: ['audio introuvable', 'Audio introuvable', '.wav introuvable']
    },
    TRANSCRIPTION_WHISPER_ERROR: {
        type: 'Erreur Whisper',
        message: 'Le modèle de transcription a rencontré une erreur',
        action: 'Vérifie l\'installation de Whisper et réessaie',
        match: ['whisper error', 'Whisper error', 'whisper failed', 'openai-whisper']
    },
    TRANSCRIPTION_PYTHON_MISSING: {
        type: 'Python manquant',
        message: 'Python n\'est pas installé ou introuvable',
        action: 'Installe Python 3.8+ depuis python.org et redémarre l\'extension',
        match: ['python: command not found', 'python3: command not found', 'Python n\'est pas installé', 'python non trouvé', '\'python\' is not recognized']
    },
    // --- Réseau (du plus spécifique au plus générique) ---
    NETWORK_DNS: {
        type: 'Erreur DNS',
        message: 'Impossible de résoudre le nom de domaine',
        action: 'Vérifie ta connexion internet et tes paramètres DNS',
        match: ['getaddrinfo', 'ENOTFOUND']
    },
    NETWORK_SSL: {
        type: 'Erreur SSL',
        message: 'Erreur de certificat SSL',
        action: 'Vérifie que ta connexion n\'est pas bloquée par un proxy ou firewall',
        match: ['ERR_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'self signed certificate']
    },
    NETWORK_CONNECTION_LOST: {
        type: 'Connexion perdue',
        message: 'La connexion réseau a été interrompue',
        action: 'Vérifie ta connexion internet et réessaie',
        match: ['Failed to fetch', 'NetworkError', 'ERR_NETWORK', 'ECONNREFUSED', 'ECONNRESET']
    },
    // --- Fichiers (générique, en dernier) ---
    FILE_NOT_FOUND: {
        type: 'Fichier introuvable',
        message: 'Le fichier demandé n\'existe pas',
        action: 'Vérifie le chemin du fichier et réessaie',
        match: ['ENOENT', 'fichier introuvable', 'Fichier introuvable']
    }
};

// Success Messages
export const SUCCESS = {
    SEQUENCES_CREATED: 'Séquences créées avec succès !',
    FOLDERS_CREATED: 'Tous les chutiers necessaires ont été créés !',
    SUBTITLES_GENERATED: 'Sous-titres générés avec succès',
    TITLES_GENERATED: 'Titres générés pour',
    CUTS_COMPLETED: 'Découpes effectuées',
    BROLLS_ANALYZED: 'B-rolls analysés',
    EXECUTION_SUCCESS: 'Execution réussie',
    TITLE_ADDED_HERE: 'Titre ajouté à la position du curseur',
    MOTION_ADDED_HERE: 'Motion design ajouté sur la timeline !'
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

// Add Title Here Settings
export const ADD_TITLE = {
    SUBTITLE_WINDOW_SEC: 2,
    DEFAULT_TRACK_INDEX: 6,
    MAX_TRACK_SEARCH: 2
};

// Motion Design Settings
export const MOTION_DESIGN = {
    SUBTITLE_WINDOW_SEC: 2,
    DEFAULT_TRACK_INDEX: 7,
    MAX_TRACK_SEARCH: 5,
    DURATION_SEC: 3,
    DURATION_FRAMES: 90,
    FPS: 30,
    CANVAS_SIZE: 1000,
    DEFAULT_COLOR: '#ffffffff',
    // Batch settings
    STAGGER_INTERVAL_MS: 10000,
    BATCH_RETRY_ATTEMPTS: 3,
    GOAL_PERCENT: 0.40
};

// Selection Modes
export const SELECTION_MODES = {
    ACTIVE: 'active',
    ALL: 'all',
    CUSTOM: 'custom'
};

// Chemins relatifs vers les templates IA (fichiers .md editables)
export const TEMPLATE_PATHS = {
    SMART_CUT_SYSTEM: 'config/templates/smart-cut-system-prompt.md',
    SMART_CUT_MULTI_SYSTEM: 'config/templates/smart-cut-multi-system-prompt.md',
    SMART_CUT_VIRAL_SHORTS: 'config/templates/smart-cut-viral-shorts.md',
    SMART_CUT_PUNCHLINES: 'config/templates/smart-cut-punchlines.md',
    SMART_CUT_MOMENTS_CLES: 'config/templates/smart-cut-moments-cles.md',
    SMART_CUT_TUTORIELS: 'config/templates/smart-cut-tutoriels.md',
    BROLLS_SYSTEM: 'config/templates/brolls-system-prompt.md',
    CONTEXT_SYSTEM: 'config/templates/context-system-prompt.md',
    TITLES_SYSTEM: 'config/templates/titles-system-prompt.md',
    ADD_TITLE_HERE: 'config/templates/add-title-here-prompt.md',
    LOTTIE_CREATIVE_DIRECTOR: 'config/templates/lottie-creative-director.md',
    LOTTIE_STYLE_IMPACT: 'config/templates/lottie-style-impact.md',
    MOTION_DESIGN_SYSTEM: 'config/templates/motion-design-system-prompt.md',
    SMART_CUT_CUSTOM_CONTEXT: 'config/templates/smart-cut-custom-context.md'
};

// Smart Cut Configuration
export const SMART_CUT = {
    INTENTIONS: [
        {
            id: 'viral_shorts',
            label: 'Shorts viraux',
            description: 'Moments percutants et engageants',
            templatePath: TEMPLATE_PATHS.SMART_CUT_VIRAL_SHORTS
        },
        {
            id: 'punchlines',
            label: 'Punchlines',
            description: 'Phrases marquantes et citations',
            templatePath: TEMPLATE_PATHS.SMART_CUT_PUNCHLINES
        },
        {
            id: 'key_moments',
            label: 'Moments clés',
            description: 'Temps forts et révélations',
            templatePath: TEMPLATE_PATHS.SMART_CUT_MOMENTS_CLES
        },
        {
            id: 'tutorials',
            label: 'Tutoriels',
            description: 'Explications et démonstrations',
            templatePath: TEMPLATE_PATHS.SMART_CUT_TUTORIELS
        }
    ],
    PHASES: {
        CONFIG: 'config',
        STREAMING: 'streaming',
        REVIEW: 'review'
    },
    LOCAL_STORAGE_KEY: 'smartCutState'
};

// Smart Cut Messages
export const SMART_CUT_MESSAGES = {
    PHASE_CONFIG_TITLE: 'Smart Cut',
    PHASE_CONFIG_SUBTITLE: 'Choisissez une intention d\'analyse',
    RESULTS_PLACEHOLDER: 'Les résultats apparaîtront ici',
    ADVANCED_OPTIONS: 'Options avancées',
    LAUNCH_BUTTON: 'Lancer',
    LAUNCH_NOT_READY: 'Smart Cut sera disponible dans la prochaine version',
    NO_INTENTION_SELECTED: 'Veuillez sélectionner une intention',
    STREAMING_COUNTER: '{count} segments identifies...',
    STREAMING_STOP: 'Arreter',
    STREAMING_ANALYZING: 'Analyse en cours — {intention}',
    REVIEW_SUMMARY: '{count} segments identifies en {minutes} min',
    REVIEW_VALIDATE: 'Valider ({count} shorts)',
    REVIEW_CANCEL_ALL: 'Annuler tout',
    REVIEW_RELAUNCH: 'Relancer',
    CREATING_PROGRESS: 'Creation {current}/{total}...',
    CREATING_PREPARING: 'Preparation de la creation...',
    CREATING_SUCCESS: '{count} shorts crees avec succes',
    CREATING_ERROR: 'Echec creation {name}: {error}',
    CREATING_ROLLBACK: 'Annulation des creations partielles...',
    UNDO_SUCCESS: '{count} shorts annules',
    UNDO_ERROR: 'Echec de l\'annulation : {error}',
    UNDO_BANNER_MESSAGE: '{count} shorts crees — ',
    ERROR_NO_TRANSCRIPTION: 'Aucune transcription trouvee pour "{name}". Lance une transcription depuis l\'onglet Montage.',
    ERROR_NO_SEQUENCE: 'Aucune sequence active dans Premiere. Ouvre une sequence d\'abord.',
    ERROR_API_INTERRUPTED: 'Connexion API interrompue. Les segments recus sont conserves.',
    ERROR_NO_API_KEY: 'Configure ta cle API OpenAI dans les Options avancees',
    AUTO_TRANSCRIPTION_START: 'Transcription automatique en cours (Whisper medium)...',
    AUTO_TRANSCRIPTION_DONE: 'Transcription terminee, lancement de l\'analyse...'
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
    OPTION_PRESET_STYLE: 'OptionPresetStyle',
    SUBTITLE_CHAR_LIMIT: 'SubtitleCharLimit',
    SMART_CUT_LAUNCH: 'SmartCutLaunch',
    UNDO_BANNER: 'UndoBanner',
    UNDO_BUTTON: 'UndoButton',
    ADD_TITLE_HERE: 'AddTitleHere',
    OPTION_MOTION: 'OptionMotion',
    MOTION_COLOR_PICKER: 'MotionColorPicker',
    AI_PROVIDER: 'AIProvider'
};

// Subtitle Settings
export const SUBTITLES = {
    DEFAULT_CHAR_LIMIT: 19,
    MIN_CHAR_LIMIT: 10,
    MAX_CHAR_LIMIT: 80
};

// Authentication
export const AUTH = {
    POLLING_INTERVAL_MS: 2000,
    MAX_POLLING_ATTEMPTS: 150,
    BASE_URL: 'http://localhost/Productivity_php'
};

// Propriétés MOGRT — Éditeur multi-clips
export const PROPRIETE = {
    REFRESH_TIMEOUT_MS: 15000,
    SAVE_TIMEOUT_MS: 30000,
    MIXED_VALUE_PLACEHOLDER: '—',
    MAX_CLIPS_WARNING: 20,
    DOM: {
        CONTAINER: 'properties-container',
        SAVE_BTN: 'propriete-save',
        UNDO_BTN: 'propriete-undo',
        REFRESH_BTN: 'propriete-refresh',
        STATUS: 'propriete-status'
    },
    TYPES: {
        COLOR: 'color',
        TEXT: 'text',
        NUMBER: 'number',
        ARRAY: 'array',
        BOOLEAN: 'boolean',
        GROUP: 'group',
        POSITION: 'position',
        UNKNOWN: 'unknown'
    }
};

// Setup / Dependency Installation
export const SETUP = {
    PYTHON_CMD: 'python',
    PIP_MODULES: ['openai-whisper'],
    TORCH_CUDA_INDEX: 'https://download.pytorch.org/whl/cu121',
    MESSAGES: {
        CHECKING: 'Vérification des dépendances...',
        PYTHON_CHECK: 'Vérification de Python...',
        PYTHON_MISSING: 'Python 3.x n\'est pas installé. Installe Python depuis python.org pour activer la transcription.',
        PIP_CHECK: 'Vérification des modules Python...',
        WHISPER_MISSING: 'Le module Whisper n\'est pas installé. Exécute `pip install openai-whisper` dans un terminal.',
        INSTALLING_MODULE: (name) => `Installation de ${name}...`,
        INSTALL_SUCCESS: 'Toutes les dépendances sont installées !',
        INSTALL_FAILED: (name) => `Échec de l'installation de ${name}`,
        FFMPEG_CHECK: 'Vérification de FFmpeg...',
        FFMPEG_MISSING: 'FFmpeg n\'est pas trouvé dans le dossier bin/. Vérifie que ffmpeg.exe est présent dans le dossier bin/ de l\'extension.',
        CUDA_CHECK: 'Vérification de CUDA (GPU)...',
        CUDA_INSTALLING: 'Installation de PyTorch CUDA (GPU)... Cela peut prendre quelques minutes.',
        CUDA_INSTALL_OK: 'PyTorch CUDA installé avec succès !',
        CUDA_INSTALL_FAILED: 'Échec de l\'installation de PyTorch CUDA. Whisper fonctionnera en mode CPU (lent).',
        READY: 'Environnement prêt !'
    },
    STORAGE_KEY: 'setup_completed_v1',
    RESULTS_KEY: 'setup_deps_results'
};
