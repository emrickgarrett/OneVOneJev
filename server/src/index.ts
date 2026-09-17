import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import dotenv from "dotenv";
import { WebSocketServer } from "ws";
import { WS_PATH } from "@onevonejev/shared";
import { MatchRoom } from "./room.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";
const apiKey = process.env.TYPESAFE_API_KEY;

const room = new MatchRoom(apiKey);
room.start();

const clientDist = path.resolve(__dirname, "../../client/dist");

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Serve built client in production
  if (fs.existsSync(clientDist)) {
    let urlPath = req.url?.split("?")[0] || "/";
    if (urlPath === "/") urlPath = "/index.html";
    const filePath = path.join(clientDist, urlPath);
    if (filePath.startsWith(clientDist) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const types: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".woff2": "font/woff2",
      };
      res.writeHead(200, { "Content-Type": types[ext] ?? "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    // SPA fallback
    const index = path.join(clientDist, "index.html");
    if (fs.existsSync(index)) {
      res.writeHead(200, { "Content-Type": "text/html" });
      fs.createReadStream(index).pipe(res);
      return;
    }
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("1v1 Jev server running. Start the Vite client in dev, or build client for production.");
});

const wss = new WebSocketServer({ server, path: WS_PATH });
wss.on("connection", (ws) => room.addClient(ws));

server.listen(PORT, HOST, () => {
  console.log(`[server] 1v1 Jev listening on http://${HOST}:${PORT}${WS_PATH}`);
  console.log(`[server] Jev API: ${apiKey ? "enabled" : "heuristic fallback"}`);
});
