import { WeaponId } from '../weapons/WeaponDef';
import { WormInput } from '../engine/Worm';
import { RopeState } from '../engine/NinjaRope';
import { MapType } from '../engine/Terrain';

export type { MapType };
export type GameMode = 'ffa' | 'teams' | 'koth';

export interface MatchModifiers {
  gameMode: GameMode;
  mapType: MapType;
  mapSeed: number;          // the lobby preview and the match use the same seed
  fragLimit: number;        // frags (FFA), team kills (Teams) or ×12 s in the zone (KOTH)
  teams: Record<string, number>; // playerId -> team index (0 = rouge, 1 = bleu)
  gravity: number;          // 1.0 normal, 0.35 lunar, 1.8 heavy, 0 zero-g
  ropeReach: 'normal' | 'infinite';
  wormSpeed: number;        // 1.0 normal, 1.5 turbo, 0.75 tactical
  maxHealth: number;        // 100, 50, 200
  unlimitedAmmo: boolean;
  damageScale: number;      // 0.5, 1, 2, 3
  regenRate: number;        // HP per second
  explosionScale: number;   // multiplies crater & blast radius
  noSelfDamage: boolean;
  acidEnabled: boolean;     // hazards: acid pools and lava (otherwise lava becomes water)
}

export const DEFAULT_MODIFIERS: MatchModifiers = {
  gameMode: 'ffa',
  mapType: 'cave',
  mapSeed: 123456,
  fragLimit: 10,
  teams: {},
  gravity: 1.0,
  ropeReach: 'normal',
  wormSpeed: 1.0,
  maxHealth: 100,
  unlimitedAmmo: false,
  damageScale: 1.0,
  regenRate: 0,
  explosionScale: 1.0,
  noSelfDamage: false,
  acidEnabled: true
};

export interface LobbyPlayerInfo {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
}

export interface WormNetState {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  frags: number;
  deaths: number;
  score: number;
  money: number;
  aim: number;
  weapon: WeaponId;
  frozen: number;
  shield: number;
  burn: number;
  rope: RopeState;
  hx: number;
  hy: number;
  rl: number;   // rope length
  ack: number;  // last input sequence number processed for this player
}

export interface ProjectileNetState {
  id: number;
  w: WeaponId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  sub?: 1;
  armed?: 1;
}

export type NetEvent =
  | { t: 'crater'; x: number; y: number; r: number; f?: 1 }   // f = fire spell (burns wood)
  | { t: 'line'; x0: number; y0: number; x1: number; y1: number; r: number; f?: 1 }
  | { t: 'ice'; x: number; y: number; r: number }
  | { t: 'boom'; x: number; y: number; r: number; c?: string; f?: 1 }   // f = fire spell (flames)
  | { t: 'acid'; x: number; y: number; r: number }
  | { t: 'blood'; x: number; y: number; n: number; dx?: number; dy?: number }   // (dx, dy) = hit direction
  | { t: 'shot'; id: string; w: WeaponId }
  | { t: 'fill'; x: number; y: number; r: number; keep: number[] }
  | { t: 'tp'; x0: number; y0: number; x1: number; y1: number }
  | { t: 'zap'; pts: number[] }
  | { t: 'kill'; killer: string | null; victim: string; cause?: KillCause };

export type KillCause = 'acid' | 'lava' | 'self';

export type NetMessage =
  | { type: 'JOIN'; name: string }
  | { type: 'WELCOME'; playerId: string; players: LobbyPlayerInfo[]; modifiers: MatchModifiers }
  | { type: 'LOBBY_UPDATE'; players: LobbyPlayerInfo[]; modifiers: MatchModifiers }
  | {
      type: 'START_MATCH';
      players: LobbyPlayerInfo[];
      modifiers: MatchModifiers;
      terrain?: Uint8Array; // RLE snapshot, only sent to players joining a match in progress
    }
  | { type: 'SELECT_WEAPON'; weaponId: WeaponId }
  | { type: 'INPUT'; seq: number; input: WormInput }
  | { type: 'STATE'; worms: WormNetState[]; projectiles: ProjectileNetState[]; events: NetEvent[]; teamScores: number[] }
  | { type: 'MATCH_OVER'; winnerId: string; winnerTeam: number }
  | { type: 'RETURN_TO_LOBBY' }
  | { type: 'PING'; time: number }
  | { type: 'PONG'; time: number };
