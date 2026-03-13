# Guide de développement - Productivity Extension

> Scan exhaustif | Mise à jour : 2026-03-05

---

## 1. Prérequis

| Dépendance | Version | Obligatoire | Usage |
|-----------|---------|-------------|-------|
| Adobe Premiere Pro | 2021+ (v15.0+) | Oui | Hôte de l'extension |
| Python | 3.8+ | Oui | Transcription Whisper |
| openai-whisper | latest | Oui | Modèle de transcription |
| FFmpeg | latest | Oui | Encodage ProRes + analyse RMS |
| Clé API OpenAI | `sk-...` | Oui (si provider OpenAI) | API IA |
| Claude CLI | latest | Non (si provider Claude) | Pipeline Lottie |
| Node.js | v18+ | Non | Seulement pour Claude streaming (temp/) |

---

## 2. Installation

### 2.1 Extension CEP

1. Copier le dossier `Productivity` dans :
   ```
   Windows: %APPDATA%/Adobe/CEP/extensions/
   Mac: ~/Library/Application Support/Adobe/CEP/extensions/
   ```

2. Activer le mode debug CEP (Windows) :
   ```
   Registre: HKEY_CURRENT_USER\Software\Adobe\CSXS.11
   Clé: PlayerDebugMode = 1 (REG_SZ)
   ```

3. Redémarrer Premiere Pro.

4. Ouvrir le panel : **Fenêtre → Extensions → Productivity**

### 2.2 Dépendances Python

```bash
pip install openai-whisper pydub moviepy
```

L'extension vérifie automatiquement ces dépendances au premier lancement (SetupManager).

### 2.3 FFmpeg

Placer `ffmpeg.exe` dans le dossier `bin/` de l'extension :
```
Productivity/bin/ffmpeg.exe
```

### 2.4 Clé API OpenAI

1. Obtenir une clé sur [platform.openai.com](https://platform.openai.com)
2. Dans l'extension : **Settings → Clé API OpenAI**
3. Format attendu : `sk-...`

---

## 3. Structure du développement

### 3.1 Aucun build nécessaire

L'extension utilise du JavaScript ES6 natif avec modules (`import`/`export`). Pas de bundler, pas de transpilation.

**Modification → Rechargement :**
1. Modifier un fichier .js, .html ou .css
2. Dans Premiere Pro, fermer et rouvrir le panel (ou recharger via debug port 8099)

### 3.2 Debug

- **Chrome DevTools :** `http://localhost:8099` (port défini dans `.debug`)
- **Console JSX :** Les messages `logMessage()` apparaissent dans la console Premiere
- **Notifications :** `notif(msg, type)` envoie des CSXSEvents au panel

### 3.3 Modules ES6

```javascript
// Import
import { OPENAI, MESSAGES } from '../utils/constants.js';
import Component from '../components/Component.js';

// Export
export default class MyService { ... }
export function myHelper() { ... }
```

Les vendors (`CSInterface.js`, `require.js`) sont chargés comme scripts globaux dans le HTML.

---

## 4. Conventions du code

### 4.1 JavaScript (couche 2)

| Convention | Exemple |
|-----------|---------|
| Classes ES6 | `class TitlesService { ... }` |
| Modules ES6 | `import/export` |
| Async/await | `async function foo() { ... }` |
| Nommage | camelCase (variables, fonctions), PascalCase (classes) |
| Constantes | SCREAMING_SNAKE_CASE dans `constants.js` |
| Services | Un fichier = une classe = un domaine métier |
| Composants | Héritent de `Component` pour la persistance |

### 4.2 ExtendScript (couche 4)

| Convention | Exemple |
|-----------|---------|
| Syntaxe | ES3 strict : `var`, `function`, pas d'arrow |
| Nommage | PascalCase pour les fonctions publiques (`CreateWorkflow`) |
| Commentaire | `// FONCTION PUBLIQUE` pour les fonctions appelées depuis JS |
| Retour | `JSON.stringify(result)` pour les données structurées |
| Erreurs | `try/catch` avec `notif(error.message, "error")` |
| Temps | `new Date().getTime()` (jamais `Date.now()`) |
| Encodage | `file.encoding = "UTF-8"` avant toute écriture |

### 4.3 CSS

| Convention | Exemple |
|-----------|---------|
| Variables | `var(--background-color)` |
| Nommage | Classes descriptives (`.seq-selector-popup`, `.short-card`) |
| Organisation | 1 fichier par composant dans `styles/components/` |
| Dark theme | Fond sombre, texte clair |

---

## 5. Ajout d'une nouvelle fonctionnalité

### 5.1 Nouveau service IA

1. Créer `src/scripts/services/monService.js`
2. Accepter `aiClient` en constructeur (duck typing)
3. Utiliser `aiClient.call()` pour les appels IA
4. Créer le template prompt dans `config/templates/mon-prompt.md`
5. Ajouter le chemin dans `constants.js → TEMPLATE_PATHS`
6. Instancier dans `main.js` avec `getAIClient()`

### 5.2 Nouvelle page HTML

1. Créer `src/pages/mapage.html`
2. Inclure les scripts de base :
   ```html
   <script src="../scripts/vendors/CSInterface.js"></script>
   <script src="../scripts/components/loading.js"></script>
   <script type="module" src="../scripts/main.js"></script>
   <link rel="stylesheet" href="../styles/main.css">
   ```
3. Ajouter le lien dans la navigation `step-nav`
4. Créer `src/scripts/pages/mapage.js` (contrôleur)
5. Détecter la page dans `main.js` pour initialisation spécifique

### 5.3 Nouvelle fonction JSX

1. Ajouter la fonction dans `src/jsx/Premiere.jsx`
2. Utiliser la syntaxe ES3 :
   ```javascript
   function MaFonction(arg1, arg2) {
       // FONCTION PUBLIQUE
       try {
           var result = { success: true };
           return JSON.stringify(result);
       } catch (e) {
           return JSON.stringify({ error: e.message });
       }
   }
   ```
3. Ajouter le wrapper dans `src/scripts/utils/premiereAsync.js` :
   ```javascript
   async maFonction(arg1, arg2) {
       const result = await this._evalWithTimeout(
           'MaFonction("' + this._escPath(arg1) + '", "' + this._escPath(arg2) + '")'
       );
       return JSON.parse(result);
   }
   ```

### 5.4 Nouveau composant UI

1. Créer `src/scripts/components/MonComposant.js`
2. Étendre `Component` pour la persistance :
   ```javascript
   import Component from './Component.js';
   export default class MonComposant extends Component {
       constructor() { super('monId', defaultValue); }
   }
   ```
3. Ajouter le CSS dans `src/styles/components/mon-composant.css`
4. Instancier dans `main.js` → `window.Components`

---

## 6. Commandes de développement

### Rechargement de l'extension

```
Premiere Pro → Fenêtre → Extensions → (fermer) → (rouvrir) Productivity
```

Ou via DevTools : `location.reload()` dans la console.

### Debug ExtendScript

```javascript
// Dans Premiere.jsx
$.writeln("Debug: " + variable);  // Apparaît dans ESTK
logMessage("Debug: " + variable); // Apparaît dans la console CEP
notif("Debug message", "error");  // Notification dans le panel
```

### Test transcription

```bash
python scripts/transcription/transcribe.py "chemin/audio.wav" "SRT" 19 "medium"
```

### Test FFmpeg

```bash
bin/ffmpeg.exe -i input.wav -af "astats=metadata=1,ametadata=print:key=lavfi.astats.Overall.RMS_level" -f null -
```

### Test Lottie (navigateur)

Ouvrir `test-lottie-preview.html` dans un navigateur pour tester un JSON Lottie.

---

## 7. Patterns récurrents

### 7.1 Appel IA avec streaming

```javascript
const result = await aiClient.call({
    model: OPENAI.MODEL,
    maxTokens: OPENAI.MAX_TOKENS,
    input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
    ],
    onDelta: (accumulated) => {
        // Progression streaming
        loadingScreen.setProgress(percent, 'Generating...');
    }
});
```

### 7.2 Opération Premiere avec timeout

```javascript
const result = await premiereAsync._evalWithTimeout(
    'MaFonction("' + premiereAsync._escPath(path) + '")',
    30000  // timeout 30s
);
const parsed = JSON.parse(result);
if (parsed.error) throw new Error(parsed.error);
```

### 7.3 Auto-transcription conditionnelle

```javascript
const exists = await premiereAsync.fileExists(srtPath);
if (!exists) {
    await subtitlesService.transcribeFile(file, audioPath, "SRT", charLimit, projectPath);
}
const json = await premiereAsync.readFile(srtPath);
const data = JSON.parse(json);
```

### 7.4 Notification d'erreur structurée

```javascript
try {
    await riskyOperation();
} catch (error) {
    ErrorHandler.handleStructured(error, 'Mon opération');
    // Affiche : [TYPE] Mon opération — Message. Action suggérée
}
```

---

## 8. Limitations connues

| Limitation | Détail |
|-----------|--------|
| ExtendScript ES3 | Pas de let/const, arrow functions, template literals, destructuring |
| Canvas offscreen | Ne fonctionne pas pour l'export Lottie → SVG visible obligatoire |
| evalScript sync | CSInterface.evalScript est bloquant côté JSX |
| Pas de hot reload | Fermer/rouvrir le panel pour recharger |
| CEP dépréciée | Adobe migre vers UXP (compatibilité future à surveiller) |
| CDN dépendances | Coloris, Axios, lottie-web chargés via CDN (requiert internet) |
| ffmpeg.exe taille | ~133 MB inclus dans l'extension |

---

## 9. Variables d'environnement et configuration

### localStorage

| Clé | Type | Défaut | Description |
|-----|------|--------|-------------|
| `TokenOpenAI` | string | "x" | Clé API OpenAI |
| `AIProvider` | boolean | false | true=Claude, false=OpenAI |
| `TemplateSelection` | string | "1" | Template MOGRT sélectionné |
| `TitleColorPicker` | string | "#ff4949ff" | Couleur des titres |
| `MotionColorPicker` | string | "#ffffffff" | Couleur motion design |
| `SubtitleCharLimit` | number | 19 | Limite caractères sous-titres |
| `MargeCuts` | number | 0.015 | Marge de coupe (secondes) |
| `setup_completed_v1` | string | — | Timestamp setup réussi |

### Constantes de configuration (constants.js)

| Constante | Valeur | Description |
|-----------|--------|-------------|
| `OPENAI.API_URL` | `https://api.openai.com/v1/responses` | Endpoint API |
| `OPENAI.MAX_TOKENS` | 9000 | Tokens max par requête |
| `OPENAI.BATCH_SIZE` | 100 | Sous-titres par batch |
| `MOTION_DESIGN.FPS` | 30 | Framerate Lottie |
| `MOTION_DESIGN.CANVAS_SIZE` | 1000 | Résolution 1000x1000 |
| `MOTION_DESIGN.DURATION_SEC` | 3 | Durée animation (90 frames) |
| `AUTH.BASE_URL` | `http://localhost/Productivity_php` | Backend auth |
