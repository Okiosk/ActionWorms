import { WeaponDef, WeaponId } from './WeaponDef';

// ─── Grimoire: one spell = one unique effect ─────────────────────────────────
// 0 = sort de départ (gratuit) · 50–150 = mineur · 175–275 = intermédiaire · 300+ = majeur
// ─────────────────────────────────────────────────────────────────────────────

export const WEAPON_REGISTRY: Record<WeaponId, WeaponDef> = {
  bazooka: {
    id: 'bazooka',
    name: 'Boule de Feu',
    description: 'Sphère incendiaire qui explose à l\'impact et brûle le bois. Le sort de base, fiable et polyvalent.',
    price: 0, cooldown: 40,
    projectileSpeed: 6.8, spread: 0.02, damage: 48, craterRadius: 20,
    bounces: 0, fuseFrames: 180, gravityScale: 0.25,
    fire: true,
    elementColor: '#ff5500', spellSchool: 'Pyromancie'
  },
  frogs: {
    id: 'frogs',
    name: 'Crapauds Kamikazes',
    description: 'Trois crapauds qui sautillent vers l\'ennemi le plus proche et explosent à son contact (ou au bout de 5 s).',
    price: 0, cooldown: 70,
    projectileSpeed: 3.2, spread: 0.5, damage: 24, craterRadius: 11,
    bounces: 99, fuseFrames: 300, gravityScale: 1, pelletCount: 3, hopper: true,
    elementColor: '#5ed13a', spellSchool: 'Batrachomancie'
  },
  boomerang: {
    id: 'boomerang',
    name: 'Chakram Envoûté',
    description: 'Lame tournoyante qui revient vers toi : elle peut toucher à l\'aller et au retour.',
    price: 0, cooldown: 35,
    projectileSpeed: 7.0, spread: 0.02, damage: 32, craterRadius: 10,
    bounces: 0, fuseFrames: 90, gravityScale: 0.15, boomerang: true,
    elementColor: '#ffaa33', spellSchool: 'Enchantement'
  },
  flamer: {
    id: 'flamer',
    name: 'Souffle du Dragon',
    description: 'Flammes continues à courte portée : enflamment la cible (3 s) et brûlent le bois. S\'éteignent dans l\'eau.',
    price: 75, cooldown: 4,
    projectileSpeed: 4.6, spread: 0.25, damage: 2, craterRadius: 2,
    bounces: 0, fuseFrames: 32, gravityScale: -0.15, burnDuration: 180, fire: true,
    elementColor: '#ff3300', spellSchool: 'Draconique'
  },
  earth_wall: {
    id: 'earth_wall',
    name: 'Rempart Tellurique',
    description: 'Fait surgir un amas de terre là où il tombe. Bouche un tunnel ou crée un abri.',
    price: 75, cooldown: 45,
    projectileSpeed: 5.0, spread: 0.02, damage: 0, craterRadius: 0,
    bounces: 0, fuseFrames: 120, gravityScale: 0.6, buildRadius: 15,
    elementColor: '#c08040', spellSchool: 'Géomancie'
  },
  swap: {
    id: 'swap',
    name: 'Permutation',
    description: 'Si l\'orbe touche un sorcier, vous échangez vos places. Parfait pour l\'envoyer dans la lave.',
    price: 75, cooldown: 60,
    projectileSpeed: 8.0, spread: 0, damage: 0, craterRadius: 0,
    bounces: 0, fuseFrames: 70, gravityScale: 0.1, swap: true,
    elementColor: '#38d6ff', spellSchool: 'Distorsion'
  },
  mine: {
    id: 'mine',
    name: 'Rune Piégée',
    description: 'Rune qui se colle au sol et explose quand un sorcier s\'approche.',
    price: 100, cooldown: 50,
    projectileSpeed: 3.5, spread: 0.08, damage: 55, craterRadius: 24,
    bounces: 0, fuseFrames: 900, gravityScale: 0.8, sticky: true,
    elementColor: '#e08833', spellSchool: 'Runes'
  },
  drunk: {
    id: 'drunk',
    name: 'Philtre d\'Ivresse',
    description: 'Fiole de grog magique : pendant 6 s, la cible a les commandes gauche/droite inversées et vise de travers.',
    price: 100, cooldown: 70,
    projectileSpeed: 6.0, spread: 0.03, damage: 5, craterRadius: 0,
    bounces: 0, fuseFrames: 120, gravityScale: 0.5, status: 'drunk', statusDuration: 360,
    elementColor: '#c7e04a', spellSchool: 'Brasserie occulte'
  },
  bubble: {
    id: 'bubble',
    name: 'Bulle Farceuse',
    description: 'Enferme la cible dans une bulle qui s\'envole pendant 3 s. Elle éclate au plafond… ou si on tire dessus.',
    price: 125, cooldown: 70,
    projectileSpeed: 4.5, spread: 0.02, damage: 0, craterRadius: 0,
    bounces: 0, fuseFrames: 140, gravityScale: 0.08, status: 'bubble', statusDuration: 200,
    elementColor: '#9fdcff', spellSchool: 'Aéromancie'
  },
  leech: {
    id: 'leech',
    name: 'Sangsue Écarlate',
    description: 'Trait de sang qui te soigne d\'autant de PV qu\'il en inflige.',
    price: 125, cooldown: 36,
    projectileSpeed: 7.5, spread: 0.03, damage: 28, craterRadius: 6,
    bounces: 0, fuseFrames: 120, gravityScale: 0.05, lifesteal: 1,
    elementColor: '#e0103a', spellSchool: 'Hémomancie'
  },
  teleport: {
    id: 'teleport',
    name: 'Translocation',
    description: 'Lance un orbe et te téléporte là où il s\'arrête. Ne fait pas de dégâts.',
    price: 125, cooldown: 70,
    projectileSpeed: 6.0, spread: 0, damage: 0, craterRadius: 9,
    bounces: 0, fuseFrames: 75, gravityScale: 0.45, teleport: true,
    elementColor: '#9d6bff', spellSchool: 'Distorsion'
  },
  chiquita: {
    id: 'chiquita',
    name: 'Comète Étoilée',
    description: 'Explose en 6 éclats d\'étoile qui rebondissent puis détonent à leur tour.',
    price: 150, cooldown: 60,
    projectileSpeed: 5.0, spread: 0.04, damage: 25, craterRadius: 16,
    bounces: 3, fuseFrames: 75, gravityScale: 0.65, splitCount: 6,
    elementColor: '#ffe044', spellSchool: 'Magie stellaire'
  },
  polymorph: {
    id: 'polymorph',
    name: 'Métamorphose Ovine',
    description: 'Transforme la cible en mouton pendant 6 s : pas de sorts, pas de grappin, juste des bonds et des bêlements.',
    price: 175, cooldown: 90,
    projectileSpeed: 6.5, spread: 0.02, damage: 0, craterRadius: 0,
    bounces: 0, fuseFrames: 120, gravityScale: 0.12, status: 'sheep', statusDuration: 360,
    elementColor: '#ff7ad9', spellSchool: 'Transmutation'
  },
  toxic_cloud: {
    id: 'toxic_cloud',
    name: 'Fiole Pestilentielle',
    description: 'Se brise en libérant un nuage toxique qui se répand dans les galeries, empoisonne tous ceux qui le traversent puis se dissipe.',
    price: 175, cooldown: 75,
    projectileSpeed: 6.0, spread: 0.05, damage: 10, craterRadius: 5,
    bounces: 1, fuseFrames: 90, gravityScale: 0.6, gasCloud: true,
    elementColor: '#7be03a', spellSchool: 'Alchimie'
  },
  homing_missile: {
    id: 'homing_missile',
    name: 'Feu Follet Traqueur',
    description: 'Esprit qui poursuit le sorcier ennemi le plus proche.',
    price: 200, cooldown: 50,
    projectileSpeed: 5.5, spread: 0.05, damage: 46, craterRadius: 20,
    bounces: 0, fuseFrames: 180, gravityScale: 0.1, homing: true,
    elementColor: '#33ffcc', spellSchool: 'Spiritisme'
  },
  freeze_bomb: {
    id: 'freeze_bomb',
    name: 'Orbe de Givre',
    description: 'Gèle les sorciers proches 3 s (ni mouvement, ni sort) et transforme l\'eau en glace.',
    price: 225, cooldown: 60,
    projectileSpeed: 5.5, spread: 0.05, damage: 20, craterRadius: 8,
    bounces: 1, fuseFrames: 100, gravityScale: 0.5, freezeDuration: 180,
    elementColor: '#66eeff', spellSchool: 'Cryomancie'
  },
  shield: {
    id: 'shield',
    name: 'Égide Miroir',
    description: 'Bulle autour de toi pendant 2,5 s qui renvoie les sorts ennemis… et les éclairs.',
    price: 250, cooldown: 300,
    projectileSpeed: 0, spread: 0, damage: 0, craterRadius: 0,
    bounces: 0, fuseFrames: 1, gravityScale: 0, shieldDuration: 150,
    elementColor: '#7fd4ff', spellSchool: 'Abjuration'
  },
  force_lightning: {
    id: 'force_lightning',
    name: 'Mains Foudroyantes',
    description: 'Maintiens le clic : des arcs électriques jaillissent de tes mains, électrocutent et soulèvent les sorciers devant toi (courte portée).',
    price: 275, cooldown: 4,
    projectileSpeed: 0, spread: 0, damage: 2, craterRadius: 0,
    bounces: 0, fuseFrames: 1, gravityScale: 0, channel: true,
    elementColor: '#8fc4ff', spellSchool: 'Fulgurmancie'
  },
  meteor: {
    id: 'meteor',
    name: 'Pluie de Météores',
    description: 'Marque une cible : 5 météores tombent du ciel juste au-dessus une seconde plus tard.',
    price: 300, cooldown: 80,
    projectileSpeed: 6.0, spread: 0.03, damage: 8, craterRadius: 4,
    bounces: 0, fuseFrames: 150, gravityScale: 0.6, meteorCount: 5, fire: true,
    elementColor: '#ff7a1a', spellSchool: 'Cosmique'
  },
  railgun: {
    id: 'railgun',
    name: 'Foudre Divine',
    description: 'Rayon instantané qui traverse la terre et la roche sur toute la carte.',
    price: 350, cooldown: 60,
    projectileSpeed: 38.0, spread: 0.0, damage: 70, craterRadius: 7,
    bounces: 0, fuseFrames: 25, gravityScale: 0.0, piercing: true,
    elementColor: '#ffff66', spellSchool: 'Foudre sacrée'
  },
  hot_potato: {
    id: 'hot_potato',
    name: 'Patate Chaude',
    description: 'Une bombe qui colle au premier sorcier touché et saute sur quiconque il touche. Elle explose 4 s après la première prise. Refile-la !',
    price: 100, cooldown: 90,
    projectileSpeed: 4.5, spread: 0.02, damage: 65, craterRadius: 24,
    bounces: 99, fuseFrames: 420, gravityScale: 0.8, hotPotato: true, fire: true,
    elementColor: '#ff8c2a', spellSchool: 'Cuisine infernale'
  },
  decoy: {
    id: 'decoy',
    name: 'Sosie Piégé',
    description: 'Un faux toi (même couleur, même nom) qui marche droit devant et attire les sorts à tête chercheuse. Il explose si on s\'en approche.',
    price: 125, cooldown: 80,
    projectileSpeed: 2.6, spread: 0, damage: 45, craterRadius: 18,
    bounces: 0, fuseFrames: 600, gravityScale: 1, decoy: true,
    elementColor: '#ffd76a', spellSchool: 'Illusion'
  },
  portal: {
    id: 'portal',
    name: 'Portails Jumeaux',
    description: 'Ouvre un portail là où l\'orbe atterrit. Avec deux portails, tout ce qui entre dans l\'un sort de l\'autre : sorciers et sorts (25 s).',
    price: 150, cooldown: 40,
    projectileSpeed: 7.0, spread: 0, damage: 0, craterRadius: 0,
    bounces: 0, fuseFrames: 120, gravityScale: 0.3, portal: true,
    elementColor: '#4fd8ff', spellSchool: 'Distorsion'
  },
  tornado: {
    id: 'tornado',
    name: 'Tornade',
    description: 'Un tourbillon qui roule au ras du sol pendant 5 s, aspire les sorciers et les projette en l\'air à sa disparition.',
    price: 175, cooldown: 100,
    projectileSpeed: 1.7, spread: 0, damage: 0, craterRadius: 0,
    bounces: 0, fuseFrames: 300, gravityScale: 0, tornado: true,
    elementColor: '#d8e6f0', spellSchool: 'Aéromancie'
  },
  antigravity: {
    id: 'antigravity',
    name: 'Anomalie Gravitationnelle',
    description: 'Crée pendant 6 s une zone où la gravité s\'inverse : sorciers, sorts et sang tombent vers le haut.',
    price: 200, cooldown: 120,
    projectileSpeed: 5.5, spread: 0, damage: 0, craterRadius: 0,
    bounces: 0, fuseFrames: 90, gravityScale: 0.4, antigravity: true,
    elementColor: '#b07cff', spellSchool: 'Gravimancie'
  },
  vortex: {
    id: 'vortex',
    name: 'Singularité du Néant',
    description: 'Trou noir lent qui aspire les ennemis vers lui avant d\'imploser.',
    price: 400, cooldown: 80,
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
export const MONEY_START = 100;   // starting gold (the « Grimoire ouvert » mutator makes every spell free)
