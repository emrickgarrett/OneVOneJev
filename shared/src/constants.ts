export const TICK_HZ = 60;
export const SNAPSHOT_HZ = 20;
export const INPUT_HZ = 60;
export const JEV_DECISION_HZ = 9;

export const MATCH_KILLS_TO_WIN = 5;
export const COUNTDOWN_SECONDS = 3;
export const SPAWN_PROTECTION_MS = 1500;
export const KILLCAM_DURATION_MS = 2500;
export const KILLCAM_BUFFER_MS = 2800;
/** Soft match cap — challenger is kicked (no rematch) if the duel runs this long. */
export const MATCH_TIME_LIMIT_MS = 3 * 60 * 1000;

export const PLAYER_HEIGHT = 1.7;
export const PLAYER_RADIUS = 0.35;
export const PLAYER_EYE = 1.55;
export const MOVE_SPEED = 6.2;
export const ADS_MOVE_MULT = 0.72;
export const JUMP_VELOCITY = 7.5;
export const GRAVITY = 22;

export const ADS_TIME_MS = 200;
export const ADS_ACCURATE_AT = 0.65;
export const BOLT_CYCLE_MS = 1000;
export const HIPFIRE_SPREAD_DEG = 18;
export const ADS_SPREAD_DEG = 0.15;
/** Max look *rate* (rad/s) for bot controllers. */
export const MAX_LOOK_RATE = 14;
/** Max look *delta* per input sample for humans (radians). Large enough for flicks. */
export const MAX_LOOK_DELTA = 1.75;

export const MAP_HALF = 28;
export const MAP_BOUNDS = {
  minX: -MAP_HALF,
  maxX: MAP_HALF,
  minZ: -MAP_HALF,
  maxZ: MAP_HALF,
};

export const WS_PATH = "/ws";
