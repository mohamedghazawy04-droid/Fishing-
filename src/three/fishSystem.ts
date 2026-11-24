import * as THREE from 'three';
import {
  BAIT_CATALOG,
  FISH_SPECIES,
  HOOK_CATALOG,
  SEASON_CATALOG,
  classifyLakeZone,
  type BaitId,
  type FishSpecies,
  type HookId,
  type LakeZoneId,
  type SeasonId,
  type TimePresetId,
  type WeatherType,
} from '../types/fishing';
import { groundHeightAt } from './environment';

export type FishAIState = 'patrol' | 'curious' | 'nibbling' | 'biting' | 'hooked' | 'spooked';

export interface ActiveFish {
  id: number;
  species: FishSpecies;
  mesh: THREE.Group;
  tailPivot: THREE.Group;
  bodyMat: THREE.MeshStandardMaterial;
  lengthScale: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  heading: number;
  targetPos: THREE.Vector3;
  aiState: FishAIState;
  stateTimer: number;
  nibbleCount: number;
  maxNibbles: number;
  pauseTimer: number;
  schoolCenter: THREE.Vector2;
  swimPhase: number;
  stamina: number;
  surgeTimer: number;
  surgeDir: number;
}

export interface FishSystemUpdateInput {
  dt: number;
  elapsed: number;
  lurePos: THREE.Vector3 | null;
  lureInWater: boolean;
  baitId: BaitId;
  hookId: HookId;
  weather: WeatherType;
  season: SeasonId;
  timePreset: TimePresetId;
  anglerSenseLevel: number;
  rareAttractionBonus?: number;
  isReelingPhase: boolean;
  onNibble: (x: number, z: number) => void;
  onBiteStart: (fish: ActiveFish) => void;
  onBiteExpired: () => void;
}

export interface FishSystem {
  group: THREE.Group;
  fishes: ActiveFish[];
  getHookedFish: () => ActiveFish | null;
  getBitingFish: () => ActiveFish | null;
  hookBitingFish: () => ActiveFish | null;
  releaseHookedFish: () => void;
  consumeHookedFish: () => void;
  spookNear: (x: number, z: number, radius: number) => void;
  update: (input: FishSystemUpdateInput) => void;
  dispose: () => void;
}

function getZoneTargetCenter(zone: LakeZoneId): { x: number; z: number; spreadX: number; spreadZ: number } {
  switch (zone) {
    case 'dock_shade':
      return { x: 0, z: -7.5, spreadX: 9.5, spreadZ: 5.5 };
    case 'shore_reeds':
      return { x: Math.random() < 0.5 ? -46 : 46, z: -36, spreadX: 14, spreadZ: 22 };
    case 'rocky_ledge':
      return { x: (Math.random() - 0.5) * 52, z: -24, spreadX: 16, spreadZ: 12 };
    case 'deep_basin':
      return { x: (Math.random() - 0.5) * 56, z: -42, spreadX: 20, spreadZ: 15 };
    case 'alpine_abyss':
      return { x: (Math.random() - 0.5) * 44, z: -58, spreadX: 18, spreadZ: 14 };
  }
}

function hexToRgbStr(hex: number, alpha = 1): string {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Generates an organic scale & species-markings CanvasTexture for LatheGeometry UV mapping.
 * In our rotated LatheGeometry: U wraps around circumference (top/side/belly), V runs tail -> nose.
 */
function createSpeciesScaleTexture(species: FishSpecies): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Lathe circumference gradient: dorsal top -> lateral flank -> pale belly -> lateral flank -> dorsal top
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  const topCol = hexToRgbStr(species.bodyColor, 1);
  const bellyCol = hexToRgbStr(species.bellyColor, 1);
  grad.addColorStop(0.0, topCol);
  grad.addColorStop(0.24, topCol);
  grad.addColorStop(0.45, bellyCol);
  grad.addColorStop(0.55, bellyCol);
  grad.addColorStop(0.76, topCol);
  grad.addColorStop(1.0, topCol);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  // Overlapping fish scales diamond mesh
  ctx.strokeStyle = 'rgba(20, 30, 32, 0.16)';
  ctx.lineWidth = 1;
  const stepX = 14;
  const stepY = 12;
  for (let row = 0; row < 256 / stepY + 2; row++) {
    const y = row * stepY;
    const offset = (row % 2) * (stepX * 0.5);
    for (let col = -1; col < 512 / stepX + 2; col++) {
      const x = col * stepX + offset;
      ctx.beginPath();
      ctx.arc(x, y, stepX * 0.52, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
  }

  // Species-specific markings
  if (species.id === 'rainbow_trout') {
    // Rosy rainbow stripe along both flanks + dark dorsal speckles
    ctx.fillStyle = 'rgba(225, 112, 138, 0.55)';
    ctx.fillRect(105, 35, 36, 175);
    ctx.fillRect(370, 35, 36, 175);
    ctx.fillStyle = 'rgba(22, 34, 30, 0.55)';
    for (let i = 0; i < 95; i++) {
      const sx = Math.random() < 0.5 ? Math.random() * 145 : 365 + Math.random() * 145;
      const sy = 24 + Math.random() * 200;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.5 + Math.random() * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (species.id === 'lake_perch') {
    // Bold dark tiger vertical stripes
    ctx.fillStyle = 'rgba(24, 34, 18, 0.58)';
    for (let bar = 0; bar < 7; bar++) {
      const y = 45 + bar * 26;
      ctx.fillRect(0, y, 165, 9);
      ctx.fillRect(347, y, 165, 9);
    }
  } else if (species.id === 'northern_pike') {
    // Pale oval camo spots on olive flank
    ctx.fillStyle = 'rgba(218, 232, 198, 0.45)';
    for (let i = 0; i < 60; i++) {
      const sx = Math.random() < 0.5 ? 25 + Math.random() * 135 : 350 + Math.random() * 135;
      const sy = 30 + Math.random() * 195;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 3.2, 5.5, 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (species.id === 'golden_carp') {
    // Warm amber scale edge sheen
    ctx.strokeStyle = 'rgba(255, 232, 145, 0.45)';
    ctx.lineWidth = 1.4;
    for (let row = 3; row < 19; row++) {
      const y = row * stepY;
      for (let col = 0; col < 38; col++) {
        const x = col * stepX + (row % 2) * 7;
        ctx.beginPath();
        ctx.arc(x, y, 6.2, 0.2 * Math.PI, 0.8 * Math.PI);
        ctx.stroke();
      }
    }
  } else if (species.id === 'moonlight_salmon') {
    // Iridescent silver-blue speckles
    ctx.fillStyle = 'rgba(210, 238, 255, 0.55)';
    for (let i = 0; i < 70; i++) {
      const sx = Math.random() < 0.5 ? 15 + Math.random() * 150 : 345 + Math.random() * 150;
      const sy = 35 + Math.random() * 185;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (species.id === 'alpine_sturgeon') {
    // Armored bony scutes ridge rows along back and flanks
    ctx.fillStyle = 'rgba(218, 198, 130, 0.65)';
    for (let row = 0; row < 12; row++) {
      const y = 30 + row * 17;
      ctx.beginPath();
      ctx.moveTo(96, y);
      ctx.lineTo(114, y + 6);
      ctx.lineTo(96, y + 12);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(416, y);
      ctx.lineTo(398, y + 6);
      ctx.lineTo(416, y + 12);
      ctx.fill();
    }
  } else if (species.id === 'abyssal_catfish') {
    // Mottled slate deep-water camouflage
    ctx.fillStyle = 'rgba(18, 26, 34, 0.52)';
    for (let i = 0; i < 48; i++) {
      const sx = Math.random() < 0.5 ? 20 + Math.random() * 145 : 345 + Math.random() * 145;
      const sy = 25 + Math.random() * 205;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 8, 5, Math.random(), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (species.id === 'glacial_taimen') {
    // Crimson tail-flank sheen & dark crescent speckles
    ctx.fillStyle = 'rgba(196, 74, 62, 0.45)';
    ctx.fillRect(85, 18, 52, 95);
    ctx.fillRect(375, 18, 52, 95);
    ctx.fillStyle = 'rgba(20, 26, 34, 0.6)';
    for (let i = 0; i < 75; i++) {
      const sx = Math.random() < 0.5 ? 20 + Math.random() * 140 : 350 + Math.random() * 140;
      const sy = 30 + Math.random() * 190;
      ctx.beginPath();
      ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Gill plate (operculum) curved seam near head (v ~ 0.72)
  ctx.strokeStyle = 'rgba(20, 24, 28, 0.52)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(135, 182, 28, -0.5, 1.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(377, 182, 28, Math.PI - 1.1, Math.PI + 0.5);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function applySubmergedFishShader(mat: THREE.MeshStandardMaterial, withSwim: boolean): void {
  mat.transparent = true;
  mat.customProgramCacheKey = () => (withSwim ? 'fish_body_submerged_swim_v1' : 'fish_part_submerged_v1');
  mat.onBeforeCompile = (shader) => {
    if (withSwim) {
      shader.uniforms.uSwimPhase = { value: 0 };
      shader.uniforms.uSwimAmp = { value: 0.045 };
      mat.userData.shader = shader;
    }

    let vs = shader.vertexShader;
    if (withSwim) {
      vs = `uniform float uSwimPhase;\nuniform float uSwimAmp;\n` + vs;
      vs = vs.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float tailFactor = smoothstep(0.24, -0.48, position.z);
         transformed.x += sin(uSwimPhase - position.z * 6.5) * uSwimAmp * tailFactor;`,
      );
    }
    vs = `varying float vFishWorldY;\n` + vs.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
       vFishWorldY = (modelMatrix * vec4(transformed, 1.0)).y;`,
    );
    shader.vertexShader = vs;

    shader.fragmentShader =
      `varying float vFishWorldY;\n` +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float submergedMask = smoothstep(-0.04, -0.18, vFishWorldY);
         float depthHaze = smoothstep(-0.12, -2.55, vFishWorldY);
         vec3 waterTint = vec3(0.08, 0.29, 0.36);
         diffuseColor.rgb = mix(diffuseColor.rgb, waterTint, submergedMask * (0.36 + depthHaze * 0.42));
         diffuseColor.a *= mix(1.0, mix(0.74, 0.28, depthHaze), submergedMask);`,
      );
  };
}

function buildProceduralFishMesh(
  species: FishSpecies,
  lengthScale: number,
  scaleTex: THREE.CanvasTexture,
  sharedGeos: THREE.BufferGeometry[],
  sharedMats: THREE.Material[],
): { root: THREE.Group; tailPivot: THREE.Group; bodyMat: THREE.MeshStandardMaterial } {
  const root = new THREE.Group();

  // Streamlined anatomical fish profile (tail at -0.48 -> nose at +0.48)
  const bodyProfile = [
    new THREE.Vector2(0.0, -0.48),
    new THREE.Vector2(0.036, -0.42),
    new THREE.Vector2(0.056, -0.32),
    new THREE.Vector2(0.095, -0.18),
    new THREE.Vector2(0.132, -0.02),
    new THREE.Vector2(0.136, 0.14),
    new THREE.Vector2(0.118, 0.28),
    new THREE.Vector2(0.082, 0.39),
    new THREE.Vector2(0.038, 0.455),
    new THREE.Vector2(0.0, 0.48),
  ];
  const bodyGeo = new THREE.LatheGeometry(bodyProfile, 20);
  bodyGeo.rotateX(Math.PI / 2);
  bodyGeo.scale(0.62, 1.0, 1.0);
  sharedGeos.push(bodyGeo);

  const bodyMat = new THREE.MeshStandardMaterial({
    map: scaleTex,
    roughness: 0.22,
    metalness: 0.32,
  });
  applySubmergedFishShader(bodyMat, true);
  sharedMats.push(bodyMat);

  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.castShadow = true;
  bodyMesh.renderOrder = 1;
  root.add(bodyMesh);

  const finMat = new THREE.MeshStandardMaterial({
    color: species.finColor,
    roughness: 0.5,
    transparent: true,
    opacity: 0.86,
    side: THREE.DoubleSide,
  });
  applySubmergedFishShader(finMat, false);
  sharedMats.push(finMat);

  // Dorsal Fin
  const dorsalShape = new THREE.Shape();
  dorsalShape.moveTo(0, 0);
  dorsalShape.lineTo(-0.04, 0.14);
  dorsalShape.lineTo(-0.23, 0.11);
  dorsalShape.lineTo(-0.27, 0.01);
  dorsalShape.lineTo(0, 0);
  const dorsalGeo = new THREE.ExtrudeGeometry(dorsalShape, { depth: 0.008, bevelEnabled: false });
  dorsalGeo.rotateY(Math.PI / 2);
  dorsalGeo.translate(-0.004, 0.105, 0.08);
  sharedGeos.push(dorsalGeo);
  root.add(new THREE.Mesh(dorsalGeo, finMat));

  // Adipose & Anal Fins
  const analShape = new THREE.Shape();
  analShape.moveTo(0, 0);
  analShape.lineTo(-0.04, -0.09);
  analShape.lineTo(-0.14, -0.06);
  analShape.lineTo(-0.16, 0);
  const analGeo = new THREE.ExtrudeGeometry(analShape, { depth: 0.007, bevelEnabled: false });
  analGeo.rotateY(Math.PI / 2);
  analGeo.translate(-0.0035, -0.082, -0.15);
  sharedGeos.push(analGeo);
  root.add(new THREE.Mesh(analGeo, finMat));

  // Pectoral & Pelvic Fins
  const pecGeo = new THREE.PlaneGeometry(0.15, 0.09);
  sharedGeos.push(pecGeo);
  for (const side of [-1, 1]) {
    const pec = new THREE.Mesh(pecGeo, finMat);
    pec.position.set(side * 0.078, -0.032, 0.18);
    pec.rotation.set(0.32, side * -0.58, side * -0.35);
    const pelv = new THREE.Mesh(pecGeo, finMat);
    pelv.scale.setScalar(0.68);
    pelv.position.set(side * 0.048, -0.09, -0.04);
    pelv.rotation.set(0.4, side * -0.35, side * -0.55);
    root.add(pec, pelv);
  }

  // Forked Caudal Tail Fin pivoted cleanly at tail peduncle
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0, -0.45);
  const tailShape = new THREE.Shape();
  tailShape.moveTo(0, 0.02);
  tailShape.lineTo(-0.24, 0.19);
  tailShape.lineTo(-0.16, 0.01);
  tailShape.lineTo(-0.16, -0.01);
  tailShape.lineTo(-0.24, -0.19);
  tailShape.lineTo(0, -0.02);
  tailShape.closePath();
  const tailGeo = new THREE.ExtrudeGeometry(tailShape, { depth: 0.008, bevelEnabled: false });
  tailGeo.rotateY(Math.PI / 2);
  tailGeo.translate(-0.004, 0, 0);
  sharedGeos.push(tailGeo);
  tailPivot.add(new THREE.Mesh(tailGeo, finMat));
  root.add(tailPivot);

  // Realistic multi-layered eyes (golden/silver iris + glossy pupil)
  const irisGeo = new THREE.SphereGeometry(0.026, 10, 10);
  const pupilGeo = new THREE.SphereGeometry(0.016, 8, 8);
  sharedGeos.push(irisGeo, pupilGeo);
  const irisMat = new THREE.MeshStandardMaterial({ color: 0xd9b86c, roughness: 0.2, metalness: 0.35 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x0b0e11, roughness: 0.05, metalness: 0.4 });
  applySubmergedFishShader(irisMat, false);
  applySubmergedFishShader(pupilMat, false);
  sharedMats.push(irisMat, pupilMat);
  for (const side of [-1, 1]) {
    const iris = new THREE.Mesh(irisGeo, irisMat);
    iris.position.set(side * 0.044, 0.036, 0.34);
    iris.scale.set(0.65, 1, 1);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(side * 0.052, 0.036, 0.344);
    pupil.scale.set(0.65, 1, 1);
    root.add(iris, pupil);
  }

  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.renderOrder = 1;
    }
  });
  root.scale.setScalar(lengthScale);
  return { root, tailPivot, bodyMat };
}

export function createFishSystem(): FishSystem {
  const group = new THREE.Group();
  const fishes: ActiveFish[] = [];
  const sharedGeos: THREE.BufferGeometry[] = [];
  const sharedMats: THREE.Material[] = [];
  const speciesTextures = new Map<string, THREE.CanvasTexture>();

  for (const sp of FISH_SPECIES) {
    speciesTextures.set(sp.id, createSpeciesScaleTexture(sp));
  }

  const spawnPlan: FishSpecies[] = [
    FISH_SPECIES[0], FISH_SPECIES[0], FISH_SPECIES[0], FISH_SPECIES[0], FISH_SPECIES[0],
    FISH_SPECIES[1], FISH_SPECIES[1], FISH_SPECIES[1], FISH_SPECIES[1], FISH_SPECIES[1],
    FISH_SPECIES[2], FISH_SPECIES[2], FISH_SPECIES[2], FISH_SPECIES[2], FISH_SPECIES[2], FISH_SPECIES[2],
    FISH_SPECIES[3], FISH_SPECIES[3], FISH_SPECIES[3], FISH_SPECIES[3],
    FISH_SPECIES[4], FISH_SPECIES[4], FISH_SPECIES[4], FISH_SPECIES[4],
    FISH_SPECIES[5], FISH_SPECIES[5], FISH_SPECIES[5],
    FISH_SPECIES[6], FISH_SPECIES[6], FISH_SPECIES[6],
    FISH_SPECIES[7], FISH_SPECIES[7], FISH_SPECIES[7],
    FISH_SPECIES[8], FISH_SPECIES[8],
  ];

  const schoolAnchor = new THREE.Vector2(-8, -14);

  spawnPlan.forEach((species, idx) => {
    const zone = species.preferredZones[idx % species.preferredZones.length];
    const center = getZoneTargetCenter(zone);

    let sx = center.x + (Math.random() - 0.5) * center.spreadX * 1.4;
    let sz = center.z + (Math.random() - 0.5) * center.spreadZ * 1.4;
    if (species.behavior === 'schooling') {
      sx = schoolAnchor.x + (Math.random() - 0.5) * 5.5;
      sz = schoolAnchor.y + (Math.random() - 0.5) * 5.5;
    }

    let bedY = groundHeightAt(sx, sz);
    for (let t = 0; t < 10 && bedY > -0.65; t++) {
      sx *= 0.82;
      sz = THREE.MathUtils.lerp(sz, -40, 0.25);
      bedY = groundHeightAt(sx, sz);
    }

    const avgLen = (species.minLengthCm + species.maxLengthCm) * 0.5;
    const lengthScale = (avgLen / 40) * (0.78 + Math.random() * 0.62);
    const scaleTex = speciesTextures.get(species.id)!;
    const { root, tailPivot, bodyMat } = buildProceduralFishMesh(species, lengthScale, scaleTex, sharedGeos, sharedMats);

    const prefDepth = THREE.MathUtils.lerp(species.preferredDepth[0], species.preferredDepth[1], Math.random());
    const sy = Math.max(bedY + 0.28, Math.min(-0.35, -prefDepth));

    root.position.set(sx, sy, sz);
    // Real 3D fish remain permanently in the lake, semi-obscured by water depth haze
    root.visible = true;
    group.add(root);

    const heading = Math.random() * Math.PI * 2;
    fishes.push({
      id: idx + 1,
      species,
      mesh: root,
      tailPivot,
      bodyMat,
      lengthScale,
      position: new THREE.Vector3(sx, sy, sz),
      velocity: new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(0.6),
      heading,
      targetPos: new THREE.Vector3(sx + Math.sin(heading) * 5, sy, sz + Math.cos(heading) * 5),
      aiState: 'patrol',
      stateTimer: 0,
      nibbleCount: 0,
      maxNibbles: 2,
      pauseTimer: 0,
      schoolCenter: schoolAnchor,
      swimPhase: Math.random() * Math.PI * 2,
      stamina: 1.0,
      surgeTimer: 0,
      surgeDir: 1,
    });
  });

  const tmpToTarget = new THREE.Vector3();
  const tmpDesired = new THREE.Vector3();

  function pickPatrolPoint(fish: ActiveFish): void {
    const zone = fish.species.preferredZones[Math.floor(Math.random() * fish.species.preferredZones.length)];
    const center = getZoneTargetCenter(zone);

    let tx = center.x + (Math.random() - 0.5) * center.spreadX * 2.0;
    let tz = center.z + (Math.random() - 0.5) * center.spreadZ * 2.0;

    if (fish.species.behavior === 'schooling') {
      tx = fish.schoolCenter.x + (Math.random() - 0.5) * 7.0;
      tz = fish.schoolCenter.y + (Math.random() - 0.5) * 7.0;
    }

    let bedY = groundHeightAt(tx, tz);
    if (bedY > -0.55) {
      tx = THREE.MathUtils.lerp(tx, 0, 0.5);
      tz = THREE.MathUtils.lerp(tz, -40, 0.5);
      bedY = groundHeightAt(tx, tz);
    }

    let prefDepth = THREE.MathUtils.lerp(
      fish.species.preferredDepth[0],
      fish.species.preferredDepth[1],
      Math.random(),
    );
    if (fish.species.behavior === 'bottom_forager') {
      prefDepth = Math.max(prefDepth, -bedY - 0.45);
    }
    const ty = Math.max(bedY + 0.25, Math.min(-0.35, -prefDepth));
    fish.targetPos.set(tx, ty, tz);
  }

  function computeBaitInterest(
    fish: ActiveFish,
    baitId: BaitId,
    hookId: HookId,
    weather: WeatherType,
    season: SeasonId,
    timePreset: TimePresetId,
    lureZone: LakeZoneId,
    anglerSenseLevel: number,
    rareAttractionBonus = 1.0,
  ): number {
    const bait = BAIT_CATALOG.find((b) => b.id === baitId)!;
    const hook = HOOK_CATALOG.find((h) => h.id === hookId)!;
    const seasonDef = SEASON_CATALOG.find((s) => s.id === season)!;
    let score = 0.34;

    if (fish.species.favoriteBaits.includes(baitId)) score += 0.48;
    else if (bait.preferredZones.some((z) => fish.species.preferredZones.includes(z))) score += 0.16;

    if (fish.species.preferredZones.includes(lureZone)) score += 0.22;
    if (fish.species.activeWeather.includes(weather)) score += 0.22;
    else if (weather === 'storm' && fish.species.rarity === 'شائع') score -= 0.14;

    if (fish.species.activeTimes.includes(timePreset)) score += 0.2;
    if (fish.species.idealHooks.includes(hookId)) score += 0.16;

    if (fish.species.rarity === 'شائع' || fish.species.behavior === 'bottom_forager') {
      score *= hook.cautiousAcceptRate;
    }

    if (fish.species.rarity !== 'شائع') {
      score *= rareAttractionBonus;
    }

    if (baitId === 'glow_minnow' && (timePreset === 'night' || timePreset === 'dusk' || weather === 'mist')) {
      score *= 1.38;
    }

    score *= seasonDef.fishActivityBonus;
    score *= 1 + (anglerSenseLevel - 1) * 0.09;

    if (season === 'winter') {
      if (fish.species.behavior === 'deep_hunter') score *= 1.25;
      else if (fish.species.behavior === 'surface_cruiser') score *= 0.82;
    }

    return THREE.MathUtils.clamp(score, 0.08, 2.2);
  }

  return {
    group,
    fishes,
    getHookedFish: () => fishes.find((f) => f.aiState === 'hooked') ?? null,
    getBitingFish: () => fishes.find((f) => f.aiState === 'biting') ?? null,
    hookBitingFish: () => {
      const biting = fishes.find((f) => f.aiState === 'biting');
      if (!biting) return null;
      biting.aiState = 'hooked';
      biting.stamina = 1.0;
      biting.surgeTimer = 0.8;
      biting.surgeDir = Math.random() < 0.5 ? -1 : 1;
      return biting;
    },
    releaseHookedFish: () => {
      for (const f of fishes) {
        if (f.aiState === 'hooked' || f.aiState === 'biting' || f.aiState === 'nibbling') {
          f.aiState = 'spooked';
          f.stateTimer = 3.2;
          f.mesh.visible = true;
          f.mesh.scale.setScalar(f.lengthScale);
          pickPatrolPoint(f);
        }
      }
    },
    consumeHookedFish: () => {
      for (const f of fishes) {
        if (f.aiState === 'hooked') {
          f.aiState = 'spooked';
          f.stateTimer = 6.0;
          f.mesh.scale.setScalar(f.lengthScale);
          f.mesh.rotation.set(0, f.heading, 0);
          f.position.set((Math.random() - 0.5) * 48, -2.5, -48 - Math.random() * 14);
          f.mesh.position.copy(f.position);
          f.mesh.visible = true;
          pickPatrolPoint(f);
        }
      }
    },
    spookNear: (x, z, radius) => {
      for (const f of fishes) {
        if (f.aiState === 'hooked') continue;
        const d = Math.hypot(f.position.x - x, f.position.z - z);
        if (d < radius) {
          f.aiState = 'spooked';
          f.stateTimer = 2.6;
          tmpToTarget.set(f.position.x - x, 0, f.position.z - z).normalize();
          f.targetPos.set(
            f.position.x + tmpToTarget.x * 8,
            f.position.y - 0.35,
            f.position.z + tmpToTarget.z * 8,
          );
        }
      }
    },
    update: ({
      dt,
      elapsed,
      lurePos,
      lureInWater,
      baitId,
      hookId,
      weather,
      season,
      timePreset,
      anglerSenseLevel,
      rareAttractionBonus = 1.0,
      isReelingPhase,
      onNibble,
      onBiteStart,
      onBiteExpired,
    }) => {
      const bait = BAIT_CATALOG.find((b) => b.id === baitId)!;
      const hook = HOOK_CATALOG.find((h) => h.id === hookId)!;
      const seasonDef = SEASON_CATALOG.find((s) => s.id === season)!;

      schoolAnchor.x = -12.0 + Math.sin(elapsed * 0.06) * 18.0;
      schoolAnchor.y = -22.0 + Math.cos(elapsed * 0.05) * 10.0;

      const lureZone = lurePos
        ? classifyLakeZone(lurePos.x, lurePos.z, Math.max(0.2, -groundHeightAt(lurePos.x, lurePos.z)))
        : 'rocky_ledge';

      const alreadyClaimedLure = fishes.some(
        (f) => f.aiState === 'curious' || f.aiState === 'nibbling' || f.aiState === 'biting' || f.aiState === 'hooked',
      );

      for (const fish of fishes) {
        if (fish.aiState === 'hooked') {
          fish.swimPhase += dt * 16.0;
          fish.tailPivot.rotation.y = Math.sin(fish.swimPhase) * 0.48;
          const fShader = fish.bodyMat.userData.shader;
          if (fShader) {
            fShader.uniforms.uSwimPhase.value = fish.swimPhase;
            fShader.uniforms.uSwimAmp.value = 0.085;
          }
          continue;
        }

        // Real fish stay permanently in lake, partially obscured by depth tint & opacity
        fish.mesh.visible = true;

        if (!lureInWater && (fish.aiState === 'curious' || fish.aiState === 'nibbling' || fish.aiState === 'biting')) {
          fish.aiState = 'patrol';
          pickPatrolPoint(fish);
        }

        const weatherSpeedFactor = weather === 'storm' ? 1.15 : weather === 'mist' ? 0.88 : 1.0;
        let maxSpeed = 0.9 * fish.species.speedMultiplier * seasonDef.fishActivityBonus * weatherSpeedFactor;

        if (fish.aiState === 'spooked') {
          maxSpeed *= 2.4;
          fish.stateTimer -= dt;
          if (fish.stateTimer <= 0) {
            fish.aiState = 'patrol';
            pickPatrolPoint(fish);
          }
        } else if (fish.aiState === 'patrol') {
          if (fish.species.behavior === 'ambush' && fish.pauseTimer > 0) {
            fish.pauseTimer -= dt;
            maxSpeed = 0.06;
          } else if (fish.position.distanceTo(fish.targetPos) < 1.4) {
            pickPatrolPoint(fish);
            if (fish.species.behavior === 'ambush' && Math.random() < 0.45) {
              fish.pauseTimer = 1.6 + Math.random() * 2.2;
            }
          }

          if (lureInWater && lurePos && !alreadyClaimedLure && !isReelingPhase) {
            const distToLure = fish.position.distanceTo(lurePos);
            const interest = computeBaitInterest(
              fish,
              baitId,
              hookId,
              weather,
              season,
              timePreset,
              lureZone,
              anglerSenseLevel,
              rareAttractionBonus,
            );
            const detectRange = (bait.attractionRadius + 3.2) * (0.75 + interest * 0.45);
            if (distToLure < detectRange && Math.random() < dt * 0.95 * interest * bait.biteSpeedBonus) {
              fish.aiState = 'curious';
              fish.stateTimer = 5.0 + Math.random() * 2.5;
              fish.nibbleCount = 0;
              fish.maxNibbles = fish.species.behavior === 'bottom_forager' ? 3 : fish.species.behavior === 'ambush' ? 1 : 2;
            }
          }
        } else if (fish.aiState === 'curious' && lurePos) {
          maxSpeed *= 1.15;
          fish.targetPos.copy(lurePos);
          fish.stateTimer -= dt;
          const dist = fish.position.distanceTo(lurePos);
          if (dist < 0.65) {
            fish.aiState = 'nibbling';
            fish.stateTimer = 0.65 + Math.random() * 0.55;
            onNibble(lurePos.x, lurePos.z);
          } else if (fish.stateTimer <= 0) {
            fish.aiState = 'patrol';
            pickPatrolPoint(fish);
          }
        } else if (fish.aiState === 'nibbling' && lurePos) {
          maxSpeed = 0.26;
          fish.targetPos.copy(lurePos);
          fish.stateTimer -= dt;
          if (fish.stateTimer <= 0) {
            fish.nibbleCount++;
            const interest = computeBaitInterest(
              fish,
              baitId,
              hookId,
              weather,
              season,
              timePreset,
              lureZone,
              anglerSenseLevel,
              rareAttractionBonus,
            );
            if (fish.nibbleCount >= fish.maxNibbles) {
              if (Math.random() < Math.min(0.95, 0.58 * interest)) {
                fish.aiState = 'biting';
                fish.stateTimer = 1.9 + hook.biteWindowBonus + (anglerSenseLevel - 1) * 0.28;
                onBiteStart(fish);
              } else {
                fish.aiState = 'spooked';
                fish.stateTimer = 2.0;
                pickPatrolPoint(fish);
              }
            } else {
              fish.stateTimer = 0.75 + Math.random() * 0.65;
              onNibble(lurePos.x, lurePos.z);
            }
          }
        } else if (fish.aiState === 'biting' && lurePos) {
          maxSpeed = 0.35;
          fish.targetPos.set(lurePos.x, lurePos.y - 0.15, lurePos.z);
          fish.stateTimer -= dt;
          if (fish.stateTimer <= 0) {
            fish.aiState = 'spooked';
            fish.stateTimer = 2.8;
            pickPatrolPoint(fish);
            onBiteExpired();
          }
        }

        tmpDesired.subVectors(fish.targetPos, fish.position);
        const dist = tmpDesired.length();
        if (dist > 0.01) {
          tmpDesired.divideScalar(dist).multiplyScalar(maxSpeed);
        }
        // Gentle pairwise separation so patrolling fish never stack on top of one another
        if (fish.aiState === 'patrol') {
          for (let j = 0; j < fishes.length; j++) {
            const other = fishes[j];
            if (other === fish || other.aiState === 'hooked') continue;
            const dx = fish.position.x - other.position.x;
            const dz = fish.position.z - other.position.z;
            const dSq = dx * dx + dz * dz;
            if (dSq > 0.0001 && dSq < 3.24) {
              const d = Math.sqrt(dSq);
              const push = (1.8 - d) * 0.85;
              tmpDesired.x += (dx / d) * push;
              tmpDesired.z += (dz / d) * push;
            }
          }
        }
        fish.velocity.lerp(tmpDesired, Math.min(1, dt * 2.4));
        fish.position.addScaledVector(fish.velocity, dt);

        const bedY = groundHeightAt(fish.position.x, fish.position.z);
        if (bedY > -0.35) {
          fish.position.x = THREE.MathUtils.lerp(fish.position.x, 0, dt * 1.4);
          fish.position.z = THREE.MathUtils.lerp(fish.position.z, -40, dt * 1.4);
          pickPatrolPoint(fish);
        }
        const safeFloor = groundHeightAt(fish.position.x, fish.position.z) + 0.22;
        const safeCeil = -0.35;
        fish.position.y = THREE.MathUtils.clamp(fish.position.y, Math.min(safeFloor, safeCeil - 0.05), safeCeil);

        fish.mesh.position.copy(fish.position);
        const speed = fish.velocity.length();
        if (speed > 0.05) {
          const targetHeading = Math.atan2(fish.velocity.x, fish.velocity.z);
          let diff = targetHeading - fish.heading;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          fish.heading += diff * Math.min(1, dt * 5.0);
          fish.mesh.rotation.y = fish.heading;
          fish.mesh.rotation.x = THREE.MathUtils.clamp(-fish.velocity.y * 0.4, -0.35, 0.35);
        }

        fish.swimPhase += dt * (3.8 + speed * 7.2);
        fish.tailPivot.rotation.y = Math.sin(fish.swimPhase) * (0.16 + Math.min(0.28, speed * 0.22));
        const fShader = fish.bodyMat.userData.shader;
        if (fShader) {
          fShader.uniforms.uSwimPhase.value = fish.swimPhase;
          fShader.uniforms.uSwimAmp.value = 0.03 + Math.min(0.055, speed * 0.03);
        }
      }
    },
    dispose: () => {
      for (const g of sharedGeos) g.dispose();
      for (const m of sharedMats) m.dispose();
      for (const tex of speciesTextures.values()) tex.dispose();
    },
  };
}
