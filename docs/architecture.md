# Architecture - Productivity Extension

> Scan exhaustif | Mise à jour : 2026-03-05

---

## 1. Résumé architectural

Extension Adobe CEP monolithique pour Premiere Pro, organisée en **4 couches** avec 2 pipelines IA distinctes (OpenAI REST+SSE et Claude CLI bat+vbs+poll).

**Pattern principal :** Architecture multi-couches avec bridge asynchrone CEP.

---

## 2. Diagramme des couches

```
┌──────────────────────────────────────────────────────────────┐
│  COUCHE 1 — UI (HTML + CSS)                                  │
│  auth.html → index.html → smartcut.html → montage.html       │
│  → propriete.html → settings.html → export.html              │
│  + 17 fichiers CSS (main + components/ + pages/)             │
├──────────────────────────────────────────────────────────────┤
│  COUCHE 2 — APPLICATION (JavaScript ES6)                     │
│  ┌─────────────────┐  ┌──────────────────────────────────┐  │
│  │  API Clients     │  │  Services métier                 │  │
│  │  openai.js       │  │  titles.js    subtitles.js       │  │
│  │  claude.js       │  │  brolls.js    smartcut.js        │  │
│  │                  │  │  motiondesign.js  context.js     │  │
│  │                  │  │  setup.js     propriete.js       │  │
│  └─────────────────┘  └──────────────────────────────────┘  │
│  ┌─────────────────┐  ┌──────────────────────────────────┐  │
│  │  Composants UI   │  │  Utilitaires                     │  │
│  │  Component.js    │  │  constants.js   helpers.js       │  │
│  │  ColorPicker.js  │  │  errorHandler.js storage.js      │  │
│  │  LoadingScreen   │  │  templateLoader.js               │  │
│  │  Notifications   │  │  verify.js                       │  │
│  │  SeqSelector     │  │                                  │  │
│  └─────────────────┘  └──────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────┤
│  COUCHE 3 — BRIDGE                                           │
│  CSInterface.js (SDK Adobe) + PremiereAsync (evalScript)    │
│  + TemplateLoader (XHR sync → .md prompts)                  │
├──────────────────────────────────────────────────────────────┤
│  COUCHE 4 — SCRIPTING HÔTE (ExtendScript ES3)               │
│  Premiere.jsx (~3900 lignes, ~60 fonctions publiques)       │
│  + FFmpeg (bin/ffmpeg.exe) + Python/Whisper (bat+vbs)       │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Stack technique détaillée

| Catégorie | Technologie | Version | Justification |
|-----------|-----------|---------|---------------|
| Hôte | Adobe Premiere Pro | v15.0-99.0 | Application cible |
| Runtime CEP | CSXS | v6.0 | Framework d'extension Adobe |
| UI | HTML5 + CSS3 | — | Vanilla, sans framework (légèreté) |
| JS Frontend | Vanilla ES6 | — | Modules ES6 import/export |
| JS Backend | ExtendScript | ES3 | Seul langage supporté par Premiere |
| Modules | require.js (AMD) | — | Vendors uniquement (CSInterface) |
| IA REST | OpenAI Responses API | — | Titres, B-rolls, Smart Cut, contexte |
| IA CLI | Claude CLI | Sonnet | Motion design Lottie (2 prompts chaînés) |
| Animation | lottie-web | 5.12.2 | Rendu SVG → Canvas → PNG frames |
| Couleurs | Coloris | latest | Picker RGBA avec historique |
| HTTP | Axios | latest | Requêtes (montage.html uniquement) |
| Vidéo | FFmpeg | local | ProRes 4444 avec alpha, analyse RMS |
| Transcription | openai-whisper | large-v3 | Word timestamps, custom replacements |
| Auth | OTP + longpass | — | Backend PHP localhost |
| Stockage | localStorage | — | Persistance formulaires, état pipeline |

---

## 4. Patterns architecturaux clés

### 4.1 Duck Typing pour les clients IA

Les services acceptent un `aiClient` générique. `OpenAIClient` et `ClaudeClient` implémentent la même interface :

```
aiClient.call(params)            → Promise<string>
aiClient.generateTitles()        → Promise<Array>
aiClient.generateTitlesBatch()   → Promise<Array>
aiClient.analyzeBrolls()         → Promise<Array>
aiClient.selectTitleWords()      → Promise<Array>
aiClient.analyzeSmartCut()       → Promise<void> (streaming)
```

Le choix du provider est fait dans `main.js` via `getAIClient()` selon le toggle AI_PROVIDER.

### 4.2 Bridge asynchrone (PremiereAsync)

Toutes les opérations Premiere passent par `PremiereAsync._evalWithTimeout()` :

```
JS (ES6) → PremiereAsync._evalWithTimeout('FunctionName("args")')
    → CSInterface.evalScript('FunctionName("args")', callback)
        → Premiere.jsx (ES3) exécute la fonction
            → Retourne string (JSON ou valeur simple)
    → Promise<string> résolue dans JS
```

**Timeout par défaut :** 60 secondes. Configurable par appel.
**Escape de chemin :** `_escPath()` double les backslashes et échappe les guillemets.

### 4.3 Pattern bat+vbs (processus externes)

Pour Claude CLI, Python/Whisper et certaines commandes FFmpeg :

```
1. JS écrit le contenu du prompt → fichier temp (.txt)
2. JS appelle JSX.runClaudeBackground(promptPath, outputPath)
3. JSX écrit un .bat avec la commande + "echo done > .done"
4. JSX écrit un .vbs qui lance le .bat en mode caché
5. JSX exécute le .vbs via app.doScript()
6. JS poll le .done file toutes les 500ms
7. JS lit le output file quand terminé
8. JS appelle JSX.cleanupClaudeFiles() pour nettoyer
```

**Anti-nesting :** `set "CLAUDECODE="` dans le .bat désactive la protection de Claude Code.
**Kill orphelin :** `taskkill /F /IM claude.exe /T` sur timeout.

### 4.4 Streaming SSE (OpenAI)

```
1. POST → fetch() avec body.stream = true
2. response.body.getReader() → ReadableStream
3. TextDecoder sur chunks buffered
4. Ligne "data: {json}" → parse delta
5. event.type === 'response.output_text.delta' → accumulation
6. onDelta(accumulatedText) callback
7. [DONE] → retourne fullText
```

### 4.5 Streaming NDJSON (Claude CLI)

```
1. Claude CLI écrit en mode --output-format stream-json --verbose
2. Fichier output contient des lignes JSON (NDJSON)
3. JS parse ligne par ligne via _parseStreamJson()
4. Types d'événements : stream_event (delta), assistant (complete), result (done)
5. Maintient processedUpTo pointer pour éviter le re-parsing
6. Détection de stabilité : 20s sans nouveau contenu → exit
```

### 4.6 Retry à 3 niveaux (Lottie)

```
Niveau 1 — Extraction : _extractJsonFromRaw() strip markdown, fix trailing commas
Niveau 2 — Validation : _validateLottieJson() vérifie structure (fr=30, op=90, layers ty=4)
Niveau 3 — Régénération : retry 3x avec feedback contextuel au modèle
Niveau 4 — Test runtime : _testLottieLoad() avec lottie-web (5s timeout)
Niveau 5 — Retry externe : addMotionAtCursor() retry 3x (génération + test)
```

### 4.7 Gestion du progrès

```
Fake progress : timer indépendant (+1% / 4.5s, cap 99%)
Real progress : remplace fake quand le streaming détecte du contenu
Throttle : 80ms entre updates UI
Plages : scénario 0-20%, lottie 20-55%, couleur 55-60%, frames 60-85%, ffmpeg 85-100%
```

### 4.8 Persistance Component

Chaque élément de formulaire hérite de `Component` :
- Constructeur : `new Component(id, defaultValue)`
- Auto-sync : `localStorage[id]` ↔ `document.getElementById(id).value`
- Checkbox : `checked` property
- Collapsibles : `div.{id}Collaps` affiché/masqué selon valeur booléenne

---

## 5. Flux de données principaux

### 5.1 Pipeline Smart Cut

```
[User: intention + séquences]
    ↓
SmartCutService.startAnalysis()
    ↓ getSequenceList() via SequenceSelector
[PremiereAsync] getActiveSequenceInfo() / getAllProjectSequences()
    ↓
[PremiereAsync] fileExists("07_Audio/Smartcut/{seq}SRT.json")
    ↓ si manquant : auto-transcription
[PremiereAsync] exportMultipleWav() → runSmartCutTranscription()
    ↓ Python/Whisper via bat+vbs (modèle medium)
[aiClient] analyzeSmartCut(transcription, intention)
    ↓ SSE streaming JSONL
callbacks.onSegment({start, end, title, description})
    ↓ cartes SHORT en temps réel
[User: validation]
    ↓
SmartCutService.createSequences()
    ↓
[PremiereAsync] createSmartCutSequence(name, inPoint, outPoint, sourceSeq)
    ↓ JSX : création séquence nested avec In/Out
[User: undo possible]
    ↓
[PremiereAsync] undoSmartCut(sequenceNames)
```

### 5.2 Pipeline Motion Design (curseur)

```
[User: clic "Motion Design" au curseur]
    ↓
MotionDesignService.addMotionAtCursor(color, progress)
    ↓
[PremiereAsync] getCTIPosition() → {position, sequenceName}
[PremiereAsync] getSubtitlesAtTime(seq, position, 5s) → subtitles[]
    ↓ _findClosestWord(subtitles, cursorTime)
_generateLottieViaClaude(subtitleText, tempDir, callbacks, focusWord)
    ↓ Stage 1 : Creative Director prompt (scénario JSON)
    ↓ Stage 2 : Lottie Generator prompt (JSON Lottie, retry 3x)
    ↓ ClaudeClient._runAndPoll() → bat+vbs → poll 500ms
_testLottieLoad(lottieJson, 5000) → lottie-web DOMLoaded
    ↓
applyColorToLottie(json, hexColor) → remplace blanc par couleur choisie
renderAndExportFrames(lottieJson, framesDir)
    ↓ lottie.loadAnimation(SVG) → 90 frames
    ↓ SVG → XMLSerializer → Canvas → toDataURL → Base64 → cep.fs.writeFile
convertToMov(framesDir, outputPath)
    ↓ ffmpeg -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le
copyToStorageLocations(movPath, fileName, projectPath)
    ↓ AppData + Vault + .Productivity
[PremiereAsync] importLottieOverlay(seq, vaultPath, position)
    ↓ JSX : import .mov sur piste V8+
```

### 5.3 Pipeline Titres + Sous-titres + B-rolls

```
[User: Step 2 Execute]
    ↓ main.js handleStep2Execute()
Phase 1: subtitlesService.generateForFiles(files, "SRT", charLimit)
    ↓ exportMultipleWav() → runPythonTranscription() (Whisper)
Phase 2: titlesService.generateForFiles(files)
    ↓ aiClient.generateTitlesBatch() (streaming SSE/NDJSON)
    ↓ writeFile("07_Audio/Titles/{file}_titles.json")
Phase 3: premiereAsync.analyzeCutForSequence() → FFmpeg RMS
    ↓ premiereAsync.executeCutForSequence() → JSX coupe silences
Phase 4: brollsService.createForFiles(files)
    ↓ contextService.generateForFile() (cache contexte vidéo)
    ↓ aiClient.analyzeBrolls() (streaming batch)
    ↓ premiereAsync.createMarkers() → JSX marqueurs
Phase 5: zoom (optionnel)
Phase 6: motion design batch (optionnel)
    ↓ openaiClient.analyzeMotionDesign() (15% détection)
    ↓ Claude CLI parallèle avec stagger 10s
```

---

## 6. Architecture de stockage

### localStorage (via Storage/Component)

| Clé | Type | Usage |
|-----|------|-------|
| `TokenOpenAI` | string | Clé API OpenAI |
| `AIProvider` | boolean | true = Claude, false = OpenAI |
| `sequenceSelectorMode` | string | "active" / "all" / "custom" |
| `sequenceSelectorSelected` | JSON | Noms des séquences sélectionnées |
| `smartCutState` | JSON | État Smart Cut (phase, segments, intentions) |
| `longpass` | string | Session auth (rotation OTP) |
| `setup_completed_v1` | string | Timestamp setup réussi |
| `{ComponentID}` | * | Valeur de chaque composant UI |
| `{ColorPickerID}_history` | JSON | Historique des couleurs |

### Fichiers projet Premiere

```
{ProjectFolder}/
├── 00_Sequences/      # Séquences créées
├── 01_Vault/          # Clips importés
│   └── motion-design/ # Overlays .mov Lottie
├── 02_Rushs/          # Rushs source
│   ├── Rush1/         # Séquences rush mono
│   └── Rush2/         # Séquences rush multi
├── 03_SFX/            # Effets sonores
├── 04_Musiques/       # Musique
├── 05_VFX/            # Effets visuels
├── 06_Overlays/       # Overlays
├── 07_Audio/          # Données IA
│   ├── Audio/         # Transcriptions brutes JSON
│   ├── Subtitles/     # Transcriptions SRT JSON
│   ├── Titles/        # Titres générés JSON
│   ├── Brolls/        # B-rolls analysés JSON + HTML previews
│   ├── Context/       # Contexte vidéo cache JSON
│   └── Smartcut/      # Transcriptions Smart Cut JSON
├── 07_Trash/          # Poubelle
├── 08_Subtitles/      # Fichiers SRT
└── Export/            # Séquences export
```

---

## 7. Sécurité

### Content Security Policy (manifest.xml)

```
default-src 'self';
script-src 'self';
connect-src 'self' https://api.openai.com http://localhost;
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
frame-src http://localhost;
```

### Validation des entrées

- Clé API : vérification préfixe `sk-` via `ErrorHandler.validateApiKey()`
- Paths : escape systématique via `_escPath()` avant evalScript
- JSON : `safeJsonParse()` avec fallback
- Timeouts : toutes les opérations JSX ont un timeout (60s par défaut)

### Authentification

- OTP 6 chiffres via backend PHP localhost
- Longpass rotation pour sessions persistantes
- Vérification `?verified=true` sur chaque page

---

## 8. Gestion d'erreurs

### Catalogue structuré (STRUCTURED_ERRORS)

15 types d'erreurs avec pattern matching :
- API OpenAI : 401, 429, timeout, quota
- JSX Premiere : timeout, clip/séquence introuvable
- Transcription : audio manquant, Whisper error, Python absent
- Réseau : DNS, SSL, connexion perdue
- Fichiers : ENOENT

### Notification utilisateur

```
ErrorHandler.handleStructured(error, operation)
    → Match patterns dans STRUCTURED_ERRORS
    → Affiche : [TYPE] Opération — Message. Action suggérée
    → window.notifications.error(formatted, duration, persistent)
```

### Retry et récupération

- API : retry exponentiel (délai × tentative)
- Lottie : feedback contextuel au modèle sur retry
- Pipeline : `pipelineState` tracks status par phase, `retryFailedPhases()` disponible
- Smart Cut : segments partiels conservés en cas d'interruption

---

## 9. Contraintes ExtendScript (ES3)

| Interdit | Alternative |
|----------|-------------|
| `Date.now()` | `new Date().getTime()` |
| `let` / `const` | `var` uniquement |
| Arrow functions | `function(x) {}` |
| Template literals | Concaténation `+` |
| Destructuring | Accès explicite `obj.prop` |
| Promises | Callbacks synchrones |
| `JSON.parse/stringify` | Disponibles dans CEP mais pas en ExtendScript pur |

**Fichiers bat/vbs :** toujours `file.encoding = "UTF-8"` avant `open("w")`.
