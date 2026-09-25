import RAPIER from '@dimforge/rapier2d-compat';
import { pxToM, mToPx, DynamicEntityAABB } from '../physics/RapierWorld';
import { ParticleManager } from './Particles';

export class Ragdoll {
  public headBody: RAPIER.RigidBody;
  public torsoBody: RAPIER.RigidBody;
  public tailBody: RAPIER.RigidBody;
  public joints: RAPIER.ImpulseJoint[] = [];
  public color: string;
  public lifetime: number = 300; // 5 seconds at 60 fps
  public maxLifetime: number = 300;
  public isDead: boolean = false;

  constructor(
    rapier: typeof RAPIER,
    world: RAPIER.World,
    x: number,
    y: number,
    initialVx: number,
    initialVy: number,
    color: string
  ) {
    this.color = color;

    const startX = pxToM(x);
    const startY = pxToM(y);
    const headOffset = pxToM(-6);
    const tailOffset = pxToM(6);

    // 1. Head Body & Collider
    const headDesc = rapier.RigidBodyDesc.dynamic()
      .setTranslation(startX, startY + headOffset)
      .setLinearDamping(0.3)
      .setAngularDamping(0.5)
      .setCcdEnabled(true);
    this.headBody = world.createRigidBody(headDesc);

    const headColDesc = rapier.ColliderDesc.ball(pxToM(4.2))
      .setFriction(0.6)
      .setRestitution(0.25)
      .setDensity(1.2);
    world.createCollider(headColDesc, this.headBody);

    // 2. Torso Body & Collider
    const torsoDesc = rapier.RigidBodyDesc.dynamic()
      .setTranslation(startX, startY)
      .setLinearDamping(0.3)
      .setAngularDamping(0.5)
      .setCcdEnabled(true);
    this.torsoBody = world.createRigidBody(torsoDesc);

    const torsoColDesc = rapier.ColliderDesc.cuboid(pxToM(3.5), pxToM(3.5))
      .setFriction(0.6)
      .setRestitution(0.2)
      .setDensity(1.5);
    world.createCollider(torsoColDesc, this.torsoBody);

    // 3. Tail Body & Collider
    const tailDesc = rapier.RigidBodyDesc.dynamic()
      .setTranslation(startX, startY + tailOffset)
      .setLinearDamping(0.3)
      .setAngularDamping(0.5)
      .setCcdEnabled(true);
    this.tailBody = world.createRigidBody(tailDesc);

    const tailColDesc = rapier.ColliderDesc.cuboid(pxToM(3.0), pxToM(3.0))
      .setFriction(0.6)
      .setRestitution(0.2)
      .setDensity(1.0);
    world.createCollider(tailColDesc, this.tailBody);

    // 4. Joints between segments
    // Head to Torso
    const joint1Params = rapier.JointData.revolute(
      { x: 0, y: pxToM(3.5) },
      { x: 0, y: pxToM(-3.5) }
    );
    joint1Params.limits = [-Math.PI * 0.45, Math.PI * 0.45];
    joint1Params.limitsEnabled = true;
    const j1 = world.createImpulseJoint(joint1Params, this.headBody, this.torsoBody, true);
    this.joints.push(j1);

    // Torso to Tail
    const joint2Params = rapier.JointData.revolute(
      { x: 0, y: pxToM(3.5) },
      { x: 0, y: pxToM(-3.5) }
    );
    joint2Params.limits = [-Math.PI * 0.45, Math.PI * 0.45];
    joint2Params.limitsEnabled = true;
    const j2 = world.createImpulseJoint(joint2Params, this.torsoBody, this.tailBody, true);
    this.joints.push(j2);

    // Apply initial death impulse (from bullet or explosion)
    const impulse = {
      x: pxToM(initialVx) * 3.5,
      y: pxToM(initialVy) * 3.5 - 0.2
    };
    this.headBody.applyImpulse(impulse, true);
    this.torsoBody.applyImpulse(impulse, true);
    this.tailBody.applyImpulse(impulse, true);

    // Random angular spin to flop realistically
    const spin = (Math.random() - 0.5) * 4.0;
    this.headBody.applyTorqueImpulse(spin * 0.05, true);
    this.torsoBody.applyTorqueImpulse(-spin * 0.05, true);
  }

  public getAABBs(): DynamicEntityAABB[] {
    const hp = this.headBody.translation();
    const tp = this.torsoBody.translation();
    const lp = this.tailBody.translation();

    return [
      { x: mToPx(hp.x), y: mToPx(hp.y), radius: 18 },
      { x: mToPx(tp.x), y: mToPx(tp.y), radius: 18 },
      { x: mToPx(lp.x), y: mToPx(lp.y), radius: 18 }
    ];
  }

  public update(particles: ParticleManager): boolean {
    if (this.isDead) return false;

    this.lifetime--;
    if (this.lifetime <= 0) {
      this.isDead = true;
      return false;
    }

    // Spawn subtle blood droplets if the ragdoll is tumbling fast
    if (this.lifetime > 60 && Math.random() < 0.25) {
      const tp = this.torsoBody.translation();
      const vel = this.torsoBody.linvel();
      const speed = Math.hypot(vel.x, vel.y);
      if (speed > 1.5) {
        particles.spawn(
          mToPx(tp.x),
          mToPx(tp.y),
          (Math.random() - 0.5) * 0.8,
          (Math.random() - 0.5) * 0.8,
          'blood',
          '#cc1111',
          1.5,
          40
        );
      }
    }

    return true;
  }

  public draw(ctx: CanvasRenderingContext2D) {
    if (this.isDead) return;

    const hp = this.headBody.translation();
    const tp = this.torsoBody.translation();
    const lp = this.tailBody.translation();

    const hx = mToPx(hp.x);
    const hy = mToPx(hp.y);
    const tx = mToPx(tp.x);
    const ty = mToPx(tp.y);
    const lx = mToPx(lp.x);
    const ly = mToPx(lp.y);

    const headAngle = this.headBody.rotation();
    const torsoAngle = this.torsoBody.rotation();
    const tailAngle = this.tailBody.rotation();

    // Fade out during last 60 frames
    const alpha = this.lifetime < 60 ? this.lifetime / 60 : 1.0;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Connectors / worm spine
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(tx, ty);
    ctx.lineTo(lx, ly);
    ctx.stroke();

    // 1. Tail Segment
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(tailAngle);
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2. Torso Segment
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(torsoAngle);
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(0, 0, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 3. Head Segment with X_X dead eyes
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(headAngle);

    // Head circle
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(0, 0, 5.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Dead eye Left (X)
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(-3, -2); ctx.lineTo(-1, 0);
    ctx.moveTo(-1, -2); ctx.lineTo(-3, 0);
    ctx.stroke();

    // Dead eye Right (X)
    ctx.beginPath();
    ctx.moveTo(1, -2); ctx.lineTo(3, 0);
    ctx.moveTo(3, -2); ctx.lineTo(1, 0);
    ctx.stroke();

    ctx.restore();
    ctx.restore();
  }

  public destroy(world: RAPIER.World) {
    for (const joint of this.joints) {
      try {
        world.removeImpulseJoint(joint, true);
      } catch {
        // ignore
      }
    }
    this.joints = [];

    try { world.removeRigidBody(this.headBody); } catch {}
    try { world.removeRigidBody(this.torsoBody); } catch {}
    try { world.removeRigidBody(this.tailBody); } catch {}
  }
}
