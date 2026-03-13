# Productivity Extension - Index de documentation

> Mise à jour : 2026-03-05 | Scan exhaustif | Mode: full_rescan
> Ce fichier est le point d'entrée principal pour le développement assisté par IA.

---

## Vue d'ensemble du projet

- **Type :** Monolithe (extension Adobe CEP)
- **Langage principal :** JavaScript ES6 + ExtendScript (JSX/ES3)
- **Architecture :** 4 couches (UI → Application → Bridge → Scripting hôte)
- **Hôte :** Adobe Premiere Pro v15.0-99.0
- **ID Extension :** `com.productivity.it`
- **Version :** 2.0.0

## Référence rapide

- **Stack technique :** Vanilla JS ES6, ExtendScript, OpenAI (gpt-4.1-mini/gpt-5.2), Claude CLI (Sonnet), Python/Whisper, FFmpeg, lottie-web 5.12.2, Coloris, Axios
- **Point d'entrée UI :** `src/pages/auth.html`
- **Point d'entrée JS :** `src/scripts/main.js`
- **Script hôte :** `src/jsx/Premiere.jsx` (~3900 lignes, ~60 fonctions publiques)
- **Pattern architectural :** 4 couches + 2 pipelines IA (OpenAI REST+SSE / Claude CLI bat+vbs+poll)

---

## Documentation générée

- [Vue d'ensemble du projet](./project-overview.md) — Résumé, stack, fonctionnalités, métriques
- [Architecture](./architecture.md) — Diagramme couches, patterns, flux de données, sécurité
- [Analyse de l'arbre source](./source-tree-analysis.md) — Arbre annoté, répertoires critiques, conventions
- [Inventaire des composants](./component-inventory.md) — 7 composants UI, 8 services, 3 contrôleurs, utilitaires
- [Contrats API](./api-contracts.md) — OpenAI, Claude CLI, bridge JSX, auth, Whisper, FFmpeg
- [Guide de développement](./development-guide.md) — Installation, conventions, ajout de fonctionnalités

---

## Documentation existante du projet

- [LOTTIE-CONTEXT.md](../LOTTIE-CONTEXT.md) — Contexte et implémentation du pipeline Lottie motion design
- [TUTORIEL-BMAD.md](../TUTORIEL-BMAD.md) — Tutoriel méthode BMAD (~900 lignes)
- [PRET.md](../PRET.md) — Notes de préparation

---

## Pour commencer

### Développement
1. Lire le [Guide de développement](./development-guide.md) pour l'installation et la configuration
2. Consulter l'[Architecture](./architecture.md) pour comprendre les couches et les flux
3. Voir l'[Arbre source](./source-tree-analysis.md) pour naviguer dans le code

### Nouvelle fonctionnalité
1. Identifier la couche concernée dans l'[Architecture](./architecture.md)
2. Consulter l'[Inventaire des composants](./component-inventory.md) pour les éléments réutilisables
3. Vérifier les [Contrats API](./api-contracts.md) si l'API est impliquée
4. Suivre les conventions du [Guide de développement](./development-guide.md)

### Fonctionnalités UI uniquement
- [Inventaire des composants](./component-inventory.md) — Section Design System (palette, typographie)
- Composants réutilisables : Component, ColorPicker, LoadingScreen, NotificationSystem, SequenceSelector

### Fonctionnalités IA
- [Contrats API](./api-contracts.md) — OpenAI (titres, B-rolls, Smart Cut, contexte) et Claude CLI (Lottie)
- Templates prompts dans `config/templates/` (14 fichiers Markdown éditables)
- Duck typing : `OpenAIClient` et `ClaudeClient` interchangeables

### Motion Design (Lottie)
- [Architecture](./architecture.md) — Section 5.2 : Pipeline Motion Design complet
- [LOTTIE-CONTEXT.md](../LOTTIE-CONTEXT.md) — Contexte détaillé du pipeline
- Service : `src/scripts/services/motiondesign.js` (addMotionAtCursor, executeMotionBatch)

### Smart Cut
- [Inventaire des composants](./component-inventory.md) — Section 3.1 : SmartCut Page
- Service : `src/scripts/services/smartcut.js` (startAnalysis, createSequences)
- 4 intentions : viral_shorts, punchlines, key_moments, tutorials

### MOGRT Properties
- [Inventaire des composants](./component-inventory.md) — Section 3.3 : Propriété Page
- Service : `src/scripts/services/propriete.js` (loadProperties, applyChanges)

---

## Métadonnées du scan

| Métrique | Valeur |
|----------|--------|
| Date du scan | 2026-03-05 |
| Mode | full_rescan |
| Niveau de scan | exhaustive |
| Fichiers JS analysés | ~31 |
| Pages HTML analysées | 7 |
| Fichiers CSS analysés | 17 |
| Fichier JSX analysé | 1 (~3900 lignes) |
| Templates IA analysés | 14 |
| Script Python analysé | 1 |
| Documents générés | 6 |
