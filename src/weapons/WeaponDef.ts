export type WeaponId =
  | 'bazooka'
  | 'minigun'
  | 'shotgun'
  | 'grenade'
  | 'flamer'
  | 'boomerang'
  | 'earth_wall'
  | 'mine'
  | 'leech'
  | 'teleport'
  | 'chiquita'
  | 'acid_bomb'
  | 'homing_missile'
  | 'freeze_bomb'
  | 'shield'
  | 'chain_lightning'
  | 'meteor'
  | 'railgun'
  | 'vortex';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  description: string;
  icon: string;
  price: number;           // 0 = free
  reloadTime: number;      // ticks between shots
  clipSize: number;
  clipReloadTime: number;  // ticks to refill an empty clip
  projectileSpeed: number;
  spread: number;          // radians of random deviation
  damage: number;          // full damage on a direct hit
  craterRadius: number;
  bounces: number;         // hard impacts before exploding on contact (0 = explodes on contact)
  fuseFrames: number;      // lifetime in ticks, explodes when it runs out
  gravityScale: number;    // negative = rises (flames)
  // Special behaviours — each spell has its own
  piercing?: boolean;       // goes through terrain, carving a tunnel
  sticky?: boolean;         // stops and stays where it lands (rune trap)
  pelletCount?: number;     // several projectiles per cast
  splitCount?: number;      // splits into small bombs when it explodes
  homing?: boolean;         // chases the nearest enemy
  vortex?: boolean;         // pulls wizards in while flying
  boomerang?: boolean;      // flies back to its caster after half its fuse
  acidPool?: boolean;       // leaves an acid pool on detonation
  freezeDuration?: number;  // ticks to freeze nearby wizards
  burnDuration?: number;    // ticks of burning (damage over time) on hit
  lifesteal?: number;       // fraction of the damage dealt that heals the caster
  teleport?: boolean;       // the caster is teleported where it lands
  buildRadius?: number;     // creates a dirt mound instead of a crater
  chainTargets?: number;    // lightning jumps to this many extra wizards
  meteorCount?: number;     // calls this many meteors from the sky where it lands
  shieldDuration?: number;  // self-cast: reflecting shield for this many ticks (no projectile)
  fire?: boolean;           // fire spell: burns wood, fizzles in water
  elementColor: string;
  spellSchool: string;
}
