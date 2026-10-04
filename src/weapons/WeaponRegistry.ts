import { WeaponDef, WeaponId } from './WeaponDef';

// ─── Grimoire: one spell = one unique effect ─────────────────────────────────
// 0 = sort de départ (gratuit) · 50–150 = mineur · 175–275 = intermédiaire · 300+ = majeur
// ─────────────────────────────────────────────────────────────────────────────

export const WEAPON_REGISTRY: Record<WeaponId, WeaponDef> = {
  bazooka: {
    id: 'bazooka',
    name: 'Boule de Feu',
    description: 'Sphère incendiaire qui explose à l\'impact. Le sort de base, fiable et polyvalent.',
    icon: '🔥',
    price: 0,
    reloadTime: 38, clipSize: 1, clipReloadTime: 40,
    projectileSpeed: 6.8, spread: 0.02, damage: 48, craterRadius: 20,
    bounces: 0, fuseFrames: 180, gravityScale: 0.25,
    elementColor: '#ff5500', spellSchool: 'Pyromancie'
  },
  minigun: {
    id: 'minigun',
    name: 'Éclats Arcaniques',
    description: 'Rafale continue de petits cristaux d\'énergie. Précis à moyenne distance.',
    icon: '✨',
    price: 0,
    reloadTime: 4, clipSize: 30, clipReloadTime: 65,
    projectileSpeed: 9.5, spread: 0.12, damage: 7, craterRadius: 4,
    bounces: 0, fuseFrames: 90, gravityScale: 0.15,
    elementColor: '#b844ff', spellSchool: 'Arcanes'
  },
  shotgun: {
    id: 'shotgun',
    name: 'Choc d\'Étincelles',
    description: 'Gerbe de 8 étincelles en éventail. Dévastateur à bout portant.',
    icon: '⚡',
    price: 0,
    reloadTime: 35, clipSize: 2, clipReloadTime: 50,
    projectileSpeed: 8.5, spread: 0.22, damage: 13, craterRadius: 4,
    bounces: 0, fuseFrames: 60, gravityScale: 0.2, pelletCount: 8,
    elementColor: '#ffea33', spellSchool: 'Électromancie'
  },
  grenade: {
    id: 'grenade',
    name: 'Orbe du Chaos',
    description: 'Rebondit sur les parois puis explose au bout de 2 secondes. Idéal pour les coins.',
    icon: '🔮',
    price: 50,
    reloadTime: 32, clipSize: 2, clipReloadTime: 45,
    projectileSpeed: 5.5, spread: 0.05, damage: 42, craterRadius: 22,
    bounces: 5, fuseFrames: 110, gravityScale: 0.75,
    elementColor: '#d933ff', spellSchool: 'Chaos'
  },
  flamer: {
    id: 'flamer',
    name: 'Souffle du Dragon',
    description: 'Flammes à courte portée qui montent et enflamment la cible : elle brûle pendant 3 s.',
    icon: '🐉',
    price: 75,
    reloadTime: 3, clipSize: 40, clipReloadTime: 70,
    projectileSpeed: 4.6, spread: 0.25, damage: 2, craterRadius: 2,
    bounces: 0, fuseFrames: 32, gravityScale: -0.15, burnDuration: 180,
    elementColor: '#ff3300', spellSchool: 'Draconique'
  },
  boomerang: {
    id: 'boomerang',
    name: 'Chakram Envoûté',
    description: 'Lame tournoyante qui revient vers toi : elle peut toucher à l\'aller et au retour.',
    icon: '🪃',
    price: 75,
    reloadTime: 30, clipSize: 1, clipReloadTime: 40,
    projectileSpeed: 7.0, spread: 0.02, damage: 32, craterRadius: 10,
    bounces: 0, fuseFrames: 90, gravityScale: 0.15, boomerang: true,
    elementColor: '#ffaa33', spellSchool: 'Enchantement'
  },
  earth_wall: {
    id: 'earth_wall',
    name: 'Rempart Tellurique',
    description: 'Fait surgir un amas de terre là où il tombe. Bouche un tunnel ou crée un abri.',
    icon: '🧱',
    price: 75,
    reloadTime: 40, clipSize: 2, clipReloadTime: 60,
    projectileSpeed: 5.0, spread: 0.02, damage: 0, craterRadius: 0,
    bounces: 0, fuseFrames: 120, gravityScale: 0.6, buildRadius: 15,
    elementColor: '#c08040', spellSchool: 'Géomancie'
  },
  mine: {
    id: 'mine',
    name: 'Rune Piégée',
    description: 'Rune qui se colle au sol et explose quand un sorcier s\'approche.',
    icon: '🪨',
    price: 100,
    reloadTime: 40, clipSize: 2, clipReloadTime: 55,
    projectileSpeed: 3.5, spread: 0.08, damage: 55, craterRadius: 24,
    bounces: 0, fuseFrames: 900, gravityScale: 0.8, sticky: true,
    elementColor: '#e08833', spellSchool: 'Runes'
  },
  leech: {
    id: 'leech',
    name: 'Sangsue Écarlate',
    description: 'Trait de sang qui te soigne d\'autant de PV qu\'il en inflige.',
    icon: '🩸',
    price: 125,
    reloadTime: 34, clipSize: 2, clipReloadTime: 50,
    projectileSpeed: 7.5, spread: 0.03, damage: 28, craterRadius: 6,
    bounces: 0, fuseFrames: 120, gravityScale: 0.05, lifesteal: 1,
    elementColor: '#e0103a', spellSchool: 'Hémomancie'
  },
  teleport: {
    id: 'teleport',
    name: 'Translocation',
    description: 'Lance un orbe et te téléporte là où il s\'arrête. Ne fait pas de dégâts.',
    icon: '🌀',
    price: 125,
    reloadTime: 60, clipSize: 1, clipReloadTime: 90,
    projectileSpeed: 6.0, spread: 0, damage: 0, craterRadius: 9,
    bounces: 0, fuseFrames: 75, gravityScale: 0.45, teleport: true,
    elementColor: '#9d6bff', spellSchool: 'Distorsion'
  },
  chiquita: {
    id: 'chiquita',
    name: 'Comète Étoilée',
    description: 'Explose en 6 éclats d\'étoile qui rebondissent puis détonent à leur tour.',
    icon: '⭐',
    price: 150,
    reloadTime: 55, clipSize: 1, clipReloadTime: 60,
    projectileSpeed: 5.0, spread: 0.04, damage: 25, craterRadius: 16,
    bounces: 3, fuseFrames: 75, gravityScale: 0.65, splitCount: 6,
    elementColor: '#ffe044', spellSchool: 'Magie stellaire'
  },
  acid_bomb: {
    id: 'acid_bomb',
    name: 'Fiole d\'Alchimiste',
    description: 'Laisse une mare d\'acide permanente qui ronge les sorciers qui marchent dedans.',
    icon: '🧪',
    price: 175,
    reloadTime: 40, clipSize: 1, clipReloadTime: 50,
    projectileSpeed: 6.0, spread: 0.05, damage: 25, craterRadius: 14,
    bounces: 2, fuseFrames: 90, gravityScale: 0.6, acidPool: true,
    elementColor: '#44ff22', spellSchool: 'Alchimie'
  },
  homing_missile: {
    id: 'homing_missile',
    name: 'Feu Follet Traqueur',
    description: 'Esprit qui poursuit le sorcier ennemi le plus proche.',
    icon: '👻',
    price: 200,
    reloadTime: 45, clipSize: 1, clipReloadTime: 50,
    projectileSpeed: 5.5, spread: 0.05, damage: 46, craterRadius: 20,
    bounces: 0, fuseFrames: 180, gravityScale: 0.1, homing: true,
    elementColor: '#33ffcc', spellSchool: 'Spiritisme'
  },
  freeze_bomb: {
    id: 'freeze_bomb',
    name: 'Orbe de Givre',
    description: 'Gèle sur place tous les sorciers proches pendant 3 secondes : ni mouvement, ni sort.',
    icon: '❄️',
    price: 225,
    reloadTime: 50, clipSize: 1, clipReloadTime: 65,
    projectileSpeed: 5.5, spread: 0.05, damage: 20, craterRadius: 8,
    bounces: 1, fuseFrames: 100, gravityScale: 0.5, freezeDuration: 180,
    elementColor: '#66eeff', spellSchool: 'Cryomancie'
  },
  shield: {
    id: 'shield',
    name: 'Égide Miroir',
    description: 'Bulle autour de toi pendant 2,5 s qui renvoie les sorts ennemis à leur lanceur.',
    icon: '🛡️',
    price: 250,
    reloadTime: 300, clipSize: 1, clipReloadTime: 300,
    projectileSpeed: 0, spread: 0, damage: 0, craterRadius: 0,
    bounces: 0, fuseFrames: 1, gravityScale: 0, shieldDuration: 150,
    elementColor: '#7fd4ff', spellSchool: 'Abjuration'
  },
  chain_lightning: {
    id: 'chain_lightning',
    name: 'Arc Foudroyant',
    description: 'Éclair qui rebondit d\'un sorcier à l\'autre (jusqu\'à 3 cibles proches).',
    icon: '🌩️',
    price: 275,
    reloadTime: 45, clipSize: 1, clipReloadTime: 55,
    projectileSpeed: 12, spread: 0.01, damage: 30, craterRadius: 4,
    bounces: 0, fuseFrames: 40, gravityScale: 0, chainTargets: 2,
    elementColor: '#9fe8ff', spellSchool: 'Fulgurmancie'
  },
  meteor: {
    id: 'meteor',
    name: 'Pluie de Météores',
    description: 'Marque une cible : 5 météores tombent du ciel juste au-dessus une seconde plus tard.',
    icon: '☄️',
    price: 300,
    reloadTime: 70, clipSize: 1, clipReloadTime: 80,
    projectileSpeed: 6.0, spread: 0.03, damage: 8, craterRadius: 4,
    bounces: 0, fuseFrames: 150, gravityScale: 0.6, meteorCount: 5,
    elementColor: '#ff7a1a', spellSchool: 'Cosmique'
  },
  railgun: {
    id: 'railgun',
    name: 'Foudre Divine',
    description: 'Rayon instantané qui traverse la terre et la roche sur toute la carte.',
    icon: '🔱',
    price: 350,
    reloadTime: 50, clipSize: 1, clipReloadTime: 60,
    projectileSpeed: 38.0, spread: 0.0, damage: 70, craterRadius: 7,
    bounces: 0, fuseFrames: 25, gravityScale: 0.0, piercing: true,
    elementColor: '#ffff66', spellSchool: 'Foudre sacrée'
  },
  vortex: {
    id: 'vortex',
    name: 'Singularité du Néant',
    description: 'Trou noir lent qui aspire les ennemis vers lui avant d\'imploser.',
    icon: '🕳️',
    price: 400,
    reloadTime: 65, clipSize: 1, clipReloadTime: 75,
    projectileSpeed: 4.5, spread: 0.02, damage: 35, craterRadius: 28,
    bounces: 1, fuseFrames: 85, gravityScale: 0.35, vortex: true,
    elementColor: '#7700ee', spellSchool: 'Néant'
  }
};

export const ALL_WEAPON_IDS = Object.keys(WEAPON_REGISTRY) as WeaponId[];

/** Spell used when nothing else was chosen */
export const DEFAULT_WEAPON: WeaponId = 'bazooka';

/** Gold rewards */
export const MONEY_KILL = 75;     // per kill
export const MONEY_DEATH = 25;    // consolation per death
export const MONEY_START = 10000; // starting gold (test value)
