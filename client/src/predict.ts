import {
  ADS_MOVE_MULT,
  ADS_TIME_MS,
  GRAVITY,
  INPUT_HZ,
  JUMP_VELOCITY,
  MAX_LOOK_DELTA,
  MOVE_SPEED,
  resolveCapsule,
  type EntityState,
  type PlayerInput,
} from "@onevonejev/shared";

const STEP = 1 / INPUT_HZ;

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Client-side predicted local player. Look is applied immediately (frame-rate);
 * locomotion mirrors server physics and soft-reconciles against snapshots.
 */
export class PredictedPlayer {
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  pitch = 0;
  vy = 0;
  onGround = true;
  adsProgress = 0;
  boltCooldown = 0;
  alive = false;
  private seeded = false;
  private wasAlive = false;

  /** Instant mouse look — never waits on the server. */
  applyLook(yawDelta: number, pitchDelta: number): void {
    if (!this.alive) return;
    this.yaw += clamp(yawDelta, -MAX_LOOK_DELTA * 4, MAX_LOOK_DELTA * 4);
    this.pitch = clamp(this.pitch + pitchDelta, -1.4, 1.4);
  }

  /** One physics step matching server `tickFighter` for a sampled input. */
  applyInput(input: PlayerInput): void {
    if (!this.alive) return;

    // Look was already applied instantly via applyLook — do not double-apply.
    // Server still receives yawDelta/pitchDelta in the packet for hitscan.

    const adsTarget = input.ads ? 1 : 0;
    const adsRate = 1000 / ADS_TIME_MS;
    if (this.adsProgress < adsTarget) {
      this.adsProgress = Math.min(1, this.adsProgress + adsRate * STEP);
    } else if (this.adsProgress > adsTarget) {
      this.adsProgress = Math.max(0, this.adsProgress - adsRate * STEP);
    }

    if (this.boltCooldown > 0) this.boltCooldown = Math.max(0, this.boltCooldown - STEP);

    const speed = MOVE_SPEED * (this.adsProgress > 0.3 ? ADS_MOVE_MULT : 1);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const forward = clamp(input.forward, -1, 1);
    const strafe = clamp(input.strafe, -1, 1);
    const mx = (forward * cos - strafe * sin) * speed;
    const mz = (forward * sin + strafe * cos) * speed;

    if (input.jump && this.onGround) {
      this.vy = JUMP_VELOCITY;
      this.onGround = false;
    }

    this.vy -= GRAVITY * STEP;
    const resolved = resolveCapsule(
      this.x + mx * STEP,
      this.y + this.vy * STEP,
      this.z + mz * STEP,
    );
    if (resolved.onGround && this.vy < 0) this.vy = 0;
    this.x = resolved.x;
    this.y = resolved.y;
    this.z = resolved.z;
    this.onGround = resolved.onGround;
  }

  /** Soft-correct from authoritative snapshot without stomping responsive look. */
  reconcile(server: EntityState): void {
    const respawned = server.alive && !this.wasAlive;
    const teleported =
      Math.hypot(server.x - this.x, server.y - this.y, server.z - this.z) > 4.5;

    if (!this.seeded || respawned || teleported || !server.alive) {
      this.hardSync(server);
      this.seeded = true;
      this.wasAlive = server.alive;
      return;
    }

    this.alive = server.alive;
    this.wasAlive = server.alive;
    // Blend position toward server — keeps feel smooth under latency.
    const t = 0.28;
    this.x = lerp(this.x, server.x, t);
    this.y = lerp(this.y, server.y, t);
    this.z = lerp(this.z, server.z, t);
    this.onGround = server.onGround;
    this.adsProgress = lerp(this.adsProgress, server.adsProgress, 0.45);
    this.boltCooldown = server.boltCooldown;
    // Look stays client-owned while playing (server still gets deltas for hitscan).
  }

  hardSync(server: EntityState): void {
    this.x = server.x;
    this.y = server.y;
    this.z = server.z;
    this.yaw = server.yaw;
    this.pitch = server.pitch;
    this.vy = 0;
    this.onGround = server.onGround;
    this.adsProgress = server.adsProgress;
    this.boltCooldown = server.boltCooldown;
    this.alive = server.alive;
    this.wasAlive = server.alive;
  }

  reset(): void {
    this.seeded = false;
    this.alive = false;
    this.wasAlive = false;
  }
}
