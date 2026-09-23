import { WeaponId } from '../weapons/WeaponDef';
import { WormInput } from '../engine/Worm';
import { RopeState } from '../engine/NinjaRope';

export interface MatchModifiers {
  gravity: number; // 1.0 = normal, 0.35 = lunar, 1.8 = heavy, 0.0 = zero-g
  ropeReach: 'normal' | 'infinite'; // 220px vs infinite
  wormSpeed: number; // 1.0 = normal, 1.5 = turbo, 0.75 = tactical
  maxHealth: number; // 100 = standard, 50 = hardcore, 200 = titan
  unlimitedAmmo: boolean; // false = standard clips, true = infinite no reload
  fragLimit: number; // 5, 10, 15, 20, 30
}

export const DEFAULT_MODIFIERS: MatchModifiers = {
  gravity: 1.0,
  ropeReach: 'normal',
  wormSpeed: 1.0,
  maxHealth: 100,
  unlimitedAmmo: false,
  fragLimit: 10
};

export interface LobbyPlayerInfo {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
  loadout: WeaponId[];
}

export interface WormNetState {
  id: string;
  name: string;
  color: string;
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
      modifiers: MatchModifiers;
      players: LobbyPlayerInfo[];
    }
  | {
      type: 'LOBBY_UPDATE';
      players: LobbyPlayerInfo[];
      modifiers: MatchModifiers;
    }
  | {
      type: 'SET_MODIFIERS';
      modifiers: MatchModifiers;
    }
  | {
      type: 'START_MATCH';
      mapSeed: number;
      modifiers: MatchModifiers;
      players: LobbyPlayerInfo[];
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
    }
  | {
      type: 'PING';
      time: number;
    }
  | {
      type: 'PONG';
      time: number;
    };
