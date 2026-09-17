import { INPUT_HZ, PLAYER_EYE, type Snapshot } from "@onevonejev/shared";
import { createWorld } from "./world";
import { Net } from "./net";
import { Input } from "./input";
import { Hud } from "./hud";
import { drawRadar } from "./radar";
import { KillcamPlayer, setCameraFromPose } from "./killcam";
import { AudioBus } from "./audio";
import { LocalPlayer } from "./predict";

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
const local = new LocalPlayer();

input.onLook = (yawDelta, pitchDelta) => {
  local.applyLook(yawDelta, pitchDelta);
};

let myId: string | null = null;
let snap: Snapshot | null = null;
let entered = false;
let lastPos = { x: 0, z: 0 };
let movingSmooth = 0;
let wasPlaying = false;
/** Smoothed spectator chase camera (follows interpolated subject). */
const specCam = {
  x: 0,
  y: 12,
  z: 28,
  lx: 0,
  ly: 3,
  lz: 0,
  seeded: false,
};

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

    const playing = s.you.role === "playing" && s.phase === "playing";
    const me = s.entities.find((e) => e.id === myId);
    if (playing && me) {
      local.syncMatchState(me);
    } else if (wasPlaying) {
      local.reset();
    }
    wasPlaying = playing;

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
      const listener =
        playing && local.alive
          ? { x: local.x, y: local.y + 1.55, z: local.z }
          : (() => {
              const cam = world.camera.position;
              return { x: cam.x, y: cam.y, z: cam.z };
            })();
      const distance = Math.hypot(
        s.lastShot.ox - listener.x,
        s.lastShot.oy - listener.y,
        s.lastShot.oz - listener.z,
      );
      audio.fire({ distance });
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

hud.btnQueue.addEventListener("click", () => {
  net.send({ type: "join_queue" });
});
hud.btnLeaveQueue.addEventListener("click", () => {
  net.send({ type: "leave_queue" });
});
hud.btnQuit.addEventListener("click", () => {
  net.send({ type: "quit_to_spectate" });
  document.exitPointerLock?.();
  local.reset();
});
hud.setMuteUi(audio.muted);
hud.btnMute.addEventListener("click", () => {
  audio.resume();
  hud.setMuteUi(audio.toggleMute());
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
    input.clearKeys();
    document.exitPointerLock?.();
    chatInput.focus();
  }
  if (e.code === "Escape") chatInput.blur();
});

chatInput.addEventListener("focus", () => {
  input.clearKeys();
  document.exitPointerLock?.();
});

net.connect();

// Client owns pose; server only needs it for hitscan / spectators / Jev.
setInterval(() => {
  if (!snap || snap.you.role !== "playing" || snap.phase !== "playing" || !local.alive) return;
  const move = input.moveState();
  net.send({
    type: "input",
    input: local.toInput({
      ...move,
      fire: input.consumeFire(),
    }),
  });
}, 1000 / INPUT_HZ);

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const playing = Boolean(snap && snap.you.role === "playing" && snap.phase === "playing");
  input.enabled = playing;

  if (playing && local.alive) {
    const move = input.moveState();
    local.step(dt, { ...move, fire: false });
  }

  if (snap) {
    const me = snap.entities.find((e) => e.id === myId);
    const ads = playing && local.alive ? local.adsProgress : (me?.adsProgress ?? 0);
    hud.apply(snap, playing ? ads : 0);
    drawRadar(radarCanvas, snap.entities, myId);

    const inKillcam = snap.phase === "killcam";
    const hideId = inKillcam
      ? snap.killcamSubjectId ?? null
      : playing
        ? myId
        : null;

    if (killcam.active && inKillcam) {
      world.viewmodel.setVisible(false);
      killcam.update(world.camera, world);
      world.update(dt);
      specCam.seeded = false;
    } else {
      world.syncPlayers(snap.entities, hideId, { showDead: false });
      world.update(dt);
      if (playing && local.alive) {
        setCameraFromPose(world.camera, local);
        world.viewmodel.setVisible(true);
        world.viewmodel.setAds(local.adsProgress);
        const distMoved = Math.hypot(local.x - lastPos.x, local.z - lastPos.z);
        lastPos = { x: local.x, z: local.z };
        movingSmooth = lerp(movingSmooth, distMoved > 0.015 ? 1 : 0, 0.3);
        world.viewmodel.update(dt, movingSmooth > 0.35 && local.adsProgress < 0.55, now / 1000);
        specCam.seeded = false;
      } else {
        world.viewmodel.setVisible(false);
        const subjectId =
          snap.activePlayerId ??
          snap.entities.find((e) => e.kind === "human")?.id ??
          snap.entities.find((e) => e.kind === "jev")?.id ??
          null;
        const target = world.getRenderPose(subjectId);
        if (target) {
          const behind = 5;
          const height = 2.2;
          const wantX = target.x - Math.cos(target.yaw) * behind;
          const wantY = target.y + height;
          const wantZ = target.z - Math.sin(target.yaw) * behind;
          const lookX = target.x;
          const lookY = target.y + PLAYER_EYE;
          const lookZ = target.z;
          const jump =
            !specCam.seeded ||
            Math.hypot(wantX - specCam.x, wantY - specCam.y, wantZ - specCam.z) > 8;
          if (jump) {
            specCam.x = wantX;
            specCam.y = wantY;
            specCam.z = wantZ;
            specCam.lx = lookX;
            specCam.ly = lookY;
            specCam.lz = lookZ;
            specCam.seeded = true;
          } else {
            const a = 1 - Math.exp(-10 * dt);
            specCam.x = lerp(specCam.x, wantX, a);
            specCam.y = lerp(specCam.y, wantY, a);
            specCam.z = lerp(specCam.z, wantZ, a);
            specCam.lx = lerp(specCam.lx, lookX, a);
            specCam.ly = lerp(specCam.ly, lookY, a);
            specCam.lz = lerp(specCam.lz, lookZ, a);
          }
          world.camera.position.set(specCam.x, specCam.y, specCam.z);
          world.camera.lookAt(specCam.lx, specCam.ly, specCam.lz);
          if (Math.abs(world.camera.fov - 70) > 0.1) {
            world.camera.fov = 70;
            world.camera.updateProjectionMatrix();
          }
        } else {
          specCam.seeded = false;
          const t = now / 1000;
          world.camera.position.set(Math.cos(t * 0.15) * 32, 18, Math.sin(t * 0.15) * 32);
          world.camera.lookAt(0, 3, 0);
        }
      }
    }
  } else {
    world.update(dt);
  }

  world.updateTracers(dt);
  world.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
