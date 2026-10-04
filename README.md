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
- 5 cartes générées (Cavernes, Volcan, Gruyère, Forteresse, Plein air) avec aperçu exact dans le salon.
- Options avancées : gravité, portée du grappin, vitesse, points de vie, dégâts, taille des explosions, régénération, munitions illimitées, auto-dégâts, acide.

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
- `src/engine/Terrain.ts` — génération des cartes, terrain destructible
- `src/net/` — connexion PeerJS et format des messages
- `src/ui/` — menus et salon, HUD, grimoire
- `src/weapons/WeaponRegistry.ts` — réglages des sorts
