export type WeaponId =
  | 'bazooka'
  | 'frogs'
  | 'boomerang'
  | 'flamer'
  | 'earth_wall'
  | 'swap'
  | 'mine'
  | 'drunk'
  | 'bubble'
  | 'leech'
  | 'teleport'
  | 'chiquita'
  | 'polymorph'
  | 'toxic_cloud'
  | 'homing_missile'
  | 'freeze_bomb'
  | 'shield'
  | 'force_lightning'
  | 'meteor'
  | 'railgun'
  | 'vortex'
  | 'portal'
  | 'hot_potato'
  | 'tornado'
  | 'decoy'
  | 'antigravity';

/** Lasting curses applied to the wizards that are hit */
export type StatusEffect = 'sheep' | 'bubble' | 'drunk';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  description: string;
  price: number;           // 0 = free
  cooldown: number;        // ticks between two casts (no ammo, no reload)
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
  hopper?: boolean;         // hops along the ground towards the nearest enemy (frogs)
  vortex?: boolean;         // pulls wizards in while flying
  boomerang?: boolean;      // flies back to its caster after half its fuse
  gasCloud?: boolean;       // releases a toxic cloud that spreads through the tunnels
  freezeDuration?: number;  // ticks to freeze nearby wizards
  burnDuration?: number;    // ticks of burning (damage over time) on hit
  lifesteal?: number;       // fraction of the damage dealt that heals the caster
  teleport?: boolean;       // the caster is teleported where it lands
  swap?: boolean;           // the caster and the wizard hit swap places
  status?: StatusEffect;    // curse applied to the wizards hit…
  statusDuration?: number;  // …for this many ticks
  buildRadius?: number;     // creates a dirt mound instead of a crater
  channel?: boolean;        // held down: continuous electric arcs (no projectile)
  meteorCount?: number;     // calls this many meteors from the sky where it lands
  shieldDuration?: number;  // self-cast: reflecting shield for this many ticks (no projectile)
  fire?: boolean;           // fire spell: burns wood, fizzles in water
  portal?: boolean;         // opens a portal where it lands (2 per caster, linked)
  hotPotato?: boolean;      // sticks to the wizard it touches, jumps to whoever he touches, then blows up
  tornado?: boolean;        // whirlwind rolling along the ground, lifting and carrying wizards
  decoy?: boolean;          // a walking fake copy of the caster that explodes
  antigravity?: boolean;    // zone where gravity is reversed for a few seconds
  elementColor: string;
  spellSchool: string;
}
