import { WeaponId } from '../weapons/WeaponDef';
import { WormInput } from '../engine/Worm';
import { RopeState } from '../engine/NinjaRope';

export type GameMode = 'ffa' | 'teams' | 'koth';
export type MapType = 'cave' | 'volcano' | 'swiss' | 'fortress' | 'open';

export interface MatchModifiers {
  // Existing
  gravity: number;          // 1.0 = normal, 0.35 = lunar, 1.8 = heavy, 0.0 = zero-g
  ropeReach: 'normal' | 'infinite';
  wormSpeed: number;        // 1.0 = normal, 1.5 = turbo, 0.75 = tactical
  maxHealth: number;        // 100 = standard, 50 = hardcore, 200 = titan
  unlimitedAmmo: boolean;
  fragLimit: number;        // frags or KOTH score to win
  // New — gameplay
  gameMode: GameMode;       // 'ffa' | 'teams' | 'koth'
  mapType: MapType;         // which map generator to use
  teams: Record<string, number>; // playerId -> team index (0=red, 1=blue)
  damageScale: number;      // 0.5, 1.0, 2.0, 3.0
  regenRate: number;        // 0, 1, 3 HP per second (applied per 60 ticks)
  explosionScale: number;   // 0.5, 1.0, 2.0 — multiplies crater radius
  noSelfDamage: boolean;    // own projectiles can't hurt yourself
  acidEnabled: boolean;     // acid pools spawned in map
}

export const DEFAULT_MODIFIERS: MatchModifiers = {
  gravity: 1.0,
  ropeReach: 'normal',
  wormSpeed: 1.0,
  maxHealth: 100,
  unlimitedAmmo: false,
  fragLimit: 10,
  gameMode: 'ffa',
  mapType: 'cave',
  teams: {},
  damageScale: 1.0,
  regenRate: 0,
  explosionScale: 1.0,
  noSelfDamage: false,
  acidEnabled: true,
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
  // team score synced via modifiers, not per-worm
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
      kothScores?: number[]; // [team0score, team1score] or [p0score, p1score, ...] for FFA koth
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
