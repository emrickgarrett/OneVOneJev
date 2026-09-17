/** Sampled weapon SFX with procedural fallbacks. */
export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading: Promise<void> | null = null;
  /** Global volume scale (0–1). Default ~half of the original sample mix. */
  volume = 0.5;
  muted = false;

  constructor() {
    try {
      const saved = localStorage.getItem("onevonejev_mute");
      if (saved === "1") this.muted = true;
    } catch {
      /* ignore */
    }
  }

  resume(): void {
    this.ensure();
    void this.ctx!.resume();
    void this.preload();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMasterGain();
    try {
      localStorage.setItem("onevonejev_mute", muted ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyMasterGain();
    }
    return this.ctx;
  }

  private applyMasterGain(): void {
    if (!this.master) return;
    this.master.gain.value = this.muted ? 0 : this.volume;
  }

  private out(): AudioNode {
    this.ensure();
    return this.master!;
  }

  /** Kick off decode of public/sfx assets (safe to call repeatedly). */
  preload(): Promise<void> {
    if (this.loading) return this.loading;
    const ctx = this.ensure();
    this.loading = Promise.all([
      this.loadBuffer(ctx, "fire", "/sfx/sniper_fire.wav"),
      this.loadBuffer(ctx, "bolt", "/sfx/sniper_bolt.wav"),
    ]).then(() => undefined);
    return this.loading;
  }

  private async loadBuffer(ctx: AudioContext, key: string, url: string): Promise<void> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(raw.slice(0));
      this.buffers.set(key, buf);
    } catch (e) {
      console.warn(`[audio] failed to load ${url}`, e);
    }
  }

  private playBuffer(key: string, opts?: { gain?: number; when?: number; playbackRate?: number }): boolean {
    if (this.muted) return true;
    const buf = this.buffers.get(key);
    if (!buf) return false;
    const ctx = this.ensure();
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    src.buffer = buf;
    src.playbackRate.value = opts?.playbackRate ?? 1;
    g.gain.value = opts?.gain ?? 0.28;
    src.connect(g);
    g.connect(this.out());
    src.start(opts?.when ?? 0);
    return true;
  }

  /**
   * @param distance World-space meters from listener to muzzle.
   *                 Near (own shot) stays loud; distant shots fall off.
   */
  fire(opts?: { distance?: number }): void {
    if (this.muted) return;
    const dist = Math.max(0, opts?.distance ?? 0);
    // Soft inverse falloff — full near the muzzle, ~25% by mid-map (~25m).
    const atten = Math.max(0.14, Math.min(1, 10 / (10 + dist * 0.85)));
    const rateJitter = 0.93 + Math.random() * 0.14;
    const gainJitter = 0.88 + Math.random() * 0.24;
    const boltDelay = 0.16 + Math.random() * 0.14;
    const boltRate = 0.88 + Math.random() * 0.16;

    void this.preload().then(() => {
      if (this.muted) return;
      const fireGain = 0.35 * atten * gainJitter;
      if (!this.playBuffer("fire", { gain: fireGain, playbackRate: rateJitter })) {
        this.synthFire(fireGain, rateJitter);
      }
      const ctx = this.ensure();
      const when = ctx.currentTime + boltDelay;
      const boltGain = 0.22 * atten * (0.9 + Math.random() * 0.2);
      if (!this.playBuffer("bolt", { gain: boltGain, when, playbackRate: boltRate })) {
        this.synthBolt(when, boltGain);
      }
    });
  }

  reload(): void {
    if (this.muted) return;
    const rate = 0.9 + Math.random() * 0.16;
    void this.preload().then(() => {
      if (this.muted) return;
      if (!this.playBuffer("bolt", { gain: 0.25 * (0.9 + Math.random() * 0.2), playbackRate: rate })) {
        this.synthBolt(0, 0.25);
      }
    });
  }

  hit(): void {
    if (this.muted) return;
    const ctx = this.ensure();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.value = 200 + Math.random() * 50;
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.connect(g);
    g.connect(this.out());
    o.start();
    o.stop(ctx.currentTime + 0.28);
  }

  sting(): void {
    if (this.muted) return;
    const ctx = this.ensure();
    const notes = [196, 247, 294];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = f * (0.98 + Math.random() * 0.04);
      const t0 = ctx.currentTime + i * 0.12;
      g.gain.value = 0.0001;
      g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      o.connect(g);
      g.connect(this.out());
      o.start(t0);
      o.stop(t0 + 0.4);
    });
  }

  private synthFire(gain = 0.1, rate = 1): void {
    const ctx = this.ensure();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = 90 * rate;
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(Math.max(0.02, gain), ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    o.connect(g);
    g.connect(this.out());
    o.start();
    o.stop(ctx.currentTime + 0.2);
  }

  private synthBolt(when = 0, gain = 0.06): void {
    const ctx = this.ensure();
    const t0 = when || ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(420, t0);
    o.frequency.exponentialRampToValueAtTime(180, t0 + 0.12);
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(Math.max(0.015, gain), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    o.connect(g);
    g.connect(this.out());
    o.start(t0);
    o.stop(t0 + 0.18);
  }
}
