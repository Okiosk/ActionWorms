# Action Worms (Liero Web P2P - Jusqu'à 8 Joueurs)

Clone fidèle, moderne et dynamique du jeu culte **Liero** (1998), jouable directement dans votre navigateur web en multijoueur **100% Peer-to-Peer (WebRTC)** jusqu'à **8 joueurs en simultané**.

---

## 🌐 Multijoueur Peer-to-Peer (WebRTC)

- **Capacité de 2 à 8 joueurs** : 1 Hôte + jusqu'à 7 invités connectés en direct.
- **Créer un salon (Hôte)** : Génère un code court ou un lien d'invitation direct en un clic (`#room=liero-xxxx`).
- **Rejoindre un salon** : Entrez le code ou cliquez directement sur le lien partagé par votre ami.
- **Zéro serveur de jeu** : Toutes les données et la physique transitent directement entre navigateurs via les DataChannels WebRTC de PeerJS.

---

## ⚙️ Modificateurs de Partie (Configurés par l'Hôte dans le Salon)

Avant de lancer le combat, l'hôte peut personnaliser les règles du match :

1. **🌍 Gravité** :
   - *Normale* (1.0x)
   - *🌙 Lunaire* (0.35x - sauts gigantesques et planés)
   - *⚓ Élevée* (1.8x - combats intenses au sol)
   - *🚀 Zéro-G* (0.0x - dérive spatiale propulsée par le recul et le grappin !)
2. **🪢 Grappin Ninja (Ninja Rope)** :
   - *Standard* (Portée 220px)
   - *♾️ Portée Infinie* (Accrochage à n'importe quelle distance à travers le niveau)
3. **⚡ Vitesse des Vers** :
   - *Normale* (1.0x) | *🔥 Turbo* (1.5x) | *🐢 Tactique* (0.75x)
4. **❤️ Santé Maximale** :
   - *100 PV* (Standard) | *💀 50 PV* (Hardcore / One-shot) | *🛡️ 200 PV* (Titans)
5. **♾️ Munitions & Rechargement** :
   - *Standard* (Clips limités et temps de rechargement)
   - *💥 Tirs Illimités* (Tir continu sans aucun rechargement)
6. **🏆 Objectif de Frags** :
   - 5, 10 (par défaut), 15, 20 ou 30 frags

---

## 🎯 Contrôles

| Action | Touche(s) |
|---|---|
| **Déplacement** | `Q` / `D` ou `A` / `D` ou `Flèches Gauche/Droite` |
| **Sauter** | `Z` / `W` / `Espace` ou `Flèche Haut` |
| **Viser** | Déplacement du curseur de la souris |
| **Tirer** | Clic Gauche ou `F` ou `Entrée` |
| **Ninja Rope (Grappin)** | Clic Droit ou `E` ou `Shift` (maintenir pour s'accrocher et se balancer, relâcher pour effet fronde *slingshot*) |
| **Changer d'arme** | Touches `1` à `5` ou Molette de la souris |
| **Plein Écran** | Bouton `⛶ Plein Écran` en haut au centre |

---

## 🚀 Arsenal & Armes (13 Armes)

Chaque joueur peut personnaliser son paquetage de **5 armes** parmi les 13 disponibles :

1. 🚀 **Bazooka** : Roquette lourde avec traînée de fumée et grosse détonation.
2. 🎯 **Missile Guidé** : Missile autoguidé qui traque le ver ennemi le plus proche.
3. ⚡ **Heavy Railgun** : Rayon cinétique supersonique perforant la terre sur toute la carte.
4. 🔮 **Balle Rebondissante** : Sphère hyper-élastique qui ricoche jusqu'à 15 fois à vive allure dans les galeries.
5. 💉 **Fléchettes Toxiques** : Salve de 3 aiguilles empoisonnées perforantes provoquant des hémorragies.
6. 🌀 **Canon Vortex** : Singularité gravitationnelle aspirant vers et débris avant d'imploser.
7. ⚡ **Mini-gun** : Mitrailleuse lourde à très haute cadence criblant le terrain.
8. 💥 **Fusil à pompe** : Salve dévastatrice de 8 plombs à courte et moyenne portée.
9. 💣 **Grenade** : Projectile à rebonds multiples et mèche de 2 secondes.
10. 🍌 **Chiquita Bomb** : Bombe à fragmentation se divisant en 6 sous-bombes explosives.
11. 🔷 **Canon Gauss** : Faisceau perçant haute vélocité.
12. ⚠️ **Mine sautante** : Piège explosif se déclenchant à l'approche d'un ennemi.
13. 🔥 **Lance-flammes** : Jet continu de flammes consumant la roche et les vers.

---

## 🎨 Palette des 8 Vers

Chaque joueur se voit attribuer une couleur distincte :
1. 🟩 Vert (`#44cc44`)
2. 🟦 Bleu (`#3388ff`)
3. 🟥 Rouge (`#ff4444`)
4. 🟨 Jaune (`#ffcc22`)
5. 🟪 Violet (`#b844ff`)
6. 🟧 Orange (`#ff8822`)
7. 🩵 Cyan (`#22e8dd`)
8. 🩷 Rose (`#ff44aa`)

---

## 🛠️ Installation & Lancement en local

```bash
git clone https://github.com/Okiosk/ActionWorms.git
cd ActionWorms
npm install
npm run dev
```

Ouvrez l'URL locale dans plusieurs onglets ou navigateurs pour tester le multijoueur P2P en direct !
