import type { Vec3 } from "./protocol.js";

export interface Aabb {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface SpawnPoint {
  id: string;
  position: Vec3;
  yaw: number;
}

/** Kitbash Rust-like industrial yard colliders (server + client shared). */
export const MAP_BOXES: Aabb[] = [
  // Outer berm walls (low)
  { minX: -30, maxX: 30, minY: 0, maxY: 1.2, minZ: -30, maxZ: -28.5 },
  { minX: -30, maxX: 30, minY: 0, maxY: 1.2, minZ: 28.5, maxZ: 30 },
  { minX: -30, maxX: -28.5, minY: 0, maxY: 1.2, minZ: -30, maxZ: 30 },
  { minX: 28.5, maxX: 30, minY: 0, maxY: 1.2, minZ: -30, maxZ: 30 },

  // Central tower base + shaft
  { minX: -3.5, maxX: 3.5, minY: 0, maxY: 8, minZ: -3.5, maxZ: 3.5 },
  { minX: -5, maxX: 5, minY: 8, maxY: 9.2, minZ: -5, maxZ: 5 },
  // Tower ramps (approx stairs as slabs)
  { minX: 3.5, maxX: 8, minY: 0, maxY: 2, minZ: -1.5, maxZ: 1.5 },
  { minX: 3.5, maxX: 8, minY: 2, maxY: 4, minZ: -1.5, maxZ: 1.5 },
  { minX: 3.5, maxX: 8, minY: 4, maxY: 6, minZ: -1.5, maxZ: 1.5 },
  { minX: -8, maxX: -3.5, minY: 0, maxY: 2, minZ: -1.5, maxZ: 1.5 },
  { minX: -8, maxX: -3.5, minY: 2, maxY: 4, minZ: -1.5, maxZ: 1.5 },
  { minX: -8, maxX: -3.5, minY: 4, maxY: 6, minZ: -1.5, maxZ: 1.5 },

  // Shipping containers N
  { minX: -18, maxX: -6, minY: 0, maxY: 2.6, minZ: -20, maxZ: -16 },
  { minX: -18, maxX: -6, minY: 2.6, maxY: 5.2, minZ: -20, maxZ: -16 },
  { minX: 6, maxX: 18, minY: 0, maxY: 2.6, minZ: -22, maxZ: -18 },
  { minX: 8, maxX: 14, minY: 2.6, maxY: 5.2, minZ: -22, maxZ: -18 },

  // Shipping containers S
  { minX: -16, maxX: -4, minY: 0, maxY: 2.6, minZ: 16, maxZ: 20 },
  { minX: 4, maxX: 16, minY: 0, maxY: 2.6, minZ: 18, maxZ: 22 },
  { minX: 4, maxX: 16, minY: 2.6, maxY: 5.2, minZ: 18, maxZ: 22 },

  // Side crates / cover
  { minX: -24, maxX: -20, minY: 0, maxY: 1.4, minZ: -8, maxZ: -4 },
  { minX: -24, maxX: -20, minY: 0, maxY: 1.4, minZ: 4, maxZ: 8 },
  { minX: 20, maxX: 24, minY: 0, maxY: 1.4, minZ: -10, maxZ: -6 },
  { minX: 20, maxX: 24, minY: 0, maxY: 2.6, minZ: 6, maxZ: 12 },

  // Mid lane walls
  { minX: -2, maxX: 2, minY: 0, maxY: 2.2, minZ: -14, maxZ: -10 },
  { minX: -2, maxX: 2, minY: 0, maxY: 2.2, minZ: 10, maxZ: 14 },
  { minX: -14, maxX: -10, minY: 0, maxY: 2.8, minZ: -2, maxZ: 2 },
  { minX: 10, maxX: 14, minY: 0, maxY: 2.8, minZ: -2, maxZ: 2 },

  // Pipe / scrap piles
  { minX: -10, maxX: -7, minY: 0, maxY: 1.1, minZ: 8, maxZ: 11 },
  { minX: 7, maxX: 11, minY: 0, maxY: 1.1, minZ: -12, maxZ: -8 },
];

export const SPAWN_POINTS: SpawnPoint[] = [
  { id: "ne", position: { x: 22, y: 0, z: -22 }, yaw: Math.PI * 0.75 },
  { id: "nw", position: { x: -22, y: 0, z: -22 }, yaw: Math.PI * 0.25 },
  { id: "se", position: { x: 22, y: 0, z: 22 }, yaw: -Math.PI * 0.75 },
  { id: "sw", position: { x: -22, y: 0, z: 22 }, yaw: -Math.PI * 0.25 },
  { id: "e", position: { x: 24, y: 0, z: 0 }, yaw: Math.PI },
  { id: "w", position: { x: -24, y: 0, z: 0 }, yaw: 0 },
  { id: "n", position: { x: 0, y: 0, z: -24 }, yaw: Math.PI / 2 },
  { id: "s", position: { x: 0, y: 0, z: 24 }, yaw: -Math.PI / 2 },
];

export const COVER_POINTS = [
  { id: "containers_n", x: -12, z: -18 },
  { id: "containers_ne", x: 12, z: -20 },
  { id: "containers_s", x: -10, z: 18 },
  { id: "containers_se", x: 10, z: 20 },
  { id: "tower_e", x: 9, z: 0 },
  { id: "tower_w", x: -9, z: 0 },
  { id: "mid_n", x: 0, z: -12 },
  { id: "mid_s", x: 0, z: 12 },
  { id: "west_crates", x: -22, z: 0 },
  { id: "east_crates", x: 22, z: 8 },
];
