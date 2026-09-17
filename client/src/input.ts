export class Input {
  ads = false;
  private fireQueued = false;
  private keys = new Set<string>();
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
      this.onLook?.(e.movementX * this.sensitivity, -e.movementY * this.sensitivity);
    });

    document.addEventListener("mousedown", (e) => {
      if (!this.enabled) return;
      if (e.button === 0) this.fireQueued = true;
      if (e.button === 2) this.ads = true;
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 2) this.ads = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  moveState(): { forward: number; strafe: number; jump: boolean; ads: boolean } {
    const forward =
      (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0) -
      (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0);
    const strafe =
      (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) -
      (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0);
    return {
      forward,
      strafe,
      jump: this.keys.has("Space"),
      ads: this.ads,
    };
  }

  /** Latch fire for the next network pose packet. */
  consumeFire(): boolean {
    const f = this.fireQueued;
    this.fireQueued = false;
    return f;
  }
}
