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

## Deploy

Vercel is great for the **static client**, but this game needs a **persistent Node WebSocket server**. Deploy in two pieces:

```text
Browser  →  Vercel (client/dist)
                │
                └── wss://…/ws  →  Railway / Fly / Render (Node game server)
```

### 1. Game server (required for multiplayer + Jev)

Pick any host that supports long-lived WebSockets (Railway, Fly.io, Render, a VPS).

1. Deploy this repo as a Node service.
2. Start command: `npm run build && npm start`
3. Set env:
   - `TYPESAFE_API_KEY` — your TypeSafe key (**never** put this on Vercel)
   - `PORT` — usually provided by the host
   - `HOST=0.0.0.0`
4. Confirm `GET /health` returns `{"ok":true}` and `WS /ws` accepts connections.
5. Note the public origin, e.g. `https://onevonejev-server.up.railway.app`

Optional single-host mode: the Node server also serves `client/dist` after `npm run build`, so you can skip Vercel and open the server URL directly.

### 2. Client on Vercel

1. Import the GitHub repo into [Vercel](https://vercel.com).
2. Root directory: repository root (uses [`vercel.json`](vercel.json)).
3. Framework preset: **Other** (build/output are already set).
4. Environment variable (Production + Preview):

   | Name | Value |
   | --- | --- |
   | `VITE_WS_URL` | `wss://YOUR_GAME_SERVER_HOST/ws` |

   Example: `wss://onevonejev-server.up.railway.app/ws`

5. Deploy. The client reads `VITE_WS_URL` at build time (`import.meta.env`), so change the server URL → **redeploy** the Vercel project.

### 3. Checklist

- [ ] `TYPESAFE_API_KEY` only on the game server
- [ ] `VITE_WS_URL` uses `wss://` (not `ws://`) when the site is HTTPS
- [ ] Game server allows WebSocket upgrade on `/ws`
- [ ] Locally, leave `VITE_WS_URL` unset so Vite proxies `/ws` → `localhost:3001`

### Why not “all on Vercel”?

Vercel serverless/edge functions are short-lived and are not a fit for a 60 Hz authoritative sim with sticky WebSocket rooms. Keep the arena process on a normal Node host; use Vercel for the front-end CDN.
