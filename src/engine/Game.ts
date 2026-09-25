import { CONFIG } from '../config';
import { Terrain } from './Terrain';
import { Worm, WormInput } from './Worm';
import { Projectile } from './Projectile';
import { ParticleManager } from './Particles';
import { WeaponDef, WeaponId } from '../weapons/WeaponDef';
import { WEAPON_REGISTRY, DEFAULT_LOADOUT } from '../weapons/WeaponRegistry';
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
import { sound } from './SoundEffects';
import RAPIER from '@dimforge/rapier2d-compat';
import { RapierWorld, DynamicEntityAABB } from '../physics/RapierWorld';
import { Ragdoll } from './Ragdoll';

export type GameMode = 'online_host' | 'online_client';

export class Game {
  public canvas: HTMLCanvasElement;
  public ctx: CanvasRenderingContext2D;
  public terrain: Terrain;
  public particles: ParticleManager;
  public worms: Worm[] = [];
  public projectiles: Projectile[] = [];
  public nextProjectileId: number = 1;

  // Rapier WASM Physics & Ragdolls
  public rapierWorld?: RapierWorld;
  public rapierInstance?: typeof RAPIER;
  public ragdolls: Ragdoll[] = [];

  public mode: GameMode = 'online_host';
  public net: NetworkManager;
  public mapSeed: number = 123456;
  public fragLimit: number = CONFIG.DEFAULT_FRAG_LIMIT;
  public modifiers: MatchModifiers = { ...DEFAULT_MODIFIERS };
  public matchWinner: Worm | null = null;
  public isRunning: boolean = false;

  // Lobby tracking for up to 8 players
  public lobbyPlayers: Map<string, LobbyPlayerInfo> = new Map();

  // Screen shake
  public shakeDuration: number = 0;
  public shakeIntensity: number = 0;

  // KOTH scores [team0/p0, team1/p1, ...]
  public kothScores: number[] = [0, 0];
  public kothZoneHolder: number = -1; // -1 = contested, 0..1 = team index, or worm index in FFA
  private renderFrameTime: number = 0; // for acid animation
  private acidTickAccum: number = 0;   // for periodic acid damage

  // Smooth camera following local player
  public camX: number = 0;
  public camY: number = 0;
  public readonly camZoom: number = 3.5; // zoom multiplier

  // Local inputs
  public localP1Input: WormInput = { left: false, right: false, up: false, down: false, jump: false, fire: false, rope: false };
  public remoteInputs: Map<string, WormInput> = new Map();

  // Network event queue (for Host to send to clients)
  private pendingNetEvents: NetEvent[] = [];
  private netSeq: number = 0;

  // Callbacks for UI updates
  public onMatchEnd?: (winner: Worm) => void;
  public onKillFeed?: (killer: string, victim: string) => void;
  public onWelcomeReceived?: () => void;
  public onLobbyUpdate?: (players: LobbyPlayerInfo[], modifiers: MatchModifiers) => void;
  public onStartMatchReceived?: (modifiers: MatchModifiers) => void;

  constructor(canvas: HTMLCanvasElement, net: NetworkManager) {
    this.canvas = canvas;
    // Canvas fills the screen; the camera transform handles world-space rendering
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    this.ctx = canvas.getContext('2d')!;

    // Initialize camera to center of map
    this.camX = CONFIG.MAP_WIDTH / 2;
    this.camY = CONFIG.MAP_HEIGHT / 2;

    this.terrain = new Terrain();
    this.terrain.onCarve = (cx, cy, r) => {
      // Invalider les parois détruites dans le monde Rapier et propulser les corps proches
      if (this.rapierWorld) {
        this.rapierWorld.invalidateCrater(cx, cy, r);
        this.rapierWorld.applyExplosionImpulse(cx, cy, r * 1.5, 3.2);
      }

      if (this.mode === 'online_host') {
        this.pendingNetEvents.push({
          type: 'crater',
          x: Math.round(cx),
          y: Math.round(cy),
          r: Math.round(r)
        });
      }
    };
    this.particles = new ParticleManager();
    this.net = net;

    this.setupNetworkCallbacks();
  }
  public resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  /**
   * Convert screen pixel coordinates (e.g. mouse) to world coordinates,
   * accounting for the current camera transform (zoom + pan).
   */
  public screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const w = this.canvas.width;
    const h = this.canvas.height;
    return {
      x: (screenX - w / 2) / this.camZoom + this.camX,
      y: (screenY - h / 2) / this.camZoom + this.camY
    };
  }

  /** Smooth-follow the local player. Call once per render frame (not physics tick). */
  public updateCamera(alpha: number = 0.10) {
    const target = this.getLocalWorm();
    if (!target || !target.isAlive()) return;
    this.camX += (target.x - this.camX) * alpha;
    this.camY += (target.y - this.camY) * alpha;
    // Clamp so the camera never shows outside the map
    const halfW = this.canvas.width / (2 * this.camZoom);
    const halfH = this.canvas.height / (2 * this.camZoom);
    this.camX = Math.max(halfW, Math.min(CONFIG.MAP_WIDTH - halfW, this.camX));
    this.camY = Math.max(halfH, Math.min(CONFIG.MAP_HEIGHT - halfH, this.camY));
  }

  /** Convert world coordinates to screen pixel position. */
  public worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    return {
      x: (worldX - this.camX) * this.camZoom + cw / 2,
      y: (worldY - this.camY) * this.camZoom + ch / 2
    };
  }

  /**
   * Draw off-screen indicators (arrows on screen edge) for every remote worm
   * that is alive but not currently visible inside the camera viewport.
   * Called AFTER ctx.restore() so it draws in pure screen space.
   */
  private drawOffScreenIndicators() {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const localWorm = this.getLocalWorm();
    const margin = 30; // distance from screen edge
    const arrowSize = 14;

    for (const worm of this.worms) {
      if (!worm.isAlive()) continue;
      if (worm === localWorm) continue;

      const { x: sx, y: sy } = this.worldToScreen(worm.x, worm.y);

      // Is the worm already visible on screen? (with a generous worm-body margin)
      const bodyR = worm.radius * this.camZoom + 4;
      if (sx >= bodyR && sx <= cw - bodyR && sy >= bodyR && sy <= ch - bodyR) continue;

      // Direction from screen center to the off-screen worm
      const dx = sx - cw / 2;
      const dy = sy - ch / 2;
      const angle = Math.atan2(dy, dx);

      // Find clamped position on screen edge
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      // Intersect ray from center with screen rectangle (shrunk by margin)
      const hw = cw / 2 - margin;
      const hh = ch / 2 - margin;
      let t = Infinity;
      if (Math.abs(cos) > 0.0001) t = Math.min(t, Math.abs(hw / cos));
      if (Math.abs(sin) > 0.0001) t = Math.min(t, Math.abs(hh / sin));
      const edgeX = cw / 2 + cos * t;
      const edgeY = ch / 2 + sin * t;

      // Distance in world units (for display)
      const worldDist = Math.round(Math.hypot(worm.x - (localWorm?.x ?? this.camX), worm.y - (localWorm?.y ?? this.camY)));

      ctx.save();
      ctx.translate(edgeX, edgeY);
      ctx.rotate(angle);

      // Arrow body (filled triangle pointing toward worm)
      ctx.beginPath();
      ctx.moveTo(arrowSize, 0);
      ctx.lineTo(-arrowSize * 0.6, -arrowSize * 0.55);
      ctx.lineTo(-arrowSize * 0.6, arrowSize * 0.55);
      ctx.closePath();
      ctx.fillStyle = worm.color;
      ctx.globalAlpha = 0.92;
      ctx.fill();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Colored dot (pulse)
      ctx.globalAlpha = 1.0;
      ctx.beginPath();
      ctx.arc(-arrowSize * 0.6, 0, 4, 0, Math.PI * 2);
      ctx.fillStyle = worm.color;
      ctx.fill();

      ctx.restore();

      // Player name + distance label next to the arrow
      ctx.save();
      const labelOffset = arrowSize + 6;
      const lx = edgeX + Math.cos(angle) * labelOffset;
      const ly = edgeY + Math.sin(angle) * labelOffset;

      // Keep label inside screen
      const clampedLx = Math.max(60, Math.min(cw - 60, lx));
      const clampedLy = Math.max(16, Math.min(ch - 8, ly));

      ctx.font = 'bold 11px VT323, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Shadow
      ctx.fillStyle = '#000000';
      ctx.globalAlpha = 0.7;
      ctx.fillText(`${worm.name}  ${worldDist}px`, clampedLx + 1, clampedLy + 1);

      // Text
      ctx.fillStyle = worm.color;
      ctx.globalAlpha = 1.0;
      ctx.fillText(`${worm.name}  ${worldDist}px`, clampedLx, clampedLy);

      ctx.restore();
    }
  }

  public getLocalWorm(): Worm | undefined {
    if (this.mode === 'online_client') {
      return this.worms.find(w => w.id === this.net.myPeerId) || this.worms[0];
    }
    return this.worms.find(w => w.id === this.net.myPeerId) || this.worms[0];
  }

  public getLobbyPlayers(): LobbyPlayerInfo[] {
    return Array.from(this.lobbyPlayers.values());
  }

  public initRapierPhysicsWorld(rapier: typeof RAPIER) {
    this.rapierInstance = rapier;
    if (this.rapierWorld) {
      for (const ragdoll of this.ragdolls) {
        ragdoll.destroy(this.rapierWorld.world);
      }
      this.rapierWorld.destroy();
    }
    this.ragdolls = [];
    this.rapierWorld = new RapierWorld(rapier, this.modifiers.gravity);

    for (const worm of this.worms) {
      worm.initRapier(this.rapierWorld);
      this.setupWormRagdoll(worm);
    }
  }

  public setupWormRagdoll(worm: Worm) {
    worm.onDeathRagdoll = (w, kx, ky) => {
      if (!this.rapierWorld || !this.rapierInstance) return;
      const ragdoll = new Ragdoll(
        this.rapierInstance,
        this.rapierWorld.world,
        w.x,
        w.y,
        w.vx + kx,
        w.vy + ky,
        w.color
      );
      this.ragdolls.push(ragdoll);
    };
  }

  public setModifiers(newMods: Partial<MatchModifiers>) {
    this.modifiers = { ...this.modifiers, ...newMods };
    this.fragLimit = this.modifiers.fragLimit;
    if (this.rapierWorld && newMods.gravity !== undefined) {
      this.rapierWorld.setGravity(this.modifiers.gravity);
    }
    for (const w of this.worms) {
      w.applyModifiers(this.modifiers);
    }
    if (this.mode === 'online_host') {
      this.broadcastLobbyUpdate();
    }
  }

  public broadcastLobbyUpdate() {
    if (this.mode !== 'online_host') return;
    const players = this.getLobbyPlayers();
    this.net.broadcast({
      type: 'LOBBY_UPDATE',
      players,
      modifiers: this.modifiers
    });
    this.onLobbyUpdate?.(players, this.modifiers);
  }

  private setupNetworkCallbacks() {
    this.net.onMessageReceived = (msg: NetMessage, fromId: string) => {
      if (this.mode === 'online_host') {
        if (msg.type === 'INPUT') {
          // Auto-register if not yet in worms
          if (!this.worms.some(w => w.id === fromId) && this.worms.length < CONFIG.MAX_PLAYERS) {
            this.addNetworkPlayer(fromId, 'Invité', DEFAULT_LOADOUT);
          }
          this.remoteInputs.set(fromId, msg.input);
        } else if (msg.type === 'JOIN') {
          if (this.lobbyPlayers.size < CONFIG.MAX_PLAYERS) {
            const playerIndex = this.lobbyPlayers.size;
            const color = CONFIG.PLAYER_COLORS[playerIndex % CONFIG.PLAYER_COLORS.length];
            this.lobbyPlayers.set(fromId, {
              id: fromId,
              name: msg.name || `Invité ${playerIndex + 1}`,
              color,
              isHost: false,
              loadout: msg.loadout || DEFAULT_LOADOUT
            });
            this.addNetworkPlayer(fromId, msg.name, msg.loadout);
          }

          this.net.sendTo(fromId, {
            type: 'WELCOME',
            playerId: fromId,
            mapSeed: this.mapSeed,
            mapWidth: CONFIG.MAP_WIDTH,
            mapHeight: CONFIG.MAP_HEIGHT,
            modifiers: this.modifiers,
            players: this.getLobbyPlayers()
          });

          this.broadcastLobbyUpdate();
        } else if (msg.type === 'SET_MODIFIERS') {
          this.setModifiers(msg.modifiers);
        }
      } else if (this.mode === 'online_client') {
        if (msg.type === 'WELCOME') {
          this.modifiers = msg.modifiers;
          this.fragLimit = msg.modifiers.fragLimit;
          if (this.mapSeed !== msg.mapSeed) {
            this.mapSeed = msg.mapSeed;
            this.terrain.generateMap(msg.mapSeed, msg.modifiers.mapType || 'cave', msg.modifiers.acidEnabled !== false);
          }
          this.onWelcomeReceived?.();
          this.onLobbyUpdate?.(msg.players, msg.modifiers);
        } else if (msg.type === 'LOBBY_UPDATE') {
          this.modifiers = msg.modifiers;
          this.fragLimit = msg.modifiers.fragLimit;
          this.onLobbyUpdate?.(msg.players, msg.modifiers);
        } else if (msg.type === 'START_MATCH') {
          this.mapSeed = msg.mapSeed;
          this.terrain.generateMap(msg.mapSeed, msg.modifiers.mapType || 'cave', msg.modifiers.acidEnabled !== false);
          this.modifiers = msg.modifiers;
          this.fragLimit = msg.modifiers.fragLimit;
          this.kothScores = [0, 0];
          this.kothZoneHolder = -1;
          this.particles.clear();
          this.projectiles = [];
          this.worms = [];

          for (const p of msg.players) {
            const w = new Worm(p.id, p.name, p.color, false, p.loadout);
            w.applyModifiers(this.modifiers);
            const spawn = this.terrain.findSpawnPoint();
            w.spawn(spawn.x, spawn.y);
            this.worms.push(w);
          }

          if (this.rapierInstance) {
            this.initRapierPhysicsWorld(this.rapierInstance);
          }

          this.isRunning = true;
          this.onStartMatchReceived?.(msg.modifiers);
        } else if (msg.type === 'STATE') {
          this.applyWorldState(msg);
        } else if (msg.type === 'MATCH_OVER') {
          const winner = this.worms.find(w => w.id === msg.winnerId);
          if (winner) {
            this.matchWinner = winner;
            this.onMatchEnd?.(winner);
          }
        }
      }
    };

    this.net.onPeerLeft = (peerId) => {
      if (this.mode === 'online_host') {
        this.lobbyPlayers.delete(peerId);
        this.worms = this.worms.filter(w => w.id !== peerId);
        this.broadcastLobbyUpdate();
      }
    };
  }

  public initMatch(
    mode: GameMode,
    myLoadout: WeaponId[] = DEFAULT_LOADOUT,
    myName: string = 'Hôte',
    modifiers: MatchModifiers = DEFAULT_MODIFIERS
  ) {
    this.mode = mode;
    this.modifiers = { ...modifiers };
    this.fragLimit = this.modifiers.fragLimit;
    this.matchWinner = null;
    this.particles.clear();
    this.projectiles = [];
    this.worms = [];
    this.remoteInputs.clear();
    this.pendingNetEvents = [];

    if (mode === 'online_host') {
      this.mapSeed = Math.floor(Math.random() * 1000000);
      this.terrain.generateMap(this.mapSeed, this.modifiers.mapType || 'cave', this.modifiers.acidEnabled !== false);
      this.kothScores = [0, 0];
      this.kothZoneHolder = -1;

      // Register host in lobby
      this.lobbyPlayers.clear();
      const hostColor = CONFIG.PLAYER_COLORS[0];
      const hostInfo: LobbyPlayerInfo = {
        id: this.net.myPeerId,
        name: myName || 'Hôte',
        color: hostColor,
        isHost: true,
        loadout: myLoadout
      };
      this.lobbyPlayers.set(this.net.myPeerId, hostInfo);

      const hostWorm = new Worm(this.net.myPeerId, hostInfo.name, hostColor, false, myLoadout);
      hostWorm.applyModifiers(this.modifiers);
      const spawn = this.terrain.findSpawnPoint();
      hostWorm.spawn(spawn.x, spawn.y);
      this.worms.push(hostWorm);
    } else if (mode === 'online_client') {
      this.terrain.generateMap(this.mapSeed, this.modifiers.mapType || 'cave', this.modifiers.acidEnabled !== false);
      this.kothScores = [0, 0];
      this.kothZoneHolder = -1;
      const clientColor = CONFIG.PLAYER_COLORS[1];
      const clientWorm = new Worm(this.net.myPeerId, myName || 'Moi', clientColor, false, myLoadout);
      clientWorm.applyModifiers(this.modifiers);
      const spawn = this.terrain.findSpawnPoint();
      clientWorm.spawn(spawn.x, spawn.y);
      this.worms.push(clientWorm);
    }

    if (this.rapierInstance) {
      this.initRapierPhysicsWorld(this.rapierInstance);
    }

    this.isRunning = false; // Waiting for Host to click Start Match in lobby
  }

  public startHostMatch() {
    if (this.mode !== 'online_host') return;

    this.mapSeed = Math.floor(Math.random() * 1000000);
    this.terrain.generateMap(this.mapSeed, this.modifiers.mapType || 'cave', this.modifiers.acidEnabled !== false);
    this.particles.clear();
    this.projectiles = [];
    this.worms = [];
    this.kothScores = [0, 0];
    this.kothZoneHolder = -1;

    const players = this.getLobbyPlayers();
    for (const p of players) {
      const w = new Worm(p.id, p.name, p.color, false, p.loadout);
      w.applyModifiers(this.modifiers);
      const spawn = this.terrain.findSpawnPoint();
      w.spawn(spawn.x, spawn.y);
      this.worms.push(w);
    }

    if (this.rapierInstance) {
      this.initRapierPhysicsWorld(this.rapierInstance);
    }

    this.isRunning = true;
    this.net.broadcast({
      type: 'START_MATCH',
      mapSeed: this.mapSeed,
      modifiers: this.modifiers,
      players
    });
  }

  public addNetworkPlayer(peerId: string, name: string, loadout: WeaponId[]) {
    if (this.worms.length >= CONFIG.MAX_PLAYERS) return;
    let worm = this.worms.find(w => w.id === peerId);
    if (!worm) {
      const playerIndex = this.worms.length;
      const color = CONFIG.PLAYER_COLORS[playerIndex % CONFIG.PLAYER_COLORS.length];
      worm = new Worm(peerId, name || `Invité ${playerIndex + 1}`, color, false, loadout);
      worm.applyModifiers(this.modifiers);
      const spawn = this.terrain.findSpawnPoint();
      worm.spawn(spawn.x, spawn.y);
      this.worms.push(worm);

      if (this.rapierWorld) {
        worm.initRapier(this.rapierWorld);
        this.setupWormRagdoll(worm);
      }
    }
  }

  public triggerScreenShake(duration: number = 10, intensity: number = 4) {
    this.shakeDuration = duration;
    this.shakeIntensity = intensity;
  }

  public spawnProjectiles(worm: Worm, weapon: WeaponDef, angle: number) {
    const muzzleDist = 9;
    const originX = worm.x + Math.cos(angle) * muzzleDist;
    const originY = worm.y + Math.sin(angle) * muzzleDist;

    if (weapon.pelletCount && weapon.pelletCount > 1) {
      // Shotgun / Dart Gun burst
      for (let i = 0; i < weapon.pelletCount; i++) {
        const spreadAngle = angle + (Math.random() - 0.5) * weapon.spread;
        const speed = weapon.projectileSpeed * (0.9 + Math.random() * 0.2);
        const proj = new Projectile({
          id: this.nextProjectileId++,
          ownerId: worm.id,
          weapon,
          x: originX,
          y: originY,
          vx: Math.cos(spreadAngle) * speed,
          vy: Math.sin(spreadAngle) * speed
        });
        this.projectiles.push(proj);
      }
    } else {
      // Single projectile
      const spreadAngle = angle + (Math.random() - 0.5) * weapon.spread;
      const proj = new Projectile({
        id: this.nextProjectileId++,
        ownerId: worm.id,
        weapon,
        x: originX,
        y: originY,
        vx: Math.cos(spreadAngle) * weapon.projectileSpeed,
        vy: Math.sin(spreadAngle) * weapon.projectileSpeed
      });
      this.projectiles.push(proj);
    }
  }

  private handleProjectileDetonation(proj: Projectile) {
    // Apply explosion scale modifier to shake intensity
    const expScale = this.modifiers.explosionScale ?? 1.0;
    if (proj.weapon.craterRadius >= 15) {
      this.triggerScreenShake(8, proj.weapon.craterRadius * 0.25 * expScale);
    }

    // Cluster bomb explosion splits into sub-clusters!
    if (proj.weapon.splitCount && !proj.isSubCluster) {
      for (let i = 0; i < proj.weapon.splitCount; i++) {
        const subAngle = (Math.PI * 2 * i) / proj.weapon.splitCount + (Math.random() - 0.5) * 0.4;
        const subSpeed = 2.5 + Math.random() * 3.5;
        const subProj = new Projectile({
          id: this.nextProjectileId++,
          ownerId: proj.ownerId,
          weapon: {
            ...proj.weapon,
            damage: 20,
            craterRadius: 12,
            bounces: 2,
            fuseFrames: 30 + Math.floor(Math.random() * 25)
          },
          x: proj.x,
          y: proj.y - 2,
          vx: Math.cos(subAngle) * subSpeed,
          vy: Math.sin(subAngle) * subSpeed - 1.5,
          isSubCluster: true
        });
        this.projectiles.push(subProj);
      }
    }
  }

  public update() {
    if (!this.isRunning) return;

    // Shake decay
    if (this.shakeDuration > 0) {
      this.shakeDuration--;
    }
    this.renderFrameTime++;

    if (this.mode === 'online_client') {
      // 1. Broadcast local inputs to host at 60Hz
      this.net.broadcast({
        type: 'INPUT',
        seq: this.netSeq++,
        input: this.localP1Input
      });

      // Synchroniser les parois locales avec le ver client et les ragdolls
      if (this.rapierWorld) {
        const activeAABBs: DynamicEntityAABB[] = [];
        const localWorm = this.getLocalWorm();
        if (localWorm && localWorm.isAlive()) {
          activeAABBs.push(localWorm.getAABB());
          activeAABBs.push(...localWorm.rope.getAABBs());
        }
        for (const ragdoll of this.ragdolls) {
          activeAABBs.push(...ragdoll.getAABBs());
        }
        this.rapierWorld.syncTerrainColliders(this.terrain, activeAABBs);
      }

      // 2. Client-side local prediction: simulate local worm physics
      const localWorm = this.getLocalWorm();
      if (localWorm) {
        localWorm.update(
          this.localP1Input,
          this.terrain,
          this.particles,
          () => {}
        );
      }

      if (this.rapierWorld) {
        this.rapierWorld.step();
        if (localWorm) {
          localWorm.syncFromRapier(this.terrain);
        }
        this.ragdolls = this.ragdolls.filter(r => {
          const alive = r.update(this.particles);
          if (!alive && this.rapierWorld) {
            r.destroy(this.rapierWorld.world);
          }
          return alive;
        });
      }

      // 3. Update local particles
      this.particles.update(this.terrain);
      return;
    }

    // --- Host Authoritative Simulation ---
    const mods = this.modifiers;

    // Synchronisation des parois locales dans Rapier
    if (this.rapierWorld) {
      const activeAABBs: DynamicEntityAABB[] = [];
      for (const worm of this.worms) {
        if (worm.isAlive()) {
          activeAABBs.push(worm.getAABB());
          activeAABBs.push(...worm.rope.getAABBs());
        }
      }
      for (const ragdoll of this.ragdolls) {
        activeAABBs.push(...ragdoll.getAABBs());
      }
      this.rapierWorld.syncTerrainColliders(this.terrain, activeAABBs);
    }

    // 1. Update Worms (up to 8 players)
    for (const worm of this.worms) {
      let input: WormInput;
      if (worm.id === this.net.myPeerId) {
        input = this.localP1Input;
      } else {
        input = this.remoteInputs.get(worm.id) || { left: false, right: false, up: false, down: false, jump: false, fire: false, rope: false };
      }
      worm.update(input, this.terrain, this.particles, (w, wep, ang) => this.spawnProjectiles(w, wep, ang));

      // Handle Respawn for all worms
      if (!worm.isAlive() && worm.respawnTimer === 0) {
        const spawn = this.terrain.findSpawnPoint();
        worm.spawn(spawn.x, spawn.y);
      }
    }

    // Avancement de la simulation Rapier WASM
    if (this.rapierWorld) {
      this.rapierWorld.step();
      for (const worm of this.worms) {
        worm.syncFromRapier(this.terrain);
      }
      // Mise à jour et nettoyage des ragdolls
      this.ragdolls = this.ragdolls.filter(r => {
        const alive = r.update(this.particles);
        if (!alive && this.rapierWorld) {
          r.destroy(this.rapierWorld.world);
        }
        return alive;
      });
    }

    // 2. Acid damage tick (every 6 frames = ~10 times/sec)
    this.acidTickAccum++;
    if (this.acidTickAccum >= 6) {
      this.acidTickAccum = 0;
      for (const worm of this.worms) {
        if (!worm.isAlive()) continue;
        // Check if worm feet are touching acid
        const feetY = worm.y + 5;
        if (
          this.terrain.isAcid(worm.x, feetY) ||
          this.terrain.isAcid(worm.x - 3, feetY) ||
          this.terrain.isAcid(worm.x + 3, feetY) ||
          this.terrain.isAcid(worm.x, worm.y)
        ) {
          // 3 HP per 6 frames = ~30 HP/s (corrosive!)
          worm.takeDamage(3, 0, 0, 'acid');
          // Green acid particles
          this.particles.spawn(worm.x + (Math.random() - 0.5) * 8, worm.y + 4, (Math.random() - 0.5) * 0.5, -0.8, 'spark', '#44ff44', 1.5, 15);
          if (!worm.isAlive()) {
            this.particles.spawnGibs(worm.x, worm.y);
            this.onKillFeed?.(worm.name, 'Dissous par l\'acide');
          }
        }
      }
    }

    // 3. Update Projectiles (with damageScale, noSelfDamage, explosionScale, friendlyFire)
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const damageScale = mods.damageScale ?? 1.0;

      p.update(
        this.terrain,
        this.particles,
        this.worms.map(w => ({
          id: w.id,
          x: w.x,
          y: w.y,
          radius: w.radius,
          takeDamage: (dmg: number, kx: number, ky: number, attId: string) => {
            // No self damage modifier
            if (mods.noSelfDamage && attId === w.id) return;
            // Friendly fire check (teams mode)
            if (mods.gameMode === 'teams') {
              const attackerTeam = mods.teams[attId] ?? -1;
              const victimTeam = mods.teams[w.id] ?? -1;
              if (attackerTeam !== -1 && attackerTeam === victimTeam && attId !== w.id) return;
            }
            const scaledDmg = Math.round(dmg * damageScale);
            w.takeDamage(scaledDmg, kx, ky, attId);
            if (scaledDmg > 0) {
              this.particles.spawnBloodBurst(w.x, w.y, Math.min(25, scaledDmg / 2));
            }
            // Check if killed
            if (!w.isAlive()) {
              this.particles.spawnGibs(w.x, w.y);
              const killer = this.worms.find(k => k.id === attId);
              if (killer && killer.id !== w.id) {
                if (mods.gameMode === 'ffa') {
                  killer.frags++;
                  this.onKillFeed?.(killer.name, w.name);
                  if (killer.frags >= this.fragLimit && !this.matchWinner) {
                    this.matchWinner = killer;
                    this.onMatchEnd?.(killer);
                    this.net.broadcast({ type: 'MATCH_OVER', winnerId: killer.id });
                  }
                } else if (mods.gameMode === 'teams') {
                  killer.frags++;
                  const killerTeam = mods.teams[killer.id] ?? 0;
                  this.kothScores[killerTeam] = (this.kothScores[killerTeam] || 0) + 1;
                  this.onKillFeed?.(killer.name, w.name);
                  if (this.kothScores[killerTeam] >= this.fragLimit && !this.matchWinner) {
                    this.matchWinner = killer;
                    this.onMatchEnd?.(killer);
                    this.net.broadcast({ type: 'MATCH_OVER', winnerId: killer.id });
                  }
                } else {
                  // KOTH: kills still count toward kills but win by zone
                  killer.frags++;
                  this.onKillFeed?.(killer.name, w.name);
                }
              } else {
                this.onKillFeed?.(w.name, 'S\'est suicidé');
              }
            }
          },
          isAlive: () => w.isAlive()
        })),
        (proj) => this.handleProjectileDetonation(proj)
      );

      if (!p.alive) {
        // Handle acid pool from acid_bomb
        if (p.acidPoolCenter) {
          this.terrain.rawCarveAcid(p.acidPoolCenter.x, p.acidPoolCenter.y, p.acidPoolCenter.r);
        }
        this.projectiles.splice(i, 1);
      }
    }

    // 4. KOTH Zone logic (only host computes this)
    if (mods.gameMode === 'koth') {
      this.updateKOTH();
    }

    // 5. Update Particles
    this.particles.update(this.terrain);

    // 6. Host broadcasts state to peers at 60Hz
    this.broadcastHostState();
  }

  /** King of the Hill zone scoring. Zone is a circle at map center, radius 40px. */
  private updateKOTH() {
    const zoneX = this.terrain.width / 2;
    const zoneY = this.terrain.height / 2;
    const zoneR = 40;
    const mods = this.modifiers;

    const inZone = this.worms.filter(w => w.isAlive() && Math.hypot(w.x - zoneX, w.y - zoneY) <= zoneR);

    if (mods.gameMode === 'teams') {
      // Check which teams have worms in zone
      const teamsInZone = new Set(inZone.map(w => mods.teams[w.id] ?? 0));
      if (teamsInZone.size === 1) {
        const controllingTeam = [...teamsInZone][0];
        // 1 point per 60 frames = 1 pt/sec
        this.kothScores[controllingTeam] = (this.kothScores[controllingTeam] || 0) + 1 / 60;
        if (this.kothScores[controllingTeam] >= this.fragLimit * 12 && !this.matchWinner) {
          const winner = inZone.find(w => (mods.teams[w.id] ?? 0) === controllingTeam) || this.worms[0];
          this.matchWinner = winner;
          this.onMatchEnd?.(winner);
          this.net.broadcast({ type: 'MATCH_OVER', winnerId: winner.id });
        }
      }
    } else {
      // FFA: only 1 worm in zone to control it
      if (inZone.length === 1) {
        const controller = inZone[0];
        controller.frags += 1 / 60; // fractional point accumulation
        const score = Math.floor(controller.frags);
        if (score >= this.fragLimit * 12 && !this.matchWinner) {
          this.matchWinner = controller;
          this.onMatchEnd?.(controller);
          this.net.broadcast({ type: 'MATCH_OVER', winnerId: controller.id });
        }
      }
    }
  }

  private broadcastHostState() {
    const wormStates: WormNetState[] = this.worms.map(w => ({
      id: w.id,
      name: w.name,
      color: w.color,
      x: Math.round(w.x * 10) / 10,
      y: Math.round(w.y * 10) / 10,
      vx: Math.round(w.vx * 10) / 10,
      vy: Math.round(w.vy * 10) / 10,
      health: w.health,
      frags: w.frags,
      deaths: w.deaths,
      facing: w.facing,
      aimAngle: Math.round(w.aimAngle * 100) / 100,
      weaponIndex: w.currentWeaponIndex,
      ropeState: w.rope.state,
      hookX: Math.round(w.rope.hookX),
      hookY: Math.round(w.rope.hookY)
    }));

    const projStates: ProjectileNetState[] = this.projectiles.map(p => ({
      id: p.id,
      weaponId: p.weapon.id,
      x: Math.round(p.x),
      y: Math.round(p.y),
      vx: Math.round(p.vx * 10) / 10,
      vy: Math.round(p.vy * 10) / 10
    }));

    this.net.broadcast({
      type: 'STATE',
      seq: this.netSeq++,
      worms: wormStates,
      projectiles: projStates,
      events: [...this.pendingNetEvents]
    });

    this.pendingNetEvents = [];
  }

  private applyWorldState(msg: { worms: WormNetState[]; projectiles: ProjectileNetState[]; events: NetEvent[] }) {
    // 1. Apply events (craters, blood, sounds)
    for (const ev of msg.events) {
      if (ev.type === 'crater') {
        this.terrain.carveCircle(ev.x, ev.y, ev.r);
        this.particles.spawnExplosionFX(ev.x, ev.y, ev.r);
        sound.playExplosion(ev.r);
      } else if (ev.type === 'blood') {
        this.particles.spawnBloodBurst(ev.x, ev.y, ev.count);
      } else if (ev.type === 'sound') {
        if (ev.name === 'bazooka') sound.playBazooka();
        else if (ev.name === 'minigun') sound.playMinigun();
        else if (ev.name === 'shotgun') sound.playShotgun();
        else if (ev.name === 'gauss' || ev.name === 'railgun') sound.playRailgun();
        else if (ev.name === 'homing_missile') sound.playHoming();
        else if (ev.name === 'bouncy_ball') sound.playBouncy();
        else if (ev.name === 'dart_gun') sound.playDart();
        else if (ev.name === 'vortex') sound.playVortex();
        else if (ev.name === 'grenade' || ev.name === 'chiquita') sound.playGrenadeBounce();
      }
    }

    // 2. Synchronize worms (up to 8 players)
    for (const ws of msg.worms) {
      let worm = this.worms.find(w => w.id === ws.id);
      if (!worm) {
        worm = new Worm(ws.id, ws.name, ws.color, false, DEFAULT_LOADOUT);
        worm.applyModifiers(this.modifiers);
        this.worms.push(worm);
      }

      worm.name = ws.name;
      worm.color = ws.color;

      if (ws.health <= 0 && worm.health > 0) {
        sound.playDie();
        this.particles.spawnGibs(worm.x, worm.y);
      }

      if (worm.id === this.net.myPeerId) {
        // Authoritative stats from host
        worm.health = ws.health;
        worm.frags = ws.frags;
        worm.deaths = ws.deaths;

        if (ws.health <= 0) {
          worm.x = ws.x;
          worm.y = ws.y;
          worm.vx = ws.vx;
          worm.vy = ws.vy;
          worm.rope.release();
        } else {
          // Position reconciliation with host
          const dx = ws.x - worm.x;
          const dy = ws.y - worm.y;
          const distSq = dx * dx + dy * dy;
          if (distSq > 400) {
            worm.x = ws.x;
            worm.y = ws.y;
            worm.vx = ws.vx;
            worm.vy = ws.vy;
          } else if (distSq > 4) {
            worm.x += dx * 0.25;
            worm.y += dy * 0.25;
          }
        }
      } else {
        // Remote worm: direct sync from host
        worm.x = ws.x;
        worm.y = ws.y;
        worm.vx = ws.vx;
        worm.vy = ws.vy;
        worm.health = ws.health;
        worm.frags = ws.frags;
        worm.deaths = ws.deaths;
        worm.facing = ws.facing;
        worm.aimAngle = ws.aimAngle;
        worm.currentWeaponIndex = ws.weaponIndex;
        worm.rope.state = ws.ropeState;
        worm.rope.hookX = ws.hookX;
        worm.rope.hookY = ws.hookY;
      }
    }

    // 3. Synchronize projectiles
    this.projectiles = msg.projectiles.map(ps => {
      const wep = WEAPON_REGISTRY[ps.weaponId] || WEAPON_REGISTRY.bazooka;
      return new Projectile({
        id: ps.id,
        ownerId: '',
        weapon: wep,
        x: ps.x,
        y: ps.y,
        vx: ps.vx,
        vy: ps.vy
      });
    });
  }

  public render() {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // Clear entire screen
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();

    // Apply camera: translate to center, scale by zoom, then offset by cam position
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(this.camZoom, this.camZoom);
    ctx.translate(-this.camX, -this.camY);

    // Screen shake: applied as a small sub-pixel jitter in world space
    if (this.shakeDuration > 0) {
      const ox = (Math.random() - 0.5) * this.shakeIntensity / this.camZoom;
      const oy = (Math.random() - 0.5) * this.shakeIntensity / this.camZoom;
      ctx.translate(ox, oy);
    }

    // 1. Draw Terrain (dirt, rock, cavern sky) — pass time for acid animation
    this.terrain.draw(ctx, this.renderFrameTime);

    // 1b. Draw KOTH zone indicator (if KOTH mode)
    if (this.modifiers.gameMode === 'koth') {
      const zoneX = this.terrain.width / 2;
      const zoneY = this.terrain.height / 2;
      const zoneR = 40;
      const pulse = 0.5 + 0.5 * Math.sin(this.renderFrameTime * 0.05);
      ctx.save();
      ctx.strokeStyle = `rgba(255, 215, 0, ${0.5 + pulse * 0.5})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(zoneX, zoneY, zoneR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(255, 215, 0, ${0.04 + pulse * 0.06})`;
      ctx.beginPath();
      ctx.arc(zoneX, zoneY, zoneR, 0, Math.PI * 2);
      ctx.fill();
      // Crown icon at center
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(255, 215, 0, ${0.6 + pulse * 0.4})`;
      ctx.fillText('👑', zoneX, zoneY);
      ctx.restore();
    }

    // 2. Draw Particles (blood, smoke, sparks)
    this.particles.draw(ctx);

    // 3. Draw Projectiles
    for (const proj of this.projectiles) {
      proj.draw(ctx);
    }

    // 3b. Draw Ragdolls (corps articulés des vers éliminés)
    for (const ragdoll of this.ragdolls) {
      ragdoll.draw(ctx);
    }

    // 4. Draw Worms (all up to 8 worms)
    for (const worm of this.worms) {
      worm.draw(ctx);
    }

    ctx.restore();

    // 5. Off-screen player indicators (drawn in screen space, after world transform is restored)
    this.drawOffScreenIndicators();
  }
}
