# Architecture - Productivity Extension

> Documentation générée le 2026-02-24 | Scan exhaustif

---

## 1. Résumé exécutif

Productivity est une extension Adobe CEP pour Premiere Pro architecturée en **4 couches** : UI (HTML/CSS), Application (JavaScript ES6), Bridge (PremiereAsync) et Scripting hôte (ExtendScript/JSX). L'extension intègre 3 services externes (OpenAI, Python/Whisper, FFmpeg) pour automatiser la post-production vidéo.

---

## 2. Pattern architectural

**Type :** Extension CEP multi-couches avec bridge asynchrone

```
┌─────────────────────────────────────────────────────┐
│              COUCHE UI (HTML/CSS)                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │auth.html │→│index.html│→│montage   │→│export  │ │
│  │  (OTP)   │ │ (Step 1) │ │  (Step 2)│ │(Step 3)│ │
│  └──────────┘ └──────────┘ └──────────┘ └────────┘ │
│  Components: NotificationSystem, LoadingScreen,     │
│  ColorPicker, Component, Collapsible                │
└────────────────────────┬────────────────────────────┘
                         │ DOM Events
┌────────────────────────▼────────────────────────────┐
│           COUCHE APPLICATION (JavaScript ES6)        │
│  ┌──────────────────────────────────────────────┐   │
│  │ main.js (orchestrateur)                       │   │
│  │  ├── handleCreateWorkflow()                   │   │
│  │  ├── handleStep1Execute()                     │   │
│  │  └── handleStep2Execute() ← 7 phases         │   │
│  └──────────────────────────────────────────────┘   │
│  ┌─────────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │SubtitlesSvc │ │TitlesSvc │ │   BrollsSvc      │ │
│  │(transcribe) │ │(AI gen)  │ │(AI analyze+mark) │ │
│  └─────────────┘ └──────────┘ └──────────────────┘ │
│  ┌──────────┐ ┌────────────┐ ┌──────────────────┐  │
│  │OpenAI    │ │SetupManager│ │   ErrorHandler   │  │
│  │Client    │ │(deps check)│ │   (centralisé)   │  │
│  └──────────┘ └────────────┘ └──────────────────┘  │
└────────────────────────┬────────────────────────────┘
                         │ CSInterface.evalScript()
┌────────────────────────▼────────────────────────────┐
│           BRIDGE (PremiereAsync)                     │
│  Promise wrappers + timeout 60s + escape chars      │
│  ~25 méthodes couvrant toutes les opérations        │
└────────────────────────┬────────────────────────────┘
                         │ ExtendScript API
┌────────────────────────▼────────────────────────────┐
│           COUCHE SCRIPTING HÔTE (Premiere.jsx)       │
│  ┌─────────────────────────────────────────────┐    │
│  │ API Premiere Pro directe                     │    │
│  │  ├── Séquences, clips, pistes, effets       │    │
│  │  ├── Bins (navigation récursive)            │    │
│  │  ├── Import/export (MOGRT, SRT, WAV)        │    │
│  │  └── Events (CSXSEvent → JS)                │    │
│  └─────────────────────────────────────────────┘    │
│  ┌───────────┐ ┌───────────┐ ┌─────────────────┐   │
│  │ AME       │ │ FFmpeg    │ │ Python/Whisper  │   │
│  │ (export)  │ │ (analyse) │ │ (transcription) │   │
│  └───────────┘ └───────────┘ └─────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## 3. Stack technologique détaillée

| Couche | Technologie | Version/Détails | Justification |
|--------|-------------|----------------|---------------|
| UI | HTML5 | 4 pages | Panneau CEP standard |
| UI | CSS3 | Design system custom | Thème sombre Adobe |
| UI | Coloris | CDN | Sélecteur couleur avancé |
| UI | Axios | CDN | Client HTTP (futur usage) |
| App | JavaScript ES6 | Vanilla, modules | Pas de framework pour légèreté |
| App | CSInterface.js | CEP SDK v6.0 | Communication avec Premiere |
| Bridge | PremiereAsync | Custom | Wrappers Promise + timeout |
| Hôte | ExtendScript (JSX) | ES3 étendu | API native Premiere Pro |
| IA | OpenAI API | GPT-5-mini | Titres + B-rolls |
| IA | Whisper | via Python | Transcription audio |
| Audio | FFmpeg | Embarqué (bin/) | Analyse RMS silence |
| Export | Adobe Media Encoder | Via ExtendScript | Export WAV/vidéo |

---

## 4. Flux de données principal (Step 2)

```
Utilisateur clique "Exécuter" (Step 2)
│
▼ handleStep2Execute()
│
├── Phase 1: Génération des transcriptions
│   ├── SubtitlesService.generateForFiles()
│   │   ├── PremiereAsync → exportSequenceWavSilently() → AME → WAV
│   │   └── PremiereAsync → runPythonTranscription() → Python/Whisper
│   │       └── Sortie: {nom}.json (BROLL) ou {nom}SRT.json (SRT)
│   │
│   └── Si titres: TitlesService.generateForFiles()
│       ├── Lecture SRT.json
│       └── OpenAIClient.generateTitlesBatch() (lots de 100, streaming)
│           └── Sortie: {nom}_titles.json
│
├── Phase 2: Analyse cuts (optionnel)
│   ├── PremiereAsync → AnalyseCut() → FFmpeg (RMS)
│   └── Affichage forme d'onde (wavContent)
│
├── Phase 3: Exécution cuts
│   └── PremiereAsync → CutSecond() → QE (setInPoint/setOutPoint/extract)
│
├── Phase 4: Import sous-titres
│   └── PremiereAsync → CreateSTR() → Import SRT + caption track
│
├── Phase 5: Import titres
│   └── PremiereAsync → CreateTitles() → Import MOGRT + config texte/couleur
│
├── Phase 6: Création B-rolls
│   ├── BrollsService → OpenAI (lots de 50)
│   ├── Génération preview HTML (liens Envato)
│   └── PremiereAsync → createMarkers() → Marqueurs timeline
│
└── Phase 7: Zoom (actuellement désactivé)
```

---

## 5. Gestion de l'état

### localStorage (persistance client)

L'extension utilise `Storage` (wrapper localStorage) pour persister :

| Catégorie | Clés | But |
|-----------|------|-----|
| **Options workflow** | OptionAudio, OptionCut, OptionZoom, OptionSubtitles, Optiontitles, OptionBroll | Checkboxes activées |
| **Options export** | OptionformatPhone, OptionformatCarre, OptionformatHorizontal | Formats d'export |
| **Configuration** | TokenOpenAI, SuffixAudio, MargeCuts, LimiteCuts | Paramètres utilisateur |
| **UI** | sequenceSelection, formatSelection, TemplateSelection, OptionPresetStyle | Sélections dropdown |
| **Couleur** | TitleColorPicker, colorPickerHistory | Couleur titre + historique |
| **Auth** | longpass | Token de session |
| **Setup** | setup_completed_v1 | Flag dépendances vérifiées |

### Pattern Component

Chaque `Component` :
1. Se charge depuis `Storage.get(id, defaultValue)` à la construction
2. Se synchronise avec le DOM (`input.value` ou `checkbox.checked`)
3. Se sauvegarde via `Storage.set(id, value)` à chaque `setValue()`
4. Toggle les sections collapsibles associées si c'est une Option

---

## 6. Système d'événements

### Communication bidirectionnelle CEP

```
JavaScript → ExtendScript:
  CSInterface.evalScript('functionJSX("param")') → Résultat string
  Wrappé par PremiereAsync en Promises avec timeout

ExtendScript → JavaScript:
  CSXSEvent dispatched via PlugPlugExternalObject
  ├── NOTIF: {message, type} → NotificationSystem
  ├── MODEL_DOWNLOAD_PROGRESS: {progress} → LoadingScreen
  └── STEP2_PROGRESS: {phase, file, progress} → UI update

JavaScript → OpenAI:
  fetch() avec streaming SSE
  ├── Requête: POST /v1/responses (Bearer auth)
  ├── Streaming: data: events → delta accumulation
  └── Réponse: JSON array parsé et normalisé
```

---

## 7. Sécurité

### Content Security Policy (CSP)

```
default-src 'self';
script-src 'self';
connect-src 'self' https://api.openai.com http://localhost;
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
frame-src http://localhost;
```

### Mesures de sécurité

| Mesure | Détail |
|--------|--------|
| **Scripts** | Pas de `unsafe-eval`, pas de scripts inline |
| **Connexions** | Whitelist stricte (OpenAI + localhost) |
| **CEF** | `--disable-web-security` supprimé |
| **API Key** | Validation format (préfixe sk-) |
| **Entrées** | Sanitisation via `sanitizeInput()` |
| **Erreurs** | Messages sans données sensibles |

### Vulnérabilités résiduelles connues

- API key stockée en clair dans localStorage (recommandation : backend proxy)
- `unsafe-inline` toujours présent pour les styles CSS
- Pas de chiffrement des données persistées

---

## 8. Gestion des erreurs

### Architecture ErrorHandler

```
Erreur capturée
    │
    ▼
ErrorHandler.handle(error, context, userMessage)
    ├── console.error(context, error)
    ├── getDefaultMessage(error) → Message français
    ├── NotificationSystem.error(message)
    └── reportToMonitoring() (stub)
```

### Stratégie par couche

| Couche | Stratégie |
|--------|-----------|
| **Services** | try/catch par fichier, continue sur erreur |
| **OpenAI** | 3 retries, backoff exponentiel |
| **PremiereAsync** | Timeout 60s, rejet sur erreur |
| **ExtendScript** | notif() événement vers JS |
| **UI** | Notifications toast (6s auto-hide) |

---

## 9. Patterns de performance

### Traitement par lots (batching)

| Service | Taille lot | Délai inter-lots |
|---------|-----------|-----------------|
| Titres (OpenAI) | 100 éléments | 1000ms |
| B-rolls (OpenAI) | 50 éléments | 1000ms |

### Progression dual-track (TitlesService)

```
Progression réelle: Comptage caractères streaming (CHARS_PER_SUBTITLE = 40)
Progression simulée: +1 toutes les 1000ms (max 20% du lot)
Throttle: Mise à jour UI max toutes les 80ms
```

### Optimisations DOM

- `DocumentFragment` pour construction de listes
- Debounce/throttle pour événements fréquents
- Chargement lazy des éléments LoadingScreen

---

## 10. Dépendances externes

### Requises à l'installation

| Dépendance | Vérification | Installation |
|-----------|-------------|-------------|
| **Python 3.x** | `python --version` | Manuelle |
| **openai-whisper** | `python -c "import whisper"` | `pip install openai-whisper` |
| **FFmpeg** | Présence dans `bin/ffmpeg.exe` | Embarqué |

### Runtime (CDN)

| Lib | URL | Usage |
|-----|-----|-------|
| Axios | `cdn.jsdelivr.net/npm/axios` | HTTP client |
| Coloris CSS | `cdn.jsdelivr.net/gh/mdbassit/Coloris/dist/coloris.min.css` | Styles picker |
| Coloris JS | `cdn.jsdelivr.net/gh/mdbassit/Coloris/dist/coloris.min.js` | Color picker |

### Embarquées

| Lib | Chemin | Usage |
|-----|--------|-------|
| CSInterface.js | `src/scripts/vendors/` | SDK Adobe CEP |
| require.js | `src/scripts/vendors/` | Module loader |

---

## 11. Structure des chutiers Premiere Pro

L'extension crée automatiquement cette structure de bins :

```
Projet Premiere/
├── 00_Sequences/     # Séquences créées
├── 01_Vault/         # Stockage
├── 02_Rushs/         # Fichiers vidéo source
├── 03_SFX/           # Effets sonores
├── 04_Musiques/      # Musiques
├── 05_VFX/           # Effets visuels
├── 06_Overlays/      # Overlays
├── 07_Audio/         # Fichiers audio exportés (WAV)
│   └── 07_Trash/     # Audio rejetés
└── 08_Subtitles/     # Fichiers sous-titres
```

---

## 12. Constantes de configuration clés

### Temps et ticks Premiere

```javascript
TICKS_PER_SECOND = 254016000000
DEFAULT_FRAMERATE = 60.0
```

### Seuils audio (cuts)

```javascript
DEFAULT_MARGIN = 0.015       // secondes
DEFAULT_THRESHOLD = -65      // dB RMS
GROUP_MAX_GAP_SEC = 0.15     // gap max pour grouper les zones
TICK_SLEEP_MS = 15           // sleep entre opérations QE
```

### Timeouts

```javascript
AME_LAUNCH_TIMEOUT_MS = 20000        // Lancement AME
AME_QUEUE_MAX_ATTEMPTS = 30          // Tentatives queue AME
TRANSCRIPTION_TIMEOUT_MS = 1200000   // 20 minutes Whisper
PREMIERE_ASYNC_TIMEOUT = 60000       // Timeout PremiereAsync par défaut
```

---

## 13. Dette technique identifiée

| Élément | Priorité | Détail |
|---------|----------|--------|
| **Premiere.jsx monolithique** | Haute | ~2000 lignes, pas encore modularisé |
| **HTML non ES6 modules** | Haute | `<script>` au lieu de `<script type="module">` |
| **Syntaxe SCSS dans CSS** | Basse | montage.css L56-61 contient un sélecteur imbriqué invalide |
| **Chemins hardcodés** | Basse | run_transcription.bat contient des chemins spécifiques |
| **API key en clair** | Moyenne | Pas de chiffrement localStorage |
| **Pas de tests unitaires** | Moyenne | Architecture testable mais pas de tests |
| **Pas de build tooling** | Basse | Pas de bundler/minifier |
