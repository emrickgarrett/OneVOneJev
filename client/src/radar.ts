import { MAP_BOUNDS, type EntityState } from "@onevonejev/shared";

export function drawRadar(
  canvas: HTMLCanvasElement,
  entities: EntityState[],
  localId: string | null,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = "rgba(14,12,10,0.85)";
  ctx.fillRect(0, 0, w, h);

  // Playable ring
  ctx.strokeStyle = "rgba(196,165,116,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(8, 8, w - 16, h - 16);

  const minX = MAP_BOUNDS.minX;
  const maxX = MAP_BOUNDS.maxX;
  const minZ = MAP_BOUNDS.minZ;
  const maxZ = MAP_BOUNDS.maxZ;

  const toXy = (x: number, z: number) => ({
    px: ((x - minX) / (maxX - minX)) * (w - 20) + 10,
    py: ((z - minZ) / (maxZ - minZ)) * (h - 20) + 10,
  });

  // Center tower marker
  const c = toXy(0, 0);
  ctx.fillStyle = "rgba(232,93,4,0.5)";
  ctx.fillRect(c.px - 3, c.py - 3, 6, 6);

  for (const e of entities) {
    if (!e.alive) continue;
    const { px, py } = toXy(e.x, e.z);
    const isLocal = e.id === localId;
    ctx.fillStyle = e.kind === "jev" ? "#e85d04" : isLocal ? "#7cb342" : "#4fc3f7";
    ctx.beginPath();
    ctx.arc(px, py, isLocal ? 5 : 4, 0, Math.PI * 2);
    ctx.fill();

    // Facing wedge
    ctx.strokeStyle = ctx.fillStyle;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(e.yaw) * 12, py + Math.sin(e.yaw) * 12);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(232,223,208,0.55)";
  ctx.font = "10px IBM Plex Sans, sans-serif";
  ctx.fillText("RADAR", 12, 18);
}
