import {
  COVER_POINTS,
  JEV_DECISION_HZ,
  PLAYER_EYE,
  type MatchPhase,
} from "@onevonejev/shared";
import { choice, noul, TypeSafeClient, type EntryType } from "@typesafe-ai/sdk";
import { eyePos, hasLineOfSight, type Fighter } from "./fighter.js";

export interface BotAction {
  forward: number;
  strafe: number;
  yawDelta: number;
  pitchDelta: number;
  jump: boolean;
  ads: boolean;
  fire: boolean;
}

const EMPTY: BotAction = {
  forward: 0,
  strafe: 0,
  yawDelta: 0,
  pitchDelta: 0,
  jump: false,
  ads: false,
  fire: false,
};

/** ~2° yaw / ~2.3° pitch — hitscan must be on the body, not leading it. */
const FIRE_YAW_ERR = 0.036;
const FIRE_PITCH_ERR = 0.04;
/** Force a relocate if Jev barely moves for this long while alive. */
const CAMP_MS = 2200;
const CAMP_MOVE_DIST = 1.35;

export class JevController {
  private client: TypeSafeClient | null = null;
  private lastAction: BotAction = { ...EMPTY };
  private inFlight = false;
  private lastDecisionAt = 0;
  private targetCover: { x: number; z: number } | null = null;
  private enabled: boolean;
  /** Sticky "take the shot" until on-target or timeout. */
  private shotIntentUntil = 0;
  private activeEpoch = -1;
  private lastPos = { x: 0, z: 0 };
  private lastMovedAt = 0;
  private forceRelocateUntil = 0;
  private strafeSign = 1;

  constructor(apiKey: string | undefined) {
    this.enabled = Boolean(apiKey);
    if (apiKey) {
      process.env.TYPESAFE_API_KEY = apiKey;
      try {
        this.client = new TypeSafeClient({ apiKey });
      } catch (e) {
        console.warn("[jev] TypeSafe client init failed, using heuristic:", e);
        this.client = null;
        this.enabled = false;
      }
    } else {
      console.warn("[jev] No TYPESAFE_API_KEY — heuristic bot only");
    }
  }

  /** Clear control state and invalidate in-flight API commits. */
  reset(): void {
    this.lastAction = { ...EMPTY };
    this.shotIntentUntil = 0;
    this.activeEpoch = -1;
    this.lastMovedAt = 0;
    this.forceRelocateUntil = 0;
    this.targetCover = null;
    // Leave inFlight as-is; commitDecision checks epoch and drops stale results.
  }

  /**
   * Per-sim-tick aim refinement. Decision loop is ~9Hz; without this, old turn
   * rates keep spinning past a strafing player and shots land ahead.
   */
  getAction(self: Fighter, enemy: Fighter | null, now: number): BotAction {
    this.noteMovement(self, now);

    const a = { ...this.lastAction };
    if (!enemy?.alive || !self.alive) {
      a.fire = false;
      return a;
    }

    const err = aimErrors(self, enemy);
    const shooting = now < this.shotIntentUntil || a.fire;
    const onTarget =
      Math.abs(err.yaw) <= FIRE_YAW_ERR && Math.abs(err.pitch) <= FIRE_PITCH_ERR;

    // Track toward enemy when roughly facing them or taking a shot — do not
    // freeze locomotion just because yaw error is small.
    if (shooting || a.ads || Math.abs(err.yaw) < 0.85) {
      a.yawDelta = dampTrack(err.yaw, shooting ? 18 : 14);
      a.pitchDelta = dampTrack(err.pitch, shooting ? 18 : 14);
    }

    if (shooting) {
      a.ads = true;
      if (onTarget && self.adsProgress >= 0.65 && self.boltCooldown <= 0) {
        a.fire = true;
        this.shotIntentUntil = 0;
        // Plant only for the actual trigger pull.
        a.forward = 0;
        a.strafe = 0;
      } else {
        a.fire = false;
        // Keep a light peek-strafe while lining up — no hard plant.
        if (Math.abs(a.forward) + Math.abs(a.strafe) < 0.15) {
          a.strafe = this.strafeSign * 0.55;
          a.forward = 0.2;
        } else {
          a.forward *= 0.55;
          a.strafe *= 0.7;
        }
      }
    } else {
      a.fire = false;
      // Drop sticky ADS after a miss/bolt so Jev repositions instead of camping.
      if (self.boltCooldown > 0.35) a.ads = false;
    }

    if (now < this.forceRelocateUntil) {
      a.ads = false;
      a.fire = false;
      const cover = this.targetCover ?? pickFlankCover(self, enemy);
      this.targetCover = cover;
      ({ forward: a.forward, strafe: a.strafe } = moveToward(self, cover.x, cover.z));
      a.forward = Math.max(0.55, Math.abs(a.forward)) * Math.sign(a.forward || 1);
    }

    return a;
  }

  tick(
    now: number,
    self: Fighter,
    enemy: Fighter | null,
    phase: MatchPhase,
    scoreHuman: number,
    scoreJev: number,
    epoch: number,
  ): void {
    // Hard gate: no decisions / API spend outside a live duel where Jev can act.
    if (phase !== "playing" || !self.alive || !enemy?.alive) {
      this.lastAction = { ...EMPTY };
      this.shotIntentUntil = 0;
      return;
    }

    this.activeEpoch = epoch;
    this.noteMovement(self, now);

    if (this.lastMovedAt === 0) {
      this.lastMovedAt = now;
      this.lastPos = { x: self.x, z: self.z };
    } else if (now - this.lastMovedAt > CAMP_MS && now >= this.forceRelocateUntil) {
      this.forceRelocateUntil = now + 1400;
      this.strafeSign *= -1;
      this.targetCover = pickFlankCover(self, enemy);
      console.log("[jev] anti-camp relocate");
    }

    const interval = 1000 / JEV_DECISION_HZ;
    if (now - this.lastDecisionAt < interval) return;
    if (this.inFlight) return;

    this.lastDecisionAt = now;
    const camping = now < this.forceRelocateUntil || now - this.lastMovedAt > CAMP_MS * 0.7;
    const state = buildState(self, enemy, scoreHuman, scoreJev, this.targetCover, camping);
    const requestEpoch = epoch;

    if (this.client && this.enabled) {
      this.inFlight = true;
      void this.askJev(state, self, enemy)
        .then((action) => {
          this.commitDecision(action, now, requestEpoch);
        })
        .catch((err) => {
          console.warn("[jev] API error, heuristic fallback:", err?.message ?? err);
          this.commitDecision(heuristic(self, enemy, scoreHuman, scoreJev, this), now, requestEpoch);
        })
        .finally(() => {
          this.inFlight = false;
        });
    } else {
      this.commitDecision(heuristic(self, enemy, scoreHuman, scoreJev, this), now, requestEpoch);
    }
  }

  private noteMovement(self: Fighter, now: number): void {
    const dist = Math.hypot(self.x - this.lastPos.x, self.z - this.lastPos.z);
    if (dist >= CAMP_MOVE_DIST) {
      this.lastPos = { x: self.x, z: self.z };
      this.lastMovedAt = now;
    }
  }

  private commitDecision(action: BotAction, now: number, epoch: number): void {
    if (epoch !== this.activeEpoch) return;

    // Never accept a pure plant while anti-camp is active.
    if (now < this.forceRelocateUntil) {
      action.ads = false;
      action.fire = false;
      if (Math.abs(action.forward) + Math.abs(action.strafe) < 0.4) {
        action.forward = 0.9;
        action.strafe = this.strafeSign * 0.6;
      }
    }

    // Convert idle "hold" outcomes into a peek-strafe so Jev doesn't freeze.
    if (Math.abs(action.forward) + Math.abs(action.strafe) < 0.12 && !action.fire) {
      this.strafeSign *= -1;
      action.strafe = this.strafeSign * (0.55 + Math.random() * 0.35);
      action.forward = 0.35 + Math.random() * 0.35;
      action.ads = false;
    }

    this.lastAction = action;
    if (action.fire) {
      // Hold shot intent briefly while per-tick tracking catches up — no lead.
      this.shotIntentUntil = now + 450;
      this.lastAction.fire = false;
      this.lastAction.ads = true;
    }
  }

  private async askJev(
    state: Record<string, unknown>,
    self: Fighter,
    enemy: Fighter | null,
  ): Promise<BotAction> {
    if (!this.client) return heuristic(self, enemy, 0, 0, this);

    const response = await this.client.systemOne({
      model: "jev-latest",
      state: state as EntryType,
      questions: {
        move: choice(
          "As an aggressive MW2 quickscoper on Rust, pick locomotion. Prefer movement — do NOT camp or stand still.",
          {
            forward: "Push toward the enemy or peek lane",
            back: "Retreat / create distance while still strafing",
            strafe_left: "Strafe left while peeking",
            strafe_right: "Strafe right while peeking",
            seek_cover: "Break LOS and relocate to a new angle",
            push: "Aggressive rush / close distance hard",
          },
        ),
        yaw: choice(
          "Horizontal aim. Hitscan — aim at the enemy's CURRENT bearing only, never lead a strafe.",
          {
            hard_left: "Large left turn",
            left: "Moderate left",
            slight_left: "Small left correction",
            hold: "Keep current yaw",
            slight_right: "Small right correction",
            right: "Moderate right",
            hard_right: "Large right turn",
            track_enemy: "Turn toward current enemy bearing (no lead)",
          },
        ),
        pitch: choice("Vertical aim toward the enemy's current height?", {
          up: "Look up",
          level: "Track enemy height",
          down: "Look down",
        }),
        ads: noul("ADS only for a brief quickscope — prefer hip/reposition if not about to shoot.", {
          true: "Enemy is engageable — short ADS window",
          false: "Keep hip / sprint / reposition",
        }),
        fire: noul(
          "Fire only if the crosshair is already on the enemy's current body (hitscan, do not lead).",
          {
            true: "On target now — take the shot",
            false: "Not centered — do not fire",
          },
        ),
        jump: noul("Jump-peek or jump-shot this beat?", {
          true: "Jump for peeker advantage",
          false: "Stay grounded",
        }),
      },
    });

    void self;
    const answers = response.answers as Record<string, any>;
    return composeAction(answers, self, enemy, this);
  }

  setCover(c: { x: number; z: number } | null) {
    this.targetCover = c;
  }

  getStrafeSign(): number {
    return this.strafeSign;
  }

  flipStrafe(): void {
    this.strafeSign *= -1;
  }
}

function buildState(
  self: Fighter,
  enemy: Fighter | null,
  scoreHuman: number,
  scoreJev: number,
  cover: { x: number; z: number } | null,
  camping: boolean,
) {
  const eye = eyePos(self);
  let enemyState: Record<string, unknown> = { known: false };
  if (enemy && enemy.alive) {
    const err = aimErrors(self, enemy);
    const dist = Math.hypot(enemy.x - self.x, enemy.z - self.z);
    const bearing = Math.atan2(enemy.z - self.z, enemy.x - self.x);
    const visible = hasLineOfSight(
      eye.x,
      eye.y,
      eye.z,
      enemy.x,
      enemy.y + PLAYER_EYE,
      enemy.z,
    );
    enemyState = {
      known: true,
      distance: Number(dist.toFixed(2)),
      bearing_deg: Number(((bearing * 180) / Math.PI).toFixed(1)),
      yaw_error_deg: Number(((err.yaw * 180) / Math.PI).toFixed(1)),
      pitch_error_deg: Number(((err.pitch * 180) / Math.PI).toFixed(1)),
      visible,
      enemy_ads: Number(enemy.adsProgress.toFixed(2)),
      enemy_can_fire: enemy.boltCooldown <= 0,
      height_delta: Number((enemy.y - self.y).toFixed(2)),
      note: "Weapon is hitscan. Aim at current position. Do not lead strafes.",
    };
  }

  const nearestCover = COVER_POINTS.map((c) => ({
    id: c.id,
    dist: Math.hypot(c.x - self.x, c.z - self.z),
  })).sort((a, b) => a.dist - b.dist)[0];

  return {
    instruction:
      "You are Jev, an aggressive MW2-style quickscoper on a Rust-like map. NEVER camp or stand still — always strafe, peek, or relocate between shots. Weapon is HITSCAN: aim at the enemy's current position only — never lead left/right strafes. First to 5 kills.",
    self: {
      x: Number(self.x.toFixed(2)),
      y: Number(self.y.toFixed(2)),
      z: Number(self.z.toFixed(2)),
      yaw_deg: Number(((self.yaw * 180) / Math.PI).toFixed(1)),
      pitch_deg: Number(((self.pitch * 180) / Math.PI).toFixed(1)),
      ads_progress: Number(self.adsProgress.toFixed(2)),
      can_fire: self.boltCooldown <= 0,
      bolt_cooldown: Number(self.boltCooldown.toFixed(2)),
      on_ground: self.onGround,
      spawn_protection: self.spawnProtection > 0,
      score: self.score,
      must_relocate: camping,
    },
    enemy: enemyState,
    map: {
      nearest_cover: nearestCover,
      target_cover: cover,
      open_lanes: ["north_south_mid", "east_west_mid", "tower_ring"],
    },
    match: {
      score_human: scoreHuman,
      score_jev: scoreJev,
      need_aggression: scoreJev <= scoreHuman,
      behind: scoreJev < scoreHuman,
    },
  };
}

function composeAction(
  answers: Record<string, any>,
  self: Fighter,
  enemy: Fighter | null,
  ctrl: JevController,
): BotAction {
  const move = answers.move?.choice ?? "strafe_right";
  const yawChoice = answers.yaw?.choice ?? "track_enemy";
  const pitchChoice = answers.pitch?.choice ?? "level";
  const ads = (answers.ads?.noul ?? 0) > 0.62;
  const fire = (answers.fire?.noul ?? 0) > 0.62;
  const jump = (answers.jump?.noul ?? 0) > 0.7;

  let forward = 0;
  let strafe = 0;
  switch (move) {
    case "forward":
    case "push":
      forward = move === "push" ? 1 : 0.85;
      strafe = ctrl.getStrafeSign() * 0.35;
      break;
    case "back":
      forward = -0.7;
      strafe = ctrl.getStrafeSign() * 0.45;
      break;
    case "strafe_left":
      strafe = -1;
      forward = 0.35;
      break;
    case "strafe_right":
      strafe = 1;
      forward = 0.35;
      break;
    case "hold":
      // Legacy / unexpected hold — convert to peek strafe.
      strafe = ctrl.getStrafeSign() * 0.7;
      forward = 0.3;
      break;
    case "seek_cover": {
      const cover = pickFlankCover(self, enemy);
      ctrl.setCover(cover);
      ({ forward, strafe } = moveToward(self, cover.x, cover.z));
      break;
    }
    default:
      strafe = ctrl.getStrafeSign() * 0.6;
      forward = 0.4;
      break;
  }

  let yawDelta = 0;
  const yawMap: Record<string, number> = {
    hard_left: -8,
    left: -4,
    slight_left: -1.5,
    hold: 0,
    slight_right: 1.5,
    right: 4,
    hard_right: 8,
  };
  if (enemy?.alive && (yawChoice === "track_enemy" || ads || fire)) {
    yawDelta = dampTrack(aimErrors(self, enemy).yaw);
  } else {
    yawDelta = yawMap[yawChoice] ?? 0;
  }

  let pitchDelta = 0;
  if (enemy?.alive) {
    const err = aimErrors(self, enemy);
    pitchDelta = dampTrack(err.pitch);
    if (pitchChoice === "up") pitchDelta = Math.max(pitchDelta, 3);
    else if (pitchChoice === "down") pitchDelta = Math.min(pitchDelta, -3);
  } else if (pitchChoice === "up") pitchDelta = 5;
  else if (pitchChoice === "down") pitchDelta = -5;
  else pitchDelta = clamp(-self.pitch * 6, -4, 4);

  return {
    forward,
    strafe,
    yawDelta,
    pitchDelta,
    jump,
    ads: ads || fire,
    fire: fire && self.adsProgress >= 0.55,
  };
}

function heuristic(
  self: Fighter,
  enemy: Fighter | null,
  scoreHuman: number,
  scoreJev: number,
  ctrl: JevController,
): BotAction {
  if (!enemy || !enemy.alive) {
    return { ...EMPTY, forward: 0.55, strafe: Math.sin(Date.now() / 500) * 0.7 };
  }

  const eye = eyePos(self);
  const visible = hasLineOfSight(
    eye.x,
    eye.y,
    eye.z,
    enemy.x,
    enemy.y + PLAYER_EYE,
    enemy.z,
  );
  const dist = Math.hypot(enemy.x - self.x, enemy.z - self.z);
  const err = aimErrors(self, enemy);
  const yawDelta = dampTrack(err.yaw);
  const pitchDelta = dampTrack(err.pitch);

  const behind = scoreJev < scoreHuman;
  let forward = 0;
  let strafe = 0;
  let ads = false;
  let fire = false;
  let jump = false;

  if (!visible) {
    const cover = pickFlankCover(self, enemy);
    ctrl.setCover(cover);
    ({ forward, strafe } = moveToward(self, enemy.x, enemy.z));
    forward = Math.max(0.55, forward * (behind ? 1 : 0.85));
    strafe += ctrl.getStrafeSign() * 0.25;
  } else {
    const onTarget =
      Math.abs(err.yaw) <= FIRE_YAW_ERR && Math.abs(err.pitch) <= FIRE_PITCH_ERR;
    ads = Math.abs(err.yaw) < 0.22 && dist < 32;
    strafe = Math.sin(Date.now() / 240) * (dist < 20 ? 0.85 : 0.6);
    forward = dist > 26 ? 0.8 : dist < 10 ? -0.35 : 0.35;
    jump = dist < 18 && Math.random() < 0.04;
    if (onTarget && self.adsProgress >= 0.65 && self.boltCooldown <= 0) {
      fire = true;
      forward = 0;
      strafe = 0;
    }
  }

  return { forward, strafe, yawDelta, pitchDelta, jump, ads, fire };
}

function pickFlankCover(self: Fighter, enemy: Fighter | null): { x: number; z: number } {
  const ranked = COVER_POINTS.slice().sort((a, b) => {
    const da = Math.hypot(a.x - self.x, a.z - self.z);
    const db = Math.hypot(b.x - self.x, b.z - self.z);
    // Prefer cover that is not right under our feet and not the closest camp spot.
    const awayA = da < 2.5 ? 20 : da;
    const awayB = db < 2.5 ? 20 : db;
    if (!enemy) return awayA - awayB;
    const flankA = Math.hypot(a.x - enemy.x, a.z - enemy.z);
    const flankB = Math.hypot(b.x - enemy.x, b.z - enemy.z);
    return awayA * 0.55 + flankA * 0.45 - (awayB * 0.55 + flankB * 0.45);
  });
  return ranked[1 + Math.floor(Math.random() * Math.min(3, ranked.length - 1))] ?? ranked[0]!;
}

function aimErrors(self: Fighter, enemy: Fighter): { yaw: number; pitch: number } {
  const bearing = Math.atan2(enemy.z - self.z, enemy.x - self.x);
  let yaw = bearing - self.yaw;
  while (yaw > Math.PI) yaw -= Math.PI * 2;
  while (yaw < -Math.PI) yaw += Math.PI * 2;
  const dist = Math.hypot(enemy.x - self.x, enemy.z - self.z) || 1;
  const desiredPitch = Math.atan2(enemy.y + PLAYER_EYE - (self.y + PLAYER_EYE), dist);
  return { yaw, pitch: desiredPitch - self.pitch };
}

/** Proportional track with soft near-zero to avoid orbiting past the target. */
function dampTrack(error: number, gain = 14): number {
  const g = Math.abs(error) < 0.08 ? gain * 1.4 : gain;
  return clamp(error * g, -14, 14);
}

function moveToward(
  self: Fighter,
  tx: number,
  tz: number,
): { forward: number; strafe: number } {
  const dir = Math.atan2(tz - self.z, tx - self.x);
  let diff = dir - self.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return {
    forward: Math.cos(diff),
    strafe: Math.sin(diff),
  };
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}
