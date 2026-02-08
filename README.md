# BMAD Template Web - Guide Francophone

> Template pre-configure de la methode **BMAD v6** (Breakthrough Method of Agile AI Driven Development) pour le developpement web, avec tutoriel complet en francais.

---

## Qu'est-ce que c'est ?

Ce repo est un **template pret a l'emploi** pour demarrer un projet de developpement web avec la methode BMAD. Il inclut :

- **BMAD v6.0.0-Beta.7** pre-installe et configure en francais
- **Tutoriel complet** (~900 lignes) en francais : [`TUTORIEL-BMAD.md`](TUTORIEL-BMAD.md)
- **41 commandes slash** pour Claude Code
- **9 agents IA specialises** (Analyste, PM, Architecte, Dev, Scrum Master, QA, UX, Quick Flow, Tech Writer)
- **25+ workflows** couvrant tout le cycle de developpement

## Demarrage rapide

### 1. Cloner le template

```bash
git clone https://github.com/Diduck/bmad-template-web-fr.git mon-projet
cd mon-projet
```

### 2. Ouvrir dans Claude Code

```bash
claude
```

### 3. Lancer l'aide BMAD

```
/bmad-help
```

### 4. Suivre le tutoriel

Consultez [`TUTORIEL-BMAD.md`](TUTORIEL-BMAD.md) pour un guide detaille de chaque etape.

## Les deux parcours

### Parcours Complet (projets complexes)

```
Phase 1: Analyse      -> /bmad-bmm-create-product-brief
Phase 2: Planification -> /bmad-bmm-create-prd
Phase 3: Solutioning   -> /bmad-bmm-create-architecture
Phase 4: Implementation -> /bmad-bmm-sprint-planning
```

### Quick Flow (petits projets)

```
/bmad-bmm-quick-spec -> /bmad-bmm-quick-dev -> /bmad-bmm-code-review
```

## Structure du template

```
.
+-- _bmad/                    # Methode BMAD (agents, workflows, config)
+-- _bmad-output/             # Artefacts generes (PRD, architecture, stories)
|   +-- planning-artifacts/
|   +-- implementation-artifacts/
+-- .claude/commands/         # 41 commandes slash pour Claude Code
+-- TUTORIEL-BMAD.md          # Tutoriel complet en francais
+-- README.md                 # Ce fichier
```

## Les 9 agents

| Agent | Persona | Role |
|-------|---------|------|
| Mary | Analyste | Recherche, brainstorming, brief produit |
| John | Product Manager | PRD, epics, stories |
| Winston | Architecte | Decisions techniques, ADR |
| Amelia | Developpeuse | Implementation, revue de code |
| Bob | Scrum Master | Sprint planning, gestion stories |
| Sally | UX Designer | Design d'experience utilisateur |
| Quinn | QA | Tests automatises |
| Barry | Quick Flow | Spec et dev rapides |
| Paige | Tech Writer | Documentation |

## Ressources

- **BMAD Method** : https://github.com/bmad-code-org/BMAD-METHOD/
- **Documentation** : http://docs.bmad-method.org/
- **YouTube** : https://www.youtube.com/@BMadCode

## Licence

La methode BMAD est open-source sous licence MIT.
Ce template et le tutoriel sont libres d'utilisation.
