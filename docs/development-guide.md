# Guide de développement - Productivity Extension

> Documentation générée le 2026-02-24 | Scan exhaustif

---

## 1. Prérequis

| Outil | Version | Obligatoire | Notes |
|-------|---------|------------|-------|
| **Adobe Premiere Pro** | v15.0+ (CC 2020+) | Oui | Hôte de l'extension |
| **Python** | 3.x | Oui | Pour transcription Whisper |
| **pip** | (inclus avec Python) | Oui | Gestionnaire de paquets |
| **openai-whisper** | dernière | Oui | `pip install openai-whisper` |
| **FFmpeg** | (embarqué dans bin/) | Oui | Déjà inclus dans le projet |
| **Clé API OpenAI** | format sk-... | Oui | Pour titres IA et B-rolls |
| **VSCode** | dernière | Recommandé | IDE avec support ExtendScript |

---

## 2. Installation

### 2.1 Emplacement de l'extension

L'extension doit se trouver dans le dossier CEP d'Adobe :

```
Windows: %APPDATA%\Adobe\CEP\extensions\Productivity\
Mac:     ~/Library/Application Support/Adobe/CEP/extensions/Productivity/
```

### 2.2 Activer le mode debug CEP

Pour le développement, activer le debug des extensions non signées :

**Windows (Registre) :**
```
HKEY_CURRENT_USER\Software\Adobe\CSXS.11
Nom: PlayerDebugMode
Type: REG_SZ
Valeur: 1
```

Remplacer `CSXS.11` par la version correspondant à votre Premiere Pro.

### 2.3 Installation des dépendances Python

```bash
python -m pip install openai-whisper
```

> L'extension vérifie automatiquement les dépendances au premier lancement via `SetupManager`. Le résultat est mis en cache dans localStorage (`setup_completed_v1`).

### 2.4 FFmpeg

FFmpeg est déjà embarqué dans `bin/ffmpeg.exe`. Aucune installation nécessaire.

---

## 3. Configuration

### 3.1 Fichier manifeste (`CSXS/manifest.xml`)

Le manifeste définit :
- **ExtensionBundleId :** `com.productivity.it`
- **Host :** PPRO v15.0-99.0
- **MainPath :** `./src/pages/auth.html` (point d'entrée)
- **ScriptPath :** `./src/jsx/Premiere.jsx` (script hôte)
- **Panel :** 850×500px, type Panel, menu "Productivity"
- **CEF Parameters :** Node.js activé, accès fichiers

### 3.2 Debug CEP (`.debug`)

```xml
<Extension Id="com.productivity.it">
  <Host Name="PPRO" Port="8099"/>
</Extension>
```

Port de debug : **8099** — accessible via Chrome DevTools à `http://localhost:8099`

### 3.3 Variables d'environnement (via UI)

| Variable | Emplacement UI | Stockage |
|----------|---------------|----------|
| Token OpenAI | montage.html > Options B-rolls | localStorage `TokenOpenAI` |
| Style sous-titres | montage.html > Options Sous-titres | localStorage `OptionPresetStyle` |
| Marge cuts | montage.html > Options Auto-Cuts | localStorage `MargeCuts` |
| Limite cuts | montage.html > Options Auto-Cuts | localStorage `LimiteCuts` |

---

## 4. Structure du code source

```
src/
├── jsx/Premiere.jsx         # ExtendScript (API Premiere Pro)
├── pages/*.html             # Pages UI du panneau
├── scripts/
│   ├── main.js              # Point d'entrée, orchestration
│   ├── index.js             # Hub re-exports
│   ├── api/openai.js        # Client OpenAI
│   ├── services/            # Logique métier (subtitles, titles, brolls, setup)
│   ├── components/          # UI (Component, ColorPicker, Notifications, Loading)
│   ├── utils/               # Infra (constants, premiereAsync, errorHandler, helpers, storage, verify)
│   └── vendors/             # Libs (CSInterface.js, require.js)
└── styles/                  # CSS (main + pages + components)
```

### Conventions de nommage

| Élément | Convention | Exemple |
|---------|-----------|---------|
| Fichiers | camelCase | `errorHandler.js` |
| Classes | PascalCase | `NotificationSystem` |
| Fonctions | camelCase | `generateForFiles()` |
| Constantes | SCREAMING_SNAKE | `OPENAI.BATCH_SIZE` |
| Composants CSS | kebab-case | `.button-blue` |
| IDs HTML | PascalCase | `OptionSubtitles` |

### Standards de formatage (`.editorconfig`)

| Fichier | Indentation | Fin de ligne |
|---------|-------------|-------------|
| *.js, *.jsx | 4 espaces | LF |
| *.html, *.css | 2 espaces | LF |
| *.json, *.yml | 2 espaces | LF |
| *.bat, *.cmd | 4 espaces | CRLF |

---

## 5. Développement

### 5.1 Lancer l'extension

1. Ouvrir Adobe Premiere Pro
2. Menu **Fenêtre > Extensions > Productivity**
3. Le panneau s'ouvre sur la page d'authentification

### 5.2 Debug JavaScript (Chrome DevTools)

1. Ouvrir Chrome/Edge
2. Naviguer vers `http://localhost:8099`
3. Sélectionner le panneau Productivity
4. Utiliser les DevTools normalement (Console, Sources, Network)

### 5.3 Debug ExtendScript (VSCode)

La configuration est dans `.vscode/launch.json` :
```json
{
  "type": "extendscript-debug",
  "request": "launch",
  "name": "Premiere Pro",
  "hostAppSpecifier": "premierepro",
  "script": "${file}"
}
```

1. Installer l'extension VSCode "ExtendScript Debugger"
2. Ouvrir `Premiere.jsx`
3. F5 pour lancer le debugger
4. Points d'arrêt disponibles

### 5.4 Modifier le code

**JavaScript (src/scripts/) :**
- Modifier le fichier
- Recharger le panneau CEP (clic droit > Recharger ou Ctrl+R dans DevTools)

**ExtendScript (src/jsx/) :**
- Modifier `Premiere.jsx`
- Le fichier est rechargé automatiquement à chaque `evalScript()`
- Ou fermer/rouvrir le panneau

**HTML/CSS :**
- Modifier le fichier
- Recharger le panneau

### 5.5 Ajouter un nouveau service

```javascript
// 1. Créer src/scripts/services/monService.js
export class MonService {
    constructor(premiereAsync) {
        this.premiereAsync = premiereAsync;
    }

    async maMethode(params) {
        // Logique métier
    }
}

// 2. Exporter dans src/scripts/index.js
export { MonService } from './services/monService.js';

// 3. Instancier dans main.js
import { MonService } from './index.js';
const monService = new MonService(premiereAsync);
```

### 5.6 Ajouter une fonction JSX

```javascript
// 1. Dans Premiere.jsx, ajouter la fonction
function maFonctionJSX(param1, param2) {
    // Utiliser l'API Premiere Pro
    var result = app.project.activeSequence.name;
    return JSON.stringify({ name: result });
}

// 2. Dans premiereAsync.js, ajouter le wrapper
async maMethodeAsync(param1, param2) {
    const script = `maFonctionJSX("${param1}", "${param2}")`;
    return this._evalWithTimeout(script);
}
```

---

## 6. Tests

### 6.1 Tests manuels

Pas de framework de tests automatisés en place. Tests manuels recommandés :

| Test | Procédure |
|------|-----------|
| **Auth** | Ouvrir panneau → vérifier OTP → connexion |
| **Step 1** | Sélectionner format → créer chutiers → créer séquences |
| **Transcription** | Activer sous-titres → exécuter → vérifier JSON |
| **Titres IA** | Entrer clé OpenAI → exécuter → vérifier _titles.json |
| **Auto-cuts** | Configurer marge/limite → analyser → vérifier forme d'onde |
| **B-rolls** | Exécuter → vérifier _brolls.json + marqueurs |
| **Export** | Sélectionner formats → exécuter |

### 6.2 Vérification des dépendances

```bash
# Vérifier Python
python --version

# Vérifier Whisper
python -c "import whisper; print('OK')"

# Vérifier FFmpeg
bin\ffmpeg.exe -version
```

---

## 7. Structure des fichiers de sortie

Les fichiers générés par l'extension sont stockés dans le dossier `07_Audio` du projet Premiere :

| Fichier | Source | Contenu |
|---------|--------|---------|
| `{nom}.wav` | Export AME | Audio extrait de la séquence |
| `{nom}.json` | Whisper (BROLL) | Transcription pour analyse B-roll |
| `{nom}SRT.json` | Whisper (SRT) | Transcription pour sous-titres |
| `{nom}_titles.json` | OpenAI | Titres IA générés |
| `{nom}_brolls.json` | OpenAI | Analyse B-roll (réponses IA) |
| `{nom}_brolls.html` | BrollsService | Preview HTML avec liens Envato |
| `CutZoneList.json` | FFmpeg | Zones de silence détectées |
| `stdout.log` | Python | Log de transcription |

---

## 8. Problèmes connus et solutions

### Panel ne s'affiche pas

1. Vérifier que le mode debug CEP est activé (registre Windows)
2. Vérifier que `CSXS/manifest.xml` existe et est valide
3. Redémarrer Premiere Pro

### Erreur "EvalScript error"

1. Vérifier la syntaxe dans `Premiere.jsx`
2. Ouvrir Chrome DevTools (`localhost:8099`) pour voir les erreurs
3. Vérifier que les chemins de fichiers sont correctement échappés (backslashes doublés)

### Transcription échoue

1. Vérifier `python --version` (doit être 3.x)
2. Vérifier `python -c "import whisper"`
3. Vérifier que `stdout.log` existe dans le dossier audio
4. Timeout de 20 minutes — les gros fichiers peuvent prendre du temps

### OpenAI retourne des erreurs

1. Vérifier le format de la clé (préfixe `sk-`)
2. Vérifier la console réseau (DevTools > Network)
3. En cas de rate limit (429), l'extension retry automatiquement (3 tentatives)

### FFmpeg analyse échoue

1. Vérifier que `bin/ffmpeg.exe` existe
2. Vérifier que le fichier WAV source existe
3. Consulter les logs dans la console ExtendScript

---

## 9. Historique du refactoring

**Version 1.0.0 → 2.0.0** (Février 2026)

| Aspect | Avant | Après |
|--------|-------|-------|
| Architecture | 2 fichiers monolithiques | 15+ modules spécialisés |
| main.js | 1611 lignes | ~500 lignes |
| Fonctions >50 lignes | 15+ | 0 |
| Sécurité CSP | `unsafe-eval` + `unsafe-inline` | `script-src 'self'` strict |
| CEF flags | `--disable-web-security` | Supprimé |
| Gestion erreurs | Dispersée | Centralisée (ErrorHandler) |
| Nommage | Mixte | camelCase uniforme |
| Duplication code | Extensive | Éliminée |

**Fichiers de backup :** `backup/` contient les originaux (main.js, collaps.js, verify.js, manifest.xml).
