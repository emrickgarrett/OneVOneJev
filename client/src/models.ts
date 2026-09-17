import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const gunmetal = () =>
  new THREE.MeshStandardMaterial({ color: 0x2a2e32, metalness: 0.85, roughness: 0.35 });
const darkPoly = () =>
  new THREE.MeshStandardMaterial({ color: 0x1a1c1e, metalness: 0.4, roughness: 0.55 });
const wood = () =>
  new THREE.MeshStandardMaterial({ color: 0x5c4030, metalness: 0.05, roughness: 0.85 });
const brass = () =>
  new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 0.9, roughness: 0.3 });
const glass = () =>
  new THREE.MeshStandardMaterial({
    color: 0x88aacc,
    metalness: 0.2,
    roughness: 0.15,
    transparent: true,
    opacity: 0.55,
  });

/** Quaternius Ultimate Guns Pack sniper — CC0 (see public/models/CREDITS.txt). */
const SNIPER_URL = "/models/sniper.glb";

let sniperTemplate: THREE.Group | null = null;
let sniperLoad: Promise<THREE.Group> | null = null;
const sniperSlots: THREE.Group[] = [];

function ensureSniperLoaded(): Promise<THREE.Group> {
  if (sniperTemplate) return Promise.resolve(sniperTemplate);
  if (sniperLoad) return sniperLoad;

  sniperLoad = new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      SNIPER_URL,
      (gltf) => {
        const root = new THREE.Group();
        root.add(gltf.scene);
        // Quaternius units are large; normalize to ~1m barrel length.
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        box.getSize(size);
        const longest = Math.max(size.x, size.y, size.z) || 1;
        root.scale.setScalar(1.05 / longest);
        box.setFromObject(root);
        const center = new THREE.Vector3();
        box.getCenter(center);
        root.position.sub(center);
        // Sit grip near origin; barrel along +X like the procedural kit.
        root.position.y += 0.04;

        root.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
              if (m && "metalness" in m) {
                const std = m as THREE.MeshStandardMaterial;
                std.metalness = Math.max(std.metalness ?? 0, 0.35);
                std.roughness = Math.min(std.roughness ?? 1, 0.55);
                std.needsUpdate = true;
              }
            }
          }
        });

        sniperTemplate = root;
        for (const slot of sniperSlots) fillSniperSlot(slot);
        resolve(root);
      },
      undefined,
      (err) => {
        console.warn("[models] sniper.glb failed, using procedural fallback", err);
        reject(err);
      },
    );
  });

  return sniperLoad;
}

function fillSniperSlot(slot: THREE.Group): void {
  while (slot.children.length) slot.remove(slot.children[0]!);
  if (sniperTemplate) {
    slot.add(sniperTemplate.clone(true));
  } else {
    slot.add(createProceduralSniper());
  }
}

/** Bolt-action sniper — GLB when ready, procedural until then. */
export function createSniperRifle(): THREE.Group {
  const slot = new THREE.Group();
  sniperSlots.push(slot);
  fillSniperSlot(slot);
  void ensureSniperLoaded().catch(() => {
    /* procedural already in slot */
  });
  return slot;
}

/** Kick off asset load early (call from world bootstrap). */
export function preloadModels(): void {
  void ensureSniperLoaded().catch(() => undefined);
}

/** Procedural kitbash fallback if the GLB is missing. */
function createProceduralSniper(): THREE.Group {
  const gun = new THREE.Group();
  const steel = gunmetal();
  const poly = darkPoly();
  const stock = wood();

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.85, 10), steel);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0.42, 0.04, 0);
  gun.add(barrel);

  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.024, 0.08, 10), poly);
  muzzle.rotation.z = Math.PI / 2;
  muzzle.position.set(0.88, 0.04, 0);
  gun.add(muzzle);

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.07, 0.05), steel);
  receiver.position.set(0.05, 0.03, 0);
  gun.add(receiver);

  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8), brass());
  bolt.rotation.z = Math.PI / 2;
  bolt.position.set(0.02, 0.07, 0.04);
  gun.add(bolt);
  const boltKnob = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), brass());
  boltKnob.position.set(-0.02, 0.07, 0.07);
  gun.add(boltKnob);

  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.035), poly);
  mag.position.set(0.02, -0.04, 0);
  gun.add(mag);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.04), poly);
  grip.position.set(-0.06, -0.06, 0);
  grip.rotation.z = 0.35;
  gun.add(grip);

  const stockBody = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.045), stock);
  stockBody.position.set(-0.28, 0.01, 0);
  gun.add(stockBody);
  const stockPad = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.05), poly);
  stockPad.position.set(-0.46, 0.0, 0);
  gun.add(stockPad);

  const scopeTube = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 12), poly);
  scopeTube.rotation.z = Math.PI / 2;
  scopeTube.position.set(0.12, 0.1, 0);
  gun.add(scopeTube);
  const scopeFront = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.028, 0.04, 12), steel);
  scopeFront.rotation.z = Math.PI / 2;
  scopeFront.position.set(0.24, 0.1, 0);
  gun.add(scopeFront);
  const scopeLens = new THREE.Mesh(new THREE.CircleGeometry(0.022, 16), glass());
  scopeLens.rotation.y = Math.PI / 2;
  scopeLens.position.set(0.26, 0.1, 0);
  gun.add(scopeLens);

  const bipodL = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 6), steel);
  bipodL.position.set(0.35, -0.04, 0.04);
  bipodL.rotation.z = 0.4;
  gun.add(bipodL);
  const bipodR = bipodL.clone();
  bipodR.position.z = -0.04;
  bipodR.rotation.z = -0.4;
  gun.add(bipodR);

  gun.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return gun;
}

function limb(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  y: number,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.y = y;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Third-person operator with held sniper. */
export function createOperator(kind: "human" | "jev"): THREE.Group {
  const root = new THREE.Group();
  const isJev = kind === "jev";
  const suit = new THREE.MeshStandardMaterial({
    color: isJev ? 0xc45a12 : 0x3d5a45,
    roughness: 0.7,
    metalness: 0.15,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: isJev ? 0xe85d04 : 0x2e7d32,
    roughness: 0.5,
    metalness: 0.25,
  });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd4b896, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.6 });

  const hips = limb(0.38, 0.22, 0.24, suit, 0.72);
  root.add(hips);
  const torso = limb(0.42, 0.48, 0.26, suit, 1.1);
  root.add(torso);
  const vest = limb(0.44, 0.28, 0.28, accent, 1.12);
  root.add(vest);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 16), skin);
  head.position.y = 1.52;
  head.castShadow = true;
  root.add(head);

  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    dark,
  );
  helmet.position.y = 1.56;
  root.add(helmet);

  if (isJev) {
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.06, 0.14),
      new THREE.MeshStandardMaterial({
        color: 0xe85d04,
        emissive: 0xe85d04,
        emissiveIntensity: 0.45,
        metalness: 0.6,
        roughness: 0.2,
      }),
    );
    visor.position.set(0, 1.54, 0.12);
    root.add(visor);
  }

  const legL = limb(0.14, 0.55, 0.16, suit, 0.3);
  legL.position.x = -0.1;
  root.add(legL);
  const legR = limb(0.14, 0.55, 0.16, suit, 0.3);
  legR.position.x = 0.1;
  root.add(legR);

  const bootL = limb(0.15, 0.1, 0.22, dark, 0.05);
  bootL.position.set(-0.1, 0.05, 0.02);
  root.add(bootL);
  const bootR = limb(0.15, 0.1, 0.22, dark, 0.05);
  bootR.position.set(0.1, 0.05, 0.02);
  root.add(bootR);

  const armL = limb(0.12, 0.42, 0.12, suit, 1.05);
  armL.position.set(-0.3, 1.05, 0);
  armL.rotation.z = 0.25;
  root.add(armL);
  const armR = limb(0.12, 0.42, 0.12, suit, 1.05);
  armR.position.set(0.3, 1.05, 0.05);
  armR.rotation.z = -0.55;
  armR.rotation.x = -0.9;
  root.add(armR);

  const rifle = createSniperRifle();
  rifle.scale.setScalar(0.95);
  rifle.position.set(0.22, 1.05, 0.35);
  rifle.rotation.y = Math.PI / 2;
  rifle.rotation.x = -0.15;
  rifle.rotation.z = 0.05;
  root.add(rifle);

  return root;
}

/** First-person viewmodel parented to the camera. */
export function createViewmodel(): {
  root: THREE.Group;
  setAds: (ads: number) => void;
  update: (dt: number, moving: boolean, time: number) => void;
  setVisible: (v: boolean) => void;
} {
  const root = new THREE.Group();
  const rifle = createSniperRifle();
  rifle.scale.setScalar(1.2);
  // Rest pose: lower-right of view
  rifle.position.set(0.28, -0.28, -0.55);
  rifle.rotation.set(0.08, Math.PI * 0.52, 0.12);
  root.add(rifle);

  const hands = new THREE.MeshStandardMaterial({ color: 0xc4a882, roughness: 0.8 });
  const handR = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.12), hands);
  handR.position.set(0.12, -0.32, -0.42);
  handR.rotation.set(0.4, 0.2, 0.3);
  root.add(handR);
  const handL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.12), hands);
  handL.position.set(0.02, -0.26, -0.62);
  handL.rotation.set(0.2, -0.1, -0.4);
  root.add(handL);

  let ads = 0;
  const hipPos = new THREE.Vector3(0, 0, 0);
  const adsHide = new THREE.Vector3(0, -0.8, 0.2);

  return {
    root,
    setAds(v: number) {
      ads = Math.max(0, Math.min(1, v));
    },
    setVisible(v: boolean) {
      root.visible = v;
    },
    update(dt: number, moving: boolean, time: number) {
      const bob = moving ? Math.sin(time * 9) * 0.012 : Math.sin(time * 1.5) * 0.004;
      const sway = moving ? Math.cos(time * 4.5) * 0.008 : 0;
      const t = ads * ads;
      root.position.lerpVectors(hipPos, adsHide, t);
      root.position.y += bob * (1 - t);
      root.position.x += sway * (1 - t);
      // Fade out when scoped
      root.visible = ads < 0.85;
      void dt;
    },
  };
}
