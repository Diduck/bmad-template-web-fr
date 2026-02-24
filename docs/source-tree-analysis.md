# Analyse de l'arbre source - Productivity Extension

> Documentation générée le 2026-02-24 | Scan exhaustif

---

## Arbre source annoté

```
Productivity/                           # Racine de l'extension CEP
│
├── CSXS/                              # Configuration Adobe CEP
│   └── manifest.xml                   # ★ Manifeste extension (ID, hôte, CSP, UI)
│
├── src/                               # ★ Code source principal
│   │
│   ├── jsx/                           # Couche ExtendScript (Premiere Pro API)
│   │   └── Premiere.jsx               # ★ API Premiere (~2000 lignes)
│   │                                  #   - Conversion temps (ticks ↔ secondes)
│   │                                  #   - Navigation projet (bins, séquences, clips)
│   │                                  #   - I/O fichiers (UTF-8)
│   │                                  #   - Création workflow (chutiers)
│   │                                  #   - Step 1 (séquences depuis rushes)
│   │                                  #   - Export audio (AME integration)
│   │                                  #   - Cuts (QE setInPoint/setOutPoint/extract)
│   │                                  #   - Sous-titres (SRT, caption tracks)
│   │                                  #   - Titres animés (MOGRT, couleurs, textes)
│   │                                  #   - Analyse audio (FFmpeg RMS)
│   │                                  #   - Transcription (Python via VBS)
│   │                                  #   - Système d'événements (CSXSEvent)
│   │
│   ├── pages/                         # Pages HTML du panneau CEP
│   │   ├── auth.html                  # ★ Point d'entrée (MainPath dans manifest)
│   │   │                              #   Authentification OTP
│   │   ├── index.html                 # Step 1: Création séquences
│   │   │                              #   Format, audio, workflow
│   │   ├── montage.html               # ★ Step 2: Montage IA (page la plus complexe)
│   │   │                              #   5 options: cuts, zoom, sous-titres, titres, B-rolls
│   │   │                              #   5 sections collapsibles de configuration
│   │   └── export.html                # Step 3: Export multi-format
│   │                                  #   3 formats: 9:16, 1:1, 16:9
│   │
│   ├── scripts/                       # ★ JavaScript applicatif (ES6)
│   │   │
│   │   ├── main.js                    # ★ Point d'entrée JS (~500 lignes)
│   │   │                              #   Init composants, event handlers
│   │   │                              #   Orchestration Step 1 et Step 2 (7 phases)
│   │   │
│   │   ├── index.js                   # Hub de re-exports modules
│   │   │
│   │   ├── api/                       # Couche communication API
│   │   │   └── openai.js              # Client OpenAI (streaming SSE, batch, retry)
│   │   │                              #   generateTitles(), analyzeBrolls()
│   │   │
│   │   ├── services/                  # Couche logique métier
│   │   │   ├── subtitles.js           # Service transcription (Whisper)
│   │   │   ├── titles.js              # Service titres IA (OpenAI batch)
│   │   │   ├── brolls.js              # Service B-rolls IA (OpenAI + marqueurs)
│   │   │   └── setup.js               # Gestionnaire dépendances (Python, pip, FFmpeg)
│   │   │
│   │   ├── components/                # Composants UI réutilisables
│   │   │   ├── Component.js           # Classe de base (persistance localStorage)
│   │   │   ├── ColorPicker.js         # Sélecteur couleur (extends Component + Coloris)
│   │   │   ├── NotificationSystem.js  # Notifications toast (success/warning/error)
│   │   │   ├── LoadingScreen.js       # Overlay modal + barre de progression
│   │   │   ├── loading.js             # Overlay simplifié (legacy, globales)
│   │   │   └── collaps.js             # Toggle sections collapsibles
│   │   │
│   │   ├── utils/                     # Infrastructure et utilitaires
│   │   │   ├── constants.js           # ★ Configuration centralisée (OPENAI, CUTS, PATHS...)
│   │   │   ├── premiereAsync.js       # ★ Bridge Promise pour CSInterface (~25 méthodes)
│   │   │   ├── errorHandler.js        # Gestion centralisée des erreurs
│   │   │   ├── helpers.js             # Fonctions utilitaires (temps, JSON, strings)
│   │   │   ├── storage.js             # Wrapper localStorage typé
│   │   │   └── verify.js              # Authentification OTP (polling, rotation)
│   │   │
│   │   └── vendors/                   # Bibliothèques tierces
│   │       ├── CSInterface.js         # Adobe CEP SDK
│   │       └── require.js             # Module loader
│   │
│   └── styles/                        # Feuilles de style CSS3
│       ├── main.css                   # ★ Design system global (palette, typo, layout)
│       ├── pages/
│       │   └── montage.css            # Styles page montage (cuts, B-roll, templates)
│       └── components/
│           ├── broll.css              # Suggestion B-roll UI
│           ├── loader.css             # Animations de chargement
│           ├── notification.css       # Système toast (slide-in, progress bar)
│           ├── wave.css               # Visualisation forme d'onde audio
│           └── colorPicker.css        # Sélecteur couleur + intégration Coloris
│
├── assets/                            # Ressources statiques
│   ├── fonts/                         # Polices Gotham (OTF/TTF)
│   │   ├── GothamNarrow-Medium.otf
│   │   ├── GothamNarrow-Black.otf
│   │   ├── GOTHAM-BOLD.TTF
│   │   └── GOTHAM-MEDIUM.TTF
│   ├── images/                        # Icônes UI
│   │   ├── arrow.png                  # Flèche collapsible
│   │   ├── cross.png                  # Checkmark
│   │   └── banner-video.png           # Placeholder B-roll
│   └── templates/titles/              # Templates titres
│       ├── TITRE-1-H.mogrt            # Template MOGRT #1
│       ├── TITRE-2-H.mogrt            # Template MOGRT #2
│       ├── TITRE-3-H.mogrt            # Template MOGRT #3
│       └── previews/                  # Aperçus vidéo des templates
│           ├── template-1.mp4
│           ├── template-2.mp4
│           └── template-3.mp4
│
├── bin/                               # Binaires embarqués
│   └── ffmpeg.exe                     # FFmpeg pour analyse audio RMS
│
├── scripts/                           # Scripts système
│   └── transcription/
│       ├── run_transcription.bat      # Script batch (Python → Whisper)
│       └── run_transcription.vbs      # Wrapper VBS (exécution silencieuse)
│
├── config/                            # Configuration alternative
│   ├── .debug                         # Debug CEP (port 8099)
│   └── CSXS/
│       └── manifest.xml               # Manifeste alternatif (MainPath: index.html)
│
├── backup/                            # Sauvegardes pré-refactoring
│   ├── main.js.backup                 # main.js original (1611 lignes)
│   ├── collaps.js.backup              # collaps.js original
│   ├── verify.js.backup               # verify.js original
│   └── manifest.xml.backup            # Manifeste original (INSÉCURISÉ)
│
├── .debug                             # Debug CEP racine (port 8099)
├── .editorconfig                      # Standards de formatage (UTF-8, LF, spaces)
├── .gitignore                         # Exclusions Git
├── README.md                          # README principal (template BMAD)
├── CHANGES_SUMMARY.md                 # Résumé détaillé du refactoring
├── README_REFACTORING.md              # Guide rapide refactoring
├── REFACTORING_GUIDE.md               # Guide technique complet
└── TUTORIEL-BMAD.md                   # Tutoriel méthode BMAD (~900 lignes)
```

---

## Dossiers critiques

| Dossier | Rôle | Fichiers clés |
|---------|------|---------------|
| `src/jsx/` | API Premiere Pro directe | `Premiere.jsx` (~2000 lignes) |
| `src/scripts/` | Application JavaScript | `main.js`, 15+ modules |
| `src/pages/` | Interface utilisateur | 4 pages HTML |
| `src/styles/` | Design system | `main.css` + 6 composants |
| `CSXS/` | Configuration extension | `manifest.xml` |
| `assets/templates/` | Templates MOGRT | 3 templates + previews |
| `bin/` | Outils binaires | `ffmpeg.exe` |
| `scripts/transcription/` | Transcription audio | BAT + VBS |

---

## Points d'entrée

| Point d'entrée | Type | Fichier |
|----------------|------|---------|
| **Extension CEP** | MainPath (manifest) | `src/pages/auth.html` |
| **Script hôte** | ScriptPath (manifest) | `src/jsx/Premiere.jsx` |
| **Application JS** | DOMContentLoaded | `src/scripts/main.js` |
| **Modules JS** | Re-exports | `src/scripts/index.js` |

---

## Statistiques

| Métrique | Valeur |
|----------|--------|
| Fichiers source JS | 16 |
| Fichiers CSS | 7 |
| Pages HTML | 4 |
| Fichier JSX | 1 (~2000 lignes) |
| Templates MOGRT | 3 |
| Polices | 4 fichiers |
| Images | 3 |
| Vidéos preview | 3 |
| Scripts système | 2 (BAT + VBS) |
| Binaires | 1 (ffmpeg.exe) |
