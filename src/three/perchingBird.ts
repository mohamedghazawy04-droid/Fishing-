import * as THREE from 'three';
import type { WeatherType } from '../types/fishing';

type BirdState = 'cooldown' | 'approaching' | 'perched' | 'departing';

interface PerchTarget {
  id: string;
  kind: 'boat' | 'pier';
  pos: THREE.Vector3; // local to boatRoot if kind==='boat', world if kind==='pier'
  edgeAxis: THREE.Vector3; // valid small-hop direction along perch rim
  hopLimit: number;
  baseLocalYaw: number; // default perched facing direction relative to boat or world
}

export interface PerchingBirdSystem {
  group: THREE.Group;
  triggerScatter: () => void;
  update: (params: {
    dt: number;
    elapsed: number;
    weather: WeatherType;
    nightFactor: number;
    cinematicActive: boolean;
    isOnBoat: boolean;
    boatRoot: THREE.Object3D;
    boatYaw: number;
    boatMovingFast: boolean;
    onBirdChirp?: (pan: number) => void;
    onWingFlutter?: (pan: number) => void;
  }) => void;
  dispose: () => void;
}

export function createPerchingBirdSystem(): PerchingBirdSystem {
  const group = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    disposables.push(m);
    return m;
  };

  // Materials: Alpine Kingfisher / Blue-backed Lakeside Songbird
  const backBlueMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x26748f,
      roughness: 0.56,
      metalness: 0.08,
    }),
  );
  const wingBlueMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1c5973,
      roughness: 0.6,
      metalness: 0.06,
      side: THREE.DoubleSide,
    }),
  );
  const breastAmberMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd97d3a,
      roughness: 0.72,
      metalness: 0.02,
    }),
  );
  const cheekCreamMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xf4eee3,
      roughness: 0.76,
    }),
  );
  const beakMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1e1d20,
      roughness: 0.34,
      metalness: 0.14,
    }),
  );
  const legMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd16c34,
      roughness: 0.52,
    }),
  );
  const eyeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x0d0f12,
      roughness: 0.14,
      metalness: 0.25,
    }),
  );

  // Bird Rig (grounded at y = 0 where toes rest on the boat gunwale or pier wood)
  const birdRoot = new THREE.Group();
  birdRoot.visible = false;
  group.add(birdRoot);

  // Articulated legs + gripping claws
  const tarsusGeo = trackGeo(new THREE.CylinderGeometry(0.0055, 0.0045, 0.075, 5));
  tarsusGeo.translate(0, -0.0375, 0);
  const toeGeo = trackGeo(new THREE.BoxGeometry(0.005, 0.004, 0.034));
  toeGeo.translate(0, 0.002, 0.012);
  const hindToeGeo = trackGeo(new THREE.BoxGeometry(0.005, 0.004, 0.02));
  hindToeGeo.translate(0, 0.002, -0.01);

  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(0.024, 0.075, 0.004);
  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(-0.024, 0.075, 0.004);

  for (const legPivot of [leftLegPivot, rightLegPivot]) {
    const tarsus = new THREE.Mesh(tarsusGeo, legMat);
    tarsus.castShadow = true;
    const footGroup = new THREE.Group();
    footGroup.position.set(0, -0.075, 0);
    const toeC = new THREE.Mesh(toeGeo, legMat);
    const toeL = new THREE.Mesh(toeGeo, legMat);
    toeL.rotation.y = 0.38;
    const toeR = new THREE.Mesh(toeGeo, legMat);
    toeR.rotation.y = -0.38;
    const hindToe = new THREE.Mesh(hindToeGeo, legMat);
    footGroup.add(toeC, toeL, toeR, hindToe);
    legPivot.add(tarsus, footGroup);
  }
  birdRoot.add(leftLegPivot, rightLegPivot);

  // Body pivot (torso, warm breast, fanned tail, head, & articulated flapping wings)
  const bodyPivot = new THREE.Group();
  bodyPivot.position.set(0, 0.095, 0);
  birdRoot.add(bodyPivot);

  const torsoGeo = trackGeo(new THREE.SphereGeometry(0.064, 12, 10));
  torsoGeo.scale(0.84, 0.78, 1.38);
  const torso = new THREE.Mesh(torsoGeo, backBlueMat);
  torso.rotation.x = -0.22;
  torso.castShadow = true;
  bodyPivot.add(torso);

  const breastGeo = trackGeo(new THREE.SphereGeometry(0.056, 10, 8));
  breastGeo.scale(0.8, 0.74, 1.15);
  const breast = new THREE.Mesh(breastGeo, breastAmberMat);
  breast.position.set(0, -0.014, 0.022);
  breast.rotation.x = -0.2;
  breast.castShadow = true;
  bodyPivot.add(breast);

  const throatGeo = trackGeo(new THREE.SphereGeometry(0.036, 8, 8));
  throatGeo.scale(0.85, 0.75, 0.9);
  const throat = new THREE.Mesh(throatGeo, cheekCreamMat);
  throat.position.set(0, 0.022, 0.058);
  bodyPivot.add(throat);

  // Tail Pivot (3 overlapping feathers that fan & wag naturally)
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.012, -0.078);
  const tailFeatherGeo = trackGeo(new THREE.BoxGeometry(0.022, 0.005, 0.12));
  tailFeatherGeo.translate(0, 0, -0.06);
  for (const ang of [-0.14, 0, 0.14]) {
    const tf = new THREE.Mesh(tailFeatherGeo, wingBlueMat);
    tf.rotation.y = ang;
    tf.castShadow = true;
    tailPivot.add(tf);
  }
  bodyPivot.add(tailPivot);

  // Head Pivot (curious head snaps, tilts, cheek patches, eyes & slender kingfisher beak)
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.056, 0.066);
  const headGeo = trackGeo(new THREE.SphereGeometry(0.043, 10, 8));
  headGeo.scale(0.92, 0.9, 1.12);
  const headMesh = new THREE.Mesh(headGeo, backBlueMat);
  headMesh.castShadow = true;
  headPivot.add(headMesh);

  // Small expressive crown tuft
  const crestGeo = trackGeo(new THREE.ConeGeometry(0.016, 0.042, 5));
  crestGeo.rotateX(-Math.PI * 0.42);
  const crest = new THREE.Mesh(crestGeo, backBlueMat);
  crest.position.set(0, 0.034, -0.024);
  headPivot.add(crest);

  const cheekGeo = trackGeo(new THREE.SphereGeometry(0.018, 6, 6));
  cheekGeo.scale(0.65, 0.75, 1.15);
  const eyeGeo = trackGeo(new THREE.SphereGeometry(0.0085, 6, 6));
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(cheekGeo, cheekCreamMat);
    cheek.position.set(side * 0.027, -0.006, 0.014);
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(side * 0.031, 0.012, 0.026);
    headPivot.add(cheek, eye);
  }

  const beakGeo = trackGeo(new THREE.ConeGeometry(0.012, 0.078, 6));
  beakGeo.rotateX(Math.PI / 2);
  const beak = new THREE.Mesh(beakGeo, beakMat);
  beak.position.set(0, -0.002, 0.072);
  beak.castShadow = true;
  headPivot.add(beak);
  bodyPivot.add(headPivot);

  // Articulated Sculpted Wings (+X left wing, -X right wing)
  function buildWingMesh(side: 1 | -1): THREE.Group {
    const wingPivot = new THREE.Group();
    wingPivot.position.set(side * 0.046, 0.028, 0.022);

    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0.042);
    wingShape.quadraticCurveTo(side * 0.11, 0.048, side * 0.225, 0.004);
    wingShape.quadraticCurveTo(side * 0.21, -0.068, side * 0.12, -0.088);
    wingShape.quadraticCurveTo(side * 0.05, -0.095, 0, -0.068);
    wingShape.closePath();

    const wingGeo = trackGeo(new THREE.ShapeGeometry(wingShape, 8));
    wingGeo.rotateX(-Math.PI / 2); // XY shape -> XZ horizontal wing plane (+X span, +Z leading edge)

    const wingMesh = new THREE.Mesh(wingGeo, wingBlueMat);
    wingMesh.castShadow = true;
    wingPivot.add(wingMesh);

    // Subtle light wing-bar feather accent
    const barGeo = trackGeo(new THREE.BoxGeometry(0.11, 0.006, 0.018));
    const bar = new THREE.Mesh(barGeo, cheekCreamMat);
    bar.position.set(side * 0.085, 0.002, -0.022);
    bar.rotation.y = side * -0.18;
    wingPivot.add(bar);

    return wingPivot;
  }

  const leftWingPivot = buildWingMesh(1);
  const rightWingPivot = buildWingMesh(-1);
  bodyPivot.add(leftWingPivot, rightWingPivot);

  // Perch Targets on Boat Edge & Wooden Pier
  const perchTargets: PerchTarget[] = [
    {
      id: 'boat_starboard',
      kind: 'boat',
      pos: new THREE.Vector3(0.785, 0.345, -0.76),
      edgeAxis: new THREE.Vector3(0, 0, 1),
      hopLimit: 0.14,
      baseLocalYaw: -0.68,
    },
    {
      id: 'boat_port',
      kind: 'boat',
      pos: new THREE.Vector3(-0.795, 0.342, -0.68),
      edgeAxis: new THREE.Vector3(0, 0, 1),
      hopLimit: 0.14,
      baseLocalYaw: 0.72,
    },
    {
      id: 'boat_bow',
      kind: 'boat',
      pos: new THREE.Vector3(-0.22, 0.37, -1.45),
      edgeAxis: new THREE.Vector3(1, 0, 0),
      hopLimit: 0.07,
      baseLocalYaw: 0.35,
    },
    {
      id: 'pier_piling',
      kind: 'pier',
      pos: new THREE.Vector3(1.18, 1.37, -0.35),
      edgeAxis: new THREE.Vector3(1, 0, 0),
      hopLimit: 0.025,
      baseLocalYaw: -0.78,
    },
    {
      id: 'pier_edge_left',
      kind: 'pier',
      pos: new THREE.Vector3(-0.88, 0.72, -0.44),
      edgeAxis: new THREE.Vector3(1, 0, 0),
      hopLimit: 0.18,
      baseLocalYaw: 0.45,
    },
    {
      id: 'pier_edge_right',
      kind: 'pier',
      pos: new THREE.Vector3(0.82, 0.72, -0.38),
      edgeAxis: new THREE.Vector3(0, 0, 1),
      hopLimit: 0.16,
      baseLocalYaw: -0.58,
    },
  ];

  // State machine variables (zero runtime allocations in update)
  let state: BirdState = 'cooldown';
  let stateTimer = 6.5; // Initial arrival shortly after game starts
  let phaseT = 0;
  let flightDuration = 2.9;
  let activeTarget: PerchTarget = perchTargets[0];
  let perchDuration = 8.5;

  // Perch micro-animation state
  let wingFold = 0; // 0 = spread open, 1 = neatly folded
  let flutterTimer = 0;
  let nextFlutterIn = 1.6;
  let headSnapTimer = 0.6;
  let targetHeadYaw = 0;
  let targetHeadPitch = 0;
  let targetHeadRoll = 0;
  let hopOffset = 0;
  let hopFrom = 0;
  let hopTo = 0;
  let hopProgress = -1;
  let nextHopIn = 2.8;
  let chirpCooldown = 1.2;
  let prevCinematic = false;
  let prevBoatMovingFast = false;

  const flightStart = new THREE.Vector3();
  const flightControl = new THREE.Vector3();
  const flightEndOffset = new THREE.Vector3();
  const tmpPerchWorld = new THREE.Vector3();
  const tmpPerchEdgeDir = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();
  const tmpNextPos = new THREE.Vector3();
  const tmpAxisQuat = new THREE.Quaternion();

  function evalQuadraticBezier(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    t: number,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    const inv = 1 - t;
    out.set(
      inv * inv * a.x + 2 * inv * t * b.x + t * t * c.x,
      inv * inv * a.y + 2 * inv * t * b.y + t * t * c.y,
      inv * inv * a.z + 2 * inv * t * b.z + t * t * c.z,
    );
    return out;
  }

  function computePerchWorldPos(target: PerchTarget, boatRoot: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
    if (target.kind === 'boat') {
      boatRoot.updateMatrixWorld();
      out.copy(target.pos).applyMatrix4(boatRoot.matrixWorld);
    } else {
      out.copy(target.pos);
    }
    return out;
  }

  function pickNextTarget(isOnBoat: boolean): PerchTarget {
    const boatTargets = perchTargets.filter((t) => t.kind === 'boat');
    const pierTargets = perchTargets.filter((t) => t.kind === 'pier');
    if (isOnBoat) {
      // When cruising/anchored out on boat, prefer boat gunwale edges
      const pool = Math.random() < 0.85 ? boatTargets : pierTargets;
      return pool[Math.floor(Math.random() * pool.length)];
    }
    // When on wooden pier, alternate naturally between pier edges/piling and moored boat edge
    const pool = Math.random() < 0.52 ? boatTargets : pierTargets;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function beginApproach(isOnBoat: boolean, boatRoot: THREE.Object3D): void {
    activeTarget = pickNextTarget(isOnBoat);
    computePerchWorldPos(activeTarget, boatRoot, tmpPerchWorld);

    const sideSign = Math.random() < 0.5 ? -1 : 1;
    const distAway = 14 + Math.random() * 6;
    const originX = tmpPerchWorld.x + sideSign * distAway;
    const originY = tmpPerchWorld.y + 5.2 + Math.random() * 2.5;
    const originZ = tmpPerchWorld.z - 8 - Math.random() * 7;

    flightStart.set(originX, originY, originZ);
    // Swoop arc dips over the lake before rising gently up to flare onto the rim
    flightControl.set(
      (originX + tmpPerchWorld.x) * 0.5 + sideSign * 2.2,
      Math.max(1.2, tmpPerchWorld.y + 0.85),
      (originZ + tmpPerchWorld.z) * 0.5 - 2.6,
    );

    flightDuration = 2.7 + Math.random() * 0.7;
    phaseT = 0;
    wingFold = 0;
    hopOffset = 0;
    hopProgress = -1;
    state = 'approaching';
    birdRoot.visible = true;
  }

  function beginDeparture(boatRoot: THREE.Object3D, onWingFlutter?: (pan: number) => void): void {
    computePerchWorldPos(activeTarget, boatRoot, tmpPerchWorld);
    flightStart.copy(birdRoot.position);

    const sideSign = activeTarget.pos.x >= 0 ? 1 : -1;
    flightControl.set(
      flightStart.x + sideSign * 4.5,
      flightStart.y + 2.4,
      flightStart.z - 6.5,
    );
    flightEndOffset.set(
      flightStart.x + sideSign * (15 + Math.random() * 6),
      flightStart.y + 8.5 + Math.random() * 2.5,
      flightStart.z - 18 - Math.random() * 6,
    );

    flightDuration = 2.9 + Math.random() * 0.6;
    phaseT = 0;
    state = 'departing';
    if (onWingFlutter) {
      onWingFlutter(THREE.MathUtils.clamp(activeTarget.pos.x * 0.25, -0.7, 0.7));
    }
  }

  return {
    group,
    triggerScatter: () => {
      if (state === 'perched' && stateTimer > 1.2) {
        stateTimer = 0.25;
      }
    },
    update: ({
      dt,
      elapsed,
      weather,
      nightFactor,
      cinematicActive,
      isOnBoat,
      boatRoot,
      boatYaw,
      boatMovingFast,
      onBirdChirp,
      onWingFlutter,
    }) => {
      const weatherAllowed = weather !== 'storm' && nightFactor < 0.86;

      // Boost visit frequency slightly when entering cinematic view so shots feature the bird
      if (cinematicActive && !prevCinematic && state === 'cooldown' && stateTimer > 3.2) {
        stateTimer = 1.6 + Math.random() * 1.4;
      }
      prevCinematic = cinematicActive;

      // If boat accelerates suddenly while bird is perched on it, bird startles and flies away
      if (boatMovingFast && !prevBoatMovingFast && state === 'perched' && activeTarget.kind === 'boat') {
        stateTimer = 0.15;
      }
      prevBoatMovingFast = boatMovingFast;

      if (!weatherAllowed) {
        if (state === 'perched') {
          beginDeparture(boatRoot, onWingFlutter);
        } else if (state === 'cooldown') {
          birdRoot.visible = false;
          return;
        }
      }

      if (state === 'cooldown') {
        birdRoot.visible = false;
        if (!weatherAllowed) return;
        stateTimer -= dt;
        if (stateTimer <= 0) {
          beginApproach(isOnBoat, boatRoot);
        }
        return;
      }

      if (state === 'approaching') {
        phaseT += dt / flightDuration;
        computePerchWorldPos(activeTarget, boatRoot, tmpPerchWorld);

        const clampedT = Math.min(1, phaseT);
        // Smooth deceleration into landing flare
        const easeT = 1 - Math.pow(1 - clampedT, 2.15);
        evalQuadraticBezier(flightStart, flightControl, tmpPerchWorld, easeT, tmpPos);
        evalQuadraticBezier(flightStart, flightControl, tmpPerchWorld, Math.min(1, easeT + 0.03), tmpNextPos);

        birdRoot.position.copy(tmpPos);

        const dx = tmpNextPos.x - tmpPos.x;
        const dy = tmpNextPos.y - tmpPos.y;
        const dz = tmpNextPos.z - tmpPos.z;
        const horiz = Math.hypot(dx, dz) || 0.001;
        const flyYaw = Math.atan2(dx, dz);
        const targetPerchedYaw =
          (activeTarget.kind === 'boat' ? boatYaw : 0) + activeTarget.baseLocalYaw;

        // Smoothly align toward perched orientation in final flare
        const flareBlend = THREE.MathUtils.smoothstep(clampedT, 0.72, 1.0);
        const yawDiff = Math.atan2(Math.sin(targetPerchedYaw - flyYaw), Math.cos(targetPerchedYaw - flyYaw));
        birdRoot.rotation.set(
          THREE.MathUtils.lerp(-Math.atan2(dy, horiz) * 0.75, -0.32, flareBlend),
          flyYaw + yawDiff * flareBlend,
          (1 - flareBlend) * -0.18,
        );

        wingFold = THREE.MathUtils.damp(wingFold, flareBlend * 0.25, 10, dt);
        const flapSpeed = THREE.MathUtils.lerp(18, 28, flareBlend);
        const flapAmp = THREE.MathUtils.lerp(0.88, 0.65, flareBlend);
        const flap = Math.sin(elapsed * flapSpeed) * flapAmp;

        leftWingPivot.rotation.set(0.28 * wingFold, 1.28 * wingFold, flap * (1 - wingFold * 0.7));
        rightWingPivot.rotation.set(0.28 * wingFold, -1.28 * wingFold, -flap * (1 - wingFold * 0.7));

        // Tuck legs in flight, reach forward during landing flare
        const legExt = THREE.MathUtils.lerp(0.95, -0.35, flareBlend);
        leftLegPivot.rotation.x = legExt;
        rightLegPivot.rotation.x = legExt;
        tailPivot.rotation.x = 0.22 + flareBlend * 0.35;
        bodyPivot.position.y = 0.095;
        headPivot.rotation.set(0, 0, 0);

        if (phaseT >= 1) {
          state = 'perched';
          perchDuration = 7.0 + Math.random() * 4.5;
          stateTimer = perchDuration;
          flutterTimer = 0.48; // brief joyful settle-flutter right on landing
          nextFlutterIn = 1.8 + Math.random() * 2.2;
          headSnapTimer = 0.4;
          targetHeadYaw = (Math.random() - 0.5) * 1.1;
          targetHeadPitch = 0.08;
          targetHeadRoll = 0.16;
          nextHopIn = 2.4 + Math.random() * 2.6;
          chirpCooldown = 0.35;
          if (onWingFlutter) {
            onWingFlutter(THREE.MathUtils.clamp(tmpPerchWorld.x * 0.2, -0.65, 0.65));
          }
        }
        return;
      }

      if (state === 'perched') {
        stateTimer -= dt;
        computePerchWorldPos(activeTarget, boatRoot, tmpPerchWorld);

        // Hop offset along valid rim axis
        if (hopProgress >= 0) {
          hopProgress += dt / 0.24;
          if (hopProgress >= 1) {
            hopOffset = hopTo;
            hopProgress = -1;
          } else {
            hopOffset = THREE.MathUtils.lerp(hopFrom, hopTo, hopProgress);
          }
        } else {
          nextHopIn -= dt;
          if (nextHopIn <= 0 && activeTarget.hopLimit > 0.04 && stateTimer > 1.6) {
            nextHopIn = 3.2 + Math.random() * 2.5;
            hopFrom = hopOffset;
            hopTo = (Math.random() * 2 - 1) * activeTarget.hopLimit;
            hopProgress = 0;
            flutterTimer = Math.max(flutterTimer, 0.28);
          }
        }

        tmpPerchEdgeDir.copy(activeTarget.edgeAxis);
        if (activeTarget.kind === 'boat') {
          tmpAxisQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, boatYaw);
          tmpPerchEdgeDir.applyQuaternion(tmpAxisQuat);
        }
        const hopLift = hopProgress >= 0 ? Math.sin(hopProgress * Math.PI) * 0.085 : 0;
        birdRoot.position.copy(tmpPerchWorld).addScaledVector(tmpPerchEdgeDir, hopOffset);
        birdRoot.position.y += hopLift;

        const baseYaw = (activeTarget.kind === 'boat' ? boatYaw : 0) + activeTarget.baseLocalYaw;
        const takeOffCrouch = stateTimer < 0.22 ? (1 - stateTimer / 0.22) : 0;
        birdRoot.rotation.set(takeOffCrouch * 0.24, baseYaw, 0);

        // Leg stance & subtle breathing/crouch
        const legCrouch = hopProgress >= 0 ? -0.2 : takeOffCrouch * 0.35;
        leftLegPivot.rotation.x = 0.06 + legCrouch;
        rightLegPivot.rotation.x = 0.06 + legCrouch;
        bodyPivot.position.y = 0.095 - takeOffCrouch * 0.024 + Math.sin(elapsed * 3.1) * 0.0025;
        bodyPivot.rotation.x = Math.sin(elapsed * 3.1) * 0.03;

        // Curious songbird head snaps & tilts
        headSnapTimer -= dt;
        if (headSnapTimer <= 0) {
          headSnapTimer = 0.65 + Math.random() * 1.25;
          targetHeadYaw = (Math.random() - 0.5) * 1.45;
          targetHeadPitch = Math.random() < 0.25 ? 0.36 : (Math.random() - 0.5) * 0.28;
          targetHeadRoll = Math.random() < 0.45 ? (Math.random() < 0.5 ? 0.26 : -0.26) : 0;
        }
        headPivot.rotation.y = THREE.MathUtils.damp(headPivot.rotation.y, targetHeadYaw, 18, dt);
        headPivot.rotation.x = THREE.MathUtils.damp(headPivot.rotation.x, targetHeadPitch, 16, dt);
        headPivot.rotation.z = THREE.MathUtils.damp(headPivot.rotation.z, targetHeadRoll, 16, dt);

        // Wagtail-like tail bobbing + flutter fanning
        const tailWag = Math.sin(elapsed * 4.8) * 0.09 + (flutterTimer > 0 ? Math.sin(elapsed * 22) * 0.16 : 0);
        tailPivot.rotation.x = 0.12 + tailWag;

        // Spontaneous wing-flutter bursts ("يرفرف") while perched
        if (flutterTimer > 0) {
          flutterTimer -= dt;
          wingFold = THREE.MathUtils.damp(wingFold, 0.18, 16, dt);
          const flutterBeat = Math.sin(elapsed * 28) * 0.62 + 0.15;
          leftWingPivot.rotation.set(0.28 * wingFold, 1.28 * wingFold, flutterBeat * (1 - wingFold * 0.55));
          rightWingPivot.rotation.set(0.28 * wingFold, -1.28 * wingFold, -flutterBeat * (1 - wingFold * 0.55));
        } else {
          nextFlutterIn -= dt;
          if (nextFlutterIn <= 0 && stateTimer > 1.2) {
            flutterTimer = 0.45 + Math.random() * 0.4;
            nextFlutterIn = 2.2 + Math.random() * 2.5;
            if (onWingFlutter) {
              onWingFlutter(THREE.MathUtils.clamp(birdRoot.position.x * 0.18, -0.65, 0.65));
            }
          }
          wingFold = THREE.MathUtils.damp(wingFold, 1.0, 12, dt);
          const settleBreath = Math.sin(elapsed * 3.1) * 0.025;
          leftWingPivot.rotation.set(0.28 * wingFold, 1.28 * wingFold, -0.22 * wingFold + settleBreath);
          rightWingPivot.rotation.set(0.28 * wingFold, -1.28 * wingFold, 0.22 * wingFold - settleBreath);
        }

        // Occasional cheerful close-up chirp while perched
        chirpCooldown -= dt;
        if (chirpCooldown <= 0 && stateTimer > 1.4) {
          chirpCooldown = 2.6 + Math.random() * 2.8;
          if (onBirdChirp) {
            onBirdChirp(THREE.MathUtils.clamp(birdRoot.position.x * 0.18, -0.65, 0.65));
          }
        }

        if (stateTimer <= 0) {
          beginDeparture(boatRoot, onWingFlutter);
        }
        return;
      }

      if (state === 'departing') {
        phaseT += dt / flightDuration;
        const clampedT = Math.min(1, phaseT);
        // Accelerate cleanly upward and out over the lake
        const easeT = Math.pow(clampedT, 1.25);
        evalQuadraticBezier(flightStart, flightControl, flightEndOffset, easeT, tmpPos);
        evalQuadraticBezier(flightStart, flightControl, flightEndOffset, Math.min(1, easeT + 0.03), tmpNextPos);

        birdRoot.position.copy(tmpPos);
        const dx = tmpNextPos.x - tmpPos.x;
        const dy = tmpNextPos.y - tmpPos.y;
        const dz = tmpNextPos.z - tmpPos.z;
        const horiz = Math.hypot(dx, dz) || 0.001;

        birdRoot.rotation.set(
          -Math.atan2(dy, horiz) * 0.85,
          Math.atan2(dx, dz),
          Math.sin(clampedT * Math.PI) * 0.24,
        );

        wingFold = THREE.MathUtils.damp(wingFold, 0, 14, dt);
        const flap = Math.sin(elapsed * 22) * 0.92;
        leftWingPivot.rotation.set(0, 0, flap);
        rightWingPivot.rotation.set(0, 0, -flap);
        leftLegPivot.rotation.x = 1.05;
        rightLegPivot.rotation.x = 1.05;
        tailPivot.rotation.x = 0.05;
        bodyPivot.position.y = 0.095;
        bodyPivot.rotation.x = 0;
        headPivot.rotation.set(0, 0, 0);

        if (phaseT >= 1) {
          state = 'cooldown';
          stateTimer = 14 + Math.random() * 11;
          birdRoot.visible = false;
        }
      }
    },
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
