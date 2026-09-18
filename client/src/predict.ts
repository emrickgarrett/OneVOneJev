import {
  ADS_MOVE_MULT,
  ADS_TIME_MS,
  BOLT_CYCLE_MS,
  GRAVITY,
  JUMP_VELOCITY,
  MOVE_SPEED,
  PLAYER_EYE,
  resolveCapsule,
  type EntityState,
  type PlayerInput,
} from "@onevonejev/shared";

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

export interface MoveIntent {
  forward: number;
  strafe: number;
  jump: boolean;
  ads: boolean;
  fire: boolean;
}

/**
 * Fully local human controller — movement/look never wait on the server.
 * Pose is pushed upstream for hitscan / spectators only.
 */
export class LocalPlayer {
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
  private seq = 0;

  applyLook(yawDelta: number, pitchDelta: number): void {
    if (!this.alive) return;
    this.yaw += yawDelta;
    this.pitch = clamp(this.pitch + pitchDelta, -1.4, 1.4);
  }

  /** Frame-rate locomotion. */
  step(dt: number, intent: MoveIntent): void {
    if (!this.alive) return;
    const step = Math.min(0.05, Math.max(0, dt));

    const adsTarget = intent.ads ? 1 : 0;
    const adsRate = 1000 / ADS_TIME_MS;
    if (this.adsProgress < adsTarget) {
      this.adsProgress = Math.min(1, this.adsProgress + adsRate * step);
    } else if (this.adsProgress > adsTarget) {
      this.adsProgress = Math.max(0, this.adsProgress - adsRate * step);
    }

    if (this.boltCooldown > 0) this.boltCooldown = Math.max(0, this.boltCooldown - step);

    const speed = MOVE_SPEED * (this.adsProgress > 0.3 ? ADS_MOVE_MULT : 1);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const forward = clamp(intent.forward, -1, 1);
    const strafe = clamp(intent.strafe, -1, 1);
    const mx = (forward * cos - strafe * sin) * speed;
    const mz = (forward * sin + strafe * cos) * speed;

    if (intent.jump && this.onGround) {
      this.vy = JUMP_VELOCITY;
      this.onGround = false;
    }

    this.vy -= GRAVITY * step;
    const resolved = resolveCapsule(
      this.x + mx * step,
      this.y + this.vy * step,
      this.z + mz * step,
    );
    if (resolved.onGround && this.vy < 0) this.vy = 0;
    this.x = resolved.x;
    this.y = resolved.y;
    this.z = resolved.z;
    this.onGround = resolved.onGround;
  }

  /** Only sync match-critical fields; never overwrite live pose. */
  syncMatchState(server: EntityState): void {
    const respawned = server.alive && !this.wasAlive;
    if (!this.seeded || respawned) {
      this.hardSync(server);
      this.seeded = true;
      this.wasAlive = server.alive;
      return;
    }

    this.alive = server.alive;
    this.wasAlive = server.alive;
    // Keep optimistic local bolt; never snap back to 0 before the server sees the shot.
    this.boltCooldown = Math.max(this.boltCooldown, server.boltCooldown);
    if (!server.alive) {
      this.adsProgress = 0;
    }
  }

  /** Optimistic bolt + aim ray for immediate muzzle feedback (hit still server-side). */
  predictFire(): { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number } | null {
    if (!this.alive || this.boltCooldown > 0) return null;
    this.boltCooldown = BOLT_CYCLE_MS / 1000;
    const cp = Math.cos(this.pitch);
    return {
      ox: this.x,
      oy: this.y + PLAYER_EYE,
      oz: this.z,
      dx: Math.cos(this.yaw) * cp,
      dy: Math.sin(this.pitch),
      dz: Math.sin(this.yaw) * cp,
    };
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

  toInput(intent: MoveIntent): PlayerInput {
    return {
      seq: ++this.seq,
      x: this.x,
      y: this.y,
      z: this.z,
      yaw: this.yaw,
      pitch: this.pitch,
      onGround: this.onGround,
      ads: intent.ads,
      adsProgress: this.adsProgress,
      fire: intent.fire,
    };
  }

  reset(): void {
    this.seeded = false;
    this.alive = false;
    this.wasAlive = false;
  }
}
