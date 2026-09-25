import RAPIER from '@dimforge/rapier2d-compat';
import { CONFIG } from '../config';
import { Terrain } from './Terrain';
import { sound } from './SoundEffects';
import { RapierWorld, pxToM, mToPx, DynamicEntityAABB } from '../physics/RapierWorld';

export type RopeState = 'idle' | 'flying' | 'attached';

export class NinjaRope {
  public state: RopeState = 'idle';
  public hookX: number = 0;
  public hookY: number = 0;
  public hookVx: number = 0;
  public hookVy: number = 0;
  public length: number = 0;
  public maxLength: number = CONFIG.ROPE_MAX_LENGTH;
  public isInfinite: boolean = false;

  // Rapier Articulated Chain
  private rapierWorld?: RapierWorld;
  private anchorBody?: RAPIER.RigidBody;
  private chainBodies: RAPIER.RigidBody[] = [];
  private chainJoints: RAPIER.ImpulseJoint[] = [];
  private wormJoint?: RAPIER.ImpulseJoint;

  public setModifiers(reach: 'normal' | 'infinite') {
    this.isInfinite = reach === 'infinite';
    this.maxLength = this.isInfinite ? 99999 : CONFIG.ROPE_MAX_LENGTH;
  }

  public setRapierWorld(rw?: RapierWorld) {
    this.rapierWorld = rw;
  }

  public shoot(originX: number, originY: number, angle: number) {
    this.cleanupPhysicsChain();
    this.state = 'flying';
    this.hookX = originX;
    this.hookY = originY;
    const speed = 15.5;
    this.hookVx = Math.cos(angle) * speed;
    this.hookVy = Math.sin(angle) * speed;
    this.length = 0;
    sound.playRopeShoot();
  }

  public release() {
    this.cleanupPhysicsChain();
    this.state = 'idle';
  }

  public isAttached(): boolean {
    return this.state === 'attached';
  }

  public isActive(): boolean {
    return this.state !== 'idle';
  }

  private cleanupPhysicsChain() {
    if (!this.rapierWorld) return;
    const world = this.rapierWorld.world;

    if (this.wormJoint) {
      try { world.removeImpulseJoint(this.wormJoint, true); } catch {}
      this.wormJoint = undefined;
    }

    for (const joint of this.chainJoints) {
      try { world.removeImpulseJoint(joint, true); } catch {}
    }
    this.chainJoints = [];

    for (const body of this.chainBodies) {
      try { world.removeRigidBody(body); } catch {}
    }
    this.chainBodies = [];

    if (this.anchorBody) {
      try { world.removeRigidBody(this.anchorBody); } catch {}
      this.anchorBody = undefined;
    }
  }

  /**
   * Crée une chaîne physique articulée dans Rapier entre le point d'ancrage
   * et le corps du ver pour permettre à la corde de s'enrouler autour des parois.
   */
  private buildPhysicsChain(wormX: number, wormY: number, wormBody?: RAPIER.RigidBody) {
    if (!this.rapierWorld || !wormBody) return;
    this.cleanupPhysicsChain();

    const world = this.rapierWorld.world;
    const rapier = this.rapierWorld.rapier;

    // 1. Point d'ancrage fixe dans la paroi
    const anchorDesc = rapier.RigidBodyDesc.fixed()
      .setTranslation(pxToM(this.hookX), pxToM(this.hookY));
    this.anchorBody = world.createRigidBody(anchorDesc);

    // 2. Créer 4 segments intermédiaires
    const numSegments = 4;
    let prevBody = this.anchorBody;

    for (let i = 0; i < numSegments; i++) {
      const t = (i + 1) / (numSegments + 1);
      const sx = this.hookX + (wormX - this.hookX) * t;
      const sy = this.hookY + (wormY - this.hookY) * t;

      const linkDesc = rapier.RigidBodyDesc.dynamic()
        .setTranslation(pxToM(sx), pxToM(sy))
        .setLinearDamping(0.25)
        .setAngularDamping(0.4)
        .setCcdEnabled(true);
      const linkBody = world.createRigidBody(linkDesc);

      const linkColDesc = rapier.ColliderDesc.ball(pxToM(1.8))
        .setFriction(0.4)
        .setRestitution(0.1)
        .setDensity(0.4);
      world.createCollider(linkColDesc, linkBody);

      // Connecter au maillon précédent par un revolute joint
      const jointParams = rapier.JointData.revolute({ x: 0, y: 0 }, { x: 0, y: 0 });
      const joint = world.createImpulseJoint(jointParams, prevBody, linkBody, true);
      this.chainJoints.push(joint);

      this.chainBodies.push(linkBody);
      prevBody = linkBody;
    }

    // 3. Connecter le dernier maillon au ver
    const lastLink = this.chainBodies[this.chainBodies.length - 1];
    const wormJointParams = rapier.JointData.revolute({ x: 0, y: 0 }, { x: 0, y: 0 });
    this.wormJoint = world.createImpulseJoint(wormJointParams, lastLink, wormBody, true);
  }

  public getAABBs(): DynamicEntityAABB[] {
    const list: DynamicEntityAABB[] = [];
    if (this.state === 'attached') {
      list.push({ x: this.hookX, y: this.hookY, radius: 15 });
      for (const body of this.chainBodies) {
        const p = body.translation();
        list.push({ x: mToPx(p.x), y: mToPx(p.y), radius: 15 });
      }
    }
    return list;
  }

  public update(
    worm: { x: number; y: number; vx: number; vy: number; rapierBody?: RAPIER.RigidBody },
    terrain: Terrain,
    reelIn: boolean,
    reelOut: boolean
  ) {
    if (this.state === 'idle') return;

    if (this.state === 'flying') {
      const steps = 4;
      const stepVx = this.hookVx / steps;
      const stepVy = this.hookVy / steps;

      for (let s = 0; s < steps; s++) {
        this.hookX += stepVx;
        this.hookY += stepVy;

        const dist = Math.hypot(this.hookX - worm.x, this.hookY - worm.y);
        if (!this.isInfinite && dist > this.maxLength) {
          this.release();
          return;
        }

        if (terrain.isSolid(this.hookX, this.hookY)) {
          this.state = 'attached';
          this.length = Math.max(22, dist);
          sound.playRopeLatch();

          if (this.rapierWorld && worm.rapierBody) {
            this.buildPhysicsChain(worm.x, worm.y, worm.rapierBody);
          }
          return;
        }
      }
    } else if (this.state === 'attached') {
      // Si le point d'attache a été détruit par une explosion
      if (!terrain.isSolid(this.hookX, this.hookY)) {
        this.release();
        return;
      }

      // Reeling (montée / descente avec Z/S)
      const reelSpeed = 1.7;
      if (reelIn) {
        this.length = Math.max(16, this.length - reelSpeed);
      } else if (reelOut) {
        this.length = Math.min(this.maxLength, this.length + reelSpeed);
      }

      // Si Rapier est actif avec la chaîne articulée
      if (this.rapierWorld && worm.rapierBody) {
        if (reelIn) {
          // Attirer doucement le ver vers le dernier segment ou le crochet
          const target = this.chainBodies.length > 0
            ? this.chainBodies[0].translation()
            : { x: pxToM(this.hookX), y: pxToM(this.hookY) };
          const wp = worm.rapierBody.translation();
          const dx = target.x - wp.x;
          const dy = target.y - wp.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 0.01) {
            worm.rapierBody.applyImpulse(
              { x: (dx / dist) * 0.12, y: (dy / dist) * 0.12 - 0.05 },
              true
            );
          }
        }
        return;
      }

      // Contrainte classique de secours si Rapier n'est pas actif
      const hx = worm.x - this.hookX;
      const hy = worm.y - this.hookY;
      const dist = Math.hypot(hx, hy);
      if (dist < 0.001) return;

      const ox = hx / dist;
      const oy = hy / dist;

      const radialVel = worm.vx * ox + worm.vy * oy;
      if (dist >= this.length && radialVel > 0) {
        worm.vx -= ox * radialVel;
        worm.vy -= oy * radialVel;
      }
    }
  }

  public draw(ctx: CanvasRenderingContext2D, wormX: number, wormY: number) {
    if (this.state === 'idle') return;

    ctx.save();
    ctx.strokeStyle = '#dddddd';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(wormX, wormY);

    if (this.state === 'attached' && this.chainBodies.length > 0) {
      // Dessiner à travers tous les segments physiques (forme courbée naturelle)
      for (let i = this.chainBodies.length - 1; i >= 0; i--) {
        const p = this.chainBodies[i].translation();
        ctx.lineTo(mToPx(p.x), mToPx(p.y));
      }
    }

    ctx.lineTo(this.hookX, this.hookY);
    ctx.stroke();

    // Pointe du grappin
    ctx.fillStyle = this.state === 'attached' ? '#ff3333' : '#ffffff';
    ctx.fillRect(this.hookX - 2, this.hookY - 2, 4, 4);
    ctx.restore();
  }
}
