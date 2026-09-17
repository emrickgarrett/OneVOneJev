import {
  ADS_ACCURATE_AT,
  ADS_MOVE_MULT,
  ADS_SPREAD_DEG,
  ADS_TIME_MS,
  BOLT_CYCLE_MS,
  GRAVITY,
  HIPFIRE_SPREAD_DEG,
  JUMP_VELOCITY,
  MAX_LOOK_RATE,
  MOVE_SPEED,
  PLAYER_EYE,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  SPAWN_POINTS,
  SPAWN_PROTECTION_MS,
  TICK_HZ,
  hasLineOfSight,
  resolveCapsule,
  raycastAabb,
  type PlayerInput,
} from "@onevonejev/shared";

const DT = 1 / TICK_HZ;

export interface Fighter {
  id: string;
  name: string;
  kind: "human" | "jev";
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vy: number;
  onGround: boolean;
  adsProgress: number;
  boltCooldown: number;
  alive: boolean;
  spawnProtection: number;
  score: number;
  kills: number;
  deaths: number;
  wantAds: boolean;
  wantFire: boolean;
  wantJump: boolean;
  moveForward: number;
  moveStrafe: number;
  yawDelta: number;
  pitchDelta: number;
}

export interface ShotEvent {
  shooterId: string;
  victimId: string | null;
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
  hit: boolean;
}

export function createFighter(
  id: string,
  name: string,
  kind: "human" | "jev",
  spawnIndex = 0,
): Fighter {
  const sp = SPAWN_POINTS[spawnIndex % SPAWN_POINTS.length]!;
  return {
    id,
    name,
    kind,
    x: sp.position.x,
    y: sp.position.y,
    z: sp.position.z,
    yaw: sp.yaw,
    pitch: 0,
    vy: 0,
    onGround: true,
    adsProgress: 0,
    boltCooldown: 0,
    alive: true,
    spawnProtection: SPAWN_PROTECTION_MS / 1000,
    score: 0,
    kills: 0,
    deaths: 0,
    wantAds: false,
    wantFire: false,
    wantJump: false,
    moveForward: 0,
    moveStrafe: 0,
    yawDelta: 0,
    pitchDelta: 0,
  };
}

export function applyInput(f: Fighter, input: PlayerInput): void {
  // Human locomotion is client-authoritative — trust reported pose.
  f.x = input.x;
  f.y = input.y;
  f.z = input.z;
  f.yaw = input.yaw;
  f.pitch = clamp(input.pitch, -1.4, 1.4);
  f.onGround = input.onGround;
  f.adsProgress = clamp(input.adsProgress, 0, 1);
  f.wantAds = input.ads;
  f.wantFire = input.fire;
  f.yawDelta = 0;
  f.pitchDelta = 0;
  f.moveForward = 0;
  f.moveStrafe = 0;
  f.wantJump = false;
  f.vy = 0;
}

export function applyBotControls(
  f: Fighter,
  ctrl: {
    forward: number;
    strafe: number;
    yawDelta: number;
    pitchDelta: number;
    jump: boolean;
    ads: boolean;
    fire: boolean;
  },
): void {
  f.moveForward = clamp(ctrl.forward, -1, 1);
  f.moveStrafe = clamp(ctrl.strafe, -1, 1);
  // Bot controller outputs rates (rad/s); convert to per-tick deltas.
  f.yawDelta = clamp(ctrl.yawDelta, -MAX_LOOK_RATE, MAX_LOOK_RATE) * DT;
  f.pitchDelta = clamp(ctrl.pitchDelta, -MAX_LOOK_RATE, MAX_LOOK_RATE) * DT;
  f.wantJump = ctrl.jump;
  f.wantAds = ctrl.ads;
  f.wantFire = ctrl.fire;
}

/** Bolt + spawn timers only — used for client-authored humans. */
export function tickHumanTimers(f: Fighter): void {
  if (!f.alive) return;
  if (f.boltCooldown > 0) f.boltCooldown = Math.max(0, f.boltCooldown - DT);
  if (f.spawnProtection > 0) f.spawnProtection = Math.max(0, f.spawnProtection - DT);
}

export function tickFighter(f: Fighter): void {
  if (!f.alive) return;

  f.yaw += f.yawDelta;
  f.pitch = clamp(f.pitch + f.pitchDelta, -1.4, 1.4);
  f.yawDelta = 0;
  f.pitchDelta = 0;

  const adsTarget = f.wantAds ? 1 : 0;
  const adsRate = 1000 / ADS_TIME_MS;
  if (f.adsProgress < adsTarget) f.adsProgress = Math.min(1, f.adsProgress + adsRate * DT);
  else if (f.adsProgress > adsTarget) f.adsProgress = Math.max(0, f.adsProgress - adsRate * DT);

  if (f.boltCooldown > 0) f.boltCooldown = Math.max(0, f.boltCooldown - DT);
  if (f.spawnProtection > 0) f.spawnProtection = Math.max(0, f.spawnProtection - DT);

  const speed = MOVE_SPEED * (f.adsProgress > 0.3 ? ADS_MOVE_MULT : 1);
  const sin = Math.sin(f.yaw);
  const cos = Math.cos(f.yaw);
  // Strafe+: world-right when looking along yaw (fix was inverted).
  const mx = (f.moveForward * cos - f.moveStrafe * sin) * speed;
  const mz = (f.moveForward * sin + f.moveStrafe * cos) * speed;

  if (f.wantJump && f.onGround) {
    f.vy = JUMP_VELOCITY;
    f.onGround = false;
  }
  f.wantJump = false;

  f.vy -= GRAVITY * DT;
  let nx = f.x + mx * DT;
  let ny = f.y + f.vy * DT;
  let nz = f.z + mz * DT;

  const resolved = resolveCapsule(nx, ny, nz);
  if (resolved.onGround && f.vy < 0) f.vy = 0;
  f.x = resolved.x;
  f.y = resolved.y;
  f.z = resolved.z;
  f.onGround = resolved.onGround;
}

export function tryFire(shooter: Fighter, targets: Fighter[]): ShotEvent | null {
  if (!shooter.alive || !shooter.wantFire) return null;
  shooter.wantFire = false;
  if (shooter.boltCooldown > 0) return null;

  const eye = eyePos(shooter);
  const dir = aimDir(shooter);
  const spreadDeg =
    shooter.adsProgress >= ADS_ACCURATE_AT
      ? ADS_SPREAD_DEG * (1 - (shooter.adsProgress - ADS_ACCURATE_AT) / (1 - ADS_ACCURATE_AT + 1e-6))
      : HIPFIRE_SPREAD_DEG * (1 - shooter.adsProgress * 0.7);

  const spread = (spreadDeg * Math.PI) / 180;
  const rx = (Math.random() - 0.5) * 2 * spread;
  const ry = (Math.random() - 0.5) * 2 * spread;
  // Apply small angular noise in local aim space
  const noisy = rotatePitchYaw(dir, ry, rx);

  shooter.boltCooldown = BOLT_CYCLE_MS / 1000;

  const maxDist = 200;
  const wallHit = raycastAabb(eye.x, eye.y, eye.z, noisy.x, noisy.y, noisy.z, maxDist);

  let best: { id: string; t: number } | null = null;
  for (const t of targets) {
    if (t.id === shooter.id || !t.alive || t.spawnProtection > 0) continue;
    const hit = rayVsCapsule(eye.x, eye.y, eye.z, noisy.x, noisy.y, noisy.z, t, maxDist);
    if (hit === null) continue;
    if (wallHit !== null && hit > wallHit) continue;
    if (!best || hit < best.t) best = { id: t.id, t: hit };
  }

  return {
    shooterId: shooter.id,
    victimId: best?.id ?? null,
    ox: eye.x,
    oy: eye.y,
    oz: eye.z,
    dx: noisy.x,
    dy: noisy.y,
    dz: noisy.z,
    hit: best !== null,
  };
}

export function eyePos(f: Fighter): { x: number; y: number; z: number } {
  return { x: f.x, y: f.y + PLAYER_EYE, z: f.z };
}

export function aimDir(f: Fighter): { x: number; y: number; z: number } {
  const cp = Math.cos(f.pitch);
  return {
    x: Math.cos(f.yaw) * cp,
    y: Math.sin(f.pitch),
    z: Math.sin(f.yaw) * cp,
  };
}

export function pickSafeSpawn(enemy: Fighter | null): (typeof SPAWN_POINTS)[number] {
  let best = SPAWN_POINTS[0]!;
  let bestScore = -Infinity;
  for (const sp of SPAWN_POINTS) {
    let score = Math.random() * 5;
    if (enemy && enemy.alive) {
      const dist = Math.hypot(sp.position.x - enemy.x, sp.position.z - enemy.z);
      score += dist;
      const los = hasLineOfSight(
        sp.position.x,
        sp.position.y + PLAYER_EYE,
        sp.position.z,
        enemy.x,
        enemy.y + PLAYER_EYE,
        enemy.z,
      );
      if (los) score -= 40;
      if (dist < 12) score -= 30;
    }
    if (score > bestScore) {
      bestScore = score;
      best = sp;
    }
  }
  return best;
}

export function respawn(f: Fighter, enemy: Fighter | null): void {
  const sp = pickSafeSpawn(enemy);
  f.x = sp.position.x;
  f.y = sp.position.y;
  f.z = sp.position.z;
  f.yaw = sp.yaw;
  f.pitch = 0;
  f.vy = 0;
  f.alive = true;
  f.adsProgress = 0;
  f.boltCooldown = 0;
  f.spawnProtection = SPAWN_PROTECTION_MS / 1000;
  f.wantFire = false;
  f.wantAds = false;
}

function rayVsCapsule(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  t: Fighter,
  maxDist: number,
): number | null {
  // Approximate player as vertical capsule with radius
  const steps = 24;
  let best: number | null = null;
  for (let i = 0; i <= steps; i++) {
    const yy = t.y + (PLAYER_HEIGHT * i) / steps;
    // Solve closest approach of ray to point (tx,yy,tz)
    const fx = t.x - ox;
    const fy = yy - oy;
    const fz = t.z - oz;
    const tParam = fx * dx + fy * dy + fz * dz;
    if (tParam < 0 || tParam > maxDist) continue;
    const cx = ox + dx * tParam - t.x;
    const cy = oy + dy * tParam - yy;
    const cz = oz + dz * tParam - t.z;
    if (cx * cx + cy * cy + cz * cz <= PLAYER_RADIUS * PLAYER_RADIUS * 1.15) {
      if (best === null || tParam < best) best = tParam;
    }
  }
  return best;
}

function rotatePitchYaw(
  d: { x: number; y: number; z: number },
  pitch: number,
  yaw: number,
): { x: number; y: number; z: number } {
  // yaw around Y, pitch around local X — approximate small-angle
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  let x = d.x * cy + d.z * sy;
  let z = -d.x * sy + d.z * cy;
  let y = d.y;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const y2 = y * cp - z * sp;
  z = y * sp + z * cp;
  y = y2;
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

export { hasLineOfSight };
