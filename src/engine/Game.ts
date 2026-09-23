import { CONFIG } from '../config';
import { Terrain } from './Terrain';
import { Worm, WormInput } from './Worm';
import { Projectile } from './Projectile';
import { ParticleManager } from './Particles';
import { AIController } from './AI';
import { WeaponDef, WeaponId } from '../weapons/WeaponDef';
import { WEAPON_REGISTRY, DEFAULT_LOADOUT } from '../weapons/WeaponRegistry';
import { NetworkManager } from '../net/NetworkManager';
import { NetEvent, NetMessage, WormNetState, ProjectileNetState } from '../net/Protocol';
import { sound } from './SoundEffects';

export type GameMode = 'singleplayer' | 'local2p' | 'online_host' | 'online_client';

export class Game {
  public canvas: HTMLCanvasElement;
  public ctx: CanvasRenderingContext2D;
  public terrain: Terrain;
  public particles: ParticleManager;
  public worms: Worm[] = [];
  public aiControllers: Map<string, AIController> = new Map();
  public projectiles: Projectile[] = [];
  public nextProjectileId: number = 1;

  public mode: GameMode = 'singleplayer';
  public net: NetworkManager;
  public mapSeed: number = 123456;
  public fragLimit: number = CONFIG.DEFAULT_FRAG_LIMIT;
  public matchWinner: Worm | null = null;
  public isRunning: boolean = false;

  // Screen shake
  public shakeDuration: number = 0;
  public shakeIntensity: number = 0;

  // Local inputs
  public localP1Input: WormInput = { left: false, right: false, up: false, down: false, jump: false, fire: false, rope: false };
  public localP2Input: WormInput = { left: false, right: false, up: false, down: false, jump: false, fire: false, rope: false };
  public remoteInputs: Map<string, WormInput> = new Map();

  // Network event queue (for Host to send to clients)
  private pendingNetEvents: NetEvent[] = [];
  private netSeq: number = 0;
  private clientInputTimer: number = 0;

  // Callbacks for UI updates
  public onMatchEnd?: (winner: Worm) => void;
  public onKillFeed?: (killer: string, victim: string) => void;
  public onWelcomeReceived?: () => void;

  constructor(canvas: HTMLCanvasElement, net: NetworkManager) {
    this.canvas = canvas;
    this.canvas.width = CONFIG.MAP_WIDTH;
    this.canvas.height = CONFIG.MAP_HEIGHT;
    this.ctx = canvas.getContext('2d')!;

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

  public getLocalWorm(): Worm | undefined {
    if (this.mode === 'online_client') {
      return this.worms.find(w => w.id === this.net.myPeerId) || this.worms[0];
    }
    return this.worms[0];
  }

  private setupNetworkCallbacks() {
    this.net.onMessageReceived = (msg: NetMessage, fromId: string) => {
      if (this.mode === 'online_host') {
        if (msg.type === 'INPUT') {
          // If player was not yet added to host's worms, auto-register immediately
          if (!this.worms.some(w => w.id === fromId)) {
            this.addNetworkPlayer(fromId, 'Invité', DEFAULT_LOADOUT);
            this.net.sendTo(fromId, {
              type: 'WELCOME',
              playerId: fromId,
              mapSeed: this.mapSeed,
              mapWidth: CONFIG.MAP_WIDTH,
              mapHeight: CONFIG.MAP_HEIGHT,
              fragLimit: this.fragLimit
            });
          }
          this.remoteInputs.set(fromId, msg.input);
        } else if (msg.type === 'JOIN') {
          this.addNetworkPlayer(fromId, msg.name, msg.loadout);
          this.net.sendTo(fromId, {
            type: 'WELCOME',
            playerId: fromId,
            mapSeed: this.mapSeed,
            mapWidth: CONFIG.MAP_WIDTH,
            mapHeight: CONFIG.MAP_HEIGHT,
            fragLimit: this.fragLimit
          });
        }
      } else if (this.mode === 'online_client') {
        if (msg.type === 'WELCOME') {
          if (this.mapSeed !== msg.mapSeed) {
            this.mapSeed = msg.mapSeed;
            this.terrain.generateMap(msg.mapSeed);
          }
          this.onWelcomeReceived?.();
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
  }

  public initMatch(mode: GameMode, p1Loadout: WeaponId[] = DEFAULT_LOADOUT, p2Loadout: WeaponId[] = DEFAULT_LOADOUT) {
    this.mode = mode;
    this.matchWinner = null;
    this.particles.clear();
    this.projectiles = [];
    this.worms = [];
    this.aiControllers.clear();
    this.remoteInputs.clear();
    this.pendingNetEvents = [];

    if (mode !== 'online_client') {
      this.mapSeed = Math.floor(Math.random() * 1000000);
      this.terrain.generateMap(this.mapSeed);
    }

    if (mode === 'singleplayer') {
      // 1 Human Player + 1 AI Bot
      const p1 = new Worm('p1', 'Joueur 1', CONFIG.COLORS.WORM_P1, false, p1Loadout);
      const bot = new Worm('bot1', 'Robo-Ver', CONFIG.COLORS.WORM_BOT1, true, p2Loadout);

      const spawn1 = this.terrain.findSpawnPoint();
      p1.spawn(spawn1.x, spawn1.y);

      const spawn2 = this.terrain.findSpawnPoint();
      bot.spawn(spawn2.x, spawn2.y);

      this.worms.push(p1, bot);
      this.aiControllers.set(bot.id, new AIController(bot));
    } else if (mode === 'local2p') {
      // 2 Players 1 Keyboard
      const p1 = new Worm('p1', 'Joueur 1 (Vert)', CONFIG.COLORS.WORM_P1, false, p1Loadout);
      const p2 = new Worm('p2', 'Joueur 2 (Bleu)', CONFIG.COLORS.WORM_P2, false, p2Loadout);

      const spawn1 = this.terrain.findSpawnPoint();
      p1.spawn(spawn1.x, spawn1.y);

      const spawn2 = this.terrain.findSpawnPoint();
      p2.spawn(spawn2.x, spawn2.y);

      this.worms.push(p1, p2);
    } else if (mode === 'online_host') {
      // Host Player
      const hostWorm = new Worm(this.net.myPeerId, 'Hôte', CONFIG.COLORS.WORM_P1, false, p1Loadout);
      const spawn = this.terrain.findSpawnPoint();
      hostWorm.spawn(spawn.x, spawn.y);
      this.worms.push(hostWorm);
    } else if (mode === 'online_client') {
      // Client Player: create local worm representation with valid spawn so player inputs work immediately
      this.terrain.generateMap(this.mapSeed);
      const clientWorm = new Worm(this.net.myPeerId, 'Moi', CONFIG.COLORS.WORM_P2, false, p1Loadout);
      const spawn = this.terrain.findSpawnPoint();
      clientWorm.spawn(spawn.x, spawn.y);
      this.worms.push(clientWorm);
    }

    this.isRunning = true;
  }

  public addNetworkPlayer(peerId: string, name: string, loadout: WeaponId[]) {
    let worm = this.worms.find(w => w.id === peerId);
    if (!worm) {
      worm = new Worm(peerId, name || 'Invité', CONFIG.COLORS.WORM_P2, false, loadout);
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
      // Shotgun burst
      for (let i = 0; i < weapon.pelletCount; i++) {
        const spreadAngle = angle + (Math.random() - 0.5) * weapon.spread;
        const speed = weapon.projectileSpeed * (0.85 + Math.random() * 0.3);
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
      // 1. Broadcast local inputs to host at 60Hz for immediate reaction
      this.net.broadcast({
        type: 'INPUT',
        seq: this.netSeq++,
        input: this.localP1Input
      });

      // 2. Client-side local prediction: simulate local worm physics, movement, and digging
      const localWorm = this.getLocalWorm();
      if (localWorm) {
        localWorm.update(
          this.localP1Input,
          this.terrain,
          this.particles,
          () => {
            // Weapon firing: recoil & audio trigger immediately inside worm.attemptFire().
            // Authoritative projectiles are created on host and synchronized via STATE.
          }
        );
      }

      // 3. Update local particles
      this.particles.update(this.terrain);
      return;
    }

    // --- Host / Local / Singleplayer authoritative simulation ---

    // 1. Update Worms
    for (const worm of this.worms) {
      let input: WormInput;

      if (worm.id === 'p1' || worm.id === this.net.myPeerId) {
        input = this.localP1Input;
      } else if (worm.id === 'p2') {
        input = this.localP2Input;
      } else if (worm.isAI) {
        const ai = this.aiControllers.get(worm.id);
        input = ai ? ai.update(this.worms, this.terrain) : { left: false, right: false, up: false, down: false, jump: false, fire: false, rope: false };
      } else {
        // Network client worm (input updated via incoming messages)
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
                  if (this.mode === 'online_host') {
                    this.net.broadcast({ type: 'MATCH_OVER', winnerId: killer.id });
                  }
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
    if (this.mode === 'online_host') {
      this.broadcastHostState();
    }
  }

  private broadcastHostState() {
    const wormStates: WormNetState[] = this.worms.map(w => ({
      id: w.id,
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
        else if (ev.name === 'gauss') sound.playLaser();
        else if (ev.name === 'grenade' || ev.name === 'chiquita') sound.playGrenadeBounce();
      }
    }

    // 2. Synchronize worms
    for (const ws of msg.worms) {
      let worm = this.worms.find(w => w.id === ws.id);
      if (!worm) {
        worm = new Worm(ws.id, ws.id === this.net.myPeerId ? 'Moi' : 'Hôte', ws.id === this.net.myPeerId ? CONFIG.COLORS.WORM_P2 : CONFIG.COLORS.WORM_P1);
        this.worms.push(worm);
      }

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
            // Large drift (explosion knockback or teleport): snap
            worm.x = ws.x;
            worm.y = ws.y;
            worm.vx = ws.vx;
            worm.vy = ws.vy;
          } else if (distSq > 4) {
            // Smooth convergence
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
    this.ctx.save();

    // Screen Shake offset
    if (this.shakeDuration > 0) {
      const ox = (Math.random() - 0.5) * this.shakeIntensity;
      const oy = (Math.random() - 0.5) * this.shakeIntensity;
      this.ctx.translate(ox, oy);
    }

    // 1. Draw Terrain (dirt, rock, cavern sky)
    this.terrain.draw(this.ctx);

    // 2. Draw Particles (blood, smoke, sparks)
    this.particles.draw(this.ctx);

    // 3. Draw Projectiles
    for (const proj of this.projectiles) {
      proj.draw(this.ctx);
    }

    // 4. Draw Worms
    for (const worm of this.worms) {
      worm.draw(this.ctx);
    }

    this.ctx.restore();
  }
}
