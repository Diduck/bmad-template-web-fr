# Productivity Extension - Index de documentation

> Généré le 2026-02-24 | Scan exhaustif | Mode: initial_scan
> Ce fichier est le point d'entrée principal pour le développement assisté par IA.

---

## Vue d'ensemble du projet

- **Type :** Monolithe (extension Adobe CEP)
- **Langage principal :** JavaScript (ES6) + ExtendScript (JSX)
- **Architecture :** Extension CEP multi-couches avec bridge asynchrone
- **Hôte :** Adobe Premiere Pro v15.0-99.0
- **ID Extension :** `com.productivity.it`
- **Version :** 2.0.0

## Référence rapide

- **Stack technique :** Vanilla JS, ExtendScript, OpenAI GPT-5-mini, Python/Whisper, FFmpeg
- **Point d'entrée UI :** `src/pages/auth.html`
- **Point d'entrée JS :** `src/scripts/main.js`
- **Script hôte :** `src/jsx/Premiere.jsx`
- **Pattern architectural :** 4 couches (UI → Application → Bridge → Scripting hôte)

---

## Documentation générée

- [Vue d'ensemble du projet](./project-overview.md)
- [Architecture](./architecture.md)
- [Analyse de l'arbre source](./source-tree-analysis.md)
- [Inventaire des composants](./component-inventory.md)
- [Guide de développement](./development-guide.md)
- [Contrats API](./api-contracts.md)

---

## Documentation existante du projet

- [README principal](../README.md) - Template BMAD, guide de démarrage
- [Résumé des changements](../CHANGES_SUMMARY.md) - Détail du refactoring v1→v2
- [Guide de refactoring](../REFACTORING_GUIDE.md) - Guide technique complet
- [README Refactoring](../README_REFACTORING.md) - Guide rapide refactoring
- [Tutoriel BMAD](../TUTORIEL-BMAD.md) - Tutoriel méthode BMAD (~900 lignes)

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
- Référencer l'[Inventaire des composants](./component-inventory.md)
- Section Design System pour palette, typographie, boutons

### Fonctionnalités API/IA
- Référencer les [Contrats API](./api-contracts.md)
- Section OpenAI pour titres et B-rolls
- Section CEP pour communication Premiere Pro

---

## Métadonnées du scan

| Métrique | Valeur |
|----------|--------|
| Date du scan | 2026-02-24 |
| Mode | initial_scan |
| Niveau de scan | exhaustive |
| Fichiers source JS analysés | 16 |
| Pages HTML analysées | 4 |
| Fichiers CSS analysés | 7 |
| Fichier JSX analysé | 1 (~2000 lignes) |
| Documents générés | 6 |
