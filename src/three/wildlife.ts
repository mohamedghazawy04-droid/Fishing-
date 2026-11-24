import * as THREE from 'three';
import { groundHeightAt } from './environment';
import type { WeatherType } from '../types/fishing';

type AnimalBehavior = 'grazing' | 'alert' | 'walking_to_drink' | 'drinking' | 'walking_to_graze';

interface ArticulatedAnimal {
  root: THREE.Group;
  neckPivot: THREE.Group;
  headPivot: THREE.Group;
  tailPivot: THREE.Group;
  legs: THREE.Group[]; // [FL, FR, BL, BR]
  grazePos: THREE.Vector2;
  drinkPos: THREE.Vector2;
  currentPos: THREE.Vector2;
  heading: number;
  behavior: AnimalBehavior;
  stateTimer: number;
  walkPhase: number;
  sipRippleCooldown: number;
  baseScale: number;
  walkSpeed: number;
  drinkNeckAngle: number;
  grazeNeckAngle: number;
  kind: 'stag' | 'doe' | 'fawn' | 'fox';
}

export interface WildlifeSystem {
  group: THREE.Group;
  update: (
    dt: number,
    elapsed: number,
    weather: WeatherType,
    nightFactor: number,
    onDrinkRipple?: (x: number, z: number, strength: number) => void,
    getWaterSurfaceY?: (x: number, z: number) => number,
    onWaterSplash?: (x: number, z: number, intensity: number) => void,
  ) => void;
  dispose: () => void;
}

/**
 * Finds the nearest shoreline position (where terrain height is just above water y = 0.14..0.28)
 * stepping from a forest clearing position toward the expanded lake center (0, -44).
 */
function findShoreDrinkSpot(startX: number, startZ: number): THREE.Vector2 {
  const targetX = 0;
  const targetZ = -44;
  const dx = targetX - startX;
  const dz = targetZ - startZ;
  const dist = Math.hypot(dx, dz) || 1;
  const ux = dx / dist;
  const uz = dz / dist;

  let bestX = startX;
  let bestZ = startZ;
  let bestDiff = Infinity;

  for (let step = 0; step <= dist; step += 0.6) {
    const px = startX + ux * step;
    const pz = startZ + uz * step;
    const h = groundHeightAt(px, pz);
    const diff = Math.abs(h - 0.18);
    if (h >= 0.06 && h <= 0.45 && diff < bestDiff) {
      bestDiff = diff;
      bestX = px;
      bestZ = pz;
    }
    if (h < -0.15) break;
  }

  return new THREE.Vector2(bestX, bestZ);
}

/**
 * Finds a shallow wading shelf position (terrain height around -0.22..-0.06) for flamingos.
 */
function findShallowWaterSpot(startX: number, startZ: number, desiredDepth = -0.16): THREE.Vector2 {
  const targetX = 0;
  const targetZ = -44;
  const dx = targetX - startX;
  const dz = targetZ - startZ;
  const dist = Math.hypot(dx, dz) || 1;
  const ux = dx / dist;
  const uz = dz / dist;

  let bestX = startX;
  let bestZ = startZ;
  let bestDiff = Infinity;

  for (let step = 0; step <= dist; step += 0.5) {
    const px = startX + ux * step;
    const pz = startZ + uz * step;
    const h = groundHeightAt(px, pz);
    const diff = Math.abs(h - desiredDepth);
    if (h >= -0.34 && h <= -0.04 && diff < bestDiff) {
      bestDiff = diff;
      bestX = px;
      bestZ = pz;
    }
    if (h < -0.55) break;
  }

  return new THREE.Vector2(bestX, bestZ);
}

/**
 * Steps from a shoreline spot back toward the pine grove until terrain reaches gentle meadow/forest height.
 */
function findForestGrazeSpot(shoreX: number, shoreZ: number, pullDist: number, lateralOffset = 0): THREE.Vector2 {
  const dx = shoreX - 0;
  const dz = shoreZ - -44;
  const len = Math.hypot(dx, dz) || 1;
  const outX = dx / len;
  const outZ = dz / len;
  const sideX = -outZ;
  const sideZ = outX;

  const gx = shoreX + outX * pullDist + sideX * lateralOffset;
  const gz = shoreZ + outZ * pullDist + sideZ * lateralOffset;
  return new THREE.Vector2(gx, gz);
}

export function createWildlifeSystem(): WildlifeSystem {
  const group = new THREE.Group();
  const sharedGeos: THREE.BufferGeometry[] = [];
  const sharedMats: THREE.Material[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    sharedGeos.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    sharedMats.push(m);
    return m;
  };

  // PBR Materials for forest deer & red fox
  const deerCoatMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x9b6d46,
      roughness: 0.86,
      metalness: 0.02,
    }),
  );
  const deerStagCoatMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x7e5434,
      roughness: 0.84,
      metalness: 0.02,
    }),
  );
  const deerBellyMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xe6dbc9,
      roughness: 0.9,
    }),
  );
  const darkHoofEyeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1a1512,
      roughness: 0.45,
    }),
  );
  const antlerMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd9cdb8,
      roughness: 0.62,
      metalness: 0.04,
    }),
  );
  const foxCoatMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xc25b28,
      roughness: 0.82,
    }),
  );
  const foxDarkMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x221c18,
      roughness: 0.78,
    }),
  );

  // Shared deer geometries (sculpted, multi-part, bottom-center grounded)
  const torsoGeo = trackGeo(new THREE.CapsuleGeometry(0.24, 0.76, 6, 12));
  torsoGeo.rotateX(Math.PI / 2);
  const chestGeo = trackGeo(new THREE.SphereGeometry(0.25, 10, 8));
  const bellyPatchGeo = trackGeo(new THREE.CapsuleGeometry(0.16, 0.56, 4, 8));
  bellyPatchGeo.rotateX(Math.PI / 2);
  const neckGeo = trackGeo(new THREE.CylinderGeometry(0.105, 0.15, 0.52, 8));
  neckGeo.translate(0, 0.24, 0);
  const headGeo = trackGeo(new THREE.ConeGeometry(0.12, 0.36, 8));
  headGeo.rotateX(Math.PI / 2);
  const craniumGeo = trackGeo(new THREE.SphereGeometry(0.115, 8, 8));
  const earGeo = trackGeo(new THREE.ConeGeometry(0.045, 0.16, 5));
  const legUpperGeo = trackGeo(new THREE.CylinderGeometry(0.055, 0.036, 0.46, 6));
  legUpperGeo.translate(0, -0.23, 0);
  const legLowerGeo = trackGeo(new THREE.CylinderGeometry(0.034, 0.028, 0.42, 6));
  legLowerGeo.translate(0, -0.64, 0);
  const hoofGeo = trackGeo(new THREE.CylinderGeometry(0.032, 0.036, 0.06, 6));
  hoofGeo.translate(0, -0.86, 0.01);
  const tailGeo = trackGeo(new THREE.ConeGeometry(0.065, 0.2, 6));
  const antlerBeamGeo = trackGeo(new THREE.CylinderGeometry(0.014, 0.022, 0.42, 5));
  const antlerTineGeo = trackGeo(new THREE.CylinderGeometry(0.008, 0.015, 0.19, 5));

  // Shared fox geometries
  const foxTorsoGeo = trackGeo(new THREE.CapsuleGeometry(0.13, 0.44, 5, 10));
  foxTorsoGeo.rotateX(Math.PI / 2);
  const foxNeckGeo = trackGeo(new THREE.CylinderGeometry(0.08, 0.105, 0.22, 7));
  foxNeckGeo.translate(0, 0.1, 0);
  const foxHeadGeo = trackGeo(new THREE.ConeGeometry(0.095, 0.26, 7));
  foxHeadGeo.rotateX(Math.PI / 2);
  const foxEarGeo = trackGeo(new THREE.ConeGeometry(0.042, 0.12, 4));
  const foxLegGeo = trackGeo(new THREE.CylinderGeometry(0.035, 0.024, 0.34, 6));
  foxLegGeo.translate(0, -0.17, 0);
  const foxTailGeo = trackGeo(new THREE.ConeGeometry(0.095, 0.48, 7));

  function buildDeer(kind: 'stag' | 'doe' | 'fawn', scale: number): Omit<
    ArticulatedAnimal,
    'grazePos' | 'drinkPos' | 'currentPos' | 'heading' | 'behavior' | 'stateTimer' | 'walkPhase' | 'sipRippleCooldown'
  > {
    const root = new THREE.Group();
    const coat = kind === 'stag' ? deerStagCoatMat : deerCoatMat;
    const shoulderY = 0.88;

    const bodyGroup = new THREE.Group();
    bodyGroup.position.y = shoulderY;
    root.add(bodyGroup);

    const torso = new THREE.Mesh(torsoGeo, coat);
    torso.scale.set(0.95, 1.08, 1.05);
    torso.castShadow = true;
    torso.receiveShadow = true;
    bodyGroup.add(torso);

    const chest = new THREE.Mesh(chestGeo, coat);
    chest.position.set(0, -0.02, 0.28);
    chest.scale.set(0.95, 1.05, 1.05);
    chest.castShadow = true;
    bodyGroup.add(chest);

    const belly = new THREE.Mesh(bellyPatchGeo, deerBellyMat);
    belly.position.set(0, -0.12, 0);
    bodyGroup.add(belly);

    // Tail pivot
    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0.08, -0.48);
    const tailMesh = new THREE.Mesh(tailGeo, deerBellyMat);
    tailMesh.rotation.x = -Math.PI * 0.78;
    tailMesh.position.set(0, -0.04, -0.05);
    tailPivot.add(tailMesh);
    bodyGroup.add(tailPivot);

    // Neck + Head pivots
    const neckPivot = new THREE.Group();
    neckPivot.position.set(0, 0.1, 0.36);
    neckPivot.rotation.x = 0.36;
    const neckMesh = new THREE.Mesh(neckGeo, coat);
    neckMesh.castShadow = true;
    neckPivot.add(neckMesh);

    const neckThroat = new THREE.Mesh(neckGeo, deerBellyMat);
    neckThroat.scale.set(0.62, 0.88, 0.62);
    neckThroat.position.set(0, 0.02, 0.05);
    neckPivot.add(neckThroat);

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.5, 0.03);
    headPivot.rotation.x = -0.32;
    neckPivot.add(headPivot);

    const cranium = new THREE.Mesh(craniumGeo, coat);
    cranium.castShadow = true;
    headPivot.add(cranium);

    const snout = new THREE.Mesh(headGeo, coat);
    snout.position.set(0, -0.03, 0.16);
    snout.castShadow = true;
    headPivot.add(snout);

    const nose = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.028, 6, 6)), darkHoofEyeMat);
    nose.position.set(0, -0.025, 0.33);
    headPivot.add(nose);

    const earL = new THREE.Mesh(earGeo, coat);
    earL.position.set(0.09, 0.09, -0.04);
    earL.rotation.set(-0.25, 0, -0.55);
    const earR = new THREE.Mesh(earGeo, coat);
    earR.position.set(-0.09, 0.09, -0.04);
    earR.rotation.set(-0.25, 0, 0.55);
    headPivot.add(earL, earR);

    if (kind === 'stag') {
      for (const side of [-1, 1]) {
        const antlerRoot = new THREE.Group();
        antlerRoot.position.set(side * 0.055, 0.1, -0.02);
        antlerRoot.rotation.set(-0.25, 0, side * -0.36);

        const beam = new THREE.Mesh(antlerBeamGeo, antlerMat);
        beam.position.y = 0.21;
        beam.castShadow = true;
        antlerRoot.add(beam);

        const tine1 = new THREE.Mesh(antlerTineGeo, antlerMat);
        tine1.position.set(0, 0.15, 0.07);
        tine1.rotation.x = 0.72;
        antlerRoot.add(tine1);

        const tine2 = new THREE.Mesh(antlerTineGeo, antlerMat);
        tine2.position.set(side * 0.05, 0.31, 0.04);
        tine2.rotation.set(0.45, 0, side * -0.45);
        antlerRoot.add(tine2);

        const tine3 = new THREE.Mesh(antlerTineGeo, antlerMat);
        tine3.position.set(side * -0.02, 0.39, -0.03);
        tine3.rotation.set(-0.32, 0, side * 0.22);
        antlerRoot.add(tine3);

        headPivot.add(antlerRoot);
      }
    }

    bodyGroup.add(neckPivot);

    // 4 articulated legs
    const legOffsets: [number, number, number][] = [
      [0.125, -0.03, 0.31],
      [-0.125, -0.03, 0.31],
      [0.13, -0.02, -0.32],
      [-0.13, -0.02, -0.32],
    ];
    const legs: THREE.Group[] = [];
    for (const [lx, ly, lz] of legOffsets) {
      const legGroup = new THREE.Group();
      legGroup.position.set(lx, ly, lz);
      const upper = new THREE.Mesh(legUpperGeo, coat);
      upper.castShadow = true;
      const lower = new THREE.Mesh(legLowerGeo, coat);
      lower.castShadow = true;
      const hoof = new THREE.Mesh(hoofGeo, darkHoofEyeMat);
      legGroup.add(upper, lower, hoof);
      bodyGroup.add(legGroup);
      legs.push(legGroup);
    }

    root.scale.setScalar(scale);
    group.add(root);

    return {
      root,
      neckPivot,
      headPivot,
      tailPivot,
      legs,
      baseScale: scale,
      walkSpeed: kind === 'fawn' ? 1.4 : 1.18,
      drinkNeckAngle: 1.65,
      grazeNeckAngle: 1.48,
      kind,
    };
  }

  function buildFox(scale: number): Omit<
    ArticulatedAnimal,
    'grazePos' | 'drinkPos' | 'currentPos' | 'heading' | 'behavior' | 'stateTimer' | 'walkPhase' | 'sipRippleCooldown'
  > {
    const root = new THREE.Group();
    const bodyGroup = new THREE.Group();
    bodyGroup.position.y = 0.38;
    root.add(bodyGroup);

    const torso = new THREE.Mesh(foxTorsoGeo, foxCoatMat);
    torso.castShadow = true;
    bodyGroup.add(torso);

    const neckPivot = new THREE.Group();
    neckPivot.position.set(0, 0.06, 0.22);
    neckPivot.rotation.x = 0.42;
    const neckMesh = new THREE.Mesh(foxNeckGeo, foxCoatMat);
    neckPivot.add(neckMesh);

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.2, 0.02);
    headPivot.rotation.x = -0.38;
    const snout = new THREE.Mesh(foxHeadGeo, foxCoatMat);
    snout.position.set(0, -0.01, 0.09);
    snout.castShadow = true;
    const earL = new THREE.Mesh(foxEarGeo, foxDarkMat);
    earL.position.set(0.055, 0.075, -0.02);
    const earR = new THREE.Mesh(foxEarGeo, foxDarkMat);
    earR.position.set(-0.055, 0.075, -0.02);
    headPivot.add(snout, earL, earR);
    neckPivot.add(headPivot);
    bodyGroup.add(neckPivot);

    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0.02, -0.27);
    const tailMesh = new THREE.Mesh(foxTailGeo, foxCoatMat);
    tailMesh.rotation.x = Math.PI * 0.56;
    tailMesh.position.set(0, -0.02, -0.22);
    const tailTip = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.055, 6, 6)), deerBellyMat);
    tailTip.position.set(0, -0.06, -0.44);
    tailPivot.add(tailMesh, tailTip);
    bodyGroup.add(tailPivot);

    const legOffsets: [number, number, number][] = [
      [0.075, -0.04, 0.18],
      [-0.075, -0.04, 0.18],
      [0.075, -0.04, -0.18],
      [-0.075, -0.04, -0.18],
    ];
    const legs: THREE.Group[] = [];
    for (const [lx, ly, lz] of legOffsets) {
      const legGroup = new THREE.Group();
      legGroup.position.set(lx, ly, lz);
      const leg = new THREE.Mesh(foxLegGeo, foxDarkMat);
      leg.castShadow = true;
      legGroup.add(leg);
      bodyGroup.add(legGroup);
      legs.push(legGroup);
    }

    root.scale.setScalar(scale);
    group.add(root);

    return {
      root,
      neckPivot,
      headPivot,
      tailPivot,
      legs,
      baseScale: scale,
      walkSpeed: 1.45,
      drinkNeckAngle: 1.5,
      grazeNeckAngle: 1.28,
      kind: 'fox',
    };
  }

  // Spawn animals in 4 wide scenic lakeside forest groves clearly separated across the expanded lake
  const animals: ArticulatedAnimal[] = [];

  const spawnConfigs: {
    kind: 'stag' | 'doe' | 'fawn' | 'fox';
    scale: number;
    seedX: number;
    seedZ: number;
    pullDist: number;
    lateral: number;
    initialBehavior: AnimalBehavior;
    initialTimer: number;
  }[] = [
    // Far West scenic bank among pine trees & shore
    { kind: 'stag', scale: 1.42, seedX: -84, seedZ: -44, pullDist: 8.0, lateral: 2.5, initialBehavior: 'grazing', initialTimer: 9 },
    { kind: 'doe', scale: 1.26, seedX: -80, seedZ: -36, pullDist: 5.0, lateral: -3.2, initialBehavior: 'drinking', initialTimer: 7 },
    { kind: 'doe', scale: 1.22, seedX: -86, seedZ: -54, pullDist: 9.8, lateral: 2.0, initialBehavior: 'grazing', initialTimer: 5 },
    // Far East scenic bank among pine trees & shore
    { kind: 'doe', scale: 1.28, seedX: 82, seedZ: -46, pullDist: 5.8, lateral: 2.2, initialBehavior: 'drinking', initialTimer: 8 },
    { kind: 'fawn', scale: 0.90, seedX: 80, seedZ: -41, pullDist: 6.8, lateral: 3.6, initialBehavior: 'grazing', initialTimer: 6 },
    { kind: 'fox', scale: 1.18, seedX: 74, seedZ: -26, pullDist: 6.5, lateral: -2.0, initialBehavior: 'grazing', initialTimer: 4 },
    // Distant North-West & North-East meadow shores across the expanded lake
    { kind: 'stag', scale: 1.45, seedX: -32, seedZ: -102, pullDist: 7.4, lateral: -2.8, initialBehavior: 'drinking', initialTimer: 10 },
    { kind: 'doe', scale: 1.26, seedX: 28, seedZ: -100, pullDist: 8.8, lateral: 2.6, initialBehavior: 'grazing', initialTimer: 7 },
    { kind: 'fox', scale: 1.16, seedX: -56, seedZ: -18, pullDist: 6.5, lateral: 2.5, initialBehavior: 'grazing', initialTimer: 5 },
  ];

  for (const cfg of spawnConfigs) {
    const drinkPos = findShoreDrinkSpot(cfg.seedX, cfg.seedZ);
    const grazePos = findForestGrazeSpot(drinkPos.x, drinkPos.y, cfg.pullDist, cfg.lateral);
    const startPos = cfg.initialBehavior === 'drinking' ? drinkPos.clone() : grazePos.clone();

    const parts = cfg.kind === 'fox' ? buildFox(cfg.scale) : buildDeer(cfg.kind, cfg.scale);
    const faceWaterYaw = Math.atan2(0 - startPos.x, -44 - startPos.y);
    const y = groundHeightAt(startPos.x, startPos.y);
    parts.root.position.set(startPos.x, y, startPos.y);
    parts.root.rotation.y = faceWaterYaw + (cfg.initialBehavior === 'grazing' ? 0.55 : 0);

    animals.push({
      ...parts,
      grazePos,
      drinkPos,
      currentPos: startPos,
      heading: parts.root.rotation.y,
      behavior: cfg.initialBehavior,
      stateTimer: cfg.initialTimer,
      walkPhase: Math.random() * Math.PI * 2,
      sipRippleCooldown: 1.5,
    });
  }

  // --- Aquatic Surface Turtles (Swimming on Lake Surface & Basking near Shore) ---
  interface SurfaceTurtle {
    root: THREE.Group;
    headPivot: THREE.Group;
    flippers: THREE.Mesh[];
    center: THREE.Vector2;
    orbitRadiusX: number;
    orbitRadiusZ: number;
    phase: number;
    speed: number;
    rippleTimer: number;
    isBasker: boolean;
  }

  const turtleShellMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x3b4d2b,
      roughness: 0.34,
      metalness: 0.08,
    }),
  );
  const turtleRimMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x6b5a34,
      roughness: 0.42,
      metalness: 0.05,
    }),
  );
  const turtleSkinMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x4b6338,
      roughness: 0.48,
    }),
  );
  const turtleEyeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xf4d262,
      roughness: 0.25,
    }),
  );

  const shellDomeGeo = trackGeo(new THREE.SphereGeometry(0.28, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55));
  shellDomeGeo.scale(0.86, 0.55, 1.12);
  const shellRimGeo = trackGeo(new THREE.CylinderGeometry(0.27, 0.24, 0.06, 12));
  shellRimGeo.scale(0.88, 1.0, 1.14);
  const tHeadGeo = trackGeo(new THREE.SphereGeometry(0.068, 8, 8));
  tHeadGeo.scale(0.85, 0.78, 1.25);
  const tNeckGeo = trackGeo(new THREE.CylinderGeometry(0.036, 0.045, 0.14, 7));
  tNeckGeo.rotateX(Math.PI / 2);
  const flipperGeo = trackGeo(new THREE.BoxGeometry(0.16, 0.025, 0.075));
  flipperGeo.translate(0.07, 0, 0);

  const turtles: SurfaceTurtle[] = [];
  const turtleSpecs = [
    { cx: -22.0, cz: -17.0, rx: 5.5, rz: 4.0, scale: 1.15, speed: 0.16, isBasker: false },
    { cx: 24.5, cz: -20.5, rx: 6.0, rz: 4.4, scale: 1.05, speed: 0.14, isBasker: false },
    { cx: -35.0, cz: -44.0, rx: 7.2, rz: 5.0, scale: 1.22, speed: 0.13, isBasker: false },
    { cx: 36.0, cz: -47.0, rx: 6.5, rz: 4.8, scale: 1.12, speed: 0.14, isBasker: false },
    { cx: 8.5, cz: -70.0, rx: 7.0, rz: 4.8, scale: 1.18, speed: 0.12, isBasker: false },
    { cx: 32.0, cz: -12.5, rx: 3.4, rz: 2.5, scale: 0.96, speed: 0.11, isBasker: true },
  ];

  for (let i = 0; i < turtleSpecs.length; i++) {
    const sp = turtleSpecs[i];
    const root = new THREE.Group();
    const shell = new THREE.Mesh(shellDomeGeo, turtleShellMat);
    shell.position.y = 0.01;
    shell.castShadow = true;
    const rim = new THREE.Mesh(shellRimGeo, turtleRimMat);
    rim.position.y = 0.0;
    root.add(shell, rim);

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.04, 0.27);
    const neck = new THREE.Mesh(tNeckGeo, turtleSkinMat);
    neck.position.z = 0.05;
    const head = new THREE.Mesh(tHeadGeo, turtleSkinMat);
    head.position.set(0, 0.02, 0.13);
    const eyeL = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.012, 5, 5)), turtleEyeMat);
    eyeL.position.set(0.042, 0.04, 0.16);
    const eyeR = eyeL.clone();
    eyeR.position.x = -0.042;
    headPivot.add(neck, head, eyeL, eyeR);
    root.add(headPivot);

    const fl = new THREE.Mesh(flipperGeo, turtleSkinMat);
    fl.position.set(0.18, -0.01, 0.14);
    const fr = new THREE.Mesh(flipperGeo, turtleSkinMat);
    fr.position.set(-0.18, -0.01, 0.14);
    fr.scale.x = -1;
    const bl = new THREE.Mesh(flipperGeo, turtleSkinMat);
    bl.position.set(0.16, -0.01, -0.17);
    bl.scale.set(0.8, 1, 0.85);
    const br = new THREE.Mesh(flipperGeo, turtleSkinMat);
    br.position.set(-0.16, -0.01, -0.17);
    br.scale.set(-0.8, 1, 0.85);
    root.add(fl, fr, bl, br);

    root.scale.setScalar(sp.scale);
    group.add(root);

    turtles.push({
      root,
      headPivot,
      flippers: [fl, fr, bl, br],
      center: new THREE.Vector2(sp.cx, sp.cz),
      orbitRadiusX: sp.rx,
      orbitRadiusZ: sp.rz,
      phase: i * 1.7,
      speed: sp.speed,
      rippleTimer: 1.0 + i * 0.7,
      isBasker: sp.isBasker,
    });
  }

  // --- Sparkling Jumping Surface Fish + Glistening Water-Sparkle Droplet Trail ---
  interface JumpingFish {
    root: THREE.Group;
    tailPivot: THREE.Group;
    active: boolean;
    cooldown: number;
    t: number;
    duration: number;
    startX: number;
    startZ: number;
    endX: number;
    endZ: number;
    peakHeight: number;
    sparkleTimer: number;
  }

  const jumpFishProfile = [
    new THREE.Vector2(0.0, -0.34),
    new THREE.Vector2(0.025, -0.27),
    new THREE.Vector2(0.068, -0.14),
    new THREE.Vector2(0.095, 0.02),
    new THREE.Vector2(0.088, 0.16),
    new THREE.Vector2(0.052, 0.28),
    new THREE.Vector2(0.0, 0.34),
  ];
  const jumpBodyGeo = trackGeo(new THREE.LatheGeometry(jumpFishProfile, 14));
  jumpBodyGeo.rotateX(Math.PI / 2);
  jumpBodyGeo.scale(0.62, 1.0, 1.0);

  const jumpTailGeo = trackGeo(new THREE.BufferGeometry());
  jumpTailGeo.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([0, 0, 0, 0, 0.13, -0.18, 0, 0.02, -0.11, 0, -0.13, -0.18]),
      3,
    ),
  );
  jumpTailGeo.setIndex([0, 1, 2, 0, 2, 3]);
  jumpTailGeo.computeVertexNormals();

  const jumpDorsalGeo = trackGeo(new THREE.BufferGeometry());
  jumpDorsalGeo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([0, 0.08, 0.07, 0, 0.17, -0.05, 0, 0.07, -0.11]), 3),
  );
  jumpDorsalGeo.computeVertexNormals();

  const jumpSilverMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xdff6ff,
      emissive: 0x244658,
      emissiveIntensity: 0.35,
      metalness: 0.85,
      roughness: 0.12,
    }),
  );
  const jumpGoldMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffe49e,
      emissive: 0x523914,
      emissiveIntensity: 0.32,
      metalness: 0.82,
      roughness: 0.14,
    }),
  );
  const jumpFinMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x9bdaf2,
      roughness: 0.3,
      metalness: 0.35,
      side: THREE.DoubleSide,
    }),
  );

  const jumpers: JumpingFish[] = [];
  for (let j = 0; j < 5; j++) {
    const root = new THREE.Group();
    const mat = j % 2 === 0 ? jumpSilverMat : jumpGoldMat;
    const body = new THREE.Mesh(jumpBodyGeo, mat);
    const dorsal = new THREE.Mesh(jumpDorsalGeo, jumpFinMat);
    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0, -0.32);
    const tail = new THREE.Mesh(jumpTailGeo, jumpFinMat);
    tailPivot.add(tail);
    root.add(body, dorsal, tailPivot);
    root.scale.setScalar(1.05 + (j % 3) * 0.16);
    root.visible = false;
    group.add(root);

    jumpers.push({
      root,
      tailPivot,
      active: false,
      cooldown: 1.2 + j * 1.45,
      t: 0,
      duration: 0.95,
      startX: 0,
      startZ: -15,
      endX: 1.5,
      endZ: -16,
      peakHeight: 1.05,
      sparkleTimer: 0,
    });
  }

  // Shimmering Water-Sparkle Droplet Trail emitted by leaping fish
  const SPARKLE_POOL = 96;
  const sparklePositions = new Float32Array(SPARKLE_POOL * 3);
  const sparkleVelocities = new Float32Array(SPARKLE_POOL * 3);
  const sparkleLives = new Float32Array(SPARKLE_POOL);
  for (let i = 0; i < SPARKLE_POOL; i++) {
    sparklePositions[i * 3 + 1] = -999;
    sparkleLives[i] = 0;
  }
  const sparkleGeo = trackGeo(new THREE.BufferGeometry());
  sparkleGeo.setAttribute('position', new THREE.BufferAttribute(sparklePositions, 3));
  const sparkleMat = trackMat(
    new THREE.PointsMaterial({
      color: 0xf8fcff,
      size: 0.14,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  const sparklePoints = new THREE.Points(sparkleGeo, sparkleMat);
  sparklePoints.frustumCulled = false;
  group.add(sparklePoints);
  let sparkleCursor = 0;

  // --- Graceful Shallow-Water Pink Flamingos (7 Wading Birds in Two Separated Coves) ---
  interface FlamingoInstance {
    root: THREE.Group;
    neckPivot: THREE.Group;
    headPivot: THREE.Group;
    rightLeg: THREE.Group;
    baseX: number;
    baseZ: number;
    phase: number;
    standingOneLeg: boolean;
    dipCooldown: number;
    dipAnim: number;
  }

  const flamPinkMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xf67fa1, roughness: 0.62 }));
  const flamDeepRoseMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xd9486b, roughness: 0.58 }));
  const flamNeckMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xffa6bd, roughness: 0.6 }));
  const flamLegMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xe36b7c, roughness: 0.55 }));
  const flamBeakTipMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x1a1719, roughness: 0.35 }));
  const flamEyeMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xf7df68, roughness: 0.25 }));

  const flamBodyGeo = trackGeo(new THREE.SphereGeometry(0.18, 12, 10));
  flamBodyGeo.scale(0.82, 0.78, 1.38);
  const flamWingGeo = trackGeo(new THREE.SphereGeometry(0.16, 10, 8));
  flamWingGeo.scale(0.32, 0.62, 1.28);
  const flamLegGeo = trackGeo(new THREE.CylinderGeometry(0.013, 0.01, 0.68, 6));
  flamLegGeo.translate(0, -0.34, 0);
  const flamNeckSegGeo = trackGeo(new THREE.CylinderGeometry(0.024, 0.032, 0.52, 7));
  flamNeckSegGeo.translate(0, 0.26, 0);
  const flamHeadGeo = trackGeo(new THREE.SphereGeometry(0.056, 8, 8));
  flamHeadGeo.scale(0.88, 0.85, 1.2);
  const flamBeakBaseGeo = trackGeo(new THREE.ConeGeometry(0.028, 0.085, 6));
  flamBeakBaseGeo.rotateX(Math.PI * 0.62);
  const flamBeakTipGeo = trackGeo(new THREE.ConeGeometry(0.019, 0.068, 6));
  flamBeakTipGeo.rotateX(Math.PI * 0.92);

  const flamingoSeeds: [number, number, boolean][] = [
    // South-West sandy reed cove (clearly visible in left foreground/midground from dock)
    [-34.0, -9.5, true],
    [-37.5, -12.5, false],
    [-41.5, -16.0, true],
    [-45.0, -20.5, false],
    // North-East calm cove across lake
    [48.0, -64.0, true],
    [52.5, -67.5, false],
    [56.5, -71.5, true],
  ];

  const flamingos: FlamingoInstance[] = flamingoSeeds.map(([sx, sz, oneLeg], idx) => {
    const spot = findShallowWaterSpot(sx, sz, -0.18);
    const root = new THREE.Group();
    const legH = 0.68;

    const bodyRoot = new THREE.Group();
    bodyRoot.position.y = legH;
    root.add(bodyRoot);

    const body = new THREE.Mesh(flamBodyGeo, flamPinkMat);
    body.castShadow = true;
    const wingL = new THREE.Mesh(flamWingGeo, flamDeepRoseMat);
    wingL.position.set(0.11, 0.02, -0.02);
    const wingR = new THREE.Mesh(flamWingGeo, flamDeepRoseMat);
    wingR.position.set(-0.11, 0.02, -0.02);
    bodyRoot.add(body, wingL, wingR);

    const leftLeg = new THREE.Group();
    leftLeg.position.set(-0.055, -0.06, 0);
    leftLeg.add(new THREE.Mesh(flamLegGeo, flamLegMat));
    const rightLeg = new THREE.Group();
    rightLeg.position.set(0.055, -0.06, 0);
    rightLeg.add(new THREE.Mesh(flamLegGeo, flamLegMat));
    if (oneLeg) {
      rightLeg.rotation.x = 0.92;
    }
    bodyRoot.add(leftLeg, rightLeg);

    // Graceful curved flamingo neck + head
    const neckPivot = new THREE.Group();
    neckPivot.position.set(0, 0.05, 0.19);
    neckPivot.rotation.x = 0.25;
    const lowerNeck = new THREE.Mesh(flamNeckSegGeo, flamNeckMat);
    lowerNeck.castShadow = true;
    neckPivot.add(lowerNeck);

    const upperNeckPivot = new THREE.Group();
    upperNeckPivot.position.set(0, 0.48, 0);
    upperNeckPivot.rotation.x = -0.35;
    const upperNeck = new THREE.Mesh(flamNeckSegGeo, flamNeckMat);
    upperNeck.scale.set(0.85, 0.72, 0.85);
    upperNeckPivot.add(upperNeck);

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.36, 0.01);
    headPivot.rotation.x = 0.22;
    const head = new THREE.Mesh(flamHeadGeo, flamNeckMat);
    const beakBase = new THREE.Mesh(flamBeakBaseGeo, flamNeckMat);
    beakBase.position.set(0, -0.02, 0.065);
    const beakTip = new THREE.Mesh(flamBeakTipGeo, flamBeakTipMat);
    beakTip.position.set(0, -0.068, 0.095);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.011, 5, 5)), flamEyeMat);
      eye.position.set(s * 0.04, 0.016, 0.026);
      headPivot.add(eye);
    }
    headPivot.add(head, beakBase, beakTip);
    upperNeckPivot.add(headPivot);
    neckPivot.add(upperNeckPivot);
    bodyRoot.add(neckPivot);

    const yawToCenter = Math.atan2(0 - spot.x, -44 - spot.y) + (idx % 2 === 0 ? 0.38 : -0.42);
    const bedY = groundHeightAt(spot.x, spot.y);
    root.position.set(spot.x, bedY, spot.y);
    root.rotation.y = yawToCenter;
    root.scale.setScalar(1.12 + (idx % 3) * 0.06);
    group.add(root);

    return {
      root,
      neckPivot,
      headPivot,
      rightLeg,
      baseX: spot.x,
      baseZ: spot.y,
      phase: idx * 1.4,
      standingOneLeg: oneLeg,
      dipCooldown: 2.0 + idx * 1.3,
      dipAnim: -1,
    };
  });

  // --- Valley Geese (4 Swimming in East Cove + 2 Strolling on South-East Grassy Bank) ---
  interface SwimmingWaterbird {
    root: THREE.Group;
    neckPivot: THREE.Group;
    headPivot: THREE.Group;
    bodyGroup: THREE.Group;
    center: THREE.Vector2;
    rx: number;
    rz: number;
    phase: number;
    speed: number;
    dabbleCooldown: number;
    dabbleAnim: number;
    rippleTimer: number;
    isLandWalker: boolean;
    walkRange: number;
    baseYaw: number;
  }

  const gooseBodyMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.72 }));
  const gooseWingMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xa29688, roughness: 0.76 }));
  const gooseBillMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xe68422, roughness: 0.42 }));

  const gooseTorsoGeo = trackGeo(new THREE.SphereGeometry(0.19, 12, 10));
  gooseTorsoGeo.scale(0.84, 0.72, 1.35);
  const gooseNeckGeo = trackGeo(new THREE.CylinderGeometry(0.036, 0.052, 0.34, 8));
  gooseNeckGeo.translate(0, 0.17, 0);
  const gooseHeadGeo = trackGeo(new THREE.SphereGeometry(0.062, 8, 8));
  gooseHeadGeo.scale(0.88, 0.85, 1.18);
  const gooseBillGeo = trackGeo(new THREE.ConeGeometry(0.028, 0.1, 6));
  gooseBillGeo.rotateX(Math.PI / 2);
  const gooseTailGeo = trackGeo(new THREE.ConeGeometry(0.07, 0.15, 6));
  gooseTailGeo.rotateX(-Math.PI * 0.45);

  const waterbirds: SwimmingWaterbird[] = [];

  const gooseSpecs = [
    // East cove swimming geese (well-spaced phases & radii)
    { cx: 33.0, cz: -25.0, rx: 5.5, rz: 4.0, phase: 0.2, speed: 0.19, land: false, scale: 1.08 },
    { cx: 36.5, cz: -28.0, rx: 6.2, rz: 4.5, phase: 2.5, speed: 0.17, land: false, scale: 1.02 },
    { cx: 43.0, cz: -45.0, rx: 6.8, rz: 5.0, phase: 1.1, speed: 0.16, land: false, scale: 1.06 },
    { cx: 46.0, cz: -48.0, rx: 7.2, rz: 5.2, phase: 3.9, speed: 0.15, land: false, scale: 0.98 },
    // South-East grassy bank geese
    { cx: 38.0, cz: -1.5, rx: 0, rz: 0, phase: 0.5, speed: 0.32, land: true, scale: 1.05 },
    { cx: 42.5, cz: -4.2, rx: 0, rz: 0, phase: 2.2, speed: 0.28, land: true, scale: 0.98 },
  ];

  gooseSpecs.forEach((gs, idx) => {
    const root = new THREE.Group();
    const bodyGroup = new THREE.Group();
    bodyGroup.position.y = gs.land ? 0.24 : 0.03;
    root.add(bodyGroup);

    const torso = new THREE.Mesh(gooseTorsoGeo, gooseBodyMat);
    torso.castShadow = true;
    const wingL = new THREE.Mesh(gooseTorsoGeo, gooseWingMat);
    wingL.scale.set(0.35, 0.55, 0.85);
    wingL.position.set(0.11, 0.04, -0.02);
    const wingR = wingL.clone();
    wingR.position.x = -0.11;
    const tail = new THREE.Mesh(gooseTailGeo, gooseBodyMat);
    tail.position.set(0, 0.06, -0.25);
    bodyGroup.add(torso, wingL, wingR, tail);

    const neckPivot = new THREE.Group();
    neckPivot.position.set(0, 0.08, 0.18);
    neckPivot.rotation.x = 0.15;
    neckPivot.add(new THREE.Mesh(gooseNeckGeo, gooseBodyMat));

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.34, 0.02);
    headPivot.add(new THREE.Mesh(gooseHeadGeo, gooseBodyMat));
    const bill = new THREE.Mesh(gooseBillGeo, gooseBillMat);
    bill.position.set(0, -0.01, 0.085);
    const eyeL = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.011, 5, 5)), darkHoofEyeMat);
    eyeL.position.set(0.042, 0.02, 0.03);
    const eyeR = eyeL.clone();
    eyeR.position.x = -0.042;
    headPivot.add(bill, eyeL, eyeR);
    neckPivot.add(headPivot);
    bodyGroup.add(neckPivot);

    if (gs.land) {
      const legMeshGeo = trackGeo(new THREE.CylinderGeometry(0.014, 0.012, 0.22, 5));
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(legMeshGeo, gooseBillMat);
        leg.position.set(s * 0.06, -0.13, 0);
        bodyGroup.add(leg);
      }
      const shoreSpot = findShoreDrinkSpot(gs.cx + 18, gs.cz + 6);
      const bankSpot = findForestGrazeSpot(shoreSpot.x, shoreSpot.y, 2.2, idx === 4 ? -1.5 : 2.0);
      gs.cx = bankSpot.x;
      gs.cz = bankSpot.y;
    }

    root.scale.setScalar(gs.scale);
    group.add(root);

    waterbirds.push({
      root,
      neckPivot,
      headPivot,
      bodyGroup,
      center: new THREE.Vector2(gs.cx, gs.cz),
      rx: gs.rx,
      rz: gs.rz,
      phase: gs.phase,
      speed: gs.speed,
      dabbleCooldown: 3.5 + idx * 1.4,
      dabbleAnim: -1,
      rippleTimer: 0.8 + idx * 0.6,
      isLandWalker: gs.land,
      walkRange: 2.2,
      baseYaw: Math.atan2(-gs.cx, -44 - gs.cz),
    });
  });

  // --- Lake Mallard Ducks (8 Ducks in Two Calm Separated Bays: Near-Left Reeds & North-West Inlet) ---
  const drakeHeadMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x1a6842, roughness: 0.35, metalness: 0.18 }));
  const drakeChestMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x7a3d24, roughness: 0.72 }));
  const drakeBodyMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xb7b2a6, roughness: 0.78 }));
  const henBodyMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x856848, roughness: 0.82 }));
  const duckBillMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xf0b532, roughness: 0.42 }));

  const duckBodyGeo = trackGeo(new THREE.SphereGeometry(0.135, 10, 8));
  duckBodyGeo.scale(0.84, 0.72, 1.32);
  const duckNeckGeo = trackGeo(new THREE.CylinderGeometry(0.032, 0.044, 0.15, 7));
  duckNeckGeo.translate(0, 0.075, 0);
  const duckHeadGeo = trackGeo(new THREE.SphereGeometry(0.056, 8, 8));
  duckHeadGeo.scale(0.88, 0.88, 1.15);
  const duckBillGeo = trackGeo(new THREE.ConeGeometry(0.025, 0.085, 6));
  duckBillGeo.rotateX(Math.PI / 2);

  const duckSpecs = [
    // Near-left calm reed bay (clearly visible from dock & boat)
    { cx: -21.0, cz: -10.5, rx: 3.8, rz: 2.8, phase: 0.3, speed: 0.24, isDrake: true },
    { cx: -24.5, cz: -12.5, rx: 4.2, rz: 3.0, phase: 2.1, speed: 0.22, isDrake: false },
    { cx: -28.0, cz: -15.5, rx: 4.5, rz: 3.4, phase: 4.4, speed: 0.20, isDrake: true },
    { cx: -18.5, cz: -16.0, rx: 3.6, rz: 2.6, phase: 1.5, speed: 0.23, isDrake: false },
    // North-west quiet reed inlet
    { cx: -31.0, cz: -57.0, rx: 5.5, rz: 4.0, phase: 0.8, speed: 0.21, isDrake: true },
    { cx: -35.0, cz: -61.0, rx: 5.8, rz: 4.2, phase: 2.9, speed: 0.19, isDrake: false },
    { cx: -26.0, cz: -63.0, rx: 5.0, rz: 3.8, phase: 4.8, speed: 0.20, isDrake: true },
    { cx: -38.5, cz: -55.0, rx: 4.8, rz: 3.6, phase: 5.6, speed: 0.22, isDrake: false },
  ];

  duckSpecs.forEach((ds, idx) => {
    const root = new THREE.Group();
    const bodyGroup = new THREE.Group();
    bodyGroup.position.y = 0.02;
    root.add(bodyGroup);

    const bodyMat = ds.isDrake ? drakeBodyMat : henBodyMat;
    const torso = new THREE.Mesh(duckBodyGeo, bodyMat);
    torso.castShadow = true;
    const chest = new THREE.Mesh(duckBodyGeo, ds.isDrake ? drakeChestMat : henBodyMat);
    chest.scale.set(0.84, 0.84, 0.52);
    chest.position.set(0, 0.01, 0.08);
    const tail = new THREE.Mesh(gooseTailGeo, bodyMat);
    tail.scale.setScalar(0.72);
    tail.position.set(0, 0.04, -0.17);
    bodyGroup.add(torso, chest, tail);

    const neckPivot = new THREE.Group();
    neckPivot.position.set(0, 0.05, 0.12);
    const neckMat = ds.isDrake ? drakeHeadMat : henBodyMat;
    neckPivot.add(new THREE.Mesh(duckNeckGeo, neckMat));

    if (ds.isDrake) {
      const collar = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.042, 0.009, 6, 10)), gooseBodyMat);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 0.03;
      neckPivot.add(collar);
    }

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.15, 0.01);
    headPivot.add(new THREE.Mesh(duckHeadGeo, neckMat));
    const bill = new THREE.Mesh(duckBillGeo, duckBillMat);
    bill.position.set(0, -0.01, 0.072);
    const eyeL = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.01, 5, 5)), darkHoofEyeMat);
    eyeL.position.set(0.038, 0.016, 0.024);
    const eyeR = eyeL.clone();
    eyeR.position.x = -0.038;
    headPivot.add(bill, eyeL, eyeR);
    neckPivot.add(headPivot);
    bodyGroup.add(neckPivot);

    root.scale.setScalar(0.95 + (idx % 2) * 0.08);
    group.add(root);

    waterbirds.push({
      root,
      neckPivot,
      headPivot,
      bodyGroup,
      center: new THREE.Vector2(ds.cx, ds.cz),
      rx: ds.rx,
      rz: ds.rz,
      phase: ds.phase,
      speed: ds.speed,
      dabbleCooldown: 2.5 + idx * 1.1,
      dabbleAnim: -1,
      rippleTimer: 0.6 + idx * 0.45,
      isLandWalker: false,
      walkRange: 0,
      baseYaw: 0,
    });
  });

  const emitSparkles = (x: number, y: number, z: number, count: number, spread: number) => {
    for (let s = 0; s < count; s++) {
      const idx = sparkleCursor;
      sparkleCursor = (sparkleCursor + 1) % SPARKLE_POOL;
      const ang = Math.random() * Math.PI * 2;
      sparklePositions[idx * 3] = x + (Math.random() - 0.5) * 0.16;
      sparklePositions[idx * 3 + 1] = y + (Math.random() - 0.5) * 0.12;
      sparklePositions[idx * 3 + 2] = z + (Math.random() - 0.5) * 0.16;
      sparkleVelocities[idx * 3] = Math.cos(ang) * spread * Math.random();
      sparkleVelocities[idx * 3 + 1] = 0.4 + Math.random() * (spread * 1.4);
      sparkleVelocities[idx * 3 + 2] = Math.sin(ang) * spread * Math.random();
      sparkleLives[idx] = 0.42 + Math.random() * 0.38;
    }
    sparkleGeo.attributes.position.needsUpdate = true;
  };

  return {
    group,
    update: (dt, elapsed, weather, nightFactor, onDrinkRipple, getWaterSurfaceY, onWaterSplash) => {
      // Shelter land animals gently during severe storms or deep night
      const landVisible = weather !== 'storm' && nightFactor < 0.85;
      for (const a of animals) {
        a.root.visible = landVisible;
      }
      group.visible = true;
      if (landVisible) {

      for (let i = 0; i < animals.length; i++) {
        const a = animals[i];
        a.stateTimer -= dt;

        let moving = false;
        let targetNeckX = 0.36;
        let targetHeadX = -0.32;
        let targetHeadYaw = 0;

        if (a.behavior === 'grazing') {
          targetNeckX = a.grazeNeckAngle + Math.sin(elapsed * 4.6 + i * 1.7) * 0.08;
          targetHeadX = -0.18 + Math.sin(elapsed * 6.8 + i) * 0.09;
          if (a.stateTimer <= 0) {
            a.behavior = Math.random() < 0.55 ? 'walking_to_drink' : 'alert';
            a.stateTimer = a.behavior === 'alert' ? 3.5 + Math.random() * 3.0 : 18.0;
          }
        } else if (a.behavior === 'alert') {
          targetNeckX = 0.22;
          targetHeadX = -0.22;
          targetHeadYaw = Math.sin(elapsed * 1.1 + i * 2.1) * 0.42;
          if (a.stateTimer <= 0) {
            a.behavior = Math.random() < 0.55 ? 'walking_to_drink' : 'grazing';
            a.stateTimer = a.behavior === 'grazing' ? 7 + Math.random() * 6 : 18.0;
          }
        } else if (a.behavior === 'walking_to_drink' || a.behavior === 'walking_to_graze') {
          moving = true;
          const dest = a.behavior === 'walking_to_drink' ? a.drinkPos : a.grazePos;
          const dx = dest.x - a.currentPos.x;
          const dz = dest.y - a.currentPos.y;
          const dist = Math.hypot(dx, dz);

          if (dist < 0.35 || a.stateTimer <= 0) {
            moving = false;
            if (a.behavior === 'walking_to_drink') {
              a.behavior = 'drinking';
              a.stateTimer = 7.0 + Math.random() * 5.0;
              a.sipRippleCooldown = 0.6;
            } else {
              a.behavior = 'grazing';
              a.stateTimer = 8.0 + Math.random() * 7.0;
            }
          } else {
            const step = Math.min(dist, a.walkSpeed * dt);
            a.currentPos.x += (dx / dist) * step;
            a.currentPos.y += (dz / dist) * step;
            const desiredYaw = Math.atan2(dx, dz);
            // Shortest angle wrap
            const diff = Math.atan2(Math.sin(desiredYaw - a.heading), Math.cos(desiredYaw - a.heading));
            a.heading += diff * Math.min(1, dt * 4.5);
            targetNeckX = 0.48 + Math.sin(a.walkPhase) * 0.06;
            targetHeadX = -0.4;
          }
        } else if (a.behavior === 'drinking') {
          // Face lake water smoothly while drinking
          const waterYaw = Math.atan2(0 - a.currentPos.x, -44 - a.currentPos.y);
          const diff = Math.atan2(Math.sin(waterYaw - a.heading), Math.cos(waterYaw - a.heading));
          a.heading += diff * Math.min(1, dt * 3.5);

          // Rhythmic dipping sip motion
          const sipCycle = Math.sin(elapsed * 1.45 + i * 1.3);
          targetNeckX = a.drinkNeckAngle + sipCycle * 0.14;
          targetHeadX = -0.1 + sipCycle * 0.08;

          a.sipRippleCooldown -= dt;
          if (a.sipRippleCooldown <= 0 && onDrinkRipple) {
            a.sipRippleCooldown = 1.9 + Math.random() * 1.2;
            const rx = a.currentPos.x + Math.sin(a.heading) * 0.85;
            const rz = a.currentPos.y + Math.cos(a.heading) * 0.85;
            onDrinkRipple(rx, rz, 0.36);
          }

          if (a.stateTimer <= 0) {
            a.behavior = 'walking_to_graze';
            a.stateTimer = 18.0;
          }
        }

        // Terrain grounding & gentle pitch alignment
        const groundY = groundHeightAt(a.currentPos.x, a.currentPos.y);
        const aheadX = a.currentPos.x + Math.sin(a.heading) * 0.55;
        const aheadZ = a.currentPos.y + Math.cos(a.heading) * 0.55;
        const aheadY = groundHeightAt(aheadX, aheadZ);
        const terrainPitch = THREE.MathUtils.clamp(Math.atan2(groundY - aheadY, 0.55), -0.28, 0.28);

        a.root.position.set(a.currentPos.x, groundY, a.currentPos.y);
        a.root.rotation.y = a.heading;
        a.root.rotation.x = THREE.MathUtils.damp(a.root.rotation.x, terrainPitch, 6, dt);

        // Articulated neck, head & tail
        a.neckPivot.rotation.x = THREE.MathUtils.damp(a.neckPivot.rotation.x, targetNeckX, 4.5, dt);
        a.headPivot.rotation.x = THREE.MathUtils.damp(a.headPivot.rotation.x, targetHeadX, 5.5, dt);
        a.headPivot.rotation.y = THREE.MathUtils.damp(a.headPivot.rotation.y, targetHeadYaw, 4.5, dt);
        a.tailPivot.rotation.x = Math.sin(elapsed * 3.8 + i * 2.4) * 0.12;
        a.tailPivot.rotation.z = Math.sin(elapsed * 5.2 + i) * 0.08;

        // Articulated 4-leg stride when walking, neutral stance when paused
        if (moving) {
          a.walkPhase += dt * a.walkSpeed * 4.4;
          const s1 = Math.sin(a.walkPhase) * 0.42;
          const s2 = Math.sin(a.walkPhase + Math.PI) * 0.42;
          a.legs[0].rotation.x = s1;
          a.legs[1].rotation.x = s2;
          a.legs[2].rotation.x = s2 * 0.9;
          a.legs[3].rotation.x = s1 * 0.9;
        } else {
          for (let l = 0; l < 4; l++) {
            a.legs[l].rotation.x = THREE.MathUtils.damp(a.legs[l].rotation.x, 0, 8, dt);
          }
        }
      }
      } // end landVisible

      // --- Update Surface Turtles ---
      const turtlesActive = weather !== 'storm';
      for (let i = 0; i < turtles.length; i++) {
        const tu = turtles[i];
        tu.root.visible = turtlesActive;
        if (!turtlesActive) continue;

        const ang = elapsed * tu.speed + tu.phase;
        const tx = tu.center.x + Math.cos(ang) * tu.orbitRadiusX;
        const tz = tu.center.y + Math.sin(ang) * tu.orbitRadiusZ;
        const nextAng = ang + 0.05;
        const nx = tu.center.x + Math.cos(nextAng) * tu.orbitRadiusX;
        const nz = tu.center.y + Math.sin(nextAng) * tu.orbitRadiusZ;
        const yaw = Math.atan2(nx - tx, nz - tz);

        const groundY = groundHeightAt(tx, tz);
        const surfY = getWaterSurfaceY ? getWaterSurfaceY(tx, tz) : 0;
        const inWater = groundY < -0.08;
        const yPos = inWater ? surfY - 0.015 : groundY + 0.01;

        tu.root.position.set(tx, yPos, tz);
        tu.root.rotation.y = yaw;
        tu.root.rotation.z = inWater ? Math.sin(elapsed * 1.8 + i) * 0.045 : 0;
        tu.root.rotation.x = inWater ? Math.cos(elapsed * 1.4 + i) * 0.04 : 0;

        // Turtle head peeks upward softly to breathe/look around
        tu.headPivot.rotation.x = -0.18 + Math.sin(elapsed * 0.9 + i * 2.1) * 0.18;
        const paddle = inWater ? Math.sin(elapsed * 3.4 + i) * 0.42 : 0.1;
        tu.flippers[0].rotation.y = paddle;
        tu.flippers[1].rotation.y = -paddle;
        tu.flippers[2].rotation.y = -paddle * 0.7;
        tu.flippers[3].rotation.y = paddle * 0.7;

        if (inWater && onDrinkRipple) {
          tu.rippleTimer -= dt;
          if (tu.rippleTimer <= 0) {
            tu.rippleTimer = 2.4 + Math.random() * 1.4;
            onDrinkRipple(tx, tz, 0.34);
          }
        }
      }

      // --- Update Wading Flamingos ---
      const birdsActive = weather !== 'storm';
      for (let i = 0; i < flamingos.length; i++) {
        const fl = flamingos[i];
        fl.root.visible = birdsActive;
        if (!birdsActive) continue;

        const sway = Math.sin(elapsed * 0.85 + fl.phase) * 0.035;
        fl.root.rotation.z = sway * 0.4;

        if (fl.dipAnim >= 0) {
          fl.dipAnim += dt * 0.72;
          if (fl.dipAnim >= 1) {
            fl.dipAnim = -1;
            fl.dipCooldown = 4.5 + Math.random() * 5.0;
          } else {
            const p = Math.sin(fl.dipAnim * Math.PI);
            fl.neckPivot.rotation.x = 0.25 + p * 0.98;
            fl.headPivot.rotation.x = 0.22 + p * 0.42;
            fl.headPivot.rotation.y = Math.sin(elapsed * 9.0 + fl.phase) * 0.25 * p;
            if (Math.abs(fl.dipAnim - 0.5) < dt * 0.8 && onDrinkRipple) {
              onDrinkRipple(fl.baseX, fl.baseZ, 0.32);
            }
          }
        } else {
          fl.dipCooldown -= dt;
          if (fl.dipCooldown <= 0) {
            fl.dipAnim = 0;
          }
          fl.neckPivot.rotation.x = 0.25 + Math.sin(elapsed * 1.15 + fl.phase) * 0.07;
          fl.headPivot.rotation.x = 0.22 + Math.sin(elapsed * 1.5 + fl.phase) * 0.08;
          fl.headPivot.rotation.y = Math.sin(elapsed * 0.7 + fl.phase * 1.3) * 0.32;
        }

        if (fl.standingOneLeg) {
          fl.rightLeg.rotation.x = 0.92 + Math.sin(elapsed * 1.2 + fl.phase) * 0.04;
        }
      }

      // --- Update Valley Geese & Mallard Ducks ---
      for (let i = 0; i < waterbirds.length; i++) {
        const wb = waterbirds[i];
        wb.root.visible = birdsActive;
        if (!birdsActive) continue;

        if (wb.isLandWalker) {
          const walkT = elapsed * wb.speed + wb.phase;
          const ox = wb.center.x + Math.cos(walkT) * wb.walkRange;
          const oz = wb.center.y + Math.sin(walkT * 0.7) * (wb.walkRange * 0.65);
          const nx = wb.center.x + Math.cos(walkT + 0.06) * wb.walkRange;
          const nz = wb.center.y + Math.sin((walkT + 0.06) * 0.7) * (wb.walkRange * 0.65);
          const gy = groundHeightAt(ox, oz);
          wb.root.position.set(ox, gy, oz);
          wb.root.rotation.y = Math.atan2(nx - ox, nz - oz);
          wb.bodyGroup.rotation.z = Math.sin(elapsed * 5.2 + i) * 0.05;
          wb.neckPivot.rotation.x = 0.12 + Math.max(0, Math.sin(elapsed * 1.3 + i * 2.1)) * 0.55;
          wb.headPivot.rotation.y = Math.sin(elapsed * 1.1 + i) * 0.24;
          continue;
        }

        const ang = elapsed * wb.speed + wb.phase;
        const wx = wb.center.x + Math.cos(ang) * wb.rx;
        const wz = wb.center.y + Math.sin(ang) * wb.rz;
        const nextAng = ang + 0.05;
        const nx = wb.center.x + Math.cos(nextAng) * wb.rx;
        const nz = wb.center.y + Math.sin(nextAng) * wb.rz;
        const yaw = Math.atan2(nx - wx, nz - wz);

        const surfY = getWaterSurfaceY ? getWaterSurfaceY(wx, wz) : 0;
        wb.root.position.set(wx, surfY - 0.015, wz);
        wb.root.rotation.y = yaw;

        if (wb.dabbleAnim >= 0) {
          wb.dabbleAnim += dt * 0.85;
          if (wb.dabbleAnim >= 1) {
            wb.dabbleAnim = -1;
            wb.dabbleCooldown = 4.2 + Math.random() * 5.5;
          } else {
            const p = Math.sin(wb.dabbleAnim * Math.PI);
            wb.bodyGroup.rotation.x = p * 0.72;
            wb.neckPivot.rotation.x = 0.15 + p * 0.65;
            if (Math.abs(wb.dabbleAnim - 0.45) < dt * 0.9 && onDrinkRipple) {
              onDrinkRipple(wx, wz, 0.34);
            }
          }
        } else {
          wb.dabbleCooldown -= dt;
          if (wb.dabbleCooldown <= 0) {
            wb.dabbleAnim = 0;
          }
          wb.bodyGroup.rotation.x = Math.sin(elapsed * 2.0 + i) * 0.035;
          wb.bodyGroup.rotation.z = Math.cos(elapsed * 1.7 + i) * 0.04;
          wb.neckPivot.rotation.x = 0.14 + Math.sin(elapsed * 1.6 + i) * 0.08;
          wb.headPivot.rotation.y = Math.sin(elapsed * 0.95 + i * 1.7) * 0.28;
        }

        if (onDrinkRipple) {
          wb.rippleTimer -= dt;
          if (wb.rippleTimer <= 0) {
            wb.rippleTimer = 2.1 + Math.random() * 1.4;
            onDrinkRipple(wx, wz, 0.28);
          }
        }
      }

      // --- Update Sparkling Jumping Fish ---
      const jumpersAllowed = weather !== 'storm';
      for (let j = 0; j < jumpers.length; j++) {
        const jf = jumpers[j];
        if (!jf.active) {
          jf.root.visible = false;
          if (!jumpersAllowed) continue;
          jf.cooldown -= dt;
          if (jf.cooldown <= 0) {
            // Pick a scenic open water spot spread across the expanded lake
            let sx = (Math.random() - 0.5) * 96;
            let sz = -10 - Math.random() * 68;
            for (let k = 0; k < 6 && groundHeightAt(sx, sz) > -0.75; k++) {
              sx *= 0.75;
              sz = THREE.MathUtils.lerp(sz, -42, 0.35);
            }
            const jumpDir = Math.random() * Math.PI * 2;
            const jumpDist = 1.6 + Math.random() * 1.4;
            jf.startX = sx;
            jf.startZ = sz;
            jf.endX = sx + Math.cos(jumpDir) * jumpDist;
            jf.endZ = sz + Math.sin(jumpDir) * jumpDist;
            jf.duration = 0.88 + Math.random() * 0.28;
            jf.peakHeight = 0.82 + Math.random() * 0.65;
            jf.t = 0;
            jf.active = true;
            jf.sparkleTimer = 0;
            jf.root.visible = true;

            if (onWaterSplash) onWaterSplash(sx, sz, 0.95);
            emitSparkles(sx, 0.1, sz, 14, 1.4);
          }
        } else {
          jf.t += dt / jf.duration;
          if (jf.t >= 1) {
            jf.active = false;
            jf.root.visible = false;
            jf.cooldown = 3.2 + Math.random() * 5.2;
            if (onWaterSplash) onWaterSplash(jf.endX, jf.endZ, 1.05);
            emitSparkles(jf.endX, 0.1, jf.endZ, 16, 1.5);
          } else {
            const p = jf.t;
            const px = THREE.MathUtils.lerp(jf.startX, jf.endX, p);
            const pz = THREE.MathUtils.lerp(jf.startZ, jf.endZ, p);
            const surfY = getWaterSurfaceY ? getWaterSurfaceY(px, pz) : 0;
            const arcY = surfY + 4 * jf.peakHeight * p * (1 - p) - 0.12;
            const dArcDt = (4 * jf.peakHeight * (1 - 2 * p)) / jf.duration;
            const horizSpeed = Math.hypot(jf.endX - jf.startX, jf.endZ - jf.startZ) / jf.duration;
            const yaw = Math.atan2(jf.endX - jf.startX, jf.endZ - jf.startZ);
            const pitch = -Math.atan2(dArcDt, horizSpeed);

            jf.root.position.set(px, arcY, pz);
            jf.root.rotation.set(pitch, yaw, Math.sin(p * Math.PI * 3) * 0.18);
            jf.tailPivot.rotation.y = Math.sin(elapsed * 28 + j) * 0.38;

            jf.sparkleTimer -= dt;
            if (jf.sparkleTimer <= 0 && arcY > 0.05) {
              jf.sparkleTimer = 0.045;
              emitSparkles(px, arcY, pz, 2, 0.65);
            }
          }
        }
      }

      // --- Update Shimmering Sparkle Droplets ---
      let anySparkle = false;
      for (let i = 0; i < SPARKLE_POOL; i++) {
        if (sparkleLives[i] > 0) {
          anySparkle = true;
          sparkleLives[i] -= dt;
          sparklePositions[i * 3] += sparkleVelocities[i * 3] * dt;
          sparklePositions[i * 3 + 1] += sparkleVelocities[i * 3 + 1] * dt;
          sparklePositions[i * 3 + 2] += sparkleVelocities[i * 3 + 2] * dt;
          sparkleVelocities[i * 3 + 1] -= 7.8 * dt;
          if (sparkleLives[i] <= 0 || sparklePositions[i * 3 + 1] < -0.05) {
            sparkleLives[i] = 0;
            sparklePositions[i * 3 + 1] = -999;
          }
        }
      }
      if (anySparkle) {
        sparkleGeo.attributes.position.needsUpdate = true;
      }
    },
    dispose: () => {
      for (const g of sharedGeos) g.dispose();
      for (const m of sharedMats) m.dispose();
    },
  };
}
