# Inventaire des composants - Productivity Extension

> Documentation générée le 2026-02-24 | Scan exhaustif

---

## 1. Pages HTML (UI)

| Page | Fichier | Rôle | Étape workflow |
|------|---------|------|----------------|
| **Authentification** | `src/pages/auth.html` | Gateway OTP, vérification session | Pré-workflow |
| **Création** | `src/pages/index.html` | Création séquences, structure projet | Step 1 |
| **Montage** | `src/pages/montage.html` | Montage IA (cuts, titres, sous-titres, B-rolls) | Step 2 |
| **Exportation** | `src/pages/export.html` | Export multi-format | Step 3 |

### Navigation entre pages
```
auth.html → (verified=true) → index.html → montage.html → export.html
```
Navigation via header avec indicateur d'étape active (bordure bleue `#0D66D0`).

---

## 2. Composants JavaScript

### 2.1 Component (`src/scripts/components/Component.js`)

**Type :** Classe de base pour éléments de formulaire
**Pattern :** Persistance automatique localStorage

| Méthode | Description |
|---------|-------------|
| `constructor(id, defaultValue)` | Init avec DOM id, charge depuis Storage |
| `getValue()` | Retourne la valeur courante |
| `setValue(value)` | Met à jour valeur, Storage et DOM |
| `getElement()` | Retourne l'élément DOM |
| `verifyCollapsible()` | Toggle des sections `.{id}Collaps` |
| `on(event, callback)` | Ajouter écouteur d'événement |
| `off(event, callback)` | Retirer écouteur d'événement |

**Instances dans main.js :**

| ID | Type | Valeur par défaut | Rôle |
|----|------|-------------------|------|
| `OptionAudio` | checkbox | `false` | Activer création audio |
| `OptionCut` | checkbox | `false` | Activer auto-cuts |
| `OptionZoom` | checkbox | `false` | Activer effets zoom |
| `OptionSubtitles` | checkbox | `false` | Activer sous-titres |
| `Optiontitles` | checkbox | `false` | Activer titres |
| `OptionBroll` | checkbox | `false` | Activer B-rolls |
| `OptionformatPhone` | checkbox | `false` | Export 9:16 |
| `OptionformatCarre` | checkbox | `false` | Export 1:1 |
| `OptionformatHorizontal` | checkbox | `false` | Export 16:9 |
| `sequenceSelection` | select | `selectedSequence` | Séquence cible |
| `formatSelection` | select | `selectedFormatPhone` | Format création |
| `TemplateSelection` | select | `1` | Template titre |
| `OptionPresetStyle` | text | `""` | Chemin .prtextstyle |
| `TokenOpenAI` | text | `""` | Clé API OpenAI |
| `SuffixAudio` | text | `""` | Suffixe fichiers audio |
| `MargeCuts` | number | `""` | Marge silence (secondes) |
| `LimiteCuts` | number | `""` | Seuil silence (dB) |

---

### 2.2 ColorPicker (`src/scripts/components/ColorPicker.js`)

**Type :** Extends Component
**Dépendance externe :** Coloris (CDN)

| Méthode | Description |
|---------|-------------|
| `initialize()` | Setup Coloris + listeners |
| `initializeColoris()` | Config: theme dark, alpha, hex format |
| `getSwatches()` | Palette prédéfinie + historique (max 10) |
| `addToHistory()` | Ajouter couleur récente |
| `updatePreviewColor()` | Mettre à jour aperçu visuel |

**Instance :** `TitleColorPicker` — valeur par défaut `#ff4949ff` (rouge)

---

### 2.3 NotificationSystem (`src/scripts/components/NotificationSystem.js`)

**Type :** Singleton, notifications toast
**Conteneur DOM :** `#notification-container` (fixe, haut-droit)

| Méthode | Description |
|---------|-------------|
| `show(message, type, duration)` | Afficher notification |
| `success(message, duration)` | Notification verte (✓) |
| `warning(message, duration)` | Notification ambre (!) |
| `error(message, duration)` | Notification rouge (✕) |
| `hide(id)` | Masquer notification |
| `hideAll()` | Masquer toutes |

**Types visuels :**

| Type | Icône | Couleur | Durée par défaut |
|------|-------|---------|-----------------|
| success | ✓ | `#10b981` | 6000ms |
| warning | ! | `#f59e0b` | 6000ms |
| error | ✕ | `#ef4444` | 6000ms |

**Animations :** Slide-in depuis la droite (cubic-bezier), progress bar synchronisée.

---

### 2.4 LoadingScreen (`src/scripts/components/LoadingScreen.js`)

**Type :** Singleton, overlay modal plein écran
**Conteneur DOM :** `#loading-screen` (fixe, z-index 999999)

| Méthode | Description |
|---------|-------------|
| `show(message)` | Afficher avec message |
| `hide()` | Masquer overlay |
| `setMessage(message)` | Mettre à jour le texte |
| `setProgress(percent, detail)` | Afficher barre de progression |
| `hideProgress()` | Masquer la barre |
| `isVisible()` | État de visibilité |

**Éléments visuels :** Spinner animé (rotation 360° 0.9s), barre de progression dégradée (#4a9eff → #6cb8ff).

---

### 2.5 Collapsible (`src/scripts/components/collaps.js`)

**Type :** IIFE, délégation d'événements
**Pattern :** Click sur `.collapsible` → toggle `.content` adjacent

**Comportement :**
- Clic sur bouton `.collapsible` → toggle `display: block/none` du contenu
- Toggle classe `.active` sur le bouton (rotation flèche 90°)
- Initialisation : tous les contenus cachés par défaut

---

### 2.6 Loading (Legacy) (`src/scripts/components/loading.js`)

**Type :** IIFE, overlay simplifié sans barre de progression
**API globale :** `window.ProductivityLoading`

| Méthode | Description |
|---------|-------------|
| `show(message)` | Afficher overlay |
| `hide()` | Masquer overlay |
| `setMessage(message)` | Mettre à jour texte |
| `isVisible()` | État de visibilité |

**Alias globaux :** `showLoadingScreen`, `setLoadingMessage`, `hideLoadingScreen`

---

## 3. Services (couche métier)

### 3.1 SubtitlesService (`src/scripts/services/subtitles.js`)

| Méthode | Description |
|---------|-------------|
| `generateForFiles(files, goal)` | Orchestrer transcription pour N fichiers |
| `checkSubtitleExists(file, goal)` | Vérifier si résultat existe déjà |
| `transcribeFile(file, goal)` | Exécuter transcription Python |

**Goals :** `BROLL` → `fileName.json`, `SRT` → `fileNameSRT.json`

### 3.2 TitlesService (`src/scripts/services/titles.js`)

| Méthode | Description |
|---------|-------------|
| `generateForFiles(files, onProgress)` | Générer titres IA pour N fichiers |

**Progression dual-track :** Réelle (streaming chars) + simulée (intervalle 1s, max 20%).

### 3.3 BrollsService (`src/scripts/services/brolls.js`)

| Méthode | Description |
|---------|-------------|
| `createForFiles(files)` | Traiter B-rolls pour N fichiers |
| `createForFile(file)` | Analyser + markers + preview HTML |
| `analyzeBrollsBatch(subtitles)` | Analyse IA par lots de 50 |
| `generateHtmlPreview(data, file)` | Générer table HTML avec liens Envato |

### 3.4 SetupManager (`src/scripts/services/setup.js`)

| Méthode | Description |
|---------|-------------|
| `run()` | Vérifier et installer dépendances |
| `_checkPython()` | Vérifier Python 3.x |
| `_checkPipModule(module)` | Vérifier module pip |
| `_installModule(module)` | Installer module pip |
| `_checkFFmpeg()` | Vérifier FFmpeg dans bin/ |

**Dépendances requises :** Python 3.x, openai-whisper (pip), FFmpeg

---

## 4. Utilitaires

### 4.1 PremiereAsync (`src/scripts/utils/premiereAsync.js`)

Bridge Promise pour `CSInterface.evalScript()`. Timeout par défaut : 60 secondes. ~25 méthodes couvrant projet, séquences, fichiers, audio, cuts, sous-titres, titres, B-rolls, setup.

### 4.2 ErrorHandler (`src/scripts/utils/errorHandler.js`)

Gestion centralisée des erreurs. Méthodes statiques : `handle()`, `wrap()`, `validateApiKey()`, `getDefaultMessage()`. Messages d'erreur en français.

### 4.3 Storage (`src/scripts/utils/storage.js`)

Wrapper localStorage avec coercion de types. Méthodes statiques : `get()`, `set()`, `remove()`, `clear()`, `has()`, `keys()`, `getMultiple()`, `setMultiple()`.

### 4.4 Helpers (`src/scripts/utils/helpers.js`)

Fonctions utilitaires : conversion temps (ticks ↔ secondes), manipulation fichiers, parsing JSON sécurisé, normalisation, debounce/throttle, génération d'ID.

### 4.5 Constants (`src/scripts/utils/constants.js`)

Configuration centralisée : OPENAI, NOTIFICATIONS, CUTS, PATHS, SEQUENCE, MESSAGES, ERRORS, SUCCESS, COMPONENTS, AUTH, SETUP.

### 4.6 Verify (`src/scripts/utils/verify.js`)

Système d'authentification OTP : `generateCode()`, `startOtpFlow()`, `pollForCode()`, `rotateLongpass()`.

---

## 5. Design System (CSS)

### Palette de couleurs

| Couleur | Hex | Usage |
|---------|-----|-------|
| Background | `#262626` | Fond principal |
| Panel | `#1E1E1E` | Headers, sections collapsibles |
| Primary | `#0D66D0` | Boutons bleus, étape active |
| Danger | `#BD0000` | Boutons rouges, erreurs |
| Text | `#FFFFFF` | Texte principal |
| Muted | `rgba(255,255,255,0.70)` | Descriptions |
| Success | `#10b981` | Notifications succès |
| Warning | `#f59e0b` | Notifications avertissement |
| Error | `#ef4444` | Notifications erreur |

### Typographie

| Élément | Police | Taille | Poids |
|---------|--------|--------|-------|
| h1 | Gotham Bold | 26px | 700 |
| h2 | Gotham Bold | 22px | 700 |
| h3 | Gotham Bold | 16px | 700 (souligné) |
| body | Gotham Regular | 16px | 400 |
| .desc | Gotham Regular | 12px | 500 |

### Boutons

| Classe | Couleur | Usage |
|--------|---------|-------|
| `.button-blue` | `#0D66D0` | Actions principales |
| `.button-red` | `#BD0000` | Actions destructives |
| `.button-black` | `#000000` | Actions secondaires |
| `.buttonDesactivate` | `#6B6B6B` | Désactivé |

### Dimensions du panneau

- Largeur : 850px
- Hauteur : 500px
- Padding main : 60px
- Gap colonnes : 50px
- Layout : 2 colonnes (50%/50%)

---

## 6. Ressources statiques

### Polices
- `assets/fonts/GothamNarrow-Medium.otf` → "Gotham Regular"
- `assets/fonts/GothamNarrow-Black.otf` → "Gotham Bold"
- `assets/fonts/GOTHAM-BOLD.TTF` → Alternative
- `assets/fonts/GOTHAM-MEDIUM.TTF` → Alternative

### Images
- `assets/images/arrow.png` — Flèche collapsible
- `assets/images/cross.png` — Checkmark (croix)
- `assets/images/banner-video.png` — Placeholder B-roll

### Templates MOGRT
- `assets/templates/titles/TITRE-1-H.mogrt`
- `assets/templates/titles/TITRE-2-H.mogrt`
- `assets/templates/titles/TITRE-3-H.mogrt`

### Previews vidéo
- `assets/templates/titles/previews/template-1.mp4`
- `assets/templates/titles/previews/template-2.mp4`
- `assets/templates/titles/previews/template-3.mp4`

### Binaires
- `bin/ffmpeg.exe` — FFmpeg pour analyse audio
