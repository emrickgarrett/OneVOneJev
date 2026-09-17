import type { PlayerInput } from "@onevonejev/shared";

export class Input {
  forward = 0;
  strafe = 0;
  jump = false;
  ads = false;
  fire = false;
  yawDelta = 0;
  pitchDelta = 0;
  private keys = new Set<string>();
  private seq = 0;
  enabled = false;
  sensitivity = 0.0055;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (e.code === "Space") e.preventDefault();
      if (e.code === "KeyT" && this.enabled) {
        // allow chat focus — handled externally
      }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));

    canvas.addEventListener("click", () => {
      if (this.enabled) canvas.requestPointerLock();
    });

    document.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement !== canvas || !this.enabled) return;
      this.yawDelta += e.movementX * this.sensitivity;
      this.pitchDelta -= e.movementY * this.sensitivity;
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
      yawDelta: this.yawDelta,
      pitchDelta: this.pitchDelta,
      jump: this.keys.has("Space"),
      ads: this.ads,
      fire: this.fire,
    };
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.fire = false;
    return input;
  }
}
