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
- 8 cartes générées avec aperçu exact dans le salon (bouton « Autre carte » pour une variante).
- Points de vie (50 / 100 / 200) et dégâts (×½ / ×1 / ×2).
- **Mutateurs** : des cartes à activer ou désactiver d'un clic (🎲 « Surprise » en active 3 au hasard). Les mutateurs actifs sont rappelés en jeu sous l'objectif.

| Mutateur | Effet |
|---|---|
| 🌙 Gravité lunaire | Sauts immenses, chutes lentes |
| ⚡ Turbo | Sorciers 50 % plus rapides |
| 🦘 Super-sauts | Des bonds de kangourou |
| 🪢 Grappin infini | Le grappin s'accroche à n'importe quelle distance |
| 💥 Méga-explosions | Cratères et souffles ×2 |
| ⏩ Frénésie | Les sorts se relancent 2,5 fois plus vite |
| 🧛 Vampirisme | Chaque dégât infligé soigne de moitié |
| ❤️ Régénération | +3 PV par seconde |
| 🎱 Ricochets | Tous les sorts rebondissent 3 fois avant d'exploser |
| 🎲 Sorts aléatoires | Après chaque lancer, le sort change au hasard |
| 💣 Martyrs | Les sorciers explosent en mourant |
| 👻 Fantômes | Ennemis invisibles, sauf quand ils lancent un sort ou sont touchés |
| 🌬️ Tempête | Un vent qui tourne pousse les sorts et les sorciers en l'air |
| 🌋 Lave montante | Après 30 s, la lave monte du fond de la carte |
| 💰 Grimoire ouvert | Tous les sorts sont gratuits |
| 🛡️ Pas d'auto-dégâts | Ses propres sorts ne blessent pas |
| 🚫 Sans acide ni lave | L'acide disparaît, la lave devient de l'eau |

## Cartes

| Carte | Ambiance |
|---|---|
| 💎 Grottes | Cavernes organiques, lacs souterrains, filons de cristal |
| 🌋 Volcan | Lac de lave, cône à percer jusqu'à la cheminée de magma, ponts de bois inflammables |
| 🌳 Forêt | Arbres géants, rivière, terriers, champignons-trampolines |
| 🏰 Citadelle | Deux châteaux symétriques, douves, pont-levis, salles au trésor |
| 🏔️ Glacier | Pentes de glace glissantes, lacs gelés, grottes de glace |
| ☁️ Archipel | Îles flottantes au-dessus de l'océan |
| 🏜️ Pyramide | Dunes qui s'effondrent dans les grottes, pyramide au tombeau piégé, oasis |
| ⛏️ Mine | Galeries étayées sur 4 niveaux, barils de poudre, filons de cristal |

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
| 🏖️ Sable | Destructible ; **s'effondre** quand plus rien ne le tient (il coule en tas, s'enfonce dans l'eau) |
| 🧨 Poudre explosive | Destructible ; une explosion ou une flamme la fait **sauter en chaîne** |

## Graphismes

Le terrain est simulé pixel par pixel (destructions précises, identiques chez tous les joueurs), mais il est **affiché en rendu lisse** par le GPU (WebGL2) : contours arrondis et anti-aliasés, textures procédurales sans pixels visibles, contour sombre et lumière sur les surfaces. Seules les zones détruites sont renvoyées à la carte graphique, donc les explosions ne coûtent presque rien.

Sans carte graphique (rendu logiciel) ou sans WebGL2, le jeu passe automatiquement en rendu « pixel ». Le choix peut être forcé dans le menu pause (`Échap` → Graphismes).

Les sorciers sont des personnages peints et animés : repos, course, saut, coup de bâton au lancer, recul quand ils sont touchés, chute à la mort. La robe prend la couleur du joueur. Les sorts et explosions utilisent des sprites de particules lumineux, et le grimoire affiche une icône peinte pour chaque sort.

Le sang gicle dans la direction du coup. Il tache tous les matériaux solides, roche comprise, et coule le long des murs. Les taches disparaissent avec le terrain détruit.

Pour le ressenti (« juice ») :
- **Caméra** : elle secoue avec les explosions proches et les coups reçus, recule quand tu lances un sort et regarde un peu dans la direction visée. Les secousses se désactivent dans le menu pause.
- **Sorciers** : ils s'écrasent à l'atterrissage, s'étirent au saut, flashent en blanc quand ils sont touchés et soulèvent de la poussière en courant.
- **Chiffres flottants** : dégâts, soins, or gagné et « K.O. ! ».
- **Effets d'écran** : bords rouges quand tu es touché, pulsation rouge quand ta vie est basse, éclair lumineux pour les grosses explosions.
- **Annonces** : « Éliminé ! », puis « Double élimination ! », « Triple ! »… quand tu enchaînes les éliminations.

Les auteurs et licences des images sont listés dans [CREDITS.md](CREDITS.md).

## Sorts

26 sorts, chacun avec un effet unique. Pas de munitions ni de rechargement : chaque sort a seulement un court délai entre deux lancers. On gagne de l'or en éliminant des sorciers (+75) et en mourant (+25).

| Sort | Effet |
|---|---|
| 🔥 Boule de Feu (gratuit) | Projectile explosif polyvalent, brûle le bois |
| 🐸 Crapauds Kamikazes (gratuit) | 3 crapauds qui sautillent vers l'ennemi le plus proche et explosent à son contact |
| 🪃 Chakram Envoûté (gratuit) | Revient vers son lanceur, touche à l'aller et au retour |
| 🐉 Souffle du Dragon | Flammes continues qui **enflamment** la cible (dégâts sur 3 s) |
| 🧱 Rempart Tellurique | **Crée de la terre** : bouche un tunnel, construit un abri |
| 🔀 Permutation | Si l'orbe touche un sorcier, vous **échangez vos places** |
| 🪨 Rune Piégée | Piège collé au sol, explose à l'approche |
| 🍺 Philtre d'Ivresse | 6 s de **commandes gauche/droite inversées** et de visée qui tangue |
| 🫧 Bulle Farceuse | La cible s'envole dans une **bulle** pendant 3 s (elle éclate au plafond ou si on la touche) |
| 🩸 Sangsue Écarlate | **Soigne** le lanceur des dégâts infligés |
| 🌀 Translocation | **Téléporte** le lanceur là où l'orbe s'arrête |
| ⭐ Comète Étoilée | Se divise en 6 éclats explosifs |
| 🐑 Métamorphose Ovine | Transforme la cible en **mouton** 6 s : ni sort ni grappin, juste des bonds et des bêlements |
| ☠️ Fiole Pestilentielle | Libère un **nuage toxique** qui se répand dans les galeries, empoisonne puis se dissipe (7 s) |
| 👻 Feu Follet Traqueur | Poursuit l'ennemi le plus proche |
| ❄️ Orbe de Givre | **Gèle** les sorciers proches 3 s |
| 🛡️ Égide Miroir | Bouclier de 2,5 s qui **renvoie** les sorts ennemis… et les éclairs |
| ⚡ Mains Foudroyantes | Maintenir le clic : **arcs électriques** continus qui électrocutent et soulèvent les sorciers devant soi |
| ☄️ Pluie de Météores | Marque une cible, des **météores tombent du ciel** |
| 🔱 Foudre Divine | Rayon qui traverse terre et roche |
| 🕳️ Singularité du Néant | Trou noir qui **aspire** les ennemis |
| 🥔 Patate Chaude | Colle au premier sorcier touché, **saute sur quiconque il touche**, explose 4 s après la première prise |
| 🎭 Sosie Piégé | Un **faux toi** (même couleur, même nom) qui marche, attire les sorts à tête chercheuse et explose si on l'approche |
| 🌀 Portails Jumeaux | Deux portails liés : **tout ce qui entre dans l'un sort de l'autre** (sorciers et sorts), 25 s |
| 🌪️ Tornade | Tourbillon qui roule au sol, **aspire et transporte** les sorciers puis les projette |
| 🪐 Anomalie Gravitationnelle | Zone où **la gravité s'inverse** pendant 6 s |

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
- `src/engine/GasCloud.ts`, `ForceLightning.ts` — nuage toxique et arcs électriques
- `src/engine/Mutators.ts` — liste des mutateurs et règles qui en découlent
- `src/engine/Env.ts` — forces du monde partagées (anomalies de gravité, vent)
- `src/engine/Terrain.ts` — terrain destructible multi-matériaux (et rendu pixel de secours)
- `src/engine/TerrainGL.ts` — rendu lisse du terrain en WebGL2 (shader)
- `src/engine/MapGenerator.ts` — génération des 6 cartes
- `src/net/` — connexion PeerJS et format des messages
- `src/ui/` — menus et salon, HUD, grimoire
- `src/weapons/WeaponRegistry.ts` — réglages des sorts
- `src/assets/` — images (voir [CREDITS.md](CREDITS.md))
