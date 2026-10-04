export const CONFIG = {
  // Logical world size (pixels)
  MAP_WIDTH: 800,
  MAP_HEIGHT: 500,

  // Simulation runs at a fixed 60 ticks per second
  TICK_MS: 1000 / 60,

  // Physics constants (per tick)
  GRAVITY: 0.14,
  GROUND_FRICTION: 0.72,
  WORM_WALK_SPEED: 1.2,
  WORM_JUMP_FORCE: 2.8,
  MAX_FALL_SPEED: 5.5,

  // Rope constants
  ROPE_MAX_LENGTH: 220,
  ROPE_MIN_LENGTH: 12,
  ROPE_HOOK_SPEED: 14,
  ROPE_REEL_SPEED: 1.6,
  ROPE_MAX_SWING_SPEED: 6.5,

  // Game rules
  MAX_PLAYERS: 8,
  KOTH_SECONDS_PER_POINT: 12, // King of the hill: fragLimit × 12 s in the zone to win
  KOTH_ZONE_RADIUS: 40,

  // Materials
  MAT_AIR: 0,
  MAT_DIRT: 1,     // destructible
  MAT_ROCK: 2,     // indestructible
  MAT_ACID: 3,     // solid, corrodes wizards standing on it
  MAT_ICE: 4,      // destructible, slippery
  MAT_WATER: 5,    // liquid: slows everything, puts out fire, freezes into ice
  MAT_CRYSTAL: 6,  // destructible, breaking it gives gold
  MAT_WOOD: 7,     // resists explosions, but fire burns it entirely
  MAT_LAVA: 8,     // liquid: sets wizards on fire
  MAT_BOUNCE: 9,   // giant mushroom: bounces wizards and spells
  BOUNCE_FORCE: 5.0,
  BOUNCE_JUMP_FORCE: 6.2,

  // 8 distinct player colors
  PLAYER_COLORS: [
    '#44cc44', // Vert
    '#3388ff', // Bleu
    '#ff4444', // Rouge
    '#ffcc22', // Jaune
    '#b844ff', // Violet
    '#ff8822', // Orange
    '#22e8dd', // Cyan
    '#ff44aa'  // Rose
  ],

  TEAM_COLORS: ['#ff5566', '#4499ff'],
  TEAM_NAMES: ['Rouge', 'Bleu'],

  COLORS: {
    SKY: '#160d08',
    DIRT_BASE: '#784d28',
    DIRT_DARK: '#5c391c',
    BLOOD_FRESH: '#bb1111',
    BLOOD_DARK: '#770909'
  }
};
