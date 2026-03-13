# Inventaire des composants - Productivity Extension

> Scan exhaustif | Mise à jour : 2026-03-05

---

## 1. Composants UI réutilisables

### 1.1 Component (classe de base)

| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/scripts/components/Component.js` |
| **Pattern** | Classe ES6, export default |
| **Rôle** | Synchronisation bidirectionnelle localStorage ↔ DOM |

**API publique :**

| Méthode | Signature | Description |
|---------|-----------|-------------|
| `constructor` | `(id, defaultValue)` | Lie un élément DOM à une clé localStorage |
| `getValue()` | `→ *` | Valeur courante depuis localStorage |
| `setValue(value)` | `→ void` | Met à jour storage + DOM + collapsibles |
| `getElement()` | `→ HTMLElement|null` | Référence DOM par ID |
| `on(event, cb)` | `→ void` | addEventListener sur l'élément |
| `off(event, cb)` | `→ void` | removeEventListener |

**Instances créées dans main.js :** 22 composants (voir constants.js COMPONENTS).

---

### 1.2 ColorPicker (extends Component)

| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/scripts/components/ColorPicker.js` |
| **Dépendance** | Coloris (CDN) |
| **Rôle** | Sélecteur couleur RGBA avec historique |

**API spécifique :**

| Méthode | Description |
|---------|-------------|
| `initialize()` | Init Coloris (dark theme, alpha), sync DOM |
| `getSwatches()` | Historique récent + défaut (max 10) |
| `addToHistory(color)` | FIFO, sauvegarde sous `{id}_history` |
| `setDefaultColor(hex)` | Changement dynamique (ex: switch template) |

**Instances :** `TitleColorPicker` (#ff4949ff), `MotionColorPicker` (#ffffffff).

---

### 1.3 LoadingScreen

| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/scripts/components/LoadingScreen.js` |
| **Pattern** | Singleton exporté (`loadingScreen`) |
| **Rôle** | Écran modal + barre de progression + mode batch |

**API publique :**

| Méthode | Description |
|---------|-------------|
| `show(message?)` | Affiche l'écran modal (ARIA dialog) |
| `hide()` | Masque, stoppe fake progress, nettoie batch |
| `setMessage(message)` | Met à jour le texte |
| `setStep(current, total, label)` | Indicateur d'étape ("Étape 1 sur 6"), reset barre |
| `setProgress(percent, detail?)` | Barre de progression % + texte détail |
| `showBatch(items, onRemove?)` | Mode batch : liste d'items avec statut + bouton skip |
| `updateBatchItem(id, {percent?, status?})` | Met à jour un item batch (⏳🔄✅❌) |
| `onBatchSkip(callback)` | Enregistre callback pour "Passer et continuer" |

**Fake progress :** +1% toutes les 4.5s, cap 99%. Remplacé par progression réelle quand disponible.

---

### 1.4 NotificationSystem

| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/scripts/components/NotificationSystem.js` |
| **Global** | `window.notifications` |
| **Rôle** | Notifications toast (success/warning/error) |

**API publique :**

| Méthode | Description |
|---------|-------------|
| `success(message, duration?)` | Toast vert, auto-dismiss (6s) |
| `warning(message, duration?)` | Met à jour LoadingScreen si visible, sinon toast |
| `error(message, duration?, persistent?)` | Toast rouge, persistant par défaut (bouton ×) |
| `hide(id)` | Supprime une notification par ID |
| `hideAll()` | Supprime toutes les notifications |

**Comportement :** Hover pause la barre de progression. Click dismiss. Auto-insert en tête du container.

---

### 1.5 SequenceSelector

| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/scripts/components/SequenceSelector.js` |
| **Rôle** | Popup de sélection de séquences Premiere |

**Modes de sélection :**

| Mode | Comportement |
|------|-------------|
| `ACTIVE` | Séquence active dans Premiere (défaut) |
| `ALL` | Toutes les séquences du projet |
| `CUSTOM` | Checkboxes individuelles + recherche |

**API publique :**

| Méthode | Description |
|---------|-------------|
| `init()` | Render UI, event listeners, outside-click |
| `toggle()` | Ouvre/ferme la popup |
| `loadSequences(sequences)` | Filtre Rush_*, render checkboxes, summary |
| `getSelectedSequences()` | null (active) ou string[] (all/custom) |
| `getMode()` | Mode courant |

**Persistance :** Mode et sélection dans localStorage (`sequenceSelectorMode`, `sequenceSelectorSelected`).

---

### 1.6 Collaps (IIFE)

| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/scripts/components/collaps.js` |
| **Pattern** | IIFE, event delegation sur body |

**Comportement :** Clic sur `.collapsible` → toggle display du sibling suivant. Classe `.active` pour état étendu.

---

### 1.7 Loading (Legacy IIFE)

| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/scripts/components/loading.js` |
| **Global** | `window.ProductivityLoading` (API basique) |

**API :** `show(msg)`, `hide()`, `setMessage(msg)`, `isVisible()`. Version simplifiée de LoadingScreen (pas de barre de progrès ni batch).

---

## 2. Services métier

### 2.1 TitlesService

| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/scripts/services/titles.js` |
| **Dépendances** | aiClient (duck typed), SubtitlesService |

| Méthode | Description |
|---------|-------------|
| `generateForFiles(files, setMessage, setProgressBar)` | Batch : auto-transcribe → IA → JSON → écriture |
| `addTitleAtCursor(template, color, startBound, endBound, loadingScreen)` | Titre unique : sous-titres au curseur → IA selectTitleWords → MOGRT |

---

### 2.2 SubtitlesService

| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/scripts/services/subtitles.js` |

| Méthode | Description |
|---------|-------------|
| `generateForFiles(files, goal, charLimit, setProgress)` | Batch export WAV → Whisper transcription |
| `checkSubtitleExists(file, goal, projectPath)` | Vérifie cache JSON |
| `transcribeFile(file, audioPath, goal, charLimit, projectPath)` | Transcription unitaire |

---

### 2.3 BrollsService

| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/scripts/services/brolls.js` |
| **Dépendances** | aiClient, SubtitlesService, ContextService |

| Méthode | Description |
|---------|-------------|
| `createForFiles(files, setProgress, setProgressBar)` | Batch par fichier |
| `createForFile(file, ...)` | Auto-transcribe → contexte → analyseBatch → marqueurs → previews HTML/MD |
| `analyzeBrollsBatch(subtitles, ...)` | Batches de 50 → IA → no-consecutive rule |

---

### 2.4 SmartCutService

| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/scripts/services/smartcut.js` |

| Méthode | Description |
|---------|-------------|
| `startAnalysis(intention, callbacks)` | Mono-séquence : transcription → IA streaming JSONL |
| `startMultiAnalysis(intention, collectedData, callbacks)` | Multi-séquences |
| `loadTranscription(seqName, autoTranscribe, setProgress)` | Charge JSON (3 chemins + fuzzy match) |
| `createSequences(segments, sourceSeqName, callbacks)` | SHORT1, SHORT2... via JSX |
| `undoCreation(sequenceNames)` | Suppression batch des séquences créées |

---

### 2.5 MotionDesignService

| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/scripts/services/motiondesign.js` |
| **Dépendances** | ClaudeClient, lottie-web, FFmpeg |

| Méthode | Description |
|---------|-------------|
| `addMotionAtCursor(color, progress)` | Pipeline complet : CTI → subtitles → Claude → lottie → frames → .mov → import |
| `renderAndExportFrames(lottieJson, framesDir, onProgress)` | SVG → Canvas → 90 PNG Base64 |
| `convertToMov(framesDir, outputPath, extensionRoot)` | FFmpeg ProRes 4444 |
| `executeMotionBatch(seqName, color, openai, subtitles, callbacks)` | Phase 1: détection (15%) → Phase 2: génération parallèle → Phase 3: render séquentiel |
| `applyColorToLottie(json, hexColor)` | Remplace blanc [1,1,1] récursivement |

---

### 2.6 ContextService

| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/scripts/services/context.js` |

| Méthode | Description |
|---------|-------------|
| `generateForFile(file, projectPath)` | Cache → SRT → IA → {target, intention, summary} |

---

### 2.7 SetupManager

| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/scripts/services/setup.js` |

| Méthode | Description |
|---------|-------------|
| `run(force?)` | Check Python → Whisper → FFmpeg, auto-install pip |

---

### 2.8 ProprietesService

| Attribut | Valeur |
|----------|--------|
| **Fichier** | `src/scripts/services/propriete.js` |

| Méthode | Description |
|---------|-------------|
| `loadProperties()` | JSX getSelectedMogrtProperties → clips + propriétés |
| `mergePropertyValues(clips)` | Fusion multi-clips (isMixed flag) |
| `applyChanges(changes, clips)` | Batch JSX setMogrtPropertiesBatch |
| `applyUndo()` | Restaure snapshot |

---

## 3. Contrôleurs de pages

### 3.1 SmartCut Page (smartcut.js)

**3 phases UI :**
1. **Config** : Cartes d'intention (viral_shorts, punchlines, key_moments, tutorials) + sélection séquences
2. **Streaming** : Segments affichés en temps réel (ShortCard DOM), compteur, bouton stop
3. **Review** : Validation, suppression, renommage, création des séquences

**État :** `state = {phase, intention, segments[], streamingAborted, createdSequences[], undoAvailable}`
**Persistance :** localStorage par projet (clé hashée DJB2).

### 3.2 Settings Page (settings.js)

Toggle provider IA (OpenAI/Claude), validation clé API, statut dépendances.

### 3.3 Propriété Page (propriete.js)

Éditeur MOGRT : polling 2s, drag values, font toolbar, color swatches ARGB, position normalisée, undo/redo.

---

## 4. Utilitaires

| Module | Rôle | Fonctions clés |
|--------|------|----------------|
| `constants.js` | Configuration | OPENAI, MOTION_DESIGN, SMART_CUT, PATHS, ERRORS, STRUCTURED_ERRORS, TEMPLATE_PATHS |
| `helpers.js` | Fonctions pures | secondsToTicks, ticksToSeconds, delay, safeJsonParse, normalizeTitlesJsonBatch, debounce, throttle |
| `errorHandler.js` | Erreurs centralisées | handle(), handleStructured(), validateApiKey(), catalogue 15 patterns |
| `premiereAsync.js` | Bridge JSX | _evalWithTimeout(script, timeout), _escPath(), ~40 méthodes publiques |
| `templateLoader.js` | Chargement prompts | loadTemplate(relativePath) → XHR sync → string |
| `storage.js` | localStorage | get/set avec typage auto (bool/number/JSON/string) |
| `verify.js` | Authentification | OTP 6 chiffres, longpass rotation, polling backend PHP |

---

## 5. Design System

### Palette de couleurs (variables CSS)

| Variable | Valeur | Usage |
|----------|--------|-------|
| Background | `#1e1e1e` | Fond principal (dark theme) |
| Surface | `#2d2d2d` | Cartes, popups |
| Text | `#ffffff` | Texte principal |
| Accent | `#4a9eff` | Liens, boutons actifs |
| Success | `#4CAF50` | Notifications succès |
| Warning | `#ff9800` | Notifications warning |
| Error | `#f44336` | Notifications erreur |
| Title default | `#ff4949` | Couleur titre template 1 |
| Title template 2 | `#FFA200` | Couleur titre template 2 |

### Typographie

| Police | Usage |
|--------|-------|
| Gotham Bold | Titres |
| Gotham Medium | Corps de texte |
| Gotham Narrow Black | Emphase |
| Gotham Narrow Medium | Sous-texte |

### Composants CSS

17 fichiers CSS spécialisés, conventions BEM-like avec classes descriptives.
