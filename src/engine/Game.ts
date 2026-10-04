import { CONFIG } from '../config';
import { Terrain } from './Terrain';
import { Worm, WormInput, EMPTY_INPUT, WormFx } from './Worm';
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
  LobbyPlayerInfo
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
  private zaps: { pts: number[]; life: number }[] = [];
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
  public onKill?: (killer: string | null, victim: string, cause?: 'acid' | 'self') => void;
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
  }

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
    this.terrain.generateMap(m.mapSeed, m.mapType, m.acidEnabled, m.gameMode === 'koth' ? CONFIG.KOTH_ZONE_RADIUS : 0);
    this.particles.clear();
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
    if (def && w.money >= def.price) {
      w.money -= def.price;
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
            (Math.random() - 0.5) * 0.4, -0.6, 'fire', undefined, 2.2, 16);
        }
      }
    }
    for (let i = this.zaps.length - 1; i >= 0; i--) {
      if (--this.zaps[i].life <= 0) this.zaps.splice(i, 1);
    }
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

    // 2. Acid burns (10×/s)
    if (++this.acidTick >= 6) {
      this.acidTick = 0;
      for (const w of this.worms) {
        if (!w.isAlive()) continue;
        const t = this.terrain;
        if (t.isAcid(w.x, w.y + 6) || t.isAcid(w.x - 3, w.y + 6) || t.isAcid(w.x + 3, w.y + 6) ||
            t.isAcid(w.x - 6, w.y) || t.isAcid(w.x + 6, w.y)) {
          w.takeDamage(3, 0, 0);
          this.particles.spawn(w.x + (Math.random() - 0.5) * 8, w.y + 4, (Math.random() - 0.5) * 0.5, -0.8, 'spark', '#44ff44', 1.5, 15);
          if (!w.isAlive()) this.onWormKilled(w, 'acid');
        }
      }
    }

    // 3. Projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.update(this);
      if (!p.alive) this.projectiles.splice(i, 1);
    }

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
    if (weapon.shieldDuration) {
      worm.shieldTimer = weapon.shieldDuration;
      this.castFX(worm, weapon, angle);
      this.emit({ t: 'shot', id: worm.id, w: weapon.id });
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
  }

  /** Casting sound + staff sparkle */
  private castFX(worm: Worm, weapon: WeaponDef, angle: number) {
    sound.playSpellForWeapon(weapon.id);
    this.particles.spawn(worm.x + Math.cos(angle) * 12, worm.y + Math.sin(angle) * 12,
      Math.cos(angle) * 2, Math.sin(angle) * 2, 'spark', weapon.elementColor, 2.5, 12);
  }

  // ── ProjectileWorld implementation (host) ────────────────────────────────

  public explode(p: Projectile, directHit: Worm | null) {
    const mods = this.modifiers;
    const weapon = p.weapon;
    const x = p.x;
    const y = p.y;
    const q = Math.round;

    // Rempart: builds terrain instead of blasting it
    if (weapon.buildRadius) {
      const keep = this.worms.filter(w => w.isAlive()).flatMap(w => [q(w.x), q(w.y)]);
      this.terrain.addDirt(x, y, weapon.buildRadius, keep);
      this.emit({ t: 'fill', x: q(x), y: q(y), r: weapon.buildRadius, keep });
      this.particles.spawnExplosionFX(x, y, 8, '#c08040');
      sound.playGrenadeBounce();
      return;
    }

    const r = weapon.craterRadius * mods.explosionScale;
    if (this.terrain.carveCircle(x, y, r)) {
      this.emit({ t: 'crater', x: q(x), y: q(y), r: Math.round(r * 10) / 10 });
    }

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

    this.explosionFX(x, y, r, weapon.elementColor);
    this.emit({ t: 'boom', x: q(x), y: q(y), r: q(r), c: weapon.elementColor });

    // Damage: full damage on a direct hit, splash with falloff around
    const blast = Math.max(r * 1.5, 6);
    const knockScale = Math.min(5, 0.5 + weapon.damage / 12);
    for (const w of this.worms) {
      if (!w.isAlive() || w.id === p.reflectedBy) continue;
      const dx = w.x - x;
      const dy = w.y - y;
      const dist = Math.hypot(dx, dy);
      let falloff: number;
      if (w === directHit) {
        falloff = 1;
      } else {
        falloff = 1 - Math.max(0, dist - w.radius) / blast;
        if (falloff <= 0) continue;
      }
      let kx: number;
      let ky: number;
      if (dist > 0.5) {
        kx = dx / dist;
        ky = dy / dist;
      } else {
        const sp = Math.hypot(p.vx, p.vy) || 1;
        kx = p.vx / sp;
        ky = p.vy / sp;
      }
      const dealt = this.damageWorm(w, Math.round(weapon.damage * falloff), kx * knockScale * falloff, ky * knockScale * falloff, p.ownerId);
      this.applyHitEffects(p, w, dealt);
    }

    // Arc Foudroyant: the bolt jumps from wizard to wizard
    if (weapon.chainTargets) {
      const hit = new Set<Worm>();
      let current = directHit ?? this.nearestEnemy(x, y, 50, p.ownerId, hit);
      const pts = [q(x), q(y)];
      if (current && current !== directHit) {
        this.applyHitEffects(p, current, this.damageWorm(current, weapon.damage, 0, -1, p.ownerId));
      }
      let dmg = weapon.damage;
      for (let i = 0; current && i <= weapon.chainTargets; i++) {
        hit.add(current);
        pts.push(q(current.x), q(current.y));
        if (i === weapon.chainTargets) break;
        const next = this.nearestEnemy(current.x, current.y, 100, p.ownerId, hit);
        if (!next) break;
        dmg = Math.round(dmg * 0.75);
        this.damageWorm(next, dmg, (next.x - current.x) * 0.02, -1, p.ownerId);
        current = next;
      }
      if (pts.length > 2) {
        this.addZap(pts);
        this.emit({ t: 'zap', pts });
      }
    }

    if (weapon.freezeDuration) {
      for (const w of this.worms) {
        if (w.isAlive() && w.id !== p.ownerId && Math.hypot(w.x - x, w.y - y) <= r * 2.5) {
          w.freeze(weapon.freezeDuration);
        }
      }
    }

    if (weapon.acidPool && mods.acidEnabled) {
      const ar = q(r + 5);
      this.terrain.addAcid(x, y, ar);
      this.emit({ t: 'acid', x: q(x), y: q(y), r: ar });
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

  private nearestEnemy(x: number, y: number, range: number, ownerId: string, exclude: Set<Worm>): Worm | null {
    let best: Worm | null = null;
    let bestDist = range;
    const teams = this.modifiers.gameMode === 'teams';
    for (const w of this.worms) {
      if (!w.isAlive() || w.id === ownerId || exclude.has(w)) continue;
      if (teams && this.teamOf(w.id) === this.teamOf(ownerId)) continue;
      const d = Math.hypot(w.x - x, w.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = w;
      }
    }
    return best;
  }

  private spawnProjectile(ownerId: string, weapon: WeaponDef, x: number, y: number, vx: number, vy: number, isSubCluster = false) {
    this.projectiles.push(new Projectile({ id: this.nextProjectileId++, ownerId, weapon, x, y, vx, vy, isSubCluster }));
  }

  public pierce(p: Projectile, x0: number, y0: number, x1: number, y1: number) {
    const r = p.weapon.craterRadius * this.modifiers.explosionScale;
    if (this.terrain.carveLine(x0, y0, x1, y1, r)) {
      const q = (v: number) => Math.round(v);
      this.emit({ t: 'line', x0: q(x0), y0: q(y0), x1: q(x1), y1: q(y1), r: Math.round(r * 10) / 10 });
    }
  }

  public bounce() {
    sound.playGrenadeBounce();
  }

  public reflect() {
    sound.playBouncy();
  }

  /** Applies match rules (self damage, friendly fire, scale) and returns the damage dealt. */
  private damageWorm(w: Worm, damage: number, kx: number, ky: number, attackerId: string, quiet = false): number {
    const mods = this.modifiers;
    const self = attackerId === w.id;
    let dmg = damage;
    if (self && mods.noSelfDamage) dmg = 0;
    if (!self && mods.gameMode === 'teams' && this.teamOf(attackerId) === this.teamOf(w.id)) dmg = 0;
    dmg = Math.round(dmg * mods.damageScale);

    w.takeDamage(dmg, kx, ky);
    if (dmg > 0 && !quiet) {
      const n = Math.max(3, Math.min(25, Math.round(dmg / 2)));
      this.particles.spawnBloodBurst(w.x, w.y, n);
      this.emit({ t: 'blood', x: Math.round(w.x), y: Math.round(w.y), n });
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
    this.particles.spawnGibs(victim.x, victim.y);
    sound.playDie();

    const killer = this.worms.find(k => k.id === attackerId);
    let cause: 'acid' | 'self' | undefined;
    if (attackerId === 'acid') cause = 'acid';
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

  private addZap(pts: number[]) {
    this.zaps.push({ pts, life: 14 });
    sound.playRailgun();
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

  private explosionFX(x: number, y: number, r: number, color?: string) {
    if (r >= 10) {
      this.particles.spawnExplosionFX(x, y, r, color);
      sound.playExplosion(r);
    } else {
      this.particles.spawn(x, y, 0, 0, 'spark', color, 2, 20);
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
      return s;
    });

    this.net.broadcast({ type: 'STATE', worms, projectiles, events: this.pendingEvents, teamScores: this.teamScores });
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
        this.terrain.carveCircle(ev.x, ev.y, ev.r);
        break;
      case 'line':
        this.terrain.carveLine(ev.x0, ev.y0, ev.x1, ev.y1, ev.r);
        break;
      case 'boom':
        this.explosionFX(ev.x, ev.y, ev.r, ev.c);
        break;
      case 'acid':
        this.terrain.addAcid(ev.x, ev.y, ev.r);
        break;
      case 'blood':
        this.particles.spawnBloodBurst(ev.x, ev.y, ev.n);
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
      case 'zap':
        this.addZap(ev.pts);
        break;
      case 'kill':
        this.onKill?.(ev.killer, ev.victim, ev.cause);
        break;
    }
  }

  private applyWorldState(msg: StateMessage) {
    this.teamScores = msg.teamScores;
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
        this.particles.spawnGibs(worm.x, worm.y);
        sound.playDie();
      }

      worm.frags = ws.frags;
      worm.deaths = ws.deaths;
      worm.score = ws.score;
      worm.money = ws.money;
      worm.health = ws.hp;
      worm.shieldTimer = ws.shield;
      worm.burnTimer = ws.burn;

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

    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(this.camZoom, this.camZoom);
    ctx.translate(-this.camX, -this.camY);
    if (this.shakeTime > 0) {
      ctx.translate((Math.random() - 0.5) * this.shakeIntensity / 2, (Math.random() - 0.5) * this.shakeIntensity / 2);
    }

    this.terrain.draw(ctx, this.frame);
    if (this.modifiers.gameMode === 'koth') this.drawKothZone(ctx);
    this.particles.draw(ctx);
    for (const p of this.projectiles) p.draw(ctx, alpha);
    this.drawZaps(ctx);
    for (const w of this.worms) w.draw(ctx, alpha, w.id === this.localId);

    ctx.restore();
    this.drawOffScreenIndicators();
  }

  /** Jagged lightning arcs of the Arc Foudroyant */
  private drawZaps(ctx: CanvasRenderingContext2D) {
    if (this.zaps.length === 0) return;
    ctx.save();
    ctx.shadowColor = '#9fe8ff';
    ctx.shadowBlur = 10;
    ctx.lineJoin = 'round';
    for (const z of this.zaps) {
      ctx.globalAlpha = Math.min(1, z.life / 8);
      for (const [width, color] of [[2.4, '#6fd6ff'], [1, '#ffffff']] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(z.pts[0], z.pts[1]);
        for (let i = 2; i + 1 < z.pts.length; i += 2) {
          const x0 = z.pts[i - 2], y0 = z.pts[i - 1], x1 = z.pts[i], y1 = z.pts[i + 1];
          for (let k = 1; k <= 4; k++) {
            const t = k / 5;
            ctx.lineTo(x0 + (x1 - x0) * t + (Math.random() - 0.5) * 6, y0 + (y1 - y0) * t + (Math.random() - 0.5) * 6);
          }
          ctx.lineTo(x1, y1);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
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
