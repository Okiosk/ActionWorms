# Action Worms (Liero Web P2P)

Clone fidèle, moderne et dynamique du jeu culte **Liero** (1998), jouable directement dans votre navigateur web en multijoueur **Peer-to-Peer (WebRTC)**, en **local à 2 joueurs sur un même clavier**, ou en **solo contre des Bots IA**.

---

## 🕹️ Modes de Jeu

1. **🤖 Partie Solo vs IA** : Affrontez un ver contrôlé par une intelligence artificielle capable de creuser, viser avec anticipation, utiliser le grappin et changer d'arme selon la distance.
2. **👥 2 Joueurs Local (1 Clavier)** : Duel en face à face sur la même machine.
3. **🌐 Multijoueur en Ligne Peer-to-Peer (WebRTC)** :
   - **Créer un salon (Hôte)** : Génère un code court ou un lien d'invitation direct en un clic (`#room=liero-xxxx`).
   - **Rejoindre un salon** : Entrez le code de votre ami ou ouvrez directement le lien partagé.
   - *Aucun serveur de jeu centralisé requis : les données transitent directement de navigateur à navigateur grâce aux DataChannels WebRTC via PeerJS.*

---

## 🎯 Contrôles

### Joueur 1 / Mode Solo / Mode P2P
| Action | Touche(s) |
|---|---|
| **Déplacement** | `Q` / `D` ou `A` / `D` (ou `Flèches Gauche/Droite`) |
| **Sauter** | `Z` / `W` / `Espace` |
| **Viser** | Déplacement du curseur de la souris ou `Haut` / `Bas` |
| **Tirer** | Clic Gauche ou `F` ou `Entrée` |
| **Ninja Rope (Grappin)** | Clic Droit ou `E` ou `Shift` (maintenir pour s'accrocher et se balancer, relâcher pour lâcher) |
| **Changer d'arme** | Touches `1` à `5` ou Molette de la souris |

### Joueur 2 (Mode Local 2P)
| Action | Touche(s) |
|---|---|
| **Déplacement** | `Flèche Gauche` / `Flèche Droite` |
| **Sauter** | `Flèche Haut` ou `Pavé Num 5` |
| **Viser Haut / Bas** | `Pavé Num 8` / `Pavé Num 2` ou `I` / `K` |
| **Tirer** | `Entrée` ou `Pavé Num Entrée` ou `P` |
| **Ninja Rope (Grappin)** | `Pavé Num 0` ou `Shift Droit` ou `O` |
| **Sélection d'arme** | `Pavé Num 1`, `2`, `3` ou `L` |

---

## 🚀 Arsenal & Armes

Chaque joueur peut personnaliser son paquetage de **5 armes** parmi les 8 disponibles :

- 🚀 **Bazooka** : Roquette rapide avec traînée de fumée et grosse détonation.
- ⚡ **Mini-gun** : Mitrailleuse lourde à haute cadence de tir criblant la roche et la terre.
- 💥 **Fusil à pompe** : Salve dévastatrice de 8 plombs à moyenne et courte portée.
- 💣 **Grenade** : Projectile à rebonds multiples et mèche à retardement de 2 secondes.
- 🍌 **Chiquita Bomb** : Bombe à fragmentation se divisant en 6 sous-bombes explosives.
- 🔷 **Canon Gauss** : Faisceau d'énergie cinétique instantané perçant les parois et vaporisant la matière.
- ⚠️ **Mine sautante** : Piège explosif réactif à la proximité des ennemis.
- 🔥 **Lance-flammes** : Jet continu de flammes embrasant le terrain et les vers.

---

## ⚙️ Architecture Technique

- **Terrain Destructible** : Moteur de voxels/bitmaps 2D 800x500 avec rendu accéléré Canvas Offscreen. Découpe circulaire instantanée (`destination-out`) et projection persistante de taches de sang sur la terre.
- **Physique Pendulaire (Ninja Rope)** : Modélisation des contraintes de corde tendue avec transfert d'énergie cinétique angulaire.
- **Réseau P2P WebRTC** : Architecture Host-Autoritaire synchronisant les entrées à 60Hz et les états / cratères / sons via PeerJS.
- **Synthèse Audio Procédurale** : Moteur Web Audio API autonome générant en temps réel les bruits d'explosions, tirs, grappin, creusage et cris sans aucun fichier audio externe lourd à charger.

---

## 💻 Démarrage en Développement Local

```bash
# Installer les dépendances
npm install

# Lancer le serveur de développement Vite
npm run dev

# Compiler pour la production
npm run build
```
Accédez ensuite à `http://localhost:3000` dans votre navigateur.

---

## 🚀 Déploiement sur GitHub Pages

### Méthode Automatique (Recommandée - GitHub Actions)
1. Poussez vos modifications sur la branche `main` (`git add .`, `git commit -m "Deploy"`, `git push`).
2. Sur votre dépôt GitHub, allez dans **Settings > Pages**.
3. Sous **Build and deployment > Source**, sélectionnez **GitHub Actions**.
4. Le workflow se lance automatiquement et le site sera accessible en quelques secondes sur :
   `https://okiosk.github.io/ActionWorms/`

### Méthode Directe (gh-pages)
Vous pouvez également publier directement en ligne de commande :
```bash
npm run deploy
```
Puis dans **Settings > Pages > Source**, choisissez la branche `gh-pages` et dossier `/ (root)`.
