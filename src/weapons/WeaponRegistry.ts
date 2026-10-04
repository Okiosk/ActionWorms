import { WeaponDef, WeaponId } from './WeaponDef';

// ─── Échoppe des Sorts & Grimoire Arcanique ──────────────────────────────────
// 0  = Sort de départ (gratuit)
// 50 = Sort mineur
// 100–250 = Sort intermédiaire
// 300–500 = Sort majeur dévastateur
// ─────────────────────────────────────────────────────────────────────────────

export const WEAPON_REGISTRY: Record<WeaponId, WeaponDef> = {
  bazooka: {
    id: 'bazooka',
    name: 'Boule de Feu Majeure',
    description: 'Sphère incendiaire arcanique propulsée par le bâton, explosant en déflagration magique.',
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
    description: 'Mitraille magique à très haute cadence projetant des cristaux d\'énergie pure.',
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
    description: 'Salve de 8 perles de foudre élémentaires dévastatrices à courte portée.',
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
    description: 'Sphère d\'énergie tellurique instable qui rebondit avant de détoner.',
    icon: '🔮',
    price: 50,
    reloadTime: 32, clipSize: 2, clipReloadTime: 45,
    projectileSpeed: 5.5, spread: 0.05, damage: 42, craterRadius: 22,
    bounces: 5, fuseFrames: 110, gravityScale: 0.75,
    elementColor: '#d933ff', spellSchool: 'Chaos'
  },
  chiquita: {
    id: 'chiquita',
    name: 'Comète Étoilée',
    description: 'Orbe céleste béni se divisant en 6 sous-éclats stellaires détonants.',
    icon: '⭐',
    price: 150,
    reloadTime: 55, clipSize: 1, clipReloadTime: 60,
    projectileSpeed: 5.0, spread: 0.04, damage: 25, craterRadius: 16,
    bounces: 3, fuseFrames: 75, gravityScale: 0.65, splitCount: 6,
    elementColor: '#ffe044', spellSchool: 'Magie Stellaire'
  },
  gauss: {
    id: 'gauss',
    name: 'Rayon Astral',
    description: 'Faisceau de lumière astrale pure perforant la roche et les sorciers.',
    icon: '🔷',
    price: 200,
    reloadTime: 45, clipSize: 1, clipReloadTime: 55,
    projectileSpeed: 25.0, spread: 0.0, damage: 65, craterRadius: 7,
    bounces: 0, fuseFrames: 30, gravityScale: 0.0, piercing: true,
    elementColor: '#33ffff', spellSchool: 'Astral'
  },
  mine: {
    id: 'mine',
    name: 'Rune Tellurique Piégée',
    description: 'Rune qui se colle au sol et explose à l\'approche d\'un sorcier.',
    icon: '🪨',
    price: 100,
    reloadTime: 40, clipSize: 2, clipReloadTime: 55,
    projectileSpeed: 3.5, spread: 0.08, damage: 55, craterRadius: 24,
    bounces: 0, fuseFrames: 900, gravityScale: 0.8, sticky: true,
    elementColor: '#e08833', spellSchool: 'Géo-magie'
  },
  flamer: {
    id: 'flamer',
    name: 'Souffle du Dragon',
    description: 'Torrent continu de flammes draconiques mystiques consumant les ennemis.',
    icon: '🐉',
    price: 75,
    reloadTime: 3, clipSize: 40, clipReloadTime: 70,
    projectileSpeed: 4.8, spread: 0.18, damage: 5, craterRadius: 4,
    bounces: 0, fuseFrames: 40, gravityScale: 0.05,
    elementColor: '#ff3300', spellSchool: 'Draconique'
  },
  homing_missile: {
    id: 'homing_missile',
    name: 'Feu Follet Traqueur',
    description: 'Esprit spectral enchanté qui pourchasse automatiquement le sorcier le plus proche.',
    icon: '👻',
    price: 200,
    reloadTime: 45, clipSize: 1, clipReloadTime: 50,
    projectileSpeed: 5.5, spread: 0.05, damage: 46, craterRadius: 20,
    bounces: 0, fuseFrames: 180, gravityScale: 0.1, homing: true,
    elementColor: '#33ffcc', spellSchool: 'Spiritisme'
  },
  railgun: {
    id: 'railgun',
    name: 'Foudre Divine',
    description: 'Éclair supersonique céleste perforant la roche sur toute la carte.',
    icon: '⚡',
    price: 350,
    reloadTime: 50, clipSize: 1, clipReloadTime: 60,
    projectileSpeed: 38.0, spread: 0.0, damage: 70, craterRadius: 8,
    bounces: 0, fuseFrames: 25, gravityScale: 0.0, piercing: true,
    elementColor: '#ffff66', spellSchool: 'Foudre Sacrée'
  },
  bouncy_ball: {
    id: 'bouncy_ball',
    name: 'Sphère de Mana Élastique',
    description: 'Orbe de mana concentré ricochetant avec frénésie jusqu\'à 15 fois.',
    icon: '🟣',
    price: 125,
    reloadTime: 22, clipSize: 3, clipReloadTime: 45,
    projectileSpeed: 7.2, spread: 0.06, damage: 16, craterRadius: 8,
    bounces: 15, fuseFrames: 220, gravityScale: 0.45,
    elementColor: '#cc33ff', spellSchool: 'Éther'
  },
  dart_gun: {
    id: 'dart_gun',
    name: 'Flèches d\'Ombre Maudites',
    description: 'Salve de 3 pointes d\'ombre empoisonnées perforantes à vélocité foudroyante.',
    icon: '🗡️',
    price: 100,
    reloadTime: 18, clipSize: 6, clipReloadTime: 45,
    projectileSpeed: 11.0, spread: 0.14, damage: 9, craterRadius: 3,
    bounces: 0, fuseFrames: 70, gravityScale: 0.1, pelletCount: 3, toxic: true,
    elementColor: '#33cc55', spellSchool: 'Nécromancie'
  },
  vortex: {
    id: 'vortex',
    name: 'Singularité du Néant',
    description: 'Faille dimensionnelle aspirant sorciers et débris avant de s\'effondrer.',
    icon: '🌀',
    price: 400,
    reloadTime: 65, clipSize: 1, clipReloadTime: 75,
    projectileSpeed: 4.5, spread: 0.02, damage: 35, craterRadius: 28,
    bounces: 1, fuseFrames: 85, gravityScale: 0.35, vortex: true,
    elementColor: '#7700ee', spellSchool: 'Néant'
  },
  sniper: {
    id: 'sniper',
    name: 'Javelot Spectral',
    description: 'Trait d\'énergie mystique rectiligne instantané. Un sort fatal à longue portée.',
    icon: '🏹',
    price: 250,
    reloadTime: 55, clipSize: 1, clipReloadTime: 60,
    projectileSpeed: 32.0, spread: 0.0, damage: 85, craterRadius: 6,
    bounces: 0, fuseFrames: 40, gravityScale: 0.02, piercing: true,
    elementColor: '#ffffff', spellSchool: 'Divination'
  },
  acid_bomb: {
    id: 'acid_bomb',
    name: 'Fiole d\'Alchimiste',
    description: 'Fiole de poison corrosif laissant une mare d\'acide brûlant sur le terrain.',
    icon: '🧪',
    price: 175,
    reloadTime: 40, clipSize: 1, clipReloadTime: 50,
    projectileSpeed: 6.0, spread: 0.05, damage: 25, craterRadius: 14,
    bounces: 2, fuseFrames: 90, gravityScale: 0.6, acidPool: true,
    elementColor: '#44ff22', spellSchool: 'Alchimie'
  },
  boomerang: {
    id: 'boomerang',
    name: 'Chakram Envoûté',
    description: 'Lame mystique tournoyante revenant vers son invocateur après 1.5 seconde.',
    icon: '🪃',
    price: 75,
    reloadTime: 30, clipSize: 1, clipReloadTime: 40,
    projectileSpeed: 7.0, spread: 0.02, damage: 32, craterRadius: 10,
    bounces: 0, fuseFrames: 90, gravityScale: 0.15, boomerang: true,
    elementColor: '#ffaa33', spellSchool: 'Enchantement'
  },
  mortar: {
    id: 'mortar',
    name: 'Météorite Antique',
    description: 'Comète magique en cloche provoquant une colossale explosion tellurique.',
    icon: '☄️',
    price: 300,
    reloadTime: 60, clipSize: 1, clipReloadTime: 70,
    projectileSpeed: 7.5, spread: 0.03, damage: 60, craterRadius: 30,
    bounces: 0, fuseFrames: 180, gravityScale: 1.2,
    elementColor: '#ff6600', spellSchool: 'Cosmique'
  },
  freeze_bomb: {
    id: 'freeze_bomb',
    name: 'Orbe de Givre Éternel',
    description: 'Blizzard concentré congelant tous les sorciers à proximité pendant 3 secondes.',
    icon: '❄️',
    price: 225,
    reloadTime: 50, clipSize: 1, clipReloadTime: 65,
    projectileSpeed: 5.5, spread: 0.05, damage: 20, craterRadius: 8,
    bounces: 1, fuseFrames: 100, gravityScale: 0.5, freezeDuration: 180,
    elementColor: '#66eeff', spellSchool: 'Cryomancie'
  },
  laser: {
    id: 'laser',
    name: 'Faisceau Arcanique Continu',
    description: 'Rayon magique continu à courte portée qui traverse la terre.',
    icon: '🔴',
    price: 500,
    reloadTime: 2, clipSize: 60, clipReloadTime: 80,
    projectileSpeed: 30, spread: 0.0, damage: 4, craterRadius: 3,
    bounces: 0, fuseFrames: 9, gravityScale: 0.0, piercing: true,
    elementColor: '#ff2255', spellSchool: 'Haute Magie'
  }
};

export const ALL_WEAPON_IDS = Object.keys(WEAPON_REGISTRY) as WeaponId[];

/** Spell used when nothing else was chosen */
export const DEFAULT_WEAPON: WeaponId = 'bazooka';

/** Gold rewards */
export const MONEY_KILL = 75;     // per kill
export const MONEY_DEATH = 25;    // consolation per death
export const MONEY_START = 10000; // starting gold (test value)
