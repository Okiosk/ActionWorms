export const CONFIG = {
  // Logical game resolution (authentic retro DOS Liero feel, sharp 16:10)
  MAP_WIDTH: 800,
  MAP_HEIGHT: 500,

  // Physics constants (tuned for agile, responsive movement & slingshot swings)
  GRAVITY: 0.18,
  AIR_FRICTION: 0.992,
  GROUND_FRICTION: 0.74,
  WORM_SPEED: 0.45,
  WORM_JUMP_FORCE: 3.4,
  DIG_RADIUS: 5,
  DIG_SPEED_FACTOR: 0.65,
  MAX_FALL_SPEED: 7.0,

  // Rope constants
  ROPE_SPEED: 14.5,
  ROPE_MAX_LENGTH: 220,
  ROPE_PULL_FORCE: 0.40,
  ROPE_DAMPING: 0.995,

  // Game rules
  MAX_PLAYERS: 8,
  DEFAULT_FRAG_LIMIT: 10,
  RESPAWN_DELAY_FRAMES: 90, // ~1.5s at 60fps
  DEFAULT_HEALTH: 100,

  // Materials
  MAT_AIR: 0,
  MAT_DIRT: 1,
  MAT_ROCK: 2,

  // 8 Distinct Player Colors & Names
  PLAYER_COLORS: [
    '#44cc44', // 1: Green
    '#3388ff', // 2: Blue
    '#ff4444', // 3: Red
    '#ffcc22', // 4: Yellow
    '#b844ff', // 5: Purple
    '#ff8822', // 6: Orange
    '#22e8dd', // 7: Cyan
    '#ff44aa'  // 8: Pink
  ],

  PLAYER_COLOR_NAMES: [
    'Vert',
    'Bleu',
    'Rouge',
    'Jaune',
    'Violet',
    'Orange',
    'Cyan',
    'Rose'
  ],

  // Palettes (Authentic Liero colors)
  COLORS: {
    SKY: '#160d08',
    DIRT_BASE: '#784d28',
    DIRT_DARK: '#5c391c',
    DIRT_LIGHT: '#996335',
    ROCK_BASE: '#4a4d52',
    ROCK_DARK: '#333539',
    ROCK_LIGHT: '#64686e',
    BLOOD_FRESH: '#bb1111',
    BLOOD_DARK: '#770909',
    WORM_P1: '#44cc44', // Green
    WORM_P2: '#3388ff'  // Blue
  }
};
