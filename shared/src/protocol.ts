export type Role = "queued" | "playing" | "spectating";

export type MatchPhase =
  | "waiting"
  | "countdown"
  | "playing"
  | "killcam"
  | "intermission";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Client-authoritative pose for the human player.
 * Server accepts this as-is for match/hitscan (no movement simulation).
 */
export interface PlayerInput {
  seq: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
  ads: boolean;
  /** Ads blend 0–1 from the client (server mirrors for hitscan accuracy). */
  adsProgress: number;
  fire: boolean;
}

export interface EntityState {
  id: string;
  name: string;
  kind: "human" | "jev";
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vz: number;
  onGround: boolean;
  adsProgress: number;
  boltCooldown: number;
  alive: boolean;
  spawnProtection: number;
  score: number;
  kills: number;
  deaths: number;
}

export interface KillFeedEntry {
  id: string;
  killer: string;
  victim: string;
  weapon: string;
  t: number;
}

export interface ChatMessage {
  id: string;
  from: string;
  text: string;
  t: number;
}

export interface KillcamFrame {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  adsProgress: number;
  shot?: { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number };
}

/** Full final-kill replay: killer POV + every actor's motion track. */
export interface KillcamReplay {
  subjectId: string;
  /** Killer first-person track (same as actors[subjectId], kept for clarity). */
  frames: KillcamFrame[];
  /** Motion for each fighter id during the replay window. */
  actors: Record<string, KillcamFrame[]>;
}

export interface Snapshot {
  tick: number;
  serverTime: number;
  phase: MatchPhase;
  countdown: number;
  scoreHuman: number;
  scoreJev: number;
  activePlayerId: string | null;
  activePlayerName: string | null;
  entities: EntityState[];
  killFeed: KillFeedEntry[];
  queue: { id: string; name: string }[];
  spectators: { id: string; name: string }[];
  killcam?: KillcamReplay;
  /** First-person killcam subject — hide this model client-side. */
  killcamSubjectId?: string | null;
  lastShot?: {
    ox: number;
    oy: number;
    oz: number;
    dx: number;
    dy: number;
    dz: number;
    t: number;
  } | null;
  you: {
    id: string;
    role: Role;
    name: string;
    queueIndex: number;
  };
}

export type ClientMessage =
  | { type: "hello"; name: string }
  | { type: "input"; input: PlayerInput }
  | { type: "chat"; text: string }
  | { type: "join_queue" }
  | { type: "leave_queue" }
  | { type: "quit_to_spectate" }
  | { type: "ping"; t: number };

export type ServerMessage =
  | { type: "welcome"; id: string; name: string }
  | { type: "snapshot"; snap: Snapshot }
  | { type: "chat"; msg: ChatMessage }
  | { type: "pong"; t: number }
  | { type: "error"; message: string };
