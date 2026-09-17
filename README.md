# 1v1 Jev — Quickscope Arena

Server-authoritative browser FPS: queue up, fight **Jev** (TypeSafe System One) in a Rust-like industrial yard, first to 5 kills. Spectators watch and chat from the sidelines. Final kill gets a killcam before the next challenger.

## Stack

- **Client:** Vite + Three.js + TypeScript
- **Server:** Node.js + `ws`, 60 Hz sim, 20 Hz snapshots
- **AI:** `@typesafe-ai/sdk` (`jev-latest`) with heuristic fallback

## Setup

```bash
npm install
cp .env.example .env
# Put your key in .env:
# TYPESAFE_API_KEY=...
npm run dev
```

- Game UI: http://localhost:5173
- WebSocket (proxied): `/ws` → `localhost:3001`

Production-style (single Node host serves API + built client):

```bash
npm run build
npm start
```

Serves the built client from the Node server on `PORT` (default `3001`).

## Controls

| Action | Input |
| --- | --- |
| Move | WASD |
| Look | Mouse (pointer lock) |
| ADS | Right mouse |
| Fire | Left mouse |
| Jump | Space |
| Chat | T |

## Game rules

- One human vs Jev at a time; others queue / spectate
- First to **5** kills
- Bolt-action sniper: inaccurate hipfire, accurate once ADS settles (~65% into ADS) — classic MW2 quickscope timing
- Shared radar (no fog of war)
- Safe respawns with brief spawn protection
- Final kill → killcam (full motion replay) → next queued player countdown
- Solo players are re-queued automatically after each match

## Jev

The server builds structured JSON state each decision tick (~9 Hz) and fans out Choice/Noul questions (move, yaw, pitch, ADS, fire, jump). API key stays on the server. Calls run only while a match is in `playing` and both fighters are alive. If TypeSafe is unreachable, a deterministic heuristic uses the same action interface so matches never stall.

## Deploy (Railway)

**Recommended:** one Railway service runs the Node game server **and** serves the built client. Same origin means the browser uses `wss://your-domain/ws` automatically — no Vercel split, no `VITE_WS_URL`.

```text
Browser ──HTTPS──► Railway (UI from client/dist)
       └──WSS /ws──► Railway (match sim + Jev)
```

Vercel alone cannot host this: serverless/edge functions are short-lived and do not support sticky WebSocket rooms + a 60 Hz sim.

### Prerequisites

- GitHub repo: [emrickgarrett/OneVOneJev](https://github.com/emrickgarrett/OneVOneJev)
- A TypeSafe API key (`TYPESAFE_API_KEY`)
- A [Railway](https://railway.app) account (GitHub login)

### Steps

1. Open [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → select `OneVOneJev`.
2. Railway builds with the root [`Dockerfile`](Dockerfile) (see also [`railway.toml`](railway.toml)).
3. Open the service → **Variables** → add:

   | Variable | Value |
   | --- | --- |
   | `TYPESAFE_API_KEY` | your TypeSafe key |

   Railway sets `PORT` for you. The container already uses `HOST=0.0.0.0`.

4. **Settings → Networking → Generate Domain** (HTTPS + WSS on the same host).
5. Open the public URL — you should see the **1v1 JEV** lobby.
6. Sanity checks:
   - `https://YOUR_DOMAIN/health` → `{"ok":true}`
   - Join Queue → countdown → match (WebSocket on `/ws`)

### Local production parity

```bash
npm run build
npm start
# open http://localhost:3001
```

### Cost notes

Railway’s hobby/trial tier is enough for a small public demo. TypeSafe usage scales with live match time (~9 Jev decisions/sec while `playing`).
