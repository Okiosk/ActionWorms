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
  | 'vortex';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  description: string;
  icon: string; // ASCII or symbol representation
  reloadTime: number; // frames between shots
  clipSize: number; // shots per clip
  clipReloadTime: number; // frames to reload full clip
  recoil: number; // knockback applied to worm
  projectileSpeed: number;
  spread: number; // radians of random deviation
  damage: number;
  craterRadius: number;
  bounces: number; // 0 for explode on impact
  fuseFrames: number; // 0 for infinite until impact
  gravityScale: number;
  piercing?: boolean;
  pelletCount?: number;
  splitCount?: number;
  homing?: boolean;
  vortex?: boolean;
  toxic?: boolean;
}
