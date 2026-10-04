# Arcane Worms — duel de petits sorciers (Liero-like P2P)

Jeu d'action façon **Liero** jouable dans le navigateur, en multijoueur **Peer-to-Peer (WebRTC / PeerJS)** jusqu'à **8 joueurs**, avec des sorciers, des bâtons et des sorts.

## Jouer

1. **Créer une partie** : tu deviens l'hôte et tu obtiens un code (`liero-xxxxxx`) et un lien d'invitation.
2. **Rejoindre** : colle le code ou ouvre le lien partagé par l'hôte. On peut aussi rejoindre une partie déjà lancée.
3. Avant chaque apparition, choisis ton sort dans le **grimoire** (le dernier sort est pré-sélectionné : `Entrée` pour repartir).

Aucun serveur de jeu : l'hôte simule la partie et l'envoie aux autres joueurs 60 fois par seconde. Chaque joueur prédit localement les mouvements de son propre sorcier, donc les déplacements restent fluides même avec de la latence.

## Contrôles

| Action | Touches |
|---|---|
| Se déplacer | `Q` / `D`, `A` / `D` ou flèches |
| Sauter | `Z`, `W`, `Espace` ou flèche haut |
| Viser | Souris |
| Lancer le sort | Clic gauche ou `F` |
| Grappin | Clic droit, `E` ou `Shift` (maintenir) — `Z` / `S` pour monter / descendre, relâcher pour l'effet fronde |
| Son | `M` |
| Menu pause | `Échap` |

## Modes et options (choisis par l'hôte)

- **Mêlée** (chacun pour soi), **Équipes** (Rouge contre Bleu, pas de tir ami) ou **Colline** (rester seul dans la zone centrale).
- 6 cartes générées avec aperçu exact dans le salon (bouton « Autre carte » pour une variante).
- Options avancées : gravité, portée du grappin, vitesse, points de vie, dégâts, taille des explosions, régénération, munitions illimitées, auto-dégâts, acide et lave.

## Cartes

| Carte | Ambiance |
|---|---|
| 💎 Grottes | Cavernes organiques, lacs souterrains, filons de cristal |
| 🌋 Volcan | Lac de lave, cône à percer jusqu'à la cheminée de magma, ponts de bois inflammables |
| 🌳 Forêt | Arbres géants, rivière, terriers, champignons-trampolines |
| 🏰 Citadelle | Deux châteaux symétriques, douves, pont-levis, salles au trésor |
| 🏔️ Glacier | Pentes de glace glissantes, lacs gelés, grottes de glace |
| ☁️ Archipel | Îles flottantes au-dessus de l'océan |

## Matériaux

| Matériau | Effet |
|---|---|
| Terre | Destructible |
| Roche | Indestructible |
| Acide | Ronge les sorciers qui marchent dessus |
| 🧊 Glace | Destructible et **glissante** |
| 💧 Eau | Ralentit tout, on y nage (saut pour en sortir), éteint le feu ; l'Orbe de Givre la gèle |
| 🌋 Lave | Liquide qui **enflamme** et blesse |
| 💎 Cristal | Destructible ; le faire exploser **rapporte de l'or** |
| 🪵 Bois | Résiste aux explosions, mais les sorts de **feu** le brûlent entièrement |
| 🍄 Champignon | Trampoline : fait rebondir les sorciers (saut = plus haut) et renvoie les sorts |

## Graphismes

Le terrain est simulé pixel par pixel (destructions précises, identiques chez tous les joueurs), mais il est **affiché en rendu lisse** par le GPU (WebGL2) : contours arrondis et anti-aliasés, textures procédurales sans pixels visibles, contour sombre et lumière sur les surfaces. Seules les zones détruites sont renvoyées à la carte graphique, donc les explosions ne coûtent presque rien.

Sans carte graphique (rendu logiciel) ou sans WebGL2, le jeu passe automatiquement en rendu « pixel ». Le choix peut être forcé dans le menu pause (`Échap` → Graphismes).

Les sorciers sont des personnages peints et animés : repos, course, saut, coup de bâton au lancer, recul quand ils sont touchés, chute à la mort. La robe prend la couleur du joueur. Les sorts et explosions utilisent des sprites de particules lumineux, et le grimoire affiche une icône peinte pour chaque sort.

Le sang gicle dans la direction du coup. Il tache tous les matériaux solides, roche comprise, et coule le long des murs. Les taches disparaissent avec le terrain détruit.

Les auteurs et licences des images sont listés dans [CREDITS.md](CREDITS.md).

## Sorts

19 sorts, chacun avec un effet unique. On gagne de l'or en éliminant des sorciers (+75) et en mourant (+25).

| Sort | Effet |
|---|---|
| 🔥 Boule de Feu (gratuit) | Projectile explosif polyvalent |
| ✨ Éclats Arcaniques (gratuit) | Rafale rapide de petits cristaux |
| ⚡ Choc d'Étincelles (gratuit) | 8 étincelles en éventail, à bout portant |
| 🔮 Orbe du Chaos | Rebondit puis explose après 2 s |
| 🐉 Souffle du Dragon | Flammes qui montent et **enflamment** la cible (dégâts sur 3 s) |
| 🪃 Chakram Envoûté | Revient vers son lanceur, touche à l'aller et au retour |
| 🧱 Rempart Tellurique | **Crée de la terre** : bouche un tunnel, construit un abri |
| 🪨 Rune Piégée | Piège collé au sol, explose à l'approche |
| 🩸 Sangsue Écarlate | **Soigne** le lanceur des dégâts infligés |
| 🌀 Translocation | **Téléporte** le lanceur là où l'orbe s'arrête |
| ⭐ Comète Étoilée | Se divise en 6 éclats explosifs |
| 🧪 Fiole d'Alchimiste | Laisse une **mare d'acide** permanente |
| 👻 Feu Follet Traqueur | Poursuit l'ennemi le plus proche |
| ❄️ Orbe de Givre | **Gèle** les sorciers proches 3 s |
| 🛡️ Égide Miroir | Bouclier de 2,5 s qui **renvoie** les sorts ennemis |
| 🌩️ Arc Foudroyant | Éclair qui **rebondit** sur jusqu'à 3 sorciers |
| ☄️ Pluie de Météores | Marque une cible, des **météores tombent du plafond** |
| 🔱 Foudre Divine | Rayon qui traverse terre et roche |
| 🕳️ Singularité du Néant | Trou noir qui **aspire** les ennemis |

## Développement

```bash
npm install
npm run dev     # serveur local
npm run build   # vérification TypeScript + build de production dans dist/
```

Ouvre l'URL locale dans plusieurs onglets pour tester le multijoueur. Le déploiement sur GitHub Pages se fait automatiquement à chaque push sur `main` (`.github/workflows/deploy.yml`).

### Organisation du code

- `src/engine/Game.ts` — boucle de jeu, logique hôte/client, réseau, rendu
- `src/engine/Worm.ts`, `NinjaRope.ts`, `Projectile.ts` — physique du sorcier, du grappin et des sorts
- `src/engine/Sprites.ts` — sprites peints : sorcier animé (recoloré par joueur), particules, icônes
- `src/engine/Particles.ts` — particules : sang, fumée, flammes, étincelles, explosions
- `src/engine/Terrain.ts` — terrain destructible multi-matériaux (et rendu pixel de secours)
- `src/engine/TerrainGL.ts` — rendu lisse du terrain en WebGL2 (shader)
- `src/engine/MapGenerator.ts` — génération des 6 cartes
- `src/net/` — connexion PeerJS et format des messages
- `src/ui/` — menus et salon, HUD, grimoire
- `src/weapons/WeaponRegistry.ts` — réglages des sorts
- `src/assets/` — images (voir [CREDITS.md](CREDITS.md))
