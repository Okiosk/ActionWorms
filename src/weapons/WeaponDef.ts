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
  // New weapons
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
  reloadTime: number;      // frames between shots
  clipSize: number;
  clipReloadTime: number;
  recoil: number;
  projectileSpeed: number;
  spread: number;          // radians of random deviation
  damage: number;
  craterRadius: number;
  bounces: number;
  fuseFrames: number;
  gravityScale: number;
  // Special behaviours
  piercing?: boolean;
  pelletCount?: number;
  splitCount?: number;
  homing?: boolean;
  vortex?: boolean;
  toxic?: boolean;
  boomerang?: boolean;     // reverses direction after fuseFrames/2
  acidPool?: boolean;      // leaves an acid pool on detonation
  freezeDuration?: number; // frames to freeze nearby worms
  laser?: boolean;         // hitscan instant beam (no projectile movement)
}
