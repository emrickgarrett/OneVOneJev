import * as THREE from "three";
import { MAP_BOXES, MAP_BOUNDS } from "@onevonejev/shared";
import { createOperator, createViewmodel, preloadModels, updateOperators } from "./models";

export function createWorld(canvas: HTMLCanvasElement) {
  preloadModels();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x6a8aa8);
  scene.fog = new THREE.Fog(0x6a8aa8, 40, 95);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 200);
  camera.position.set(0, 12, 28);

  const hemi = new THREE.HemisphereLight(0xddeeff, 0x8a6a40, 0.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe0b0, 1.35);
  sun.position.set(30, 50, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  scene.add(sun);

  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x9a7b4f,
    roughness: 0.95,
    metalness: 0.05,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(56, 28, 0x7a6240, 0x8a7050);
  grid.position.y = 0.02;
  (grid.material as THREE.Material).opacity = 0.25;
  (grid.material as THREE.Material).transparent = true;
  scene.add(grid);

  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x5c6670,
    roughness: 0.55,
    metalness: 0.55,
  });
  const crateMat = new THREE.MeshStandardMaterial({
    color: 0x6b5338,
    roughness: 0.9,
    metalness: 0.1,
  });

  const colliders = new THREE.Group();
  scene.add(colliders);

  const containerColors = [0xb84a2a, 0x2f6f8f, 0xc4a035, 0x4a5c4a, 0x8b4513];
  let colorIdx = 0;

  for (const b of MAP_BOXES) {
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const d = b.maxZ - b.minZ;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    let mat: THREE.Material = steelMat;
    if (h >= 2.4 && h <= 5.5 && w >= 4) {
      mat = new THREE.MeshStandardMaterial({
        color: containerColors[colorIdx++ % containerColors.length],
        roughness: 0.7,
        metalness: 0.35,
      });
    } else if (h <= 1.5) mat = crateMat;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    colliders.add(mesh);

    if (h >= 2.4 && h <= 5.5 && w >= 4) {
      const rib = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.98, 0.08, d * 0.98),
        new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.4 }),
      );
      rib.position.set(cx, b.minY + h * 0.5, cz);
      colliders.add(rib);
    }
  }

  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 2.5, 8),
    new THREE.MeshStandardMaterial({ color: 0xe85d04, emissive: 0xe85d04, emissiveIntensity: 0.6 }),
  );
  beacon.position.set(0, 10.5, 0);
  scene.add(beacon);

  const players = new Map<string, THREE.Group>();
  /** Latest authoritative pose from snapshots — rendered with smoothing. */
  const poseTargets = new Map<
    string,
    { x: number; y: number; z: number; yaw: number; hard?: boolean }
  >();
  const viewmodel = createViewmodel();
  camera.add(viewmodel.root);
  scene.add(camera);
  viewmodel.setVisible(false);

  function getOrCreatePlayer(id: string, kind: "human" | "jev"): THREE.Group {
    let g = players.get(id);
    if (g) return g;
    g = createOperator(kind);
    scene.add(g);
    players.set(id, g);
    return g;
  }

  function syncPlayers(
    entities: {
      id: string;
      kind: "human" | "jev";
      x: number;
      y: number;
      z: number;
      yaw: number;
      alive: boolean;
    }[],
    hideId: string | null,
    opts?: { showDead?: boolean },
  ) {
    const seen = new Set<string>();
    const showDead = opts?.showDead ?? false;
    for (const e of entities) {
      seen.add(e.id);
      const g = getOrCreatePlayer(e.id, e.kind);
      g.visible = e.id !== hideId && (e.alive || showDead);

      const prev = poseTargets.get(e.id);
      const jump =
        !prev ||
        Math.hypot(e.x - prev.x, e.y - prev.y, e.z - prev.z) > 3.5 ||
        !g.visible;
      poseTargets.set(e.id, { x: e.x, y: e.y, z: e.z, yaw: e.yaw, hard: jump });
      if (jump) {
        g.position.set(e.x, e.y, e.z);
        g.rotation.y = -e.yaw + Math.PI / 2;
      }
    }
    for (const [id, g] of players) {
      if (!seen.has(id)) {
        scene.remove(g);
        players.delete(id);
        poseTargets.delete(id);
      }
    }
  }

  function lerpAngle(a: number, b: number, t: number): number {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  function smoothPlayers(dt: number): void {
    // High rate tracks 20Hz snaps closely without the stair-step jitter.
    const a = 1 - Math.exp(-18 * dt);
    for (const [id, g] of players) {
      const t = poseTargets.get(id);
      if (!t || !g.visible) continue;
      if (t.hard) {
        g.position.set(t.x, t.y, t.z);
        g.rotation.y = -t.yaw + Math.PI / 2;
        t.hard = false;
        continue;
      }
      g.position.x += (t.x - g.position.x) * a;
      g.position.y += (t.y - g.position.y) * a;
      g.position.z += (t.z - g.position.z) * a;
      const curYaw = -(g.rotation.y - Math.PI / 2);
      const nextYaw = lerpAngle(curYaw, t.yaw, a);
      g.rotation.y = -nextYaw + Math.PI / 2;
    }
  }

  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffee88 });
  let tracer: THREE.Line | null = null;
  let tracerLife = 0;

  function showTracer(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
  ) {
    if (tracer) scene.remove(tracer);
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(ox, oy, oz),
      new THREE.Vector3(ox + dx * 80, oy + dy * 80, oz + dz * 80),
    ]);
    tracer = new THREE.Line(geo, tracerMat);
    scene.add(tracer);
    tracerLife = 0.12;
  }

  function updateTracers(dt: number) {
    if (tracer) {
      tracerLife -= dt;
      if (tracerLife <= 0) {
        scene.remove(tracer);
        tracer = null;
      }
    }
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", onResize);

  function setPlayerPose(
    id: string,
    pose: { x: number; y: number; z: number; yaw: number },
    visible: boolean,
  ) {
    const kind = id === "jev" ? "jev" : "human";
    const g = getOrCreatePlayer(id, kind);
    g.visible = visible;
    g.position.set(pose.x, pose.y, pose.z);
    g.rotation.y = -pose.yaw + Math.PI / 2;
    poseTargets.set(id, { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, hard: true });
  }

  /** Interpolated pose for chase cams / UI (after `update`). */
  function getRenderPose(id: string | null | undefined): {
    x: number;
    y: number;
    z: number;
    yaw: number;
  } | null {
    if (!id) return null;
    const g = players.get(id);
    if (g) {
      return {
        x: g.position.x,
        y: g.position.y,
        z: g.position.z,
        yaw: -(g.rotation.y - Math.PI / 2),
      };
    }
    const t = poseTargets.get(id);
    return t ? { x: t.x, y: t.y, z: t.z, yaw: t.yaw } : null;
  }

  return {
    renderer,
    scene,
    camera,
    syncPlayers,
    setPlayerPose,
    getRenderPose,
    showTracer,
    updateTracers,
    viewmodel,
    bounds: MAP_BOUNDS,
    update(dt: number) {
      smoothPlayers(dt);
      updateOperators(players.values(), dt);
    },
    render() {
      renderer.render(scene, camera);
    },
  };
}

export type World = ReturnType<typeof createWorld>;
