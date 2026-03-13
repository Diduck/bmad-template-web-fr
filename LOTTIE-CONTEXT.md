# Contexte Complet — Lottie Motion Design Overlay

> Document de reference qui resume l'integralite du projet d'animations Lottie
> pour overlays video dans l'extension CEP Premiere Pro "Productivity".

---

## 1. Vue d'ensemble

### Objectif
Generer automatiquement des animations motion design (overlays blancs sur fond transparent)
a partir de sous-titres video, les exporter en `.mov ProRes 4444` avec canal alpha,
et les importer dans Premiere Pro comme overlays au-dessus de la video.

### Pipeline complet (v2 — architecture 2 prompts)
```
Sous-titre
  → Prompt 1 "Creative Director" (GPT) → scenario creatif JSON
  → Prompt 2 "Lottie Generator" (GPT) → JSON Lottie
  → lottie-web (renderer SVG) → PNG frames (1000x1000, alpha)
  → ffmpeg → .mov ProRes 4444 (alpha)
  → Premiere Pro (overlay au-dessus de la video)
```

---

## 2. Architecture des prompts

### Prompt 1 — Creative Director
- **Fichier** : `config/templates/lottie-creative-director.md`
- **Role** : sous-titre → scenario d'animation (creativite + variete)
- **Input** : un sous-titre de video (texte)
- **Output** : objet JSON structure :
```json
{
  "subtitle": "le sous-titre original",
  "object": {
    "name": "nom de l'objet",
    "why": "justification",
    "parts": [{"name": "...", "shape": "...", "detail": "..."}]
  },
  "story": "micro-histoire en 1-2 phrases",
  "techniques": {
    "entrance": "technique choisie",
    "action": "technique choisie",
    "exit": "technique choisie",
    "effects": ["0 a 3 effets"]
  },
  "layers": [{"name": "...", "role": "hero|detail|action|accent|effect", "description": "..."}],
  "climax_frame": 30
}
```

#### Processus du Creative Director
1. **Identifier l'objet concret** du sous-titre (pas abstrait — le spectateur doit dire "c'est un X")
2. **Decomposer en geometrie** (rectangles, cercles, lignes, arcs, triangles)
3. **Choisir les techniques** dans le menu (1 entree + 1 action + 1 sortie + 0-3 effets)
4. **Ecrire la micro-histoire** (que fait l'objet en 3 secondes ?)

#### Regle cle : VARIETE
Le Creative Director ne doit PAS toujours choisir la meme combo.
Les techniques sont choisies en fonction du contexte semantique du sous-titre.

### Prompt 2 — Lottie Generator (Style IMPACT v2)
- **Fichier** : `config/templates/lottie-style-impact.md`
- **Role** : scenario JSON → animation Lottie JSON
- **Input** : le scenario JSON produit par le Prompt 1
- **Output** : JSON Lottie valide (bodymovin), directement jouable par lottie-web

---

## 3. Menu des techniques d'animation

### Entrees (8 techniques)
| Technique | Description | Usage type |
|---|---|---|
| `trim-draw` | Dessin trait par trait (trim path 0→100%) | Objets a contours clairs |
| `scale-pop` | Scale 0→115→100 (overshoot) | Apparition explosive |
| `slide-in` | Glisse depuis hors canvas | Objets en mouvement |
| `assemble` | Pieces arrivent separement | Objets multi-parties |
| `spin-in` | Rotation + scale depuis 0 | Objets ronds/mecaniques |
| `unfold` | Depliage depuis un axe | Objets symetriques |
| `drop-bounce` | Tombe d'en haut + rebond | Objets avec poids |
| `typewriter` | Elements un par un, sequentiels | Objets lineaires |

### Actions (8 techniques)
| Technique | Description | Usage type |
|---|---|---|
| `rotate-accelerate` | Rotation exponentielle | Aiguilles, engrenages |
| `morph` | Changement de forme progressif | Transformation symbolique |
| `bounce-hit` | Frappe/rebond contre un autre | Impact, collision |
| `path-travel` | Deplacement le long d'une courbe | Vehicules, projectiles |
| `pulse-beat` | Scale rythmique oscillant | Coeur, alarme, urgence |
| `mechanical` | Mouvement propre a l'objet | Porte, ciseaux, levier |
| `shake-vibrate` | Vibration rapide position | Stress, telephone |
| `swing-pendulum` | Oscillation rotation amortie | Horloge, balance |

### Sorties (8 techniques)
| Technique | Description | Usage type |
|---|---|---|
| `shrink-fade` | Scale 100→85 + opacity→0 | Sortie neutre |
| `fly-off` | Position hors canvas | Suite d'un mouvement |
| `trim-erase` | Trim path inverse | Miroir de trim-draw |
| `explode` | Pieces s'eloignent | Apres climax violent |
| `dissolve` | Opacity→0 stagger | Sortie douce |
| `spin-out` | Rotation + scale→0 | Aspire/tourbillon |
| `collapse` | Retombe/s'ecroule | Fin, echec |
| `scatter` | Chaque piece s'envole | Liberation, fin joyeuse |

### Effets optionnels (7 effets, 0 a 3 par animation)
| Effet | Description |
|---|---|
| `particles` | 2-5 cercles qui jaillissent du centre |
| `ring-pulse` | Cercle stroke qui s'expand et s'efface |
| `flash` | Cercle fill large, bref pic d'opacite |
| `line-trails` | Traits courts qui filent depuis l'objet |
| `sparkles` | Petites etoiles 4 branches qui scintillent |
| `shockwave` | Ligne qui traverse le canvas |
| `orbit` | Element qui tourne autour de l'objet |

---

## 4. Specifications techniques Lottie

### Format
- Lottie JSON (bodymovin) v5.7.4
- Canvas : **1000 x 1000 px**
- Centre : [500, 500]
- Framerate : **30 fps**
- Duree : **90 frames / 3 secondes**
- Couleur : **blanc uniquement** `[1,1,1,1]`
- Fond : **transparent** (aucun glow, aucun halo)
- Layers : shape uniquement (`"ty": 4`)
- Min **4 layers**, max **10 layers**
- PAS d'assets, PAS d'images, PAS de texte, PAS de precomps

### Style visuel
- Stroke principal : 10-14px
- Stroke secondaire : 6-8px
- Fills : opacite 80-100%
- Line cap arrondi (`"lc": 2`), rounded join (`"lj": 2`)
- Zone utile : rayon 350px du centre

### Easings de reference
```
PUNCHY (entrees) :   i:{x:[0.15],y:[1]}, o:{x:[0.7],y:[0]}
SMOOTH (sorties) :   i:{x:[0.58],y:[1]}, o:{x:[0.42],y:[0]}
RAPIDE (effets) :    i:{x:[0.4],y:[1]},  o:{x:[0.6],y:[0]}
LINEAIRE-ISH :       i:{x:[0.3],y:[0.3]}, o:{x:[0.7],y:[0.7]}
```

### Correspondance easing Lottie ↔ CSS
- `"o"` = CP1 (outgoing), `"i"` = CP2 (incoming)
- CSS : `cubic-bezier(o.x, o.y, i.x, i.y)`

### Arc narratif (4 phases)
| Phase | Frames | Duree | Action |
|---|---|---|---|
| **Entree** | 0 → climax-5 | ~0.8s | L'objet apparait (technique d'entree) |
| **Action** | climax-5 → climax+25 | ~1.0s | Climax + effets se declenchent |
| **Resolution** | climax+25 → 72 | ~0.6s | Mouvement ralentit, effets s'eteignent |
| **Sortie** | 72 → 90 | ~0.6s | TOUT disparait, canvas vide a frame 90 |

### Opacite par role
| Role | Opacite |
|---|---|
| hero | 90-100% |
| action | 85-100% |
| detail | 70-90% |
| accent | 80-95% |
| effect | 50-85% |
| MINIMUM | 5% |

---

## 5. Techniques Lottie avancees

### Groupes (`"ty":"gr"`)
- Combiner plusieurs shapes dans un meme layer avec transforms individuels
- Chaque groupe a son propre `"ty":"tr"` pour position/rotation
- Trim path dans un groupe = scope limite a CE groupe
- Repeater dans un groupe duplique les shapes du groupe precedent

### Repeater (`"ty":"rp"`)
- Pour motifs repetitifs : ticks d'horloge, dents de cle, perforations
- Parametres : `c` (copies), rotation par copie
- Exemple : 12 ticks a 30° = horloge

### Trim path (`"ty":"tm"`)
- `"s"` (start) et `"e"` (end) : 0→100 = dessin progressif
- Inverse : 100→0 = effacement progressif
- Scope : encapsuler dans un groupe pour limiter

### Scale overshoot (3 keyframes)
```
t+0:  [0, 0, 100]     → invisible
t+10: [115, 115, 100]  → depasse
t+16: [100, 100, 100]  → stabilise
```

---

## 6. Changements v1 → v2

### Supprime
- Layers 0-1 (glow-outer, glow-inner) — halos atmospheriques
- Technique NEON 3 groupes (outer-glow + mid-glow + core) sur chaque element
- Toute reference au glow dans opacite, anti-patterns, etc.
- Structure rigide de 13 layers fixes

### Ajoute
- Architecture 2 prompts (Creative Director + Lottie Generator)
- Menu de 8+8+8+7 techniques d'animation pour la variete
- Structure flexible 4-10 layers adaptee au scenario
- Dictionnaire d'objets elargi (25 entrees)
- Exemples varies (horloge, porte, billet d'avion)

### Justification
- Le glow sera ajoute en post-production dans Premiere Pro (plus de controle)
- La variete evite la monotonie (avant : toujours scale-pop + 4 particules + 2 rings + flash)
- Separer creativite (prompt 1) et precision technique (prompt 2) = meilleurs resultats

---

## 7. Dictionnaire d'objets concrets (25 entrees)

| Mot-cle | Objet | Geometrie |
|---|---|---|
| billet, ticket | Billet | Rectangle arrondi + perforation + lignes |
| train, voyage | Train | Rectangle + cercle roue + cheminee |
| temps, heure | Horloge | Cercle + 12 ticks (repeater) + 2 aiguilles |
| argent, prix | Piece/billet | Cercle + $ OU rectangle + lignes |
| porte, entrer | Porte | Rectangle + cercle poignee + arc |
| cle, secret | Cle | Cercle tete + rectangle tige + dents |
| telephone | Telephone | Rectangle arrondi + cercle camera + barre |
| livre, lire | Livre | 2 rectangles en V + lignes |
| etoile, succes | Etoile | Polystar 5 branches |
| fleche, direction | Fleche | Ligne + triangle pointe |
| coeur, amour | Coeur | 2 arcs + pointe V |
| maison, foyer | Maison | Rectangle + triangle toit + porte |
| trophee, victoire | Trophee | Trapeze + pied + base |
| cible, objectif | Cible | 3 cercles + fleche |
| voiture, conduire | Voiture | Rectangle + 2 cercles roues + toit |
| avion, voler | Avion | Triangle + 2 ailes + derive |
| ampoule, idee | Ampoule | Cercle + culot + filament |
| cadenas, securite | Cadenas | Rectangle + arc anse |
| engrenage, systeme | Engrenage | Cercle + dents (repeater) |
| balance, justice | Balance | Triangle pivot + barre + 2 plateaux |
| parapluie, pluie | Parapluie | Demi-cercle + manche + crochet |
| micro, podcast | Micro | Cercle tete + tige + base |
| camera, video | Camera | Rectangle + cercle objectif + triangle |
| eclair, energie | Eclair | Polyline zigzag |
| montagne, defi | Montagne | Triangle + neige + drapeau |

---

## 8. Anti-patterns (ce qui rend une animation MAUVAISE)

1. **ABSTRAIT** : cercles/lignes qui ne representent rien → dessiner un OBJET reconnaissable
2. **GLOW / HALO** : aucun layer de glow → sera fait en post-production
3. **TROP DE LAYERS** : max 10 → chaque layer a un role clair
4. **ZONE MORTE** : 10+ frames sans mouvement → inacceptable
5. **FIN ABRUPTE** : elements visibles a frame 90 → Phase 4 obligatoire
6. **EASING LINEAIRE** : animations sans courbe → amateur
7. **SCALE SANS OVERSHOOT** : 0→100 direct → plat (quand technique = scale-pop)
8. **TOUT EN MEME TEMPS** : pas de stagger → stagger 2-5 frames obligatoire
9. **HORS CANVAS** : positions hors 0-1000 (sauf slide-in / fly-off)
10. **IGNORER LE SCENARIO** : ne pas suivre les techniques du Creative Director
11. **STRUCTURE FIXE** : toujours 13 layers identiques → adapter au scenario

---

## 9. Pipeline d'export

### Etape 1 : Preview + Export frames (navigateur)
- **Fichier** : `test-styles-comparison.html`
- **Renderer** : lottie-web 5.12.2 (CDN), mode SVG
- **Export** : frame-by-frame via `goToAndStop(frame)` → serialize SVG → canvas `drawImage` → PNG blob
- **Packaging** : JSZip 3.10.1 → `lottie-frames-1000.zip`

> **IMPORTANT** : Le renderer canvas offscreen NE FONCTIONNE PAS.
> Toujours utiliser SVG visible → serialisation → canvas pour l'export.

### Etape 2 : Conversion ffmpeg
- **Script** : `export-lottie-mov.bat`
- **ffmpeg** : `bin/ffmpeg.exe` (inclus dans le projet)
- **Commande** :
```bash
ffmpeg -y -framerate 30 \
  -i frames/frame_%03d.png \
  -c:v prores_ks -profile:v 4444 \
  -pix_fmt yuva444p10le \
  -color_range pc \
  -an output.mov
```
- **Parametres cles** :
  - `prores_ks -profile:v 4444` : ProRes 4444 avec canal alpha
  - `yuva444p10le` : format pixel avec alpha 10-bit
  - `-color_range pc` : full range 0-255 (sinon blanc = 235 en TV limited)
  - `-an` : pas d'audio

### Etape 3 : Import Premiere Pro
- Importer le `.mov` dans le projet
- Placer au-dessus de la video sur la timeline
- **Alpha natif** : pas besoin de keying ni d'interpretation
- Alpha interpretation : "Alpha direct" (straight) — deja correct par defaut

---

## 10. Stack technique de l'extension

### API OpenAI
- **Client** : `src/scripts/api/openai.js` (classe `OpenAIClient`)
- **Endpoint** : `https://api.openai.com/v1/responses`
- **Modele** : `gpt-5-mini`
- **Config** : `src/scripts/utils/constants.js` (objet `OPENAI`)
- **Cle API** : stockee dans `localStorage` sous cle `TokenOpenAI`
- **Max tokens** : 9000
- **Reasoning effort** : `low`
- **Retry** : 3 tentatives max, delai croissant entre retries

### Template Loader
- **Fichier** : `src/scripts/utils/templateLoader.js`
- **Methode** : XHR synchrone vers `file:///` (compatible CEP)
- **Fonction** : `loadTemplate(relativePath)` → string ou null
- **Chemins templates** : definis dans `TEMPLATE_PATHS` (constants.js)

### Fonctionnalites du client OpenAI
| Methode | Usage |
|---|---|
| `call(params)` | Appel generique avec retry (stream ou non) |
| `request(body)` | HTTP POST standard |
| `requestStream(body, onDelta)` | SSE streaming avec accumulation |
| `generateTitles()` | Sous-titres → titres animes |
| `generateTitlesBatch()` | Idem, par lots |
| `analyzeBrolls()` | Sous-titres → suggestions B-roll |
| `analyzeSmartCut()` | Transcription → segments JSONL streaming |
| `selectTitleWords()` | Sous-titres autour du curseur → mots pour titre |

### Templates existants (dans `config/templates/`)
| Fichier | Usage |
|---|---|
| `lottie-creative-director.md` | **NOUVEAU** — Prompt 1 Lottie (scenario creatif) |
| `lottie-style-impact.md` | **REECRIT** — Prompt 2 Lottie (JSON generator) |
| `titles-system-prompt.md` | Generation de titres animes |
| `add-title-here-prompt.md` | Selection de mots pour titre ponctuel |
| `brolls-system-prompt.md` | Analyse B-roll |
| `smart-cut-system-prompt.md` | Smart Cut mono-sequence |
| `smart-cut-multi-system-prompt.md` | Smart Cut multi-sequences |
| `smart-cut-viral-shorts.md` | Intention : shorts viraux |
| `smart-cut-punchlines.md` | Intention : punchlines |
| `smart-cut-moments-cles.md` | Intention : moments cles |
| `smart-cut-tutoriels.md` | Intention : tutoriels |

---

## 11. TODO — Prochaines etapes

### Priorite 1 : Brancher les 2 prompts dans le code JS
1. Ajouter les chemins templates dans `TEMPLATE_PATHS` (constants.js) :
   - `LOTTIE_CREATIVE_DIRECTOR: 'config/templates/lottie-creative-director.md'`
   - `LOTTIE_GENERATOR: 'config/templates/lottie-style-impact.md'`
2. Creer une methode `generateLottieAnimation(subtitle)` dans `OpenAIClient` :
   - Appel 1 : `loadTemplate(LOTTIE_CREATIVE_DIRECTOR)` comme system prompt, subtitle comme user → parse JSON scenario
   - Appel 2 : `loadTemplate(LOTTIE_GENERATOR)` comme system prompt, scenario JSON comme user → JSON Lottie brut
3. Parser le JSON Lottie, le charger dans lottie-web pour preview

### Priorite 2 : Tester la qualite
- Tester avec 10+ sous-titres varies
- Verifier que GPT respecte le scenario du Creative Director
- Verifier que les techniques sont variees d'un sous-titre a l'autre
- Valider que les animations sont visuellement reconnaissables

### Priorite 3 : Integrer dans l'extension CEP
- Ajouter une UI dans l'extension pour generer des overlays Lottie
- Pipeline complet : sous-titre → 2 appels API → preview → export frames → ffmpeg → .mov
- Possiblement : automatiser l'import dans Premiere Pro via JSX

### Priorite 4 : Ajustements
- Ajuster le menu de techniques selon les resultats
- Possiblement ajouter des techniques
- Affiner les anti-patterns si GPT fait des erreurs recurrentes

---

## 12. Fichiers cles du projet

```
Productivity/
├── config/templates/
│   ├── lottie-creative-director.md    ← Prompt 1 (NOUVEAU)
│   ├── lottie-style-impact.md         ← Prompt 2 (REECRIT v2)
│   ├── titles-system-prompt.md
│   ├── brolls-system-prompt.md
│   ├── smart-cut-*.md
│   └── add-title-here-prompt.md
├── src/scripts/
│   ├── api/openai.js                  ← Client API (a etendre)
│   ├── utils/constants.js             ← Config + TEMPLATE_PATHS (a etendre)
│   └── utils/templateLoader.js        ← Chargeur de templates .md
├── bin/ffmpeg.exe                     ← ffmpeg pour conversion
├── test-styles-comparison.html        ← Preview + export frames (v1, a migrer)
├── export-lottie-mov.bat              ← Script dezip + ffmpeg → .mov
└── LOTTIE-CONTEXT.md                  ← CE FICHIER
```

---

## 13. Exemple complet bout-en-bout

### Input
Sous-titre : `"tu vas encore manquer de temps"`

### Prompt 1 → Scenario Creative Director
```json
{
  "subtitle": "tu vas encore manquer de temps",
  "object": {
    "name": "horloge",
    "why": "temps = horloge, universellement reconnaissable",
    "parts": [
      {"name": "cadran", "shape": "cercle stroke", "detail": "400px, stroke 12px"},
      {"name": "ticks", "shape": "rectangles repeater", "detail": "12 ticks, rotation 30deg"},
      {"name": "aiguille minutes", "shape": "rectangle", "detail": "12x145px"},
      {"name": "centre", "shape": "cercle fill", "detail": "28px"}
    ]
  },
  "story": "L'horloge se dessine, les aiguilles accelerent frenetiquement, dissolution.",
  "techniques": {
    "entrance": "trim-draw",
    "action": "rotate-accelerate",
    "exit": "dissolve",
    "effects": ["particles"]
  },
  "layers": [
    {"name": "clock-face", "role": "hero"},
    {"name": "clock-ticks", "role": "detail"},
    {"name": "minute-hand", "role": "action"},
    {"name": "center-dot", "role": "accent"},
    {"name": "particle-1", "role": "effect"},
    {"name": "particle-2", "role": "effect"},
    {"name": "particle-3", "role": "effect"}
  ],
  "climax_frame": 32
}
```

### Prompt 2 → JSON Lottie (7 layers, 0 glow)
- clock-face : cercle 400px, trim path draw 0→100 en 16 frames
- clock-ticks : 12 rectangles via repeater (rotation 30°), scale pop entree
- minute-hand : rotation 0→1080° (accelere exponentiellement)
- center-dot : cercle 28px, scale overshoot 0→140→100
- particle-1/2/3 : cercles 18-22px, jaillissent au climax frame 32, stagger +3f
- Sortie dissolve : chaque layer opacity→0 avec stagger 2-3f, canvas vide a frame 90

### Export
1. Charger le JSON dans lottie-web → preview SVG
2. Export 90 frames PNG 1000x1000 → ZIP
3. ffmpeg ProRes 4444 avec alpha → `.mov`
4. Import Premiere → overlay au-dessus de la video
