import type { ChatMessage, Snapshot } from "@onevonejev/shared";

export class Hud {
  scoreHuman = document.getElementById("scoreHuman")!;
  scoreJev = document.getElementById("scoreJev")!;
  phaseBanner = document.getElementById("phaseBanner")!;
  killfeed = document.getElementById("killfeed")!;
  roleLabel = document.getElementById("roleLabel")!;
  queueLabel = document.getElementById("queueLabel")!;
  chatLog = document.getElementById("chatLog")!;
  chat = document.getElementById("chat")!;
  scope = document.getElementById("scopeOverlay")!;
  crosshair = document.getElementById("crosshair")!;
  btnQueue = document.getElementById("btnHudQueue")!;
  btnLeaveQueue = document.getElementById("btnHudLeaveQueue")!;
  btnQuit = document.getElementById("btnHudQuit")!;
  private lastCountdown = -1;

  apply(snap: Snapshot, adsProgress: number): void {
    this.scoreHuman.textContent = String(snap.scoreHuman);
    this.scoreJev.textContent = String(snap.scoreJev);

    this.roleLabel.textContent =
      snap.you.role === "playing"
        ? "YOU vs JEV"
        : snap.you.role === "queued"
          ? "IN QUEUE"
          : "SPECTATING";

    this.queueLabel.textContent =
      snap.you.role === "queued"
        ? `Position #${snap.you.queueIndex + 1} · ${snap.queue.length} waiting`
        : snap.activePlayerName
          ? `Now playing: ${snap.activePlayerName}`
          : "Waiting for challenger…";

    const showQueue = snap.you.role === "spectating";
    const showLeave = snap.you.role === "queued";
    const showQuit = snap.you.role === "playing";
    this.btnQueue.classList.toggle("hidden", !showQueue);
    this.btnLeaveQueue.classList.toggle("hidden", !showLeave);
    this.btnQuit.classList.toggle("hidden", !showQuit);

    this.killfeed.innerHTML = snap.killFeed
      .slice(0, 5)
      .map((k) => `<div><strong>${k.killer}</strong> ⨯ ${k.victim}</div>`)
      .join("");

    if (snap.phase === "countdown" && snap.countdown > 0) {
      if (snap.countdown !== this.lastCountdown) {
        this.phaseBanner.textContent = String(snap.countdown);
        this.phaseBanner.classList.remove("show");
        void this.phaseBanner.offsetWidth;
        this.phaseBanner.classList.add("show");
        this.lastCountdown = snap.countdown;
      }
    } else if (snap.phase === "killcam") {
      this.phaseBanner.textContent = "FINAL KILL";
      this.phaseBanner.classList.add("show");
    } else if (snap.phase === "intermission") {
      this.phaseBanner.textContent =
        snap.scoreHuman > snap.scoreJev ? "CHALLENGER WINS" : "JEV WINS";
      this.phaseBanner.classList.add("show");
    } else if (snap.phase === "waiting") {
      this.phaseBanner.textContent = "WAITING";
      this.phaseBanner.classList.add("show");
    } else {
      this.phaseBanner.classList.remove("show");
      this.lastCountdown = -1;
    }

    this.chat.classList.toggle("playing", snap.you.role === "playing");

    const scoped = adsProgress > 0.45 && snap.you.role === "playing" && snap.phase === "playing";
    if (scoped) {
      this.scope.classList.add("active");
      this.scope.classList.remove("hidden");
      this.crosshair.style.opacity = "0";
    } else {
      this.scope.classList.remove("active");
      this.crosshair.style.opacity = snap.you.role === "playing" ? "1" : "0";
    }
  }

  addChat(msg: ChatMessage): void {
    const el = document.createElement("div");
    el.innerHTML = `<span class="from">${escapeHtml(msg.from)}</span>: ${escapeHtml(msg.text)}`;
    this.chatLog.appendChild(el);
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
