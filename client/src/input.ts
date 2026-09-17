import type { PlayerInput } from "@onevonejev/shared";

export class Input {
  ads = false;
  fire = false;
  /** Deltas queued for the next network sample (already applied locally via onLook). */
  private netYawDelta = 0;
  private netPitchDelta = 0;
  private keys = new Set<string>();
  private seq = 0;
  enabled = false;
  sensitivity = 0.0028;
  /** Called immediately on mouse move so the camera never waits on the server. */
  onLook: ((yawDelta: number, pitchDelta: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (e.code === "Space") e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));

    canvas.addEventListener("click", () => {
      if (this.enabled) canvas.requestPointerLock();
    });

    document.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement !== canvas || !this.enabled) return;
      const yawDelta = e.movementX * this.sensitivity;
      const pitchDelta = -e.movementY * this.sensitivity;
      this.netYawDelta += yawDelta;
      this.netPitchDelta += pitchDelta;
      this.onLook?.(yawDelta, pitchDelta);
    });

    document.addEventListener("mousedown", (e) => {
      if (!this.enabled) return;
      if (e.button === 0) this.fire = true;
      if (e.button === 2) this.ads = true;
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 2) this.ads = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  sample(): PlayerInput {
    const f =
      (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0) -
      (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0);
    const s =
      (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) -
      (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0);
    const input: PlayerInput = {
      seq: ++this.seq,
      forward: f,
      strafe: s,
      yawDelta: this.netYawDelta,
      pitchDelta: this.netPitchDelta,
      jump: this.keys.has("Space"),
      ads: this.ads,
      fire: this.fire,
    };
    this.netYawDelta = 0;
    this.netPitchDelta = 0;
    this.fire = false;
    return input;
  }
}
