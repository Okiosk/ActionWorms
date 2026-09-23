import { WeaponDef, WeaponId } from './WeaponDef';

export const WEAPON_REGISTRY: Record<WeaponId, WeaponDef> = {
  bazooka: {
    id: 'bazooka',
    name: 'Bazooka',
    description: 'Roquette lourde avec traînée de fumée et grosse détonation.',
    icon: '🚀',
    reloadTime: 38,
    clipSize: 1,
    clipReloadTime: 40,
    recoil: 3.5,
    projectileSpeed: 6.8,
    spread: 0.02,
    damage: 48,
    craterRadius: 20,
    bounces: 0,
    fuseFrames: 180,
    gravityScale: 0.25
  },
  minigun: {
    id: 'minigun',
    name: 'Mini-gun',
    description: 'Mitrailleuse à très haute cadence criblant le terrain.',
    icon: '⚡',
    reloadTime: 4,
    clipSize: 30,
    clipReloadTime: 65,
    recoil: 0.4,
    projectileSpeed: 9.5,
    spread: 0.12,
    damage: 7,
    craterRadius: 4,
    bounces: 0,
    fuseFrames: 90,
    gravityScale: 0.15
  },
  shotgun: {
    id: 'shotgun',
    name: 'Fusil à pompe',
    description: 'Salve de 8 plombs meurtrière à courte et moyenne portée.',
    icon: '💥',
    reloadTime: 35,
    clipSize: 2,
    clipReloadTime: 50,
    recoil: 4.2,
    projectileSpeed: 8.5,
    spread: 0.22,
    damage: 13, // per pellet
    craterRadius: 4,
    bounces: 0,
    fuseFrames: 60,
    gravityScale: 0.2,
    pelletCount: 8
  },
  grenade: {
    id: 'grenade',
    name: 'Grenade',
    description: 'Grenade rebondissante avec mèche de 2 secondes.',
    icon: '💣',
    reloadTime: 32,
    clipSize: 2,
    clipReloadTime: 45,
    recoil: 1.5,
    projectileSpeed: 5.5,
    spread: 0.05,
    damage: 42,
    craterRadius: 22,
    bounces: 5,
    fuseFrames: 110, // ~1.8s
    gravityScale: 0.75
  },
  chiquita: {
    id: 'chiquita',
    name: 'Chiquita Bomb',
    description: 'Bombe à fragmentation qui se divise en 6 sous-bombes explosives.',
    icon: '🍌',
    reloadTime: 55,
    clipSize: 1,
    clipReloadTime: 60,
    recoil: 2.5,
    projectileSpeed: 5.0,
    spread: 0.04,
    damage: 25,
    craterRadius: 16,
    bounces: 3,
    fuseFrames: 75,
    gravityScale: 0.65,
    splitCount: 6
  },
  gauss: {
    id: 'gauss',
    name: 'Canon Gauss',
    description: 'Rayon cinétique ultra-perforant qui vaporise terre et vers.',
    icon: '🔷',
    reloadTime: 45,
    clipSize: 1,
    clipReloadTime: 55,
    recoil: 5.0,
    projectileSpeed: 25.0,
    spread: 0.0,
    damage: 65,
    craterRadius: 7,
    bounces: 0,
    fuseFrames: 30,
    gravityScale: 0.0,
    piercing: true
  },
  mine: {
    id: 'mine',
    name: 'Mine sautante',
    description: 'Piège qui explose à proximité d\'un ennemi.',
    icon: '⚠️',
    reloadTime: 40,
    clipSize: 2,
    clipReloadTime: 55,
    recoil: 1.0,
    projectileSpeed: 3.5,
    spread: 0.08,
    damage: 55,
    craterRadius: 24,
    bounces: 3,
    fuseFrames: 900, // 15 seconds
    gravityScale: 0.8
  },
  flamer: {
    id: 'flamer',
    name: 'Lance-flammes',
    description: 'Jet de flammes continues qui lèche le terrain et consume les vers.',
    icon: '🔥',
    reloadTime: 3,
    clipSize: 40,
    clipReloadTime: 70,
    recoil: 0.2,
    projectileSpeed: 4.8,
    spread: 0.18,
    damage: 5,
    craterRadius: 4,
    bounces: 0,
    fuseFrames: 40,
    gravityScale: 0.05
  }
};

export const ALL_WEAPON_IDS: WeaponId[] = [
  'bazooka',
  'minigun',
  'shotgun',
  'grenade',
  'chiquita',
  'gauss',
  'mine',
  'flamer'
];

export const DEFAULT_LOADOUT: WeaponId[] = [
  'bazooka',
  'minigun',
  'shotgun',
  'grenade',
  'chiquita'
];
