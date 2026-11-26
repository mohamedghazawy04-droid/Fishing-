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
  topRadius: number,
  bottomRadius: number,
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

  const rimRingGeo = new THREE.TorusGeometry(topRadius, 0.018, 8, 22);
  rimRingGeo.rotateX(Math.PI / 2);
  const midRadius = THREE.MathUtils.lerp(bottomRadius, topRadius, 0.5);
  const midRingGeo = new THREE.TorusGeometry(midRadius, 0.012, 6, 22);
  midRingGeo.rotateX(Math.PI / 2);
  const baseRingGeo = new THREE.TorusGeometry(bottomRadius, 0.015, 6, 20);
  baseRingGeo.rotateX(Math.PI / 2);
  const wallGeo = new THREE.CylinderGeometry(topRadius, bottomRadius, height, 20, 2, true);
  const floorGeo = new THREE.CircleGeometry(bottomRadius, 20);
  floorGeo.rotateX(-Math.PI / 2);
  const shadowGeo = new THREE.PlaneGeometry(topRadius * 2.7, topRadius * 2.7);
  shadowGeo.rotateX(-Math.PI / 2);
  const strutGeo = new THREE.CylinderGeometry(0.007, 0.007, height, 5);
  const handleGeo = new THREE.TorusGeometry(topRadius * 0.30, 0.011, 6, 12, Math.PI);
  disposables.push(rimRingGeo, midRingGeo, baseRingGeo, wallGeo, floorGeo, shadowGeo, strutGeo, handleGeo);

  const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
  contactShadow.position.y = 0.003;
  cageRoot.add(contactShadow);

  const innerFloor = new THREE.Mesh(floorGeo, innerDarkMat);
  innerFloor.position.y = 0.014;
  innerFloor.receiveShadow = true;
  cageRoot.add(innerFloor);

  // Open flared woven wicker wall ("سبت صيد مفتوح") so fish piled inside remain clearly visible
  const wickerWall = new THREE.Mesh(wallGeo, wickerMat);
  wickerWall.position.y = height * 0.5;
  wickerWall.castShadow = true;
  wickerWall.receiveShadow = true;
  cageRoot.add(wickerWall);

  // Structural bamboo/timber hoops
  const botRing = new THREE.Mesh(baseRingGeo, woodMat);
  botRing.position.y = 0.016;
  botRing.castShadow = true;
  const midRing = new THREE.Mesh(midRingGeo, woodMat);
  midRing.position.y = height * 0.50;
  midRing.castShadow = true;
  const topRing = new THREE.Mesh(rimRingGeo, woodMat);
  topRing.position.y = height * 0.98;
  topRing.castShadow = true;
  cageRoot.add(botRing, midRing, topRing);

  // 4 Vertical accent ribs
  for (let i = 0; i < 4; i++) {
    const ang = (i * Math.PI) / 2 + Math.PI / 4;
    const ribR = midRadius;
    const strut = new THREE.Mesh(strutGeo, wireMat);
    strut.position.set(Math.cos(ang) * ribR, height * 0.5, Math.sin(ang) * ribR);
    strut.castShadow = true;
    cageRoot.add(strut);
  }

  // Hinged open woven collar rim flipped clear out of the way behind the basket
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, height, -topRadius);
  const lidRing = new THREE.Mesh(rimRingGeo, woodMat);
  lidRing.position.set(0, 0, topRadius);
  lidPivot.rotation.x = -1.25;
  lidPivot.add(lidRing);
  cageRoot.add(lidPivot);

  // Side rope handles
  for (const hSide of [-1, 1]) {
    const handle = new THREE.Mesh(handleGeo, ropeMat);
    handle.position.set(hSide * topRadius * 0.96, height * 0.86, 0);
    handle.rotation.y = Math.PI / 2;
    handle.rotation.z = hSide * -0.45;
    cageRoot.add(handle);
  }

  // Caught fish replicas resting visibly inside the wide open wicker basket
  const innerFishGroup = new THREE.Group();
  innerFishGroup.visible = false;
  innerFishGroup.position.set(0, 0.068, 0);
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
  const rareWickerMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: wickerTex,
      color: 0xf7d88c,
      roughness: 0.76,
      metalness: 0.08,
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
  const rareBambooMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.woodPlankMap,
      color: 0xb6812c,
      roughness: 0.62,
      metalness: 0.24,
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
  const rareWireMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd4a644,
      roughness: 0.36,
      metalness: 0.65,
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

  // 1A. Pier Left Wicker Basket ("سلة الصيد الشائع")
  const pierCommonCage = buildKeepnetMesh(0.31, 0.21, 0.25, bambooMat, wickerMat, innerDarkMat, wireMat, ropeMat, shadowMat, disposables);
  pierCommonCage.cageRoot.position.set(-0.58, 0.72, 0.08);
  pierCommonCage.cageRoot.rotation.y = 0.24;
  group.add(pierCommonCage.cageRoot);

  // 1B. Pier Right Wicker Basket ("سلة النوادر والأساطير") — clear of worm dish (0.48, 0.34) & tackle box (0.72, 1.95)
  const pierRareCage = buildKeepnetMesh(0.31, 0.21, 0.25, rareBambooMat, rareWickerMat, innerDarkMat, rareWireMat, ropeMat, shadowMat, disposables);
  pierRareCage.cageRoot.position.set(0.76, 0.72, 0.06);
  pierRareCage.cageRoot.rotation.y = -0.24;
  group.add(pierRareCage.cageRoot);

  // 2A & 2B. Boat Wicker Baskets on forward casting thwart bench (left = common, right = rare/legendary)
  const boatCommonCage = buildKeepnetMesh(0.21, 0.15, 0.20, bambooMat, wickerMat, innerDarkMat, wireMat, ropeMat, shadowMat, disposables);
  boatCommonCage.cageRoot.position.set(-0.34, 0.228, -0.92);
  boatCommonCage.cageRoot.rotation.y = 0.24;
  boatKeepnetGroup.add(boatCommonCage.cageRoot);

  const boatRareCage = buildKeepnetMesh(0.21, 0.15, 0.20, rareBambooMat, rareWickerMat, innerDarkMat, rareWireMat, ropeMat, shadowMat, disposables);
  boatRareCage.cageRoot.position.set(0.34, 0.228, -0.92);
  boatRareCage.cageRoot.rotation.y = -0.24;
  boatKeepnetGroup.add(boatRareCage.cageRoot);

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

  const storedPierCommonMeshes: THREE.Group[] = [];
  const storedPierRareMeshes: THREE.Group[] = [];
  const storedBoatCommonMeshes: THREE.Group[] = [];
  const storedBoatRareMeshes: THREE.Group[] = [];

  function addSpeciesReplicaToBasket(
    cageFishGroup: THREE.Group,
    storedList: THREE.Group[],
    species: FishSpecies,
    maxScaleFit: number,
    radialSpread: number,
  ): void {
    const stored = new THREE.Group();
    const sMat = trackMat(
      new THREE.MeshStandardMaterial({
        map: speciesTextures.get(species.id) ?? null,
        roughness: 0.18,
        metalness: 0.32,
      }),
    );
    const fMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: species.finColor,
        roughness: 0.38,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      }),
    );
    const bMesh = new THREE.Mesh(fishBodyGeo, sMat);
    bMesh.castShadow = true;
    const dMesh = new THREE.Mesh(fishDorsalGeo, fMat);
    const aMesh = new THREE.Mesh(fishAnalGeo, fMat);
    const tMesh = new THREE.Mesh(fishTailGeo, fMat);
    tMesh.position.set(0, 0, -0.41);
    stored.add(bMesh, dMesh, aMesh, tMesh);

    for (const side of [-1, 1]) {
      const pec = new THREE.Mesh(fishPecGeo, fMat);
      pec.position.set(side * 0.068, -0.025, 0.15);
      pec.rotation.set(0.3, side * -0.55, side * -0.3);
      const iris = new THREE.Mesh(fishIrisGeo, fishIrisMat);
      iris.position.set(side * 0.04, 0.032, 0.32);
      iris.scale.set(0.65, 1, 1);
      const pupil = new THREE.Mesh(fishPupilGeo, fishPupilMat);
      pupil.position.set(side * 0.048, 0.032, 0.324);
      pupil.scale.set(0.65, 1, 1);
      stored.add(pec, iris, pupil);
    }

    // Keep ALL caught fish inside the basket using golden-angle spiral layers
    const slot = storedList.length;
    const goldenAngle = slot * 2.39996;
    const layer = Math.floor(slot / 4);
    const ringFactor = slot === 0 ? 0.15 : 0.38 + ((slot % 4) / 3) * 0.42;
    const rad = Math.min(radialSpread, radialSpread * ringFactor);
    const stackY = Math.min(0.24, layer * 0.032 + (slot % 4) * 0.012);

    stored.position.set(
      Math.cos(goldenAngle) * rad,
      stackY,
      Math.sin(goldenAngle) * rad,
    );
    // Rest naturally slightly tilted/angled inside the basket so full fish bodies & tails are visible!
    stored.rotation.set(
      0.16 + ((slot % 3) - 1) * 0.14,
      goldenAngle + Math.PI * 0.45,
      1.15 + ((slot % 2) === 0 ? 0.15 : -0.15),
    );
    const fit = THREE.MathUtils.clamp(((species.minLengthCm + species.maxLengthCm) * 0.5) / 62, 0.44, maxScaleFit);
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
  let dropTargetIsRare = false;
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
      dropTargetIsRare = species.rarity !== 'شائع';
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
        const targetBoatCage = dropTargetIsRare ? boatRareCage : boatCommonCage;
        const storedList = dropTargetIsRare ? storedBoatRareMeshes : storedBoatCommonMeshes;
        targetBoatCage.cageRoot.updateWorldMatrix(true, false);
        targetBoatCage.cageRoot.getWorldPosition(tmpBoatCageWorld);
        const pileHeight = Math.min(0.18, Math.floor(storedList.length / 4) * 0.03);
        dropHoverPos.set(tmpBoatCageWorld.x, tmpBoatCageWorld.y + 0.58, tmpBoatCageWorld.z);
        dropTargetPos.set(tmpBoatCageWorld.x, tmpBoatCageWorld.y + 0.14 + pileHeight, tmpBoatCageWorld.z);
      } else {
        const targetPierCage = dropTargetIsRare ? pierRareCage : pierCommonCage;
        const storedList = dropTargetIsRare ? storedPierRareMeshes : storedPierCommonMeshes;
        const pileHeight = Math.min(0.20, Math.floor(storedList.length / 4) * 0.032);
        dropHoverPos.set(
          targetPierCage.cageRoot.position.x,
          targetPierCage.cageRoot.position.y + 0.64,
          targetPierCage.cageRoot.position.z,
        );
        dropTargetPos.set(
          targetPierCage.cageRoot.position.x,
          targetPierCage.cageRoot.position.y + 0.16 + pileHeight,
          targetPierCage.cageRoot.position.z,
        );
      }

      emitFishBodyDroplets(startWorldPos, 0, fishScale, 14, 0.85);
    },
    getCutawayPose: (isOnBoat, boatRoot, outCamPos, outLookAt) => {
      const pan = Math.sin(cutawaySeqTime * 0.85) * 0.14;
      const bob = Math.cos(cutawaySeqTime * 0.7) * 0.035;
      if (isOnBoat) {
        boatRoot.updateMatrixWorld(true);
        const targetX = dropTargetIsRare ? 0.34 : -0.34;
        const camX = dropTargetIsRare ? -0.56 : 0.56;
        tmpBoatCamLocal.set(camX + pan, 0.96 + bob, -1.78);
        tmpBoatLookLocal.set(targetX, 0.39, -0.92);
        outCamPos.copy(tmpBoatCamLocal).applyMatrix4(boatRoot.matrixWorld);
        outLookAt.copy(tmpBoatLookLocal).applyMatrix4(boatRoot.matrixWorld);
      } else if (dropTargetIsRare) {
        outCamPos.set(-0.36 + pan, 1.54 + bob, -1.04);
        outLookAt.set(0.76, 0.92, 0.06);
      } else {
        outCamPos.set(0.56 + pan, 1.54 + bob, -1.04);
        outLookAt.set(-0.58, 0.92, 0.08);
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
          const targetBoatCage = dropTargetIsRare ? boatRareCage : boatCommonCage;
          const storedList = dropTargetIsRare ? storedBoatRareMeshes : storedBoatCommonMeshes;
          targetBoatCage.cageRoot.getWorldPosition(tmpBoatCageWorld);
          const pileHeight = Math.min(0.18, Math.floor(storedList.length / 4) * 0.03);
          dropHoverPos.set(tmpBoatCageWorld.x, tmpBoatCageWorld.y + 0.58, tmpBoatCageWorld.z);
          dropTargetPos.set(tmpBoatCageWorld.x, tmpBoatCageWorld.y + 0.14 + pileHeight, tmpBoatCageWorld.z);
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
          // Stage 3: Land inside basket with splash burst, wobble, and leave species replica inside the matching rarity basket
          if (!dropHoverDoneSplash) {
            dropHoverDoneSplash = true;
            dropFishGroup.visible = false;
            cageJiggle = 1.0;
            if (dropTargetIsRare) {
              addSpeciesReplicaToBasket(pierRareCage.innerFishGroup, storedPierRareMeshes, activeDropSpecies, 0.60, 0.105);
              addSpeciesReplicaToBasket(boatRareCage.innerFishGroup, storedBoatRareMeshes, activeDropSpecies, 0.44, 0.072);
            } else {
              addSpeciesReplicaToBasket(pierCommonCage.innerFishGroup, storedPierCommonMeshes, activeDropSpecies, 0.60, 0.105);
              addSpeciesReplicaToBasket(boatCommonCage.innerFishGroup, storedBoatCommonMeshes, activeDropSpecies, 0.44, 0.072);
            }
            emitFishBodyDroplets(dropTargetPos, 0, 0.78, 18, 1.15);
            if (onKeepnetDropSound) {
              const pan = dropTargetIsRare ? 0.42 : -0.42;
              onKeepnetDropSound(pan);
            }
          }
        }

        if (dropT >= 1) {
          dropActive = false;
          dropFishGroup.visible = false;
        }
      }

      // Basket jiggle/rattle decay & hinged rim bounce
      pierCommonCage.cageRoot.rotation.z = 0;
      pierCommonCage.lidPivot.rotation.x = -1.25;
      pierRareCage.cageRoot.rotation.z = 0;
      pierRareCage.lidPivot.rotation.x = -1.25;
      boatCommonCage.cageRoot.rotation.z = 0;
      boatCommonCage.lidPivot.rotation.x = -1.25;
      boatRareCage.cageRoot.rotation.z = 0;
      boatRareCage.lidPivot.rotation.x = -1.25;

      if (cageJiggle > 0.005) {
        cageJiggle = Math.max(0, cageJiggle - dt * 2.1);
        const wobble = Math.sin(elapsed * 24) * 0.095 * cageJiggle;
        const activeCage = dropTargetIsBoat
          ? dropTargetIsRare
            ? boatRareCage
            : boatCommonCage
          : dropTargetIsRare
            ? pierRareCage
            : pierCommonCage;
        activeCage.cageRoot.rotation.z = wobble;
        activeCage.lidPivot.rotation.x = -1.25 + Math.abs(Math.sin(elapsed * 14)) * 0.42 * cageJiggle;
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
