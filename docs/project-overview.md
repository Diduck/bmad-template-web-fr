# Productivity Extension - Vue d'ensemble du projet

> Scan exhaustif | Mise à jour : 2026-03-05

---

## Résumé exécutif

**Productivity** est une extension Adobe CEP pour Premiere Pro qui automatise les workflows de post-production vidéo grâce à l'intelligence artificielle. Elle couvre la transcription, le titrage, les B-rolls, le montage intelligent (Smart Cut) et le motion design animé (Lottie).

---

## Informations générales

| Attribut | Valeur |
|----------|--------|
| **Nom** | Productivity |
| **ID Extension** | `com.productivity.it` |
| **Version** | 2.0.0 |
| **Type** | Extension Adobe CEP (Panel) |
| **Hôte** | Adobe Premiere Pro v15.0-99.0 |
| **CSXS Runtime** | v6.0 (manifest v7.0) |
| **Taille du panel** | 850 x 500 px |
| **Langue UI** | Français |

---

## Stack technique

| Catégorie | Technologie | Version/Détails |
|-----------|-----------|-----------------|
| UI | HTML5 + CSS3 + Vanilla JS ES6 | Pas de framework, modules ES6 |
| Backend | ExtendScript (JSX) | ES3 strict, ~3900 lignes |
| Module loader | require.js (AMD) | Vendors uniquement |
| CEP Bridge | CSInterface.js | SDK Adobe |
| IA principale | OpenAI API (Responses) | gpt-4.1-mini, gpt-4.1-nano, gpt-5.2, gpt-4.1 |
| IA secondaire | Claude CLI | Modèle Sonnet, bat+vbs+poll |
| Animation | lottie-web | 5.12.2 (CDN) |
| Color picker | Coloris | latest (CDN) |
| HTTP | Axios | latest (CDN) |
| Transcription | Python + Whisper | openai-whisper, large-v3 |
| Encodage vidéo | FFmpeg | bin/ffmpeg.exe, ProRes 4444 |
| Auth | OTP custom | Backend PHP localhost |
| Stockage | localStorage + IndexedDB | Client-side |

---

## Architecture

**Type :** Monolithe multi-couches (4 couches)

```
┌─────────────────────────────────────────────────────┐
│  Couche 1 : UI                                       │
│  7 pages HTML + 17 CSS + composants JS               │
├─────────────────────────────────────────────────────┤
│  Couche 2 : Application                              │
│  8 services métier + 7 composants réutilisables      │
│  + 2 clients IA (OpenAI REST+SSE / Claude CLI)       │
├─────────────────────────────────────────────────────┤
│  Couche 3 : Bridge                                   │
│  CSInterface + PremiereAsync + TemplateLoader        │
├─────────────────────────────────────────────────────┤
│  Couche 4 : Scripting hôte                           │
│  Premiere.jsx (ExtendScript ES3)                     │
│  ~60 fonctions publiques + FFmpeg + Python/Whisper   │
└─────────────────────────────────────────────────────┘
```

---

## Fonctionnalités principales

### 1. Création de projet (index.html)
- Création automatique des séquences (Phone/Desktop/Carré)
- Création de la structure de chutiers (01-08)
- Import audio avec suffixe
- Export WAV via Adobe Media Encoder

### 2. Smart Cut (smartcut.html)
- Analyse IA de la transcription avec 4 intentions prédéfinies
- Streaming JSONL temps réel (segments affichés en live)
- Création de séquences nested (SHORT1, SHORT2...)
- Support mono et multi-séquences
- Auto-transcription Whisper si manquante
- Undo : suppression des séquences créées

### 3. Montage IA (montage.html)
- **Sous-titres** : Whisper → SRT → captions Premiere
- **Titres** : IA → JSON → MOGRT templates (3 styles)
- **B-rolls** : IA → analyse + marqueurs + prévisualisation HTML
- **Motion Design** : Claude CLI → Lottie JSON → PNG frames → ProRes 4444 .mov
- **Découpe silence** : FFmpeg RMS → zones de coupe automatiques
- **Zoom** : Effets zoom sur la timeline

### 4. Éditeur MOGRT (propriete.html)
- Lecture/écriture des propriétés MOGRT des clips sélectionnés
- Édition batch multi-clips avec fusion de valeurs
- Types : texte riche, couleur ARGB, nombre drag, position, boolean
- Font toolbar, undo/redo

### 5. Paramètres (settings.html)
- Provider IA : OpenAI / Claude Code
- Clé API OpenAI, vérification dépendances
- Installation automatique des modules pip

### 6. Export (export.html)
- Assemblage multi-format (Vertical, Horizontal, Carré)
- Combinaisons Hook x Ad x CTA

---

## Métriques du code

| Métrique | Valeur |
|----------|--------|
| Fichiers JS source | ~31 |
| Fichiers HTML | 7 |
| Fichiers CSS | 17 |
| Fichier JSX | 1 (~3900 lignes) |
| Templates IA (Markdown) | 14 |
| Script Python | 1 |
| Fonctions JSX publiques | ~60 |
| Composants UI | 7 |
| Services métier | 8 |

---

## Documentation détaillée

- [Architecture](./architecture.md)
- [Arbre source](./source-tree-analysis.md)
- [Composants](./component-inventory.md)
- [Contrats API](./api-contracts.md)
- [Guide de développement](./development-guide.md)
