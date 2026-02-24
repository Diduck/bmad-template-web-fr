# Structure du Projet Productivity

Documentation détaillée de l'architecture et de l'organisation du projet.

## 📐 Architecture Globale

L'extension Productivity suit une architecture modulaire séparant clairement :
- Les ressources statiques (assets)
- Le code source (src)
- Les scripts externes (scripts)
- La configuration (config)

## 🗂️ Arborescence Complète

```
Productivity/
│
├── 📁 assets/                          # Ressources statiques
│   ├── fonts/                          # Polices personnalisées
│   │   ├── GOTHAM-BOLD.TTF
│   │   ├── GOTHAM-MEDIUM.TTF
│   │   ├── GothamNarrow-Black.otf
│   │   └── GothamNarrow-Medium.otf
│   │
│   ├── images/                         # Images et icônes
│   │   ├── arrow.png                   # Icône flèche (boutons collapsibles)
│   │   ├── banner-video.png            # Bannière vidéo B-rolls
│   │   └── cross.png                   # Icône croix (suppression)
│   │
│   └── templates/                      # Templates de titres
│       └── titles/
│           ├── previews/               # Vidéos de prévisualisation
│           │   ├── template-1.mp4
│           │   ├── template-2.mp4
│           │   └── template-3.mp4
│           ├── TITRE-1-H.mogrt        # Template titre horizontal 1
│           ├── TITRE-2-H.mogrt        # Template titre horizontal 2
│           └── TITRE-3-H.mogrt        # Template titre horizontal 3
│
├── 📁 bin/                             # Exécutables externes (NON VERSIONNÉS)
│   └── ffmpeg.exe                      # FFmpeg pour traitement audio/vidéo
│
├── 📁 config/                          # Configuration Adobe CEP
│   ├── CSXS/
│   │   └── manifest.xml                # Manifeste de l'extension CEP
│   └── .debug                          # Configuration debug (port 8099)
│
├── 📁 docs/                            # Documentation
│   ├── INSTALLATION.md                 # Guide d'installation
│   ├── STRUCTURE.md                    # Ce fichier
│   └── DEVELOPMENT.md                  # Guide de développement
│
├── 📁 scripts/                         # Scripts externes
│   └── transcription/                  # Scripts de transcription Whisper
│       ├── transcribe.py               # Script Python Whisper
│       ├── run_transcription.bat       # Lanceur batch Windows
│       └── run_transcription.vbs       # Lanceur VBScript (silencieux)
│
└── 📁 src/                             # Code source principal
    │
    ├── jsx/                            # ExtendScript (Adobe)
    │   └── Premiere.jsx                # Script principal Premiere Pro
    │
    ├── pages/                          # Pages HTML de l'interface
    │   ├── index.html                  # Étape 1 : Création
    │   ├── montage.html                # Étape 2 : Montage
    │   ├── export.html                 # Étape 3 : Exportation
    │   └── auth.html                   # Page d'authentification
    │
    ├── scripts/                        # JavaScript client
    │   ├── vendors/                    # Librairies tierces
    │   │   ├── CSInterface.js          # Interface CEP Adobe
    │   │   └── require.js              # RequireJS (si utilisé)
    │   │
    │   ├── components/                 # Composants réutilisables
    │   │   ├── collaps.js              # Gestion des panneaux collapsibles
    │   │   └── loading.js              # Écran de chargement
    │   │
    │   ├── utils/                      # Utilitaires
    │   │   └── verify.js               # Vérification authentification
    │   │
    │   └── main.js                     # Script principal de l'application
    │
    └── styles/                         # Feuilles de style CSS
        ├── base/                       # Styles de base
        │   ├── variables.css           # Variables CSS (à créer)
        │   ├── reset.css               # Reset CSS (à créer)
        │   └── typography.css          # Typographie (à créer)
        │
        ├── components/                 # Styles des composants
        │   ├── broll.css               # Composant B-rolls
        │   ├── loader.css              # Loader/spinner
        │   ├── notification.css        # Notifications
        │   └── wave.css                # Visualisation d'onde audio
        │
        ├── pages/                      # Styles spécifiques aux pages
        │   └── montage.css             # Page montage
        │
        └── main.css                    # Import principal
```

## 📦 Détail des Modules

### Assets (`assets/`)

Ressources statiques utilisées par l'interface :
- **Fonts** : Polices Gotham pour l'UI
- **Images** : Icônes et visuels de l'interface
- **Templates** : Fichiers Motion Graphics (.mogrt) pour les titres

**Note** : Les fichiers lourds (previews MP4) peuvent être exclus du versioning Git.

### Bin (`bin/`)

Contient les exécutables externes nécessaires au fonctionnement :
- `ffmpeg.exe` (~128 MB) : Utilisé pour le traitement audio/vidéo

**Important** : Ce dossier doit être exclu du versioning Git (`.gitignore`).

### Config (`config/`)

Configuration de l'extension CEP Adobe :
- `manifest.xml` : Définit l'extension, ses permissions, ses chemins
- `.debug` : Active le mode debug sur le port 8099

### Scripts (`scripts/`)

Scripts externes (hors code source principal) :
- **Transcription** : Scripts Python utilisant Whisper pour la transcription audio

### Src (`src/`)

Code source de l'extension :

#### JSX (`src/jsx/`)
Scripts ExtendScript exécutés côté Premiere Pro. Communique avec l'interface via CSInterface.

#### Pages (`src/pages/`)
Interface utilisateur HTML organisée en étapes :
1. **index.html** : Création des séquences
2. **montage.html** : Montage et effets
3. **export.html** : Exportation multi-format
4. **auth.html** : Authentification utilisateur

#### Scripts (`src/scripts/`)
Code JavaScript organisé en :
- **vendors/** : Librairies externes (CSInterface, RequireJS)
- **components/** : Composants réutilisables UI
- **utils/** : Fonctions utilitaires
- **main.js** : Point d'entrée principal

#### Styles (`src/styles/`)
CSS organisé selon la méthodologie :
- **base/** : Fondations (variables, reset, typo)
- **components/** : Styles des composants
- **pages/** : Styles spécifiques aux pages
- **main.css** : Import principal

## 🔗 Flux de Données

```
[Premiere Pro] ←→ [JSX/Premiere.jsx] ←→ [CSInterface] ←→ [main.js] ←→ [UI HTML/CSS]
                                                              ↓
                                                       [Python Scripts]
                                                              ↓
                                                         [FFmpeg]
```

1. L'utilisateur interagit avec l'interface HTML
2. `main.js` traite les actions et communique avec `Premiere.jsx` via CSInterface
3. `Premiere.jsx` exécute les actions dans Premiere Pro
4. Des scripts externes (Python/FFmpeg) peuvent être invoqués pour des traitements spécifiques

## 🎨 Conventions de Nommage

- **Dossiers** : snake_case ou kebab-case (minuscules)
- **Fichiers HTML** : kebab-case (ex: `montage.html`)
- **Fichiers JS** : camelCase (ex: `main.js`, `collaps.js`)
- **Fichiers CSS** : kebab-case (ex: `notification.css`)
- **Assets** : kebab-case (ex: `banner-video.png`)

## 🚀 Points d'Entrée

1. **Extension CEP** : `config/CSXS/manifest.xml`
   - Pointe vers `src/pages/index.html`
   - Charge `src/jsx/Premiere.jsx`

2. **Interface Web** : `src/pages/index.html`
   - Charge `src/scripts/main.js`
   - Importe `src/styles/main.css`

## 📝 Notes Importantes

- Les chemins dans le code sont **relatifs** à la page courante
- Depuis `src/pages/*.html` vers `src/scripts/` : `../scripts/`
- Depuis `src/pages/*.html` vers `assets/` : `../../assets/`
- Le manifest utilise des chemins relatifs à la racine du projet
