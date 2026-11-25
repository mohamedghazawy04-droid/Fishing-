import * as THREE from 'three';
import type { ProceduralTextureSet } from './textures';
import { FISH_SPECIES, type FishSpecies } from '../types/fishing';
import { createSpeciesScaleTexture } from './fishSystem';

interface DropletParticle {
  mesh: THREE.Mesh;
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  maxAge: number;
  baseRadius: number;
  isMicroSplash: boolean;
}

interface WetRingDecal {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  active: boolean;
  age: number;
  maxAge: number;
}

export interface FishDripAndKeepnetSystem {
  group: THREE.Group;
  boatKeepnetGroup: THREE.Group;
  onFishEmerged: (fishWorldPos: THREE.Vector3, fishScale: number) => void;
  onPlaceInKeepnet: (
    startWorldPos: THREE.Vector3,
    species: FishSpecies,
    fishScale: number,
    isOnBoat: boolean,
  ) => void;
  getCutawayPose: (
    isOnBoat: boolean,
    boatRoot: THREE.Object3D,
    outCamPos: THREE.Vector3,
    outLookAt: THREE.Vector3,
  ) => void;
  update: (params: {
    dt: number;
    elapsed: number;
    isCaughtShowcase: boolean;
    fishWorldPos: THREE.Vector3 | null;
    fishYaw: number;
    fishScale: number;
    isOnBoat: boolean;
    boatRoot: THREE.Object3D;
    getWaterSurfaceY: (x: number, z: number) => number;
    onWaterRipple: (x: number, z: number, strength: number) => void;
    onWaterDripSound?: (pan: number, intensity: number) => void;
    onKeepnetDropSound?: (pan: number) => void;
  }) => void;
  dispose: () => void;
}

function createPlayerWickerBasketTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#8b6336';
  ctx.fillRect(0, 0, 256, 256);

  const rowH = 16;
  const colW = 24;
  for (let r = 0; r < 256 / rowH; r++) {
    const y = r * rowH;
    for (let c = -1; c < 256 / colW + 1; c++) {
      const x = c * colW + (r % 2) * (colW * 0.5);
      const shade = ((r * 7 + c * 13) % 5) * 6;
      ctx.fillStyle = `rgb(${156 + shade}, ${112 + shade}, ${62 + Math.floor(shade * 0.6)})`;
      ctx.fillRect(x + 1, y + 2, colW - 3, rowH - 4);
      ctx.strokeStyle = 'rgba(48, 30, 12, 0.48)';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x + 1, y + 2, colW - 3, rowH - 4);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  return tex;
}

function buildKeepnetMesh(
  radius: number,
  height: number,
  woodMat: THREE.Material,
  wickerMat: THREE.Material,
  innerDarkMat: THREE.Material,
  wireMat: THREE.Material,
  ropeMat: THREE.Material,
  shadowMat: THREE.Material,
  disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[],
): { cageRoot: THREE.Group; lidPivot: THREE.Group; innerFishGroup: THREE.Group } {
  const cageRoot = new THREE.Group();

  const baseRingGeo = new THREE.TorusGeometry(radius, 0.018, 8, 20);
  baseRingGeo.rotateX(Math.PI / 2);
  const midRingGeo = new THREE.TorusGeometry(radius * 0.98, 0.012, 6, 20);
  midRingGeo.rotateX(Math.PI / 2);
  const wallGeo = new THREE.CylinderGeometry(radius, radius * 0.80, height, 18, 2, true);
  const floorGeo = new THREE.CircleGeometry(radius * 0.80, 18);
  floorGeo.rotateX(-Math.PI / 2);
  const shadowGeo = new THREE.PlaneGeometry(radius * 2.8, radius * 2.8);
  shadowGeo.rotateX(-Math.PI / 2);
  const strutGeo = new THREE.CylinderGeometry(0.007, 0.007, height, 5);
  const handleGeo = new THREE.TorusGeometry(radius * 0.34, 0.011, 6, 12, Math.PI);
  disposables.push(baseRingGeo, midRingGeo, wallGeo, floorGeo, shadowGeo, strutGeo, handleGeo);

  const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
  contactShadow.position.y = 0.003;
  cageRoot.add(contactShadow);

  const innerFloor = new THREE.Mesh(floorGeo, innerDarkMat);
  innerFloor.position.y = 0.01;
  innerFloor.receiveShadow = true;
  cageRoot.add(innerFloor);

  // Dark inner lining near bottom so stacked fish look nestled inside a deep basket
  const innerShadowRim = new THREE.Mesh(floorGeo, innerDarkMat);
  innerShadowRim.position.y = height * 0.28;
  innerShadowRim.scale.setScalar(1.03);
  cageRoot.add(innerShadowRim);

  // Woven wicker wall ("سبت الصيد")
  const wickerWall = new THREE.Mesh(wallGeo, wickerMat);
  wickerWall.position.y = height * 0.5;
  wickerWall.castShadow = true;
  wickerWall.receiveShadow = true;
  cageRoot.add(wickerWall);

  // Structural bamboo/timber hoops
  for (const frac of [0.04, 0.48, 0.98]) {
    const ring = new THREE.Mesh(frac > 0.9 || frac < 0.1 ? baseRingGeo : midRingGeo, woodMat);
    ring.position.y = height * frac;
    ring.castShadow = true;
    cageRoot.add(ring);
  }

  // 4 Vertical accent struts
  for (let i = 0; i < 4; i++) {
    const ang = (i * Math.PI) / 2 + Math.PI / 4;
    const strut = new THREE.Mesh(strutGeo, wireMat);
    strut.position.set(Math.cos(ang) * radius * 0.90, height * 0.5, Math.sin(ang) * radius * 0.90);
    strut.castShadow = true;
    cageRoot.add(strut);
  }

  // Hinged open woven collar rim
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, height, -radius);
  const lidRing = new THREE.Mesh(baseRingGeo, woodMat);
  lidRing.position.set(0, 0, radius);
  lidPivot.rotation.x = -0.92; // Propped open clearly to receive caught fish
  lidPivot.add(lidRing);
  cageRoot.add(lidPivot);

  // Side rope handles
  for (const hSide of [-1, 1]) {
    const handle = new THREE.Mesh(handleGeo, ropeMat);
    handle.position.set(hSide * radius * 0.94, height * 0.84, 0);
    handle.rotation.y = Math.PI / 2;
    handle.rotation.z = hSide * -0.45;
    cageRoot.add(handle);
  }

  // Caught fish replicas resting visibly inside the open wicker basket
  const innerFishGroup = new THREE.Group();
  innerFishGroup.visible = false;
  innerFishGroup.position.set(0, height * 0.34, 0);
  cageRoot.add(innerFishGroup);

  return { cageRoot, lidPivot, innerFishGroup };
}

export function createFishDripAndKeepnetSystem(textures: ProceduralTextureSet): FishDripAndKeepnetSystem {
  const group = new THREE.Group();
  const boatKeepnetGroup = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    disposables.push(m);
    return m;
  };

  // Wicker Basket Materials
  const wickerTex = createPlayerWickerBasketTexture();
  disposables.push(wickerTex);
  const wickerMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: wickerTex,
      roughness: 0.84,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
  );
  const bambooMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.woodPlankMap,
      color: 0x734d26,
      roughness: 0.82,
      metalness: 0.04,
    }),
  );
  const innerDarkMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1e1309,
      roughness: 0.96,
    }),
  );
  const wireMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x5c3e20,
      roughness: 0.72,
      metalness: 0.12,
    }),
  );
  const ropeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xc2aa82,
      roughness: 0.92,
    }),
  );
  const steelHookMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xdce6ee,
      roughness: 0.2,
      metalness: 0.9,
    }),
  );
  const shadowMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: textures.contactShadowMap,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    }),
  );

  // Pre-build high-detail scale textures for all species
  const speciesTextures = new Map<string, THREE.CanvasTexture>();
  for (const sp of FISH_SPECIES) {
    const tex = createSpeciesScaleTexture(sp);
    speciesTextures.set(sp.id, tex);
    disposables.push(tex);
  }

  // 1. Pier Wicker Basket ("سبت الصيد") beside fisherman's left side on wooden planks (-0.86, 0.72, 1.38)
  const pierCage = buildKeepnetMesh(0.25, 0.42, bambooMat, wickerMat, innerDarkMat, wireMat, ropeMat, shadowMat, disposables);
  pierCage.cageRoot.position.set(-0.86, 0.72, 1.38);
  pierCage.cageRoot.rotation.y = 0.25;
  group.add(pierCage.cageRoot);

  // 2. Boat Wicker Basket seated on boat cockpit floor (-0.42, -0.14, -0.24)
  const boatCage = buildKeepnetMesh(0.21, 0.36, bambooMat, wickerMat, innerDarkMat, wireMat, ropeMat, shadowMat, disposables);
  boatCage.cageRoot.position.set(-0.42, -0.14, -0.24);
  boatCage.cageRoot.rotation.y = 0.3;
  boatKeepnetGroup.add(boatCage.cageRoot);

  // Anatomical Multi-Part Fish Geometries for the animated kept fish & stored basket replicas
  const fishProfile = [
    new THREE.Vector2(0.0, -0.44),
    new THREE.Vector2(0.032, -0.38),
    new THREE.Vector2(0.054, -0.28),
    new THREE.Vector2(0.092, -0.15),
    new THREE.Vector2(0.128, -0.01),
    new THREE.Vector2(0.132, 0.14),
    new THREE.Vector2(0.112, 0.27),
    new THREE.Vector2(0.078, 0.37),
    new THREE.Vector2(0.036, 0.43),
    new THREE.Vector2(0.0, 0.45),
  ];
  const fishBodyGeo = trackGeo(new THREE.LatheGeometry(fishProfile, 18));
  fishBodyGeo.rotateX(Math.PI / 2);
  fishBodyGeo.scale(0.62, 1.0, 1.0);

  const tailShape = new THREE.Shape();
  tailShape.moveTo(0, 0.018);
  tailShape.lineTo(-0.22, 0.17);
  tailShape.lineTo(-0.14, 0.01);
  tailShape.lineTo(-0.14, -0.01);
  tailShape.lineTo(-0.22, -0.17);
  tailShape.lineTo(0, -0.018);
  tailShape.closePath();
  const fishTailGeo = trackGeo(new THREE.ExtrudeGeometry(tailShape, { depth: 0.008, bevelEnabled: false }));
  fishTailGeo.rotateY(Math.PI / 2);
  fishTailGeo.translate(-0.004, 0, 0);

  const dorsalShape = new THREE.Shape();
  dorsalShape.moveTo(0, 0);
  dorsalShape.lineTo(-0.04, 0.13);
  dorsalShape.lineTo(-0.21, 0.10);
  dorsalShape.lineTo(-0.25, 0.01);
  dorsalShape.closePath();
  const fishDorsalGeo = trackGeo(new THREE.ExtrudeGeometry(dorsalShape, { depth: 0.007, bevelEnabled: false }));
  fishDorsalGeo.rotateY(Math.PI / 2);
  fishDorsalGeo.translate(-0.0035, 0.098, 0.07);

  const analShape = new THREE.Shape();
  analShape.moveTo(0, 0);
  analShape.lineTo(-0.04, -0.08);
  analShape.lineTo(-0.13, -0.05);
  analShape.lineTo(-0.15, 0);
  analShape.closePath();
  const fishAnalGeo = trackGeo(new THREE.ExtrudeGeometry(analShape, { depth: 0.006, bevelEnabled: false }));
  fishAnalGeo.rotateY(Math.PI / 2);
  fishAnalGeo.translate(-0.003, -0.078, -0.14);

  const fishPecGeo = trackGeo(new THREE.PlaneGeometry(0.14, 0.08));
  const fishIrisGeo = trackGeo(new THREE.SphereGeometry(0.024, 8, 8));
  const fishPupilGeo = trackGeo(new THREE.SphereGeometry(0.015, 6, 6));
  const fishIrisMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xe2c36b, roughness: 0.2, metalness: 0.3 }));
  const fishPupilMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x0a0d10, roughness: 0.06, metalness: 0.35 }));

  const hookShankGeo = trackGeo(new THREE.CylinderGeometry(0.005, 0.005, 0.08, 6));
  const hookCurveGeo = trackGeo(new THREE.TorusGeometry(0.024, 0.0045, 6, 12, Math.PI * 1.15));

  // 3. Detailed Species-Textured Transferring Fish + Visible Hook + Short Line
  const dropFishGroup = new THREE.Group();
  dropFishGroup.visible = false;
  const dropBodyMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: speciesTextures.get(FISH_SPECIES[0].id) ?? null,
      roughness: 0.14,
      metalness: 0.34,
    }),
  );
  const dropFinMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: FISH_SPECIES[0].finColor,
      roughness: 0.32,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
    }),
  );
  const dropBodyMesh = new THREE.Mesh(fishBodyGeo, dropBodyMat);
  dropBodyMesh.castShadow = true;
  const dropDorsalMesh = new THREE.Mesh(fishDorsalGeo, dropFinMat);
  const dropAnalMesh = new THREE.Mesh(fishAnalGeo, dropFinMat);
  const dropTailPivot = new THREE.Group();
  dropTailPivot.position.set(0, 0, -0.42);
  dropTailPivot.add(new THREE.Mesh(fishTailGeo, dropFinMat));
  dropFishGroup.add(dropBodyMesh, dropDorsalMesh, dropAnalMesh, dropTailPivot);

  for (const side of [-1, 1]) {
    const pec = new THREE.Mesh(fishPecGeo, dropFinMat);
    pec.position.set(side * 0.068, -0.025, 0.15);
    pec.rotation.set(0.3, side * -0.55, side * -0.3);
    const iris = new THREE.Mesh(fishIrisGeo, fishIrisMat);
    iris.position.set(side * 0.04, 0.032, 0.32);
    iris.scale.set(0.65, 1, 1);
    const pupil = new THREE.Mesh(fishPupilGeo, fishPupilMat);
    pupil.position.set(side * 0.048, 0.032, 0.324);
    pupil.scale.set(0.65, 1, 1);
    dropFishGroup.add(pec, iris, pupil);
  }

  // Visible Hook in the fish's lip while hovering above the basket before unhooking
  const dropHookGroup = new THREE.Group();
  dropHookGroup.position.set(0, 0.015, 0.44);
  const hShank = new THREE.Mesh(hookShankGeo, steelHookMat);
  hShank.position.set(0, 0.04, 0.012);
  const hCurve = new THREE.Mesh(hookCurveGeo, steelHookMat);
  hCurve.position.set(0, 0.002, -0.006);
  hCurve.rotation.y = Math.PI / 2;
  dropHookGroup.add(hShank, hCurve);
  dropFishGroup.add(dropHookGroup);
  group.add(dropFishGroup);

  const storedPierMeshes: THREE.Group[] = [];
  const storedBoatMeshes: THREE.Group[] = [];

  function addSpeciesReplicaToBasket(
    cageFishGroup: THREE.Group,
    storedList: THREE.Group[],
    species: FishSpecies,
    maxScaleFit: number,
  ): void {
    if (storedList.length >= 5) {
      const oldest = storedList.shift();
      if (oldest) cageFishGroup.remove(oldest);
    }
    const stored = new THREE.Group();
    const sMat = trackMat(
      new THREE.MeshStandardMaterial({
        map: speciesTextures.get(species.id) ?? null,
        roughness: 0.2,
        metalness: 0.32,
      }),
    );
    const fMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: species.finColor,
        roughness: 0.42,
        transparent: true,
        opacity: 0.88,
        side: THREE.DoubleSide,
      }),
    );
    const bMesh = new THREE.Mesh(fishBodyGeo, sMat);
    const dMesh = new THREE.Mesh(fishDorsalGeo, fMat);
    const tMesh = new THREE.Mesh(fishTailGeo, fMat);
    tMesh.position.set(0, 0, -0.41);
    stored.add(bMesh, dMesh, tMesh);

    const slot = storedList.length;
    const angle = slot * 1.45 + Math.random() * 0.45;
    stored.position.set(
      Math.cos(angle) * 0.045,
      slot * 0.032,
      Math.sin(angle) * 0.045,
    );
    stored.rotation.set(0.28 + (Math.random() - 0.5) * 0.2, angle + Math.PI * 0.5, 1.12);
    const fit = THREE.MathUtils.clamp(((species.minLengthCm + species.maxLengthCm) * 0.5) / 72, 0.35, maxScaleFit);
    stored.scale.setScalar(fit);
    cageFishGroup.add(stored);
    storedList.push(stored);
    cageFishGroup.visible = true;
  }

  // 4. Pooled 3D Glossy Water Droplets (stretch along downward velocity as glistening teardrops)
  const DROPLET_POOL = 54;
  const dropletGeo = trackGeo(new THREE.SphereGeometry(0.011, 7, 6));
  const dropletMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xe6f7ff,
      emissive: 0x1e4c63,
      emissiveIntensity: 0.28,
      roughness: 0.04,
      metalness: 0.12,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      transparent: true,
      opacity: 0.88,
    }),
  );

  const droplets: DropletParticle[] = [];
  for (let i = 0; i < DROPLET_POOL; i++) {
    const mesh = new THREE.Mesh(dropletGeo, dropletMat);
    mesh.visible = false;
    group.add(mesh);
    droplets.push({
      mesh,
      active: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      age: 0,
      maxAge: 1.0,
      baseRadius: 1.0,
      isMicroSplash: false,
    });
  }
  let dropletCursor = 0;

  // 5. Wet Splash Rings on Pier Wood when droplets hit the deck
  const WET_RING_POOL = 14;
  const wetRingGeo = trackGeo(new THREE.RingGeometry(0.012, 0.028, 12));
  wetRingGeo.rotateX(-Math.PI / 2);
  const wetRings: WetRingDecal[] = [];
  for (let i = 0; i < WET_RING_POOL; i++) {
    const mat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xbce6fa,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    const mesh = new THREE.Mesh(wetRingGeo, mat);
    mesh.visible = false;
    group.add(mesh);
    wetRings.push({
      mesh,
      mat,
      active: false,
      age: 0,
      maxAge: 0.55,
    });
  }
  let wetRingCursor = 0;

  // State
  let wetness = 0;
  let dripAccumulator = 0;
  let cageJiggle = 0;

  // Fish drop-into-basket 3.2s cinematic mini-sequence state
  let dropActive = false;
  let dropT = 0;
  const dropDuration = 3.2;
  let dropTargetIsBoat = false;
  let dropHoverDoneSplash = false;
  let dropTrailAccum = 0;
  let activeDropSpecies: FishSpecies = FISH_SPECIES[0];
  let cutawaySeqTime = 0;

  const dropStartPos = new THREE.Vector3();
  const dropHoverPos = new THREE.Vector3();
  const dropTargetPos = new THREE.Vector3();
  const tmpPt = new THREE.Vector3();
  const tmpFishAxis = new THREE.Vector3();
  const tmpBoatCageWorld = new THREE.Vector3();
  const tmpBoatCamLocal = new THREE.Vector3();
  const tmpBoatLookLocal = new THREE.Vector3();

  function spawnDroplet(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    radiusScale: number,
    isMicroSplash: boolean,
  ): void {
    const d = droplets[dropletCursor];
    dropletCursor = (dropletCursor + 1) % DROPLET_POOL;
    d.active = true;
    d.pos.set(x, y, z);
    d.vel.set(vx, vy, vz);
    d.age = 0;
    d.maxAge = isMicroSplash ? 0.28 + Math.random() * 0.14 : 1.15;
    d.baseRadius = radiusScale;
    d.isMicroSplash = isMicroSplash;
    d.mesh.position.copy(d.pos);
    d.mesh.scale.setScalar(radiusScale);
    d.mesh.visible = true;
  }

  function spawnWetRing(x: number, y: number, z: number): void {
    const wr = wetRings[wetRingCursor];
    wetRingCursor = (wetRingCursor + 1) % WET_RING_POOL;
    wr.active = true;
    wr.age = 0;
    wr.maxAge = 0.45 + Math.random() * 0.25;
    wr.mesh.position.set(x, y, z);
    wr.mesh.scale.setScalar(0.5);
    wr.mat.opacity = 0.55;
    wr.mesh.visible = true;
  }

  function emitFishBodyDroplets(
    center: THREE.Vector3,
    yaw: number,
    fishScale: number,
    count: number,
    flingStrength: number,
  ): void {
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    for (let i = 0; i < count; i++) {
      const spine = (Math.random() - 0.52) * 0.62 * fishScale;
      const bellyOff = -0.055 * fishScale - Math.random() * 0.03;
      const sideOff = (Math.random() - 0.5) * 0.06 * fishScale;

      tmpFishAxis.set(
        sideOff * cosY + spine * sinY,
        bellyOff,
        -sideOff * sinY + spine * cosY,
      );
      const px = center.x + tmpFishAxis.x;
      const py = center.y + tmpFishAxis.y;
      const pz = center.z + tmpFishAxis.z;

      const vx = (Math.random() - 0.5) * flingStrength;
      const vy = -0.15 - Math.random() * 0.45 + (flingStrength > 0.5 ? Math.random() * 0.55 : 0);
      const vz = (Math.random() - 0.5) * flingStrength;
      const r = (isNaN(fishScale) ? 1 : THREE.MathUtils.clamp(fishScale, 0.7, 1.3)) * (0.78 + Math.random() * 0.52);

      spawnDroplet(px, py, pz, vx, vy, vz, r, false);
    }
  }

  return {
    group,
    boatKeepnetGroup,
    onFishEmerged: (fishWorldPos, fishScale) => {
      wetness = 1.0;
      dripAccumulator = 0;
      emitFishBodyDroplets(fishWorldPos, 0, fishScale, 24, 0.95);
    },
    onPlaceInKeepnet: (startWorldPos, species, fishScale, isOnBoat) => {
      dropActive = true;
      dropT = 0;
      cutawaySeqTime = 0;
      dropHoverDoneSplash = false;
      dropTrailAccum = 0;
      dropTargetIsBoat = isOnBoat;
      activeDropSpecies = species;
      dropStartPos.copy(startWorldPos);

      const tex = speciesTextures.get(species.id) ?? null;
      if (dropBodyMat.map !== tex) {
        dropBodyMat.map = tex;
        dropBodyMat.needsUpdate = true;
      }
      dropFinMat.color.setHex(species.finColor);
      dropFishGroup.scale.setScalar(THREE.MathUtils.clamp(fishScale * 0.85, 0.65, 1.08));
      dropFishGroup.visible = true;
      dropHookGroup.visible = true;

      if (isOnBoat) {
        boatCage.cageRoot.updateWorldMatrix(true, false);
        boatCage.cageRoot.getWorldPosition(tmpBoatCageWorld);
        dropHoverPos.set(tmpBoatCageWorld.x, tmpBoatCageWorld.y + 0.72, tmpBoatCageWorld.z);
        dropTargetPos.set(tmpBoatCageWorld.x, tmpBoatCageWorld.y + 0.24, tmpBoatCageWorld.z);
      } else {
        dropHoverPos.set(
          pierCage.cageRoot.position.x,
          pierCage.cageRoot.position.y + 0.80,
          pierCage.cageRoot.position.z,
        );
        dropTargetPos.set(
          pierCage.cageRoot.position.x,
          pierCage.cageRoot.position.y + 0.28,
          pierCage.cageRoot.position.z,
        );
      }

      emitFishBodyDroplets(startWorldPos, 0, fishScale, 14, 0.85);
    },
    getCutawayPose: (isOnBoat, boatRoot, outCamPos, outLookAt) => {
      const pan = Math.sin(cutawaySeqTime * 0.85) * 0.16;
      const bob = Math.cos(cutawaySeqTime * 0.7) * 0.04;
      if (isOnBoat) {
        boatRoot.updateMatrixWorld(true);
        tmpBoatCamLocal.set(0.86 + pan, 1.24 + bob, -1.24);
        tmpBoatLookLocal.set(-0.36, 0.08, -0.24);
        outCamPos.copy(tmpBoatCamLocal).applyMatrix4(boatRoot.matrixWorld);
        outLookAt.copy(tmpBoatLookLocal).applyMatrix4(boatRoot.matrixWorld);
      } else {
        outCamPos.set(-2.12 + pan, 1.78 + bob, 0.28);
        outLookAt.set(-0.82, 0.98, 1.38);
      }
    },
    update: ({
      dt,
      elapsed,
      isCaughtShowcase,
      fishWorldPos,
      fishYaw,
      fishScale,
      isOnBoat,
      boatRoot,
      getWaterSurfaceY,
      onWaterRipple,
      onWaterDripSound,
      onKeepnetDropSound,
    }) => {
      // Continuous dripping while caught fish is held up out of the water
      if (isCaughtShowcase && fishWorldPos && wetness > 0.02) {
        wetness = Math.max(0, wetness - dt * 0.145);
        const dripRate = 3.0 + Math.pow(wetness, 1.55) * 28.0;
        dripAccumulator += dt * dripRate;

        while (dripAccumulator >= 1.0) {
          dripAccumulator -= 1.0;
          emitFishBodyDroplets(fishWorldPos, fishYaw, fishScale, 1, 0.24 * wetness);
        }
      } else if (!isCaughtShowcase) {
        wetness = 0;
      }

      // 3-Stage 3.2s Cutaway Animation: Swing & drip over basket -> Unhook & drop inside -> Basket wobble & settle
      if (dropActive) {
        dropT += dt / dropDuration;
        cutawaySeqTime += dt;

        if (dropTargetIsBoat) {
          boatRoot.updateMatrixWorld();
          boatCage.cageRoot.getWorldPosition(tmpBoatCageWorld);
          dropHoverPos.set(tmpBoatCageWorld.x, tmpBoatCageWorld.y + 0.72, tmpBoatCageWorld.z);
          dropTargetPos.set(tmpBoatCageWorld.x, tmpBoatCageWorld.y + 0.24, tmpBoatCageWorld.z);
        }

        const p = Math.min(1, dropT);
        dropTailPivot.rotation.y = Math.sin(elapsed * 16) * (p < 0.65 ? 0.36 : 0.1);

        if (p < 0.42) {
          // Stage 1: Swing fish over above the open wicker basket hanging from the hook, dripping water droplets
          const t = THREE.MathUtils.smoothstep(p, 0, 0.32);
          dropHookGroup.visible = true;
          tmpPt.lerpVectors(dropStartPos, dropHoverPos, t);
          tmpPt.y += Math.sin(t * Math.PI) * 0.18 + Math.sin(elapsed * 4.5) * 0.025;
          dropFishGroup.position.copy(tmpPt);
          dropFishGroup.rotation.set(
            THREE.MathUtils.lerp(0.15, 1.08, t) + Math.sin(elapsed * 7.5) * 0.08,
            Math.sin(elapsed * 4.0) * 0.24,
            Math.sin(elapsed * 9.0) * 0.12,
          );
          dropTrailAccum += dt * 22;
          while (dropTrailAccum >= 1) {
            dropTrailAccum -= 1;
            emitFishBodyDroplets(tmpPt, dropFishGroup.rotation.y, 0.85, 1, 0.32);
          }
        } else if (p < 0.72) {
          // Stage 2: Unhook cleanly and drop straight down into the open basket!
          const t = THREE.MathUtils.smoothstep(p, 0.42, 0.72);
          dropHookGroup.visible = false;
          tmpPt.lerpVectors(dropHoverPos, dropTargetPos, t * t);
          dropFishGroup.position.copy(tmpPt);
          dropFishGroup.rotation.set(
            THREE.MathUtils.lerp(1.08, 0.22, t),
            0.35 + t * 0.4,
            THREE.MathUtils.lerp(0, 1.05, t),
          );
          dropTrailAccum += dt * 30;
          while (dropTrailAccum >= 1) {
            dropTrailAccum -= 1;
            emitFishBodyDroplets(tmpPt, dropFishGroup.rotation.y, 0.82, 1, 0.48);
          }
        } else {
          // Stage 3: Land inside basket with splash burst, wobble, and leave species replica inside
          if (!dropHoverDoneSplash) {
            dropHoverDoneSplash = true;
            dropFishGroup.visible = false;
            cageJiggle = 1.0;
            addSpeciesReplicaToBasket(pierCage.innerFishGroup, storedPierMeshes, activeDropSpecies, 0.54);
            addSpeciesReplicaToBasket(boatCage.innerFishGroup, storedBoatMeshes, activeDropSpecies, 0.44);
            emitFishBodyDroplets(dropTargetPos, 0, 0.78, 18, 1.15);
            if (onKeepnetDropSound) {
              onKeepnetDropSound(dropTargetIsBoat ? -0.35 : -0.45);
            }
          }
        }

        if (dropT >= 1) {
          dropActive = false;
          dropFishGroup.visible = false;
        }
      }

      // Basket jiggle/rattle decay & hinged rim bounce
      if (cageJiggle > 0.005) {
        cageJiggle = Math.max(0, cageJiggle - dt * 2.1);
        const wobble = Math.sin(elapsed * 24) * 0.095 * cageJiggle;
        const activeCage = isOnBoat ? boatCage : pierCage;
        activeCage.cageRoot.rotation.z = wobble;
        activeCage.lidPivot.rotation.x = -0.92 + Math.abs(Math.sin(elapsed * 14)) * 0.46 * cageJiggle;
      } else {
        pierCage.cageRoot.rotation.z = 0;
        pierCage.lidPivot.rotation.x = -0.92;
        boatCage.cageRoot.rotation.z = 0;
        boatCage.lidPivot.rotation.x = -0.92;
      }

      // Update Falling 3D Teardrop Water Droplets
      for (let i = 0; i < DROPLET_POOL; i++) {
        const d = droplets[i];
        if (!d.active) continue;

        d.age += dt;
        d.vel.y -= 9.8 * dt;
        d.pos.addScaledVector(d.vel, dt);

        const speed = d.vel.length();
        const stretchY = THREE.MathUtils.clamp(1.0 + speed * 0.42, 1.0, 2.9);
        d.mesh.position.copy(d.pos);
        d.mesh.scale.set(d.baseRadius * 0.82, d.baseRadius * stretchY, d.baseRadius * 0.82);

        const onPierDeck =
          !isOnBoat &&
          Math.abs(d.pos.x) <= 1.35 &&
          d.pos.z >= -0.67 &&
          d.pos.z <= 7.17 &&
          d.pos.y <= 0.725 &&
          d.vel.y < 0;

        const boatFloorY = boatRoot.position.y - 0.125;
        const onBoatDeck =
          isOnBoat &&
          Math.hypot(d.pos.x - boatRoot.position.x, d.pos.z - boatRoot.position.z) < 0.72 &&
          d.pos.y <= boatFloorY &&
          d.vel.y < 0;

        const waterY = getWaterSurfaceY(d.pos.x, d.pos.z);

        if (onPierDeck || onBoatDeck) {
          const hitY = onPierDeck ? 0.724 : boatFloorY + 0.008;
          if (!d.isMicroSplash) {
            spawnWetRing(d.pos.x, hitY, d.pos.z);
            if (onWaterDripSound && Math.random() < 0.35) {
              onWaterDripSound(THREE.MathUtils.clamp((d.pos.x - boatRoot.position.x) * 0.35, -0.8, 0.8), 0.75);
            }
            for (let m = 0; m < 2; m++) {
              const ang = Math.random() * Math.PI * 2;
              spawnDroplet(
                d.pos.x,
                hitY + 0.008,
                d.pos.z,
                Math.cos(ang) * (0.28 + Math.random() * 0.32),
                0.45 + Math.random() * 0.35,
                Math.sin(ang) * (0.28 + Math.random() * 0.32),
                0.46,
                true,
              );
            }
          }
          d.active = false;
          d.mesh.visible = false;
        } else if (d.pos.y <= waterY + 0.01) {
          if (!d.isMicroSplash) {
            onWaterRipple(d.pos.x, d.pos.z, 0.22);
            if (onWaterDripSound && Math.random() < 0.28) {
              onWaterDripSound(THREE.MathUtils.clamp(d.pos.x * 0.25, -0.8, 0.8), 0.55);
            }
          }
          d.active = false;
          d.mesh.visible = false;
        } else if (d.age >= d.maxAge) {
          d.active = false;
          d.mesh.visible = false;
        }
      }

      // Update Wet Splash Rings on Pier Wood
      for (let i = 0; i < WET_RING_POOL; i++) {
        const wr = wetRings[i];
        if (!wr.active) continue;
        wr.age += dt;
        const p = wr.age / wr.maxAge;
        if (p >= 1) {
          wr.active = false;
          wr.mesh.visible = false;
        } else {
          wr.mesh.scale.setScalar(0.55 + p * 1.9);
          wr.mat.opacity = 0.55 * (1 - p);
        }
      }
    },
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
