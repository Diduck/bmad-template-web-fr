# Productivity Extension - Analyse de l'arbre source

> Scan exhaustif | Mise à jour : 2026-03-05

---

## Arbre source complet annoté

```
Productivity/                           # Racine de l'extension CEP
├── CSXS/
│   └── manifest.xml                    # Déclaration CEP (ID, hôte, CSP, taille panel)
│
├── src/                                # === CODE SOURCE PRINCIPAL ===
│   ├── jsx/
│   │   └── Premiere.jsx                # [POINT D'ENTRÉE BACKEND] ~3900 lignes ExtendScript ES3
│   │                                   # Toutes les opérations Premiere Pro (séquences, clips, audio, export)
│   │
│   ├── pages/                          # === PAGES HTML (multi-page SPA) ===
│   │   ├── auth.html                   # [POINT D'ENTRÉE UI] Authentification OTP
│   │   ├── index.html                  # Étape 1 : Création de séquences et chutiers
│   │   ├── smartcut.html               # Module Smart Cut (analyse IA + création shorts)
│   │   ├── montage.html                # Étape 2 : Montage IA (titres, sous-titres, B-rolls, motion)
│   │   ├── propriete.html              # Éditeur de propriétés MOGRT multi-clips
│   │   ├── settings.html               # Paramètres (clé API, dépendances)
│   │   └── export.html                 # Étape 3 : Export multi-format
│   │
│   ├── scripts/                        # === LOGIQUE JAVASCRIPT ===
│   │   ├── main.js                     # [POINT D'ENTRÉE JS] ~1150 lignes, orchestration app
│   │   │
│   │   ├── api/                        # --- Clients IA ---
│   │   │   ├── openai.js              # Client OpenAI REST+SSE (streaming, retry, batch)
│   │   │   └── claude.js              # Client Claude CLI (bat+vbs+poll, NDJSON parsing)
│   │   │
│   │   ├── services/                   # --- Services métier ---
│   │   │   ├── titles.js              # Génération de titres (OpenAI/Claude → MOGRT)
│   │   │   ├── subtitles.js           # Transcription + sous-titres (Whisper → SRT → captions)
│   │   │   ├── brolls.js             # Analyse B-rolls (IA → marqueurs → timeline)
│   │   │   ├── smartcut.js           # Smart Cut (streaming JSONL → séquences nested)
│   │   │   ├── motiondesign.js       # Pipeline Lottie (Claude → JSON → frames → .mov → timeline)
│   │   │   ├── context.js            # Contexte vidéo (cible, intention, résumé)
│   │   │   ├── setup.js              # Vérification dépendances (Python, Whisper, FFmpeg)
│   │   │   └── propriete.js          # Édition propriétés MOGRT (batch, undo)
│   │   │
│   │   ├── pages/                      # --- Contrôleurs de pages ---
│   │   │   ├── smartcut.js            # UI Smart Cut (3 phases: config → streaming → review)
│   │   │   ├── settings.js           # UI Paramètres (provider toggle, dépendances)
│   │   │   └── propriete.js          # UI Propriétés (drag values, font toolbar, color swatches)
│   │   │
│   │   ├── components/                 # --- Composants UI réutilisables ---
│   │   │   ├── Component.js           # Classe de base (localStorage ↔ DOM sync)
│   │   │   ├── ColorPicker.js         # Sélecteur couleur (Coloris, historique)
│   │   │   ├── LoadingScreen.js       # Écran de chargement + progression + batch mode
│   │   │   ├── NotificationSystem.js  # Notifications toast
│   │   │   ├── SequenceSelector.js    # Sélecteur de séquences Premiere (active/all/custom)
│   │   │   ├── collaps.js            # Sections repliables (event delegation)
│   │   │   └── loading.js            # Legacy : loading screen simplifié (IIFE)
│   │   │
│   │   ├── utils/                      # --- Utilitaires ---
│   │   │   ├── constants.js           # ~435 lignes de constantes (API, UI, messages, erreurs)
│   │   │   ├── helpers.js            # Fonctions utilitaires (temps, JSON, string)
│   │   │   ├── errorHandler.js       # Gestion d'erreurs centralisée (catalogue structuré)
│   │   │   ├── premiereAsync.js      # Bridge JSX async (evalScript wrapper, timeout, escape)
│   │   │   ├── templateLoader.js     # Chargement de templates Markdown (XHR sync)
│   │   │   ├── storage.js            # Wrapper localStorage (typage auto)
│   │   │   └── verify.js             # Authentification OTP + rotation longpass
│   │   │
│   │   └── vendors/                    # --- Librairies tierces ---
│   │       ├── CSInterface.js         # SDK Adobe CEP (bridge JS ↔ ExtendScript)
│   │       └── require.js            # Module loader AMD
│   │
│   └── styles/                         # === STYLES CSS ===
│       ├── main.css                    # Styles globaux + variables CSS
│       ├── components/                 # Styles par composant (12 fichiers)
│       │   ├── notification.css
│       │   ├── wave.css
│       │   ├── sequence-selector.css
│       │   ├── action-bar.css
│       │   ├── intention-card.css
│       │   ├── short-card.css
│       │   ├── smart-cut-progress.css
│       │   ├── status-bar.css
│       │   ├── streaming-zone.css
│       │   ├── broll.css
│       │   ├── colorPicker.css
│       │   └── loader.css
│       └── pages/                      # Styles par page (4 fichiers)
│           ├── montage.css
│           ├── propriete.css
│           ├── settings.css
│           └── smartcut.css
│
├── config/                             # === TEMPLATES IA (PROMPTS) ===
│   └── templates/                      # 14 fichiers Markdown éditables
│       ├── lottie-creative-director.md # Prompt 1 : sous-titre → scénario créatif
│       ├── lottie-style-impact.md      # Prompt 2 : scénario → JSON Lottie
│       ├── motion-design-system-prompt.md
│       ├── titles-system-prompt.md
│       ├── add-title-here-prompt.md
│       ├── brolls-system-prompt.md
│       ├── context-system-prompt.md
│       ├── smart-cut-system-prompt.md
│       ├── smart-cut-multi-system-prompt.md
│       ├── smart-cut-viral-shorts.md
│       ├── smart-cut-punchlines.md
│       ├── smart-cut-moments-cles.md
│       ├── smart-cut-tutoriels.md
│       └── smart-cut-custom-context.md
│
├── scripts/                            # === SCRIPTS EXTERNES ===
│   └── transcription/
│       ├── transcribe.py              # Service Whisper (word timestamps, custom replacements)
│       ├── run_transcription.bat
│       └── run_transcription.vbs
│
├── assets/                             # === RESSOURCES STATIQUES ===
│   ├── fonts/                          # Gotham (Bold, Medium, Narrow-Black, Narrow-Medium)
│   ├── icons/                          # SVG (sequences, settings)
│   ├── images/                         # PNG (arrow, banner-video, cross)
│   └── templates/titles/              # MOGRT (3 templates) + previews MP4
│
├── bin/
│   └── ffmpeg.exe                      # FFmpeg (~133 MB) pour ProRes 4444
│
├── docs/                               # Documentation générée
├── .debug                              # Config debug CEP (port 8099)
├── temp/                               # Temporaire (node_modules Claude)
├── lottie-frames/                      # Cache frames Lottie
└── backup/                             # Sauvegardes de versions
```

---

## Répertoires critiques

| Répertoire | Rôle | Fichiers clés |
|-----------|------|---------------|
| `src/jsx/` | Backend ExtendScript | `Premiere.jsx` (~3900 lignes, ~60 fonctions publiques) |
| `src/scripts/api/` | Clients IA | `openai.js` (REST+SSE), `claude.js` (bat+vbs+poll) |
| `src/scripts/services/` | Logique métier | 8 services (titles, subtitles, brolls, smartcut, motiondesign, context, setup, propriete) |
| `src/scripts/components/` | UI réutilisable | 7 composants avec persistance localStorage |
| `src/scripts/utils/` | Utilitaires partagés | premiereAsync (bridge), constants, errorHandler |
| `config/templates/` | Prompts IA | 14 templates Markdown éditables |
| `src/pages/` | Pages HTML | 7 pages (auth → index → smartcut → montage → propriete → export) |
| `bin/` | Binaires | ffmpeg.exe pour encodage ProRes 4444 |

---

## Points d'entrée

| Type | Fichier | Description |
|------|---------|-------------|
| UI | `src/pages/auth.html` | Point d'entrée manifest.xml |
| JS | `src/scripts/main.js` | Init app, composants, événements |
| JSX | `src/jsx/Premiere.jsx` | Script hôte ExtendScript |
| Python | `scripts/transcription/transcribe.py` | Service de transcription Whisper |
| Config | `CSXS/manifest.xml` | Déclaration extension CEP |

---

## Flux de navigation

```
auth.html (OTP verify)
    ↓ verified=true
index.html (Création séquences + chutiers)
    ↓
├── smartcut.html (Smart Cut : analyse IA → shorts)
├── montage.html (Montage IA : sous-titres → titres → B-rolls → motion)
├── propriete.html (Éditeur MOGRT multi-clips)
├── settings.html (Paramètres API + dépendances)
└── export.html (Export multi-format)
```

---

## Conventions de fichiers projet Premiere

| Pattern | Emplacement | Description |
|---------|------------|-------------|
| `07_Audio/Audio/{file}.json` | Projet Premiere | Transcription brute (B-roll) |
| `07_Audio/Subtitles/{file}SRT.json` | Projet Premiere | Transcription SRT |
| `07_Audio/Titles/{file}_titles.json` | Projet Premiere | Titres générés |
| `07_Audio/Brolls/{file}_brolls.json` | Projet Premiere | B-rolls analysés |
| `07_Audio/Context/{file}_context.json` | Projet Premiere | Contexte vidéo (cache) |
| `07_Audio/Smartcut/{seq}SRT.json` | Projet Premiere | Transcription Smart Cut |
| `motion_*.mov` | Vault/motion-design | Overlays Lottie ProRes 4444 |
