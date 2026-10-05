import { CONFIG } from '../config';
import { Terrain } from './Terrain';
import { TerrainGL } from './TerrainGL';
import { Worm, WormInput, EMPTY_INPUT, WormFx, WIZARD_FOOT, WIZARD_HEIGHT, FROZEN_ROBE } from './Worm';
import { drawWizard, animFrames, prepareWizards, drawFx } from './Sprites';
import { GasCloud } from './GasCloud';
import { has, rulesOf, Rules } from './Mutators';
import { WORLD_ENV } from './Env';
import { computeLightning, drawLightning } from './ForceLightning';
import { Projectile, ProjectileWorld } from './Projectile';
import { ParticleManager } from './Particles';
import { sound } from './SoundEffects';
import { WeaponDef, WeaponId } from '../weapons/WeaponDef';
import { WEAPON_REGISTRY, DEFAULT_WEAPON, MONEY_KILL, MONEY_DEATH } from '../weapons/WeaponRegistry';
import { NetworkManager } from '../net/NetworkManager';
import {
  NetEvent,
  NetMessage,
  WormNetState,
  ProjectileNetState,
  MatchModifiers,
  DEFAULT_MODIFIERS,
  LobbyPlayerInfo,
  KillCause
} from '../net/Protocol';

export type Role = 'host' | 'client';
export type Phase = 'menu' | 'lobby' | 'playing' | 'over';

export interface MatchResult {
  winnerName: string;
  winnerTeam: number; // -1 when not a team game
  isLocalWinner: boolean;
  standings: Worm[];
}

type StateMessage = Extract<NetMessage, { type: 'STATE' }>;

const HOST_TIMEOUT_MS = 8000;
/** How long a fallen wizard stays on the ground */
const CORPSE_MS = 4000;

interface Corpse { x: number; y: number; vx: number; vy: number; facing: number; color: string; born: number }
/** Portails Jumeaux: each caster owns up to 2 linked portals */
interface Portal { owner: string; x: number; y: number; age: number }
const PORTAL_LIFE = 1500;
const PORTAL_RADIUS = 8;
/** Anomalie gravitationnelle */
interface GravityZone { x: number; y: number; age: number }
const ZONE_LIFE = 360;
const ZONE_RADIUS = 58;
/** Explosion waiting to happen (powder chain reactions, martyrs) — host only */
interface PendingBlast { x: number; y: number; r: number; damage: number; owner: string; delay: number; color: string }
/** Rising lava: starts after 30 s, rises 4 px every 3 s, stops at 40 % of the map */
const LAVA_START = 1800;
const LAVA_STEP_TICKS = 180;
const LAVA_STEP_PX = 4;
/** Destroyed crystal pixels per gold coin (a cluster ≈ 100 px ≈ 20 gold) */
const CRYSTAL_PIXELS_PER_GOLD = 5;
const randomSeed = () => Math.floor(Math.random() * 1_000_000) + 1;

/**
 * Game simulation. The host is authoritative: it simulates everything and broadcasts
 * the world state 60×/s. Clients predict their own wizard (with input replay on each
 * host update) and render everything else from the host state.
 */
export class Game implements ProjectileWorld {
  public canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  public terrain = new Terrain();
  public particles = new ParticleManager();
  public worms: Worm[] = [];
  public projectiles: Projectile[] = [];
  private nextProjectileId = 1;

  public role: Role = 'host';
  public phase: Phase = 'menu';
  public net: NetworkManager;
  public modifiers: MatchModifiers = { ...DEFAULT_MODIFIERS };
  public players: LobbyPlayerInfo[] = [];
  public teamScores: number[] = [0, 0];
  public result: MatchResult | null = null;

  // Inputs
  public localInput: WormInput = { ...EMPTY_INPUT };
  private remoteInputs = new Map<string, { queue: { seq: number; input: WormInput }[]; last: WormInput; ack: number }>();
  private inputSeq = 0;
  private inputHistory: { seq: number; input: WormInput }[] = [];
  private pendingStates: StateMessage[] = [];

  // Host → clients event queue
  private pendingEvents: NetEvent[] = [];
  private acidTick = 0;

  // Rendering
  private lastTickTime = 0;
  private lastRenderTime = 0;
  private frame = 0;
  private shakeTime = 0;
  private shakeIntensity = 0;
  /** Fallen wizards playing their death animation (purely visual) */
  private corpses: Corpse[] = [];
  /** Toxic clouds of the Fiole Pestilentielle (host and clients) */
  private gasClouds: GasCloud[] = [];
  /** Curse state seen at the previous tick, to play the transformation effects once */
  private curseSeen = new Map<string, { sheep: boolean; bubble: boolean; drunk: boolean }>();
  private lastCrackle = 0;
  private portals: Portal[] = [];
  private zones: GravityZone[] = [];
  private pendingBlasts: PendingBlast[] = [];
  /** Storm mutator: horizontal acceleration (host decides, synced in STATE) */
  public wind = 0;
  private matchTicks = 0;
  private lavaLevel = CONFIG.MAP_HEIGHT;
  /** Combined effect of the active mutators */
  public get rules(): Rules {
    return rulesOf(this.modifiers.mutators);
  }
  public mut(id: Parameters<typeof has>[1]): boolean {
    return has(this.modifiers.mutators, id);
  }
  /** Smooth WebGL terrain layers, stacked under and over the 2D canvas (null → pixel 2D renderer) */
  private glSolid: TerrainGL | null = null;
  private glLiquid: TerrainGL | null = null;
  public camX = CONFIG.MAP_WIDTH / 2;
  public camY = CONFIG.MAP_HEIGHT / 2;
  public camZoom = 3.5;
  private camFollowing = false;

  // UI callbacks
  public onLobbyUpdate?: () => void;
  public onWelcome?: () => void;
  public onMatchStart?: () => void;
  public onMatchOver?: (result: MatchResult) => void;
  public onReturnToLobby?: () => void;
  public onKill?: (killer: string | null, victim: string, cause?: KillCause) => void;
  /** The local wizard died (or the match starts): open the grimoire */
  public onLocalDeath?: (worm: Worm) => void;
  /** The connection to the host was lost */
  public onDisconnected?: () => void;

  constructor(canvas: HTMLCanvasElement, net: NetworkManager) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.net = net;
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    this.setupNetworkCallbacks();
    this.setSmoothTerrain(Game.loadSmoothPreference());
    // Gravity anomalies reverse gravity inside them (for wizards, spells and particles)
    WORLD_ENV.gravityAt = (x, y) => {
      for (const z of this.zones) if ((x - z.x) ** 2 + (y - z.y) ** 2 < ZONE_RADIUS * ZONE_RADIUS) return -0.7;
      return 1;
    };
    // Collapsing sand raises a cloud of dust
    this.terrain.onSandFall = (x0, y0, x1, y1) => {
      const n = Math.min(40, Math.round((x1 - x0 + 1) * (y1 - y0 + 1) / 60));
      for (let i = 0; i < n; i++) {
        const x = x0 + Math.random() * (x1 - x0);
        const y = y0 + Math.random() * (y1 - y0);
        if (Math.random() < 0.5) this.particles.spawn(x, y, (Math.random() - 0.5) * 0.4, 0.6 + Math.random(), 'dirt', '#d9b97a', 1.2, 30);
        else this.particles.spawn(x, y, (Math.random() - 0.5) * 0.3, -0.1, 'smoke', '#c8a978', 6, 40);
      }
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Graphics: smooth (WebGL) or pixel (2D) terrain
  // ════════════════════════════════════════════════════════════════════════

  /** 'on' / 'off' forced by the player, or null = automatic (smooth when a GPU is available) */
  private static loadSmoothPreference(): boolean | null {
    try {
      const v = localStorage.getItem('arcane_worms_smooth');
      return v === null ? null : v === '1';
    } catch {
      return null;
    }
  }

  public get smoothTerrain(): boolean {
    return !!this.glSolid?.ok && !!this.glLiquid?.ok;
  }

  /**
   * Turns the smooth renderer on/off. `null` = automatic: on only with a real GPU.
   * Returns whether it is active.
   */
  public setSmoothTerrain(on: boolean | null): boolean {
    const want = on !== false;
    if (want && !this.glSolid) {
      this.glSolid = TerrainGL.create('solid', on === true);
      this.glLiquid = this.glSolid ? TerrainGL.create('liquid', on === true) : null;
      if (this.glSolid && this.glLiquid) {
        // Layers: [GL background + solids] < [2D wizards & spells] < [GL water & lava]
        this.canvas.before(this.glSolid.canvas);
        this.canvas.after(this.glLiquid.canvas);
      } else {
        this.glSolid = this.glLiquid = null;
      }
    }
    const active = want && this.smoothTerrain;
    for (const gl of [this.glSolid, this.glLiquid]) {
      if (gl) gl.canvas.style.display = active ? '' : 'none';
    }
    this.canvas.classList.toggle('over-terrain', active);
    if (on !== null) {
      try {
        localStorage.setItem('arcane_worms_smooth', on ? '1' : '0');
      } catch {
        // storage unavailable
      }
    }
    this.smoothActive = active;
    return active;
  }
  /** Smooth renderer currently used */
  public smoothActive = false;

  // ════════════════════════════════════════════════════════════════════════
  // Accessors
  // ════════════════════════════════════════════════════════════════════════

  public get localId(): string {
    return this.net.myPeerId;
  }

  public getLocalWorm(): Worm | undefined {
    return this.worms.find(w => w.id === this.localId);
  }

  public isInMatch(): boolean {
    return this.phase === 'playing' || this.phase === 'over';
  }

  public teamOf(id: string): number {
    return this.modifiers.teams[id] ?? 0;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Lobby (host)
  // ════════════════════════════════════════════════════════════════════════

  public openHostLobby(name: string) {
    this.role = 'host';
    this.phase = 'lobby';
    this.modifiers = { ...DEFAULT_MODIFIERS, teams: {}, mapSeed: randomSeed() };
    this.players = [{ id: this.localId, name, color: CONFIG.PLAYER_COLORS[0], isHost: true }];
    this.worms = [];
    this.remoteInputs.clear();
    this.emitLobby();
  }

  public prepareClient() {
    this.role = 'client';
    this.phase = 'lobby';
    this.players = [];
    this.worms = [];
    this.pendingStates = [];
  }

  public setModifiers(partial: Partial<MatchModifiers>) {
    if (this.role !== 'host') return;
    this.modifiers = { ...this.modifiers, ...partial };
    if (this.modifiers.gameMode === 'teams') this.assignMissingTeams();
    this.emitLobby();
  }

  public newMapSeed() {
    this.setModifiers({ mapSeed: randomSeed() });
  }

  public toggleTeam(playerId: string) {
    const teams = { ...this.modifiers.teams, [playerId]: this.teamOf(playerId) === 0 ? 1 : 0 };
    this.setModifiers({ teams });
  }

  private assignMissingTeams() {
    const teams = { ...this.modifiers.teams };
    for (const p of this.players) {
      if (teams[p.id] === undefined) {
        const red = this.players.filter(q => teams[q.id] === 0).length;
        const blue = this.players.filter(q => teams[q.id] === 1).length;
        teams[p.id] = red <= blue ? 0 : 1;
      }
    }
    this.modifiers.teams = teams;
  }

  private emitLobby() {
    if (this.role === 'host') {
      this.net.broadcast({ type: 'LOBBY_UPDATE', players: this.players, modifiers: this.modifiers });
    }
    this.onLobbyUpdate?.();
  }

  // ════════════════════════════════════════════════════════════════════════
  // Match flow
  // ════════════════════════════════════════════════════════════════════════

  public startMatch() {
    if (this.role !== 'host') return;
    if (this.modifiers.gameMode === 'teams') this.assignMissingTeams();
    this.setupMatch();
    this.worms = this.players.map(p => this.createWorm(p));
    this.net.broadcast({ type: 'START_MATCH', players: this.players, modifiers: this.modifiers });
    this.onMatchStart?.();
    this.openLocalShop();
  }

  public rematch() {
    if (this.role !== 'host') return;
    this.modifiers.mapSeed = randomSeed();
    this.startMatch();
  }

  public returnToLobby() {
    if (this.role !== 'host') return;
    this.phase = 'lobby';
    this.worms = [];
    this.projectiles = [];
    this.modifiers.mapSeed = randomSeed();
    this.net.broadcast({ type: 'RETURN_TO_LOBBY' });
    this.emitLobby();
    this.onReturnToLobby?.();
  }

  public leave() {
    this.phase = 'menu';
    this.worms = [];
    this.projectiles = [];
    this.players = [];
    this.net.close();
  }

  private setupMatch() {
    const m = this.modifiers;
    this.terrain.generateMap(m.mapSeed, m.mapType, rulesOf(m.mutators).hazards, m.gameMode === 'koth' ? CONFIG.KOTH_ZONE_RADIUS : 0);
    this.portals = [];
    this.zones = [];
    this.pendingBlasts = [];
    this.wind = 0;
    WORLD_ENV.wind = 0;
    this.matchTicks = 0;
    this.lavaLevel = this.terrain.height - 11;
    this.particles.clear();
    this.corpses = [];
    this.gasClouds = [];
    this.curseSeen.clear();
    this.projectiles = [];
    this.pendingEvents = [];
    this.pendingStates = [];
    this.inputHistory = [];
    this.remoteInputs.clear();
    this.teamScores = [0, 0];
    this.result = null;
    this.camFollowing = false;
    this.camX = CONFIG.MAP_WIDTH / 2;
    this.camY = CONFIG.MAP_HEIGHT / 2;
    this.phase = 'playing';
    // Recolour the wizard sprites while the players are in the grimoire (no hitch at spawn)
    setTimeout(() => prepareWizards([...this.players.map(p => p.color), FROZEN_ROBE]), 50);
  }

  private createWorm(p: LobbyPlayerInfo): Worm {
    const w = new Worm(p.id, p.name, p.color);
    w.applyModifiers(this.modifiers);
    return w;
  }

  private openLocalShop() {
    const local = this.getLocalWorm();
    if (local) this.onLocalDeath?.(local);
  }

  /** The local player confirmed a spell in the grimoire. */
  public chooseWeapon(weaponId: WeaponId) {
    if (this.role === 'host') {
      this.applyWeaponChoice(this.localId, weaponId);
    } else {
      this.net.broadcast({ type: 'SELECT_WEAPON', weaponId });
    }
  }

  /** Host: pay for the spell (if affordable) and respawn the wizard. */
  private applyWeaponChoice(wormId: string, weaponId: WeaponId) {
    const w = this.worms.find(worm => worm.id === wormId);
    if (!w || w.isAlive() || this.phase !== 'playing') return;
    const def = WEAPON_REGISTRY[weaponId];
    if (def && (this.rules.freeSpells || w.money >= def.price)) {
      if (!this.rules.freeSpells) w.money -= def.price;
      w.setWeapon(weaponId);
    } else {
      w.setWeapon(DEFAULT_WEAPON);
    }
    const others = this.worms.filter(o => o !== w && o.isAlive());
    const spawn = this.terrain.findSpawnPoint(others);
    w.spawn(spawn.x, spawn.y);
  }

  private endMatch(winner: Worm, winnerTeam: number) {
    if (this.phase !== 'playing') return;
    this.phase = 'over';
    this.net.broadcast({ type: 'MATCH_OVER', winnerId: winner.id, winnerTeam });
    this.showResult(winner, winnerTeam);
  }

  private showResult(winner: Worm | undefined, winnerTeam: number) {
    const local = this.getLocalWorm();
    const isTeams = winnerTeam >= 0;
    const result: MatchResult = {
      winnerName: isTeams ? `Équipe ${CONFIG.TEAM_NAMES[winnerTeam]}` : (winner?.name ?? '?'),
      winnerTeam,
      isLocalWinner: isTeams ? !!local && this.teamOf(local.id) === winnerTeam : !!local && local === winner,
      standings: this.getStandings()
    };
    this.result = result;
    this.onMatchOver?.(result);
  }

  public getStandings(): Worm[] {
    const key = (w: Worm) => (this.modifiers.gameMode === 'koth' ? w.score : w.frags);
    return [...this.worms].sort((a, b) => key(b) - key(a) || a.deaths - b.deaths);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Networking
  // ════════════════════════════════════════════════════════════════════════

  private setupNetworkCallbacks() {
    this.net.onMessageReceived = (msg, fromId) => {
      if (this.role === 'host') this.handleHostMessage(msg, fromId);
      else this.handleClientMessage(msg);
    };

    this.net.onPeerLeft = (peerId) => {
      if (this.role === 'host') {
        this.players = this.players.filter(p => p.id !== peerId);
        this.worms = this.worms.filter(w => w.id !== peerId);
        this.remoteInputs.delete(peerId);
        const teams = { ...this.modifiers.teams };
        delete teams[peerId];
        this.modifiers.teams = teams;
        if (this.phase !== 'menu') this.emitLobby();
      } else if (this.phase !== 'menu') {
        this.phase = 'menu';
        this.onDisconnected?.();
      }
    };
  }

  private handleHostMessage(msg: NetMessage, fromId: string) {
    switch (msg.type) {
      case 'JOIN':
        this.handleJoin(fromId, msg.name);
        break;
      case 'INPUT': {
        let entry = this.remoteInputs.get(fromId);
        if (!entry) {
          entry = { queue: [], last: { ...EMPTY_INPUT }, ack: 0 };
          this.remoteInputs.set(fromId, entry);
        }
        entry.queue.push({ seq: msg.seq, input: msg.input });
        break;
      }
      case 'SELECT_WEAPON':
        this.applyWeaponChoice(fromId, msg.weaponId);
        break;
    }
  }

  private handleJoin(peerId: string, rawName: string) {
    if (this.phase === 'menu') return;
    let player = this.players.find(p => p.id === peerId);
    const isNew = !player;
    if (!player) {
      if (this.players.length >= CONFIG.MAX_PLAYERS) return;
      const used = new Set(this.players.map(p => p.color));
      const color = CONFIG.PLAYER_COLORS.find(c => !used.has(c)) ?? CONFIG.PLAYER_COLORS[0];
      const name = (rawName || '').trim().slice(0, 16) || `Sorcier ${this.players.length + 1}`;
      player = { id: peerId, name, color, isHost: false };
      this.players.push(player);
      if (this.modifiers.gameMode === 'teams') this.assignMissingTeams();
    }

    this.net.sendTo(peerId, { type: 'WELCOME', playerId: peerId, players: this.players, modifiers: this.modifiers });

    // Joining a match in progress: send a snapshot of the (already blasted) terrain
    if (isNew && this.isInMatch()) {
      this.worms.push(this.createWorm(player));
      this.net.sendTo(peerId, {
        type: 'START_MATCH',
        players: this.players,
        modifiers: this.modifiers,
        terrain: this.terrain.encodeMaterials()
      });
    }
    this.emitLobby();
  }

  private handleClientMessage(msg: NetMessage) {
    switch (msg.type) {
      case 'WELCOME':
        this.players = msg.players;
        this.modifiers = msg.modifiers;
        this.onWelcome?.();
        this.onLobbyUpdate?.();
        break;
      case 'LOBBY_UPDATE':
        this.players = msg.players;
        this.modifiers = msg.modifiers;
        this.onLobbyUpdate?.();
        break;
      case 'START_MATCH':
        this.players = msg.players;
        this.modifiers = msg.modifiers;
        this.setupMatch();
        if (msg.terrain) this.terrain.loadMaterials(new Uint8Array(msg.terrain));
        this.worms = this.players.map(p => this.createWorm(p));
        this.onMatchStart?.();
        this.openLocalShop();
        break;
      case 'STATE':
        if (this.isInMatch()) this.pendingStates.push(msg);
        break;
      case 'MATCH_OVER':
        this.flushStates();
        this.phase = 'over';
        this.showResult(this.worms.find(w => w.id === msg.winnerId), msg.winnerTeam);
        break;
      case 'RETURN_TO_LOBBY':
        this.phase = 'lobby';
        this.worms = [];
        this.projectiles = [];
        this.onReturnToLobby?.();
        break;
    }
  }

  private emit(ev: NetEvent) {
    if (this.role === 'host') this.pendingEvents.push(ev);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Simulation tick (60 Hz)
  // ════════════════════════════════════════════════════════════════════════

  public update() {
    if (!this.isInMatch()) return;
    this.lastTickTime = performance.now();
    this.frame++;
    if (this.shakeTime > 0) this.shakeTime--;

    if (this.role === 'client') {
      this.updateClient();
    } else if (this.phase === 'playing') {
      this.updateHost();
    }
    // Burning wizards smoke (host and clients)
    if (this.frame % 2 === 0) {
      for (const w of this.worms) {
        if (w.isAlive() && w.burnTimer > 0) {
          this.particles.spawn(w.x + (Math.random() - 0.5) * 8, w.y + (Math.random() - 0.5) * 8,
            (Math.random() - 0.5) * 0.4, -0.6, 'fire', undefined, 6, 16);
        }
      }
    }
    this.updateCorpses();
    this.updateFields();
    this.updateGas();
    this.curseEffects();
    this.particles.update(this.terrain);
  }

  private updateClient() {
    // The host streams 60 states/s during a match: a long silence means it is gone
    if (this.phase === 'playing' && performance.now() - this.net.lastPacketTime > HOST_TIMEOUT_MS) {
      this.leave();
      this.onDisconnected?.();
      return;
    }
    this.flushStates();
    if (this.phase !== 'playing') return;

    // Send the input, then predict our own wizard with it
    const seq = ++this.inputSeq;
    const input = { ...this.localInput };
    this.net.broadcast({ type: 'INPUT', seq, input });

    const local = this.getLocalWorm();
    if (local && local.isAlive()) {
      this.inputHistory.push({ seq, input });
      if (this.inputHistory.length > 120) this.inputHistory.shift();
      local.update(input, this.terrain, this.clientFx);
      this.portalStep(local); // predicted; the host does the same
    }
    for (const p of this.projectiles) p.spawnTrail(this.particles);
  }

  private clientFx: WormFx = {
    particles: this.particles,
    onShoot: (w, weapon, angle) => this.castFX(w, weapon, angle),
    playSounds: true
  };

  private updateHost() {
    const mods = this.modifiers;
    this.updateWorldHost();

    // 1. Wizards
    for (const worm of this.worms) {
      let input: WormInput;
      if (worm.id === this.localId) {
        input = this.localInput;
      } else {
        const entry = this.remoteInputs.get(worm.id);
        if (entry) {
          // One input per tick; drop the backlog if the client got far ahead
          if (entry.queue.length > 6) entry.queue.splice(0, entry.queue.length - 2);
          const next = entry.queue.shift();
          if (next) {
            entry.last = next.input;
            entry.ack = next.seq;
          }
          input = entry.last;
        } else {
          input = EMPTY_INPUT;
        }
      }
      worm.update(input, this.terrain, {
        particles: this.particles,
        onShoot: (w, weapon, angle) => this.hostShoot(w, weapon, angle),
        playSounds: worm.id === this.localId
      });
      this.portalStep(worm);

      // Status effects
      if (worm.shieldTimer > 0) worm.shieldTimer--;
      if (worm.burnTimer > 0) {
        if (!worm.isAlive()) {
          worm.burnTimer = 0;
        } else if (--worm.burnTimer % 10 === 0) {
          this.damageWorm(worm, 2, 0, 0, worm.burnBy, true);
        }
      }
    }

    // 2. Environment: acid corrodes, lava burns, water puts fires out (checked 10×/s)
    if (++this.acidTick >= 6) {
      this.acidTick = 0;
      const t = this.terrain;
      for (const w of this.worms) {
        if (!w.isAlive()) continue;
        const fluid = t.fluidAt(w.x, w.y);
        if (fluid === CONFIG.MAT_WATER) {
          w.burnTimer = 0;
        } else if (fluid === CONFIG.MAT_LAVA || t.fluidAt(w.x, w.y + 5) === CONFIG.MAT_LAVA) {
          w.burnTimer = Math.max(w.burnTimer, 120);
          w.burnBy = 'lava';
          this.damageWorm(w, 4, 0, -0.6, 'lava', true);
          continue;
        }
        if (t.isAcid(w.x, w.y + 6) || t.isAcid(w.x - 3, w.y + 6) || t.isAcid(w.x + 3, w.y + 6) ||
            t.isAcid(w.x - 6, w.y) || t.isAcid(w.x + 6, w.y)) {
          this.particles.spawn(w.x + (Math.random() - 0.5) * 8, w.y + 4, (Math.random() - 0.5) * 0.5, -0.8, 'spark', '#44ff44', 1.5, 15);
          this.damageWorm(w, 3, 0, 0, 'acid', true);
        }
      }
    }

    // 3. Projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.update(this);
      if (p.alive && !p.weapon.portal && !p.attachedTo && p.portalCooldown <= 0 && this.portals.length >= 2) {
        const exit = this.portalExit(p.x, p.y);
        if (exit) {
          this.portalFX(p.x, p.y, exit);
          p.x = p.prevX = exit.x;
          p.y = p.prevY = exit.y;
          p.portalCooldown = 20;
        }
      }
    }
    this.projectiles = this.projectiles.filter(p => p.alive);

    // 4. King of the hill
    if (mods.gameMode === 'koth' && this.phase === 'playing') this.updateKOTH();

    // 5. Broadcast
    this.broadcastState();
  }

  private updateKOTH() {
    const zx = this.terrain.width / 2;
    const zy = this.terrain.height / 2;
    const inZone = this.worms.filter(w => w.isAlive() && Math.hypot(w.x - zx, w.y - zy) <= CONFIG.KOTH_ZONE_RADIUS);
    if (inZone.length !== 1) return; // contested or empty
    const holder = inZone[0];
    holder.score++;
    if (holder.score >= this.modifiers.fragLimit * CONFIG.KOTH_SECONDS_PER_POINT * 60) {
      this.endMatch(holder, -1);
    }
  }

  private hostShoot(worm: Worm, weapon: WeaponDef, angle: number) {
    if (weapon.channel) {
      this.lightningTick(worm, weapon);
      this.castFX(worm, weapon, angle);
      this.chaosSwap(worm);
      return; // the arcs are drawn from the synced "channelling" flag, no event needed
    }
    if (weapon.shieldDuration) {
      worm.shieldTimer = weapon.shieldDuration;
      this.castFX(worm, weapon, angle);
      this.emit({ t: 'shot', id: worm.id, w: weapon.id });
      this.chaosSwap(worm);
      return;
    }
    const ox = worm.x + Math.cos(angle) * 9;
    const oy = worm.y + Math.sin(angle) * 9;
    const count = weapon.pelletCount ?? 1;
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * weapon.spread;
      const speed = weapon.projectileSpeed * (count > 1 ? 0.9 + Math.random() * 0.2 : 1);
      this.spawnProjectile(worm.id, weapon, ox, oy, Math.cos(a) * speed, Math.sin(a) * speed);
    }
    this.castFX(worm, weapon, angle);
    this.emit({ t: 'shot', id: worm.id, w: weapon.id });
    this.chaosSwap(worm);
  }

  /** Sorts aléatoires: a new random spell after each cast (the cooldown stays) */
  private chaosSwap(worm: Worm) {
    if (!this.mut('chaos')) return;
    const ids = Object.keys(WEAPON_REGISTRY) as WeaponId[];
    worm.weapon = WEAPON_REGISTRY[ids[Math.floor(Math.random() * ids.length)]];
  }

  // ── ProjectileWorld: small helpers ────────────────────────────────────────

  public hurt(w: Worm, dmg: number, ownerId: string) {
    this.damageWorm(w, dmg, 0, 0, ownerId, true);
  }

  public pass(_p: Projectile, to: Worm) {
    sound.playBouncy();
    for (let i = 0; i < 6; i++) {
      this.particles.spawn(to.x, to.y - 14, (Math.random() - 0.5) * 1.5, -Math.random() * 1.5, 'spark', '#ffd27a', 1, 14);
    }
  }

  /** Casting sound + staff sparkle */
  private castFX(worm: Worm, weapon: WeaponDef, angle: number) {
    if (weapon.channel) {
      worm.channelTimer = 6;
      return; // crackling sound and arcs are handled while rendering
    }
    sound.playSpellForWeapon(weapon.id);
    worm.onCast();
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const x = worm.x + worm.facing * 1.5 + c * 10;
    const y = worm.y - 5 + s * 10;
    this.particles.spawn(x, y, c * 0.3, s * 0.3, 'flash', weapon.elementColor, 9, 8).sprite = 'magic_05';
    for (let i = 0; i < 4; i++) {
      const a = angle + (Math.random() - 0.5) * 0.9;
      const sp = 1 + Math.random() * 1.5;
      this.particles.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 'spark', weapon.elementColor, 0.9, 10 + Math.floor(Math.random() * 8));
    }
  }

  // ── ProjectileWorld implementation (host) ────────────────────────────────

  public explode(p: Projectile, directHit: Worm | null) {
    const weapon = p.weapon;
    const x = p.x;
    const y = p.y;
    const q = Math.round;

    // Rempart: builds terrain instead of blasting it
    if (weapon.buildRadius) {
      const keep = this.worms.filter(w => w.isAlive()).flatMap(w => [q(w.x), q(w.y)]);
      this.terrain.addDirt(q(x), q(y), weapon.buildRadius, keep);
      this.emit({ t: 'fill', x: q(x), y: q(y), r: weapon.buildRadius, keep });
      this.particles.spawnExplosionFX(x, y, 8, '#c08040');
      sound.playGrenadeBounce();
      return;
    }

    // Portails Jumeaux: a portal opens just before the impact point
    if (weapon.portal) {
      const sp = Math.hypot(p.vx, p.vy) || 1;
      let px = x - (p.vx / sp) * 6;
      let py = y - (p.vy / sp) * 6;
      for (let k = 0; k < 8 && this.terrain.isSolid(px, py); k++) py -= 2;
      px = q(px);
      py = q(py);
      this.addPortal(p.ownerId, px, py);
      this.emit({ t: 'portal', o: p.ownerId, x: px, y: py });
      return;
    }
    // Anomalie gravitationnelle
    if (weapon.antigravity) {
      this.addZone(q(x), q(y));
      this.emit({ t: 'zone', x: q(x), y: q(y) });
      return;
    }
    // Tornade: dissipates and flings everyone it was carrying
    if (weapon.tornado) {
      for (const w of this.worms) {
        if (w.isAlive() && Math.abs(w.x - x) < 18 && w.y - y < 8 && w.y - y > -50) {
          w.vx += (p.vx >= 0 ? 1 : -1) * 2.5;
          w.vy = Math.min(w.vy, -3.5);
        }
      }
      this.explosionFX(x, y - 10, 6, '#dfe9f2');
      this.emit({ t: 'boom', x: q(x), y: q(y - 10), r: 6, c: '#dfe9f2' });
      return;
    }

    const r = weapon.craterRadius * this.rules.explosionScale;
    this.carveCrater(x, y, r, !!weapon.fire, p.ownerId);

    // Translocation: the caster appears where the orb stopped
    if (weapon.teleport) {
      const owner = this.worms.find(w => w.id === p.ownerId && w.isAlive());
      if (owner) {
        const from = { x: owner.x, y: owner.y };
        owner.x = owner.prevX = x;
        owner.y = owner.prevY = y;
        owner.vx = owner.vy = 0;
        owner.rope.release();
        this.teleportFX(from.x, from.y, x, y);
        this.emit({ t: 'tp', x0: q(from.x), y0: q(from.y), x1: q(x), y1: q(y) });
      }
      return;
    }

    // Permutation: the caster and the wizard hit swap places
    if (weapon.swap) {
      const owner = this.worms.find(w => w.id === p.ownerId && w.isAlive());
      const target = directHit ?? this.nearestWizard(x, y, 14, p.ownerId);
      if (owner && target && target !== owner) {
        const a = { x: owner.x, y: owner.y };
        owner.x = owner.prevX = target.x;
        owner.y = owner.prevY = target.y;
        target.x = target.prevX = a.x;
        target.y = target.prevY = a.y;
        for (const w of [owner, target]) {
          w.vx = w.vy = 0;
          w.rope.release();
        }
        this.teleportFX(a.x, a.y, owner.x, owner.y);
        this.emit({ t: 'tp', x0: q(a.x), y0: q(a.y), x1: q(owner.x), y1: q(owner.y) });
      } else {
        this.explosionFX(x, y, 4, weapon.elementColor);
        this.emit({ t: 'boom', x: q(x), y: q(y), r: 4, c: weapon.elementColor });
      }
      return;
    }

    // Curses (sheep, bubble, drunk): the wizard hit, or those right next to the impact
    if (weapon.status) {
      const victims = directHit ? [directHit] : this.worms.filter(w => w.isAlive() && w.id !== p.ownerId && Math.hypot(w.x - x, w.y - y) < 20);
      for (const w of victims) {
        if (weapon.damage > 0) this.damageWorm(w, weapon.damage, 0, -0.5, p.ownerId, true);
        if (w.isAlive()) w.curse(weapon.status, weapon.statusDuration ?? 300);
      }
      this.explosionFX(x, y, 6, weapon.elementColor);
      this.emit({ t: 'boom', x: q(x), y: q(y), r: 6, c: weapon.elementColor });
      return;
    }

    // Fiole Pestilentielle: the toxic cloud
    if (weapon.gasCloud) {
      this.gasClouds.push(new GasCloud(q(x), q(y), this.terrain, p.ownerId));
      this.emit({ t: 'gas', x: q(x), y: q(y), o: p.ownerId });
      sound.playGas();
    }

    this.blast(x, y, r, weapon.damage, p.ownerId, weapon.elementColor, !!weapon.fire, directHit, p);
    this.afterBlast(p, x, y, r);
  }

  /**
   * Carves a crater with exactly the (rounded) values sent to the clients so the terrains
   * stay identical. Breaking crystals pays gold, breaking blasting powder sets it off.
   */
  private carveCrater(x: number, y: number, r: number, fire: boolean, ownerId: string) {
    const q = Math.round;
    const cr = Math.round(r * 10) / 10;
    if (cr <= 0) return;
    const carved = this.terrain.carveCircle(q(x), q(y), cr, fire);
    if (!carved.modified) return;
    this.emit({ t: 'crater', x: q(x), y: q(y), r: cr, ...(fire ? { f: 1 as const } : {}) });
    this.crystalReward(x, y, carved.crystals, ownerId);
    this.ignitePowder(carved.powder, ownerId);
  }

  /** Blasting powder that was hit goes off a moment later (and sets off the powder next to it) */
  private ignitePowder(pts: number[], ownerId: string) {
    const n = pts.length / 2;
    if (n < 4 || this.pendingBlasts.length > 40) return;
    const picks = n < 40 ? [0] : n < 120 ? [0, n - 1] : [0, Math.floor(n / 2), n - 1];
    picks.forEach((i, k) => {
      this.pendingBlasts.push({
        x: pts[i * 2], y: pts[i * 2 + 1], r: Math.min(22, 11 + Math.sqrt(n) * 0.9), damage: 38,
        owner: ownerId, delay: 7 + k * 4 + Math.floor(Math.random() * 5), color: '#ff7a1a'
      });
    });
  }

  /** Delayed explosions (powder chains, martyrs) — host */
  private updatePendingBlasts() {
    for (const b of this.pendingBlasts) b.delay--;
    const ready = this.pendingBlasts.filter(b => b.delay <= 0);
    if (ready.length === 0) return;
    this.pendingBlasts = this.pendingBlasts.filter(b => b.delay > 0);
    for (const b of ready) {
      this.carveCrater(b.x, b.y, b.r, true, b.owner);
      this.blast(b.x, b.y, b.r, b.damage, b.owner, b.color, true, null, null);
    }
  }

  /**
   * Explosion FX + damage with falloff (full damage on a direct hit) + knock-back.
   * Decoys caught in it go off too.
   */
  private blast(x: number, y: number, r: number, damage: number, ownerId: string, color: string, fire: boolean,
    directHit: Worm | null, p: Projectile | null) {
    const q = Math.round;
    this.explosionFX(x, y, r, color, fire);
    this.emit({ t: 'boom', x: q(x), y: q(y), r: q(r), c: color, ...(fire ? { f: 1 as const } : {}) });

    for (const d of this.projectiles) {
      if (d.alive && d.weapon.decoy && d !== p && Math.hypot(d.x - x, d.y - y) < r + 6) d.detonate(this, null);
    }

    const reach = Math.max(r * 1.5, 6);
    const knockScale = Math.min(5, 0.5 + damage / 12);
    for (const w of this.worms) {
      if (!w.isAlive() || (p && w.id === p.reflectedBy)) continue;
      const dx = w.x - x;
      const dy = w.y - y;
      const dist = Math.hypot(dx, dy);
      let falloff: number;
      if (w === directHit) {
        falloff = 1;
      } else {
        falloff = 1 - Math.max(0, dist - w.radius) / reach;
        if (falloff <= 0) continue;
      }
      let kx = 0;
      let ky = -1;
      if (dist > 0.5) {
        kx = dx / dist;
        ky = dy / dist;
      } else if (p) {
        const sp = Math.hypot(p.vx, p.vy) || 1;
        kx = p.vx / sp;
        ky = p.vy / sp;
      }
      const dealt = this.damageWorm(w, Math.round(damage * falloff), kx * knockScale * falloff, ky * knockScale * falloff, ownerId);
      if (p) this.applyHitEffects(p, w, dealt);
    }
  }

  /** Extra effects of some spells once they went off */
  private afterBlast(p: Projectile, x: number, y: number, r: number) {
    const weapon = p.weapon;
    const q = Math.round;

    if (weapon.freezeDuration) {
      const ir = Math.round(r * 3);
      if (this.terrain.freezeWater(q(x), q(y), ir)) this.emit({ t: 'ice', x: q(x), y: q(y), r: ir });
      for (const w of this.worms) {
        if (w.isAlive() && w.id !== p.ownerId && Math.hypot(w.x - x, w.y - y) <= r * 2.5) {
          w.freeze(weapon.freezeDuration);
        }
      }
    }

    // Comète: splits into bouncing star shards
    if (weapon.splitCount && !p.isSubCluster) {
      const shard: WeaponDef = { ...weapon, damage: 20, craterRadius: 12, bounces: 2, splitCount: undefined };
      for (let i = 0; i < weapon.splitCount; i++) {
        const a = (Math.PI * 2 * i) / weapon.splitCount + (Math.random() - 0.5) * 0.4;
        const speed = 2.5 + Math.random() * 3.5;
        this.spawnProjectile(p.ownerId, { ...shard, fuseFrames: 30 + Math.floor(Math.random() * 25) },
          x, y - 2, Math.cos(a) * speed, Math.sin(a) * speed - 1.5, true);
      }
    }

    // Pluie de météores: rocks fall from the ceiling above the beacon
    if (weapon.meteorCount && !p.isSubCluster) {
      const rock: WeaponDef = {
        ...weapon, damage: 32, craterRadius: 14, fuseFrames: 240, gravityScale: 1, meteorCount: undefined
      };
      for (let i = 0; i < weapon.meteorCount; i++) {
        const sx = x + (i - (weapon.meteorCount - 1) / 2) * 14 + (Math.random() - 0.5) * 6;
        let sy = y - 4;
        while (sy > y - 170 && sy > 14 && !this.terrain.isSolid(sx, sy - 1)) sy--;
        this.spawnProjectile(p.ownerId, rock, sx, sy + 2, (Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 1.2, true);
      }
    }
  }

  /** Per-hit effects of the spell that touched a wizard (burning, life steal). */
  private applyHitEffects(p: Projectile, w: Worm, dealt: number) {
    if (dealt <= 0) return;
    const weapon = p.weapon;
    if (weapon.burnDuration && w.id !== p.ownerId) {
      w.burnTimer = Math.max(w.burnTimer, weapon.burnDuration);
      w.burnBy = p.ownerId;
    }
    if (weapon.lifesteal) {
      const caster = this.worms.find(c => c.id === p.ownerId && c.isAlive());
      if (caster && caster !== w) caster.health = Math.min(caster.maxHealth, caster.health + Math.round(dealt * weapon.lifesteal));
    }
  }

  private spawnProjectile(ownerId: string, weapon: WeaponDef, x: number, y: number, vx: number, vy: number, isSubCluster = false) {
    // Ricochets: ordinary spells bounce a few times before exploding
    if (this.mut('ricochet') && !weapon.piercing && !weapon.sticky && !weapon.hopper && !weapon.tornado && !weapon.decoy && !weapon.hotPotato) {
      weapon = { ...weapon, bounces: weapon.bounces + 3 };
    }
    this.projectiles.push(new Projectile({ id: this.nextProjectileId++, ownerId, weapon, x, y, vx, vy, isSubCluster }));
  }

  public pierce(p: Projectile, x0: number, y0: number, x1: number, y1: number) {
    const r = Math.round(p.weapon.craterRadius * this.rules.explosionScale * 10) / 10;
    const fire = !!p.weapon.fire;
    const q = Math.round;
    const carved = this.terrain.carveLine(q(x0), q(y0), q(x1), q(y1), r, fire);
    if (carved.modified) {
      this.emit({ t: 'line', x0: q(x0), y0: q(y0), x1: q(x1), y1: q(y1), r, ...(fire ? { f: 1 as const } : {}) });
      this.crystalReward(x1, y1, carved.crystals, p.ownerId);
      this.ignitePowder(carved.powder, p.ownerId);
    }
  }

  // ── Portals, gravity anomalies, storm and rising lava ─────────────────────

  private addPortal(owner: string, x: number, y: number) {
    const mine = this.portals.filter(o => o.owner === owner);
    if (mine.length >= 2) this.portals.splice(this.portals.indexOf(mine[0]), 1);
    this.portals.push({ owner, x, y, age: 0 });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.particles.spawn(x + Math.cos(a) * 9, y + Math.sin(a) * 9, Math.cos(a) * 0.6, Math.sin(a) * 0.6, 'spark', '#4fd8ff', 1, 20);
    }
    sound.playVortex();
  }

  /** The other end of a linked pair, if (x, y) is inside a portal */
  private portalExit(x: number, y: number): Portal | null {
    for (const a of this.portals) {
      if ((x - a.x) ** 2 + (y - a.y) ** 2 > PORTAL_RADIUS * PORTAL_RADIUS) continue;
      const b = this.portals.find(o => o !== a && o.owner === a.owner);
      if (b) return b;
    }
    return null;
  }

  /** Wizards and spells going through a portal come out of its twin, same speed */
  private portalStep(w: Worm) {
    if (!w.isAlive() || w.portalCooldown > 0 || this.portals.length < 2) return;
    const exit = this.portalExit(w.x, w.y);
    if (!exit) return;
    this.portalFX(w.x, w.y, exit);
    w.x = w.prevX = exit.x;
    w.y = w.prevY = exit.y;
    w.portalCooldown = 30;
    w.rope.release();
  }

  private portalFX(x: number, y: number, exit: Portal) {
    for (const [px, py] of [[x, y], [exit.x, exit.y]]) {
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2;
        this.particles.spawn(px, py, Math.cos(a) * 1.2, Math.sin(a) * 1.2, 'spark', i % 2 ? '#4fd8ff' : '#ff9a3c', 1, 16);
      }
    }
    sound.playDart();
  }

  private addZone(x: number, y: number) {
    this.zones.push({ x, y, age: 0 });
    sound.playVortex();
  }

  /** Common to host and clients: ageing of portals / zones, zone sparkles */
  private updateFields() {
    for (const o of this.portals) o.age++;
    this.portals = this.portals.filter(o => o.age < PORTAL_LIFE);
    for (const z of this.zones) {
      z.age++;
      if (this.frame % 2 === 0) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * ZONE_RADIUS;
        this.particles.spawn(z.x + Math.cos(a) * d, z.y + Math.sin(a) * d, 0, -0.4, 'spark', '#c9a8ff', 0.8, 30);
      }
    }
    this.zones = this.zones.filter(z => z.age < ZONE_LIFE);
  }

  /** Host: storm direction changes, lava rises, delayed explosions go off */
  private updateWorldHost() {
    this.matchTicks++;
    if (this.mut('wind') && this.matchTicks % 900 === 1) {
      this.wind = Math.random() < 0.15 ? 0 : (Math.random() < 0.5 ? -1 : 1) * (0.008 + Math.random() * 0.017);
    }
    WORLD_ENV.wind = this.mut('wind') ? this.wind : 0;
    if (this.mut('risingLava') && this.matchTicks >= LAVA_START && this.matchTicks % LAVA_STEP_TICKS === 0
      && this.lavaLevel > this.terrain.height * 0.4) {
      const water = !this.rules.hazards;
      this.lavaLevel -= LAVA_STEP_PX;
      this.terrain.flood(this.lavaLevel, water);
      this.emit({ t: 'lava', y: this.lavaLevel, ...(water ? { w: 1 as const } : {}) });
    }
    this.updatePendingBlasts();
  }

  /** Breaking mana crystals: sparkles for everyone, gold for the caster (host). */
  private crystalReward(x: number, y: number, crystals: number, ownerId: string) {
    if (crystals <= 0) return;
    for (let i = 0; i < Math.min(24, crystals / 3); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.5 + Math.random() * 2;
      this.particles.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 1, 'spark', Math.random() < 0.5 ? '#d68cff' : '#ffffff', 2, 35);
    }
    if (this.role !== 'host') return;
    const owner = this.worms.find(w => w.id === ownerId);
    if (owner) owner.money += Math.ceil(crystals / CRYSTAL_PIXELS_PER_GOLD);
  }

  public bounce() {
    sound.playGrenadeBounce();
  }

  public reflect() {
    sound.playBouncy();
  }

  private lastCroak = 0;
  public hop() {
    const now = performance.now();
    if (now - this.lastCroak > 180) {
      this.lastCroak = now;
      sound.playCroak();
    }
  }

  /** Applies match rules (self damage, friendly fire, scale) and returns the damage dealt. */
  private damageWorm(w: Worm, damage: number, kx: number, ky: number, attackerId: string, quiet = false): number {
    const mods = this.modifiers;
    const self = attackerId === w.id;
    let dmg = damage;
    if (self && this.rules.noSelfDamage) dmg = 0;
    const environment = attackerId === 'acid' || attackerId === 'lava';
    if (!self && !environment && mods.gameMode === 'teams' && this.teamOf(attackerId) === this.teamOf(w.id)) dmg = 0;
    dmg = Math.round(dmg * mods.damageScale);

    w.takeDamage(dmg, kx, ky);
    // Vampirism: the attacker drinks half of the damage
    if (dmg > 0 && !self && this.mut('vampire')) {
      const a = this.worms.find(o => o.id === attackerId && o.isAlive());
      if (a) a.health = Math.min(a.maxHealth, a.health + Math.ceil(dmg / 2));
    }
    if (dmg > 0 && !quiet) {
      const n = Math.max(5, Math.min(32, Math.round(dmg * 0.7)));
      const k = Math.hypot(kx, ky);
      const dx = k > 0.05 ? Math.round((kx / k) * 10) / 10 : 0;
      const dy = k > 0.05 ? Math.round((ky / k) * 10) / 10 : 0;
      this.bloodFX(Math.round(w.x), Math.round(w.y), n, dx, dy);
      this.emit({ t: 'blood', x: Math.round(w.x), y: Math.round(w.y), n, ...(k > 0.05 ? { dx, dy } : {}) });
      sound.playHurt();
    }
    if (!w.isAlive()) this.onWormKilled(w, attackerId);
    return dmg;
  }

  private onWormKilled(victim: Worm, attackerId: string) {
    if (victim.waitingForShop) return;
    victim.health = 0;
    victim.waitingForShop = true;
    victim.deaths++;
    victim.money += MONEY_DEATH;
    victim.rope.release();
    this.addCorpse(victim);
    sound.playDie();
    if (this.mut('martyr')) {
      this.pendingBlasts.push({ x: victim.x, y: victim.y, r: 26, damage: 50, owner: victim.id, delay: 24, color: '#ff4a2a' });
    }

    const killer = this.worms.find(k => k.id === attackerId);
    let cause: KillCause | undefined;
    if (attackerId === 'acid' || attackerId === 'lava') cause = attackerId;
    else if (!killer || killer === victim) cause = 'self';

    const validKill = killer && killer !== victim;
    this.emit({ t: 'kill', killer: validKill ? killer.name : null, victim: victim.name, cause });
    this.onKill?.(validKill ? killer.name : null, victim.name, cause);

    if (validKill) {
      killer.money += MONEY_KILL;
      killer.frags++;
      if (this.modifiers.gameMode === 'ffa' && killer.frags >= this.modifiers.fragLimit) {
        this.endMatch(killer, -1);
      } else if (this.modifiers.gameMode === 'teams') {
        const team = this.teamOf(killer.id);
        this.teamScores[team]++;
        if (this.teamScores[team] >= this.modifiers.fragLimit) this.endMatch(killer, team);
      }
    }

    if (victim.id === this.localId && this.phase === 'playing') this.onLocalDeath?.(victim);
  }

  /** Closest living wizard (any team) other than `exceptId` */
  private nearestWizard(x: number, y: number, range: number, exceptId: string): Worm | null {
    let best: Worm | null = null;
    let bestDist = range;
    for (const w of this.worms) {
      if (!w.isAlive() || w.id === exceptId) continue;
      const d = Math.hypot(w.x - x, w.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = w;
      }
    }
    return best;
  }

  private isEnemyOf(caster: Worm) {
    const teams = this.modifiers.gameMode === 'teams';
    return (w: Worm) => !teams || this.teamOf(w.id) !== this.teamOf(caster.id);
  }

  /**
   * Mains Foudroyantes (host, every few ticks while the button is held): damages and lifts
   * the wizards caught in the arcs. A mirror shield sends the current back to the caster.
   */
  private lightningTick(caster: Worm, weapon: WeaponDef) {
    const shape = computeLightning(caster, this.worms, this.terrain, this.isEnemyOf(caster));
    const struck = shape.hits.filter(h => h.worm).map(h => h.worm!);
    if (shape.chain) struck.push(shape.chain.to.worm!);
    for (const [i, w] of struck.entries()) {
      const dmg = i === struck.length - 1 && shape.chain ? 1 : weapon.damage;
      if (w.shieldTimer > 0) {
        this.damageWorm(caster, dmg, -Math.cos(shape.angle) * 0.3, -0.2, w.id, true);
        continue;
      }
      // Lifted off the ground and held there, shaking, while the current flows
      w.vx *= 0.6;
      this.damageWorm(w, dmg, 0, w.vy > -0.9 ? -0.55 : 0, caster.id, true);
    }
  }

  /** Gas clouds: spread, bubbles, and (host) poison every quarter second */
  private updateGas() {
    if (this.gasClouds.length === 0) return;
    const hostTick = this.role === 'host' && this.frame % 15 === 0;
    for (const c of this.gasClouds) {
      c.update();
      if (this.frame % 4 === 0) {
        const pt = c.randomPoint();
        if (pt) this.particles.spawn(pt.x, pt.y, (Math.random() - 0.5) * 0.2, -0.15, 'glow', '#9be84a', 3 + Math.random() * 2, 40);
      }
      if (!hostTick) continue;
      for (const w of this.worms) {
        if (!w.isAlive() || c.densityAt(w.x, w.y - 3) < 0.25) continue;
        this.damageWorm(w, 3, 0, 0, c.ownerId, true);
        this.particles.spawn(w.x, w.y - 8, (Math.random() - 0.5) * 0.4, -0.4, 'smoke', '#7fc23a', 5, 25);
      }
    }
    this.gasClouds = this.gasClouds.filter(c => c.alive);
  }

  /** Poofs, bleats and pops when a curse starts or ends (host and clients) */
  private curseEffects() {
    for (const w of this.worms) {
      const now = { sheep: w.isAlive() && w.sheepTimer > 0, bubble: w.isAlive() && w.bubbleTimer > 0, drunk: w.isAlive() && w.drunkTimer > 0 };
      const was = this.curseSeen.get(w.id) ?? { sheep: false, bubble: false, drunk: false };
      if (now.sheep !== was.sheep) {
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * Math.PI * 2;
          this.particles.spawn(w.x, w.y - 3, Math.cos(a) * 0.8, Math.sin(a) * 0.8 - 0.3, 'smoke', '#f2e6ff', 7, 30);
        }
        this.particles.spawn(w.x, w.y - 3, 0, 0, 'flash', '#ff7ad9', 22, 10).sprite = 'star_09';
        if (now.sheep) sound.playBleat();
      }
      if (now.bubble && !was.bubble) sound.playBubble();
      if (!now.bubble && was.bubble && w.isAlive()) {
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          this.particles.spawn(w.x + Math.cos(a) * 12, w.y - 4 + Math.sin(a) * 12, Math.cos(a) * 0.6, Math.sin(a) * 0.6, 'spark', '#dff4ff', 1, 16);
        }
        sound.playPop();
      }
      if (now.drunk && !was.drunk) sound.playHiccup();
      this.curseSeen.set(w.id, now);
    }
  }

  /** Spray of blood in the direction of the hit (from the wizard's body, not his feet). */
  private bloodFX(x: number, y: number, n: number, dx: number, dy: number) {
    this.particles.spawnBloodBurst(x + dx * 2, y - 3 + dy * 2, n, dx, dy, 2.2 + Math.min(2, n / 12));
  }

  // ── Corpses ──────────────────────────────────────────────────────────────

  private addCorpse(w: Worm) {
    this.particles.spawnGibs(w.x, w.y - 3);
    this.corpses.push({ x: w.x, y: w.y, vx: w.vx * 0.5, vy: Math.min(0, w.vy), facing: w.facing, color: w.color, born: performance.now() });
    if (this.corpses.length > 12) this.corpses.shift();
  }

  /** The body falls to the ground (simple gravity), then fades away. */
  private updateCorpses() {
    const now = performance.now();
    this.corpses = this.corpses.filter(c => now - c.born < CORPSE_MS);
    for (const c of this.corpses) {
      c.vy = Math.min(c.vy + CONFIG.GRAVITY, CONFIG.MAX_FALL_SPEED);
      c.vx *= 0.9;
      if (!this.terrain.isSolid(c.x + c.vx, c.y)) c.x += c.vx;
      const steps = Math.ceil(Math.abs(c.vy));
      for (let i = 0; i < steps; i++) {
        const dy = c.vy / steps;
        if (this.terrain.isSolid(c.x, c.y + WIZARD_FOOT + dy)) {
          c.vy = 0;
          break;
        }
        c.y += dy;
      }
      if (this.terrain.fluidAt(c.x, c.y)) c.vy *= 0.5;
    }
  }

  private drawCorpses(ctx: CanvasRenderingContext2D, now: number) {
    for (const c of this.corpses) {
      const t = now - c.born;
      const frames = animFrames('die');
      const frame = Math.min(frames - 1, Math.floor(t / 85));
      ctx.globalAlpha = Math.max(0, Math.min(1, (CORPSE_MS - t) / 700));
      drawWizard(ctx, c.color, 'die', frame, c.x, c.y + WIZARD_FOOT, c.facing, WIZARD_HEIGHT);
    }
    ctx.globalAlpha = 1;
  }

  private teleportFX(x0: number, y0: number, x1: number, y1: number) {
    for (const [x, y] of [[x0, y0], [x1, y1]]) {
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2;
        this.particles.spawn(x, y, Math.cos(a) * 1.5, Math.sin(a) * 1.5, 'spark', '#b48cff', 2, 25);
      }
    }
    sound.playVortex();
  }

  private explosionFX(x: number, y: number, r: number, color?: string, fiery = false) {
    if (r >= 10) {
      this.particles.spawnExplosionFX(x, y, r, color, fiery);
      sound.playExplosion(r);
    } else {
      // Small impact: a little flash and a few embers
      this.particles.spawn(x, y, 0, 0, 'flash', color, 10, 8).sprite = 'star_06';
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2;
        this.particles.spawn(x, y, Math.cos(a) * 1.2, Math.sin(a) * 1.2 - 0.5, 'spark', color, 0.8, 14);
      }
      if (r >= 6) sound.playExplosion(r);
    }
    if (r >= 15) {
      const d = Math.hypot(x - this.camX, y - this.camY);
      const intensity = r * 0.25 * Math.max(0, 1 - d / 300);
      if (intensity > 0.5) {
        this.shakeTime = 8;
        this.shakeIntensity = intensity;
      }
    }
  }

  private broadcastState() {
    const r1 = (v: number) => Math.round(v * 10) / 10;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const worms: WormNetState[] = this.worms.map(w => ({
      id: w.id,
      x: r2(w.x),
      y: r2(w.y),
      vx: r2(w.vx),
      vy: r2(w.vy),
      hp: w.health,
      frags: w.frags,
      deaths: w.deaths,
      score: w.score,
      money: w.money,
      aim: r2(w.aimAngle),
      weapon: w.weapon.id,
      frozen: w.freezeTimer,
      shield: w.shieldTimer,
      burn: w.burnTimer,
      ...(w.sheepTimer > 0 ? { sh: w.sheepTimer } : {}),
      ...(w.bubbleTimer > 0 ? { bu: w.bubbleTimer } : {}),
      ...(w.drunkTimer > 0 ? { dr: w.drunkTimer } : {}),
      ...(w.channelTimer > 0 ? { ch: 1 as const } : {}),
      rope: w.rope.state,
      hx: r1(w.rope.hookX),
      hy: r1(w.rope.hookY),
      rl: r1(w.rope.length),
      ack: this.remoteInputs.get(w.id)?.ack ?? 0
    }));

    const projectiles: ProjectileNetState[] = this.projectiles.map(p => {
      const s: ProjectileNetState = { id: p.id, w: p.weapon.id, x: r1(p.x), y: r1(p.y), vx: r1(p.vx), vy: r1(p.vy) };
      if (p.isSubCluster) s.sub = 1;
      if (p.armed) s.armed = 1;
      if (p.weapon.decoy) s.o = p.ownerId;
      if (p.attachedTo) s.at = p.attachedTo;
      if (p.weapon.hotPotato) s.fu = p.fuse;
      return s;
    });

    this.net.broadcast({ type: 'STATE', worms, projectiles, events: this.pendingEvents, teamScores: this.teamScores,
      ...(this.wind !== 0 ? { wind: Math.round(this.wind * 1e4) / 1e4 } : {}) });
    this.pendingEvents = [];
  }

  // ════════════════════════════════════════════════════════════════════════
  // Client: applying the host state
  // ════════════════════════════════════════════════════════════════════════

  private flushStates() {
    if (this.pendingStates.length === 0) return;
    const states = this.pendingStates;
    this.pendingStates = [];
    for (const s of states) {
      for (const ev of s.events) this.applyEvent(ev);
    }
    this.applyWorldState(states[states.length - 1]);
  }

  private applyEvent(ev: NetEvent) {
    switch (ev.t) {
      case 'crater':
        this.crystalReward(ev.x, ev.y, this.terrain.carveCircle(ev.x, ev.y, ev.r, !!ev.f).crystals, '');
        break;
      case 'line':
        this.crystalReward(ev.x1, ev.y1, this.terrain.carveLine(ev.x0, ev.y0, ev.x1, ev.y1, ev.r, !!ev.f).crystals, '');
        break;
      case 'ice':
        this.terrain.freezeWater(ev.x, ev.y, ev.r);
        break;
      case 'boom':
        this.explosionFX(ev.x, ev.y, ev.r, ev.c, !!ev.f);
        break;
      case 'acid':
        this.terrain.addAcid(ev.x, ev.y, ev.r);
        break;
      case 'blood':
        this.bloodFX(ev.x, ev.y, ev.n, ev.dx ?? 0, ev.dy ?? 0);
        sound.playHurt();
        break;
      case 'shot': {
        if (ev.id === this.localId) break; // already played by our own prediction
        const w = this.worms.find(o => o.id === ev.id);
        if (w) this.castFX(w, WEAPON_REGISTRY[ev.w], w.aimAngle);
        break;
      }
      case 'fill':
        this.terrain.addDirt(ev.x, ev.y, ev.r, ev.keep);
        this.particles.spawnExplosionFX(ev.x, ev.y, 8, '#c08040');
        sound.playGrenadeBounce();
        break;
      case 'tp':
        this.teleportFX(ev.x0, ev.y0, ev.x1, ev.y1);
        break;
      case 'gas':
        this.gasClouds.push(new GasCloud(ev.x, ev.y, this.terrain, ev.o));
        sound.playGas();
        break;
      case 'portal':
        this.addPortal(ev.o, ev.x, ev.y);
        break;
      case 'zone':
        this.addZone(ev.x, ev.y);
        break;
      case 'lava':
        this.lavaLevel = ev.y;
        this.terrain.flood(ev.y, !!ev.w);
        break;
      case 'kill':
        this.onKill?.(ev.killer, ev.victim, ev.cause);
        break;
    }
  }

  private applyWorldState(msg: StateMessage) {
    this.teamScores = msg.teamScores;
    this.wind = msg.wind ?? 0;
    WORLD_ENV.wind = this.wind;
    const seen = new Set<string>();

    for (const ws of msg.worms) {
      seen.add(ws.id);
      let worm = this.worms.find(w => w.id === ws.id);
      if (!worm) {
        const info = this.players.find(p => p.id === ws.id);
        worm = this.createWorm(info ?? { id: ws.id, name: '?', color: '#ffffff', isHost: false });
        this.worms.push(worm);
      }

      const wasAlive = worm.isAlive();
      const isLocal = worm.id === this.localId;

      if (wasAlive && ws.hp <= 0) {
        this.addCorpse(worm);
        sound.playDie();
      }

      worm.frags = ws.frags;
      worm.deaths = ws.deaths;
      worm.score = ws.score;
      worm.money = ws.money;
      worm.health = ws.hp;
      worm.shieldTimer = ws.shield;
      worm.burnTimer = ws.burn;
      worm.sheepTimer = ws.sh ?? 0;
      worm.bubbleTimer = ws.bu ?? 0;
      worm.drunkTimer = ws.dr ?? 0;
      if (!isLocal) worm.channelTimer = ws.ch ? 6 : 0;

      if (ws.hp <= 0) {
        worm.rope.release();
        if (isLocal) {
          this.inputHistory = [];
          if (wasAlive && this.phase === 'playing') {
            worm.waitingForShop = true;
            this.onLocalDeath?.(worm);
          }
        }
        continue;
      }

      const respawned = !wasAlive;
      if (respawned || worm.weapon.id !== ws.weapon) {
        if (!isLocal || respawned) worm.setWeapon(ws.weapon);
        else if (this.mut('chaos')) worm.weapon = WEAPON_REGISTRY[ws.weapon] ?? worm.weapon; // random spells
      }
      if (respawned) worm.waitingForShop = false;

      if (isLocal && !respawned) {
        this.reconcileLocal(worm, ws);
      } else {
        worm.prevX = respawned ? ws.x : worm.x;
        worm.prevY = respawned ? ws.y : worm.y;
        worm.x = ws.x;
        worm.y = ws.y;
        worm.vx = ws.vx;
        worm.vy = ws.vy;
        worm.freezeTimer = ws.frozen;
        if (!isLocal) {
          worm.aimAngle = ws.aim;
          worm.facing = Math.cos(ws.aim) >= 0 ? 1 : -1;
        }
        worm.rope.state = ws.rope;
        worm.rope.hookX = ws.hx;
        worm.rope.hookY = ws.hy;
        worm.rope.length = ws.rl;
        worm.grounded = false;
      }
    }

    this.worms = this.worms.filter(w => seen.has(w.id));

    // Projectiles (keep the objects to interpolate their motion)
    const existing = new Map(this.projectiles.map(p => [p.id, p]));
    this.projectiles = msg.projectiles.map(ps => {
      let p = existing.get(ps.id);
      if (p) {
        p.prevX = p.x;
        p.prevY = p.y;
        if (p.weapon.hopper && ps.vy < -2 && p.vy > -0.5) this.hop(); // a frog jumped
      } else {
        p = new Projectile({
          id: ps.id, ownerId: '', weapon: WEAPON_REGISTRY[ps.w] ?? WEAPON_REGISTRY[DEFAULT_WEAPON],
          x: ps.x, y: ps.y, vx: ps.vx, vy: ps.vy, isSubCluster: !!ps.sub
        });
      }
      p.x = ps.x;
      p.y = ps.y;
      p.vx = ps.vx;
      p.vy = ps.vy;
      p.armed = !!ps.armed;
      p.attachedTo = ps.at ?? '';
      if (ps.o) p.ownerId = ps.o;
      if (ps.fu !== undefined) p.fuse = ps.fu;
      p.resting = ps.vx === 0 && ps.vy === 0;
      return p;
    });
  }

  /**
   * Client-side prediction: take the authoritative host state for our wizard and replay
   * the inputs the host has not processed yet. No more rubber-banding when moving.
   */
  private reconcileLocal(worm: Worm, ws: WormNetState) {
    const acked = this.inputHistory.find(h => h.seq === ws.ack);
    this.inputHistory = this.inputHistory.filter(h => h.seq > ws.ack);

    const keepPrevX = worm.prevX;
    const keepPrevY = worm.prevY;
    const predictedX = worm.x;
    const predictedY = worm.y;

    worm.x = ws.x;
    worm.y = ws.y;
    worm.vx = ws.vx;
    worm.vy = ws.vy;
    worm.freezeTimer = ws.frozen;
    worm.rope.state = ws.rope;
    worm.rope.hookX = ws.hx;
    worm.rope.hookY = ws.hy;
    worm.rope.length = ws.rl;
    if (acked) worm.setRopeHeld(acked.input.rope);

    for (const h of this.inputHistory) worm.update(h.input, this.terrain, null);

    // Small residual errors are smoothed instead of snapped
    const err = Math.hypot(worm.x - predictedX, worm.y - predictedY);
    if (err < 3) {
      worm.x = predictedX + (worm.x - predictedX) * 0.3;
      worm.y = predictedY + (worm.y - predictedY) * 0.3;
    }
    worm.prevX = keepPrevX;
    worm.prevY = keepPrevY;
  }

  // ════════════════════════════════════════════════════════════════════════
  // Camera & rendering
  // ════════════════════════════════════════════════════════════════════════

  public resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    // Show roughly the same slice of the world whatever the screen size
    this.camZoom = Math.max(this.canvas.width / 560, this.canvas.height / 350);
  }

  public screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.canvas.width / 2) / this.camZoom + this.camX,
      y: (screenY - this.canvas.height / 2) / this.camZoom + this.camY
    };
  }

  public worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: (worldX - this.camX) * this.camZoom + this.canvas.width / 2,
      y: (worldY - this.camY) * this.camZoom + this.canvas.height / 2
    };
  }

  private renderAlpha(now: number): number {
    return Math.max(0, Math.min(1, (now - this.lastTickTime) / CONFIG.TICK_MS));
  }

  private updateCamera(now: number, alpha: number) {
    const dt = Math.min(100, now - (this.lastRenderTime || now));
    this.lastRenderTime = now;
    const target = this.getLocalWorm();
    if (target && target.isAlive()) {
      const tx = target.prevX + (target.x - target.prevX) * alpha;
      const ty = target.prevY + (target.y - target.prevY) * alpha;
      if (!this.camFollowing) {
        this.camX = tx;
        this.camY = ty;
        this.camFollowing = true;
      } else {
        // Frame-rate independent smoothing
        const k = 1 - Math.exp(-dt / 90);
        this.camX += (tx - this.camX) * k;
        this.camY += (ty - this.camY) * k;
      }
    } else {
      this.camFollowing = false;
    }

    const halfW = this.canvas.width / (2 * this.camZoom);
    const halfH = this.canvas.height / (2 * this.camZoom);
    const W = this.terrain.width;
    const H = this.terrain.height;
    this.camX = halfW * 2 >= W ? W / 2 : Math.max(halfW, Math.min(W - halfW, this.camX));
    this.camY = halfH * 2 >= H ? H / 2 : Math.max(halfH, Math.min(H - halfH, this.camY));
  }

  public render(now: number) {
    if (!this.isInMatch()) return;
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const alpha = this.renderAlpha(now);
    this.updateCamera(now, alpha);

    let sx = 0;
    let sy = 0;
    if (this.shakeTime > 0) {
      sx = (Math.random() - 0.5) * this.shakeIntensity / 2;
      sy = (Math.random() - 0.5) * this.shakeIntensity / 2;
    }
    if (this.smoothActive && !this.smoothTerrain) {
      // GPU context lost (driver reset…): fall back to the pixel renderer
      for (const gl of [this.glSolid, this.glLiquid]) if (gl) gl.canvas.style.display = 'none';
      this.canvas.classList.remove('over-terrain');
      this.smoothActive = false;
    }
    const smooth = this.smoothActive;
    const view = { camX: this.camX - sx, camY: this.camY - sy, zoom: this.camZoom, time: this.frame };

    if (smooth) {
      // GPU layers below (terrain) and above (liquids); this canvas only holds the entities
      this.glSolid!.render(this.terrain, view, cw, ch);
      this.glLiquid!.render(this.terrain, view, cw, ch);
      ctx.clearRect(0, 0, cw, ch);
    } else {
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, cw, ch);
    }

    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(this.camZoom, this.camZoom);
    ctx.translate(-this.camX + sx, -this.camY + sy);

    if (!smooth) this.terrain.draw(ctx, this.frame);
    ctx.imageSmoothingEnabled = true; // painted sprites
    if (this.modifiers.gameMode === 'koth') this.drawKothZone(ctx);
    this.drawCorpses(ctx, now);
    this.drawZones(ctx, now);
    this.drawPortals(ctx, now);
    this.drawDecoys(ctx, alpha, now);
    const ghosts = this.mut('ghosts');
    const local = this.getLocalWorm();
    for (const w of this.worms) {
      const isLocal = w.id === this.localId;
      const hidden = ghosts && !isLocal && (this.modifiers.gameMode !== 'teams' || !local || this.teamOf(w.id) !== this.teamOf(local.id));
      w.draw(ctx, alpha, isLocal, this.terrain, now, hidden);
    }
    for (const c of this.gasClouds) c.draw(ctx, now);
    this.drawChannels(ctx, now);
    this.particles.draw(ctx);
    for (const p of this.projectiles) p.draw(ctx, alpha, now);
    if (!smooth) this.terrain.drawLiquids(ctx, this.frame);
    ctx.restore();

    this.drawOffScreenIndicators();
  }

  /** Portals: a swirling ring per portal, cyan for the 1st and orange for the 2nd of each caster */
  private drawPortals(ctx: CanvasRenderingContext2D, now: number) {
    if (this.portals.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const o of this.portals) {
      const mine = this.portals.filter(x => x.owner === o.owner);
      const first = mine[0] === o;
      const linked = mine.length === 2;
      const color = first ? '#4fd8ff' : '#ff9a3c';
      const fade = Math.min(1, (PORTAL_LIFE - o.age) / 90) * Math.min(1, o.age / 10);
      const pulse = 1 + Math.sin(now * 0.006 + o.x) * 0.06;
      drawFx(ctx, 'circle_05', o.x, o.y, 30 * pulse, color, 0.45 * fade);
      drawFx(ctx, 'twirl_01', o.x, o.y, 24 * pulse, color, (linked ? 1 : 0.5) * fade, now * (first ? 0.004 : -0.004));
      drawFx(ctx, 'circle_02', o.x, o.y, 20, '#ffffff', 0.7 * fade);
    }
    ctx.restore();
  }

  /** Gravity anomalies: a slowly turning violet circle */
  private drawZones(ctx: CanvasRenderingContext2D, now: number) {
    if (this.zones.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const z of this.zones) {
      const fade = Math.min(1, (ZONE_LIFE - z.age) / 60) * Math.min(1, z.age / 15);
      drawFx(ctx, 'circle_05', z.x, z.y, ZONE_RADIUS * 2.4, '#5b2fa0', 0.35 * fade);
      drawFx(ctx, 'magic_02', z.x, z.y, ZONE_RADIUS * 2.1, '#b07cff', 0.5 * fade, now * 0.0006);
      drawFx(ctx, 'circle_02', z.x, z.y, ZONE_RADIUS * 2.05, '#d9c2ff', 0.45 * fade);
    }
    ctx.restore();
  }

  /** Decoys look exactly like their caster: same robe, same name, same health bar */
  private drawDecoys(ctx: CanvasRenderingContext2D, alpha: number, now: number) {
    for (const p of this.projectiles) {
      if (!p.alive || !p.weapon.decoy) continue;
      const owner = this.worms.find(w => w.id === p.ownerId) ?? this.players.find(o => o.id === p.ownerId);
      const color = owner?.color ?? '#ffffff';
      const name = owner?.name ?? '?';
      const hp = owner instanceof Worm && owner.isAlive() ? owner.health / owner.maxHealth : 1;
      const x = p.prevX + (p.x - p.prevX) * alpha;
      const y = p.prevY + (p.y - p.prevY) * alpha;
      const f = p.vx >= 0 ? 1 : -1;
      const foot = y + WIZARD_FOOT;
      drawWizard(ctx, color, 'run', Math.floor(now / 70 + p.id) % 13, x, foot, f, WIZARD_HEIGHT);
      // Fake spell orb, health bar and name
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawFx(ctx, 'circle_05', x + f * 10, y - 5, 10, '#ffd76a', 0.9);
      ctx.restore();
      const barY = foot - WIZARD_HEIGHT - 5;
      ctx.fillStyle = 'rgba(15, 10, 8, 0.75)';
      ctx.fillRect(x - 10.75, barY - 0.75, 21.5, 3.5);
      ctx.fillStyle = hp > 0.5 ? '#2bd461' : hp > 0.25 ? '#ffaa22' : '#ee2b2b';
      ctx.fillRect(x - 10, barY, 20 * hp, 2);
      ctx.font = '600 5.5px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.strokeText(name, x, barY - 2);
      ctx.fillStyle = '#ffecb3';
      ctx.fillText(name, x, barY - 2);
    }
  }

  /** Mains Foudroyantes: arcs from every wizard who keeps the button held */
  private drawChannels(ctx: CanvasRenderingContext2D, now: number) {
    let crackling = false;
    for (const w of this.worms) {
      if (!w.isAlive() || w.channelTimer <= 0 || !w.weapon.channel) continue;
      drawLightning(ctx, computeLightning(w, this.worms, this.terrain, this.isEnemyOf(w)), now);
      crackling = true;
    }
    if (crackling && now - this.lastCrackle > 110) {
      this.lastCrackle = now;
      sound.playCrackle();
    }
  }

  private drawKothZone(ctx: CanvasRenderingContext2D) {
    const zx = this.terrain.width / 2;
    const zy = this.terrain.height / 2;
    const r = CONFIG.KOTH_ZONE_RADIUS;
    const pulse = 0.5 + 0.5 * Math.sin(this.frame * 0.05);
    ctx.save();
    ctx.strokeStyle = `rgba(255, 215, 0, ${0.5 + pulse * 0.5})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(zx, zy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(255, 215, 0, ${0.04 + pulse * 0.06})`;
    ctx.fill();
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('👑', zx, zy);
    ctx.restore();
  }

  /** Arrows on the screen edge pointing to wizards outside the view. */
  private drawOffScreenIndicators() {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const local = this.getLocalWorm();
    const margin = 30;
    const size = 12;

    for (const worm of this.worms) {
      if (!worm.isAlive() || worm === local) continue;
      const { x: sx, y: sy } = this.worldToScreen(worm.x, worm.y);
      const bodyR = worm.radius * this.camZoom + 4;
      if (sx >= bodyR && sx <= cw - bodyR && sy >= bodyR && sy <= ch - bodyR) continue;

      const angle = Math.atan2(sy - ch / 2, sx - cw / 2);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      let t = Infinity;
      if (Math.abs(cos) > 0.0001) t = Math.min(t, Math.abs((cw / 2 - margin) / cos));
      if (Math.abs(sin) > 0.0001) t = Math.min(t, Math.abs((ch / 2 - margin) / sin));
      const ex = cw / 2 + cos * t;
      const ey = ch / 2 + sin * t;

      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.6, -size * 0.55);
      ctx.lineTo(-size * 0.6, size * 0.55);
      ctx.closePath();
      ctx.fillStyle = worm.color;
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      const label = worm.name;
      const lx = Math.max(50, Math.min(cw - 50, ex - cos * (size + 14)));
      const ly = Math.max(14, Math.min(ch - 10, ey - sin * (size + 14)));
      ctx.save();
      ctx.font = '600 12px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(label, lx + 1, ly + 1);
      ctx.fillStyle = worm.color;
      ctx.fillText(label, lx, ly);
      ctx.restore();
    }
  }
}
