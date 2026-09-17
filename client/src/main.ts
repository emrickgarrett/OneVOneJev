import { INPUT_HZ, PLAYER_EYE, type Snapshot } from "@onevonejev/shared";
import { createWorld } from "./world";
import { Net } from "./net";
import { Input } from "./input";
import { Hud } from "./hud";
import { drawRadar } from "./radar";
import { KillcamPlayer, setCameraFromPose } from "./killcam";
import { AudioBus } from "./audio";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const lobby = document.getElementById("lobby")!;
const hudRoot = document.getElementById("hud")!;
const nameInput = document.getElementById("nameInput") as HTMLInputElement;
const btnQueue = document.getElementById("btnQueue")!;
const btnSpectate = document.getElementById("btnSpectate")!;
const chatForm = document.getElementById("chatForm") as HTMLFormElement;
const chatInput = document.getElementById("chatInput") as HTMLInputElement;
const radarCanvas = document.getElementById("radar") as HTMLCanvasElement;

const world = createWorld(canvas);
const input = new Input(canvas);
const hud = new Hud();
const killcam = new KillcamPlayer();
const audio = new AudioBus();

let myId: string | null = null;
let snap: Snapshot | null = null;
let entered = false;
let lastShotBolt = 0;
let lastPos = { x: 0, z: 0 };
let movingSmooth = 0;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const net = new Net({
  onWelcome(id, name) {
    myId = id;
    nameInput.value = nameInput.value || name;
  },
  onSnapshot(s) {
    const prev = snap;
    snap = s;
    if (s.phase === "killcam" && s.killcam && !killcam.active) {
      killcam.start(s.killcam);
      audio.sting();
    }
    if (s.phase !== "killcam") killcam.stop();

    // Detect kills for audio
    if (prev && s.killFeed[0] && prev.killFeed[0]?.id !== s.killFeed[0].id) {
      audio.hit();
    }
    if (s.lastShot && (!prev?.lastShot || prev.lastShot.t !== s.lastShot.t)) {
      world.showTracer(
        s.lastShot.ox,
        s.lastShot.oy,
        s.lastShot.oz,
        s.lastShot.dx,
        s.lastShot.dy,
        s.lastShot.dz,
      );
      audio.fire();
    }
  },
  onChat(msg) {
    hud.addChat(msg);
  },
  onClose() {
    console.warn("Disconnected");
  },
});

function enterArena(joinQueue: boolean): void {
  const name = nameInput.value.trim() || "Guest";
  net.send({ type: "hello", name });
  if (joinQueue) net.send({ type: "join_queue" });
  lobby.classList.add("hidden");
  hudRoot.classList.remove("hidden");
  entered = true;
  audio.resume();
}

btnQueue.addEventListener("click", () => enterArena(true));
btnSpectate.addEventListener("click", () => enterArena(false));
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") enterArena(true);
});

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  net.send({ type: "chat", text });
  chatInput.value = "";
  chatInput.blur();
});

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyT" && entered && document.activeElement !== chatInput) {
    e.preventDefault();
    chatInput.focus();
  }
  if (e.code === "Escape") chatInput.blur();
});

net.connect();

// Input send loop
setInterval(() => {
  if (!snap || snap.you.role !== "playing" || snap.phase !== "playing") {
    input.enabled = false;
    return;
  }
  input.enabled = true;
  const sample = input.sample();
  if (sample.fire) {
    // local click feedback; authoritative fire SFX comes from snapshot tracers
  }
  net.send({ type: "input", input: sample });
}, 1000 / INPUT_HZ);

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (snap) {
    const me = snap.entities.find((e) => e.id === myId);
    const ads = me?.adsProgress ?? 0;
    hud.apply(snap, snap.you.role === "playing" ? ads : 0);
    drawRadar(radarCanvas, snap.entities, myId);

    const inKillcam = snap.phase === "killcam";
    const hideId = inKillcam
      ? snap.killcamSubjectId ?? null
      : snap.you.role === "playing" && snap.phase === "playing"
        ? myId
        : null;

    if (killcam.active && inKillcam) {
      // Actor poses come from the replay timeline, not the frozen death snapshot.
      world.viewmodel.setVisible(false);
      killcam.update(world.camera, world);
    } else {
      world.syncPlayers(snap.entities, hideId, { showDead: false });
      if (snap.you.role === "playing" && me && me.alive && snap.phase === "playing") {
        setCameraFromPose(world.camera, me);
        world.viewmodel.setVisible(true);
        world.viewmodel.setAds(ads);
        const distMoved = Math.hypot(me.x - lastPos.x, me.z - lastPos.z);
        lastPos = { x: me.x, z: me.z };
        movingSmooth = lerp(movingSmooth, distMoved > 0.02 ? 1 : 0, 0.2);
        world.viewmodel.update(dt, movingSmooth > 0.35 && ads < 0.55, now / 1000);
        lastShotBolt = me.boltCooldown;
      } else {
        world.viewmodel.setVisible(false);
        // Spectate: follow active player or orbit
        const target =
          snap.entities.find((e) => e.id === snap!.activePlayerId) ??
          snap.entities.find((e) => e.kind === "human") ??
          snap.entities.find((e) => e.kind === "jev");
        if (target) {
          const behind = 5;
          const height = 2.2;
          world.camera.position.set(
            target.x - Math.cos(target.yaw) * behind,
            target.y + height,
            target.z - Math.sin(target.yaw) * behind,
          );
          world.camera.lookAt(target.x, target.y + PLAYER_EYE, target.z);
          world.camera.fov = 70;
          world.camera.updateProjectionMatrix();
        } else {
          const t = now / 1000;
          world.camera.position.set(Math.cos(t * 0.15) * 32, 18, Math.sin(t * 0.15) * 32);
          world.camera.lookAt(0, 3, 0);
        }
      }
    }
  }

  world.updateTracers(dt);
  world.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
