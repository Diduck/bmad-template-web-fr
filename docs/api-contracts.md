# Contrats API - Productivity Extension

> Documentation générée le 2026-02-24 | Scan exhaustif

---

## 1. OpenAI API

### Configuration

| Paramètre | Valeur |
|-----------|--------|
| **URL** | `https://api.openai.com/v1/responses` |
| **Modèle** | `gpt-5-mini` |
| **Max Tokens** | 9000 |
| **Reasoning Effort** | `low` |
| **Taille de batch** | 100 éléments |
| **Délai entre batchs** | 1000ms |
| **Tentatives max** | 3 (backoff exponentiel) |

### Authentification

- **Type :** Bearer Token (header `Authorization`)
- **Format clé :** Préfixe `sk-` obligatoire
- **Stockage :** localStorage (`TokenOpenAI`)
- **Validation :** `ErrorHandler.validateApiKey()` dans `errorHandler.js`

### Endpoint : Génération de titres

**Client :** `OpenAIClient.generateTitles()` / `generateTitlesBatch()`

**Requête :**
```json
{
  "model": "gpt-5-mini",
  "max_output_tokens": 9000,
  "reasoning": { "effort": "low" },
  "input": [
    { "role": "system", "content": "<prompt système titres ~330 lignes>" },
    { "role": "user", "content": "<JSON sous-titres>" }
  ],
  "stream": true
}
```

**Prompt système (résumé) :**
- Sélectionner 1-4 groupes de mots par ligne de sous-titre
- Maximum 3 lignes par titre (préférence 2 lignes)
- Critères : nombres, méthodes, résultats, actions, bénéfices, mots puissants
- ~70% de la transcription doit être titrée
- ~70% au format deux lignes

**Réponse attendue :**
```json
[
  [
    {"mots": "mot1 mot2", "start": 0.5},
    {"mots": "mot3 mot4", "start": 1.2}
  ],
  [...]
]
```

**Streaming :** SSE (Server-Sent Events)
- Parse des événements `data:` avec `\r\n` et `\n`
- Accumulation des deltas `response.output_text.delta`
- Terminaison sur `[DONE]`

### Endpoint : Analyse B-rolls

**Client :** `OpenAIClient.analyzeBrolls()`

**Requête :**
```json
{
  "model": "gpt-5-mini",
  "max_output_tokens": 9000,
  "reasoning": { "effort": "low" },
  "input": [
    { "role": "system", "content": "<prompt système B-rolls ~415 lignes>" },
    { "role": "user", "content": "[[index, phrase], ...]" }
  ]
}
```

**Prompt système (résumé) :**
- Marquer ~30% des lignes comme B-roll
- Éligibilité : actions visibles, émotions, environnements, rôles, objets
- Éviter : phrases abstraites, génériques, méta
- Distribution : espacement régulier, pas de B-rolls consécutifs
- Public cible : femmes, hommes, personnes (visuels adaptés au genre)

**Réponse attendue :**
```json
[
  [0, "phrase analysée", "woman thinking"],
  [1, "autre phrase", false],
  [2, "phrase avec action", "man working on laptop"]
]
```

**Taille de batch B-rolls :** 50 éléments (différent des titres)

### Gestion d'erreurs API

| Code HTTP | Traitement |
|-----------|-----------|
| 200 | Extraction de la réponse via `extractResponse()` |
| 401 | Clé API invalide → notification erreur |
| 429 | Rate limit → retry avec backoff exponentiel |
| 500+ | Erreur serveur → retry (max 3 tentatives) |

### Flux de données

```
Sous-titres JSON → OpenAIClient.generateTitlesBatch()
                    ├── Découpage en lots de 100
                    ├── Pour chaque lot :
                    │   ├── Requête streaming ou standard
                    │   ├── Extraction réponse
                    │   ├── Normalisation JSON
                    │   └── Callback progression
                    └── Résultat : _titles.json par fichier

Sous-titres JSON → OpenAIClient.analyzeBrolls()
                    ├── Découpage en lots de 50
                    ├── Pour chaque lot :
                    │   ├── Requête standard
                    │   ├── Parse réponse JSON
                    │   └── Nettoyage "FALSE" → false
                    ├── Post-traitement : pas de B-rolls consécutifs
                    └── Résultat : _brolls.json par fichier
```

---

## 2. API d'authentification locale

### Configuration

| Paramètre | Valeur |
|-----------|--------|
| **Base URL** | `http://localhost/Productivity_php` |
| **Polling interval** | 2000ms |
| **Max tentatives** | 150 (= 5 minutes timeout) |

### Endpoints

#### `GET /index.php?code={code}`
- **But :** Page d'authentification OTP
- **Paramètres :** `code` - Code OTP 6 chiffres (100000-999999)
- **Comportement :** Ouvre dans le navigateur par défaut via CSInterface

#### `GET /check_code.php?code={code}`
- **But :** Vérifier si le code OTP a été consommé
- **Paramètres :** `code` - Code OTP à vérifier
- **Réponse succès :** Retourne un `longpass` à stocker
- **Polling :** Appelé toutes les 2 secondes jusqu'à consommation

#### `GET /rotate_longpass.php?longpass={code}`
- **But :** Renouveler une session existante
- **Paramètres :** `longpass` - Token de session actuel
- **Réponse :** Nouveau `longpass` → stocké en localStorage
- **Redirection :** → `index.html?verified=true`

### Flux d'authentification

```
1. Vérifier localStorage pour longpass existant
   ├── Si existe → rotateLongpass() (renouveler session)
   │   ├── Succès → redirect index.html?verified=true
   │   └── Échec → startOtpFlow()
   └── Si absent → startOtpFlow()

2. startOtpFlow()
   ├── Générer code 6 chiffres
   ├── Ouvrir navigateur sur /index.php?code={code}
   └── Démarrer pollForCode()

3. pollForCode() (toutes les 2s, max 150 fois)
   ├── GET /check_code.php?code={code}
   ├── Succès → stocker longpass, redirect index.html?verified=true
   └── Timeout (5min) → alert + redirect index.html
```

---

## 3. Communication CEP (CSInterface)

### Bridge PremiereAsync

Toutes les communications avec Premiere Pro passent par `PremiereAsync` qui wrappe `CSInterface.evalScript()` en Promises avec timeout (60s par défaut).

### Événements JSX → JavaScript (CSXSEvent)

| Événement | Données | But |
|-----------|---------|-----|
| `NOTIF` | `{message, type}` | Notifications utilisateur |
| `MODEL_DOWNLOAD_PROGRESS` | `{progress}` | Progression téléchargement modèle Whisper |
| `STEP2_PROGRESS` | `{phase, file, progress}` | Progression du Step 2 |

### Appels JavaScript → JSX

| Méthode PremiereAsync | Fonction JSX | But |
|----------------------|-------------|-----|
| `getProjectPath()` | `getProjectFolderPath()` | Chemin du projet |
| `createWorkflow()` | `CreateWorkflow()` | Créer la structure de chutiers |
| `executeStep1(...)` | `STEP1_EXECUTE(...)` | Créer les séquences |
| `exportMultipleWav(...)` | `exportSequenceWavSilently(...)` | Export audio WAV |
| `runPythonTranscription(...)` | `runPythonTranscription(...)` | Lancer transcription Whisper |
| `analyzeCutForSequence(...)` | `AnalyseCut(...)` | Analyse FFmpeg des silences |
| `executeCutForSequence(...)` | `CutSecond(...)` | Appliquer les coupes |
| `createSubtitlesForSequence(...)` | `CreateSTR(...)` | Importer sous-titres SRT |
| `createTitlesForSequence(...)` | `CreateTitles(...)` | Importer titres MOGRT |
| `createMarkers(...)` | `createMarkers(...)` | Ajouter marqueurs B-roll |

---

## 4. Intégrations système

### FFmpeg (analyse audio)

```
Commande: ffmpeg -i {wav_file} -af "volumedetect,astats=metadata=1:reset=1" -f null -
Sortie: Niveaux RMS par frame
Seuil de silence: -60 dB (configurable via LimiteCuts)
Marge: 0.015s (configurable via MargeCuts)
```

### Python / Whisper (transcription)

```
Exécution: VBS → BAT → python transcribe.py {wav_path} {goal}
Goals: "BROLL" (JSON) ou "SRT" (SRT.json)
Timeout: 20 minutes
Progression: Suivi via stdout.log polling
```

### Adobe Media Encoder (export)

```
Intégration: Via ExtendScript (app.encoder)
Timeout lancement: 20s
Max tentatives queue: 30
Événements: onEncoderLaunched, onEncoderJobComplete, onEncoderJobError
```
