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
 * stepping from a forest clearing position toward the lake center (0, -26).
 */
function findShoreDrinkSpot(startX: number, startZ: number): THREE.Vector2 {
  const targetX = 0;
  const targetZ = -26;
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
 * Steps from a shoreline spot back toward the pine grove until terrain reaches gentle meadow/forest height.
 */
function findForestGrazeSpot(shoreX: number, shoreZ: number, pullDist: number, lateralOffset = 0): THREE.Vector2 {
  const dx = shoreX - 0;
  const dz = shoreZ - -26;
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

  // Spawn animals in 3 scenic lakeside forest groves clearly visible across the lake & during Cinematic Mode
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
    // Left scenic bank among pine trees & shore
    { kind: 'stag', scale: 1.38, seedX: -48, seedZ: -28, pullDist: 7.5, lateral: 2.0, initialBehavior: 'grazing', initialTimer: 9 },
    { kind: 'doe', scale: 1.24, seedX: -45, seedZ: -24, pullDist: 4.2, lateral: -2.6, initialBehavior: 'drinking', initialTimer: 7 },
    { kind: 'doe', scale: 1.2, seedX: -50, seedZ: -33, pullDist: 9.2, lateral: 1.5, initialBehavior: 'grazing', initialTimer: 5 },
    // Right scenic bank among pine trees & shore
    { kind: 'doe', scale: 1.26, seedX: 46, seedZ: -32, pullDist: 5.5, lateral: 1.8, initialBehavior: 'drinking', initialTimer: 8 },
    { kind: 'fawn', scale: 0.88, seedX: 45, seedZ: -30, pullDist: 6.4, lateral: 3.1, initialBehavior: 'grazing', initialTimer: 6 },
    { kind: 'fox', scale: 1.15, seedX: 42, seedZ: -19, pullDist: 6.0, lateral: -1.4, initialBehavior: 'grazing', initialTimer: 4 },
    // Far north shore across the lake (facing dock)
    { kind: 'stag', scale: 1.42, seedX: -12, seedZ: -64, pullDist: 6.8, lateral: -2.2, initialBehavior: 'drinking', initialTimer: 10 },
    { kind: 'doe', scale: 1.24, seedX: 11, seedZ: -62, pullDist: 8.5, lateral: 2.0, initialBehavior: 'grazing', initialTimer: 7 },
  ];

  for (const cfg of spawnConfigs) {
    const drinkPos = findShoreDrinkSpot(cfg.seedX, cfg.seedZ);
    const grazePos = findForestGrazeSpot(drinkPos.x, drinkPos.y, cfg.pullDist, cfg.lateral);
    const startPos = cfg.initialBehavior === 'drinking' ? drinkPos.clone() : grazePos.clone();

    const parts = cfg.kind === 'fox' ? buildFox(cfg.scale) : buildDeer(cfg.kind, cfg.scale);
    const faceWaterYaw = Math.atan2(0 - startPos.x, -26 - startPos.y);
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
    { cx: -8.5, cz: -13.5, rx: 4.5, rz: 3.2, scale: 1.15, speed: 0.18, isBasker: false },
    { cx: 11.5, cz: -17.0, rx: 5.2, rz: 3.8, scale: 1.05, speed: 0.15, isBasker: false },
    { cx: -3.5, cz: -25.0, rx: 6.0, rz: 4.2, scale: 1.22, speed: 0.14, isBasker: false },
    { cx: 19.0, cz: -10.5, rx: 2.8, rz: 2.2, scale: 0.96, speed: 0.12, isBasker: true },
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
          const waterYaw = Math.atan2(0 - a.currentPos.x, -26 - a.currentPos.y);
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

      // --- Update Sparkling Jumping Fish ---
      const jumpersAllowed = weather !== 'storm';
      for (let j = 0; j < jumpers.length; j++) {
        const jf = jumpers[j];
        if (!jf.active) {
          jf.root.visible = false;
          if (!jumpersAllowed) continue;
          jf.cooldown -= dt;
          if (jf.cooldown <= 0) {
            // Pick a scenic open water spot visible from the dock
            let sx = (Math.random() - 0.5) * 38;
            let sz = -7 - Math.random() * 29;
            for (let k = 0; k < 6 && groundHeightAt(sx, sz) > -0.7; k++) {
              sx *= 0.75;
              sz = THREE.MathUtils.lerp(sz, -22, 0.35);
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
