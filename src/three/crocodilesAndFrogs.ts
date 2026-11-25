import * as THREE from 'three';
import type { WeatherType } from '../types/fishing';
import type { RivalActiveFishTarget } from './rivalAnglers';

import { groundHeightAt } from './environment';

export interface CrocodileUpdateResult {
  threatActive: boolean;
  distanceToFish: number;
  devoured: boolean;
  devouredRivalIndices: number[];
  chasingRivalName: string | null;
}

export interface WildFishPrey {
  id: number;
  position: THREE.Vector3;
  aiState: string;
}

export interface CrocodilesAndFrogsSystem {
  group: THREE.Group;
  update: (params: {
    dt: number;
    elapsed: number;
    weather: WeatherType;
    nightFactor: number;
    hookedFishPos: THREE.Vector3 | null;
    hookedFishDistToDock: number;
    playerReeling: boolean;
    rivalFishTargets: RivalActiveFishTarget[];
    wildFishes?: readonly WildFishPrey[];
    boatPos?: THREE.Vector3 | null;
    getWaterSurfaceY: (x: number, z: number) => number;
    onRipple: (x: number, z: number, strength: number) => void;
    onSplash: (x: number, z: number, intensity: number) => void;
    onCrocSnap: () => void;
    onFrogCroak: (pan: number) => void;
    onWildFishScatter?: (x: number, z: number) => void;
  }) => CrocodileUpdateResult;
  dispose: () => void;
}

type CrocState = 'patrol' | 'hunting' | 'satiated';
type PatrolSubMode = 'cruise' | 'drift' | 'submerge' | 'stalk_wild';

interface CrocLegRig {
  pivot: THREE.Group;
  side: -1 | 1;
  isFront: boolean;
  phaseOffset: number;
}

interface CrocInstance {
  root: THREE.Group;
  bodyPivot: THREE.Group;
  headPivot: THREE.Group;
  lowerJawPivot: THREE.Group;
  tailSegs: THREE.Group[];
  legs: CrocLegRig[];
  pos: THREE.Vector3;
  heading: number;
  patrolCenter: THREE.Vector2;
  patrolRadius: number;
  wanderTarget: THREE.Vector2;
  wanderTimer: number;
  patrolMode: PatrolSubMode;
  modeTimer: number;
  state: CrocState;
  targetKind: 'none' | 'player' | 'rival';
  targetRivalIndex: number;
  targetRivalName: string | null;
  wildTargetId: number;
  wildChaseCooldown: number;
  cooldownTimer: number;
  rippleTimer: number;
  splashTimer: number;
  bowWaveTimer: number;
  swimPhase: number;
  smoothSpeed: number;
  turnRate: number;
  bankRoll: number;
  headYaw: number;
  headScanPhase: number;
  bodySubmergeY: number;
  sprintBlend: number;
  jawOpen: number;
  lungeTimer: number;
  lungeDuration: number;
  lungeMidSplashDone: boolean;
  lungePitch: number;
}

interface FrogInstance {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  throatSac: THREE.Mesh;
  padRoot: THREE.Group;
  baseX: number;
  baseZ: number;
  baseYaw: number;
  croakTimer: number;
  croakActiveTimer: number;
  hopTimer: number;
  hopProgress: number;
  hopDistance: number;
}

function isSafeCrocWater(x: number, z: number): boolean {
  if (x < -70 || x > 70 || z < -90 || z > -4.5) return false;
  if (Math.abs(x) < 4.8 && z > -11.0) return false; // main wooden dock clearance
  if (Math.hypot(x + 18.5, z + 3.5) < 4.8) return false; // Abu Ali platform clearance
  if (Math.hypot(x - 19.0, z + 4.2) < 4.8) return false; // Rami platform clearance
  return groundHeightAt(x, z) < -0.78;
}

function pickCrocWanderTarget(croc: CrocInstance): void {
  const baseAngle = Math.atan2(croc.pos.z - croc.patrolCenter.y, croc.pos.x - croc.patrolCenter.x);
  for (let attempt = 0; attempt < 12; attempt++) {
    const angOffset = (Math.random() < 0.5 ? 1 : -1) * (0.65 + Math.random() * 1.65);
    const angle = baseAngle + angOffset;
    const rad = croc.patrolRadius * (0.45 + Math.random() * 0.95);
    const wx = croc.patrolCenter.x + Math.cos(angle) * rad;
    const wz = croc.patrolCenter.y + Math.sin(angle) * rad * 0.8;
    if (isSafeCrocWater(wx, wz)) {
      croc.wanderTarget.set(wx, wz);
      croc.wanderTimer = 5.5 + Math.random() * 6.5;
      return;
    }
  }
  croc.wanderTarget.set(
    THREE.MathUtils.clamp(croc.patrolCenter.x, -42, 42),
    THREE.MathUtils.clamp(croc.patrolCenter.y, -68, -20),
  );
  croc.wanderTimer = 6.0;
}

export function createCrocodilesAndFrogs(): CrocodilesAndFrogsSystem {
  const group = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  // ==================== CROCODILES (4 Articulated Lake Predators) ====================
  const crocHideMat = new THREE.MeshStandardMaterial({
    color: 0x35442b,
    roughness: 0.72,
    metalness: 0.06,
  });
  const crocScuteMat = new THREE.MeshStandardMaterial({
    color: 0x26311f,
    roughness: 0.82,
    metalness: 0.04,
  });
  const crocBellyMat = new THREE.MeshStandardMaterial({
    color: 0xb7b38d,
    roughness: 0.78,
  });
  const crocEyeMat = new THREE.MeshStandardMaterial({
    color: 0xd9b343,
    roughness: 0.2,
    metalness: 0.25,
    emissive: 0x3a2e08,
    emissiveIntensity: 0.25,
  });
  const crocPupilMat = new THREE.MeshStandardMaterial({
    color: 0x090b08,
    roughness: 0.08,
  });
  const crocToothMat = new THREE.MeshStandardMaterial({
    color: 0xf1ebd8,
    roughness: 0.35,
  });

  const torsoGeo = new THREE.CapsuleGeometry(0.24, 0.95, 6, 12);
  torsoGeo.rotateX(Math.PI / 2);
  torsoGeo.scale(1.15, 0.62, 1.0);
  const bellyGeo = new THREE.CapsuleGeometry(0.22, 0.88, 5, 10);
  bellyGeo.rotateX(Math.PI / 2);
  bellyGeo.scale(1.06, 0.45, 1.0);
  const headGeo = new THREE.BoxGeometry(0.32, 0.14, 0.38);
  const snoutTopGeo = new THREE.BoxGeometry(0.21, 0.085, 0.56);
  const snoutTipGeo = new THREE.CylinderGeometry(0.085, 0.105, 0.085, 10);
  const nostrilGeo = new THREE.SphereGeometry(0.022, 6, 6);
  const lowerJawGeo = new THREE.BoxGeometry(0.20, 0.065, 0.56);
  const eyeRidgeGeo = new THREE.SphereGeometry(0.046, 8, 8);
  const eyeBallGeo = new THREE.SphereGeometry(0.028, 8, 8);
  const toothGeo = new THREE.ConeGeometry(0.013, 0.042, 5);
  const scuteGeo = new THREE.ConeGeometry(0.036, 0.065, 5);
  const tailScuteGeo = new THREE.ConeGeometry(0.028, 0.082, 4);
  const legGeo = new THREE.CapsuleGeometry(0.052, 0.22, 4, 8);
  const footGeo = new THREE.BoxGeometry(0.11, 0.026, 0.14);
  const tail1Geo = new THREE.ConeGeometry(0.18, 0.72, 8);
  tail1Geo.rotateX(-Math.PI / 2);
  tail1Geo.translate(0, 0, -0.36);
  const tail2Geo = new THREE.ConeGeometry(0.125, 0.68, 8);
  tail2Geo.rotateX(-Math.PI / 2);
  tail2Geo.translate(0, 0, -0.34);
  const tail3Geo = new THREE.ConeGeometry(0.075, 0.62, 7);
  tail3Geo.rotateX(-Math.PI / 2);
  tail3Geo.translate(0, 0, -0.31);

  disposables.push(
    crocHideMat,
    crocScuteMat,
    crocBellyMat,
    crocEyeMat,
    crocPupilMat,
    crocToothMat,
    torsoGeo,
    bellyGeo,
    headGeo,
    snoutTopGeo,
    snoutTipGeo,
    nostrilGeo,
    lowerJawGeo,
    eyeRidgeGeo,
    eyeBallGeo,
    toothGeo,
    scuteGeo,
    tailScuteGeo,
    legGeo,
    footGeo,
    tail1Geo,
    tail2Geo,
    tail3Geo,
  );

  function buildCrocodile(scale: number): {
    root: THREE.Group;
    bodyPivot: THREE.Group;
    headPivot: THREE.Group;
    lowerJawPivot: THREE.Group;
    tailSegs: THREE.Group[];
    legs: CrocLegRig[];
  } {
    const root = new THREE.Group();
    const bodyPivot = new THREE.Group();
    root.add(bodyPivot);

    const torso = new THREE.Mesh(torsoGeo, crocHideMat);
    torso.castShadow = true;
    torso.receiveShadow = true;
    bodyPivot.add(torso);

    const belly = new THREE.Mesh(bellyGeo, crocBellyMat);
    belly.position.y = -0.06;
    bodyPivot.add(belly);

    // Armored osteoderm ridges along back (tapered at neck & hips)
    for (let row = 0; row < 6; row++) {
      const rz = -0.45 + row * 0.19;
      const taper = row === 0 || row === 5 ? 0.78 : 1.0;
      for (const sx of [-0.085, 0.085]) {
        const scute = new THREE.Mesh(scuteGeo, crocScuteMat);
        scute.position.set(sx, 0.145, rz);
        scute.scale.setScalar(taper);
        scute.castShadow = true;
        bodyPivot.add(scute);
      }
    }

    // Articulated Neck & Head Pivot (enables independent prey-tracking & predatory head-shake)
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.02, 0.54);
    bodyPivot.add(headPivot);

    const head = new THREE.Mesh(headGeo, crocHideMat);
    head.position.set(0, 0.02, 0.18);
    head.castShadow = true;
    head.receiveShadow = true;
    headPivot.add(head);

    const snoutTop = new THREE.Mesh(snoutTopGeo, crocHideMat);
    snoutTop.position.set(0, 0.012, 0.58);
    snoutTop.castShadow = true;
    headPivot.add(snoutTop);

    const snoutTip = new THREE.Mesh(snoutTipGeo, crocScuteMat);
    snoutTip.position.set(0, 0.012, 0.86);
    headPivot.add(snoutTip);

    // Raised nostrils & periscope-like eye sockets peeking above the water line
    for (const side of [-1, 1]) {
      const nostril = new THREE.Mesh(nostrilGeo, crocScuteMat);
      nostril.position.set(side * 0.036, 0.056, 0.85);
      headPivot.add(nostril);

      const ridge = new THREE.Mesh(eyeRidgeGeo, crocScuteMat);
      ridge.position.set(side * 0.11, 0.095, 0.20);
      const eyeball = new THREE.Mesh(eyeBallGeo, crocEyeMat);
      eyeball.position.set(side * 0.125, 0.102, 0.215);
      const pupil = new THREE.Mesh(eyeBallGeo, crocPupilMat);
      pupil.scale.set(0.35, 0.85, 0.7);
      pupil.position.set(side * 0.138, 0.102, 0.222);
      headPivot.add(ridge, eyeball, pupil);
    }

    // Upper teeth
    for (let t = 0; t < 5; t++) {
      const tz = 0.40 + t * 0.1;
      for (const side of [-1, 1]) {
        const tooth = new THREE.Mesh(toothGeo, crocToothMat);
        tooth.rotation.x = Math.PI;
        tooth.position.set(side * 0.088, -0.035, tz);
        headPivot.add(tooth);
      }
    }

    // Articulated Lower Jaw inside headPivot
    const lowerJawPivot = new THREE.Group();
    lowerJawPivot.position.set(0, -0.04, 0.28);
    const lowerJaw = new THREE.Mesh(lowerJawGeo, crocBellyMat);
    lowerJaw.position.set(0, -0.02, 0.28);
    lowerJaw.castShadow = true;
    lowerJawPivot.add(lowerJaw);

    for (let t = 0; t < 4; t++) {
      const tz = 0.14 + t * 0.11;
      for (const side of [-1, 1]) {
        const tooth = new THREE.Mesh(toothGeo, crocToothMat);
        tooth.position.set(side * 0.082, 0.018, tz);
        lowerJawPivot.add(tooth);
      }
    }
    headPivot.add(lowerJawPivot);

    // 4 Articulated Splayed Swimming Legs with webbed paddle feet
    const legs: CrocLegRig[] = [];
    const legSpecs: { x: number; y: number; z: number; side: -1 | 1; isFront: boolean; phase: number }[] = [
      { x: -0.23, y: -0.04, z: 0.36, side: -1, isFront: true, phase: 0 },
      { x: 0.23, y: -0.04, z: 0.36, side: 1, isFront: true, phase: Math.PI },
      { x: -0.24, y: -0.05, z: -0.35, side: -1, isFront: false, phase: Math.PI + 0.2 },
      { x: 0.24, y: -0.05, z: -0.35, side: 1, isFront: false, phase: 0.2 },
    ];
    for (const spec of legSpecs) {
      const legPivot = new THREE.Group();
      legPivot.position.set(spec.x, spec.y, spec.z);

      const leg = new THREE.Mesh(legGeo, crocScuteMat);
      leg.position.set(spec.side * 0.11, -0.04, 0);
      leg.rotation.z = spec.side * -1.16;
      leg.rotation.y = spec.side * -0.25;
      leg.castShadow = true;
      legPivot.add(leg);

      const foot = new THREE.Mesh(footGeo, crocScuteMat);
      foot.position.set(spec.side * 0.21, -0.085, 0.02);
      foot.rotation.y = spec.side * -0.35;
      legPivot.add(foot);

      bodyPivot.add(legPivot);
      legs.push({
        pivot: legPivot,
        side: spec.side,
        isFront: spec.isFront,
        phaseOffset: spec.phase,
      });
    }

    // 3-Segment Sinuous Swimming Tail with serrated dorsal scute ridge
    const tail1 = new THREE.Group();
    tail1.position.set(0, 0.01, -0.58);
    const t1Mesh = new THREE.Mesh(tail1Geo, crocHideMat);
    t1Mesh.scale.set(1.0, 0.65, 1.0);
    t1Mesh.castShadow = true;
    tail1.add(t1Mesh);
    for (let s = 0; s < 3; s++) {
      const scute = new THREE.Mesh(tailScuteGeo, crocScuteMat);
      scute.position.set(0, 0.11 - s * 0.018, -0.16 - s * 0.19);
      tail1.add(scute);
    }

    const tail2 = new THREE.Group();
    tail2.position.set(0, 0, -0.64);
    const t2Mesh = new THREE.Mesh(tail2Geo, crocHideMat);
    t2Mesh.scale.set(0.85, 0.72, 1.0);
    t2Mesh.castShadow = true;
    tail2.add(t2Mesh);
    for (let s = 0; s < 3; s++) {
      const scute = new THREE.Mesh(tailScuteGeo, crocScuteMat);
      scute.scale.set(0.75, 0.85, 0.9);
      scute.position.set(0, 0.075 - s * 0.014, -0.14 - s * 0.19);
      tail2.add(scute);
    }

    const tail3 = new THREE.Group();
    tail3.position.set(0, 0, -0.60);
    const t3Mesh = new THREE.Mesh(tail3Geo, crocScuteMat);
    t3Mesh.scale.set(0.55, 0.85, 1.0);
    t3Mesh.castShadow = true;
    tail3.add(t3Mesh);

    tail2.add(tail3);
    tail1.add(tail2);
    bodyPivot.add(tail1);

    root.scale.setScalar(scale);
    group.add(root);
    return { root, bodyPivot, headPivot, lowerJawPivot, tailSegs: [tail1, tail2, tail3], legs };
  }

  const crocSpecs = [
    { cx: -21.0, cz: -22.5, radius: 10.5, scale: 1.15, angle: 0.4 },
    { cx: 21.5, cz: -23.5, radius: 10.5, scale: 1.08, angle: 2.3 },
    { cx: -4.5, cz: -36.0, radius: 13.0, scale: 1.24, angle: 4.5 },
    { cx: 15.0, cz: -49.0, radius: 12.0, scale: 1.12, angle: 1.2 },
  ];

  const crocs: CrocInstance[] = crocSpecs.map((spec, idx) => {
    const built = buildCrocodile(spec.scale);
    const px = spec.cx + Math.cos(spec.angle) * spec.radius * 0.85;
    const pz = spec.cz + Math.sin(spec.angle) * spec.radius * 0.85;
    built.root.position.set(px, -0.075, pz);
    const croc: CrocInstance = {
      ...built,
      pos: new THREE.Vector3(px, -0.075, pz),
      heading: spec.angle + Math.PI * 0.5,
      patrolCenter: new THREE.Vector2(spec.cx, spec.cz),
      patrolRadius: spec.radius,
      wanderTarget: new THREE.Vector2(spec.cx, spec.cz),
      wanderTimer: 2.5 + idx * 1.4,
      patrolMode: idx % 2 === 0 ? 'cruise' : 'drift',
      modeTimer: 4.0 + idx * 1.8,
      state: 'patrol',
      targetKind: 'none',
      targetRivalIndex: -1,
      targetRivalName: null,
      wildTargetId: -1,
      wildChaseCooldown: 6.0 + idx * 3.5,
      cooldownTimer: 0,
      rippleTimer: idx * 0.35,
      splashTimer: 0.5 + idx * 0.3,
      bowWaveTimer: 0.25 + idx * 0.15,
      swimPhase: idx * 1.9,
      smoothSpeed: 0.8,
      turnRate: 0,
      bankRoll: 0,
      headYaw: 0,
      headScanPhase: idx * 1.7,
      bodySubmergeY: -0.075,
      sprintBlend: 0,
      jawOpen: 0,
      lungeTimer: 0,
      lungeDuration: 0.9,
      lungeMidSplashDone: false,
      lungePitch: 0,
    };
    pickCrocWanderTarget(croc);
    return croc;
  });

  // ==================== FROGS & FLOATING LILY PADS (12 Marsh Frogs) ====================
  const padMat = new THREE.MeshStandardMaterial({
    color: 0x3b7a38,
    roughness: 0.72,
    side: THREE.DoubleSide,
  });
  const lotusMat = new THREE.MeshStandardMaterial({
    color: 0xf4a8be,
    roughness: 0.45,
  });
  const frogSkinMat = new THREE.MeshStandardMaterial({
    color: 0x4f9139,
    roughness: 0.34,
    metalness: 0.04,
  });
  const frogBellyMat = new THREE.MeshStandardMaterial({
    color: 0xd6dfa8,
    roughness: 0.48,
  });
  const frogEyeMat = new THREE.MeshStandardMaterial({
    color: 0xe3b83b,
    roughness: 0.18,
  });
  const frogPupilMat = new THREE.MeshStandardMaterial({
    color: 0x0b0d09,
    roughness: 0.08,
  });

  const padGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.02, 16, 1, false, 0.25, Math.PI * 1.84);
  const lotusPetalGeo = new THREE.ConeGeometry(0.055, 0.12, 6);
  const frogTorsoGeo = new THREE.SphereGeometry(0.095, 10, 8);
  frogTorsoGeo.scale(0.95, 0.72, 1.28);
  const frogHeadGeo = new THREE.SphereGeometry(0.068, 10, 8);
  frogHeadGeo.scale(1.12, 0.72, 0.95);
  const frogSacGeo = new THREE.SphereGeometry(0.052, 8, 8);
  const frogEyeGeo = new THREE.SphereGeometry(0.024, 8, 8);
  const frogPupilGeo = new THREE.SphereGeometry(0.013, 6, 6);
  const frogThighGeo = new THREE.CapsuleGeometry(0.028, 0.085, 4, 6);
  const frogFrontLegGeo = new THREE.CapsuleGeometry(0.016, 0.07, 4, 6);

  disposables.push(
    padMat,
    lotusMat,
    frogSkinMat,
    frogBellyMat,
    frogEyeMat,
    frogPupilMat,
    padGeo,
    lotusPetalGeo,
    frogTorsoGeo,
    frogHeadGeo,
    frogSacGeo,
    frogEyeGeo,
    frogPupilGeo,
    frogThighGeo,
    frogFrontLegGeo,
  );

  const frogSpots: [number, number, boolean][] = [
    [-9.5, -6.8, true],
    [-16.2, -13.5, false],
    [10.2, -7.2, true],
    [16.8, -14.0, false],
    [-29.5, -18.0, true],
    [30.5, -19.5, false],
    [-42.0, -28.5, true],
    [43.0, -30.0, true],
    [-22.0, -10.5, false],
    [22.5, -11.2, false],
    [-36.5, -48.0, true],
    [37.0, -49.5, false],
  ];

  const frogs: FrogInstance[] = frogSpots.map(([fx, fz, withLotus], idx) => {
    const padRoot = new THREE.Group();
    padRoot.position.set(fx, 0.01, fz);
    padRoot.rotation.y = idx * 1.15;

    const pad = new THREE.Mesh(padGeo, padMat);
    pad.receiveShadow = true;
    padRoot.add(pad);

    if (withLotus) {
      const flowerGroup = new THREE.Group();
      flowerGroup.position.set(0.18, 0.02, -0.14);
      for (let p = 0; p < 6; p++) {
        const ang = (p / 6) * Math.PI * 2;
        const petal = new THREE.Mesh(lotusPetalGeo, lotusMat);
        petal.position.set(Math.cos(ang) * 0.04, 0.03, Math.sin(ang) * 0.04);
        petal.rotation.z = Math.cos(ang) * 0.55;
        petal.rotation.x = Math.sin(ang) * 0.55;
        flowerGroup.add(petal);
      }
      padRoot.add(flowerGroup);
    }

    const root = new THREE.Group();
    const bodyGroup = new THREE.Group();
    bodyGroup.position.y = 0.055;

    const torso = new THREE.Mesh(frogTorsoGeo, frogSkinMat);
    torso.rotation.x = -0.32;
    torso.castShadow = true;
    bodyGroup.add(torso);

    const head = new THREE.Mesh(frogHeadGeo, frogSkinMat);
    head.position.set(0, 0.042, 0.095);
    head.castShadow = true;
    bodyGroup.add(head);

    const throatSac = new THREE.Mesh(frogSacGeo, frogBellyMat);
    throatSac.position.set(0, 0.012, 0.115);
    throatSac.scale.setScalar(0.55);
    bodyGroup.add(throatSac);

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(frogEyeGeo, frogEyeMat);
      eye.position.set(side * 0.045, 0.075, 0.115);
      const pupil = new THREE.Mesh(frogPupilGeo, frogPupilMat);
      pupil.position.set(side * 0.052, 0.078, 0.128);

      const thigh = new THREE.Mesh(frogThighGeo, frogSkinMat);
      thigh.position.set(side * 0.078, -0.012, -0.055);
      thigh.rotation.set(0.95, side * -0.45, side * -0.35);
      thigh.castShadow = true;

      const frontLeg = new THREE.Mesh(frogFrontLegGeo, frogSkinMat);
      frontLeg.position.set(side * 0.062, -0.015, 0.072);
      frontLeg.rotation.set(-0.35, 0, side * -0.25);

      bodyGroup.add(eye, pupil, thigh, frontLeg);
    }

    root.add(bodyGroup);
    const baseYaw = Math.atan2(-fx, -fz);
    root.position.set(fx, 0.02, fz);
    root.rotation.y = baseYaw;

    group.add(padRoot, root);

    return {
      root,
      bodyGroup,
      throatSac,
      padRoot,
      baseX: fx,
      baseZ: fz,
      baseYaw,
      croakTimer: 2.0 + Math.random() * 6.0,
      croakActiveTimer: 0,
      hopTimer: 5.5 + Math.random() * 9.0,
      hopProgress: -1,
      hopDistance: 0.45,
    };
  });

  const tmpDir = new THREE.Vector3();
  const tmpSteer = new THREE.Vector2();

  return {
    group,
    update: ({
      dt,
      elapsed,
      weather,
      nightFactor,
      hookedFishPos,
      hookedFishDistToDock,
      playerReeling,
      rivalFishTargets,
      wildFishes,
      boatPos,
      getWaterSurfaceY,
      onRipple,
      onSplash,
      onCrocSnap,
      onFrogCroak,
      onWildFishScatter,
    }) => {
      // 1. Assign Available Crocodiles Across Player & Rival Angler Catches (max 1 croc per target)
      for (const c of crocs) {
        if (c.state === 'satiated') {
          c.targetKind = 'none';
          c.targetRivalIndex = -1;
          c.targetRivalName = null;
        }
      }

      const usedCrocs = new Set<CrocInstance>();
      let playerHunter: CrocInstance | null = null;

      if (hookedFishPos) {
        // Keep existing player hunter if still active, else pick nearest available croc
        const existing = crocs.find((c) => c.state === 'hunting' && c.targetKind === 'player');
        if (existing) {
          playerHunter = existing;
        } else {
          let bestDist = Infinity;
          for (const c of crocs) {
            if (c.state === 'satiated') continue;
            const d = Math.hypot(hookedFishPos.x - c.pos.x, hookedFishPos.z - c.pos.z);
            if (d < bestDist) {
              bestDist = d;
              playerHunter = c;
            }
          }
        }
        if (playerHunter) {
          usedCrocs.add(playerHunter);
          playerHunter.state = 'hunting';
          playerHunter.targetKind = 'player';
          playerHunter.targetRivalIndex = -1;
          playerHunter.targetRivalName = null;
          playerHunter.wildTargetId = -1;
        }
      }

      let chasingRivalName: string | null = null;
      for (const rTarget of rivalFishTargets) {
        if (rTarget.distToPlatform <= 3.2) continue;
        let hunter: CrocInstance | null =
          crocs.find(
            (c) =>
              !usedCrocs.has(c) &&
              c.state === 'hunting' &&
              c.targetKind === 'rival' &&
              c.targetRivalIndex === rTarget.rivalIndex,
          ) ?? null;

        if (!hunter) {
          let bestDist = Infinity;
          for (const c of crocs) {
            if (usedCrocs.has(c) || c.state === 'satiated') continue;
            const d = Math.hypot(rTarget.pos.x - c.pos.x, rTarget.pos.z - c.pos.z);
            if (d < 56.0 && d < bestDist) {
              bestDist = d;
              hunter = c;
            }
          }
        }

        if (hunter) {
          usedCrocs.add(hunter);
          hunter.state = 'hunting';
          hunter.targetKind = 'rival';
          hunter.targetRivalIndex = rTarget.rivalIndex;
          hunter.targetRivalName = rTarget.rivalName;
          hunter.wildTargetId = -1;
          chasingRivalName = rTarget.rivalName;
        }
      }

      for (const c of crocs) {
        if (!usedCrocs.has(c) && c.state === 'hunting') {
          c.state = 'patrol';
          c.targetKind = 'none';
          c.targetRivalIndex = -1;
          c.targetRivalName = null;
          c.patrolMode = 'cruise';
          c.modeTimer = 5.0 + Math.random() * 5.0;
          pickCrocWanderTarget(c);
        }
      }

      let threatActive = false;
      let distanceToFish = 999;
      let devoured = false;
      const devouredRivalIndices: number[] = [];

      for (let ci = 0; ci < crocs.length; ci++) {
        const croc = crocs[ci];
        if (croc.wildChaseCooldown > 0) {
          croc.wildChaseCooldown = Math.max(0, croc.wildChaseCooldown - dt);
        }
        if (croc.state === 'satiated') {
          croc.cooldownTimer -= dt;
          if (croc.cooldownTimer <= 0) {
            croc.state = 'patrol';
            croc.patrolMode = 'cruise';
            croc.modeTimer = 6.0 + Math.random() * 6.0;
            pickCrocWanderTarget(croc);
          }
        }

        let desiredSpeed = 1.08;
        let targetX = croc.wanderTarget.x;
        let targetZ = croc.wanderTarget.y;
        let desiredDepthY = -0.075;
        let desiredJaw = 0.0;
        let activeChaseBurst = false;
        const isHunting = croc.state === 'hunting';

        if (isHunting && croc.targetKind === 'player' && hookedFishPos) {
          targetX = hookedFishPos.x;
          targetZ = hookedFishPos.z;
          const dist = Math.hypot(targetX - croc.pos.x, targetZ - croc.pos.z);
          threatActive = true;
          distanceToFish = dist;

          // Fair chase balance: fast intercept from very far (>22m), stealthy/surging close-in
          if (dist > 22.0) {
            desiredSpeed = 4.15;
            desiredDepthY = -0.035;
          } else if (playerReeling) {
            desiredSpeed = weather === 'storm' ? 2.48 : 2.15;
            desiredDepthY = dist < 11.0 ? 0.025 : -0.03;
          } else {
            desiredSpeed = weather === 'storm' ? 3.72 : 3.38;
            desiredDepthY = dist < 12.5 ? 0.03 : -0.025;
          }

          activeChaseBurst = dist < 13.0;
          desiredJaw = dist < 10.5 ? THREE.MathUtils.clamp((10.5 - dist) / 5.5, 0.16, 0.88) : 0.12;

          if (dist <= 1.55 && hookedFishDistToDock > 3.1) {
            devoured = true;
            croc.lungeDuration = 0.92;
            croc.lungeTimer = 0.92;
            croc.lungeMidSplashDone = false;
            croc.jawOpen = 0.94;
            croc.state = 'satiated';
            croc.targetKind = 'none';
            croc.cooldownTimer = 11.5;
            croc.patrolMode = 'submerge';
            croc.modeTimer = 5.0;
            onSplash(croc.pos.x, croc.pos.z, 2.45);
            onCrocSnap();
          }
        } else if (isHunting && croc.targetKind === 'rival') {
          const rTarget = rivalFishTargets.find((r) => r.rivalIndex === croc.targetRivalIndex);
          if (rTarget) {
            targetX = rTarget.pos.x;
            targetZ = rTarget.pos.z;
            const dist = Math.hypot(targetX - croc.pos.x, targetZ - croc.pos.z);
            desiredSpeed = dist > 18.0 ? 4.1 : 2.75;
            desiredDepthY = dist < 11.5 ? 0.025 : -0.035;
            activeChaseBurst = dist < 12.5;
            desiredJaw = dist < 10.0 ? THREE.MathUtils.clamp((10.0 - dist) / 5.0, 0.18, 0.86) : 0.14;

            if (dist <= 1.65 && rTarget.distToPlatform > 2.75) {
              devouredRivalIndices.push(rTarget.rivalIndex);
              croc.lungeDuration = 0.92;
              croc.lungeTimer = 0.92;
              croc.lungeMidSplashDone = false;
              croc.jawOpen = 0.94;
              croc.state = 'satiated';
              croc.targetKind = 'none';
              croc.targetRivalIndex = -1;
              croc.targetRivalName = null;
              croc.cooldownTimer = 11.0;
              croc.patrolMode = 'submerge';
              croc.modeTimer = 5.0;
              onSplash(croc.pos.x, croc.pos.z, 2.35);
              onCrocSnap();
            }
          } else {
            croc.state = 'patrol';
            croc.targetKind = 'none';
            croc.patrolMode = 'cruise';
            croc.modeTimer = 5.0;
            pickCrocWanderTarget(croc);
          }
        } else if (croc.state === 'satiated') {
          croc.wanderTimer -= dt;
          const distW = Math.hypot(croc.wanderTarget.x - croc.pos.x, croc.wanderTarget.y - croc.pos.z);
          if (croc.wanderTimer <= 0 || distW < 2.2) {
            pickCrocWanderTarget(croc);
          }
          targetX = croc.wanderTarget.x;
          targetZ = croc.wanderTarget.y;
          desiredSpeed = croc.lungeTimer > 0 ? 2.4 : 1.35;
          desiredDepthY = croc.lungeTimer > 0 ? 0.01 : -0.18;
        } else {
          // Organic Multi-Phase Lake Roaming & Wild Fish Stalking
          croc.modeTimer -= dt;

          // Opportunistically spot a nearby wild school fish while cruising or drifting
          if (
            (croc.patrolMode === 'cruise' || croc.patrolMode === 'drift') &&
            croc.wildChaseCooldown <= 0 &&
            wildFishes &&
            wildFishes.length > 0
          ) {
            let bestWild: WildFishPrey | null = null;
            let bestWildDist = 13.5;
            for (let fi = 0; fi < wildFishes.length; fi++) {
              const wf = wildFishes[fi];
              if (wf.aiState !== 'patrol' && wf.aiState !== 'curious') continue;
              const d = Math.hypot(wf.position.x - croc.pos.x, wf.position.z - croc.pos.z);
              if (d > 3.2 && d < bestWildDist && isSafeCrocWater(wf.position.x, wf.position.z)) {
                bestWildDist = d;
                bestWild = wf;
              }
            }
            if (bestWild) {
              croc.patrolMode = 'stalk_wild';
              croc.wildTargetId = bestWild.id;
              croc.modeTimer = 5.2;
            }
          }

          if (croc.patrolMode === 'stalk_wild') {
            const prey = wildFishes?.find(
              (wf) => wf.id === croc.wildTargetId && (wf.aiState === 'patrol' || wf.aiState === 'curious'),
            );
            if (!prey || croc.modeTimer <= 0 || !isSafeCrocWater(prey.position.x, prey.position.z)) {
              croc.patrolMode = 'cruise';
              croc.wildTargetId = -1;
              croc.wildChaseCooldown = 12.0 + Math.random() * 10.0;
              croc.modeTimer = 6.0 + Math.random() * 6.0;
              pickCrocWanderTarget(croc);
            } else {
              targetX = prey.position.x;
              targetZ = prey.position.z;
              const d = Math.hypot(targetX - croc.pos.x, targetZ - croc.pos.z);
              if (d > 5.8) {
                // Stealth stalking approach: low eyes-above-water silhouette
                desiredSpeed = 1.95;
                desiredDepthY = -0.065;
                desiredJaw = 0.08;
              } else {
                // Explosive surface burst toward wild fish!
                desiredSpeed = 3.45;
                desiredDepthY = -0.005;
                activeChaseBurst = true;
                desiredJaw = THREE.MathUtils.clamp((5.8 - d) / 4.2, 0.16, 0.72);
              }
              if (d <= 1.85) {
                // Snap lunge at wild school fish, scattering nearby school!
                croc.lungeDuration = 0.72;
                croc.lungeTimer = 0.72;
                croc.lungeMidSplashDone = false;
                croc.jawOpen = 0.85;
                croc.patrolMode = 'cruise';
                croc.wildTargetId = -1;
                croc.wildChaseCooldown = 16.0 + Math.random() * 12.0;
                croc.modeTimer = 7.0 + Math.random() * 5.0;
                pickCrocWanderTarget(croc);
                onSplash(croc.pos.x, croc.pos.z, 1.55);
                onWildFishScatter?.(croc.pos.x, croc.pos.z);
              }
            }
          } else {
            if (croc.modeTimer <= 0) {
              const r = Math.random();
              if (croc.patrolMode === 'cruise') {
                if (r < 0.48) {
                  croc.patrolMode = 'drift';
                  croc.modeTimer = 3.8 + Math.random() * 3.2;
                } else if (r < 0.82) {
                  croc.patrolMode = 'submerge';
                  croc.modeTimer = 4.2 + Math.random() * 3.0;
                } else {
                  croc.modeTimer = 6.5 + Math.random() * 6.0;
                  pickCrocWanderTarget(croc);
                }
              } else {
                croc.patrolMode = 'cruise';
                croc.modeTimer = 7.0 + Math.random() * 7.0;
                pickCrocWanderTarget(croc);
              }
            }

            croc.wanderTimer -= dt;
            const distToWander = Math.hypot(croc.wanderTarget.x - croc.pos.x, croc.wanderTarget.y - croc.pos.z);
            if (croc.wanderTimer <= 0 || distToWander < 2.4) {
              pickCrocWanderTarget(croc);
            }
            targetX = croc.wanderTarget.x;
            targetZ = croc.wanderTarget.y;

            if (croc.patrolMode === 'drift') {
              // Floating log ambush drift: almost motionless, eyes & nostrils just above surface
              desiredSpeed = 0.16;
              desiredDepthY = -0.098;
            } else if (croc.patrolMode === 'submerge') {
              // Silent subsurface glide beneath water line
              desiredSpeed = 1.18;
              desiredDepthY = -0.31;
            } else {
              // Natural cruising speed gently ebbs and flows
              desiredSpeed = 1.02 + Math.sin(elapsed * 0.45 + ci * 1.9) * 0.24;
              desiredDepthY = -0.072;
            }
          }
        }

        // Smooth jaw control (lunge snap overrides below)
        if (croc.lungeTimer <= 0) {
          croc.jawOpen = THREE.MathUtils.damp(croc.jawOpen, desiredJaw, 8.5, dt);
        }

        // Compute steering direction + obstacle/shore/boat/pairwise-croc avoidance
        tmpDir.set(targetX - croc.pos.x, 0, targetZ - croc.pos.z);
        const targetDist = tmpDir.length();
        if (targetDist > 0.05) {
          tmpSteer.set(tmpDir.x / targetDist, tmpDir.z / targetDist);
        } else {
          tmpSteer.set(Math.sin(croc.heading), Math.cos(croc.heading));
        }

        // Look-ahead shoreline & dock avoidance when roaming/satiated (or gentle boundary keep-out)
        const aheadX = croc.pos.x + Math.sin(croc.heading) * 3.4;
        const aheadZ = croc.pos.z + Math.cos(croc.heading) * 3.4;
        if (!isSafeCrocWater(aheadX, aheadZ)) {
          // Steer smoothly back toward deeper central lake
          const toDeepX = -croc.pos.x;
          const toDeepZ = -40 - croc.pos.z;
          const toDeepLen = Math.max(0.01, Math.hypot(toDeepX, toDeepZ));
          tmpSteer.x += (toDeepX / toDeepLen) * 1.65;
          tmpSteer.y += (toDeepZ / toDeepLen) * 1.65;
          if (croc.state === 'patrol' && croc.patrolMode !== 'stalk_wild') {
            pickCrocWanderTarget(croc);
          }
        }

        // Avoid clipping the player's boat hull
        if (boatPos) {
          const bx = croc.pos.x - boatPos.x;
          const bz = croc.pos.z - boatPos.z;
          const bDist = Math.hypot(bx, bz);
          if (bDist > 0.01 && bDist < 4.5) {
            const push = ((4.5 - bDist) / 4.5) * 2.1;
            tmpSteer.x += (bx / bDist) * push;
            tmpSteer.y += (bz / bDist) * push;
          }
        }

        // Pairwise separation from other crocodiles
        for (let oj = 0; oj < crocs.length; oj++) {
          if (oj === ci) continue;
          const other = crocs[oj];
          const ox = croc.pos.x - other.pos.x;
          const oz = croc.pos.z - other.pos.z;
          const oDist = Math.hypot(ox, oz);
          if (oDist > 0.01 && oDist < 4.8) {
            const push = ((4.8 - oDist) / 4.8) * 1.45;
            tmpSteer.x += (ox / oDist) * push;
            tmpSteer.y += (oz / oDist) * push;
          }
        }

        const steerLen = Math.hypot(tmpSteer.x, tmpSteer.y);
        const desiredHeading = steerLen > 0.001 ? Math.atan2(tmpSteer.x, tmpSteer.y) : croc.heading;
        let headingDiff = desiredHeading - croc.heading;
        while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
        while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;

        // Realistic angular inertia & turn-rate limit (no sideways crab-sliding!)
        const maxTurnRate = isHunting || croc.patrolMode === 'stalk_wild' ? 3.85 : 1.45;
        const desiredTurnRate = THREE.MathUtils.clamp(headingDiff * 2.8, -maxTurnRate, maxTurnRate);
        croc.turnRate = THREE.MathUtils.damp(croc.turnRate, desiredTurnRate, 6.5, dt);
        croc.heading += croc.turnRate * dt;

        // Sharp turns gently bleed excess linear speed like a real heavy swimmer
        const turnSlowdown = 1.0 - Math.min(0.45, Math.abs(headingDiff) * 0.25);
        const lungeSurge = croc.lungeTimer > 0 ? Math.sin((croc.lungeTimer / croc.lungeDuration) * Math.PI) * 1.9 : 0;
        const clampedDesired = Math.min(desiredSpeed * turnSlowdown + lungeSurge, targetDist / Math.max(0.02, dt));

        croc.smoothSpeed = THREE.MathUtils.damp(
          croc.smoothSpeed,
          clampedDesired,
          clampedDesired > croc.smoothSpeed ? 3.6 : 2.1,
          dt,
        );

        // Move strictly forward along heading (+ tiny 8% hydrodynamic alignment drift toward steer during tight turns)
        const fwdX = Math.sin(croc.heading);
        const fwdZ = Math.cos(croc.heading);
        croc.pos.x += fwdX * croc.smoothSpeed * dt;
        croc.pos.z += fwdZ * croc.smoothSpeed * dt;

        // Lunge ballistic arc, jaw clamp, and predatory head-shake/roll thrash
        const surfY = getWaterSurfaceY(croc.pos.x, croc.pos.z);
        let lungeY = 0;
        let headShakeYaw = 0;
        let lungeRoll = 0;
        let targetPitch = activeChaseBurst ? -0.055 : croc.patrolMode === 'submerge' ? 0.06 : 0;

        if (croc.lungeTimer > 0) {
          croc.lungeTimer = Math.max(0, croc.lungeTimer - dt);
          const p = 1 - croc.lungeTimer / Math.max(0.1, croc.lungeDuration); // 0 -> 1
          lungeY = Math.pow(Math.sin(p * Math.PI), 0.85) * 0.54;
          targetPitch = Math.sin(p * Math.PI) * -0.36 + 0.1 * p;

          if (p < 0.28) {
            croc.jawOpen = THREE.MathUtils.damp(croc.jawOpen, 0.94, 18.0, dt);
          } else {
            // Snap jaws tightly shut and perform violent lateral prey-shake!
            croc.jawOpen = THREE.MathUtils.damp(croc.jawOpen, 0.02, 22.0, dt);
            const shakeEnv = Math.sin(THREE.MathUtils.clamp((p - 0.26) / 0.68, 0, 1) * Math.PI);
            headShakeYaw = Math.sin(p * Math.PI * 5.2) * 0.36 * shakeEnv;
            lungeRoll = Math.sin(p * Math.PI * 5.2 + 0.6) * 0.24 * shakeEnv;
          }

          if (p >= 0.45 && !croc.lungeMidSplashDone) {
            croc.lungeMidSplashDone = true;
            onSplash(croc.pos.x + fwdX * 0.85, croc.pos.z + fwdZ * 0.85, 1.65);
          }
        }

        croc.bodySubmergeY = THREE.MathUtils.damp(croc.bodySubmergeY, desiredDepthY, 2.8, dt);
        croc.lungePitch = THREE.MathUtils.damp(croc.lungePitch, targetPitch, 9.5, dt);

        // Banking roll into turns + predatory snap roll + gentle water swell roll
        const turnRoll = THREE.MathUtils.clamp(-croc.turnRate * croc.smoothSpeed * 0.065, -0.18, 0.18);
        const swellRoll = Math.sin(elapsed * 1.4 + ci * 2.1) * 0.028;
        croc.bankRoll = THREE.MathUtils.damp(croc.bankRoll, turnRoll + lungeRoll + swellRoll, 8.5, dt);

        // Head looks into prey / into turns first, or slowly scans side-to-side when ambush-drifting
        croc.headScanPhase += dt * (croc.patrolMode === 'drift' ? 0.9 : 0.45);
        let desiredHeadYaw = 0;
        if (isHunting || croc.patrolMode === 'stalk_wild') {
          desiredHeadYaw = THREE.MathUtils.clamp(headingDiff * 0.72, -0.44, 0.44);
        } else if (croc.patrolMode === 'drift') {
          desiredHeadYaw = Math.sin(croc.headScanPhase) * 0.16;
        } else {
          desiredHeadYaw = THREE.MathUtils.clamp(croc.turnRate * 0.18 + Math.sin(croc.headScanPhase) * 0.05, -0.32, 0.32);
        }
        croc.headYaw = THREE.MathUtils.damp(croc.headYaw, desiredHeadYaw, 7.5, dt);

        // Subtle buoyancy bobbing
        const buoyancyBob = Math.sin(elapsed * 1.8 + ci * 1.7) * 0.012;
        croc.pos.y = surfY + croc.bodySubmergeY + lungeY + buoyancyBob;
        croc.root.position.copy(croc.pos);
        croc.root.rotation.set(0, croc.heading, 0);

        // Speed-coupled traveling S-wave propulsion through spine & 3-part tail
        const swimFreq = 0.9 + croc.smoothSpeed * 2.45 + (croc.lungeTimer > 0 ? 5.2 : 0);
        croc.swimPhase += dt * swimFreq;
        const targetSprint = croc.lungeTimer > 0 ? 1 : THREE.MathUtils.clamp((croc.smoothSpeed - 1.55) / 1.35, 0, 1);
        croc.sprintBlend = THREE.MathUtils.damp(croc.sprintBlend, targetSprint, 4.8, dt);

        const tailAmp = 0.05 + THREE.MathUtils.clamp(croc.smoothSpeed * 0.085, 0.02, 0.31) + (croc.lungeTimer > 0 ? 0.15 : 0);
        const turnTailCurve = THREE.MathUtils.clamp(-croc.turnRate * 0.22, -0.32, 0.32);

        // Body flex counter-balances the tail stroke while pitch/roll sit cleanly on bodyPivot
        croc.bodyPivot.rotation.set(
          croc.lungePitch + Math.cos(elapsed * 1.5 + ci) * 0.015,
          Math.sin(croc.swimPhase + 0.5) * tailAmp * 0.16 - turnTailCurve * 0.14,
          croc.bankRoll,
        );

        // Head holds tracking gaze (partially stabilizing against spine wiggle) + snap head-shake
        croc.headPivot.rotation.set(
          croc.lungeTimer > 0 ? -0.06 : croc.patrolMode === 'drift' ? -0.035 : 0,
          croc.headYaw + headShakeYaw - croc.bodyPivot.rotation.y * 0.55,
          headShakeYaw * 0.45,
        );
        croc.lowerJawPivot.rotation.x = croc.jawOpen;

        // Traveling S-wave amplitudes intensify toward tail tip
        const tailWeights = [0.72, 1.15, 1.55];
        const tailPhases = [-0.35, -1.25, -2.2];
        const tailTurnWeights = [0.45, 0.36, 0.25];
        for (let ti = 0; ti < croc.tailSegs.length; ti++) {
          croc.tailSegs[ti].rotation.y =
            Math.sin(croc.swimPhase + tailPhases[ti]) * tailAmp * tailWeights[ti] + turnTailCurve * tailTurnWeights[ti];
        }

        // Adaptive 4-Leg Gait: alternating diagonal paddles at slow cruise -> tucked flush against flanks during high-speed tail sprint!
        const paddleStrength = THREE.MathUtils.clamp(croc.smoothSpeed / 1.15, 0.1, 1.0) * (1 - croc.sprintBlend);
        for (let li = 0; li < croc.legs.length; li++) {
          const leg = croc.legs[li];
          const stroke = Math.sin(croc.swimPhase * 0.85 + leg.phaseOffset);
          const feather = Math.cos(croc.swimPhase * 0.85 + leg.phaseOffset);
          const paddleY = stroke * 0.46 * paddleStrength;
          const paddleX = feather * 0.22 * paddleStrength;
          // Tuck backward flush along body when sprinting via tail propulsion
          const tuckY = leg.side * (-1.02 * croc.sprintBlend);
          const tuckZ = leg.side * (0.28 * croc.sprintBlend);
          leg.pivot.rotation.set(paddleX, paddleY + tuckY, tuckZ);
        }

        // Natural speed-reactive ripples & bow splashes (quiet when drifting or submerged!)
        const isSubmerged = croc.bodySubmergeY < -0.18;
        croc.rippleTimer -= dt * (0.35 + croc.smoothSpeed * 0.65);
        if (croc.rippleTimer <= 0 && croc.smoothSpeed > 0.22) {
          croc.rippleTimer = activeChaseBurst ? 0.22 : 0.62;
          const rStrength = isSubmerged
            ? 0.24
            : THREE.MathUtils.clamp(0.28 + croc.smoothSpeed * 0.22, 0.28, 1.1);
          onRipple(croc.pos.x - fwdX * 0.45, croc.pos.z - fwdZ * 0.45, rStrength);
        }

        if ((activeChaseBurst || croc.lungeTimer > 0.18) && !isSubmerged) {
          croc.splashTimer -= dt;
          if (croc.splashTimer <= 0) {
            croc.splashTimer = 0.36;
            onSplash(croc.pos.x + fwdX * 1.05, croc.pos.z + fwdZ * 1.05, 0.88);
          }
          croc.bowWaveTimer -= dt;
          if (croc.bowWaveTimer <= 0) {
            croc.bowWaveTimer = 0.26;
            // Tail thrash splash behind stern
            onSplash(croc.pos.x - fwdX * 1.35, croc.pos.z - fwdZ * 1.35, 0.65);
          }
        }
      }

      // 2. Update Frogs & Floating Lily Pads
      const frogActivity = (weather === 'rain' ? 1.55 : 1.0) * (1.0 + nightFactor * 0.45);
      for (let i = 0; i < frogs.length; i++) {
        const frog = frogs[i];
        const padSurfY = getWaterSurfaceY(frog.baseX, frog.baseZ);
        frog.padRoot.position.y = padSurfY + 0.008;
        frog.padRoot.rotation.z = Math.sin(elapsed * 1.4 + i) * 0.04;

        // Croaking & inflating throat sac
        frog.croakTimer -= dt * frogActivity;
        if (frog.croakTimer <= 0 && frog.hopProgress < 0) {
          frog.croakTimer = 4.5 + Math.random() * 8.0;
          frog.croakActiveTimer = 0.65;
          const pan = THREE.MathUtils.clamp(frog.baseX / 16, -0.85, 0.85);
          onFrogCroak(pan);
        }

        if (frog.croakActiveTimer > 0) {
          frog.croakActiveTimer -= dt;
          const swell = Math.sin((frog.croakActiveTimer / 0.65) * Math.PI * 2) * 0.5 + 0.5;
          frog.throatSac.scale.setScalar(0.55 + swell * 0.85);
        } else {
          frog.throatSac.scale.setScalar(0.55);
        }

        // Occasional cheerful hop on lily pad / water surface
        if (frog.hopProgress >= 0) {
          frog.hopProgress += dt * 1.9;
          const t = Math.min(1, frog.hopProgress);
          const hopArc = Math.sin(t * Math.PI) * 0.34;
          const forwardOsc = Math.sin(t * Math.PI) * frog.hopDistance;
          frog.root.position.set(
            frog.baseX + Math.sin(frog.baseYaw) * forwardOsc,
            padSurfY + 0.015 + hopArc,
            frog.baseZ + Math.cos(frog.baseYaw) * forwardOsc,
          );
          frog.bodyGroup.rotation.x = Math.cos(t * Math.PI) * -0.45;
          if (t >= 1) {
            frog.hopProgress = -1;
            frog.bodyGroup.rotation.x = 0;
            onRipple(frog.root.position.x, frog.root.position.z, 0.36);
          }
        } else {
          frog.root.position.set(frog.baseX, padSurfY + 0.015, frog.baseZ);
          frog.hopTimer -= dt * frogActivity;
          if (frog.hopTimer <= 0) {
            frog.hopTimer = 7.0 + Math.random() * 11.0;
            frog.hopProgress = 0;
            onRipple(frog.baseX, frog.baseZ, 0.25);
          }
        }
      }

      return { threatActive, distanceToFish, devoured, devouredRivalIndices, chasingRivalName };
    },
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
