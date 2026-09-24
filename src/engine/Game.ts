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

export type GameMode = 'online_host' | 'online_client';

export class Game {
  public canvas: HTMLCanvasElement;
  public ctx: CanvasRenderingContext2D;
  public terrain: Terrain;
  public particles: ParticleManager;
  public worms: Worm[] = [];
  public projectiles: Projectile[] = [];
  public nextProjectileId: number = 1;

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

  // Smooth camera following local player
  public camX: number = 0;
  public camY: number = 0;
  public readonly camZoom: number = 2.5; // zoom multiplier

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

  public getLocalWorm(): Worm | undefined {
    if (this.mode === 'online_client') {
      return this.worms.find(w => w.id === this.net.myPeerId) || this.worms[0];
    }
    return this.worms.find(w => w.id === this.net.myPeerId) || this.worms[0];
  }

  public getLobbyPlayers(): LobbyPlayerInfo[] {
    return Array.from(this.lobbyPlayers.values());
  }

  public setModifiers(newMods: Partial<MatchModifiers>) {
    this.modifiers = { ...this.modifiers, ...newMods };
    this.fragLimit = this.modifiers.fragLimit;
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
            this.terrain.generateMap(msg.mapSeed);
          }
          this.onWelcomeReceived?.();
          this.onLobbyUpdate?.(msg.players, msg.modifiers);
        } else if (msg.type === 'LOBBY_UPDATE') {
          this.modifiers = msg.modifiers;
          this.fragLimit = msg.modifiers.fragLimit;
          this.onLobbyUpdate?.(msg.players, msg.modifiers);
        } else if (msg.type === 'START_MATCH') {
          this.mapSeed = msg.mapSeed;
          this.terrain.generateMap(msg.mapSeed);
          this.modifiers = msg.modifiers;
          this.fragLimit = msg.modifiers.fragLimit;
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
      this.terrain.generateMap(this.mapSeed);

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
      this.terrain.generateMap(this.mapSeed);
      const clientColor = CONFIG.PLAYER_COLORS[1];
      const clientWorm = new Worm(this.net.myPeerId, myName || 'Moi', clientColor, false, myLoadout);
      clientWorm.applyModifiers(this.modifiers);
      const spawn = this.terrain.findSpawnPoint();
      clientWorm.spawn(spawn.x, spawn.y);
      this.worms.push(clientWorm);
    }

    this.isRunning = false; // Waiting for Host to click Start Match in lobby
  }

  public startHostMatch() {
    if (this.mode !== 'online_host') return;

    this.mapSeed = Math.floor(Math.random() * 1000000);
    this.terrain.generateMap(this.mapSeed);
    this.particles.clear();
    this.projectiles = [];
    this.worms = [];

    const players = this.getLobbyPlayers();
    for (const p of players) {
      const w = new Worm(p.id, p.name, p.color, false, p.loadout);
      w.applyModifiers(this.modifiers);
      const spawn = this.terrain.findSpawnPoint();
      w.spawn(spawn.x, spawn.y);
      this.worms.push(w);
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
    // Screen shake on major explosions
    if (proj.weapon.craterRadius >= 15) {
      this.triggerScreenShake(8, proj.weapon.craterRadius * 0.25);
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

    if (this.mode === 'online_client') {
      // 1. Broadcast local inputs to host at 60Hz
      this.net.broadcast({
        type: 'INPUT',
        seq: this.netSeq++,
        input: this.localP1Input
      });

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

      // 3. Update local particles
      this.particles.update(this.terrain);
      return;
    }

    // --- Host Authoritative Simulation ---

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

    // 2. Update Projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.update(
        this.terrain,
        this.particles,
        this.worms.map(w => ({
          id: w.id,
          x: w.x,
          y: w.y,
          radius: w.radius,
          takeDamage: (dmg, kx, ky, attId) => {
            w.takeDamage(dmg, kx, ky, attId);
            this.particles.spawnBloodBurst(w.x, w.y, Math.min(25, dmg / 2));

            // Check if killed
            if (!w.isAlive()) {
              this.particles.spawnGibs(w.x, w.y);
              const killer = this.worms.find(k => k.id === attId);
              if (killer && killer.id !== w.id) {
                killer.frags++;
                this.onKillFeed?.(killer.name, w.name);
                if (killer.frags >= this.fragLimit && !this.matchWinner) {
                  this.matchWinner = killer;
                  this.onMatchEnd?.(killer);
                  this.net.broadcast({ type: 'MATCH_OVER', winnerId: killer.id });
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
        this.projectiles.splice(i, 1);
      }
    }

    // 3. Update Particles
    this.particles.update(this.terrain);

    // 4. Host broadcasts state to peers at 60Hz
    this.broadcastHostState();
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

    // 1. Draw Terrain (dirt, rock, cavern sky)
    this.terrain.draw(ctx);

    // 2. Draw Particles (blood, smoke, sparks)
    this.particles.draw(ctx);

    // 3. Draw Projectiles
    for (const proj of this.projectiles) {
      proj.draw(ctx);
    }

    // 4. Draw Worms (all up to 8 worms)
    for (const worm of this.worms) {
      worm.draw(ctx);
    }

    ctx.restore();
  }
}
