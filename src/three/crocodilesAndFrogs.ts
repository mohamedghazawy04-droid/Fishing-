import * as THREE from 'three';
import type { WeatherType } from '../types/fishing';
import type { RivalActiveFishTarget } from './rivalAnglers';

export interface CrocodileUpdateResult {
  threatActive: boolean;
  distanceToFish: number;
  devoured: boolean;
  devouredRivalIndices: number[];
  chasingRivalName: string | null;
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
    getWaterSurfaceY: (x: number, z: number) => number;
    onRipple: (x: number, z: number, strength: number) => void;
    onSplash: (x: number, z: number, intensity: number) => void;
    onCrocSnap: () => void;
    onFrogCroak: (pan: number) => void;
  }) => CrocodileUpdateResult;
  dispose: () => void;
}

type CrocState = 'patrol' | 'hunting' | 'satiated';

interface CrocInstance {
  root: THREE.Group;
  lowerJawPivot: THREE.Group;
  tailSegs: THREE.Group[];
  legs: THREE.Mesh[];
  pos: THREE.Vector3;
  heading: number;
  patrolCenter: THREE.Vector2;
  patrolRadius: number;
  patrolAngle: number;
  state: CrocState;
  targetKind: 'none' | 'player' | 'rival';
  targetRivalIndex: number;
  targetRivalName: string | null;
  cooldownTimer: number;
  rippleTimer: number;
  splashTimer: number;
  swimPhase: number;
  jawOpen: number;
  lungeTimer: number;
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

export function createCrocodilesAndFrogs(): CrocodilesAndFrogsSystem {
  const group = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  // ==================== CROCODILES (3 Articulated Lake Predators) ====================
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
  const lowerJawGeo = new THREE.BoxGeometry(0.20, 0.065, 0.56);
  const eyeRidgeGeo = new THREE.SphereGeometry(0.046, 8, 8);
  const eyeBallGeo = new THREE.SphereGeometry(0.028, 8, 8);
  const toothGeo = new THREE.ConeGeometry(0.013, 0.042, 5);
  const scuteGeo = new THREE.ConeGeometry(0.036, 0.065, 5);
  const legGeo = new THREE.CapsuleGeometry(0.055, 0.22, 4, 8);
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
    lowerJawGeo,
    eyeRidgeGeo,
    eyeBallGeo,
    toothGeo,
    scuteGeo,
    legGeo,
    tail1Geo,
    tail2Geo,
    tail3Geo,
  );

  function buildCrocodile(scale: number): Omit<CrocInstance, 'pos' | 'heading' | 'patrolCenter' | 'patrolRadius' | 'patrolAngle' | 'state' | 'targetKind' | 'targetRivalIndex' | 'targetRivalName' | 'cooldownTimer' | 'rippleTimer' | 'splashTimer' | 'swimPhase' | 'jawOpen' | 'lungeTimer' | 'lungePitch'> {
    const root = new THREE.Group();

    const torso = new THREE.Mesh(torsoGeo, crocHideMat);
    torso.castShadow = true;
    torso.receiveShadow = true;
    root.add(torso);

    const belly = new THREE.Mesh(bellyGeo, crocBellyMat);
    belly.position.y = -0.06;
    root.add(belly);

    // Armored osteoderm ridges along back
    for (let row = 0; row < 6; row++) {
      const rz = -0.45 + row * 0.19;
      for (const sx of [-0.085, 0.085]) {
        const scute = new THREE.Mesh(scuteGeo, crocScuteMat);
        scute.position.set(sx, 0.145, rz);
        scute.castShadow = true;
        root.add(scute);
      }
    }

    // Cranium & Upper Snout
    const head = new THREE.Mesh(headGeo, crocHideMat);
    head.position.set(0, 0.04, 0.72);
    head.castShadow = true;
    head.receiveShadow = true;
    root.add(head);

    const snoutTop = new THREE.Mesh(snoutTopGeo, crocHideMat);
    snoutTop.position.set(0, 0.032, 1.12);
    snoutTop.castShadow = true;
    root.add(snoutTop);

    const snoutTip = new THREE.Mesh(snoutTipGeo, crocScuteMat);
    snoutTip.position.set(0, 0.032, 1.40);
    root.add(snoutTip);

    // Raised periscope-like eye sockets peeking above the water line
    for (const side of [-1, 1]) {
      const ridge = new THREE.Mesh(eyeRidgeGeo, crocScuteMat);
      ridge.position.set(side * 0.11, 0.115, 0.74);
      const eyeball = new THREE.Mesh(eyeBallGeo, crocEyeMat);
      eyeball.position.set(side * 0.125, 0.122, 0.755);
      const pupil = new THREE.Mesh(eyeBallGeo, crocPupilMat);
      pupil.scale.set(0.35, 0.85, 0.7);
      pupil.position.set(side * 0.138, 0.122, 0.762);
      root.add(ridge, eyeball, pupil);
    }

    // Upper teeth
    for (let t = 0; t < 5; t++) {
      const tz = 0.94 + t * 0.1;
      for (const side of [-1, 1]) {
        const tooth = new THREE.Mesh(toothGeo, crocToothMat);
        tooth.rotation.x = Math.PI;
        tooth.position.set(side * 0.088, -0.015, tz);
        root.add(tooth);
      }
    }

    // Articulated Lower Jaw
    const lowerJawPivot = new THREE.Group();
    lowerJawPivot.position.set(0, -0.02, 0.82);
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
    root.add(lowerJawPivot);

    // 4 Splayed Swimming Legs
    const legs: THREE.Mesh[] = [];
    const legOffsets: [number, number, number][] = [
      [-0.28, -0.05, 0.36],
      [0.28, -0.05, 0.36],
      [-0.29, -0.06, -0.35],
      [0.29, -0.06, -0.35],
    ];
    for (const [lx, ly, lz] of legOffsets) {
      const leg = new THREE.Mesh(legGeo, crocScuteMat);
      leg.position.set(lx, ly, lz);
      leg.rotation.z = lx < 0 ? 1.12 : -1.12;
      leg.rotation.y = lx < 0 ? 0.45 : -0.45;
      leg.castShadow = true;
      root.add(leg);
      legs.push(leg);
    }

    // 3-Segment Sinuous Swimming Tail
    const tail1 = new THREE.Group();
    tail1.position.set(0, 0.01, -0.58);
    const t1Mesh = new THREE.Mesh(tail1Geo, crocHideMat);
    t1Mesh.scale.set(1.0, 0.65, 1.0);
    t1Mesh.castShadow = true;
    tail1.add(t1Mesh);

    const tail2 = new THREE.Group();
    tail2.position.set(0, 0, -0.64);
    const t2Mesh = new THREE.Mesh(tail2Geo, crocHideMat);
    t2Mesh.scale.set(0.85, 0.72, 1.0);
    t2Mesh.castShadow = true;
    tail2.add(t2Mesh);

    const tail3 = new THREE.Group();
    tail3.position.set(0, 0, -0.60);
    const t3Mesh = new THREE.Mesh(tail3Geo, crocScuteMat);
    t3Mesh.scale.set(0.55, 0.85, 1.0);
    t3Mesh.castShadow = true;
    tail3.add(t3Mesh);

    tail2.add(tail3);
    tail1.add(tail2);
    root.add(tail1);

    root.scale.setScalar(scale);
    group.add(root);
    return { root, lowerJawPivot, tailSegs: [tail1, tail2, tail3], legs };
  }

  const crocSpecs = [
    { cx: -21.0, cz: -22.5, radius: 9.5, scale: 1.15, angle: 0.4 },
    { cx: 21.5, cz: -23.5, radius: 9.5, scale: 1.08, angle: 2.3 },
    { cx: -4.5, cz: -36.0, radius: 12.0, scale: 1.24, angle: 4.5 },
    { cx: 15.0, cz: -49.0, radius: 11.0, scale: 1.12, angle: 1.2 },
  ];

  const crocs: CrocInstance[] = crocSpecs.map((spec, idx) => {
    const built = buildCrocodile(spec.scale);
    const px = spec.cx + Math.cos(spec.angle) * spec.radius;
    const pz = spec.cz + Math.sin(spec.angle) * spec.radius;
    built.root.position.set(px, -0.09, pz);
    return {
      ...built,
      pos: new THREE.Vector3(px, -0.09, pz),
      heading: spec.angle + Math.PI * 0.5,
      patrolCenter: new THREE.Vector2(spec.cx, spec.cz),
      patrolRadius: spec.radius,
      patrolAngle: spec.angle,
      state: 'patrol',
      targetKind: 'none',
      targetRivalIndex: -1,
      targetRivalName: null,
      cooldownTimer: 0,
      rippleTimer: idx * 0.35,
      splashTimer: 0.5 + idx * 0.3,
      swimPhase: idx * 1.9,
      jawOpen: 0,
      lungeTimer: 0,
      lungePitch: 0,
    };
  });

  // ==================== FROGS & FLOATING LILY PADS (8 Marsh Frogs) ====================
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
      getWaterSurfaceY,
      onRipple,
      onSplash,
      onCrocSnap,
      onFrogCroak,
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
          chasingRivalName = rTarget.rivalName;
        }
      }

      for (const c of crocs) {
        if (!usedCrocs.has(c) && c.state === 'hunting') {
          c.state = 'patrol';
          c.targetKind = 'none';
          c.targetRivalIndex = -1;
          c.targetRivalName = null;
        }
      }

      let threatActive = false;
      let distanceToFish = 999;
      let devoured = false;
      const devouredRivalIndices: number[] = [];

      for (const croc of crocs) {
        if (croc.state === 'satiated') {
          croc.cooldownTimer -= dt;
          if (croc.cooldownTimer <= 0) {
            croc.state = 'patrol';
          }
        }

        let speed = 1.15;
        let targetX = croc.pos.x;
        let targetZ = croc.pos.z;
        const isHunting = croc.state === 'hunting';

        if (isHunting && croc.targetKind === 'player' && hookedFishPos) {
          targetX = hookedFishPos.x;
          targetZ = hookedFishPos.z;
          const dist = Math.hypot(targetX - croc.pos.x, targetZ - croc.pos.z);
          threatActive = true;
          distanceToFish = dist;

          // Fair chase balance: fast intercept from very far (>22m), then fair stalking speed
          // if player reels actively (real catch opportunity), vs aggressive surge if player hesitates!
          if (dist > 22.0) {
            speed = 4.15;
          } else if (playerReeling) {
            speed = weather === 'storm' ? 2.45 : 2.12;
          } else {
            speed = weather === 'storm' ? 3.7 : 3.35;
          }

          const desiredJaw = dist < 10.5 ? THREE.MathUtils.clamp((10.5 - dist) / 5.5, 0.16, 0.86) : 0.12;
          croc.jawOpen = THREE.MathUtils.damp(croc.jawOpen, desiredJaw, 8.5, dt);

          if (dist <= 1.55 && hookedFishDistToDock > 3.1) {
            devoured = true;
            croc.lungeTimer = 0.82;
            croc.jawOpen = 0.92;
            croc.state = 'satiated';
            croc.targetKind = 'none';
            croc.cooldownTimer = 11.5;
            onSplash(croc.pos.x, croc.pos.z, 2.35);
            onCrocSnap();
          }
        } else if (isHunting && croc.targetKind === 'rival') {
          const rTarget = rivalFishTargets.find((r) => r.rivalIndex === croc.targetRivalIndex);
          if (rTarget) {
            targetX = rTarget.pos.x;
            targetZ = rTarget.pos.z;
            const dist = Math.hypot(targetX - croc.pos.x, targetZ - croc.pos.z);
            speed = dist > 18.0 ? 4.1 : 2.7;

            const desiredJaw = dist < 10.0 ? THREE.MathUtils.clamp((10.0 - dist) / 5.0, 0.18, 0.85) : 0.14;
            croc.jawOpen = THREE.MathUtils.damp(croc.jawOpen, desiredJaw, 8.0, dt);

            if (dist <= 1.65 && rTarget.distToPlatform > 2.75) {
              devouredRivalIndices.push(rTarget.rivalIndex);
              croc.lungeTimer = 0.82;
              croc.jawOpen = 0.92;
              croc.state = 'satiated';
              croc.targetKind = 'none';
              croc.targetRivalIndex = -1;
              croc.targetRivalName = null;
              croc.cooldownTimer = 11.0;
              onSplash(croc.pos.x, croc.pos.z, 2.3);
              onCrocSnap();
            }
          } else {
            croc.state = 'patrol';
            croc.targetKind = 'none';
          }
        } else {
          croc.patrolAngle += dt * (croc.state === 'satiated' ? 0.22 : 0.14);
          targetX = croc.patrolCenter.x + Math.cos(croc.patrolAngle) * croc.patrolRadius;
          targetZ = croc.patrolCenter.y + Math.sin(croc.patrolAngle) * croc.patrolRadius * 0.72;
          if (croc.state === 'satiated') speed = 1.65;
          croc.jawOpen = THREE.MathUtils.damp(croc.jawOpen, 0.0, 7.5, dt);
        }

        tmpDir.set(targetX - croc.pos.x, 0, targetZ - croc.pos.z);
        const stepDist = tmpDir.length();
        if (stepDist > 0.05) {
          tmpDir.divideScalar(stepDist);
          const moveSpeed = Math.min(speed, stepDist / Math.max(0.01, dt));
          croc.pos.x += tmpDir.x * moveSpeed * dt;
          croc.pos.z += tmpDir.z * moveSpeed * dt;

          const desiredHeading = Math.atan2(tmpDir.x, tmpDir.z);
          let diff = desiredHeading - croc.heading;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          croc.heading += diff * Math.min(1, dt * (croc.state === 'hunting' ? 5.8 : 2.2));
        }

        const surfY = getWaterSurfaceY(croc.pos.x, croc.pos.z);
        let lungeY = 0;
        let targetPitch = croc.state === 'hunting' ? -0.06 : 0;
        if (croc.lungeTimer > 0) {
          croc.lungeTimer = Math.max(0, croc.lungeTimer - dt);
          const lungeProgress = 1 - croc.lungeTimer / 0.82; // 0 -> 1
          lungeY = Math.sin(lungeProgress * Math.PI) * 0.56;
          targetPitch = Math.sin(lungeProgress * Math.PI) * -0.34 + 0.08 * lungeProgress;
          if (lungeProgress > 0.36) {
            croc.jawOpen = THREE.MathUtils.damp(croc.jawOpen, 0.0, 18.0, dt);
          }
        }
        croc.lungePitch = THREE.MathUtils.damp(croc.lungePitch, targetPitch, 10, dt);

        // Rise visibly high in the water during an active hunt & surface lunge so all anglers clearly see the attack
        croc.pos.y = surfY + (croc.state === 'hunting' ? 0.025 : -0.075) + lungeY;
        croc.root.position.copy(croc.pos);
        croc.root.rotation.set(croc.lungePitch, croc.heading, 0);
        croc.lowerJawPivot.rotation.x = croc.jawOpen;

        // Sinuous tail & webbed leg swim motion
        croc.swimPhase += dt * (croc.state === 'hunting' || croc.lungeTimer > 0 ? 11.2 : 3.4);
        croc.tailSegs.forEach((seg, idx) => {
          seg.rotation.y = Math.sin(croc.swimPhase - idx * 0.85) * (0.18 + idx * 0.075);
        });
        croc.legs.forEach((leg, idx) => {
          leg.rotation.x = Math.sin(croc.swimPhase + idx * Math.PI * 0.5) * 0.25;
        });

        croc.rippleTimer -= dt;
        if (croc.rippleTimer <= 0) {
          croc.rippleTimer = croc.state === 'hunting' ? 0.18 : 0.68;
          onRipple(croc.pos.x, croc.pos.z, croc.state === 'hunting' ? 1.05 : 0.44);
        }

        if (croc.state === 'hunting' || croc.lungeTimer > 0.15) {
          croc.splashTimer -= dt;
          if (croc.splashTimer <= 0) {
            croc.splashTimer = 0.42;
            onSplash(croc.pos.x + Math.sin(croc.heading) * 1.0, croc.pos.z + Math.cos(croc.heading) * 1.0, 0.9);
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
