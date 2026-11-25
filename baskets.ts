import * as THREE from 'three';

export interface BasketSystem {
  group: THREE.Group;
  /** Moves a copy of the caught fish from its current world position into the proper basket. */
  addFish: (
    source: THREE.Object3D,
    bodyMat: THREE.MeshStandardMaterial,
    lengthScale: number,
    rarity: string,
    fromWorld: THREE.Vector3,
  ) => void;
  update: (dt: number, elapsed: number) => void;
  dispose: () => void;
}

interface BasketFish {
  mesh: THREE.Object3D;
  ownedMats: THREE.Material[];
  age: number;
  flyTime: number;
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  toQuat: THREE.Quaternion;
  startScale: number;
  endScale: number;
}

interface BasketSlot {
  center: THREE.Vector3;
  fish: BasketFish[];
}

const MAX_PER_BASKET = 8;

function createWeaveTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#b98b4f';
  ctx.fillRect(0, 0, size, size);
  // Woven over/under pattern
  const cell = 32;
  for (let y = 0; y < size / cell; y++) {
    for (let x = 0; x < size / cell; x++) {
      const over = (x + y) % 2 === 0;
      const tone = 150 + ((x * 37 + y * 17) % 30);
      ctx.fillStyle = over ? `rgb(${tone + 40},${tone},${tone - 70})` : `rgb(${tone + 15},${tone - 18},${tone - 85})`;
      if (over) ctx.fillRect(x * cell + 2, y * cell + 4, cell - 4, cell - 8);
      else ctx.fillRect(x * cell + 4, y * cell + 2, cell - 8, cell - 4);
    }
  }
  ctx.strokeStyle = 'rgba(70,40,15,0.45)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= size; i += cell) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 2);
  tex.anisotropy = 4;
  return tex;
}

export function createBaskets(pierTopY: number): BasketSystem {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];

  const weaveTex = createWeaveTexture();
  const wickerMat = new THREE.MeshStandardMaterial({
    map: weaveTex,
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.85 });
  const liningMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 1.0 });
  mats.push(wickerMat, rimMat, liningMat);

  // Tapered woven basket body (outer wall + inner wall + floor in one lathe)
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.16, 0.0),
    new THREE.Vector2(0.205, 0.05),
    new THREE.Vector2(0.245, 0.18),
    new THREE.Vector2(0.27, 0.32),
    new THREE.Vector2(0.255, 0.325),
    new THREE.Vector2(0.232, 0.19),
    new THREE.Vector2(0.185, 0.07),
    new THREE.Vector2(0.0, 0.05),
  ];
  const bodyGeo = new THREE.LatheGeometry(profile, 32);
  const rimGeo = new THREE.TorusGeometry(0.265, 0.017, 8, 32);
  rimGeo.rotateX(Math.PI / 2);
  rimGeo.translate(0, 0.325, 0);
  const handleGeo = new THREE.TorusGeometry(0.2, 0.012, 6, 20, Math.PI);
  const floorGeo = new THREE.CircleGeometry(0.19, 24);
  floorGeo.rotateX(-Math.PI / 2);
  geos.push(bodyGeo, rimGeo, handleGeo, floorGeo);

  const buildBasket = (x: number, z: number, yaw: number): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(x, pierTopY, z);
    g.rotation.y = yaw;
    const body = new THREE.Mesh(bodyGeo, wickerMat);
    body.castShadow = true;
    body.receiveShadow = true;
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.castShadow = true;
    const floor = new THREE.Mesh(floorGeo, liningMat);
    floor.position.y = 0.055;
    g.add(body, rim, floor);
    // Two arched carry handles on opposite sides of the rim
    for (const side of [-1, 1]) {
      const h = new THREE.Mesh(handleGeo, rimMat);
      h.rotation.y = Math.PI / 2;
      h.scale.set(0.5, 0.85, 1);
      h.position.set(side * 0.268, 0.322, 0);
      h.castShadow = true;
      g.add(h);
    }
    group.add(g);
    return g;
  };

  // Common catches go left, rare/legendary catches go right
  const leftBasket = buildBasket(-0.68, 0.18, 0.35);
  const rightBasket = buildBasket(0.68, 0.18, -0.35);
  const slots: BasketSlot[] = [
    { center: leftBasket.position.clone(), fish: [] },
    { center: rightBasket.position.clone(), fish: [] },
  ];

  const retire = (fish: BasketFish): void => {
    group.remove(fish.mesh);
    for (const m of fish.ownedMats) m.dispose();
  };

  const tmpBox = new THREE.Box3();
  const tmpSize = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler();

  return {
    group,
    addFish: (source, bodyMat, lengthScale, rarity, fromWorld) => {
      const slot = slots[rarity === 'شائع' ? 0 : 1];
      const mesh = source.clone(true);
      const owned: THREE.Material[] = [];

      // Swap the animated body shader material for a static copy so the fish stays still in the basket
      mesh.traverse((child) => {
        const m = child as THREE.Mesh;
        if (m.isMesh && m.material === bodyMat) {
          const copy = new THREE.MeshStandardMaterial();
          copy.color.copy(bodyMat.color);
          copy.map = bodyMat.map;
          copy.roughness = bodyMat.roughness;
          copy.metalness = bodyMat.metalness;
          copy.bumpMap = bodyMat.bumpMap;
          copy.bumpScale = bodyMat.bumpScale;
          copy.normalMap = bodyMat.normalMap;
          copy.emissive.copy(bodyMat.emissive);
          copy.emissiveIntensity = bodyMat.emissiveIntensity;
          m.material = copy;
          owned.push(copy);
        }
        m.castShadow = true;
      });

      // Measure fish length at unit scale to size it consistently for the basket
      mesh.position.set(0, 0, 0);
      mesh.rotation.set(0, 0, 0);
      mesh.scale.setScalar(1);
      mesh.visible = true;
      mesh.updateMatrixWorld(true);
      tmpBox.setFromObject(mesh);
      tmpBox.getSize(tmpSize);
      const baseLen = Math.max(0.2, Math.max(tmpSize.x, tmpSize.z));
      const targetLen = THREE.MathUtils.clamp(0.2 + lengthScale * 0.09, 0.22, 0.4);
      const endScale = targetLen / baseLen;

      const idx = slot.fish.length;
      const layer = Math.floor(idx / 3);
      const ang = idx * 2.399 + (rarity === 'شائع' ? 0 : 1.2);
      const rad = idx % 3 === 0 ? 0.0 : 0.07 + (idx % 3) * 0.025;
      const toPos = new THREE.Vector3(
        slot.center.x + Math.cos(ang) * rad,
        slot.center.y + 0.1 + layer * 0.055,
        slot.center.z + Math.sin(ang) * rad,
      );
      // Dead fish rest on their side, at varied angles
      tmpE.set(0, ang * 1.7, (idx % 2 === 0 ? 1 : -1) * (1.25 + (idx % 3) * 0.1), 'YXZ');
      const toQuat = new THREE.Quaternion().setFromEuler(tmpE);

      // Start from where the fish currently hangs (showcase pose)
      mesh.position.copy(fromWorld);
      mesh.scale.setScalar(Math.max(0.5, source.scale.x));
      mesh.quaternion.copy(source.quaternion);
      tmpQ.copy(source.quaternion);
      group.add(mesh);

      const fish: BasketFish = {
        mesh,
        ownedMats: owned,
        age: 0,
        flyTime: 0.8,
        fromPos: fromWorld.clone(),
        toPos,
        fromQuat: tmpQ.clone(),
        toQuat,
        startScale: Math.max(0.5, source.scale.x),
        endScale,
      };
      slot.fish.push(fish);

      // Basket full: oldest fish is quietly removed so the pile never overflows
      if (slot.fish.length > MAX_PER_BASKET) {
        const old = slot.fish.shift()!;
        retire(old);
        slot.fish.forEach((f, i) => {
          const l = Math.floor(i / 3);
          const a = i * 2.399 + (rarity === 'شائع' ? 0 : 1.2);
          const r = i % 3 === 0 ? 0.0 : 0.07 + (i % 3) * 0.025;
          f.toPos.set(slot.center.x + Math.cos(a) * r, slot.center.y + 0.1 + l * 0.055, slot.center.z + Math.sin(a) * r);
          f.mesh.position.copy(f.toPos);
        });
      }
    },
    update: (dt) => {
      for (const slot of slots) {
        for (const f of slot.fish) {
          f.age += dt;
          if (f.age < f.flyTime) {
            const t = f.age / f.flyTime;
            const e = t * t * (3 - 2 * t);
            f.mesh.position.lerpVectors(f.fromPos, f.toPos, e);
            f.mesh.position.y += Math.sin(Math.PI * t) * 0.32; // graceful arc over the rim
            f.mesh.quaternion.slerpQuaternions(f.fromQuat, f.toQuat, e);
            f.mesh.scale.setScalar(THREE.MathUtils.lerp(f.startScale, f.endScale, e));
          } else {
            const settle = f.age - f.flyTime;
            f.mesh.position.copy(f.toPos);
            f.mesh.scale.setScalar(f.endScale);
            // A couple of final flops after landing, then still
            const flop = Math.exp(-settle * 3.2) * Math.sin(settle * 26) * 0.16;
            f.mesh.quaternion.copy(f.toQuat);
            if (flop !== 0 && settle < 1.6) {
              tmpE.set(0, 0, flop, 'XYZ');
              tmpQ.setFromEuler(tmpE);
              f.mesh.quaternion.multiply(tmpQ);
            }
          }
        }
      }
    },
    dispose: () => {
      for (const slot of slots) for (const f of slot.fish) retire(f);
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      weaveTex.dispose();
    },
  };
}
