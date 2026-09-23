export const CONFIG = {
  // Logical game resolution (authentic retro DOS Liero feel, sharp 16:10)
  MAP_WIDTH: 800,
  MAP_HEIGHT: 500,

  // Physics constants (tuned for authentic, controllable Liero speed)
  GRAVITY: 0.18,
  AIR_FRICTION: 0.95,
  GROUND_FRICTION: 0.78,
  WORM_SPEED: 0.42,
  WORM_JUMP_FORCE: 3.1,
  DIG_RADIUS: 5,
  DIG_SPEED_FACTOR: 0.65,
  MAX_FALL_SPEED: 6.5,

  // Rope constants
  ROPE_SPEED: 11.0,
  ROPE_MAX_LENGTH: 220,
  ROPE_PULL_FORCE: 0.35,
  ROPE_DAMPING: 0.985,

  // Game rules
  DEFAULT_FRAG_LIMIT: 10,
  RESPAWN_DELAY_FRAMES: 90, // ~1.5s at 60fps
  DEFAULT_HEALTH: 100,

  // Materials
  MAT_AIR: 0,
  MAT_DIRT: 1,
  MAT_ROCK: 2,

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
    WORM_P2: '#3388ff', // Blue
    WORM_BOT1: '#ff4444', // Red
    WORM_BOT2: '#ffbb22' // Yellow/Orange
  }
};
