import {
  KILLCAM_DURATION_MS,
  KILLCAM_SLOWMO_AFTER_MS,
  KILLCAM_SLOWMO_BEFORE_MS,
  KILLCAM_SLOWMO_RATE,
  PLAYER_EYE,
  type KillcamFrame,
  type KillcamReplay,
} from "@onevonejev/shared";
import type { PerspectiveCamera } from "three";
import type { World } from "./world";

function sampleTrack(frames: KillcamFrame[], targetT: number): KillcamFrame | null {
  if (!frames.length) return null;
  let frame = frames[0]!;
  for (const f of frames) {
    if (f.t <= targetT) frame = f;
    else break;
  }
  return frame;
}

export class KillcamPlayer {
  private replay: KillcamReplay | null = null;
  private playing = false;
  private startWall = 0;
  private startT = 0;
  private endT = 0;
  private shotT = 0;
  private replayT = 0;
  private lastShotT = -1;
  private lastWall = 0;

  start(replay: KillcamReplay): void {
    const frames = (replay.frames ?? []).slice().sort((a, b) => a.t - b.t);
    const actors: Record<string, KillcamFrame[]> = {};
    for (const [id, track] of Object.entries(replay.actors ?? {})) {
      actors[id] = track.slice().sort((a, b) => a.t - b.t);
    }
    if (!actors[replay.subjectId]?.length && frames.length) {
      actors[replay.subjectId] = frames;
    }
    this.replay = { subjectId: replay.subjectId, frames, actors };
    this.playing = frames.length > 0 || Object.values(actors).some((t) => t.length > 0);

    const allFrames = [
      ...frames,
      ...Object.values(actors).flatMap((t) => t),
    ];
    const allT = allFrames.map((f) => f.t);
    this.startT = allT.length ? Math.min(...allT) : 0;
    this.endT = allT.length ? Math.max(...allT) : 0;

    const shotFrames = allFrames.filter((f) => f.shot).sort((a, b) => a.t - b.t);
    // Prefer the last recorded shot (final kill).
    this.shotT = shotFrames.length ? shotFrames[shotFrames.length - 1]!.t : this.endT;

    this.replayT = this.startT;
    this.startWall = performance.now();
    this.lastWall = this.startWall;
    this.lastShotT = -1;
  }

  stop(): void {
    this.playing = false;
    this.replay = null;
    this.lastShotT = -1;
  }

  get active(): boolean {
    return this.playing;
  }

  update(camera: PerspectiveCamera, world: World, dt: number): void {
    if (!this.playing || !this.replay) return;

    const wallNow = performance.now();
    const wallElapsed = wallNow - this.startWall;
    const step = Math.min(0.05, Math.max(0, dt));

    const slowStart = this.shotT - KILLCAM_SLOWMO_BEFORE_MS;
    const slowEnd = this.shotT + KILLCAM_SLOWMO_AFTER_MS;
    let rate = 1;
    if (this.replayT >= slowStart && this.replayT < slowEnd) {
      rate = KILLCAM_SLOWMO_RATE;
    } else if (this.replayT >= slowEnd) {
      // Linger on the aftermath while the server killcam phase finishes.
      rate = 0;
    }

    this.replayT = Math.min(this.endT, this.replayT + step * 1000 * rate);
    const targetT = this.replayT;

    const camTrack = this.replay.actors[this.replay.subjectId] ?? this.replay.frames;
    const camFrame = sampleTrack(camTrack, targetT);
    if (camFrame) {
      setCameraFromPose(camera, camFrame);
      if (camFrame.shot && camFrame.t !== this.lastShotT) {
        this.lastShotT = camFrame.t;
        world.showTracer(
          camFrame.shot.ox,
          camFrame.shot.oy,
          camFrame.shot.oz,
          camFrame.shot.dx,
          camFrame.shot.dy,
          camFrame.shot.dz,
        );
      }
    }

    for (const [id, track] of Object.entries(this.replay.actors)) {
      const pose = sampleTrack(track, targetT);
      if (!pose) continue;
      world.setPlayerPose(id, pose, id !== this.replay.subjectId);
    }

    if (wallElapsed > KILLCAM_DURATION_MS + 200) this.playing = false;
    this.lastWall = wallNow;
  }
}

export function setCameraFromPose(
  camera: PerspectiveCamera,
  pose: { x: number; y: number; z: number; yaw: number; pitch: number; adsProgress?: number },
): void {
  camera.position.set(pose.x, pose.y + PLAYER_EYE, pose.z);
  const fov = 75 - (pose.adsProgress ?? 0) * 35;
  if (Math.abs(camera.fov - fov) > 0.1) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  const cp = Math.cos(pose.pitch);
  const lookX = pose.x + Math.cos(pose.yaw) * cp;
  const lookY = pose.y + PLAYER_EYE + Math.sin(pose.pitch);
  const lookZ = pose.z + Math.sin(pose.yaw) * cp;
  camera.lookAt(lookX, lookY, lookZ);
}
