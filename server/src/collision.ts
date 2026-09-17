import type { Aabb } from "@onevonejev/shared";
import { MAP_BOXES, MAP_BOUNDS, PLAYER_HEIGHT, PLAYER_RADIUS } from "@onevonejev/shared";

export function resolveCapsule(
  x: number,
  y: number,
  z: number,
  boxes: Aabb[] = MAP_BOXES,
): { x: number; y: number; z: number; onGround: boolean } {
  let px = Math.max(MAP_BOUNDS.minX + PLAYER_RADIUS, Math.min(MAP_BOUNDS.maxX - PLAYER_RADIUS, x));
  let py = Math.max(0, y);
  let pz = Math.max(MAP_BOUNDS.minZ + PLAYER_RADIUS, Math.min(MAP_BOUNDS.maxZ - PLAYER_RADIUS, z));
  let onGround = py <= 0.001;

  for (let iter = 0; iter < 4; iter++) {
    for (const b of boxes) {
      const nearestX = Math.max(b.minX, Math.min(px, b.maxX));
      const nearestZ = Math.max(b.minZ, Math.min(pz, b.maxZ));
      const dx = px - nearestX;
      const dz = pz - nearestZ;
      const distSq = dx * dx + dz * dz;

      const feet = py;
      const head = py + PLAYER_HEIGHT;
      const overlapsY = head > b.minY && feet < b.maxY;

      if (!overlapsY) {
        // Standing on top
        if (
          feet >= b.maxY - 0.35 &&
          feet <= b.maxY + 0.15 &&
          px >= b.minX - PLAYER_RADIUS &&
          px <= b.maxX + PLAYER_RADIUS &&
          pz >= b.minZ - PLAYER_RADIUS &&
          pz <= b.maxZ + PLAYER_RADIUS
        ) {
          py = b.maxY;
          onGround = true;
        }
        continue;
      }

      if (distSq < PLAYER_RADIUS * PLAYER_RADIUS && distSq > 0) {
        const dist = Math.sqrt(distSq);
        const push = PLAYER_RADIUS - dist;
        px += (dx / dist) * push;
        pz += (dz / dist) * push;
      } else if (distSq === 0 && overlapsY) {
        // Inside box horizontally — push out shortest axis
        const left = Math.abs(px - b.minX);
        const right = Math.abs(b.maxX - px);
        const back = Math.abs(pz - b.minZ);
        const front = Math.abs(b.maxZ - pz);
        const m = Math.min(left, right, back, front);
        if (m === left) px = b.minX - PLAYER_RADIUS;
        else if (m === right) px = b.maxX + PLAYER_RADIUS;
        else if (m === back) pz = b.minZ - PLAYER_RADIUS;
        else pz = b.maxZ + PLAYER_RADIUS;
      }
    }
  }

  if (py <= 0.001) {
    py = 0;
    onGround = true;
  }

  return { x: px, y: py, z: pz, onGround };
}

/** Segment vs AABB for hitscan / LOS. Returns hit distance or null. */
export function raycastAabb(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  boxes: Aabb[] = MAP_BOXES,
): number | null {
  let closest: number | null = null;
  for (const b of boxes) {
    const t = rayAabb(ox, oy, oz, dx, dy, dz, b);
    if (t !== null && t >= 0 && t <= maxDist) {
      if (closest === null || t < closest) closest = t;
    }
  }
  return closest;
}

function rayAabb(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  b: Aabb,
): number | null {
  const invX = 1 / (dx || 1e-12);
  const invY = 1 / (dy || 1e-12);
  const invZ = 1 / (dz || 1e-12);

  let t1 = (b.minX - ox) * invX;
  let t2 = (b.maxX - ox) * invX;
  let t3 = (b.minY - oy) * invY;
  let t4 = (b.maxY - oy) * invY;
  let t5 = (b.minZ - oz) * invZ;
  let t6 = (b.maxZ - oz) * invZ;

  const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4), Math.min(t5, t6));
  const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4), Math.max(t5, t6));
  if (tmax < 0 || tmin > tmax) return null;
  return tmin >= 0 ? tmin : tmax;
}

export function hasLineOfSight(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.01) return true;
  const hit = raycastAabb(ax, ay, az, dx / dist, dy / dist, dz / dist, dist - 0.4);
  return hit === null;
}
