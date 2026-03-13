# Contrats API - Productivity Extension

> Scan exhaustif | Mise à jour : 2026-03-05

---

## 1. OpenAI Responses API

### Configuration

| Paramètre | Valeur |
|-----------|--------|
| **Endpoint** | `https://api.openai.com/v1/responses` |
| **Auth** | Bearer token (clé `sk-...`) |
| **Stockage clé** | `localStorage.TokenOpenAI` |
| **Retry** | Exponentiel (délai × tentative), max 3 |

### Modèles utilisés

| Modèle | Usage | Contexte |
|--------|-------|----------|
| `gpt-4.1-mini` | Titres, B-rolls | Modèle par défaut (MODEL) |
| `gpt-4.1-nano` | Détection positions motion design | Rapide, 15% taux détection |
| `gpt-5.2` | Titres (reasoning), Smart Cut, selectTitleWords | Raisonnement avancé |
| `gpt-4.1` | Génération Lottie via OpenAI (MODEL_GENERATION) | Alternatif à Claude |

### Endpoints fonctionnels

#### 1.1 Génération de titres (`generateTitles`)

```
POST /v1/responses
Model: gpt-5.2 (reasoning, effort=low)
Input: System prompt (titles) + JSON sous-titres
Stream: true
Response: JSON array [[index, "mot1", "mot2", ...], ...]
Batch: BATCH_SIZE=100 sous-titres par appel
```

#### 1.2 Analyse B-rolls (`analyzeBrolls`)

```
POST /v1/responses
Model: gpt-5.2 (reasoning)
Input: System prompt (brolls) + JSON sous-titres batch + contexte vidéo optionnel
Stream: true
Response: JSON array [[index, "phrase descriptive", "true"|"false"], ...]
Post-traitement: no-consecutive rule, coerce to JSON array fallback
```

#### 1.3 Smart Cut (`analyzeSmartCut`)

```
POST /v1/responses
Model: gpt-5.2 (reasoning)
Input: System prompt (smart-cut) + transcription + intention
Stream: true (SSE JSONL)
Response: Lignes JSONL: {"start": float, "end": float, "title": string, "description"?: string}
Validation par segment: start/end = number, title = string non-vide
Abort: AbortSignal support pour interruption utilisateur
```

#### 1.4 Contexte vidéo (`generateVideoContext`)

```
POST /v1/responses
Model: gpt-4.1-mini
Input: System prompt (context) + texte SRT (max 20000 chars)
Stream: false
Response: {target: {gender, age, motivations, fears}, intention, summary}
Validation: 3 champs requis, gender ∈ ["women", "men", "people"]
Cache: 07_Audio/Context/{file}_context.json
```

#### 1.5 Sélection mots titre (`selectTitleWords`)

```
POST /v1/responses
Model: gpt-5.2 (reasoning)
Input: System prompt (add-title-here) + sous-titres + position curseur + bounds
Stream: true
Response: JSON array [{mots: string, start: number}, ...] (min 2 items)
```

#### 1.6 Détection positions motion design (`analyzeMotionDesign`)

```
POST /v1/responses
Model: gpt-4.1-nano
Input: System prompt (motion-design) + batch 50 sous-titres
Stream: true
Response: JSON array [[index, "phrase", "true"|"false"], ...]
Taux cible: ~15%, pas de positions consécutives
```

#### 1.7 Génération Lottie via OpenAI (`generateLottieAnimation`)

```
Stage 1 - Creative Director:
  POST /v1/responses
  Model: gpt-4.1
  Input: Lottie Creative Director prompt + sous-titre
  Response: JSON scénario créatif

Stage 2 - Lottie Generator (retry 3x):
  POST /v1/responses
  Model: gpt-4.1
  Input: Lottie Style Impact prompt + scénario + feedback erreurs
  Response: JSON Lottie valide (v, fr=30, ip=0, op=90, w=1000, h=1000, layers)
  Validation: _validateLottieJson() structure check
```

---

## 2. Claude CLI (Motion Design)

### Configuration

| Paramètre | Valeur |
|-----------|--------|
| **Commande** | `claude -p --model sonnet --effort low --tools "" --max-turns 1` |
| **Format sortie** | `--output-format stream-json --verbose --include-partial-messages` |
| **Anti-nesting** | `set "CLAUDECODE="` dans le .bat |
| **Timeout** | 5 minutes (300000ms) par défaut |
| **Kill** | `taskkill /F /IM claude.exe /T` |

### Pipeline Lottie (2 stages)

```
Stage 1 - Creative Director:
  Prompt: config/templates/lottie-creative-director.md + sous-titre + focusWord
  Output: JSON scénario créatif (thème, éléments visuels, animation)

Stage 2 - Lottie Generator (retry 3x):
  Prompt: config/templates/lottie-style-impact.md + scénario + erreurs précédentes
  Output: JSON Lottie valide
  Validation: structure (fr=30, op=90, 1000x1000, layers ty=4 avec shapes)
```

### Analyse Smart Cut via Claude

```
Même interface que OpenAI.analyzeSmartCut() mais :
- Pseudo-streaming via polling fichier output (500ms)
- Parse NDJSON stream-json de Claude CLI
- Stabilité : 20s sans nouveau contenu → exit
- Timeout : 5 minutes
```

### Parsing NDJSON (stream-json)

```
Types d'événements reconnus :
- stream_event + delta.type="text_delta"   → accumule texte
- stream_event + delta.type="thinking_delta" → compte thinking
- assistant + message.content              → texte final
- result                                    → isComplete=true

Phases : "waiting" → "thinking" → "generating" → "complete"
```

---

## 3. Bridge CEP (CSInterface → ExtendScript)

### Pattern d'appel

```javascript
// JS (couche 2)
const result = await premiereAsync._evalWithTimeout(
  'FunctionName("' + premiereAsync._escPath(arg) + '")',
  60000  // timeout ms
);

// JSX (couche 4)
function FunctionName(arg) {
  // ExtendScript ES3
  return JSON.stringify(result);
}
```

### Fonctions JSX publiques (par catégorie)

#### Workflow et séquences

| Fonction JSX | Retour | Description |
|-------------|--------|-------------|
| `CreateWorkflow()` | string | Crée structure chutiers |
| `STEP1_EXECUTE(audio, suffix, format)` | string | Crée séquences rush |
| `GetActiveSequenceInfo()` | JSON | {name, duration, sequenceId} |
| `GetExistingSequenceNames()` | JSON | string[] de tous les noms |
| `CreateSmartCutSequence(name, in, out, source)` | JSON | {success, name} |
| `UndoSmartCut(namesJSON)` | JSON | {success, deleted, errors} |

#### Audio et transcription

| Fonction JSX | Retour | Description |
|-------------|--------|-------------|
| `exportMultipleWav(files, audioPath)` | string | Export WAV via AME |
| `runPythonTranscription(ext, audio, goal, file, limit, outDir)` | JSON | Whisper → JSON |
| `AnalyseCut(seq, suffix, margin, threshold)` | JSON | FFmpeg RMS → zones silence |
| `CutSecond(zones, seq)` | string | Applique coupes sur timeline |

#### Titres et sous-titres

| Fonction JSX | Retour | Description |
|-------------|--------|-------------|
| `CreateSTR(seq, presetStyle)` | string | SRT → caption track |
| `CreateTitles(seq, template, color)` | string | MOGRT → V7 |
| `AddSingleTitle(seq, data, template, color)` | JSON | {success, track} |
| `GetCTIPosition()` | JSON | {position, sequenceName} |
| `GetSubtitlesAtTime(seq, time, window)` | JSON | {subtitles: [...]} |

#### B-rolls et marqueurs

| Fonction JSX | Retour | Description |
|-------------|--------|-------------|
| `createBrolls(file, audioPath)` | JSON | Charge données audio |
| `createMarkers(file, jsonPath)` | void | Place marqueurs timeline |
| `addBrollOnTimeline(content, name)` | boolean | Insert clips V2 |

#### Motion Design (Lottie)

| Fonction JSX | Retour | Description |
|-------------|--------|-------------|
| `runClaudeBackground(prompt, output)` | JSON | {launched, donePath, batPath, vbsPath} |
| `checkClaudeDone(donePath)` | string | "true" / "false" |
| `readTextFile(path)` | string | Contenu fichier |
| `killClaudeProcess()` | string | taskkill claude.exe |
| `cleanupClaudeFiles(out, bat, vbs)` | string | Supprime temp files |
| `ImportLottieOverlay(seq, mov, pos)` | JSON | {success, track} |
| `ClearMotionDesignClips(seq)` | JSON | {removed: number} |

#### MOGRT (Propriétés)

| Fonction JSX | Retour | Description |
|-------------|--------|-------------|
| `getSelectedMogrtProperties()` | JSON | {clips: [{properties}], templateMatch} |
| `setMogrtPropertiesBatch(jsonStr)` | JSON | {success, applied} |

#### Fichiers

| Fonction JSX | Retour | Description |
|-------------|--------|-------------|
| `FileExists(path)` | string | "true" / "false" |
| `readFile(path)` | string | Contenu UTF-8 |
| `writeFile(path, content)` | string | Écriture UTF-8 |
| `CreateDirectory(path)` | string | Création récursive |
| `CopyFileTo(src, dst)` | string | Copie binaire |
| `DeleteFileAt(path)` | string | Suppression |
| `ListDirectory(path)` | JSON | string[] filenames |
| `DeleteFolder(path)` | string | Suppression dossier vide |

---

## 4. Authentification (OTP)

### Endpoints PHP

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `{AUTH.BASE_URL}/index.php?code={code}` | GET | Page d'auth avec code OTP |
| `{AUTH.BASE_URL}/check_code.php?code={code}` | GET | Vérification code OTP |
| `{AUTH.BASE_URL}/rotate_longpass.php?longpass={lp}` | GET | Rotation de session |

**BASE_URL :** `http://localhost/Productivity_php`
**Polling :** 2s intervalle, max 150 tentatives (~5 min).
**Stockage :** `localStorage.longpass` (rotation automatique).

---

## 5. Transcription Python (Whisper)

### Interface

```bash
python transcribe.py <audio_path> <goal> [<char_limit>] [<model>] [<output_dir>]
```

| Argument | Défaut | Description |
|----------|--------|-------------|
| `audio_path` | requis | Chemin WAV |
| `goal` | requis | "SRT" ou "BROLL" |
| `char_limit` | 19 (SRT) / 40 (BROLL) | Max chars par ligne |
| `model` | "large-v3" | Modèle Whisper |
| `output_dir` | même dossier | Sortie JSON |

### Sortie JSON

```json
[{
  "index": 1,
  "start": 0.5,
  "end": 2.1,
  "text": "Texte final",
  "words": [
    {"word": "Texte", "start": 0.5, "end": 0.8},
    {"word": "final", "start": 0.8, "end": 1.1}
  ]
}]
```

### Détection depuis JSX

Le script JSX `waitForLogAndLoadJSON()` poll `stdout.log` pour :
- `"JSON create :"` → succès, charge le fichier JSON
- `"%|"` → progression téléchargement modèle
- `"Traceback"` → erreur Python

---

## 6. FFmpeg

### Analyse RMS (silence)

```bash
ffmpeg -i audio.wav -af "astats=metadata=1,ametadata=print:key=lavfi.astats.Overall.RMS_level" -f null -
```

Parse : `pts_time:` + `RMS_level=` → zones sous le seuil → groupement avec marge.

### Encodage ProRes 4444 (Lottie)

```bash
ffmpeg -y -framerate 30 -start_number 1 -i frame_%03d.png
  -frames:v 90 -c:v prores_ks -profile:v 4444
  -pix_fmt yuva444p10le -color_range pc -an output.mov
```

**Timeout :** 120 secondes.
**Validation :** Vérifie que le fichier existe et n'est pas vide.
