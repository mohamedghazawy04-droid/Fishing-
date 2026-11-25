import * as THREE from 'three';
import { FISH_SPECIES, type FishSpecies } from '../types/fishing';
import { groundHeightAt } from './environment';
import { createSpeciesScaleTexture } from './fishSystem';

export interface RivalContestResult {
  contestActive: boolean;
  rivalName: string | null;
  contestBalance: number; // 0..1 (1 = player winning, 0 = rival steals fish)
  justStarted: boolean;
  justWon: boolean;
  justStolen: boolean;
  pullVectorX: number;
  pullVectorZ: number;
  abuAliCutaway: {
    active: boolean;
    justStarted: boolean;
    speciesNameAr: string | null;
    camPos: THREE.Vector3;
    lookAt: THREE.Vector3;
  };
}

export interface RivalActiveFishTarget {
  rivalIndex: number;
  rivalName: string;
  pos: THREE.Vector3;
  distToPlatform: number;
}

export interface RivalAnglersSystem {
  group: THREE.Group;
  resetContest: () => void;
  getActiveFishTargets: () => RivalActiveFishTarget[];
  devourRivalFish: (rivalIndex: number) => string | null;
  update: (params: {
    dt: number;
    elapsed: number;
    hookedFishPos: THREE.Vector3 | null;
    hookedFishDistToDock: number;
    playerReeling: boolean;
    reelSkillFactor: number;
    getWaterSurfaceY: (x: number, z: number) => number;
    onRipple: (x: number, z: number, strength: number) => void;
    onSplash: (x: number, z: number, intensity: number) => void;
  }) => RivalContestResult;
  dispose: () => void;
}

type RivalSoloPhase =
  | 'charging'
  | 'casting'
  | 'waiting'
  | 'biting'
  | 'reeling'
  | 'lifting'
  | 'depositing';

interface RivalDropParticle {
  mesh: THREE.Mesh;
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  maxAge: number;
}

interface RivalInstance {
  nameAr: string;
  sideSign: number;
  root: THREE.Group;
  platformYaw: number;
  torsoPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftArmPivot: THREE.Group;
  rodPivot: THREE.Group;
  reelCrankPivot: THREE.Group;
  rodSegments: THREE.Group[];
  rodTipMarker: THREE.Object3D;
  bobber: THREE.Group;
  line: THREE.Line;
  linePositions: Float32Array;
  lineGeo: THREE.BufferGeometry;
  fishRoot: THREE.Group;
  fishBodyMesh: THREE.Mesh;
  fishBodyMat: THREE.MeshStandardMaterial;
  fishFinMat: THREE.MeshStandardMaterial;
  fishTailPivot: THREE.Group;
  fishHookGroup: THREE.Group;
  fishMouthMarker: THREE.Object3D;
  fishPos: THREE.Vector3;
  currentSpecies: FishSpecies;
  lastSpeciesIdx: number;
  basketGroup: THREE.Group;
  basketLocalPos: THREE.Vector3;
  basketFishGroup: THREE.Group;
  basketStoredMeshes: THREE.Group[];
  basketAddedThisCatch: boolean;
  basketSplashPlayed: boolean;
  dripParticles: RivalDropParticle[];
  dripTimer: number;
  platformPos: THREE.Vector3;
  castStartPos: THREE.Vector3;
  castTargetXZ: THREE.Vector2;
  bobberPos: THREE.Vector3;
  soloPhase: RivalSoloPhase;
  phaseTimer: number;
  castFlightT: number;
  swimPhase: number;
  splashTimer: number;
  triumphTimer: number;
  cutawaySequenceElapsed: number;
}

function createWickerBasketTexture(): THREE.CanvasTexture {
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
      ctx.fillStyle = `rgb(${152 + shade}, ${108 + shade}, ${58 + Math.floor(shade * 0.6)})`;
      ctx.fillRect(x + 1, y + 2, colW - 3, rowH - 4);
      ctx.strokeStyle = 'rgba(48, 30, 12, 0.45)';
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

export function createRivalAnglers(): RivalAnglersSystem {
  const group = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

  // Shared Geometries & Materials for Shoreline Platforms, Wicker Baskets & Rival Anglers
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c4028, roughness: 0.88 });
  const timberMat = new THREE.MeshStandardMaterial({ color: 0x3b2919, roughness: 0.92 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xdfa987, roughness: 0.58 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x2b3c4d, roughness: 0.9 });
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x2e1f16, roughness: 0.82 });
  const carbonMat = new THREE.MeshStandardMaterial({ color: 0x1e2529, roughness: 0.35, metalness: 0.5 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xc59b47, roughness: 0.28, metalness: 0.85 });
  const steelHookMat = new THREE.MeshStandardMaterial({ color: 0xd9e4ec, roughness: 0.22, metalness: 0.88 });
  const bobRedMat = new THREE.MeshStandardMaterial({ color: 0xe64a2e, roughness: 0.35 });
  const bobWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf4efe4, roughness: 0.35 });
  const lineMat = new THREE.LineBasicMaterial({ color: 0xdbeaf2, transparent: true, opacity: 0.8 });

  const wickerTex = createWickerBasketTexture();
  const wickerMat = new THREE.MeshStandardMaterial({
    map: wickerTex,
    roughness: 0.85,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const wickerRimMat = new THREE.MeshStandardMaterial({ color: 0x6e4a24, roughness: 0.88 });
  const basketInnerDarkMat = new THREE.MeshStandardMaterial({ color: 0x24170c, roughness: 0.95 });
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0xb99d6e, roughness: 0.92 });
  const dripMat = new THREE.MeshPhysicalMaterial({
    color: 0xdff6ff,
    roughness: 0.06,
    metalness: 0.0,
    transparent: true,
    opacity: 0.82,
  });

  // Pre-build high-detail species scale textures for all species in catalog
  const speciesTextures = new Map<string, THREE.CanvasTexture>();
  for (const sp of FISH_SPECIES) {
    const tex = createSpeciesScaleTexture(sp);
    speciesTextures.set(sp.id, tex);
    disposables.push(tex);
  }

  const plankGeo = new THREE.BoxGeometry(1.75, 0.08, 2.05);
  const pilingGeo = new THREE.CylinderGeometry(0.09, 0.1, 1.85, 8);
  const seatGeo = new THREE.BoxGeometry(0.54, 0.06, 0.50);
  const legGeo = new THREE.CylinderGeometry(0.025, 0.022, 0.42, 6);
  const torsoGeo = new THREE.CapsuleGeometry(0.17, 0.36, 6, 10);
  const armGeo = new THREE.CapsuleGeometry(0.052, 0.32, 4, 8);
  armGeo.rotateX(Math.PI / 2);
  armGeo.translate(0, 0, 0.16);
  const handGeo = new THREE.SphereGeometry(0.045, 8, 8);
  const thighGeo = new THREE.CapsuleGeometry(0.072, 0.28, 5, 8);
  thighGeo.rotateX(Math.PI / 2);
  const shinGeo = new THREE.CapsuleGeometry(0.06, 0.32, 5, 8);
  const headGeo = new THREE.SphereGeometry(0.125, 12, 10);
  const hatBrimGeo = new THREE.CylinderGeometry(0.22, 0.23, 0.02, 14);
  const hatCrownGeo = new THREE.CylinderGeometry(0.12, 0.135, 0.11, 12);
  const bobTopGeo = new THREE.SphereGeometry(0.062, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const bobBotGeo = new THREE.SphereGeometry(0.062, 10, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45);
  const reelBodyGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.055, 10);
  reelBodyGeo.rotateZ(Math.PI / 2);
  const crankGeo = new THREE.BoxGeometry(0.012, 0.055, 0.014);
  crankGeo.translate(0, 0.026, 0);
  const rodSegGeo = new THREE.CylinderGeometry(0.008, 0.014, 0.46, 8);
  rodSegGeo.rotateX(Math.PI / 2);
  rodSegGeo.translate(0, 0, 0.23);

  // Wicker Fishing Basket ("سبت صيد") Geometries
  const basketWallGeo = new THREE.CylinderGeometry(0.30, 0.23, 0.42, 18, 2, true);
  const basketFloorGeo = new THREE.CircleGeometry(0.225, 18);
  basketFloorGeo.rotateX(-Math.PI / 2);
  const basketRimGeo = new THREE.TorusGeometry(0.30, 0.024, 8, 20);
  basketRimGeo.rotateX(Math.PI / 2);
  const basketMidBandGeo = new THREE.TorusGeometry(0.265, 0.013, 6, 20);
  basketMidBandGeo.rotateX(Math.PI / 2);
  const basketHandleGeo = new THREE.TorusGeometry(0.075, 0.011, 6, 12, Math.PI);

  // Hook & Drip Geometries
  const hookShankGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.075, 6);
  const hookCurveGeo = new THREE.TorusGeometry(0.024, 0.0045, 6, 12, Math.PI * 1.15);
  const dripGeo = new THREE.SphereGeometry(0.014, 6, 6);

  // Shared Anatomical Multi-Part Fish Geometries (matching UV wrap of createSpeciesScaleTexture)
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
  const fishBodyGeo = new THREE.LatheGeometry(fishProfile, 18);
  fishBodyGeo.rotateX(Math.PI / 2);
  fishBodyGeo.scale(0.62, 1.0, 1.0);

  const fishTailShape = new THREE.Shape();
  fishTailShape.moveTo(0, 0.018);
  fishTailShape.lineTo(-0.22, 0.17);
  fishTailShape.lineTo(-0.14, 0.01);
  fishTailShape.lineTo(-0.14, -0.01);
  fishTailShape.lineTo(-0.22, -0.17);
  fishTailShape.lineTo(0, -0.018);
  fishTailShape.closePath();
  const fishTailGeo = new THREE.ExtrudeGeometry(fishTailShape, { depth: 0.008, bevelEnabled: false });
  fishTailGeo.rotateY(Math.PI / 2);
  fishTailGeo.translate(-0.004, 0, 0);

  const fishDorsalShape = new THREE.Shape();
  fishDorsalShape.moveTo(0, 0);
  fishDorsalShape.lineTo(-0.04, 0.13);
  fishDorsalShape.lineTo(-0.21, 0.10);
  fishDorsalShape.lineTo(-0.25, 0.01);
  fishDorsalShape.closePath();
  const fishDorsalGeo = new THREE.ExtrudeGeometry(fishDorsalShape, { depth: 0.007, bevelEnabled: false });
  fishDorsalGeo.rotateY(Math.PI / 2);
  fishDorsalGeo.translate(-0.0035, 0.098, 0.07);

  const fishAnalShape = new THREE.Shape();
  fishAnalShape.moveTo(0, 0);
  fishAnalShape.lineTo(-0.04, -0.08);
  fishAnalShape.lineTo(-0.13, -0.05);
  fishAnalShape.lineTo(-0.15, 0);
  fishAnalShape.closePath();
  const fishAnalGeo = new THREE.ExtrudeGeometry(fishAnalShape, { depth: 0.006, bevelEnabled: false });
  fishAnalGeo.rotateY(Math.PI / 2);
  fishAnalGeo.translate(-0.003, -0.078, -0.14);

  const fishPecGeo = new THREE.PlaneGeometry(0.14, 0.08);
  const fishIrisGeo = new THREE.SphereGeometry(0.024, 8, 8);
  const fishPupilGeo = new THREE.SphereGeometry(0.015, 6, 6);
  const fishIrisMat = new THREE.MeshStandardMaterial({ color: 0xe2c36b, roughness: 0.2, metalness: 0.3 });
  const fishPupilMat = new THREE.MeshStandardMaterial({ color: 0x0a0d10, roughness: 0.06, metalness: 0.35 });

  disposables.push(
    woodMat,
    timberMat,
    skinMat,
    pantsMat,
    bootMat,
    carbonMat,
    brassMat,
    steelHookMat,
    bobRedMat,
    bobWhiteMat,
    lineMat,
    wickerTex,
    wickerMat,
    wickerRimMat,
    basketInnerDarkMat,
    ropeMat,
    dripMat,
    plankGeo,
    pilingGeo,
    seatGeo,
    legGeo,
    torsoGeo,
    armGeo,
    handGeo,
    thighGeo,
    shinGeo,
    headGeo,
    hatBrimGeo,
    hatCrownGeo,
    bobTopGeo,
    bobBotGeo,
    reelBodyGeo,
    crankGeo,
    rodSegGeo,
    basketWallGeo,
    basketFloorGeo,
    basketRimGeo,
    basketMidBandGeo,
    basketHandleGeo,
    hookShankGeo,
    hookCurveGeo,
    dripGeo,
    fishBodyGeo,
    fishTailGeo,
    fishDorsalGeo,
    fishAnalGeo,
    fishPecGeo,
    fishIrisGeo,
    fishPupilGeo,
    fishIrisMat,
    fishPupilMat,
  );

  const specs = [
    {
      nameAr: 'أبو علي',
      sideSign: -1,
      x: -18.5,
      z: -3.5,
      targetX: -11.5,
      targetZ: -21.5,
      jacketColor: 0xa64d32,
      hatColor: 0xc2a26b,
      initialPhase: 'waiting' as RivalSoloPhase,
      initialTimer: 3.2,
    },
    {
      nameAr: 'رامي',
      sideSign: 1,
      x: 19.0,
      z: -4.2,
      targetX: 11.5,
      targetZ: -22.5,
      jacketColor: 0x2a5473,
      hatColor: 0x3b4d3e,
      initialPhase: 'charging' as RivalSoloPhase,
      initialTimer: 0.9,
    },
  ];

  const LINE_PTS = 16;

  function applySpeciesAppearance(
    species: FishSpecies,
    fishRoot: THREE.Group,
    bodyMat: THREE.MeshStandardMaterial,
    finMat: THREE.MeshStandardMaterial,
  ): void {
    const tex = speciesTextures.get(species.id);
    if (tex && bodyMat.map !== tex) {
      bodyMat.map = tex;
      bodyMat.needsUpdate = true;
    }
    finMat.color.setHex(species.finColor);

    const avgLen = (species.minLengthCm + species.maxLengthCm) * 0.5;
    const baseScale = THREE.MathUtils.clamp(avgLen / 46, 0.85, 1.48);

    // Subtle body proportion variation per species so every catch looks distinct
    let widthRatio = 1.0;
    let heightRatio = 1.0;
    let lengthRatio = 1.0;
    if (species.id === 'northern_pike' || species.id === 'alpine_sturgeon') {
      widthRatio = 0.85;
      heightRatio = 0.84;
      lengthRatio = 1.24;
    } else if (species.id === 'golden_carp' || species.id === 'abyssal_catfish') {
      widthRatio = 1.18;
      heightRatio = 1.16;
      lengthRatio = 0.96;
    } else if (species.id === 'glacial_taimen') {
      widthRatio = 1.08;
      heightRatio = 1.06;
      lengthRatio = 1.18;
    }
    fishRoot.scale.set(baseScale * widthRatio, baseScale * heightRatio, baseScale * lengthRatio);
  }

  function pickNextSpecies(rival: RivalInstance): FishSpecies {
    // Rotate through distinct species each catch so it is always a new kind!
    let nextIdx = Math.floor(Math.random() * FISH_SPECIES.length);
    if (nextIdx === rival.lastSpeciesIdx) {
      nextIdx = (nextIdx + 1 + Math.floor(Math.random() * (FISH_SPECIES.length - 1))) % FISH_SPECIES.length;
    }
    rival.lastSpeciesIdx = nextIdx;
    const sp = FISH_SPECIES[nextIdx];
    rival.currentSpecies = sp;
    applySpeciesAppearance(sp, rival.fishRoot, rival.fishBodyMat, rival.fishFinMat);
    return sp;
  }

  function addFishReplicaToBasket(rival: RivalInstance, species: FishSpecies): void {
    // Keep up to 4 most recent catches stacked visibly in the open top of the basket
    if (rival.basketStoredMeshes.length >= 4) {
      const oldest = rival.basketStoredMeshes.shift();
      if (oldest) {
        rival.basketFishGroup.remove(oldest);
      }
    }

    const stored = new THREE.Group();
    const sMat = new THREE.MeshStandardMaterial({
      map: speciesTextures.get(species.id) ?? null,
      roughness: 0.22,
      metalness: 0.3,
    });
    const fMat = new THREE.MeshStandardMaterial({
      color: species.finColor,
      roughness: 0.45,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
    });
    disposables.push(sMat, fMat);

    const bMesh = new THREE.Mesh(fishBodyGeo, sMat);
    const dMesh = new THREE.Mesh(fishDorsalGeo, fMat);
    const tMesh = new THREE.Mesh(fishTailGeo, fMat);
    tMesh.position.set(0, 0, -0.41);
    stored.add(bMesh, dMesh, tMesh);

    const slot = rival.basketStoredMeshes.length;
    const angle = slot * 1.45 + Math.random() * 0.4;
    stored.position.set(
      Math.cos(angle) * 0.055,
      0.16 + slot * 0.038,
      Math.sin(angle) * 0.055,
    );
    stored.rotation.set(0.28 + (Math.random() - 0.5) * 0.22, angle + Math.PI * 0.5, 1.15);
    const fitScale = THREE.MathUtils.clamp(((species.minLengthCm + species.maxLengthCm) * 0.5) / 68, 0.42, 0.62);
    stored.scale.setScalar(fitScale);

    rival.basketFishGroup.add(stored);
    rival.basketStoredMeshes.push(stored);
  }

  const rivals: RivalInstance[] = specs.map((spec, idx) => {
    const bedY = groundHeightAt(spec.x, spec.z);
    const platY = Math.max(0.55, bedY + 0.42);
    const yaw = Math.atan2(spec.targetX - spec.x, spec.targetZ - spec.z);

    const root = new THREE.Group();
    root.position.set(spec.x, platY, spec.z);
    root.rotation.y = yaw;

    // Platform planks & pilings into lakebed
    const deck = new THREE.Mesh(plankGeo, woodMat);
    deck.castShadow = true;
    deck.receiveShadow = true;
    root.add(deck);

    for (const [px, pz] of [[-0.68, -0.78], [0.68, -0.78], [-0.68, 0.78], [0.68, 0.78]]) {
      const piling = new THREE.Mesh(pilingGeo, timberMat);
      piling.position.set(px, -0.82, pz);
      piling.castShadow = true;
      piling.receiveShadow = true;
      root.add(piling);
    }

    // Camp Chair
    for (const [lx, lz] of [[-0.22, -0.2], [0.22, -0.2], [-0.22, 0.2], [0.22, 0.2]]) {
      const cLeg = new THREE.Mesh(legGeo, timberMat);
      cLeg.position.set(lx, 0.21, lz);
      cLeg.castShadow = true;
      root.add(cLeg);
    }
    const seat = new THREE.Mesh(seatGeo, timberMat);
    seat.position.set(0, 0.44, 0);
    seat.castShadow = true;
    root.add(seat);

    // Lower Body
    for (const side of [-1, 1]) {
      const thigh = new THREE.Mesh(thighGeo, pantsMat);
      thigh.position.set(side * 0.13, 0.52, 0.16);
      const shin = new THREE.Mesh(shinGeo, pantsMat);
      shin.position.set(side * 0.13, 0.25, 0.34);
      const boot = new THREE.Mesh(seatGeo, bootMat);
      boot.scale.set(0.24, 1.4, 0.46);
      boot.position.set(side * 0.13, 0.08, 0.39);
      root.add(thigh, shin, boot);
    }

    // Woven Wicker Fishing Basket ("سبت صيد") mounted clearly on the front corner of the platform
    const basketLocalPos = new THREE.Vector3(idx === 0 ? 0.50 : -0.50, 0.04, 0.62);
    const basketGroup = new THREE.Group();
    basketGroup.position.copy(basketLocalPos);

    const bFloor = new THREE.Mesh(basketFloorGeo, basketInnerDarkMat);
    bFloor.position.y = 0.01;
    bFloor.receiveShadow = true;
    const bWall = new THREE.Mesh(basketWallGeo, wickerMat);
    bWall.position.y = 0.21;
    bWall.castShadow = true;
    bWall.receiveShadow = true;
    const bInnerRim = new THREE.Mesh(basketFloorGeo, basketInnerDarkMat);
    bInnerRim.position.y = 0.14;
    bInnerRim.scale.setScalar(1.02);
    const bTopRim = new THREE.Mesh(basketRimGeo, wickerRimMat);
    bTopRim.position.y = 0.42;
    bTopRim.castShadow = true;
    const bMidBand = new THREE.Mesh(basketMidBandGeo, wickerRimMat);
    bMidBand.position.y = 0.21;
    basketGroup.add(bFloor, bInnerRim, bWall, bTopRim, bMidBand);

    for (const hSide of [-1, 1]) {
      const handle = new THREE.Mesh(basketHandleGeo, ropeMat);
      handle.position.set(hSide * 0.28, 0.36, 0);
      handle.rotation.y = Math.PI / 2;
      handle.rotation.z = hSide * -0.4;
      basketGroup.add(handle);
    }

    const basketFishGroup = new THREE.Group();
    basketGroup.add(basketFishGroup);
    root.add(basketGroup);

    // Articulated Upper Body, Head & Pivoted Arms
    const jacketMat = new THREE.MeshStandardMaterial({ color: spec.jacketColor, roughness: 0.84 });
    const hatMat = new THREE.MeshStandardMaterial({ color: spec.hatColor, roughness: 0.88 });
    disposables.push(jacketMat, hatMat);

    const torsoPivot = new THREE.Group();
    torsoPivot.position.set(0, 0.54, -0.02);

    const torso = new THREE.Mesh(torsoGeo, jacketMat);
    torso.position.y = 0.26;
    torso.castShadow = true;
    torsoPivot.add(torso);

    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.set(0, 0.62, 0.02);
    head.castShadow = true;
    const hatBrim = new THREE.Mesh(hatBrimGeo, hatMat);
    hatBrim.position.set(0, 0.70, 0.02);
    hatBrim.castShadow = true;
    const hatCrown = new THREE.Mesh(hatCrownGeo, hatMat);
    hatCrown.position.set(0, 0.75, 0.02);
    hatCrown.castShadow = true;
    torsoPivot.add(head, hatBrim, hatCrown);

    // Right Arm holding Rod
    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(0.20, 0.42, 0.02);
    const rightArmMesh = new THREE.Mesh(armGeo, jacketMat);
    rightArmMesh.castShadow = true;
    const rightHand = new THREE.Mesh(handGeo, skinMat);
    rightHand.position.set(0, 0, 0.34);
    rightArmPivot.add(rightArmMesh, rightHand);
    torsoPivot.add(rightArmPivot);

    // Left Arm reaching toward spinning reel crank (or unhooking fish over basket)
    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-0.20, 0.42, 0.02);
    leftArmPivot.rotation.set(0.55, 0.45, 0.0);
    const leftArmMesh = new THREE.Mesh(armGeo, jacketMat);
    leftArmMesh.castShadow = true;
    const leftHand = new THREE.Mesh(handGeo, skinMat);
    leftHand.position.set(0, 0, 0.34);
    leftArmPivot.add(leftArmMesh, leftHand);
    torsoPivot.add(leftArmPivot);

    // Segmented Fishing Rod + Spinning Reel attached to Right Hand
    const rodPivot = new THREE.Group();
    rodPivot.position.set(0.0, -0.02, 0.32);
    rodPivot.rotation.x = -0.35;

    const reelBody = new THREE.Mesh(reelBodyGeo, brassMat);
    reelBody.position.set(0, -0.055, 0.24);
    const reelCrankPivot = new THREE.Group();
    reelCrankPivot.position.set(-0.04, -0.055, 0.24);
    reelCrankPivot.add(new THREE.Mesh(crankGeo, brassMat));
    rodPivot.add(reelBody, reelCrankPivot);

    const rodSegments: THREE.Group[] = [];
    let parentNode: THREE.Object3D = rodPivot;
    for (let s = 0; s < 5; s++) {
      const segGroup = new THREE.Group();
      segGroup.position.set(0, 0, s === 0 ? 0 : 0.45);
      const segMesh = new THREE.Mesh(rodSegGeo, carbonMat);
      segMesh.scale.set(1 - s * 0.14, 1 - s * 0.14, 1);
      segMesh.castShadow = true;
      segGroup.add(segMesh);
      parentNode.add(segGroup);
      rodSegments.push(segGroup);
      parentNode = segGroup;
    }
    const rodTipMarker = new THREE.Object3D();
    rodTipMarker.position.set(0, 0, 0.46);
    rodSegments[rodSegments.length - 1].add(rodTipMarker);

    rightArmPivot.add(rodPivot);
    root.add(torsoPivot);
    group.add(root);

    // Multi-Part Species-Accurate 3D Rival Fish + Visible Metallic Fishing Hook at Mouth
    const initialSpecies = FISH_SPECIES[idx % FISH_SPECIES.length];
    const fishBodyMat = new THREE.MeshStandardMaterial({
      map: speciesTextures.get(initialSpecies.id) ?? null,
      roughness: 0.22,
      metalness: 0.32,
    });
    const fishFinMat = new THREE.MeshStandardMaterial({
      color: initialSpecies.finColor,
      roughness: 0.45,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
    });
    disposables.push(fishBodyMat, fishFinMat);

    const fishRoot = new THREE.Group();
    fishRoot.visible = false;
    const fBody = new THREE.Mesh(fishBodyGeo, fishBodyMat);
    fBody.castShadow = true;
    const fDorsal = new THREE.Mesh(fishDorsalGeo, fishFinMat);
    const fAnal = new THREE.Mesh(fishAnalGeo, fishFinMat);
    const fTailPivot = new THREE.Group();
    fTailPivot.position.set(0, 0, -0.42);
    fTailPivot.add(new THREE.Mesh(fishTailGeo, fishFinMat));
    fishRoot.add(fBody, fDorsal, fAnal, fTailPivot);

    for (const side of [-1, 1]) {
      const pec = new THREE.Mesh(fishPecGeo, fishFinMat);
      pec.position.set(side * 0.068, -0.025, 0.15);
      pec.rotation.set(0.3, side * -0.55, side * -0.3);
      const iris = new THREE.Mesh(fishIrisGeo, fishIrisMat);
      iris.position.set(side * 0.04, 0.032, 0.32);
      iris.scale.set(0.65, 1, 1);
      const pupil = new THREE.Mesh(fishPupilGeo, fishPupilMat);
      pupil.position.set(side * 0.048, 0.032, 0.324);
      pupil.scale.set(0.65, 1, 1);
      fishRoot.add(pec, iris, pupil);
    }

    // Visible Fishing Hook in the fish's lip/mouth + connection marker for the line!
    const fishHookGroup = new THREE.Group();
    fishHookGroup.position.set(0, 0.015, 0.44);
    const hookShank = new THREE.Mesh(hookShankGeo, steelHookMat);
    hookShank.position.set(0, 0.038, 0.012);
    const hookCurve = new THREE.Mesh(hookCurveGeo, steelHookMat);
    hookCurve.position.set(0, 0.002, -0.006);
    hookCurve.rotation.y = Math.PI / 2;
    fishHookGroup.add(hookShank, hookCurve);
    fishRoot.add(fishHookGroup);

    const fishMouthMarker = new THREE.Object3D();
    fishMouthMarker.position.set(0, 0.085, 0.455);
    fishRoot.add(fishMouthMarker);

    applySpeciesAppearance(initialSpecies, fishRoot, fishBodyMat, fishFinMat);
    group.add(fishRoot);

    // Floating Bobber & Line
    const bobber = new THREE.Group();
    bobber.add(new THREE.Mesh(bobTopGeo, bobRedMat), new THREE.Mesh(bobBotGeo, bobWhiteMat));
    group.add(bobber);

    const linePositions = new Float32Array(LINE_PTS * 3);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    const line = new THREE.Line(lineGeo, lineMat);
    line.frustumCulled = false;
    group.add(line);
    disposables.push(lineGeo);

    // Water Drip Particle Pool for fish emerging onto basket
    const dripParticles: RivalDropParticle[] = [];
    for (let d = 0; d < 12; d++) {
      const m = new THREE.Mesh(dripGeo, dripMat);
      m.visible = false;
      group.add(m);
      dripParticles.push({
        mesh: m,
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        age: 0,
        maxAge: 0.65,
      });
    }

    const instance: RivalInstance = {
      nameAr: spec.nameAr,
      sideSign: spec.sideSign,
      root,
      platformYaw: yaw,
      torsoPivot,
      rightArmPivot,
      leftArmPivot,
      rodPivot,
      reelCrankPivot,
      rodSegments,
      rodTipMarker,
      bobber,
      line,
      linePositions,
      lineGeo,
      fishRoot,
      fishBodyMesh: fBody,
      fishBodyMat,
      fishFinMat,
      fishTailPivot: fTailPivot,
      fishHookGroup,
      fishMouthMarker,
      fishPos: new THREE.Vector3(spec.targetX, -0.35, spec.targetZ),
      currentSpecies: initialSpecies,
      lastSpeciesIdx: idx % FISH_SPECIES.length,
      basketGroup,
      basketLocalPos,
      basketFishGroup,
      basketStoredMeshes: [],
      basketAddedThisCatch: false,
      basketSplashPlayed: false,
      dripParticles,
      dripTimer: 0,
      platformPos: new THREE.Vector3(spec.x, platY, spec.z),
      castStartPos: new THREE.Vector3(spec.x, platY + 1.5, spec.z),
      castTargetXZ: new THREE.Vector2(spec.targetX, spec.targetZ),
      bobberPos: new THREE.Vector3(spec.targetX, 0, spec.targetZ),
      soloPhase: spec.initialPhase,
      phaseTimer: spec.initialTimer,
      castFlightT: 0,
      swimPhase: idx * 2.1,
      splashTimer: 0,
      triumphTimer: 0,
      cutawaySequenceElapsed: 0,
    };

    // Start with 1 fish already resting inside each basket so the basket looks alive right away
    addFishReplicaToBasket(instance, FISH_SPECIES[(idx + 2) % FISH_SPECIES.length]);

    return instance;
  });

  let activeContestRivalIdx = -1;
  let contestWaitTimer = 0;
  let contestBalance = 0.56;
  let resolvedThisCatch = false;

  const tmpTip = new THREE.Vector3();
  const tmpPt = new THREE.Vector3();
  const tmpPull = new THREE.Vector3();
  const tmpToPlat = new THREE.Vector3();
  const tmpMouthWorld = new THREE.Vector3();
  const tmpBasketWorld = new THREE.Vector3();
  const tmpLiftWorld = new THREE.Vector3();
  const cutawayCamPos = new THREE.Vector3();
  const cutawayLookAt = new THREE.Vector3();

  function pickCastSpot(rival: RivalInstance): void {
    const xOffset = 6.5 + Math.random() * 9.5;
    const tx = rival.sideSign * xOffset;
    const tz = -15.5 - Math.random() * 14.5;
    rival.castTargetXZ.set(tx, tz);
  }

  function spawnFishDrip(rival: RivalInstance): void {
    const slot = rival.dripParticles.find((p) => !p.active);
    if (!slot) return;
    slot.active = true;
    slot.age = 0;
    slot.maxAge = 0.48 + Math.random() * 0.28;
    slot.pos.set(
      rival.fishPos.x + (Math.random() - 0.5) * 0.16,
      rival.fishPos.y - 0.08 + (Math.random() - 0.5) * 0.14,
      rival.fishPos.z + (Math.random() - 0.5) * 0.16,
    );
    slot.vel.set((Math.random() - 0.5) * 0.25, -0.3 - Math.random() * 0.4, (Math.random() - 0.5) * 0.25);
    slot.mesh.position.copy(slot.pos);
    slot.mesh.scale.setScalar(0.85 + Math.random() * 0.55);
    slot.mesh.visible = true;
  }

  return {
    group,
    resetContest: () => {
      activeContestRivalIdx = -1;
      contestWaitTimer = 0;
      contestBalance = 0.56;
      resolvedThisCatch = false;
    },
    getActiveFishTargets: () => {
      const targets: RivalActiveFishTarget[] = [];
      rivals.forEach((r, idx) => {
        if (idx === activeContestRivalIdx) return;
        if (r.soloPhase === 'reeling' && r.fishRoot.visible) {
          const dPlat = Math.hypot(r.platformPos.x - r.fishPos.x, r.platformPos.z - r.fishPos.z);
          targets.push({
            rivalIndex: idx,
            rivalName: r.nameAr,
            pos: r.fishPos,
            distToPlatform: dPlat,
          });
        }
      });
      return targets;
    },
    devourRivalFish: (rivalIndex: number) => {
      const r = rivals[rivalIndex];
      if (!r || r.soloPhase !== 'reeling') return null;
      r.fishRoot.visible = false;
      r.fishHookGroup.visible = false;
      r.soloPhase = 'charging';
      r.phaseTimer = 2.4;
      return r.nameAr;
    },
    update: ({
      dt,
      elapsed,
      hookedFishPos,
      hookedFishDistToDock,
      playerReeling,
      reelSkillFactor,
      getWaterSurfaceY,
      onRipple,
      onSplash,
    }) => {
      let justStarted = false;
      let justWon = false;
      let justStolen = false;
      let pullVectorX = 0;
      let pullVectorZ = 0;
      let abuAliCutawayActive = false;
      let abuAliCutawayJustStarted = false;
      let abuAliSpeciesNameAr: string | null = null;

      // Initiate tug-of-war shortly after player hooks a fish in the lake
      if (hookedFishPos && !resolvedThisCatch && activeContestRivalIdx === -1) {
        contestWaitTimer += dt;
        if (contestWaitTimer >= 0.85 && hookedFishDistToDock > 4.6) {
          let bestIdx = 0;
          let bestDist = Infinity;
          rivals.forEach((r, idx) => {
            const d = Math.hypot(hookedFishPos.x - r.platformPos.x, hookedFishPos.z - r.platformPos.z);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = idx;
            }
          });
          if (bestDist <= 38.0) {
            activeContestRivalIdx = bestIdx;
            contestBalance = 0.56;
            justStarted = true;
            onSplash(hookedFishPos.x, hookedFishPos.z, 0.95);
          } else {
            resolvedThisCatch = true;
          }
        }
      } else if (!hookedFishPos) {
        activeContestRivalIdx = -1;
        contestWaitTimer = 0;
        resolvedThisCatch = false;
      }

      if (activeContestRivalIdx !== -1 && hookedFishPos) {
        const rival = rivals[activeContestRivalIdx];
        const rivalWave = 0.24 + Math.sin(elapsed * 3.1) * 0.08;

        if (playerReeling) {
          contestBalance = Math.min(1.0, contestBalance + (0.21 * reelSkillFactor - rivalWave * 0.25) * dt);
        } else {
          contestBalance = Math.max(0.0, contestBalance - rivalWave * 0.95 * dt);
        }

        tmpPull.set(rival.platformPos.x - hookedFishPos.x, 0, rival.platformPos.z - hookedFishPos.z);
        const pLen = tmpPull.length();
        if (pLen > 0.05) {
          tmpPull.divideScalar(pLen);
          const pullStrength = playerReeling ? 0.58 : 1.55;
          pullVectorX = tmpPull.x * pullStrength;
          pullVectorZ = tmpPull.z * pullStrength;
        }

        if (contestBalance >= 0.99 || hookedFishDistToDock <= 2.95) {
          justWon = true;
          resolvedThisCatch = true;
          activeContestRivalIdx = -1;
        } else if (contestBalance <= 0.02) {
          justStolen = true;
          resolvedThisCatch = true;
          rival.triumphTimer = 3.6;
          pickNextSpecies(rival);
          rival.soloPhase = 'lifting';
          rival.phaseTimer = 1.45;
          rival.cutawaySequenceElapsed = 0;
          rival.basketAddedThisCatch = false;
          rival.basketSplashPlayed = false;
          rival.fishPos.copy(hookedFishPos);
          onSplash(hookedFishPos.x, hookedFishPos.z, 1.35);
          activeContestRivalIdx = -1;
        }
      }

      // Update Each Rival's Animation, Rod Whip, Hooked Fish, Basket Deposit & Drip Particles
      rivals.forEach((rival, idx) => {
        const isContesting = idx === activeContestRivalIdx && hookedFishPos !== null;

        if (rival.triumphTimer > 0) {
          rival.triumphTimer -= dt;
        }

        const baseYaw = Math.atan2(
          rival.castTargetXZ.x - rival.platformPos.x,
          rival.castTargetXZ.y - rival.platformPos.z,
        );
        let targetYaw = baseYaw;
        let rightArmPitch = 0.15;
        let rightArmYaw = 0;
        let rodPitch = -0.35 + Math.sin(elapsed * 1.1 + idx) * 0.03;
        let torsoLean = Math.sin(elapsed * 1.2 + idx) * 0.03;
        let torsoYaw = 0;
        let leftArmYaw = 0.35;
        let leftArmPitch = 0.45;
        let bendAmt = 0.035;
        let showFish = false;
        let showHookOnFish = false;
        let lineFollowsMouth = false;
        let crankActive = false;

        if (isContesting && hookedFishPos) {
          // Contesting player's hooked fish in live tug-of-war!
          targetYaw = Math.atan2(hookedFishPos.x - rival.platformPos.x, hookedFishPos.z - rival.platformPos.z);
          rightArmPitch = -0.25 + Math.sin(elapsed * 4.2) * 0.06;
          rodPitch = -0.62 + Math.sin(elapsed * 5.2) * 0.07;
          torsoLean = -0.24 + Math.sin(elapsed * 4.5) * 0.06;
          leftArmYaw = 0.62;
          leftArmPitch = 0.68;
          bendAmt = 0.24 + (1 - contestBalance) * 0.14;
          crankActive = true;
          rival.bobberPos.set(
            hookedFishPos.x,
            getWaterSurfaceY(hookedFishPos.x, hookedFishPos.z) - 0.03,
            hookedFishPos.z,
          );
          rival.fishRoot.visible = false;
        } else {
          switch (rival.soloPhase) {
            case 'charging': {
              rival.phaseTimer -= dt;
              rightArmPitch = -1.25;
              rodPitch = -0.75;
              torsoLean = 0.16;
              bendAmt = 0.06;
              rival.root.updateMatrixWorld(true);
              rival.rodTipMarker.getWorldPosition(tmpTip);
              rival.bobberPos.set(tmpTip.x, tmpTip.y - 0.42, tmpTip.z);
              if (rival.phaseTimer <= 0) {
                pickCastSpot(rival);
                rival.castStartPos.copy(tmpTip);
                rival.castFlightT = 0;
                rival.soloPhase = 'casting';
              }
              break;
            }
            case 'casting': {
              rival.castFlightT += dt * 1.35;
              const t = Math.min(1, rival.castFlightT);
              rightArmPitch = THREE.MathUtils.lerp(-1.25, 0.25, Math.min(1, t * 2.2));
              rodPitch = THREE.MathUtils.lerp(-0.75, -0.26, Math.min(1, t * 2.2));
              torsoLean = THREE.MathUtils.lerp(0.16, -0.14, Math.min(1, t * 2.2));
              bendAmt = 0.08 * Math.sin(t * Math.PI);

              tmpPt.set(rival.castTargetXZ.x, 0, rival.castTargetXZ.y);
              rival.bobberPos.lerpVectors(rival.castStartPos, tmpPt, t);
              rival.bobberPos.y += Math.sin(t * Math.PI) * 2.55;

              if (t >= 1) {
                rival.soloPhase = 'waiting';
                rival.phaseTimer = 4.2 + Math.random() * 4.0;
                const surfY = getWaterSurfaceY(rival.castTargetXZ.x, rival.castTargetXZ.y);
                rival.bobberPos.set(rival.castTargetXZ.x, surfY, rival.castTargetXZ.y);
                onSplash(rival.castTargetXZ.x, rival.castTargetXZ.y, 0.85);
                onRipple(rival.castTargetXZ.x, rival.castTargetXZ.y, 0.8);
              }
              break;
            }
            case 'waiting': {
              rival.phaseTimer -= dt;
              const bx = rival.castTargetXZ.x + Math.sin(elapsed * 0.75 + idx * 2) * 0.12;
              const bz = rival.castTargetXZ.y + Math.cos(elapsed * 0.65 + idx) * 0.12;
              rival.bobberPos.set(bx, getWaterSurfaceY(bx, bz), bz);
              if (rival.phaseTimer <= 0) {
                pickNextSpecies(rival);
                rival.soloPhase = 'biting';
                rival.phaseTimer = 1.45;
                rival.fishPos.set(bx, -0.3, bz);
                onRipple(bx, bz, 0.72);
              }
              break;
            }
            case 'biting': {
              rival.phaseTimer -= dt;
              const bx = rival.castTargetXZ.x + Math.sin(elapsed * 14) * 0.14;
              const bz = rival.castTargetXZ.y + Math.cos(elapsed * 12) * 0.12;
              const dip = -0.14 + Math.sin(elapsed * 22) * 0.05;
              rival.bobberPos.set(bx, getWaterSurfaceY(bx, bz) + dip, bz);
              rival.fishPos.set(bx, -0.22, bz);
              showFish = true;
              showHookOnFish = true;

              if (rival.phaseTimer < 0.35) {
                rightArmPitch = -0.22;
                rodPitch = -0.58;
                torsoLean = -0.15;
                bendAmt = 0.18;
              }
              if (rival.phaseTimer <= 0) {
                rival.soloPhase = 'reeling';
                rival.phaseTimer = 6.5;
                rival.splashTimer = 0.2;
                onSplash(bx, bz, 1.05);
              }
              break;
            }
            case 'reeling': {
              rival.phaseTimer -= dt;
              crankActive = true;
              showFish = true;
              showHookOnFish = true;
              lineFollowsMouth = true;
              rightArmPitch = -0.2 + Math.sin(elapsed * 3.8) * 0.05;
              rodPitch = -0.56 + Math.sin(elapsed * 4.6 + idx) * 0.06;
              torsoLean = -0.22 + Math.sin(elapsed * 3.2) * 0.04;
              leftArmYaw = 0.62;
              leftArmPitch = 0.68;
              bendAmt = 0.24 + Math.sin(elapsed * 5.0) * 0.03;

              // Pull distinct 3D fish visibly near water surface toward platform with splashing struggle
              tmpToPlat.set(
                rival.platformPos.x - rival.fishPos.x,
                0,
                rival.platformPos.z - rival.fishPos.z,
              );
              const distToPlat = tmpToPlat.length();
              if (distToPlat > 0.05) {
                tmpToPlat.divideScalar(distToPlat);
                rival.fishPos.x += tmpToPlat.x * 1.9 * dt + Math.sin(elapsed * 6.5 + idx) * 0.52 * dt;
                rival.fishPos.z += tmpToPlat.z * 1.9 * dt + Math.cos(elapsed * 5.5 + idx) * 0.42 * dt;
              }
              const surfY = getWaterSurfaceY(rival.fishPos.x, rival.fishPos.z);
              rival.fishPos.y = surfY - 0.07 + Math.max(0, Math.sin(elapsed * 5.2)) * 0.16;
              rival.bobberPos.set(rival.fishPos.x, surfY + 0.02, rival.fishPos.z);

              rival.splashTimer -= dt;
              if (rival.splashTimer <= 0) {
                rival.splashTimer = 0.55;
                onRipple(rival.fishPos.x, rival.fishPos.z, 0.78);
                if (distToPlat < 7.0) {
                  onSplash(rival.fishPos.x, rival.fishPos.z, 0.92);
                }
              }

              rival.fishRoot.rotation.set(0.12, Math.atan2(tmpToPlat.x, tmpToPlat.z) + Math.sin(elapsed * 8) * 0.25, 0);

              if (distToPlat <= 2.35 || rival.phaseTimer <= 0) {
                rival.soloPhase = 'lifting';
                rival.phaseTimer = 1.45;
                rival.cutawaySequenceElapsed = 0;
                rival.basketAddedThisCatch = false;
                rival.basketSplashPlayed = false;
                onSplash(rival.fishPos.x, rival.fishPos.z, 1.15);
                if (idx === 0) {
                  abuAliCutawayJustStarted = true;
                }
              }
              break;
            }
            case 'lifting': {
              // Lift fish cleanly OUT of the water, hanging visibly from the fishing hook!
              rival.phaseTimer -= dt;
              rival.cutawaySequenceElapsed += dt;
              const p = THREE.MathUtils.clamp(1 - rival.phaseTimer / 1.45, 0, 1);
              showFish = true;
              showHookOnFish = true;
              lineFollowsMouth = true;

              if (idx === 0) {
                abuAliCutawayActive = true;
                abuAliSpeciesNameAr = rival.currentSpecies.nameAr;
              }

              rightArmPitch = THREE.MathUtils.lerp(-0.24, -0.78, p);
              rodPitch = THREE.MathUtils.lerp(-0.56, -0.72, p);
              torsoLean = -0.1;
              bendAmt = THREE.MathUtils.lerp(0.22, 0.14, p);

              // Position lifted fish just in front of rival above the deck/water edge
              tmpLiftWorld.set(0.22 * (idx === 0 ? 1 : -1), 1.24, 1.08);
              tmpLiftWorld.applyAxisAngle(THREE.Object3D.DEFAULT_UP, rival.platformYaw).add(rival.platformPos);

              rival.fishPos.x = THREE.MathUtils.damp(rival.fishPos.x, tmpLiftWorld.x, 5.5, dt);
              rival.fishPos.y = THREE.MathUtils.damp(rival.fishPos.y, tmpLiftWorld.y + Math.sin(elapsed * 3.0) * 0.03, 5.5, dt);
              rival.fishPos.z = THREE.MathUtils.damp(rival.fishPos.z, tmpLiftWorld.z, 5.5, dt);

              // Hanging vertically/angled from the hook in its mouth, wriggling!
              rival.fishRoot.rotation.set(
                1.18 + Math.sin(elapsed * 7.5) * 0.12,
                rival.platformYaw + Math.sin(elapsed * 4.2) * 0.35,
                Math.sin(elapsed * 9.5) * 0.16,
              );

              rival.dripTimer -= dt;
              if (rival.dripTimer <= 0) {
                rival.dripTimer = 0.09;
                spawnFishDrip(rival);
              }

              if (rival.phaseTimer <= 0) {
                rival.soloPhase = 'depositing';
                rival.phaseTimer = 2.55;
              }
              break;
            }
            case 'depositing': {
              // Swing fish over wicker basket, unhook it with left hand, and drop it into the basket!
              rival.phaseTimer -= dt;
              rival.cutawaySequenceElapsed += dt;
              const p = THREE.MathUtils.clamp(1 - rival.phaseTimer / 2.55, 0, 1);
              showFish = p < 0.84;

              if (idx === 0) {
                abuAliCutawayActive = true;
                abuAliSpeciesNameAr = rival.currentSpecies.nameAr;
              }

              tmpBasketWorld.copy(rival.basketLocalPos);
              tmpBasketWorld.applyAxisAngle(THREE.Object3D.DEFAULT_UP, rival.platformYaw).add(rival.platformPos);

              tmpLiftWorld.set(0.22 * (idx === 0 ? 1 : -1), 1.24, 1.08);
              tmpLiftWorld.applyAxisAngle(THREE.Object3D.DEFAULT_UP, rival.platformYaw).add(rival.platformPos);

              const basketSideSign = idx === 0 ? 1 : -1;
              torsoYaw = Math.sin(Math.min(1, p * 1.4) * Math.PI) * -0.45 * basketSideSign;
              torsoLean = -0.14 - Math.sin(Math.min(1, p * 1.3) * Math.PI) * 0.16;

              if (p < 0.42) {
                // Phase A: Swing dangling fish from hook into center above the basket; left hand reaches to unhook!
                const t = THREE.MathUtils.smoothstep(p, 0, 0.42);
                showHookOnFish = true;
                lineFollowsMouth = true;

                rightArmPitch = THREE.MathUtils.lerp(-0.78, -0.42, t);
                rightArmYaw = THREE.MathUtils.lerp(0, 0.38 * basketSideSign, t);
                rodPitch = -0.68;
                leftArmPitch = THREE.MathUtils.lerp(0.45, -0.35, t);
                leftArmYaw = THREE.MathUtils.lerp(0.35, -0.15 * basketSideSign, t);
                bendAmt = THREE.MathUtils.lerp(0.14, 0.08, t);

                rival.fishPos.lerpVectors(tmpLiftWorld, tmpBasketWorld, t);
                rival.fishPos.y = THREE.MathUtils.lerp(tmpLiftWorld.y, tmpBasketWorld.y + 0.68, t);
                rival.fishRoot.rotation.set(
                  THREE.MathUtils.lerp(1.18, 0.92, t),
                  rival.platformYaw + Math.sin(elapsed * 6.5) * 0.22,
                  Math.sin(elapsed * 8.5) * 0.12,
                );

                rival.dripTimer -= dt;
                if (rival.dripTimer <= 0) {
                  rival.dripTimer = 0.12;
                  spawnFishDrip(rival);
                }
              } else if (p < 0.84) {
                // Phase B: Unhooked! Line swings cleanly back to rod tip & fish drops neatly inside the wicker basket!
                const t = THREE.MathUtils.smoothstep(p, 0.42, 0.82);
                showHookOnFish = false;
                lineFollowsMouth = false;

                rightArmPitch = THREE.MathUtils.lerp(-0.42, -0.2, t);
                rightArmYaw = THREE.MathUtils.lerp(0.38 * basketSideSign, 0, t);
                rodPitch = THREE.MathUtils.lerp(-0.68, -0.45, t);
                leftArmPitch = THREE.MathUtils.lerp(-0.35, 0.45, t);
                leftArmYaw = THREE.MathUtils.lerp(-0.15 * basketSideSign, 0.35, t);
                bendAmt = 0.04;

                const dropStartY = tmpBasketWorld.y + 0.68;
                const dropEndY = tmpBasketWorld.y + 0.24;
                rival.fishPos.set(
                  tmpBasketWorld.x,
                  THREE.MathUtils.lerp(dropStartY, dropEndY, t * t),
                  tmpBasketWorld.z,
                );
                rival.fishRoot.rotation.set(
                  THREE.MathUtils.lerp(0.92, 0.18, t),
                  rival.platformYaw + 0.55,
                  THREE.MathUtils.lerp(0, 1.15, t),
                );

                // Slight joyful basket bounce + deposit persistent species replica inside the basket
                if (p > 0.72 && !rival.basketAddedThisCatch) {
                  rival.basketAddedThisCatch = true;
                  addFishReplicaToBasket(rival, rival.currentSpecies);
                }
                if (p > 0.72 && p < 0.88) {
                  const bounce = Math.sin(((p - 0.72) / 0.16) * Math.PI);
                  rival.basketGroup.position.y = rival.basketLocalPos.y - bounce * 0.018;
                  rival.basketGroup.rotation.z = bounce * 0.04 * basketSideSign;
                }
              } else {
                // Phase C: Relax upright with basket settled
                const t = THREE.MathUtils.smoothstep(p, 0.84, 1.0);
                rival.basketGroup.position.y = rival.basketLocalPos.y;
                rival.basketGroup.rotation.z = 0;
                rightArmPitch = THREE.MathUtils.lerp(-0.2, -0.55, t);
                rodPitch = THREE.MathUtils.lerp(-0.45, -0.6, t);
                torsoYaw *= 1 - t;
                torsoLean = THREE.MathUtils.lerp(-0.14, 0.05, t);
              }

              if (rival.phaseTimer <= 0) {
                rival.basketGroup.position.y = rival.basketLocalPos.y;
                rival.basketGroup.rotation.z = 0;
                rival.soloPhase = 'charging';
                rival.phaseTimer = 1.05;
              }
              break;
            }
          }

          rival.fishRoot.visible = showFish;
          rival.fishHookGroup.visible = showHookOnFish;
          if (showFish) {
            rival.swimPhase += dt * (rival.soloPhase === 'lifting' || rival.soloPhase === 'depositing' ? 11.0 : 15.0);
            rival.fishTailPivot.rotation.y = Math.sin(rival.swimPhase) * 0.42;
            rival.fishRoot.position.copy(rival.fishPos);
          }
        }

        if (crankActive) {
          rival.reelCrankPivot.rotation.x -= dt * 13.0;
          leftArmPitch = 0.68 + Math.sin(rival.reelCrankPivot.rotation.x) * 0.07;
        }

        rival.root.rotation.y = targetYaw;
        rival.torsoPivot.rotation.x = THREE.MathUtils.damp(rival.torsoPivot.rotation.x, torsoLean, 7, dt);
        rival.torsoPivot.rotation.y = THREE.MathUtils.damp(rival.torsoPivot.rotation.y, torsoYaw, 7, dt);
        rival.rightArmPivot.rotation.x = THREE.MathUtils.damp(rival.rightArmPivot.rotation.x, rightArmPitch, 8, dt);
        rival.rightArmPivot.rotation.y = THREE.MathUtils.damp(rival.rightArmPivot.rotation.y, rightArmYaw, 8, dt);
        rival.leftArmPivot.rotation.y = THREE.MathUtils.damp(rival.leftArmPivot.rotation.y, leftArmYaw, 7, dt);
        rival.leftArmPivot.rotation.x = THREE.MathUtils.damp(rival.leftArmPivot.rotation.x, leftArmPitch, 7, dt);
        rival.rodPivot.rotation.x = THREE.MathUtils.damp(rival.rodPivot.rotation.x, rodPitch, 8, dt);

        rival.rodSegments.forEach((seg, sIdx) => {
          const w = (sIdx + 1) / rival.rodSegments.length;
          seg.rotation.x = bendAmt * w;
        });

        rival.root.updateMatrixWorld(true);
        rival.rodTipMarker.getWorldPosition(tmpTip);

        if (lineFollowsMouth && showFish) {
          rival.fishRoot.updateMatrixWorld(true);
          rival.fishMouthMarker.getWorldPosition(tmpMouthWorld);
          rival.bobberPos.lerpVectors(tmpTip, tmpMouthWorld, 0.72);
        } else if (rival.soloPhase === 'depositing' && !lineFollowsMouth) {
          rival.bobberPos.set(tmpTip.x, tmpTip.y - 0.55, tmpTip.z);
        }

        rival.bobber.position.copy(rival.bobberPos);

        const lineEndPos = lineFollowsMouth && showFish ? tmpMouthWorld : rival.bobberPos;
        const sag =
          isContesting || rival.soloPhase === 'reeling' || rival.soloPhase === 'lifting' || rival.soloPhase === 'depositing'
            ? 0.025
            : 0.25;
        for (let i = 0; i < LINE_PTS; i++) {
          const t = i / (LINE_PTS - 1);
          tmpPt.lerpVectors(tmpTip, lineEndPos, t);
          tmpPt.y -= Math.sin(t * Math.PI) * sag;
          rival.linePositions[i * 3] = tmpPt.x;
          rival.linePositions[i * 3 + 1] = tmpPt.y;
          rival.linePositions[i * 3 + 2] = tmpPt.z;
        }
        rival.lineGeo.attributes.position.needsUpdate = true;

        // Update dripping water particles
        for (const p of rival.dripParticles) {
          if (!p.active) continue;
          p.age += dt;
          if (p.age >= p.maxAge) {
            p.active = false;
            p.mesh.visible = false;
            continue;
          }
          p.vel.y -= 9.6 * dt;
          p.pos.addScaledVector(p.vel, dt);
          p.mesh.position.copy(p.pos);
          if (p.pos.y <= getWaterSurfaceY(p.pos.x, p.pos.z)) {
            onRipple(p.pos.x, p.pos.z, 0.14);
            p.active = false;
            p.mesh.visible = false;
          }
        }

        // Compute live close-up cutaway camera target for Abu Ali (idx === 0) while putting caught fish into basket
        if (idx === 0 && abuAliCutawayActive) {
          const seqT = rival.cutawaySequenceElapsed;
          const panX = Math.sin(seqT * 0.75) * 0.34;
          const liftY = Math.cos(seqT * 0.65) * 0.06;

          cutawayCamPos.set(1.55 + panX, 1.52 + liftY, 2.95);
          cutawayCamPos.applyAxisAngle(THREE.Object3D.DEFAULT_UP, rival.platformYaw).add(rival.platformPos);

          if (rival.soloPhase === 'lifting') {
            cutawayLookAt.set(0.18, 0.96, 0.78);
          } else {
            cutawayLookAt.set(0.32, 0.62, 0.62);
          }
          cutawayLookAt.applyAxisAngle(THREE.Object3D.DEFAULT_UP, rival.platformYaw).add(rival.platformPos);
        }
      });

      const activeRival = activeContestRivalIdx !== -1 ? rivals[activeContestRivalIdx] : null;
      return {
        contestActive: activeRival !== null,
        rivalName: activeRival ? activeRival.nameAr : null,
        contestBalance,
        justStarted,
        justWon,
        justStolen,
        pullVectorX,
        pullVectorZ,
        abuAliCutaway: {
          active: abuAliCutawayActive,
          justStarted: abuAliCutawayJustStarted,
          speciesNameAr: abuAliSpeciesNameAr,
          camPos: cutawayCamPos,
          lookAt: cutawayLookAt,
        },
      };
    },
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
