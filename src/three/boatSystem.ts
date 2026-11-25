import * as THREE from 'three';
import { groundHeightAt } from './environment';
import type { ProceduralTextureSet } from './textures';
import { BOAT_CATALOG, LAKE_ANCHOR_SPOTS, type LakeSpotId } from '../types/fishing';

export interface BoatSystem {
  group: THREE.Group;
  boatRoot: THREE.Group;
  setBoatLevel: (level: number) => void;
  setTargetLocation: (spotId: LakeSpotId, immediate?: boolean) => void;
  sailToCoordinates: (x: number, z: number) => void;
  boardForFreeRoam: () => void;
  setSteerInput: (forward: number, turn: number) => void;
  getCurrentLocationId: () => LakeSpotId | 'free_roam';
  getBoatYaw: () => number;
  isSailing: () => boolean;
  isOnBoat: () => boolean;
  getBoatPosition: (out: THREE.Vector3) => THREE.Vector3;
  getPlayerRigOffset: (out: THREE.Vector3) => THREE.Vector3;
  getBoatPitchRoll: () => { pitch: number; roll: number };
  update: (params: {
    dt: number;
    elapsed: number;
    windSpeedKmh: number;
    nightFactor: number;
    coldSnowFactor: number;
    waterDepthAtBoat: number;
    getWaterSurfaceY: (x: number, z: number) => number;
    onRipple: (x: number, z: number, strength: number) => void;
    onSplash: (x: number, z: number, intensity: number) => void;
  }) => { arrivedSpotId: LakeSpotId | 'free_roam' | null };
  dispose: () => void;
}

function createSonarScreenTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#061a24';
  ctx.fillRect(0, 0, 256, 160);

  // Subtle depth grid
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
  ctx.lineWidth = 1;
  for (let y = 24; y < 160; y += 26) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  for (let x = 32; x < 256; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 160);
    ctx.stroke();
  }

  // Lakebed contour curve
  ctx.beginPath();
  ctx.moveTo(0, 118);
  for (let x = 0; x <= 256; x += 8) {
    const y = 114 + Math.sin(x * 0.04) * 14 + Math.cos(x * 0.09) * 6;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(256, 160);
  ctx.lineTo(0, 160);
  ctx.closePath();
  ctx.fillStyle = 'rgba(217, 119, 6, 0.45)';
  ctx.fill();
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Fish echo arches
  const echoes = [
    [68, 72, 16],
    [136, 88, 22],
    [192, 62, 14],
    [164, 96, 18],
  ];
  for (const [ex, ey, w] of echoes) {
    ctx.beginPath();
    ctx.moveTo(ex - w * 0.5, ey + 4);
    ctx.quadraticCurveTo(ex, ey - 7, ex + w * 0.5, ey + 4);
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.fillStyle = '#7dd3fc';
  ctx.font = 'bold 14px monospace';
  ctx.fillText('SONAR · DEEP', 10, 18);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function hullBeamHalfWidth(u: number): number {
  // u = 0 (bow z=-2.25) -> u = 1 (stern z=+1.75)
  if (u <= 0.02) return 0.05;
  const flare = Math.sin(Math.pow(u, 0.54) * Math.PI * 0.72);
  return 0.05 + flare * 0.79;
}

function hullTopY(u: number): number {
  return 0.44 - Math.sin(u * Math.PI * 0.88) * 0.11;
}

function hullKeelY(u: number): number {
  const bowRise = Math.exp(-u * 8.5) * 0.24;
  const sternRise = Math.pow(Math.max(0, u - 0.85) / 0.15, 2) * 0.05;
  return -0.30 + bowRise + sternRise;
}

/**
 * Builds a sleek hollow boat hull shell (outer skin + gunwale rim + inner cockpit wall)
 */
function buildHollowBoatHullGeometry(): THREE.BufferGeometry {
  const stations = 16;
  // Cross-section loop per station (9 points from port inner gunwale -> port inner bilge -> inner keel -> stbd inner bilge -> stbd inner gunwale -> stbd outer gunwale -> stbd outer bilge -> outer keel -> port outer bilge -> port outer gunwale)
  const ptsPerStation = 10;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= stations; i++) {
    const u = i / stations;
    const z = THREE.MathUtils.lerp(-2.25, 1.75, u);
    const hw = hullBeamHalfWidth(u);
    const ty = hullTopY(u);
    const ky = hullKeelY(u);
    const wall = 0.055;
    const ihw = Math.max(0.015, hw - wall);
    const iky = ky + wall * 0.85;
    const bilgeY = THREE.MathUtils.lerp(ky, ty, 0.34);
    const ibilgeY = bilgeY + wall * 0.55;

    const ring: [number, number][] = [
      [-ihw, ty], // 0: port inner gunwale
      [-ihw * 0.72, ibilgeY], // 1: port inner bilge
      [0, iky], // 2: inner keel
      [ihw * 0.72, ibilgeY], // 3: stbd inner bilge
      [ihw, ty], // 4: stbd inner gunwale
      [hw, ty], // 5: stbd outer gunwale
      [hw * 0.76, bilgeY], // 6: stbd outer bilge
      [0, ky], // 7: outer keel
      [-hw * 0.76, bilgeY], // 8: port outer bilge
      [-hw, ty], // 9: port outer gunwale
    ];

    for (let j = 0; j < ptsPerStation; j++) {
      positions.push(ring[j][0], ring[j][1], z);
      uvs.push(j / ptsPerStation, u * 2.5);
    }
  }

  for (let i = 0; i < stations; i++) {
    for (let j = 0; j < ptsPerStation; j++) {
      const nextJ = (j + 1) % ptsPerStation;
      const a = i * ptsPerStation + j;
      const b = (i + 1) * ptsPerStation + j;
      const c = (i + 1) * ptsPerStation + nextJ;
      const d = i * ptsPerStation + nextJ;
      indices.push(a, b, c, a, c, d);
    }
  }

  // Cap stern transom (i = stations)
  const sternBase = stations * ptsPerStation;
  indices.push(
    sternBase + 0, sternBase + 9, sternBase + 8,
    sternBase + 0, sternBase + 8, sternBase + 1,
    sternBase + 1, sternBase + 8, sternBase + 7,
    sternBase + 1, sternBase + 7, sternBase + 2,
    sternBase + 2, sternBase + 7, sternBase + 6,
    sternBase + 2, sternBase + 6, sternBase + 3,
    sternBase + 3, sternBase + 6, sternBase + 5,
    sternBase + 3, sternBase + 5, sternBase + 4,
  );

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function createBoatSystem(textures: ProceduralTextureSet): BoatSystem {
  const group = new THREE.Group();
  const boatRoot = new THREE.Group();
  group.add(boatRoot);

  const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

  // Shared & Tier-Swappable Materials
  const hullMat = new THREE.MeshStandardMaterial({
    map: textures.woodPlankMap,
    bumpMap: textures.woodBumpMap,
    bumpScale: 0.012,
    color: 0x8a603b,
    roughness: 0.78,
    metalness: 0.05,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x452d1a,
    roughness: 0.65,
    metalness: 0.08,
  });
  const deckWoodMat = new THREE.MeshStandardMaterial({
    map: textures.woodPlankMap,
    color: 0xa67c52,
    roughness: 0.84,
    metalness: 0.03,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xd1a74f,
    roughness: 0.25,
    metalness: 0.88,
  });
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xdce4eb,
    roughness: 0.2,
    metalness: 0.92,
  });
  const cushionMat = new THREE.MeshStandardMaterial({
    color: 0x85442b,
    roughness: 0.82,
    metalness: 0.02,
  });
  const motorBodyMat = new THREE.MeshStandardMaterial({
    color: 0x1e2832,
    roughness: 0.34,
    metalness: 0.62,
  });
  const ropeMat = new THREE.MeshStandardMaterial({
    color: 0xbda77e,
    roughness: 0.95,
  });
  const bowFlameMat = new THREE.MeshStandardMaterial({
    color: 0xffb85c,
    emissive: 0xff9429,
    emissiveIntensity: 0.3,
    roughness: 0.2,
  });
  const sonarTex = createSonarScreenTexture();
  const sonarScreenMat = new THREE.MeshStandardMaterial({
    map: sonarTex,
    emissive: 0x186b7a,
    emissiveMap: sonarTex,
    emissiveIntensity: 0.85,
    roughness: 0.2,
  });
  const frostUniform = { value: 0 };

  function attachFrostDusting(mat: THREE.MeshStandardMaterial, strength = 0.65): void {
    mat.customProgramCacheKey = () => `boat_frost_${strength.toFixed(2)}`;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uBoatFrost = frostUniform;
      shader.uniforms.uStrength = { value: strength };
      shader.vertexShader =
        `varying vec3 vBoatWorldNormal;\n` +
        shader.vertexShader.replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
           vBoatWorldNormal = normalize(mat3(modelMatrix) * normal);`,
        );
      shader.fragmentShader =
        `uniform float uBoatFrost;\nuniform float uStrength;\nvarying vec3 vBoatWorldNormal;\n` +
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           float topCatch = smoothstep(0.35, 0.9, vBoatWorldNormal.y);
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.91, 0.95, 0.99), topCatch * uBoatFrost * uStrength);`,
        );
    };
  }
  attachFrostDusting(trimMat, 0.62);
  attachFrostDusting(deckWoodMat, 0.55);

  disposables.push(
    hullMat,
    trimMat,
    deckWoodMat,
    brassMat,
    chromeMat,
    cushionMat,
    motorBodyMat,
    ropeMat,
    bowFlameMat,
    sonarTex,
    sonarScreenMat,
  );

  // 1. Sculpted Hollow Boat Hull
  const hullGeo = buildHollowBoatHullGeometry();
  const hullMesh = new THREE.Mesh(hullGeo, hullMat);
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  boatRoot.add(hullMesh);
  disposables.push(hullGeo);

  // Inner Floorboard Planks (sits at y = -0.16 so player boots at -0.14 rest flush)
  const floorShape = new THREE.Shape();
  floorShape.moveTo(0, -1.68);
  floorShape.quadraticCurveTo(0.45, -0.8, 0.50, 0.15);
  floorShape.quadraticCurveTo(0.48, 1.0, 0.40, 1.56);
  floorShape.lineTo(-0.40, 1.56);
  floorShape.quadraticCurveTo(-0.48, 1.0, -0.50, 0.15);
  floorShape.quadraticCurveTo(-0.45, -0.8, 0, -1.68);
  const floorGeo = new THREE.ExtrudeGeometry(floorShape, { depth: 0.035, bevelEnabled: false });
  floorGeo.rotateX(Math.PI / 2);
  floorGeo.translate(0, -0.15, 0);
  const floorMesh = new THREE.Mesh(floorGeo, deckWoodMat);
  floorMesh.receiveShadow = true;
  boatRoot.add(floorMesh);
  disposables.push(floorGeo);

  // Hull Ribs inside cockpit
  const ribGeo = new THREE.BoxGeometry(0.96, 0.035, 0.045);
  disposables.push(ribGeo);
  for (const rz of [-0.95, -0.35, 0.25, 0.85]) {
    const rib = new THREE.Mesh(ribGeo, trimMat);
    rib.position.set(0, -0.145, rz);
    rib.scale.x = rz < -0.5 ? 0.72 : 1.0;
    rib.receiveShadow = true;
    boatRoot.add(rib);
  }

  // Bow Stem Post & Foredeck Cap
  const stemGeo = new THREE.CylinderGeometry(0.035, 0.055, 0.45, 8);
  const foredeckShape = new THREE.Shape();
  foredeckShape.moveTo(0, -2.22);
  foredeckShape.lineTo(0.46, -1.35);
  foredeckShape.lineTo(-0.46, -1.35);
  foredeckShape.closePath();
  const foredeckGeo = new THREE.ExtrudeGeometry(foredeckShape, { depth: 0.045, bevelEnabled: false });
  foredeckGeo.rotateX(Math.PI / 2);
  foredeckGeo.translate(0, 0.37, 0);
  const cleatGeo = new THREE.BoxGeometry(0.14, 0.025, 0.032);
  const ropeCoilGeo = new THREE.TorusGeometry(0.09, 0.018, 6, 14);
  ropeCoilGeo.rotateX(Math.PI / 2);
  disposables.push(stemGeo, foredeckGeo, cleatGeo, ropeCoilGeo);

  const stemMesh = new THREE.Mesh(stemGeo, trimMat);
  stemMesh.position.set(0, 0.24, -2.23);
  stemMesh.rotation.x = 0.24;
  stemMesh.castShadow = true;
  const foredeck = new THREE.Mesh(foredeckGeo, trimMat);
  foredeck.castShadow = true;
  foredeck.receiveShadow = true;
  const bowCleat = new THREE.Mesh(cleatGeo, brassMat);
  bowCleat.position.set(0, 0.39, -1.85);
  const ropeCoil = new THREE.Mesh(ropeCoilGeo, ropeMat);
  ropeCoil.position.set(0.16, 0.38, -1.58);
  boatRoot.add(stemMesh, foredeck, bowCleat, ropeCoil);

  // Helm Bench (at z = +0.69, top surface y = 0.24) + Front Casting Thwart (z = -0.82)
  const benchGeo = new THREE.BoxGeometry(1.16, 0.06, 0.38);
  const benchPadGeo = new THREE.BoxGeometry(1.06, 0.045, 0.32);
  const frontThwartGeo = new THREE.BoxGeometry(1.04, 0.055, 0.38);
  disposables.push(benchGeo, benchPadGeo, frontThwartGeo);

  const sternBench = new THREE.Mesh(benchGeo, trimMat);
  sternBench.position.set(0, 0.21, 0.69);
  sternBench.castShadow = true;
  sternBench.receiveShadow = true;

  const sternCushion = new THREE.Mesh(benchPadGeo, cushionMat);
  sternCushion.position.set(0, 0.25, 0.69);
  sternCushion.castShadow = true;
  sternCushion.receiveShadow = true;
  sternCushion.visible = false; // Unlocked at Tier 3+

  const frontThwart = new THREE.Mesh(frontThwartGeo, trimMat);
  frontThwart.position.set(0, 0.20, -0.90);
  frontThwart.castShadow = true;
  frontThwart.receiveShadow = true;
  boatRoot.add(sternBench, sternCushion, frontThwart);

  // Tier 1-2: Wooden Oars + Brass Oarlocks
  const oarGroup = new THREE.Group();
  const oarShaftGeo = new THREE.CylinderGeometry(0.018, 0.02, 1.55, 8);
  oarShaftGeo.rotateX(Math.PI / 2);
  const oarBladeGeo = new THREE.BoxGeometry(0.12, 0.016, 0.44);
  const oarLockGeo = new THREE.TorusGeometry(0.028, 0.007, 6, 10);
  disposables.push(oarShaftGeo, oarBladeGeo, oarLockGeo);

  const oarPivots: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const lock = new THREE.Mesh(oarLockGeo, brassMat);
    lock.position.set(side * 0.76, 0.37, -0.05);
    boatRoot.add(lock);

    const oarPivot = new THREE.Group();
    oarPivot.position.set(side * 0.76, 0.37, -0.05);
    const shaft = new THREE.Mesh(oarShaftGeo, deckWoodMat);
    shaft.position.set(0, 0, 0.28);
    shaft.castShadow = true;
    const blade = new THREE.Mesh(oarBladeGeo, trimMat);
    blade.position.set(0, 0, 0.96);
    blade.castShadow = true;
    oarPivot.add(shaft, blade);
    oarPivot.rotation.set(0.06, side * 0.08, 0);
    oarGroup.add(oarPivot);
    oarPivots.push(oarPivot);
  }
  boatRoot.add(oarGroup);

  // Tier 2+: Brass Bow Lantern + Reinforced Bow Locker Hatch
  const bowLanternGroup = new THREE.Group();
  bowLanternGroup.position.set(0, 0.37, -1.68);
  const lPostGeo = new THREE.CylinderGeometry(0.022, 0.026, 0.24, 8);
  const lGlassGeo = new THREE.CylinderGeometry(0.052, 0.058, 0.12, 10);
  const lCapGeo = new THREE.ConeGeometry(0.075, 0.07, 10);
  const lGlassMat = new THREE.MeshPhysicalMaterial({ color: 0xffe9c7, transparent: true, opacity: 0.48, roughness: 0.1 });
  disposables.push(lPostGeo, lGlassGeo, lCapGeo, lGlassMat);
  const lPost = new THREE.Mesh(lPostGeo, brassMat);
  lPost.position.y = 0.12;
  const lGlass = new THREE.Mesh(lGlassGeo, lGlassMat);
  lGlass.position.y = 0.28;
  const lCap = new THREE.Mesh(lCapGeo, brassMat);
  lCap.position.y = 0.37;
  const lFlame = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 8), bowFlameMat);
  disposables.push(lFlame.geometry);
  lFlame.position.y = 0.27;
  const bowLight = new THREE.PointLight(0xffad52, 0, 12, 1.8);
  bowLight.position.set(0, 0.32, 0);
  bowLanternGroup.add(lPost, lGlass, lCap, lFlame, bowLight);
  boatRoot.add(bowLanternGroup);

  // Tier 3+: Outboard Motor(s) + Rod Holders
  const motorGroup = new THREE.Group();
  const mCowlingGeo = new THREE.BoxGeometry(0.24, 0.24, 0.34);
  const mShaftGeo = new THREE.CylinderGeometry(0.032, 0.026, 0.62, 8);
  const mPropHubGeo = new THREE.CylinderGeometry(0.035, 0.03, 0.08, 10);
  mPropHubGeo.rotateX(Math.PI / 2);
  const mBladeGeo = new THREE.BoxGeometry(0.16, 0.035, 0.012);
  const mTillerGeo = new THREE.CylinderGeometry(0.015, 0.018, 0.45, 8);
  mTillerGeo.rotateX(Math.PI / 2);
  disposables.push(mCowlingGeo, mShaftGeo, mPropHubGeo, mBladeGeo, mTillerGeo);

  const propellers: THREE.Group[] = [];
  function createOutboardUnit(xPos: number): THREE.Group {
    const unit = new THREE.Group();
    unit.position.set(xPos, 0.34, 1.80);
    const cowl = new THREE.Mesh(mCowlingGeo, motorBodyMat);
    cowl.position.set(0, 0.14, 0.04);
    cowl.castShadow = true;
    const shaft = new THREE.Mesh(mShaftGeo, chromeMat);
    shaft.position.set(0, -0.22, 0.06);
    const propPivot = new THREE.Group();
    propPivot.position.set(0, -0.50, 0.10);
    propPivot.add(new THREE.Mesh(mPropHubGeo, brassMat));
    for (let b = 0; b < 3; b++) {
      const blade = new THREE.Mesh(mBladeGeo, brassMat);
      blade.rotation.z = (b * Math.PI * 2) / 3;
      blade.rotation.y = 0.38;
      propPivot.add(blade);
    }
    propellers.push(propPivot);
    const tiller = new THREE.Mesh(mTillerGeo, motorBodyMat);
    tiller.position.set(-0.08, 0.16, -0.24);
    tiller.rotation.set(0.15, 0.2, 0);
    unit.add(cowl, shaft, propPivot, tiller);
    return unit;
  }

  const singleMotor = createOutboardUnit(0);
  const twinMotorLeft = createOutboardUnit(-0.24);
  const twinMotorRight = createOutboardUnit(0.24);
  motorGroup.add(singleMotor, twinMotorLeft, twinMotorRight);

  // Gunwale Rod Holders (Tier 3+)
  const holderGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.22, 8);
  for (const side of [-1, 1]) {
    const holder = new THREE.Mesh(holderGeo, chromeMat);
    holder.position.set(side * 0.64, 0.36, 0.95);
    holder.rotation.set(-0.35, 0, side * -0.22);
    motorGroup.add(holder);
  }
  disposables.push(holderGeo);
  boatRoot.add(motorGroup);

  // Tier 4: Expedition Pulpit Rails, Sonar Console, Stern Radar Arch & Searchlight
  const expeditionGroup = new THREE.Group();
  const railCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.56, 0.40, -1.15),
    new THREE.Vector3(-0.36, 0.56, -1.75),
    new THREE.Vector3(0, 0.60, -2.22),
    new THREE.Vector3(0.36, 0.56, -1.75),
    new THREE.Vector3(0.56, 0.40, -1.15),
  ]);
  const pulpitGeo = new THREE.TubeGeometry(railCurve, 24, 0.016, 8, false);
  const stanchionGeo = new THREE.CylinderGeometry(0.013, 0.013, 0.20, 8);
  disposables.push(pulpitGeo, stanchionGeo);

  const pulpitRail = new THREE.Mesh(pulpitGeo, chromeMat);
  pulpitRail.castShadow = true;
  expeditionGroup.add(pulpitRail);
  for (const [sx, sz] of [[-0.56, -1.15], [-0.36, -1.75], [0, -2.22], [0.36, -1.75], [0.56, -1.15]]) {
    const st = new THREE.Mesh(stanchionGeo, chromeMat);
    st.position.set(sx, 0.44, sz);
    expeditionGroup.add(st);
  }

  // Sonar / Fishfinder Console on Port Side near Front Thwart (visible when seated!)
  const consoleGroup = new THREE.Group();
  consoleGroup.position.set(-0.42, 0.28, -0.78);
  consoleGroup.rotation.y = 0.28;
  const cMountGeo = new THREE.CylinderGeometry(0.025, 0.032, 0.16, 8);
  const cBodyGeo = new THREE.BoxGeometry(0.24, 0.16, 0.05);
  const cScreenGeo = new THREE.PlaneGeometry(0.20, 0.125);
  disposables.push(cMountGeo, cBodyGeo, cScreenGeo);
  const cMount = new THREE.Mesh(cMountGeo, motorBodyMat);
  cMount.position.y = 0.06;
  const cBody = new THREE.Mesh(cBodyGeo, motorBodyMat);
  cBody.position.y = 0.16;
  cBody.rotation.x = -0.35;
  const cScreen = new THREE.Mesh(cScreenGeo, sonarScreenMat);
  cScreen.position.set(0, 0.16, 0.027);
  cScreen.rotation.x = -0.35;
  consoleGroup.add(cMount, cBody, cScreen);
  expeditionGroup.add(consoleGroup);

  // Stern Arch behind captain
  const archCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.62, 0.34, 1.38),
    new THREE.Vector3(-0.56, 1.35, 1.48),
    new THREE.Vector3(0, 1.52, 1.50),
    new THREE.Vector3(0.56, 1.35, 1.48),
    new THREE.Vector3(0.62, 0.34, 1.38),
  ]);
  const archGeo = new THREE.TubeGeometry(archCurve, 22, 0.024, 8, false);
  disposables.push(archGeo);
  const archMesh = new THREE.Mesh(archGeo, chromeMat);
  archMesh.castShadow = true;
  expeditionGroup.add(archMesh);

  // Bow Marine Searchlight
  const searchHousingGeo = new THREE.CylinderGeometry(0.06, 0.045, 0.11, 10);
  searchHousingGeo.rotateX(Math.PI / 2);
  disposables.push(searchHousingGeo);
  const searchMesh = new THREE.Mesh(searchHousingGeo, chromeMat);
  searchMesh.position.set(0, 0.62, -2.18);
  const searchLight = new THREE.SpotLight(0xdff4ff, 0, 28, Math.PI * 0.22, 0.45, 1.4);
  searchLight.position.set(0, 0.62, -2.22);
  searchLight.target.position.set(0, -0.4, -14.0);
  expeditionGroup.add(searchMesh, searchLight, searchLight.target);
  boatRoot.add(expeditionGroup);

  // Mooring Rope connecting moored boat beside pier (-2.55, 0.35, -1.8) to front pier piling (-1.18, 1.0, -0.35)
  const ropePoints = 8;
  const mooringPositions = new Float32Array(ropePoints * 3);
  const mooringGeo = new THREE.BufferGeometry();
  mooringGeo.setAttribute('position', new THREE.BufferAttribute(mooringPositions, 3));
  const mooringLineMat = new THREE.LineBasicMaterial({ color: 0xbda77e });
  const mooringLine = new THREE.Line(mooringGeo, mooringLineMat);
  mooringLine.frustumCulled = false;
  group.add(mooringLine);
  disposables.push(mooringGeo, mooringLineMat);

  // State
  let currentBoatLevel = 1;
  let currentLocationId: LakeSpotId | 'free_roam' = 'pier';
  let targetLocationId: LakeSpotId | 'free_roam' = 'pier';
  let onBoat = false;
  let sailing = false;
  let arrivedSpotPending: LakeSpotId | 'free_roam' | null = null;

  const mooringPos = new THREE.Vector3(-2.65, 0, -1.35);
  const boatPos = new THREE.Vector3(mooringPos.x, 0, mooringPos.z);
  const targetPos = new THREE.Vector3(mooringPos.x, 0, mooringPos.z);
  let boatYaw = 0.18;
  let boatPitch = 0;
  let boatRoll = 0;
  let wakeTimer = 0;
  let steerForward = 0;
  let steerTurn = 0;
  let currentSpeed = 0;

  const tmpRopeA = new THREE.Vector3();
  const tmpRopeB = new THREE.Vector3(-1.18, 1.02, -0.35);
  const tmpRopePt = new THREE.Vector3();

  function canBoatOccupy(px: number, pz: number): boolean {
    if (Math.abs(px) < 2.15 && pz > -1.4) return false;
    return groundHeightAt(px, pz) < -0.58;
  }

  function applyBoatTierVisuals(level: number): void {
    currentBoatLevel = THREE.MathUtils.clamp(level, 1, 4);

    if (currentBoatLevel === 1) {
      hullMat.color.setHex(0x8a603b);
      hullMat.roughness = 0.80;
      trimMat.color.setHex(0x452d1a);
    } else if (currentBoatLevel === 2) {
      hullMat.color.setHex(0x6b2f1d);
      hullMat.roughness = 0.56;
      trimMat.color.setHex(0xc89e48);
    } else if (currentBoatLevel === 3) {
      hullMat.color.setHex(0x234461);
      hullMat.roughness = 0.38;
      trimMat.color.setHex(0xdbd2be);
    } else {
      hullMat.color.setHex(0x1a3e38);
      hullMat.roughness = 0.30;
      trimMat.color.setHex(0xc79c4c);
    }

    oarGroup.visible = currentBoatLevel <= 2;
    bowLanternGroup.visible = currentBoatLevel >= 2;
    sternCushion.visible = currentBoatLevel >= 3;
    motorGroup.visible = currentBoatLevel >= 3;
    singleMotor.visible = currentBoatLevel === 3;
    twinMotorLeft.visible = currentBoatLevel === 4;
    twinMotorRight.visible = currentBoatLevel === 4;
    expeditionGroup.visible = currentBoatLevel >= 4;
  }

  applyBoatTierVisuals(1);

  return {
    group,
    boatRoot,
    setBoatLevel: (level) => {
      applyBoatTierVisuals(level);
    },
    setTargetLocation: (spotId, immediate = false) => {
      targetLocationId = spotId;
      currentSpeed = 0;
      if (spotId === 'pier') {
        targetPos.copy(mooringPos);
        if (immediate) {
          onBoat = false;
        }
      } else {
        const spot = LAKE_ANCHOR_SPOTS.find((s) => s.id === spotId) ?? LAKE_ANCHOR_SPOTS[1];
        targetPos.set(spot.x, 0, spot.z);
        onBoat = true;
      }

      if (immediate) {
        boatPos.copy(targetPos);
        currentLocationId = spotId;
        sailing = false;
        boatYaw = spotId === 'pier' ? 0.18 : 0;
      } else {
        sailing = true;
      }
    },
    sailToCoordinates: (x, z) => {
      targetLocationId = 'free_roam';
      currentSpeed = 0;
      onBoat = true;
      targetPos.set(x, 0, z);
      sailing = true;
    },
    boardForFreeRoam: () => {
      if (!onBoat) {
        onBoat = true;
        currentLocationId = 'free_roam';
        targetLocationId = 'free_roam';
        sailing = false;
        if (boatPos.z > -3.5) {
          boatPos.set(-3.2, boatPos.y, -4.5);
          boatYaw = 0.08;
        }
      }
    },
    setSteerInput: (forward, turn) => {
      steerForward = THREE.MathUtils.clamp(forward, -1, 1);
      steerTurn = THREE.MathUtils.clamp(turn, -1, 1);
    },
    getCurrentLocationId: () => currentLocationId,
    getBoatYaw: () => boatYaw,
    isSailing: () => sailing,
    isOnBoat: () => onBoat || sailing,
    getBoatPosition: (out) => out.copy(boatPos),
    getPlayerRigOffset: (out) => {
      // Aligns rigSeatPivot (at z=2.30) onto rotated boat stern bench (+0.69 behind boatPos)
      const sternWorldX = boatPos.x + Math.sin(boatYaw) * 0.69;
      const sternWorldZ = boatPos.z + Math.cos(boatYaw) * 0.69;
      return out.set(sternWorldX, boatPos.y - 0.91, sternWorldZ - 2.30);
    },
    getBoatPitchRoll: () => ({ pitch: boatPitch, roll: boatRoll }),
    update: ({
      dt,
      elapsed,
      windSpeedKmh,
      nightFactor,
      coldSnowFactor,
      getWaterSurfaceY,
      onRipple,
      onSplash,
    }) => {
      frostUniform.value = THREE.MathUtils.lerp(frostUniform.value, THREE.MathUtils.clamp(coldSnowFactor, 0, 1), 0.04);

      const tierDef = BOAT_CATALOG.find((b) => b.level === currentBoatLevel) ?? BOAT_CATALOG[0];
      let arrivedSpotId: LakeSpotId | 'free_roam' | null = null;

      // Manual steering cancels auto-pilot cleanly and enables free roam
      const hasManualSteer = Math.abs(steerForward) > 0.05 || Math.abs(steerTurn) > 0.05;
      if (hasManualSteer && onBoat) {
        sailing = false;
        currentLocationId = 'free_roam';
      }

      if (sailing) {
        const dx = targetPos.x - boatPos.x;
        const dz = targetPos.z - boatPos.z;
        const dist = Math.hypot(dx, dz);

        if (dist < 0.25) {
          boatPos.x = targetPos.x;
          boatPos.z = targetPos.z;
          sailing = false;
          currentLocationId = targetLocationId;
          onBoat = targetLocationId !== 'pier';
          arrivedSpotId = targetLocationId;
          onRipple(boatPos.x, boatPos.z, 1.0);
        } else {
          const step = Math.min(dist, tierDef.speedMps * dt);
          boatPos.x += (dx / dist) * step;
          boatPos.z += (dz / dist) * step;

          // Turn smoothly toward travel direction (or face shore slightly when docking at pier)
          const travelHeading =
            targetLocationId === 'pier' && dist < 5.0
              ? 0.18
              : Math.atan2(-dx, -dz);
          const yawDiff = Math.atan2(Math.sin(travelHeading - boatYaw), Math.cos(travelHeading - boatYaw));
          boatYaw += yawDiff * Math.min(1, dt * 3.8);

          wakeTimer -= dt;
          if (wakeTimer <= 0) {
            wakeTimer = 0.18;
            onRipple(boatPos.x + Math.sin(boatYaw) * 1.5, boatPos.z + Math.cos(boatYaw) * 1.5, 0.85);
            if (currentBoatLevel >= 3) {
              onSplash(boatPos.x + Math.sin(boatYaw) * 1.85, boatPos.z + Math.cos(boatYaw) * 1.85, 0.45);
            }
          }
        }
      } else if (onBoat) {
        // Free-roaming helm physics & shoreline sliding
        if (Math.abs(steerTurn) > 0.05) {
          boatYaw += steerTurn * 1.32 * dt;
        }
        const desiredSpeed = steerForward * tierDef.speedMps * (steerForward < 0 ? 0.55 : 1.0);
        currentSpeed = THREE.MathUtils.damp(currentSpeed, desiredSpeed, 4.2, dt);

        if (Math.abs(currentSpeed) > 0.03) {
          const moveX = -Math.sin(boatYaw) * currentSpeed * dt;
          const moveZ = -Math.cos(boatYaw) * currentSpeed * dt;
          const nx = boatPos.x + moveX;
          const nz = boatPos.z + moveZ;

          if (canBoatOccupy(nx, nz)) {
            boatPos.x = nx;
            boatPos.z = nz;
          } else if (canBoatOccupy(nx, boatPos.z)) {
            boatPos.x = nx;
            currentSpeed *= 0.65;
          } else if (canBoatOccupy(boatPos.x, nz)) {
            boatPos.z = nz;
            currentSpeed *= 0.65;
          } else {
            currentSpeed = 0;
          }

          if (Math.abs(currentSpeed) > 0.4) {
            wakeTimer -= dt;
            if (wakeTimer <= 0) {
              wakeTimer = 0.2;
              onRipple(boatPos.x + Math.sin(boatYaw) * 1.45, boatPos.z + Math.cos(boatYaw) * 1.45, 0.78);
              if (currentBoatLevel >= 3) {
                onSplash(boatPos.x + Math.sin(boatYaw) * 1.8, boatPos.z + Math.cos(boatYaw) * 1.8, 0.38);
              }
            }
          }
        }
      } else {
        const desiredYaw = 0.18 + Math.sin(elapsed * 0.45) * 0.03;
        const yawDiff = Math.atan2(Math.sin(desiredYaw - boatYaw), Math.cos(desiredYaw - boatYaw));
        boatYaw += yawDiff * Math.min(1, dt * 3.0);
      }

      const isMoving = sailing || Math.abs(currentSpeed) > 0.28 || Math.abs(steerTurn) > 0.1;

      // Multi-point Buoyancy from live water waves
      const hCenter = getWaterSurfaceY(boatPos.x, boatPos.z);
      const hBow = getWaterSurfaceY(boatPos.x - Math.sin(boatYaw) * 1.4, boatPos.z - Math.cos(boatYaw) * 1.4);
      const hStern = getWaterSurfaceY(boatPos.x + Math.sin(boatYaw) * 1.4, boatPos.z + Math.cos(boatYaw) * 1.4);
      const hPort = getWaterSurfaceY(boatPos.x - Math.cos(boatYaw) * 0.65, boatPos.z + Math.sin(boatYaw) * 0.65);
      const hStbd = getWaterSurfaceY(boatPos.x + Math.cos(boatYaw) * 0.65, boatPos.z - Math.sin(boatYaw) * 0.65);

      const targetY = (hCenter + hBow + hStern) / 3 + (isMoving ? 0.035 : 0);
      const waveAmpExtra = THREE.MathUtils.clamp(windSpeedKmh / 35, 0, 1) * 0.025;
      const targetPitch =
        Math.atan2(hBow - hStern, 2.8) +
        (isMoving ? 0.035 : 0) +
        Math.sin(elapsed * 1.6) * waveAmpExtra;
      const targetRoll =
        Math.atan2(hPort - hStbd, 1.3) +
        steerTurn * 0.045 +
        Math.cos(elapsed * 1.3) * waveAmpExtra;

      boatPos.y = THREE.MathUtils.damp(boatPos.y, targetY, 8.0, dt);
      boatPitch = THREE.MathUtils.damp(boatPitch, targetPitch, 7.0, dt);
      boatRoll = THREE.MathUtils.damp(boatRoll, targetRoll, 7.0, dt);

      boatRoot.position.copy(boatPos);
      boatRoot.rotation.set(boatPitch, boatYaw, boatRoll);

      // Animate oars or outboard propellers when moving
      if (currentBoatLevel <= 2) {
        const rowCycle = isMoving ? elapsed * 5.2 : 0;
        oarPivots.forEach((p, idx) => {
          const side = idx === 0 ? -1 : 1;
          if (isMoving) {
            p.rotation.y = side * (0.25 + Math.sin(rowCycle) * 0.42);
            p.rotation.x = 0.08 + Math.cos(rowCycle) * 0.16;
          } else {
            p.rotation.y = THREE.MathUtils.damp(p.rotation.y, side * 0.08, 6, dt);
            p.rotation.x = THREE.MathUtils.damp(p.rotation.x, 0.06, 6, dt);
          }
        });
      } else {
        const spinRate = isMoving ? 22.0 : 0.0;
        for (const prop of propellers) {
          prop.rotation.z += spinRate * dt;
        }
      }

      // Bow Lantern & Expedition Searchlight at dusk/night
      const activeAtNight = onBoat || sailing;
      bowLight.intensity = bowLanternGroup.visible
        ? THREE.MathUtils.lerp(0.1, activeAtNight ? 2.4 : 1.2, nightFactor)
        : 0;
      bowFlameMat.emissiveIntensity = THREE.MathUtils.lerp(0.25, 2.4, nightFactor);
      searchLight.intensity =
        currentBoatLevel >= 4 && activeAtNight ? THREE.MathUtils.lerp(0.2, 4.5, nightFactor) : 0;

      // Mooring Rope when docked beside pier
      const showRope = !onBoat && !sailing;
      mooringLine.visible = showRope;
      if (showRope) {
        tmpRopeA.set(boatPos.x + 0.02, boatPos.y + 0.39, boatPos.z - 1.85);
        for (let i = 0; i < ropePoints; i++) {
          const t = i / (ropePoints - 1);
          tmpRopePt.lerpVectors(tmpRopeA, tmpRopeB, t);
          tmpRopePt.y -= Math.sin(t * Math.PI) * 0.24;
          mooringPositions[i * 3] = tmpRopePt.x;
          mooringPositions[i * 3 + 1] = tmpRopePt.y;
          mooringPositions[i * 3 + 2] = tmpRopePt.z;
        }
        mooringGeo.attributes.position.needsUpdate = true;
      }

      if (arrivedSpotPending) {
        arrivedSpotId = arrivedSpotPending;
        arrivedSpotPending = null;
      }
      return { arrivedSpotId };
    },
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
