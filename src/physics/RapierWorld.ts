import RAPIER from '@dimforge/rapier2d-compat';
import { CONFIG } from '../config';
import { Terrain } from '../engine/Terrain';

// Scale factor: 20 pixels = 1 meter
export const PHYSICS_SCALE = 20;

export function pxToM(px: number): number {
  return px / PHYSICS_SCALE;
}

export function mToPx(m: number): number {
  return m * PHYSICS_SCALE;
}

export interface DynamicEntityAABB {
  x: number; // in pixels
  y: number; // in pixels
  radius?: number; // query radius in pixels (default 25)
}

let rapierInitialized = false;

export async function initRapierPhysics(): Promise<typeof RAPIER> {
  if (!rapierInitialized) {
    await RAPIER.init();
    rapierInitialized = true;
  }
  return RAPIER;
}

export class RapierWorld {
  public rapier: typeof RAPIER;
  public world: RAPIER.World;
  private activeTerrainColliders: Map<string, RAPIER.Collider> = new Map();
  private static readonly CELL_SIZE = 10; // 10x10 px blocks
  private static readonly HALF_CELL_M = (RapierWorld.CELL_SIZE / 2) / PHYSICS_SCALE;

  constructor(rapier: typeof RAPIER, gravityScale: number = 1.0) {
    this.rapier = rapier;
    // Standard 2D gravity in m/s^2, directed downward (+Y in screen space)
    const gravityY = 16.0 * gravityScale;
    this.world = new rapier.World({ x: 0.0, y: gravityY });
  }

  public setGravity(gravityScale: number) {
    this.world.gravity = { x: 0.0, y: 16.0 * gravityScale };
  }

  /**
   * Synchronise les parois du terrain en pixels avec les boîtes englobantes
   * de toutes les entités dynamiques (vers, nœuds de grappin, ragdolls).
   * Seules les cellules occupées par des parois solides proches sont matérialisées
   * sous forme de colliders statiques dans Rapier.
   */
  public syncTerrainColliders(terrain: Terrain, entities: DynamicEntityAABB[]) {
    const cellSize = RapierWorld.CELL_SIZE;
    const neededKeys = new Set<string>();

    for (const ent of entities) {
      const r = ent.radius ?? 28;
      const minGx = Math.max(0, Math.floor((ent.x - r) / cellSize));
      const maxGx = Math.min(Math.floor(terrain.width / cellSize) - 1, Math.floor((ent.x + r) / cellSize));
      const minGy = Math.max(0, Math.floor((ent.y - r) / cellSize));
      const maxGy = Math.min(Math.floor(terrain.height / cellSize) - 1, Math.floor((ent.y + r) / cellSize));

      for (let gy = minGy; gy <= maxGy; gy++) {
        for (let gx = minGx; gx <= maxGx; gx++) {
          const key = `${gx},${gy}`;
          neededKeys.add(key);

          if (!this.activeTerrainColliders.has(key)) {
            // Test if this cell contains solid terrain (sample center and corners)
            const cx = gx * cellSize + cellSize / 2;
            const cy = gy * cellSize + cellSize / 2;
            const isSolid =
              terrain.isSolid(cx, cy) ||
              terrain.isSolid(gx * cellSize + 2, gy * cellSize + 2) ||
              terrain.isSolid(gx * cellSize + cellSize - 2, gy * cellSize + cellSize - 2) ||
              terrain.isSolid(gx * cellSize + 2, gy * cellSize + cellSize - 2) ||
              terrain.isSolid(gx * cellSize + cellSize - 2, gy * cellSize + 2);

            if (isSolid) {
              const hx = RapierWorld.HALF_CELL_M;
              const hy = RapierWorld.HALF_CELL_M;
              const posX = pxToM(cx);
              const posY = pxToM(cy);

              const colDesc = this.rapier.ColliderDesc.cuboid(hx, hy)
                .setTranslation(posX, posY)
                .setFriction(0.65)
                .setRestitution(0.1);

              const collider = this.world.createCollider(colDesc);
              this.activeTerrainColliders.set(key, collider);
            }
          }
        }
      }
    }

    // Retirer les colliders des cellules qui ne sont plus dans les boîtes englobantes
    for (const [key, collider] of this.activeTerrainColliders.entries()) {
      if (!neededKeys.has(key)) {
        try {
          this.world.removeCollider(collider, false);
        } catch {
          // collider might already be removed
        }
        this.activeTerrainColliders.delete(key);
      }
    }
  }

  /**
   * Appelé lorsqu'une explosion creuse un cratère dans le terrain pour
   * invalider immédiatement les colliders statiques dans la zone du cratère.
   */
  public invalidateCrater(cx: number, cy: number, radius: number) {
    const cellSize = RapierWorld.CELL_SIZE;
    const minGx = Math.max(0, Math.floor((cx - radius - cellSize) / cellSize));
    const maxGx = Math.floor((cx + radius + cellSize) / cellSize);
    const minGy = Math.max(0, Math.floor((cy - radius - cellSize) / cellSize));
    const maxGy = Math.floor((cy + radius + cellSize) / cellSize);

    for (let gy = minGy; gy <= maxGy; gy++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        const key = `${gx},${gy}`;
        const collider = this.activeTerrainColliders.get(key);
        if (collider) {
          try {
            this.world.removeCollider(collider, false);
          } catch {
            // already removed
          }
          this.activeTerrainColliders.delete(key);
        }
      }
    }
  }

  /**
   * Applique une impulsion physique radiale sur tous les corps rigides dynamiques
   * situés dans le rayon de l'explosion.
   */
  public applyExplosionImpulse(
    cx: number,
    cy: number,
    radius: number,
    maxImpulse: number = 3.5
  ) {
    const centerM = { x: pxToM(cx), y: pxToM(cy) };
    const radiusM = pxToM(radius);

    this.world.forEachRigidBody((body) => {
      if (!body.isDynamic()) return;
      const pos = body.translation();
      const dx = pos.x - centerM.x;
      const dy = pos.y - centerM.y;
      const dist = Math.hypot(dx, dy);

      if (dist < radiusM && dist > 0.001) {
        const force = (1 - dist / radiusM) * maxImpulse;
        const impulse = {
          x: (dx / dist) * force,
          y: (dy / dist) * force - 0.4 // Légère poussée vers le haut
        };
        body.applyImpulse(impulse, true);
      }
    });
  }

  /** Avance la simulation physique de dt (par défaut 1/60s) */
  public step() {
    this.world.step();
  }

  /** Nettoie toutes les ressources de la simulation */
  public destroy() {
    for (const collider of this.activeTerrainColliders.values()) {
      try {
        this.world.removeCollider(collider, false);
      } catch {
        // ignore
      }
    }
    this.activeTerrainColliders.clear();
    this.world.free();
  }
}
