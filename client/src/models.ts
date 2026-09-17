import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { PLAYER_HEIGHT } from "@onevonejev/shared";

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
/** Quaternius Character Animated (Rogue) — CC0. */
const CHARACTER_URL = "/models/character.glb";

let sniperTemplate: THREE.Group | null = null;
let sniperLoad: Promise<THREE.Group> | null = null;
const sniperSlots: THREE.Group[] = [];

type CharAsset = {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
  height: number;
};
let charAsset: CharAsset | null = null;
let charLoad: Promise<CharAsset> | null = null;
const charPending: Array<{
  root: THREE.Group;
  kind: "human" | "jev";
}> = [];

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
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        box.getSize(size);
        const longest = Math.max(size.x, size.y, size.z) || 1;
        root.scale.setScalar(1.05 / longest);
        box.setFromObject(root);
        const center = new THREE.Vector3();
        box.getCenter(center);
        root.position.sub(center);
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

function ensureCharacterLoaded(): Promise<CharAsset> {
  if (charAsset) return Promise.resolve(charAsset);
  if (charLoad) return charLoad;

  charLoad = new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      CHARACTER_URL,
      (gltf) => {
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = new THREE.Vector3();
        box.getSize(size);
        charAsset = {
          scene: gltf.scene,
          animations: gltf.animations,
          height: size.y || 1,
        };
        for (const p of charPending.splice(0)) {
          mountCharacter(p.root, p.kind);
        }
        resolve(charAsset);
      },
      undefined,
      (err) => {
        console.warn("[models] character.glb failed, using procedural fallback", err);
        reject(err);
      },
    );
  });

  return charLoad;
}

/** Kick off asset load early (call from world bootstrap). */
export function preloadModels(): void {
  void ensureSniperLoaded().catch(() => undefined);
  void ensureCharacterLoaded().catch(() => undefined);
}

function tintOperator(root: THREE.Object3D, kind: "human" | "jev"): void {
  // Mild accent grades — preserve albedo/maps. Heavy lerp + body emissive
  // previously washed Quaternius materials into bright pink/magenta.
  const accent = new THREE.Color(kind === "jev" ? 0xb85a20 : 0x4a6b52);
  const strength = kind === "jev" ? 0.26 : 0.18;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const next = mats.map((m) => {
      const src = m as THREE.MeshStandardMaterial;
      const c = src.clone();
      if (c.color) {
        // Light materials (skin, cloth highlights) get a softer grade so they
        // don't flip toward coral/magenta under orange accents.
        const lum = 0.2126 * c.color.r + 0.7152 * c.color.g + 0.0722 * c.color.b;
        const localStrength = lum > 0.5 ? strength * 0.4 : strength;
        c.color.lerp(accent, localStrength);
      }
      if ("emissive" in c) {
        // Drop full-body glow; keep model lit by the scene only.
        c.emissive.setHex(0x000000);
        if ("emissiveIntensity" in c) c.emissiveIntensity = 0;
      }
      c.needsUpdate = true;
      return c;
    });
    o.material = Array.isArray(o.material) ? next : next[0]!;
  });
}

function attachRifleToHand(character: THREE.Object3D): void {
  const hand =
    character.getObjectByName("FistR") ??
    character.getObjectByName("HandR") ??
    character.getObjectByName("mixamorigRightHand");
  const rifle = createSniperRifle();

  if (hand) {
    // Quaternius armature is exported at scale 100 — parenting without
    // compensating makes the gun gigantic and clip through the floor.
    character.updateMatrixWorld(true);
    const worldScale = new THREE.Vector3();
    hand.getWorldScale(worldScale);
    const inv = 1 / Math.max(Math.abs(worldScale.x), 1e-4);
    // Template is ~1.05 units long; aim for ~0.9m in world space.
    rifle.scale.setScalar(0.9 * inv);
    rifle.position.set(0.06 * inv, 0.02 * inv, 0.04 * inv);
    rifle.rotation.set(0, Math.PI / 2, -Math.PI / 2);
    hand.add(rifle);
  } else {
    rifle.scale.setScalar(0.9);
    rifle.position.set(0.28, 1.1, 0.32);
    rifle.rotation.y = Math.PI / 2;
    character.add(rifle);
  }
}

function playIdle(root: THREE.Group, character: THREE.Object3D, clips: THREE.AnimationClip[]): void {
  const mixer = new THREE.AnimationMixer(character);
  const idle =
    clips.find((c) => c.name === "Idle") ??
    clips.find((c) => /idle/i.test(c.name) && !/attack/i.test(c.name)) ??
    clips[0];
  if (idle) {
    const action = mixer.clipAction(idle);
    action.play();
  }
  root.userData.mixer = mixer;
}

function mountCharacter(root: THREE.Group, kind: "human" | "jev"): void {
  if (!charAsset) return;
  while (root.children.length) root.remove(root.children[0]!);

  const character = cloneSkinned(charAsset.scene) as THREE.Object3D;
  const scale = PLAYER_HEIGHT / charAsset.height;
  character.scale.setScalar(scale);

  // Ground the feet at y = 0.
  const box = new THREE.Box3().setFromObject(character);
  character.position.y -= box.min.y;

  tintOperator(character, kind);
  attachRifleToHand(character);
  playIdle(root, character, charAsset.animations);
  root.add(character);
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

function createProceduralOperator(kind: "human" | "jev"): THREE.Group {
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

  root.add(limb(0.38, 0.22, 0.24, suit, 0.72));
  root.add(limb(0.42, 0.48, 0.26, suit, 1.1));
  root.add(limb(0.44, 0.28, 0.28, accent, 1.12));

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

/** Third-person operator — Quaternius character GLB when ready. */
export function createOperator(kind: "human" | "jev"): THREE.Group {
  const root = new THREE.Group();
  root.userData.kind = kind;

  if (charAsset) {
    mountCharacter(root, kind);
  } else {
    root.add(createProceduralOperator(kind));
    charPending.push({ root, kind });
    void ensureCharacterLoaded().catch(() => undefined);
  }

  return root;
}

/** Advance character animation mixers. */
export function updateOperators(roots: Iterable<THREE.Object3D>, dt: number): void {
  for (const root of roots) {
    const mixer = root.userData.mixer as THREE.AnimationMixer | undefined;
    mixer?.update(dt);
  }
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
      root.visible = ads < 0.85;
      void dt;
    },
  };
}
