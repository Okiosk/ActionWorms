export type WeaponId =
  | 'bazooka'
  | 'minigun'
  | 'grenade'
  | 'shotgun'
  | 'chiquita'
  | 'gauss'
  | 'mine'
  | 'flamer'
  | 'homing_missile'
  | 'railgun'
  | 'bouncy_ball'
  | 'dart_gun'
  | 'vortex'
  | 'sniper'
  | 'acid_bomb'
  | 'boomerang'
  | 'mortar'
  | 'freeze_bomb'
  | 'laser';

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
  gravityScale: number;
  // Special behaviours
  piercing?: boolean;      // goes through terrain, carving a tunnel
  sticky?: boolean;        // stops and stays where it lands (rune trap)
  pelletCount?: number;
  splitCount?: number;
  homing?: boolean;
  vortex?: boolean;
  toxic?: boolean;
  boomerang?: boolean;     // flies back to its caster after half its fuse
  acidPool?: boolean;      // leaves an acid pool on detonation
  freezeDuration?: number; // ticks to freeze nearby wizards
  elementColor: string;
  spellSchool: string;
}
