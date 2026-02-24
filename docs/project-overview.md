# Productivity Extension - Vue d'ensemble du projet

> Documentation générée le 2026-02-24 | Scan exhaustif | Mode: initial_scan

---

## Résumé exécutif

**Productivity** est une extension Adobe CEP (Common Extensibility Platform) pour **Adobe Premiere Pro** qui automatise les workflows de post-production vidéo grâce à l'intelligence artificielle. L'extension combine des appels directs à l'API Premiere Pro (via ExtendScript/JSX), l'API OpenAI (GPT-5-mini), la transcription audio Whisper (Python) et l'analyse audio FFmpeg pour offrir un pipeline de montage vidéo semi-automatisé.

**ID Extension :** `com.productivity.it`
**Version :** 2.0.0 (post-refactoring majeur, février 2026)
**Compatibilité :** Premiere Pro v15.0 (CC 2020) à v99.0

---

## Fonctionnalités principales

| Fonctionnalité | Description | Technologies |
|----------------|-------------|-------------|
| **Création de séquences** | Création automatique de séquences depuis les rushes (9:16, 16:9, 1:1) | ExtendScript, AME |
| **Transcription audio** | Transcription automatique via Whisper | Python, openai-whisper |
| **Génération de titres** | Sélection intelligente de mots-clés pour titres animés | OpenAI GPT-5-mini |
| **Auto-cuts** | Détection et suppression des silences | FFmpeg (analyse RMS) |
| **Sous-titres** | Import de sous-titres SRT avec styles personnalisés | ExtendScript, .prtextstyle |
| **B-rolls** | Analyse IA des phrases pour placement de B-rolls | OpenAI GPT-5-mini |
| **Titres animés** | Import et configuration de templates MOGRT | ExtendScript, MOGRT |
| **Export multi-format** | Export simultané en 9:16, 1:1 et 16:9 | Adobe Media Encoder |

---

## Stack technologique

| Catégorie | Technologie | Version/Détails |
|-----------|-------------|----------------|
| **Langage principal** | JavaScript (ES6) | Vanilla JS, modules ES6 |
| **Scripting hôte** | ExtendScript (JSX) | API Premiere Pro |
| **Markup** | HTML5 | 4 pages (auth, index, montage, export) |
| **Styles** | CSS3 | Design system custom, thème sombre |
| **IA - Titres/B-rolls** | OpenAI API | GPT-5-mini, streaming SSE |
| **IA - Transcription** | Python + Whisper | openai-whisper |
| **Analyse audio** | FFmpeg | Analyse RMS, détection de silence |
| **Export vidéo** | Adobe Media Encoder | Intégration via ExtendScript |
| **SDK** | CSInterface.js | Adobe CEP SDK v6.0 |
| **HTTP** | Axios | CDN, requêtes HTTP |
| **UI - Couleurs** | Coloris | CDN, sélecteur de couleurs |
| **Typographie** | Gotham | Medium + Black (OTF) |

---

## Architecture

**Type de repository :** Monolithe
**Pattern architectural :** Extension CEP multi-couches

```
┌─────────────────────────────────────────────┐
│  UI (HTML/CSS) - Panneau CEP                │
│  auth.html → index.html → montage.html →    │
│  export.html                                │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│  Couche Application (JavaScript ES6)        │
│  main.js → Services → Components → Utils    │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│  Bridge PremiereAsync                       │
│  Wrappers Promise pour CSInterface          │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│  ExtendScript (Premiere.jsx)                │
│  API directe Premiere Pro + I/O fichiers    │
└──────────────────┬──────────────────────────┘
                   │
         ┌─────────┼──────────┐
         │         │          │
    Premiere    FFmpeg     Python
    Pro API     (bin/)     Whisper
```

---

## Structure du repository

```
Productivity/
├── CSXS/manifest.xml          # Manifeste CEP (configuration extension)
├── src/
│   ├── jsx/Premiere.jsx       # ExtendScript (~2000 lignes, API Premiere)
│   ├── pages/                 # Pages HTML du panneau
│   │   ├── auth.html          # Authentification OTP
│   │   ├── index.html         # Step 1: Création séquences
│   │   ├── montage.html       # Step 2: Montage IA
│   │   └── export.html        # Step 3: Export multi-format
│   ├── scripts/               # JavaScript applicatif
│   │   ├── main.js            # Point d'entrée (~500 lignes)
│   │   ├── index.js           # Hub de re-exports
│   │   ├── api/openai.js      # Client OpenAI (streaming, batch)
│   │   ├── services/          # Logique métier
│   │   ├── components/        # Composants UI réutilisables
│   │   ├── utils/             # Utilitaires et infrastructure
│   │   └── vendors/           # Libs tierces (CSInterface, require)
│   └── styles/                # Feuilles de style
│       ├── main.css           # Design system global
│       ├── pages/             # Styles par page
│       └── components/        # Styles par composant
├── assets/                    # Ressources statiques
│   ├── fonts/                 # Gotham (OTF)
│   ├── images/                # Icônes UI
│   └── templates/titles/      # Templates MOGRT + previews MP4
├── bin/ffmpeg.exe             # FFmpeg embarqué
├── scripts/transcription/     # Scripts de transcription
├── config/                    # Configuration debug CEP
└── backup/                    # Sauvegardes pré-refactoring
```

---

## Workflow utilisateur (3 étapes)

### Step 1 — Création (index.html)
- Sélection du format vidéo (9:16, 16:9)
- Création des chutiers (structure de dossiers)
- Création de séquences depuis les rushes
- Import optionnel de fichiers audio améliorés

### Step 2 — Montage (montage.html)
- **Auto-cuts :** Analyse FFmpeg + suppression des silences
- **Sous-titres :** Transcription Whisper + import SRT
- **Titres :** Génération IA + import MOGRT avec couleur/template
- **B-rolls :** Analyse IA + marqueurs + preview HTML
- Traitement séquentiel en 7 phases avec progression

### Step 3 — Exportation (export.html)
- Sélection des formats de sortie (9:16, 1:1, 16:9)
- Assemblage et export via Adobe Media Encoder

---

## Sécurité

Le projet a subi un durcissement sécuritaire majeur lors du refactoring v2.0.0 :

- **CSP stricte :** `script-src 'self'`, pas de `unsafe-eval`
- **Paramètres CEF sécurisés :** Suppression de `--disable-web-security`
- **Validation API key :** Format sk- vérifié
- **connect-src :** Whitelist `https://api.openai.com` et `http://localhost` uniquement

---

## Liens vers la documentation détaillée

- [Architecture](./architecture.md)
- [Arbre source annoté](./source-tree-analysis.md)
- [Inventaire des composants](./component-inventory.md)
- [Contrats API](./api-contracts.md)
- [Guide de développement](./development-guide.md)
