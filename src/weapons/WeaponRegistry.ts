import { WeaponDef, WeaponId } from './WeaponDef';

export const WEAPON_REGISTRY: Record<WeaponId, WeaponDef> = {
  bazooka: {
    id: 'bazooka',
    name: 'Bazooka',
    description: 'Roquette lourde avec traînée de fumée et grosse détonation.',
    icon: '🚀',
    reloadTime: 38, clipSize: 1, clipReloadTime: 40, recoil: 3.5,
    projectileSpeed: 6.8, spread: 0.02, damage: 48, craterRadius: 20,
    bounces: 0, fuseFrames: 180, gravityScale: 0.25
  },
  minigun: {
    id: 'minigun',
    name: 'Mini-gun',
    description: 'Mitrailleuse à très haute cadence criblant le terrain.',
    icon: '⚡',
    reloadTime: 4, clipSize: 30, clipReloadTime: 65, recoil: 0.4,
    projectileSpeed: 9.5, spread: 0.12, damage: 7, craterRadius: 4,
    bounces: 0, fuseFrames: 90, gravityScale: 0.15
  },
  shotgun: {
    id: 'shotgun',
    name: 'Fusil à pompe',
    description: 'Salve de 8 plombs meurtrière à courte et moyenne portée.',
    icon: '💥',
    reloadTime: 35, clipSize: 2, clipReloadTime: 50, recoil: 4.2,
    projectileSpeed: 8.5, spread: 0.22, damage: 13, craterRadius: 4,
    bounces: 0, fuseFrames: 60, gravityScale: 0.2, pelletCount: 8
  },
  grenade: {
    id: 'grenade',
    name: 'Grenade',
    description: 'Grenade rebondissante avec mèche de 2 secondes.',
    icon: '💣',
    reloadTime: 32, clipSize: 2, clipReloadTime: 45, recoil: 1.5,
    projectileSpeed: 5.5, spread: 0.05, damage: 42, craterRadius: 22,
    bounces: 5, fuseFrames: 110, gravityScale: 0.75
  },
  chiquita: {
    id: 'chiquita',
    name: 'Chiquita Bomb',
    description: 'Bombe à fragmentation qui se divise en 6 sous-bombes.',
    icon: '🍌',
    reloadTime: 55, clipSize: 1, clipReloadTime: 60, recoil: 2.5,
    projectileSpeed: 5.0, spread: 0.04, damage: 25, craterRadius: 16,
    bounces: 3, fuseFrames: 75, gravityScale: 0.65, splitCount: 6
  },
  gauss: {
    id: 'gauss',
    name: 'Canon Gauss',
    description: 'Rayon cinétique ultra-perforant qui vaporise terre et vers.',
    icon: '🔷',
    reloadTime: 45, clipSize: 1, clipReloadTime: 55, recoil: 5.0,
    projectileSpeed: 25.0, spread: 0.0, damage: 65, craterRadius: 7,
    bounces: 0, fuseFrames: 30, gravityScale: 0.0, piercing: true
  },
  mine: {
    id: 'mine',
    name: 'Mine sautante',
    description: "Piège qui explose à proximité d'un ennemi.",
    icon: '⚠️',
    reloadTime: 40, clipSize: 2, clipReloadTime: 55, recoil: 1.0,
    projectileSpeed: 3.5, spread: 0.08, damage: 55, craterRadius: 24,
    bounces: 3, fuseFrames: 900, gravityScale: 0.8
  },
  flamer: {
    id: 'flamer',
    name: 'Lance-flammes',
    description: 'Jet de flammes continues qui consume les vers.',
    icon: '🔥',
    reloadTime: 3, clipSize: 40, clipReloadTime: 70, recoil: 0.2,
    projectileSpeed: 4.8, spread: 0.18, damage: 5, craterRadius: 4,
    bounces: 0, fuseFrames: 40, gravityScale: 0.05
  },
  homing_missile: {
    id: 'homing_missile',
    name: 'Missile Guidé',
    description: 'Roquette autoguidée traquant le ver ennemi le plus proche.',
    icon: '🎯',
    reloadTime: 45, clipSize: 1, clipReloadTime: 50, recoil: 3.2,
    projectileSpeed: 5.5, spread: 0.05, damage: 46, craterRadius: 20,
    bounces: 0, fuseFrames: 180, gravityScale: 0.1, homing: true
  },
  railgun: {
    id: 'railgun',
    name: 'Heavy Railgun',
    description: 'Rayon cinétique supersonique perforant la terre sur toute la carte.',
    icon: '💠',
    reloadTime: 50, clipSize: 1, clipReloadTime: 60, recoil: 5.5,
    projectileSpeed: 38.0, spread: 0.0, damage: 70, craterRadius: 8,
    bounces: 0, fuseFrames: 25, gravityScale: 0.0, piercing: true
  },
  bouncy_ball: {
    id: 'bouncy_ball',
    name: 'Balle Rebondissante',
    description: "Sphère hyper-élastique qui ricoche jusqu'à 15 fois.",
    icon: '🔮',
    reloadTime: 22, clipSize: 3, clipReloadTime: 45, recoil: 1.8,
    projectileSpeed: 9.0, spread: 0.08, damage: 35, craterRadius: 14,
    bounces: 15, fuseFrames: 220, gravityScale: 0.45
  },
  dart_gun: {
    id: 'dart_gun',
    name: 'Fléchettes Toxiques',
    description: 'Salve de 3 aiguilles empoisonnées perforantes.',
    icon: '💉',
    reloadTime: 20, clipSize: 3, clipReloadTime: 40, recoil: 1.0,
    projectileSpeed: 14.0, spread: 0.08, damage: 24, craterRadius: 3,
    bounces: 0, fuseFrames: 80, gravityScale: 0.15, pelletCount: 3, toxic: true
  },
  vortex: {
    id: 'vortex',
    name: 'Canon Vortex',
    description: "Singularité gravitationnelle aspirant vers et débris avant d'imploser.",
    icon: '🌀',
    reloadTime: 65, clipSize: 1, clipReloadTime: 75, recoil: 4.0,
    projectileSpeed: 4.2, spread: 0.04, damage: 60, craterRadius: 28,
    bounces: 0, fuseFrames: 100, gravityScale: 0.05, vortex: true
  },

  // ─── NEW WEAPONS ───────────────────────────────────────────────────────────

  sniper: {
    id: 'sniper',
    name: 'Sniper',
    description: 'Balle ultra-précise et ultra-rapide. 1 coup, 1 mort.',
    icon: '🎯',
    reloadTime: 80, clipSize: 1, clipReloadTime: 90, recoil: 6.0,
    projectileSpeed: 32.0, spread: 0.0, damage: 85, craterRadius: 6,
    bounces: 0, fuseFrames: 35, gravityScale: 0.03, piercing: false
  },

  acid_bomb: {
    id: 'acid_bomb',
    name: 'Bombe Acide',
    description: 'Crée une flaque d\'acide corrosive sur le terrain à l\'impact.',
    icon: '🧪',
    reloadTime: 45, clipSize: 2, clipReloadTime: 60, recoil: 2.0,
    projectileSpeed: 5.0, spread: 0.06, damage: 15, craterRadius: 10,
    bounces: 2, fuseFrames: 120, gravityScale: 0.6, acidPool: true
  },

  boomerang: {
    id: 'boomerang',
    name: 'Boomerang',
    description: 'Revient vers le lanceur après 1.5s. Attention à ne pas se faire toucher.',
    icon: '🪃',
    reloadTime: 30, clipSize: 2, clipReloadTime: 45, recoil: 1.2,
    projectileSpeed: 7.0, spread: 0.03, damage: 30, craterRadius: 12,
    bounces: 0, fuseFrames: 90, gravityScale: 0.05, boomerang: true
  },

  mortar: {
    id: 'mortar',
    name: 'Mortier',
    description: 'Obus à forte parabole et grand rayon d\'explosion.',
    icon: '💥',
    reloadTime: 55, clipSize: 1, clipReloadTime: 65, recoil: 3.0,
    projectileSpeed: 4.5, spread: 0.04, damage: 55, craterRadius: 30,
    bounces: 0, fuseFrames: 150, gravityScale: 1.2
  },

  freeze_bomb: {
    id: 'freeze_bomb',
    name: 'Bombe Givrante',
    description: 'Gèle tous les vers à proximité, les ralentissant pendant 3s.',
    icon: '❄️',
    reloadTime: 50, clipSize: 1, clipReloadTime: 65, recoil: 1.8,
    projectileSpeed: 5.5, spread: 0.05, damage: 20, craterRadius: 8,
    bounces: 1, fuseFrames: 100, gravityScale: 0.5, freezeDuration: 180
  },

  laser: {
    id: 'laser',
    name: 'Laser',
    description: 'Rayon laser instantané continu. Tenu = dégâts constants.',
    icon: '🔴',
    reloadTime: 2, clipSize: 60, clipReloadTime: 80, recoil: 0.1,
    projectileSpeed: 999, spread: 0.0, damage: 4, craterRadius: 3,
    bounces: 0, fuseFrames: 2, gravityScale: 0.0, laser: true, piercing: true
  },
};

export const ALL_WEAPON_IDS: WeaponId[] = [
  'bazooka', 'minigun', 'shotgun', 'grenade', 'chiquita',
  'gauss', 'mine', 'flamer', 'homing_missile', 'railgun',
  'bouncy_ball', 'dart_gun', 'vortex',
  'sniper', 'acid_bomb', 'boomerang', 'mortar', 'freeze_bomb', 'laser'
];

export const DEFAULT_LOADOUT: WeaponId[] = [
  'bazooka',
  'homing_missile',
  'railgun',
  'bouncy_ball',
  'vortex'
];
