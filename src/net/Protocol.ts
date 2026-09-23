import { WeaponId } from '../weapons/WeaponDef';
import { WormInput } from '../engine/Worm';
import { RopeState } from '../engine/NinjaRope';

export interface WormNetState {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  health: number;
  frags: number;
  deaths: number;
  facing: number;
  aimAngle: number;
  weaponIndex: number;
  ropeState: RopeState;
  hookX: number;
  hookY: number;
}

export interface ProjectileNetState {
  id: number;
  weaponId: WeaponId;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export type NetEvent =
  | { type: 'crater'; x: number; y: number; r: number }
  | { type: 'blood'; x: number; y: number; count: number }
  | { type: 'sound'; name: string }
  | { type: 'kill'; killerId: string; victimId: string };

export type NetMessage =
  | {
      type: 'JOIN';
      name: string;
      loadout: WeaponId[];
    }
  | {
      type: 'WELCOME';
      playerId: string;
      mapSeed: number;
      mapWidth: number;
      mapHeight: number;
      fragLimit: number;
    }
  | {
      type: 'INPUT';
      seq: number;
      input: WormInput;
    }
  | {
      type: 'STATE';
      seq: number;
      worms: WormNetState[];
      projectiles: ProjectileNetState[];
      events: NetEvent[];
    }
  | {
      type: 'MATCH_OVER';
      winnerId: string;
    };
