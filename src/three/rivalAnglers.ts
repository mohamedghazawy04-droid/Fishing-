import * as THREE from 'three';
import { groundHeightAt } from './environment';

export interface RivalContestResult {
  contestActive: boolean;
  rivalName: string | null;
  contestBalance: number; // 0..1 (1 = player winning, 0 = rival steals fish)
  justStarted: boolean;
  justWon: boolean;
  justStolen: boolean;
  pullVectorX: number;
  pullVectorZ: number;
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

type RivalSoloPhase = 'charging' | 'casting' | 'waiting' | 'biting' | 'reeling' | 'caught';

interface RivalInstance {
  nameAr: string;
  sideSign: number;
  root: THREE.Group;
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
  fishTailPivot: THREE.Group;
  fishPos: THREE.Vector3;
  fishColorPaletteIndex: number;
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
}

export function createRivalAnglers(): RivalAnglersSystem {
  const group = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  // Shared Geometries & Materials for Shoreline Platforms & Rival Anglers
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c4028, roughness: 0.88 });
  const timberMat = new THREE.MeshStandardMaterial({ color: 0x3b2919, roughness: 0.92 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xdfa987, roughness: 0.58 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x2b3c4d, roughness: 0.9 });
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x2e1f16, roughness: 0.82 });
  const carbonMat = new THREE.MeshStandardMaterial({ color: 0x1e2529, roughness: 0.35, metalness: 0.5 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xc59b47, roughness: 0.28, metalness: 0.85 });
  const bobRedMat = new THREE.MeshStandardMaterial({ color: 0xe64a2e, roughness: 0.35 });
  const bobWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf4efe4, roughness: 0.35 });
  const lineMat = new THREE.LineBasicMaterial({ color: 0xdbeaf2, transparent: true, opacity: 0.76 });

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

  // Shared Rival Fish Multi-Part Geometries
  const fishProfile = [
    new THREE.Vector2(0.0, -0.38),
    new THREE.Vector2(0.03, -0.32),
    new THREE.Vector2(0.068, -0.18),
    new THREE.Vector2(0.115, 0.0),
    new THREE.Vector2(0.11, 0.16),
    new THREE.Vector2(0.072, 0.30),
    new THREE.Vector2(0.028, 0.37),
    new THREE.Vector2(0.0, 0.39),
  ];
  const fishBodyGeo = new THREE.LatheGeometry(fishProfile, 14);
  fishBodyGeo.rotateX(Math.PI / 2);
  fishBodyGeo.scale(0.62, 1.0, 1.0);

  const fishTailShape = new THREE.Shape();
  fishTailShape.moveTo(0, 0.015);
  fishTailShape.lineTo(-0.18, 0.15);
  fishTailShape.lineTo(-0.11, 0);
  fishTailShape.lineTo(-0.18, -0.15);
  fishTailShape.lineTo(0, -0.015);
  fishTailShape.closePath();
  const fishTailGeo = new THREE.ExtrudeGeometry(fishTailShape, { depth: 0.008, bevelEnabled: false });
  fishTailGeo.rotateY(Math.PI / 2);

  const fishDorsalShape = new THREE.Shape();
  fishDorsalShape.moveTo(0, 0);
  fishDorsalShape.lineTo(-0.04, 0.11);
  fishDorsalShape.lineTo(-0.19, 0.08);
  fishDorsalShape.lineTo(-0.22, 0);
  fishDorsalShape.closePath();
  const fishDorsalGeo = new THREE.ExtrudeGeometry(fishDorsalShape, { depth: 0.007, bevelEnabled: false });
  fishDorsalGeo.rotateY(Math.PI / 2);
  fishDorsalGeo.translate(-0.003, 0.095, 0.06);

  const fishPecGeo = new THREE.PlaneGeometry(0.12, 0.07);
  const fishEyeGeo = new THREE.SphereGeometry(0.02, 8, 8);
  const fishEyeMat = new THREE.MeshStandardMaterial({ color: 0xe6c76c, roughness: 0.2 });

  const fishPalettes = [
    { body: 0x4b7f78, fin: 0x8ea69a }, // Rainbow Trout hue
    { body: 0xd48b2a, fin: 0xe6a83c }, // Golden Carp hue
    { body: 0x3b6342, fin: 0x64855c }, // Alpine Bass hue
  ];
  const fishBodyMats = fishPalettes.map((p) => {
    const m = new THREE.MeshStandardMaterial({ color: p.body, roughness: 0.28, metalness: 0.25 });
    disposables.push(m);
    return m;
  });
  const fishFinMats = fishPalettes.map((p) => {
    const m = new THREE.MeshStandardMaterial({
      color: p.fin,
      roughness: 0.45,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
    });
    disposables.push(m);
    return m;
  });

  disposables.push(
    woodMat,
    timberMat,
    skinMat,
    pantsMat,
    bootMat,
    carbonMat,
    brassMat,
    bobRedMat,
    bobWhiteMat,
    lineMat,
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
    fishBodyGeo,
    fishTailGeo,
    fishDorsalGeo,
    fishPecGeo,
    fishEyeGeo,
    fishEyeMat,
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
      initialTimer: 3.5,
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

    // Left Arm reaching toward spinning reel crank
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

    // Multi-Part 3D Rival Fish (appears when rival hooks, reels in, or lifts a catch!)
    const palIdx = idx % fishPalettes.length;
    const fishRoot = new THREE.Group();
    fishRoot.visible = false;
    const fBody = new THREE.Mesh(fishBodyGeo, fishBodyMats[palIdx]);
    fBody.castShadow = true;
    const fDorsal = new THREE.Mesh(fishDorsalGeo, fishFinMats[palIdx]);
    const fTailPivot = new THREE.Group();
    fTailPivot.position.set(0, 0, -0.36);
    fTailPivot.add(new THREE.Mesh(fishTailGeo, fishFinMats[palIdx]));
    fishRoot.add(fBody, fDorsal, fTailPivot);
    for (const side of [-1, 1]) {
      const pec = new THREE.Mesh(fishPecGeo, fishFinMats[palIdx]);
      pec.position.set(side * 0.065, -0.025, 0.12);
      pec.rotation.set(0.3, side * -0.55, side * -0.3);
      const eye = new THREE.Mesh(fishEyeGeo, fishEyeMat);
      eye.position.set(side * 0.04, 0.03, 0.27);
      fishRoot.add(pec, eye);
    }
    fishRoot.scale.setScalar(1.05);
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

    return {
      nameAr: spec.nameAr,
      sideSign: spec.sideSign,
      root,
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
      fishTailPivot: fTailPivot,
      fishPos: new THREE.Vector3(spec.targetX, -0.35, spec.targetZ),
      fishColorPaletteIndex: palIdx,
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
    };
  });

  let activeContestRivalIdx = -1;
  let contestWaitTimer = 0;
  let contestBalance = 0.56;
  let resolvedThisCatch = false;

  const tmpTip = new THREE.Vector3();
  const tmpPt = new THREE.Vector3();
  const tmpPull = new THREE.Vector3();
  const tmpToPlat = new THREE.Vector3();

  function pickCastSpot(rival: RivalInstance): void {
    const xOffset = 6.5 + Math.random() * 9.5;
    const tx = rival.sideSign * xOffset;
    const tz = -15.5 - Math.random() * 14.5;
    rival.castTargetXZ.set(tx, tz);
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
          rival.soloPhase = 'caught';
          rival.phaseTimer = 3.6;
          rival.fishPos.copy(hookedFishPos);
          onSplash(hookedFishPos.x, hookedFishPos.z, 1.35);
          activeContestRivalIdx = -1;
        }
      }

      // Update Each Rival's Animation, Rod Whip, Reel Crank, Bobber, Line & Caught 3D Fish
      rivals.forEach((rival, idx) => {
        const isContesting = idx === activeContestRivalIdx && hookedFishPos !== null;

        if (rival.triumphTimer > 0) {
          rival.triumphTimer -= dt;
        }

        let targetYaw = Math.atan2(
          rival.castTargetXZ.x - rival.platformPos.x,
          rival.castTargetXZ.y - rival.platformPos.z,
        );
        let rightArmPitch = 0.15;
        let rodPitch = -0.35 + Math.sin(elapsed * 1.1 + idx) * 0.03;
        let torsoLean = Math.sin(elapsed * 1.2 + idx) * 0.03;
        let leftArmYaw = 0.35;
        let leftArmPitch = 0.45;
        let bendAmt = 0.035;
        let showFish = false;
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
          // Full Autonomous Rival Fishing Cycle
          switch (rival.soloPhase) {
            case 'charging': {
              rival.phaseTimer -= dt;
              rightArmPitch = -1.25; // Pull rod back over shoulder
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
              // Whip arm & rod forward smoothly
              rightArmPitch = THREE.MathUtils.lerp(-1.25, 0.25, Math.min(1, t * 2.2));
              rodPitch = THREE.MathUtils.lerp(-0.75, -0.26, Math.min(1, t * 2.2));
              torsoLean = THREE.MathUtils.lerp(0.16, -0.14, Math.min(1, t * 2.2));
              bendAmt = 0.08 * Math.sin(t * Math.PI);

              tmpPt.set(rival.castTargetXZ.x, 0, rival.castTargetXZ.y);
              rival.bobberPos.lerpVectors(rival.castStartPos, tmpPt, t);
              rival.bobberPos.y += Math.sin(t * Math.PI) * 2.55;

              if (t >= 1) {
                rival.soloPhase = 'waiting';
                rival.phaseTimer = 4.5 + Math.random() * 4.5;
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
                rival.soloPhase = 'biting';
                rival.phaseTimer = 1.45;
                rival.fishPos.set(bx, -0.35, bz);
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
              rival.fishPos.set(bx, -0.26, bz);
              showFish = true;

              // Quick hook-set jerk toward end of bite
              if (rival.phaseTimer < 0.35) {
                rightArmPitch = -0.22;
                rodPitch = -0.58;
                torsoLean = -0.15;
                bendAmt = 0.18;
              }
              if (rival.phaseTimer <= 0) {
                rival.soloPhase = 'reeling';
                rival.phaseTimer = 6.8;
                rival.splashTimer = 0.2;
                onSplash(bx, bz, 1.05);
              }
              break;
            }
            case 'reeling': {
              rival.phaseTimer -= dt;
              crankActive = true;
              showFish = true;
              rightArmPitch = -0.2 + Math.sin(elapsed * 3.8) * 0.05;
              rodPitch = -0.56 + Math.sin(elapsed * 4.6 + idx) * 0.06;
              torsoLean = -0.22 + Math.sin(elapsed * 3.2) * 0.04;
              leftArmYaw = 0.62;
              leftArmPitch = 0.68;
              bendAmt = 0.24 + Math.sin(elapsed * 5.0) * 0.03;

              // Pull real 3D fish steadily toward rival's shoreline platform with thrashing zig-zag
              tmpToPlat.set(
                rival.platformPos.x - rival.fishPos.x,
                0,
                rival.platformPos.z - rival.fishPos.z,
              );
              const distToPlat = tmpToPlat.length();
              if (distToPlat > 0.05) {
                tmpToPlat.divideScalar(distToPlat);
                rival.fishPos.x += tmpToPlat.x * 1.85 * dt + Math.sin(elapsed * 6.5 + idx) * 0.55 * dt;
                rival.fishPos.z += tmpToPlat.z * 1.85 * dt + Math.cos(elapsed * 5.5 + idx) * 0.45 * dt;
              }
              const surfY = getWaterSurfaceY(rival.fishPos.x, rival.fishPos.z);
              rival.fishPos.y = surfY - 0.16 + Math.max(0, Math.sin(elapsed * 4.8)) * 0.12;
              rival.bobberPos.set(rival.fishPos.x, surfY - 0.02, rival.fishPos.z);

              rival.splashTimer -= dt;
              if (rival.splashTimer <= 0) {
                rival.splashTimer = 0.65;
                onRipple(rival.fishPos.x, rival.fishPos.z, 0.72);
                if (distToPlat < 6.5) {
                  onSplash(rival.fishPos.x, rival.fishPos.z, 0.85);
                }
              }

              rival.fishRoot.rotation.set(0.08, Math.atan2(tmpToPlat.x, tmpToPlat.z) + Math.sin(elapsed * 8) * 0.25, 0);

              if (distToPlat <= 2.35 || rival.phaseTimer <= 0) {
                rival.soloPhase = 'caught';
                rival.phaseTimer = 3.6;
                onSplash(rival.fishPos.x, rival.fishPos.z, 1.1);
              }
              break;
            }
            case 'caught': {
              rival.phaseTimer -= dt;
              showFish = true;
              rightArmPitch = -0.52;
              rodPitch = -0.68;
              torsoLean = -0.12;
              bendAmt = 0.14;

              // Hold caught 3D fish lifted clearly above water in front of rival's platform!
              const fwdX = Math.sin(targetYaw);
              const fwdZ = Math.cos(targetYaw);
              const liftX = rival.platformPos.x + fwdX * 1.45;
              const liftY = rival.platformPos.y + 1.08 + Math.sin(elapsed * 2.4) * 0.04;
              const liftZ = rival.platformPos.z + fwdZ * 1.45;

              rival.fishPos.x = THREE.MathUtils.damp(rival.fishPos.x, liftX, 5.0, dt);
              rival.fishPos.y = THREE.MathUtils.damp(rival.fishPos.y, liftY, 5.0, dt);
              rival.fishPos.z = THREE.MathUtils.damp(rival.fishPos.z, liftZ, 5.0, dt);
              rival.bobberPos.set(rival.fishPos.x, rival.fishPos.y + 0.16, rival.fishPos.z);

              rival.fishRoot.rotation.set(0.15, elapsed * 1.15, Math.sin(elapsed * 6.0) * 0.12);

              if (rival.phaseTimer <= 0) {
                // Release fish back into lake with splash & start next cast!
                onSplash(
                  rival.platformPos.x + fwdX * 2.4,
                  rival.platformPos.z + fwdZ * 2.4,
                  0.8,
                );
                rival.soloPhase = 'charging';
                rival.phaseTimer = 1.15;
              }
              break;
            }
          }

          rival.fishRoot.visible = showFish;
          if (showFish) {
            rival.swimPhase += dt * (rival.soloPhase === 'caught' ? 9.0 : 15.0);
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
        rival.rightArmPivot.rotation.x = THREE.MathUtils.damp(rival.rightArmPivot.rotation.x, rightArmPitch, 8, dt);
        rival.leftArmPivot.rotation.y = THREE.MathUtils.damp(rival.leftArmPivot.rotation.y, leftArmYaw, 7, dt);
        rival.leftArmPivot.rotation.x = THREE.MathUtils.damp(rival.leftArmPivot.rotation.x, leftArmPitch, 7, dt);
        rival.rodPivot.rotation.x = THREE.MathUtils.damp(rival.rodPivot.rotation.x, rodPitch, 8, dt);

        rival.rodSegments.forEach((seg, sIdx) => {
          const w = (sIdx + 1) / rival.rodSegments.length;
          seg.rotation.x = bendAmt * w;
        });

        rival.bobber.position.copy(rival.bobberPos);

        rival.root.updateMatrixWorld(true);
        rival.rodTipMarker.getWorldPosition(tmpTip);

        const sag = isContesting || rival.soloPhase === 'reeling' || rival.soloPhase === 'caught' ? 0.03 : 0.25;
        for (let i = 0; i < LINE_PTS; i++) {
          const t = i / (LINE_PTS - 1);
          tmpPt.lerpVectors(tmpTip, rival.bobberPos, t);
          tmpPt.y -= Math.sin(t * Math.PI) * sag;
          rival.linePositions[i * 3] = tmpPt.x;
          rival.linePositions[i * 3 + 1] = tmpPt.y;
          rival.linePositions[i * 3 + 2] = tmpPt.z;
        }
        rival.lineGeo.attributes.position.needsUpdate = true;
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
      };
    },
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
