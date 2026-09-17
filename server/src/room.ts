import {
  COUNTDOWN_SECONDS,
  KILLCAM_BUFFER_MS,
  KILLCAM_DURATION_MS,
  MATCH_KILLS_TO_WIN,
  MATCH_TIME_LIMIT_MS,
  SNAPSHOT_HZ,
  TICK_HZ,
  type ChatMessage,
  type ClientMessage,
  type EntityState,
  type KillcamFrame,
  type KillcamReplay,
  type KillFeedEntry,
  type MatchPhase,
  type PlayerInput,
  type Role,
  type ServerMessage,
  type Snapshot,
} from "@onevonejev/shared";
import type { WebSocket } from "ws";
import {
  applyBotControls,
  applyInput,
  createFighter,
  respawn,
  tickFighter,
  tryFire,
  type Fighter,
  type ShotEvent,
} from "./fighter.js";
import { JevController } from "./jev.js";

interface Client {
  id: string;
  name: string;
  ws: WebSocket;
  role: Role;
  lastInput: PlayerInput | null;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export class MatchRoom {
  private clients = new Map<string, Client>();
  /** Explicit FIFO challenger order (client ids). */
  private queue: string[] = [];
  private chat: ChatMessage[] = [];
  private killFeed: KillFeedEntry[] = [];
  private phase: MatchPhase = "waiting";
  private countdown = 0;
  private tick = 0;
  private scoreHuman = 0;
  private scoreJev = 0;
  private activePlayerId: string | null = null;
  private human: Fighter | null = null;
  private jev: Fighter;
  private jevCtrl: JevController;
  private killcam: KillcamReplay | undefined;
  private killcamSubjectId: string | null = null;
  private phaseTimer = 0;
  private lastShot: ShotEvent | null = null;
  private lastShotAt = 0;
  private killcamById = new Map<string, KillcamFrame[]>();
  private accumulator = 0;
  private snapshotAcc = 0;
  private lastTime = Date.now();
  /** Bumped when leaving `playing` so late TypeSafe responses are ignored. */
  private jevEpoch = 0;
  /** Wall-clock when the live duel started (`playing`); 0 if not in a timed match. */
  private matchStartedAt = 0;

  constructor(apiKey: string | undefined) {
    this.jev = createFighter("jev", "Jev", "jev", 2);
    this.jevCtrl = new JevController(apiKey);
  }

  start(): void {
    setInterval(() => this.loop(), 1000 / 120);
  }

  addClient(ws: WebSocket): void {
    const id = uid();
    const client: Client = {
      id,
      name: `Guest_${id.slice(0, 4)}`,
      ws,
      role: "spectating",
      lastInput: null,
    };
    this.clients.set(id, client);
    this.send(ws, { type: "welcome", id, name: client.name });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data)) as ClientMessage;
        this.onMessage(client, msg);
      } catch {
        this.send(ws, { type: "error", message: "bad message" });
      }
    });

    ws.on("close", () => this.removeClient(id));
  }

  private removeClient(id: string): void {
    const c = this.clients.get(id);
    if (!c) return;
    this.clients.delete(id);
    this.queue = this.queue.filter((q) => q !== id);
    if (this.activePlayerId === id) {
      this.endActiveMatch(false);
      this.promoteNext();
    }
  }

  private enqueue(id: string, opts?: { force?: boolean }): void {
    if (!this.queue.includes(id)) this.queue.push(id);
    const c = this.clients.get(id);
    if (c && (opts?.force || c.role !== "playing")) c.role = "queued";
  }

  private onMessage(c: Client, msg: ClientMessage): void {
    switch (msg.type) {
      case "hello": {
        const name = sanitizeName(msg.name);
        c.name = name;
        this.send(c.ws, { type: "welcome", id: c.id, name });
        break;
      }
      case "join_queue":
        if (c.role !== "playing") {
          this.enqueue(c.id);
        }
        if (this.phase === "waiting") this.promoteNext();
        break;
      case "leave_queue":
        this.queue = this.queue.filter((q) => q !== c.id);
        if (c.role === "queued") c.role = "spectating";
        break;
      case "input":
        if (c.id === this.activePlayerId && this.phase === "playing") {
          c.lastInput = msg.input;
        }
        break;
      case "chat": {
        const text = sanitizeChat(msg.text);
        if (!text) return;
        const m: ChatMessage = {
          id: uid(),
          from: c.name,
          text,
          t: Date.now(),
        };
        this.chat.push(m);
        if (this.chat.length > 80) this.chat.shift();
        this.broadcast({ type: "chat", msg: m });
        break;
      }
      case "ping":
        this.send(c.ws, { type: "pong", t: msg.t });
        break;
    }
  }

  private loop(): void {
    const now = Date.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.accumulator += dt;
    this.snapshotAcc += dt;

    const step = 1 / TICK_HZ;
    while (this.accumulator >= step) {
      this.accumulator -= step;
      this.simTick(now);
      this.tick++;
    }

    if (this.snapshotAcc >= 1 / SNAPSHOT_HZ) {
      this.snapshotAcc = 0;
      this.broadcastSnapshots();
    }
  }

  private simTick(now: number): void {
    // Phase timers
    if (this.phase === "countdown") {
      this.phaseTimer -= 1 / TICK_HZ;
      this.countdown = Math.max(0, Math.ceil(this.phaseTimer));
      if (this.phaseTimer <= 0) {
        this.phase = "playing";
        this.countdown = 0;
        this.matchStartedAt = now;
        this.resetRoundScores();
      }
    } else if (this.phase === "killcam") {
      this.phaseTimer -= 1 / TICK_HZ;
      if (this.phaseTimer <= 0) {
        this.phase = "intermission";
        this.phaseTimer = 2;
        this.killcam = undefined;
        this.killcamSubjectId = null;
      }
    } else if (this.phase === "intermission") {
      this.phaseTimer -= 1 / TICK_HZ;
      if (this.phaseTimer <= 0) {
        this.endActiveMatch(true);
        this.promoteNext();
      }
    }

    if (this.phase !== "playing" && this.phase !== "countdown") {
      // Still tick Jev idle pose lightly
      return;
    }

    if (this.phase === "countdown") return;

    if (
      this.phase === "playing" &&
      this.matchStartedAt > 0 &&
      now - this.matchStartedAt >= MATCH_TIME_LIMIT_MS
    ) {
      const name = this.human?.name ?? "Challenger";
      this.broadcast({
        type: "chat",
        msg: {
          id: uid(),
          from: "SYSTEM",
          text: `${name} timed out (3:00) — kicked from the arena.`,
          t: Date.now(),
        },
      });
      this.endActiveMatch(false);
      this.promoteNext();
      return;
    }

    // Apply human input
    if (this.human && this.activePlayerId) {
      const c = this.clients.get(this.activePlayerId);
      if (c?.lastInput) {
        applyInput(this.human, c.lastInput);
        c.lastInput = null;
      }
    }

    // Jev decisions — only while match is live (phase gate also inside controller)
    this.jevCtrl.tick(
      now,
      this.jev,
      this.human,
      this.phase,
      this.scoreHuman,
      this.scoreJev,
      this.jevEpoch,
    );
    applyBotControls(this.jev, this.jevCtrl.getAction(this.jev, this.human, now));

    const fighters = [this.jev, ...(this.human ? [this.human] : [])];
    for (const f of fighters) tickFighter(f);

    // Fire
    const shots: ShotEvent[] = [];
    if (this.human) {
      const s = tryFire(this.human, fighters);
      if (s) shots.push(s);
    }
    {
      const s = tryFire(this.jev, fighters);
      if (s) shots.push(s);
    }

    const shotByShooter = new Map<string, ShotEvent>();
    for (const shot of shots) {
      this.lastShot = shot;
      this.lastShotAt = Date.now();
      shotByShooter.set(shot.shooterId, shot);
    }

    // Record this tick (including kill shot) before phase can leave `playing`.
    this.pushKillcamFrame(this.jev.id, shotByShooter.get(this.jev.id) ?? null);
    if (this.human) this.pushKillcamFrame(this.human.id, shotByShooter.get(this.human.id) ?? null);

    for (const shot of shots) {
      if (shot.victimId) this.handleKill(shot);
    }
  }

  private pushKillcamFrame(fighterId: string, shot: ShotEvent | null): void {
    if (this.phase !== "playing") return;
    const f = fighterId === "jev" ? this.jev : this.human?.id === fighterId ? this.human : null;
    if (!f) return;
    const buf = this.killcamById.get(fighterId) ?? [];
    const frame: KillcamFrame = {
      t: Date.now(),
      x: f.x,
      y: f.y,
      z: f.z,
      yaw: f.yaw,
      pitch: f.pitch,
      adsProgress: f.adsProgress,
    };
    if (shot) {
      frame.shot = {
        ox: shot.ox,
        oy: shot.oy,
        oz: shot.oz,
        dx: shot.dx,
        dy: shot.dy,
        dz: shot.dz,
      };
    }
    buf.push(frame);
    const cutoff = Date.now() - KILLCAM_BUFFER_MS;
    while (buf.length && buf[0]!.t < cutoff) buf.shift();
    this.killcamById.set(fighterId, buf);
  }

  private handleKill(shot: ShotEvent): void {
    const killer =
      shot.shooterId === "jev" ? this.jev : this.human?.id === shot.shooterId ? this.human : null;
    const victim =
      shot.victimId === "jev" ? this.jev : this.human?.id === shot.victimId ? this.human : null;
    if (!killer || !victim) return;

    victim.alive = false;
    killer.kills += 1;
    victim.deaths += 1;

    if (killer.kind === "human") this.scoreHuman += 1;
    else this.scoreJev += 1;
    killer.score = killer.kind === "human" ? this.scoreHuman : this.scoreJev;

    this.killFeed.unshift({
      id: uid(),
      killer: killer.name,
      victim: victim.name,
      weapon: "Bolt Sniper",
      t: Date.now(),
    });
    if (this.killFeed.length > 8) this.killFeed.pop();

    const matchOver =
      this.scoreHuman >= MATCH_KILLS_TO_WIN || this.scoreJev >= MATCH_KILLS_TO_WIN;

    if (matchOver) {
      this.startKillcam(killer.id);
    } else {
      setTimeout(() => {
        if (this.phase !== "playing") return;
        const enemy = victim.kind === "human" ? this.jev : this.human;
        respawn(victim, enemy);
      }, 800);
    }
  }

  private startKillcam(killerId: string): void {
    this.phase = "killcam";
    this.phaseTimer = KILLCAM_DURATION_MS / 1000;
    this.killcamSubjectId = killerId;

    const actors: Record<string, KillcamFrame[]> = {};
    for (const [id, buf] of this.killcamById) {
      actors[id] = buf.slice();
    }
    const frames = actors[killerId]?.slice() ?? [];
    this.killcam = { subjectId: killerId, frames, actors };
  }

  private resetRoundScores(): void {
    this.scoreHuman = 0;
    this.scoreJev = 0;
    this.jev.kills = 0;
    this.jev.deaths = 0;
    this.jev.score = 0;
    if (this.human) {
      this.human.kills = 0;
      this.human.deaths = 0;
      this.human.score = 0;
      respawn(this.human, this.jev);
    }
    respawn(this.jev, this.human);
    this.killFeed = [];
    this.killcamById.clear();
  }

  private endActiveMatch(completed: boolean): void {
    this.jevEpoch++;
    this.jevCtrl.reset();
    this.matchStartedAt = 0;

    const finishedId = this.activePlayerId;
    if (finishedId) {
      const c = this.clients.get(finishedId);
      if (c) {
        if (completed) {
          // Rematch rotation: finished challenger goes to the back of the queue.
          // Solo players immediately get another go after killcam/intermission.
          this.queue = this.queue.filter((q) => q !== finishedId);
          this.enqueue(finishedId, { force: true });
        } else {
          c.role = "spectating";
          this.queue = this.queue.filter((q) => q !== finishedId);
        }
      }
    }
    this.activePlayerId = null;
    this.human = null;
    this.phase = "waiting";
    this.killcam = undefined;
    this.killcamSubjectId = null;
  }

  private promoteNext(): void {
    if (this.phase !== "waiting" && this.phase !== "intermission") return;

    // Drop stale queue entries
    this.queue = this.queue.filter((id) => this.clients.has(id));

    const nextId = this.queue.shift();
    if (!nextId) {
      this.phase = "waiting";
      this.activePlayerId = null;
      this.human = null;
      return;
    }
    const next = this.clients.get(nextId);
    if (!next) {
      this.promoteNext();
      return;
    }

    next.role = "playing";
    this.activePlayerId = next.id;
    this.human = createFighter(next.id, next.name, "human", 0);
    this.phase = "countdown";
    this.phaseTimer = COUNTDOWN_SECONDS;
    this.countdown = COUNTDOWN_SECONDS;
    this.scoreHuman = 0;
    this.scoreJev = 0;
    this.jevEpoch++;
    this.jevCtrl.reset();
  }

  private broadcastSnapshots(): void {
    for (const c of this.clients.values()) {
      const snap = this.buildSnapshot(c);
      this.send(c.ws, { type: "snapshot", snap });
    }
  }

  private buildSnapshot(c: Client): Snapshot {
    const entities: EntityState[] = [];
    const pushE = (f: Fighter) => {
      entities.push({
        id: f.id,
        name: f.name,
        kind: f.kind,
        x: f.x,
        y: f.y,
        z: f.z,
        yaw: f.yaw,
        pitch: f.pitch,
        vx: 0,
        vz: 0,
        onGround: f.onGround,
        adsProgress: f.adsProgress,
        boltCooldown: f.boltCooldown,
        alive: f.alive,
        spawnProtection: f.spawnProtection,
        score: f.score,
        kills: f.kills,
        deaths: f.deaths,
      });
    };
    pushE(this.jev);
    if (this.human) pushE(this.human);

    const queue = this.queue
      .map((id) => this.clients.get(id))
      .filter((x): x is Client => Boolean(x))
      .map((x) => ({ id: x.id, name: x.name }));
    const spectators = [...this.clients.values()]
      .filter((x) => x.role === "spectating")
      .map((x) => ({ id: x.id, name: x.name }));

    const queueIndex = this.queue.indexOf(c.id);

    return {
      tick: this.tick,
      serverTime: Date.now(),
      phase: this.phase,
      countdown: this.countdown,
      scoreHuman: this.scoreHuman,
      scoreJev: this.scoreJev,
      activePlayerId: this.activePlayerId,
      activePlayerName: this.human?.name ?? null,
      entities,
      killFeed: this.killFeed,
      queue,
      spectators,
      killcam: this.phase === "killcam" ? this.killcam : undefined,
      killcamSubjectId: this.phase === "killcam" ? this.killcamSubjectId : null,
      lastShot:
        this.lastShot && Date.now() - this.lastShotAt < 120
          ? {
              ox: this.lastShot.ox,
              oy: this.lastShot.oy,
              oz: this.lastShot.oz,
              dx: this.lastShot.dx,
              dy: this.lastShot.dy,
              dz: this.lastShot.dz,
              t: this.lastShotAt,
            }
          : null,
      you: {
        id: c.id,
        role: c.role,
        name: c.name,
        queueIndex,
      },
    };
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage): void {
    for (const c of this.clients.values()) this.send(c.ws, msg);
  }
}

function sanitizeName(n: string): string {
  return (n || "Guest").replace(/[^\w\s\-_.]/g, "").trim().slice(0, 16) || "Guest";
}

function sanitizeChat(t: string): string {
  return t.replace(/[\u0000-\u001F]/g, "").trim().slice(0, 140);
}
