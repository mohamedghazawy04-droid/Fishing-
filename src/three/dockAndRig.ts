import * as THREE from 'three';
import type { ProceduralTextureSet } from './textures';
import { groundHeightAt } from './environment';
import { BAIT_CATALOG, type BaitId } from '../types/fishing';
import { createVintageRadioSystem } from './vintageRadio';

export interface DockAndRigSystem {
  group: THREE.Group;
  playerRigGroup: THREE.Group;
  rodRoot: THREE.Group;
  reelCrankPivot: THREE.Group;
  bobberGroup: THREE.Group;
  bobberGlowMat: THREE.MeshStandardMaterial;
  baitMesh: THREE.Group;
  baitMat: THREE.MeshStandardMaterial;
  fishingLine: THREE.Line;
  lanternLight: THREE.PointLight;
  lanternFlameMat: THREE.MeshStandardMaterial;
  boatWormDishGroup: THREE.Group;
  wormDishHitTargets: THREE.Object3D[];
  boatRadioGroup: THREE.Group;
  radioHitTargets: THREE.Object3D[];
  setRadioState: (playing: boolean, loading: boolean, stationIndex?: number) => void;
  setRadioHovered: (hovered: boolean) => void;
  notifyWormStolen: (isOnBoat: boolean) => void;
  setActiveBaitVisual: (baitId: BaitId) => void;
  setUnlockedBaits: (unlockedBaits: BaitId[], playerLevel: number) => void;
  setPlayerRigTransform: (offset: THREE.Vector3, pitch: number, roll: number, yaw?: number) => void;
  updateRodAndLine: (params: {
    elapsed: number;
    castBackAngle: number; // 0..1 when charging
    rodBend: number; // 0..1 when fighting fish
    rodYawOffset: number;
    bobberPos: THREE.Vector3;
    lurePos: THREE.Vector3;
    bobberVisible: boolean;
    reeling: boolean;
    hooked?: boolean;
    hookBaited?: boolean;
    isOnBoat?: boolean;
    baitingProgress?: number; // -1 inactive, 0..1 threading worm from dish to hook
    nightFactor: number;
    windStrength: number;
    coldSnowFactor: number;
    lineTension: number;
    heavyFishFactor: number;
  }) => THREE.Vector3;
  getRodTipWorldPos: (out: THREE.Vector3) => THREE.Vector3;
  dispose: () => void;
}

export function createDockAndRig(textures: ProceduralTextureSet): DockAndRigSystem {
  const group = new THREE.Group();
  const playerRigGroup = new THREE.Group();
  const rigSeatPivot = new THREE.Group();
  rigSeatPivot.position.set(0, 0, 2.30);
  playerRigGroup.add(rigSeatPivot);
  group.add(playerRigGroup);
  const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  const pierTopY = 0.72;

  // Materials (varied roughness >= 0.25 across adjacent parts)
  const pierWoodMat = new THREE.MeshStandardMaterial({
    map: textures.woodPlankMap,
    bumpMap: textures.woodBumpMap,
    bumpScale: 0.015,
    roughness: 0.86,
    metalness: 0.04,
  });
  const darkTimberMat = new THREE.MeshStandardMaterial({
    color: 0x453020,
    roughness: 0.9,
    metalness: 0.02,
  });
  const canvasFabricMat = new THREE.MeshStandardMaterial({
    color: 0x2f4d3f,
    roughness: 0.92,
    metalness: 0.0,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xc59b47,
    roughness: 0.28,
    metalness: 0.88,
  });
  const corkMat = new THREE.MeshStandardMaterial({
    color: 0xc79e6b,
    roughness: 0.88,
    metalness: 0.0,
  });
  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x1d252b,
    roughness: 0.32,
    metalness: 0.55,
  });
  const bootMat = new THREE.MeshStandardMaterial({
    color: 0x3b2619,
    roughness: 0.78,
    metalness: 0.06,
  });
  const denimMat = new THREE.MeshStandardMaterial({
    color: 0x2c4257,
    roughness: 0.92,
    metalness: 0.0,
  });
  disposables.push(pierWoodMat, darkTimberMat, canvasFabricMat, brassMat, corkMat, carbonMat, bootMat, denimMat);

  const snowUniform = { value: 0 };
  const snowMaterials: THREE.MeshStandardMaterial[] = [];

  function enableColdFrostDusting(mat: THREE.MeshStandardMaterial, strength = 1.0, edgeBias = 0.0): void {
    snowMaterials.push(mat);
    mat.customProgramCacheKey = () => `cold_frost_${strength.toFixed(2)}_${edgeBias.toFixed(2)}`;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSnowDust = snowUniform;
      shader.uniforms.uSnowStrength = { value: strength };
      shader.uniforms.uEdgeBias = { value: edgeBias };
      shader.vertexShader =
        `varying vec3 vFrostWorldPos;\nvarying vec3 vFrostWorldNormal;\n` +
        shader.vertexShader.replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
           vec4 frostWp = modelMatrix * vec4(transformed, 1.0);
           vFrostWorldPos = frostWp.xyz;
           vFrostWorldNormal = normalize(mat3(modelMatrix) * normal);`,
        );
      shader.fragmentShader =
        `uniform float uSnowDust;\nuniform float uSnowStrength;\nuniform float uEdgeBias;\nvarying vec3 vFrostWorldPos;\nvarying vec3 vFrostWorldNormal;\n` +
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           float frostNoise = sin(vFrostWorldPos.x * 24.0 + vFrostWorldPos.z * 19.0) * cos(vFrostWorldPos.z * 27.0 - vFrostWorldPos.x * 14.0) * 0.5 + 0.5;
           float upCatch = smoothstep(0.28 - uEdgeBias, 0.85, vFrostWorldNormal.y);
           float rimFrost = pow(clamp(1.0 - abs(vFrostWorldNormal.y), 0.0, 1.0), 1.6) * uEdgeBias;
           float frostMask = clamp((upCatch * 0.85 + rimFrost * 0.65) * (0.45 + frostNoise * 0.72) * uSnowDust * uSnowStrength, 0.0, 0.82);
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.90, 0.94, 0.98), frostMask);`,
        ).replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
           roughnessFactor = mix(roughnessFactor, 0.62, clamp(uSnowDust * 0.45, 0.0, 0.45));`,
        );
    };
  }

  enableColdFrostDusting(pierWoodMat, 0.78, 0.04);
  enableColdFrostDusting(darkTimberMat, 0.68, 0.06);
  enableColdFrostDusting(canvasFabricMat, 0.85, 0.14);
  enableColdFrostDusting(bootMat, 0.72, 0.16);
  enableColdFrostDusting(denimMat, 0.76, 0.22);

  // 1. Wooden Lakeside Pier extending from bank (z=7.2) out over water (z=-0.6)
  const dockGroup = new THREE.Group();
  const plankGeo = new THREE.BoxGeometry(2.7, 0.08, 0.34);
  disposables.push(plankGeo);

  for (let z = 7.0; z >= -0.5; z -= 0.37) {
    const plank = new THREE.Mesh(plankGeo, pierWoodMat);
    plank.position.set(0, pierTopY - 0.04, z);
    plank.rotation.y = (Math.sin(z * 11.3) * 0.006);
    plank.castShadow = true;
    plank.receiveShadow = true;
    dockGroup.add(plank);
  }

  // Stringers under planks
  const stringerGeo = new THREE.BoxGeometry(0.14, 0.18, 8.2);
  disposables.push(stringerGeo);
  for (const sx of [-1.05, 1.05]) {
    const stringer = new THREE.Mesh(stringerGeo, darkTimberMat);
    stringer.position.set(sx, pierTopY - 0.16, 3.25);
    stringer.castShadow = true;
    stringer.receiveShadow = true;
    dockGroup.add(stringer);
  }

  // Timber Pilings driven flush into the visible lakebed
  const pilingPositions: [number, number][] = [
    [-1.18, -0.35],
    [1.18, -0.35],
    [-1.18, 2.2],
    [1.18, 2.2],
    [-1.18, 4.8],
    [1.18, 4.8],
  ];
  for (const [px, pz] of pilingPositions) {
    const bedY = groundHeightAt(px, pz);
    const topY = pz < 0.2 ? pierTopY + 0.55 : pierTopY + 0.35;
    const h = Math.max(0.8, topY - bedY + 0.2);
    const pGeo = new THREE.CylinderGeometry(0.11, 0.13, h, 10);
    disposables.push(pGeo);
    const piling = new THREE.Mesh(pGeo, darkTimberMat);
    piling.position.set(px, bedY + h * 0.5 - 0.1, pz);
    piling.castShadow = true;
    piling.receiveShadow = true;
    dockGroup.add(piling);
  }
  group.add(dockGroup);

  // 2. Multi-Part Fisherman's Wooden & Canvas Chair seated at (0, pierTopY, 2.30)
  const chairGroup = new THREE.Group();
  chairGroup.position.set(0, pierTopY, 2.30);

  const legGeo = new THREE.CylinderGeometry(0.026, 0.022, 0.44, 8);
  const armGeo = new THREE.BoxGeometry(0.09, 0.048, 0.68);
  const armCapGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.048, 12);
  const seatFrameGeo = new THREE.BoxGeometry(0.72, 0.055, 0.64);
  const cushionGeo = new THREE.BoxGeometry(0.62, 0.065, 0.56);
  const backPostGeo = new THREE.CylinderGeometry(0.024, 0.026, 0.64, 8);
  const backCanvasGeo = new THREE.BoxGeometry(0.62, 0.40, 0.045);
  const armPostGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.28, 8);
  disposables.push(legGeo, armGeo, armCapGeo, seatFrameGeo, cushionGeo, backPostGeo, backCanvasGeo, armPostGeo);

  // 4 Chair legs grounded on pier + soft contact shadow decals
  const contactShadowMat = new THREE.MeshBasicMaterial({
    map: textures.contactShadowMap,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  const legShadowGeo = new THREE.PlaneGeometry(0.18, 0.18);
  legShadowGeo.rotateX(-Math.PI / 2);
  const boxShadowGeo = new THREE.PlaneGeometry(0.62, 0.42);
  boxShadowGeo.rotateX(-Math.PI / 2);
  disposables.push(contactShadowMat, legShadowGeo, boxShadowGeo);

  for (const [lx, lz] of [[-0.31, -0.26], [0.31, -0.26], [-0.31, 0.26], [0.31, 0.26]]) {
    const leg = new THREE.Mesh(legGeo, darkTimberMat);
    leg.position.set(lx, 0.22, lz);
    leg.castShadow = true;
    leg.receiveShadow = true;
    const legShadow = new THREE.Mesh(legShadowGeo, contactShadowMat);
    legShadow.position.set(lx, 0.004, lz);
    chairGroup.add(leg, legShadow);
  }
  const seatFrame = new THREE.Mesh(seatFrameGeo, pierWoodMat);
  seatFrame.position.set(0, 0.44, -0.04);
  seatFrame.castShadow = true;
  seatFrame.receiveShadow = true;
  chairGroup.add(seatFrame);

  const cushion = new THREE.Mesh(cushionGeo, canvasFabricMat);
  cushion.position.set(0, 0.485, -0.04);
  cushion.castShadow = true;
  cushion.receiveShadow = true;
  chairGroup.add(cushion);

  // Backrest tilted slightly back (+Z)
  const backGroup = new THREE.Group();
  backGroup.position.set(0, 0.46, 0.26);
  backGroup.rotation.x = 0.16;
  for (const bx of [-0.30, 0.30]) {
    const bp = new THREE.Mesh(backPostGeo, darkTimberMat);
    bp.position.set(bx, 0.32, 0);
    bp.castShadow = true;
    bp.receiveShadow = true;
    backGroup.add(bp);
  }
  const backCanvas = new THREE.Mesh(backCanvasGeo, canvasFabricMat);
  backCanvas.position.set(0, 0.38, 0);
  backCanvas.castShadow = true;
  backCanvas.receiveShadow = true;
  backGroup.add(backCanvas);
  chairGroup.add(backGroup);

  // Extended Left & Right Wooden Armrests clearly framing the lower viewport corners during fishing
  for (const ax of [-0.35, 0.35]) {
    const arm = new THREE.Mesh(armGeo, pierWoodMat);
    arm.position.set(ax, 0.72, -0.10);
    arm.castShadow = true;
    arm.receiveShadow = true;
    const armCap = new THREE.Mesh(armCapGeo, pierWoodMat);
    armCap.position.set(ax, 0.72, -0.44);
    armCap.castShadow = true;
    armCap.receiveShadow = true;
    const frontPost = new THREE.Mesh(armPostGeo, darkTimberMat);
    frontPost.position.set(ax, 0.57, -0.34);
    frontPost.castShadow = true;
    frontPost.receiveShadow = true;
    const rearPost = new THREE.Mesh(armPostGeo, darkTimberMat);
    rearPost.position.set(ax, 0.57, 0.16);
    rearPost.castShadow = true;
    rearPost.receiveShadow = true;
    chairGroup.add(arm, armCap, frontPost, rearPost);
  }
  group.add(chairGroup);

  // 3. Seated Fisherman Lower Body (knees & boots resting naturally on pier planks / boat deck)
  const bodyGroup = new THREE.Group();
  bodyGroup.position.set(0, pierTopY, 0);

  const thighGeo = new THREE.CapsuleGeometry(0.088, 0.40, 6, 10);
  thighGeo.rotateX(Math.PI / 2);
  const shinGeo = new THREE.CapsuleGeometry(0.072, 0.38, 6, 10);
  const bootGeo = new THREE.BoxGeometry(0.135, 0.105, 0.27);
  disposables.push(thighGeo, shinGeo, bootGeo);

  for (const side of [-1, 1]) {
    const thigh = new THREE.Mesh(thighGeo, denimMat);
    thigh.position.set(side * 0.155, 0.56, -0.22);
    thigh.rotation.y = side * -0.05;
    thigh.castShadow = true;
    thigh.receiveShadow = true;

    const shin = new THREE.Mesh(shinGeo, denimMat);
    shin.position.set(side * 0.165, 0.28, -0.45);
    shin.rotation.x = 0.12;
    shin.castShadow = true;
    shin.receiveShadow = true;

    const boot = new THREE.Mesh(bootGeo, bootMat);
    boot.position.set(side * 0.175, 0.05, -0.54);
    boot.rotation.y = side * -0.08;
    boot.castShadow = true;
    boot.receiveShadow = true;

    bodyGroup.add(thigh, shin, boot);
  }
  rigSeatPivot.add(bodyGroup);

  // 4. Dockside Props: Warm Brass Oil Lantern (left front piling) & Wooden Tackle Box (right of chair)
  const lanternGroup = new THREE.Group();
  lanternGroup.position.set(-1.18, pierTopY + 0.55, -0.35);
  const lBaseGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.08, 12);
  const lGlassGeo = new THREE.CylinderGeometry(0.085, 0.09, 0.2, 12);
  const lCapGeo = new THREE.ConeGeometry(0.12, 0.1, 12);
  const lFlameGeo = new THREE.SphereGeometry(0.032, 8, 8);
  const lGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffeacc,
    roughness: 0.1,
    transparent: true,
    opacity: 0.45,
  });
  const lanternFlameMat = new THREE.MeshStandardMaterial({
    color: 0xffb347,
    emissive: 0xff8c1a,
    emissiveIntensity: 0.2,
    roughness: 0.2,
  });
  disposables.push(lBaseGeo, lGlassGeo, lCapGeo, lFlameGeo, lGlassMat, lanternFlameMat);

  const lBase = new THREE.Mesh(lBaseGeo, brassMat);
  lBase.position.y = 0.04;
  lBase.castShadow = true;
  lBase.receiveShadow = true;
  const lGlass = new THREE.Mesh(lGlassGeo, lGlassMat);
  lGlass.position.y = 0.18;
  const lCap = new THREE.Mesh(lCapGeo, brassMat);
  lCap.position.y = 0.33;
  lCap.castShadow = true;
  const lFlame = new THREE.Mesh(lFlameGeo, lanternFlameMat);
  lFlame.position.y = 0.16;
  lanternGroup.add(lBase, lGlass, lCap, lFlame);

  const lanternLight = new THREE.PointLight(0xffa94d, 0.0, 14, 1.8);
  lanternLight.position.set(0, 0.22, 0);
  lanternLight.castShadow = true;
  lanternLight.shadow.mapSize.set(512, 512);
  lanternLight.shadow.bias = -0.0015;
  lanternGroup.add(lanternLight);
  group.add(lanternGroup);

  // Wooden Tackle Box beside chair
  const tackleBox = new THREE.Group();
  tackleBox.position.set(0.72, pierTopY, 1.95);
  tackleBox.rotation.y = -0.32;
  const tbBodyGeo = new THREE.BoxGeometry(0.42, 0.22, 0.24);
  const tbLidGeo = new THREE.BoxGeometry(0.44, 0.05, 0.26);
  const tbLatchGeo = new THREE.BoxGeometry(0.06, 0.05, 0.02);
  disposables.push(tbBodyGeo, tbLidGeo, tbLatchGeo);
  const tbBody = new THREE.Mesh(tbBodyGeo, darkTimberMat);
  tbBody.position.y = 0.11;
  tbBody.castShadow = true;
  tbBody.receiveShadow = true;
  const tbLid = new THREE.Mesh(tbLidGeo, pierWoodMat);
  tbLid.position.y = 0.24;
  tbLid.castShadow = true;
  tbLid.receiveShadow = true;
  const tbLatch = new THREE.Mesh(tbLatchGeo, brassMat);
  tbLatch.position.set(0, 0.21, -0.13);
  tbLatch.castShadow = true;
  const boxShadow = new THREE.Mesh(boxShadowGeo, contactShadowMat);
  boxShadow.position.y = 0.004;
  tackleBox.add(tbBody, tbLid, tbLatch, boxShadow);
  group.add(tackleBox);

  // 4b. Terracotta Worm Dish ("طبق الدود") on both Wooden Pier and Boat Forward Thwart
  const bowlMat = new THREE.MeshStandardMaterial({
    color: 0xa45438,
    roughness: 0.42,
    metalness: 0.06,
    side: THREE.DoubleSide,
  });
  const soilMat = new THREE.MeshStandardMaterial({
    color: 0x261a12,
    roughness: 0.96,
    metalness: 0.0,
  });
  const wormMat = new THREE.MeshStandardMaterial({
    color: 0xc96b59,
    roughness: 0.28,
    metalness: 0.08,
  });
  const wormHighlightRingMat = new THREE.MeshBasicMaterial({
    color: 0xf59e0b,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  enableColdFrostDusting(bowlMat, 0.55, 0.14);

  const bowlProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.095, 0.0),
    new THREE.Vector2(0.135, 0.032),
    new THREE.Vector2(0.148, 0.068),
    new THREE.Vector2(0.156, 0.074),
    new THREE.Vector2(0.142, 0.076),
    new THREE.Vector2(0.130, 0.062),
    new THREE.Vector2(0.092, 0.016),
    new THREE.Vector2(0.0, 0.014),
  ];
  const bowlGeo = new THREE.LatheGeometry(bowlProfile, 22);
  const soilGeo = new THREE.SphereGeometry(0.125, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
  soilGeo.scale(1.0, 0.26, 1.0);

  const dishWormCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.048, 0.0, 0.012),
    new THREE.Vector3(-0.022, 0.008, -0.014),
    new THREE.Vector3(0.008, 0.005, 0.016),
    new THREE.Vector3(0.034, 0.009, -0.008),
    new THREE.Vector3(0.056, 0.002, 0.014),
  ]);
  const dishWormGeo = new THREE.TubeGeometry(dishWormCurve, 16, 0.0075, 7, false);

  const dishShadowGeo = new THREE.PlaneGeometry(0.38, 0.38);
  dishShadowGeo.rotateX(-Math.PI / 2);
  const dishRingGeo = new THREE.RingGeometry(0.165, 0.19, 28);
  dishRingGeo.rotateX(-Math.PI / 2);

  // Adaptive Multi-Bait Dish Materials & Geometries (تتكيف محتويات الطبق وزخرفته مع مستوى اللاعب)
  const rimUpgradeMat = new THREE.MeshStandardMaterial({
    color: 0x8b6b4a,
    roughness: 0.36,
    metalness: 0.72,
  });
  const flyFeatherMat = new THREE.MeshStandardMaterial({
    color: 0xd97706,
    roughness: 0.68,
    metalness: 0.04,
  });
  const flyWingAccentMat = new THREE.MeshStandardMaterial({
    color: 0xfef3c7,
    roughness: 0.62,
  });
  const cornKernelMat = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    roughness: 0.28,
    metalness: 0.08,
  });
  const cornLeafMat = new THREE.MeshStandardMaterial({
    color: 0x3f6e33,
    roughness: 0.78,
  });
  const spinnerBladeMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.16,
    metalness: 0.94,
  });
  const spinnerBeadMat = new THREE.MeshStandardMaterial({
    color: 0xdc2626,
    roughness: 0.25,
    metalness: 0.15,
  });
  const glowMinnowMat = new THREE.MeshStandardMaterial({
    color: 0x67e8f9,
    emissive: 0x22d3ee,
    emissiveIntensity: 0.95,
    roughness: 0.22,
    metalness: 0.12,
  });
  const glowTailMat = new THREE.MeshStandardMaterial({
    color: 0xa5f3fc,
    emissive: 0x06b6d4,
    emissiveIntensity: 0.65,
    roughness: 0.3,
  });

  const rimBandGeo = new THREE.TorusGeometry(0.151, 0.0085, 8, 28);
  rimBandGeo.rotateX(Math.PI / 2);
  const corkPadGeo = new THREE.CylinderGeometry(0.036, 0.038, 0.012, 14);
  const flyBodyGeo = new THREE.CapsuleGeometry(0.0055, 0.016, 4, 8);
  flyBodyGeo.rotateZ(Math.PI / 2);
  const flyFeatherGeo = new THREE.ConeGeometry(0.009, 0.022, 7);
  flyFeatherGeo.rotateZ(-Math.PI / 2);
  const cornLeafGeo = new THREE.CylinderGeometry(0.042, 0.044, 0.005, 12);
  const cornKernelGeo = new THREE.SphereGeometry(0.011, 8, 8);
  cornKernelGeo.scale(1.15, 0.85, 0.95);
  const spinnerBladeGeo = new THREE.SphereGeometry(0.017, 10, 8);
  spinnerBladeGeo.scale(1.55, 0.22, 0.85);
  const spinnerBeadGeo = new THREE.SphereGeometry(0.009, 8, 8);
  const minnowBodyGeo = new THREE.CapsuleGeometry(0.012, 0.036, 5, 10);
  minnowBodyGeo.rotateZ(Math.PI / 2);
  const minnowTailGeo = new THREE.ConeGeometry(0.013, 0.020, 6);
  minnowTailGeo.rotateZ(Math.PI / 2);

  disposables.push(
    bowlMat,
    soilMat,
    wormMat,
    wormHighlightRingMat,
    rimUpgradeMat,
    flyFeatherMat,
    flyWingAccentMat,
    cornKernelMat,
    cornLeafMat,
    spinnerBladeMat,
    spinnerBeadMat,
    glowMinnowMat,
    glowTailMat,
    bowlGeo,
    soilGeo,
    dishWormGeo,
    dishShadowGeo,
    dishRingGeo,
    rimBandGeo,
    corkPadGeo,
    flyBodyGeo,
    flyFeatherGeo,
    cornLeafGeo,
    cornKernelGeo,
    spinnerBladeGeo,
    spinnerBeadGeo,
    minnowBodyGeo,
    minnowTailGeo,
  );

  interface DishWormAnim {
    mesh: THREE.Mesh;
    dish: 'pier' | 'boat';
    baseRotY: number;
    baseX: number;
    baseZ: number;
    phase: number;
    stolenTimer: number;
  }
  interface DishAdaptiveSlots {
    rimBand: THREE.Mesh;
    flyGroup: THREE.Group;
    cornGroup: THREE.Group;
    spinnerGroup: THREE.Group;
    glowMinnowGroup: THREE.Group;
  }
  const dishWorms: DishWormAnim[] = [];
  const dishRings: THREE.Mesh[] = [];
  const dishAdaptiveSlots: DishAdaptiveSlots[] = [];

  function buildWormDish(scale: number, dish: 'pier' | 'boat'): THREE.Group {
    const root = new THREE.Group();
    const dShadow = new THREE.Mesh(dishShadowGeo, contactShadowMat);
    dShadow.position.y = 0.003;
    const ring = new THREE.Mesh(dishRingGeo, wormHighlightRingMat);
    ring.position.y = 0.006;
    dishRings.push(ring);

    const bowl = new THREE.Mesh(bowlGeo, bowlMat);
    bowl.castShadow = true;
    bowl.receiveShadow = true;
    const soil = new THREE.Mesh(soilGeo, soilMat);
    soil.position.y = 0.024;
    soil.receiveShadow = true;

    // Level-adaptive rim band around top ceramic lip (appears at level >= 2)
    const rimBand = new THREE.Mesh(rimBandGeo, rimUpgradeMat);
    rimBand.position.y = 0.072;
    rimBand.visible = false;

    root.add(dShadow, ring, bowl, soil, rimBand);

    const wormSpecs: [number, number, number, number][] = [
      [-0.025, 0.052, 0.022, 0.25],
      [0.028, 0.054, -0.018, 1.4],
      [-0.010, 0.056, -0.036, 2.3],
      [0.018, 0.055, 0.036, -0.9],
      [-0.044, 0.048, -0.014, 0.85],
      [0.045, 0.049, 0.010, 2.85],
    ];
    wormSpecs.forEach(([wx, wy, wz, rotY], idx) => {
      const wMesh = new THREE.Mesh(dishWormGeo, wormMat);
      wMesh.position.set(wx, wy, wz);
      wMesh.rotation.y = rotY;
      wMesh.castShadow = true;
      root.add(wMesh);
      dishWorms.push({
        mesh: wMesh,
        dish,
        baseRotY: rotY,
        baseX: wx,
        baseZ: wz,
        phase: idx * 1.45,
        stolenTimer: 0,
      });
    });

    // 1. Feathered Trout Flies on small cork pad (unlocked at Lv1)
    const flyGroup = new THREE.Group();
    flyGroup.position.set(-0.078, 0.052, 0.048);
    const corkPad = new THREE.Mesh(corkPadGeo, corkMat);
    corkPad.castShadow = true;
    flyGroup.add(corkPad);
    for (let fi = 0; fi < 2; fi++) {
      const fly = new THREE.Group();
      fly.position.set(fi === 0 ? -0.01 : 0.012, 0.010, fi === 0 ? -0.008 : 0.01);
      fly.rotation.y = fi === 0 ? 0.5 : -0.6;
      const body = new THREE.Mesh(flyBodyGeo, flyFeatherMat);
      const wing = new THREE.Mesh(flyFeatherGeo, fi === 0 ? flyWingAccentMat : flyFeatherMat);
      wing.position.set(-0.012, 0.004, 0);
      wing.rotation.z = 0.24;
      fly.add(body, wing);
      flyGroup.add(fly);
    }
    root.add(flyGroup);

    // 2. Golden Aromatic Corn Cluster on leaf pad (unlocked at Lv2)
    const cornGroup = new THREE.Group();
    cornGroup.position.set(0.072, 0.050, 0.055);
    const cornLeaf = new THREE.Mesh(cornLeafGeo, cornLeafMat);
    cornGroup.add(cornLeaf);
    const kernelOffsets: [number, number, number][] = [
      [0, 0.009, 0],
      [-0.015, 0.008, 0.008],
      [0.014, 0.008, 0.009],
      [-0.010, 0.008, -0.013],
      [0.012, 0.008, -0.011],
      [0.001, 0.018, 0.002],
      [0.022, 0.007, 0.001],
    ];
    kernelOffsets.forEach(([kx, ky, kz], ki) => {
      const k = new THREE.Mesh(cornKernelGeo, cornKernelMat);
      k.position.set(kx, ky, kz);
      k.rotation.y = ki * 0.9;
      k.castShadow = true;
      cornGroup.add(k);
    });
    cornGroup.visible = false;
    root.add(cornGroup);

    // 3. Metallic Silver Spinner Lure (unlocked at Lv3)
    const spinnerGroup = new THREE.Group();
    spinnerGroup.position.set(-0.068, 0.058, -0.062);
    spinnerGroup.rotation.y = 0.45;
    const spBlade = new THREE.Mesh(spinnerBladeGeo, spinnerBladeMat);
    spBlade.position.set(-0.012, 0.006, 0);
    spBlade.rotation.z = 0.22;
    const spBead = new THREE.Mesh(spinnerBeadGeo, spinnerBeadMat);
    spBead.position.set(0.016, 0.004, 0);
    const spSwivel = new THREE.Mesh(spinnerBeadGeo, brassMat);
    spSwivel.scale.set(0.8, 0.8, 0.8);
    spSwivel.position.set(0.029, 0.004, 0);
    spinnerGroup.add(spBlade, spBead, spSwivel);
    spinnerGroup.visible = false;
    root.add(spinnerGroup);

    // 4. Bioluminescent Glow Minnow Lure (unlocked at Lv4)
    const glowMinnowGroup = new THREE.Group();
    glowMinnowGroup.position.set(0.066, 0.057, -0.064);
    glowMinnowGroup.rotation.y = -0.55;
    const mBody = new THREE.Mesh(minnowBodyGeo, glowMinnowMat);
    const mTail = new THREE.Mesh(minnowTailGeo, glowTailMat);
    mTail.position.set(-0.028, 0.002, 0);
    glowMinnowGroup.add(mBody, mTail);
    glowMinnowGroup.visible = false;
    root.add(glowMinnowGroup);

    dishAdaptiveSlots.push({
      rimBand,
      flyGroup,
      cornGroup,
      spinnerGroup,
      glowMinnowGroup,
    });

    root.scale.setScalar(scale);
    return root;
  }

  const pierWormDish = buildWormDish(1.0, 'pier');
  pierWormDish.position.set(0.48, pierTopY, 0.34);
  group.add(pierWormDish);

  const boatWormDishGroup = new THREE.Group();
  const boatWormDish = buildWormDish(0.84, 'boat');
  boatWormDish.position.set(0.0, 0.228, -0.84);
  boatWormDishGroup.add(boatWormDish);

  const wormDishHitTargets: THREE.Object3D[] = [pierWormDish, boatWormDish];

  // 4c. Vintage Walnut & Brass Portable Radio in front-left of the seated fisherman (pier & boat bow)
  const vintageRadio = createVintageRadioSystem(contactShadowMat, enableColdFrostDusting);
  group.add(vintageRadio.pierRadio);
  const boatRadioGroup = vintageRadio.boatRadioGroup;
  const radioHitTargets = vintageRadio.hitTargets;

  // 5. Realistic Anatomical First-Person Fisherman Forearms & Both Hands + Rod
  const rodRoot = new THREE.Group();
  rodRoot.position.set(0.24, pierTopY + 0.90, -0.48);
  rigSeatPivot.add(rodRoot);

  const sleeveMat = new THREE.MeshStandardMaterial({
    map: textures.sleeveMap,
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0.02,
  });
  const cuffMat = new THREE.MeshStandardMaterial({
    map: textures.sleeveMap,
    color: 0xb8967d,
    roughness: 0.9,
  });
  enableColdFrostDusting(sleeveMat, 0.72, 0.26);
  enableColdFrostDusting(cuffMat, 0.88, 0.30);
  const skinMat = new THREE.MeshStandardMaterial({
    map: textures.skinMap,
    bumpMap: textures.skinBumpMap,
    bumpScale: 0.0045,
    color: 0xffffff,
    roughness: 0.56,
    metalness: 0.02,
  });
  const knuckleSkinMat = new THREE.MeshStandardMaterial({
    map: textures.skinMap,
    bumpMap: textures.skinBumpMap,
    bumpScale: 0.004,
    color: 0xf2cfc0,
    roughness: 0.54,
  });
  const nailMat = new THREE.MeshStandardMaterial({
    color: 0xedd6c8,
    roughness: 0.28,
    metalness: 0.08,
  });
  const watchLeatherMat = new THREE.MeshStandardMaterial({ color: 0x352216, roughness: 0.78 });
  const watchDialMat = new THREE.MeshStandardMaterial({ color: 0xf4efe4, roughness: 0.3 });

  const forearmGeo = new THREE.CylinderGeometry(0.038, 0.055, 0.36, 12);
  forearmGeo.rotateX(Math.PI / 2);
  const cuffGeo = new THREE.CylinderGeometry(0.043, 0.046, 0.055, 12);
  cuffGeo.rotateX(Math.PI / 2);
  const cuffRimGeo = new THREE.TorusGeometry(0.043, 0.007, 6, 14);
  const wristGeo = new THREE.CylinderGeometry(0.031, 0.036, 0.075, 12);
  wristGeo.rotateX(Math.PI / 2);
  const wristBoneGeo = new THREE.SphereGeometry(0.011, 8, 8);
  const palmCoreGeo = new THREE.BoxGeometry(0.076, 0.028, 0.088);
  const palmDorsumGeo = new THREE.SphereGeometry(0.042, 12, 10);
  palmDorsumGeo.scale(0.95, 0.42, 1.08);
  const thenarGeo = new THREE.SphereGeometry(0.024, 10, 8);
  thenarGeo.scale(0.85, 0.68, 1.25);
  const knuckleGeo = new THREE.SphereGeometry(0.0105, 8, 8);
  const phalanxProxGeo = new THREE.CapsuleGeometry(0.0092, 0.024, 5, 8);
  phalanxProxGeo.rotateX(Math.PI / 2);
  phalanxProxGeo.translate(0, 0, -0.016);
  const phalanxMidGeo = new THREE.CapsuleGeometry(0.0080, 0.018, 5, 8);
  phalanxMidGeo.rotateX(Math.PI / 2);
  phalanxMidGeo.translate(0, 0, -0.012);
  const phalanxDistGeo = new THREE.CapsuleGeometry(0.0070, 0.014, 5, 8);
  phalanxDistGeo.rotateX(Math.PI / 2);
  phalanxDistGeo.translate(0, 0, -0.010);
  const nailGeo = new THREE.BoxGeometry(0.010, 0.003, 0.011);
  const thumbProxGeo = new THREE.CapsuleGeometry(0.0108, 0.022, 5, 8);
  thumbProxGeo.rotateX(Math.PI / 2);
  thumbProxGeo.translate(0, 0, -0.015);
  const thumbDistGeo = new THREE.CapsuleGeometry(0.0092, 0.016, 5, 8);
  thumbDistGeo.rotateX(Math.PI / 2);
  thumbDistGeo.translate(0, 0, -0.012);
  const watchStrapGeo = new THREE.TorusGeometry(0.035, 0.006, 6, 14);
  const watchCaseGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.008, 14);
  const watchDialGeo = new THREE.CircleGeometry(0.014, 14);
  watchDialGeo.rotateX(-Math.PI / 2);

  disposables.push(
    sleeveMat,
    cuffMat,
    skinMat,
    knuckleSkinMat,
    nailMat,
    watchLeatherMat,
    watchDialMat,
    forearmGeo,
    cuffGeo,
    cuffRimGeo,
    wristGeo,
    wristBoneGeo,
    palmCoreGeo,
    palmDorsumGeo,
    thenarGeo,
    knuckleGeo,
    phalanxProxGeo,
    phalanxMidGeo,
    phalanxDistGeo,
    nailGeo,
    thumbProxGeo,
    thumbDistGeo,
    watchStrapGeo,
    watchCaseGeo,
    watchDialGeo,
  );

  type FingerRig = { prox: THREE.Group; mid: THREE.Group; dist: THREE.Group };

  function createAnatomicalHand(
    handSide: 'right' | 'left',
    fingerCurl: [number, number, number],
  ): { root: THREE.Group; wristGroup: THREE.Group; fingers: FingerRig[]; thumbProx: THREE.Group; thumbDist: THREE.Group } {
    const mirror = handSide === 'right' ? 1 : -1;
    const root = new THREE.Group();

    const forearm = new THREE.Mesh(forearmGeo, sleeveMat);
    forearm.position.set(0, 0, 0.24);
    forearm.castShadow = true;
    forearm.receiveShadow = true;

    const cuff = new THREE.Mesh(cuffGeo, cuffMat);
    cuff.position.set(0, 0, 0.075);
    cuff.castShadow = true;
    cuff.receiveShadow = true;

    const cuffRim = new THREE.Mesh(cuffRimGeo, cuffMat);
    cuffRim.position.set(0, 0, 0.048);
    cuffRim.castShadow = true;

    const wristGroup = new THREE.Group();
    wristGroup.position.set(0, 0, 0.025);

    const wrist = new THREE.Mesh(wristGeo, skinMat);
    wrist.position.set(0, 0, 0.018);
    wrist.scale.set(1.06, 0.78, 1.0);
    wrist.castShadow = true;
    wrist.receiveShadow = true;

    // Ulnar bone bump on outer wrist
    const wristBone = new THREE.Mesh(wristBoneGeo, knuckleSkinMat);
    wristBone.position.set(mirror * 0.026, 0.010, 0.015);
    wristBone.castShadow = true;

    // Sculpted Palm + Back of Hand + Muscle Pads
    const handAnchor = new THREE.Group();
    handAnchor.position.set(0, 0, -0.045);

    const palmCore = new THREE.Mesh(palmCoreGeo, skinMat);
    palmCore.castShadow = true;
    palmCore.receiveShadow = true;

    const palmDorsum = new THREE.Mesh(palmDorsumGeo, skinMat);
    palmDorsum.position.set(0, 0.008, 0.002);
    palmDorsum.castShadow = true;
    palmDorsum.receiveShadow = true;

    // Thenar (thumb base) & hypothenar (outer palm) muscle cushions
    const thenar = new THREE.Mesh(thenarGeo, skinMat);
    thenar.position.set(mirror * -0.026, -0.005, 0.014);
    thenar.rotation.y = mirror * 0.35;
    thenar.castShadow = true;
    thenar.receiveShadow = true;

    const hypothenar = new THREE.Mesh(thenarGeo, skinMat);
    hypothenar.scale.set(0.75, 0.65, 1.15);
    hypothenar.position.set(mirror * 0.028, -0.004, 0.016);
    hypothenar.castShadow = true;
    hypothenar.receiveShadow = true;

    handAnchor.add(palmCore, palmDorsum, thenar, hypothenar);

    // 4 Articulated 3-segment fingers (Index -> Pinky across metacarpal ridge)
    const fingerSpecs = [
      { xOff: mirror * -0.027, lenScale: 0.94, splay: mirror * 0.05 },
      { xOff: mirror * -0.009, lenScale: 1.04, splay: 0.0 },
      { xOff: mirror * 0.009, lenScale: 0.96, splay: mirror * -0.04 },
      { xOff: mirror * 0.026, lenScale: 0.78, splay: mirror * -0.09 },
    ];
    const fingers: FingerRig[] = [];

    for (const spec of fingerSpecs) {
      const knuckle = new THREE.Mesh(knuckleGeo, knuckleSkinMat);
      knuckle.position.set(spec.xOff, 0.011, -0.042);
      knuckle.castShadow = true;
      knuckle.receiveShadow = true;
      handAnchor.add(knuckle);

      const prox = new THREE.Group();
      prox.position.set(spec.xOff, 0.004, -0.043);
      prox.rotation.y = spec.splay;
      prox.rotation.x = -fingerCurl[0];
      prox.scale.setScalar(spec.lenScale);

      const proxMesh = new THREE.Mesh(phalanxProxGeo, skinMat);
      proxMesh.castShadow = true;
      proxMesh.receiveShadow = true;
      prox.add(proxMesh);

      const mid = new THREE.Group();
      mid.position.set(0, 0, -0.032);
      mid.rotation.x = -fingerCurl[1];
      const midMesh = new THREE.Mesh(phalanxMidGeo, skinMat);
      midMesh.castShadow = true;
      midMesh.receiveShadow = true;
      mid.add(midMesh);

      const dist = new THREE.Group();
      dist.position.set(0, 0, -0.024);
      dist.rotation.x = -fingerCurl[2];
      const distMesh = new THREE.Mesh(phalanxDistGeo, skinMat);
      distMesh.castShadow = true;
      distMesh.receiveShadow = true;

      const nail = new THREE.Mesh(nailGeo, nailMat);
      nail.position.set(0, 0.0065, -0.013);
      dist.add(distMesh, nail);

      mid.add(dist);
      prox.add(mid);
      handAnchor.add(prox);
      fingers.push({ prox, mid, dist });
    }

    // 2-Segment Articulated Opposable Thumb
    const thumbProx = new THREE.Group();
    thumbProx.position.set(mirror * -0.038, 0.002, 0.004);
    thumbProx.rotation.set(-0.22, mirror * 0.58, mirror * -0.35);
    const thumbProxMesh = new THREE.Mesh(thumbProxGeo, skinMat);
    thumbProxMesh.castShadow = true;
    thumbProxMesh.receiveShadow = true;

    const thumbDist = new THREE.Group();
    thumbDist.position.set(0, 0, -0.028);
    thumbDist.rotation.x = -0.38;
    const thumbDistMesh = new THREE.Mesh(thumbDistGeo, skinMat);
    thumbDistMesh.castShadow = true;
    thumbDistMesh.receiveShadow = true;
    const thumbNail = new THREE.Mesh(nailGeo, nailMat);
    thumbNail.scale.set(1.15, 1.0, 1.1);
    thumbNail.position.set(0, 0.0085, -0.014);
    thumbDist.add(thumbDistMesh, thumbNail);

    thumbProx.add(thumbProxMesh, thumbDist);
    handAnchor.add(thumbProx);

    wristGroup.add(wrist, wristBone, handAnchor);
    root.add(forearm, cuff, cuffRim, wristGroup);

    return { root, wristGroup, fingers, thumbProx, thumbDist };
  }

  // Right Forearm & Anatomical Hand gripping the cork rod handle
  const rightHandRig = createAnatomicalHand('right', [1.02, 1.15, 0.85]);
  // Orient right hand naturally inward (palm facing left/down around cork grip)
  rightHandRig.root.position.set(0.022, -0.012, 0.055);
  rightHandRig.root.rotation.set(0.08, 0.10, 1.25);
  rightHandRig.thumbProx.rotation.set(-0.42, 0.45, -0.55);
  rightHandRig.thumbDist.rotation.x = -0.52;
  rodRoot.add(rightHandRig.root);

  // Left Forearm & Anatomical Hand (resting clearly in view on left armrest + leather/brass watch, curling onto crank when reeling)
  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.34, pierTopY + 0.78, -0.08);

  const leftHandRig = createAnatomicalHand('left', [0.38, 0.46, 0.34]);
  leftHandRig.root.position.set(0.08, 0.04, -0.36);
  leftHandRig.root.rotation.set(-0.08, -0.18, -0.18);

  // Brass & Leather Field Wristwatch on Left Wrist
  const watchGroup = new THREE.Group();
  watchGroup.position.set(0, 0.004, 0.024);
  const watchStrap = new THREE.Mesh(watchStrapGeo, watchLeatherMat);
  watchStrap.scale.set(1.06, 0.80, 1.0);
  watchStrap.castShadow = true;
  const watchCase = new THREE.Mesh(watchCaseGeo, brassMat);
  watchCase.position.set(0, 0.029, 0);
  watchCase.castShadow = true;
  const watchDial = new THREE.Mesh(watchDialGeo, watchDialMat);
  watchDial.position.set(0, 0.034, 0);
  watchGroup.add(watchStrap, watchCase, watchDial);
  leftHandRig.wristGroup.add(watchGroup);

  leftArmPivot.add(leftHandRig.root);
  rigSeatPivot.add(leftArmPivot);

  // Cork Grip & Brass Reel Seat
  const gripGeo = new THREE.CylinderGeometry(0.022, 0.024, 0.34, 12);
  gripGeo.rotateX(Math.PI / 2);
  const seatGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.09, 12);
  seatGeo.rotateX(Math.PI / 2);
  disposables.push(gripGeo, seatGeo);

  const grip = new THREE.Mesh(gripGeo, corkMat);
  grip.position.set(0, 0, -0.02);
  const seat = new THREE.Mesh(seatGeo, brassMat);
  seat.position.set(0, 0, -0.16);
  rodRoot.add(grip, seat);

  // Detailed Spinning Reel
  const reelGroup = new THREE.Group();
  reelGroup.position.set(0, -0.055, -0.17);
  const reelArmGeo = new THREE.BoxGeometry(0.018, 0.075, 0.024);
  const reelSpoolGeo = new THREE.CylinderGeometry(0.034, 0.034, 0.055, 14);
  reelSpoolGeo.rotateX(Math.PI / 2);
  const reelBodyGeo = new THREE.SphereGeometry(0.036, 10, 10);
  disposables.push(reelArmGeo, reelSpoolGeo, reelBodyGeo);

  const reelArm = new THREE.Mesh(reelArmGeo, carbonMat);
  reelArm.position.set(0, 0.03, 0);
  const reelBody = new THREE.Mesh(reelBodyGeo, carbonMat);
  reelBody.position.set(0, -0.015, 0.01);
  const reelSpool = new THREE.Mesh(reelSpoolGeo, brassMat);
  reelSpool.position.set(0, -0.015, -0.035);
  reelGroup.add(reelArm, reelBody, reelSpool);

  const reelCrankPivot = new THREE.Group();
  reelCrankPivot.position.set(-0.042, -0.015, 0.01);
  const crankArmGeo = new THREE.BoxGeometry(0.01, 0.055, 0.012);
  crankArmGeo.translate(0, 0.027, 0);
  const crankKnobGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.026, 8);
  crankKnobGeo.rotateZ(Math.PI / 2);
  crankKnobGeo.translate(-0.014, 0.052, 0);
  disposables.push(crankArmGeo, crankKnobGeo);
  reelCrankPivot.add(new THREE.Mesh(crankArmGeo, brassMat), new THREE.Mesh(crankKnobGeo, corkMat));
  reelGroup.add(reelCrankPivot);
  rodRoot.add(reelGroup);

  // Segmented Flexible Rod Blank (7 hierarchical joints so rod bends smoothly in real time!)
  const rodSegments: THREE.Group[] = [];
  const segLen = 0.36;
  let parentNode: THREE.Object3D = rodRoot;
  const guideGeo = new THREE.TorusGeometry(0.014, 0.003, 6, 12);
  disposables.push(guideGeo);

  for (let i = 0; i < 7; i++) {
    const joint = new THREE.Group();
    joint.position.set(0, i === 0 ? 0.005 : 0, i === 0 ? -0.2 : -segLen);

    const rBottom = 0.014 * (1 - i * 0.11);
    const rTop = 0.014 * (1 - (i + 1) * 0.11);
    const segGeo = new THREE.CylinderGeometry(rTop, rBottom, segLen, 10);
    segGeo.rotateX(Math.PI / 2);
    segGeo.translate(0, 0, -segLen * 0.5);
    disposables.push(segGeo);

    const segMesh = new THREE.Mesh(segGeo, carbonMat);
    segMesh.castShadow = true;
    joint.add(segMesh);

    if (i >= 1) {
      const guide = new THREE.Mesh(guideGeo, brassMat);
      guide.position.set(0, -0.015, -segLen * 0.65);
      guide.scale.setScalar(1 - i * 0.08);
      joint.add(guide);
    }

    parentNode.add(joint);
    rodSegments.push(joint);
    parentNode = joint;
  }

  const rodTipMarker = new THREE.Object3D();
  rodTipMarker.position.set(0, 0, -segLen);
  rodSegments[rodSegments.length - 1].add(rodTipMarker);

  // 6. Floating Red-and-White Bobber + Visible Underwater Bait & Hook
  const bobberGroup = new THREE.Group();
  bobberGroup.visible = false;
  const bobTopGeo = new THREE.SphereGeometry(0.062, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const bobBotGeo = new THREE.SphereGeometry(0.062, 14, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45);
  const bobStemGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.14, 8);
  const bobTopMat = new THREE.MeshStandardMaterial({
    color: 0xd93829,
    emissive: 0xd93829,
    emissiveIntensity: 0.1,
    roughness: 0.35,
  });
  const bobBotMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.35 });
  disposables.push(bobTopGeo, bobBotGeo, bobStemGeo, bobTopMat, bobBotMat);

  bobberGroup.add(new THREE.Mesh(bobTopGeo, bobTopMat));
  bobberGroup.add(new THREE.Mesh(bobBotGeo, bobBotMat));
  const stem = new THREE.Mesh(bobStemGeo, bobTopMat);
  stem.position.y = 0.07;
  bobberGroup.add(stem);
  group.add(bobberGroup);

  // Underwater Bait & Hook assembly (Composite 4-part rig: swivel, shank, curved J-hook + barb, and bait)
  const hookSteelMat = new THREE.MeshStandardMaterial({
    color: 0xd0d9e0,
    roughness: 0.18,
    metalness: 0.9,
  });
  const baitMat = new THREE.MeshStandardMaterial({
    color: BAIT_CATALOG[0].color,
    roughness: 0.44,
    emissive: 0x000000,
    emissiveIntensity: 0.0,
  });
  const swivelGeo = new THREE.TorusGeometry(0.011, 0.0032, 6, 12);
  const shankGeo = new THREE.CylinderGeometry(0.0042, 0.0042, 0.068, 8);
  const hookBendGeo = new THREE.TorusGeometry(0.022, 0.0042, 8, 16, Math.PI * 1.15);
  const barbGeo = new THREE.ConeGeometry(0.006, 0.018, 6);
  const baitGeo = new THREE.CapsuleGeometry(0.022, 0.064, 6, 10);

  const baitMesh = new THREE.Group();
  const swivelMesh = new THREE.Mesh(swivelGeo, brassMat);
  swivelMesh.position.set(0, 0.042, 0);
  const shankMesh = new THREE.Mesh(shankGeo, hookSteelMat);
  shankMesh.position.set(0, 0.004, 0);
  const bendMesh = new THREE.Mesh(hookBendGeo, hookSteelMat);
  bendMesh.position.set(0.022, -0.028, 0);
  bendMesh.rotation.z = Math.PI;
  const barbMesh = new THREE.Mesh(barbGeo, hookSteelMat);
  barbMesh.position.set(0.043, -0.018, 0);
  barbMesh.rotation.z = -0.18;
  const baitCoreMesh = new THREE.Mesh(baitGeo, baitMat);
  baitCoreMesh.position.set(0.016, -0.036, 0);
  baitCoreMesh.rotation.z = 0.72;

  // Curved segmented earthworm threaded directly along the J-hook bend & barb
  const hookedWormCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.004, 0.012, 0.002),
    new THREE.Vector3(0.004, -0.022, 0.006),
    new THREE.Vector3(0.024, -0.044, 0.0),
    new THREE.Vector3(0.043, -0.026, -0.004),
    new THREE.Vector3(0.056, -0.004, 0.010),
    new THREE.Vector3(0.068, 0.018, -0.006),
  ]);
  const hookedWormGeo = new THREE.TubeGeometry(hookedWormCurve, 18, 0.0095, 8, false);
  const hookedWormMesh = new THREE.Mesh(hookedWormGeo, wormMat);

  baitMesh.add(swivelMesh, shankMesh, bendMesh, barbMesh, baitCoreMesh, hookedWormMesh);
  baitMesh.visible = false;
  disposables.push(hookSteelMat, baitMat, swivelGeo, shankGeo, hookBendGeo, barbGeo, baitGeo, hookedWormGeo);
  group.add(baitMesh);

  // Flying/threading worm shown during the tactile worm-hooking animation from the dish onto the J-hook
  const transferWormMesh = new THREE.Mesh(dishWormGeo, wormMat);
  transferWormMesh.visible = false;
  transferWormMesh.scale.setScalar(1.35);
  group.add(transferWormMesh);

  // 7. Dynamic Fishing Line (Catmull-like multi-point polyline from rod tip -> bobber -> bait)
  const linePointsCount = 18;
  const linePositions = new Float32Array(linePointsCount * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  const lineMat = new THREE.LineBasicMaterial({
    color: 0xdcebf2,
    transparent: true,
    opacity: 0.78,
  });
  disposables.push(lineGeo, lineMat);
  const fishingLine = new THREE.Line(lineGeo, lineMat);
  fishingLine.frustumCulled = false;
  group.add(fishingLine);

  const tmpTip = new THREE.Vector3();
  const tmpPt = new THREE.Vector3();
  const tmpLineDir = new THREE.Vector3();
  const tmpLineSide = new THREE.Vector3();
  const tmpDishWorld = new THREE.Vector3();
  const colNormal = new THREE.Color(0xdcebf2);
  const colWarn = new THREE.Color(0xf5b942);
  const colDanger = new THREE.Color(0xff3b30);
  let activeBaitId: BaitId = 'worm';
  let prevDishElapsed = 0;

  function setActiveBaitVisual(baitId: BaitId): void {
    activeBaitId = baitId;
    const b = BAIT_CATALOG.find((item) => item.id === baitId) ?? BAIT_CATALOG[0];
    baitMat.color.setHex(b.color);
    if (b.glow) {
      baitMat.emissive.setHex(b.color);
      baitMat.emissiveIntensity = 0.9;
    } else {
      baitMat.emissive.setHex(0x000000);
      baitMat.emissiveIntensity = 0;
    }
  }

  // Flying/threading bait shown during the tactile bait-hooking animation from dish onto J-hook
  const transferBaitMesh = new THREE.Mesh(baitGeo, baitMat);
  transferBaitMesh.visible = false;
  transferBaitMesh.scale.setScalar(0.95);
  group.add(transferBaitMesh);

  function setUnlockedBaits(unlockedBaits: BaitId[], playerLevel: number): void {
    const hasFly = unlockedBaits.includes('fly');
    const hasCorn = unlockedBaits.includes('golden_corn');
    const hasSpinner = unlockedBaits.includes('spinner');
    const hasGlow = unlockedBaits.includes('glow_minnow');

    for (const slot of dishAdaptiveSlots) {
      slot.flyGroup.visible = hasFly;
      slot.cornGroup.visible = hasCorn;
      slot.spinnerGroup.visible = hasSpinner;
      slot.glowMinnowGroup.visible = hasGlow;
      slot.rimBand.visible = playerLevel >= 2;
    }

    if (playerLevel >= 4) {
      rimUpgradeMat.color.setHex(0xeab308);
      rimUpgradeMat.roughness = 0.22;
      rimUpgradeMat.metalness = 0.92;
      rimUpgradeMat.emissive.setHex(0x422006);
      rimUpgradeMat.emissiveIntensity = 0.25;
    } else if (playerLevel >= 3) {
      rimUpgradeMat.color.setHex(0xc59b47);
      rimUpgradeMat.roughness = 0.28;
      rimUpgradeMat.metalness = 0.86;
      rimUpgradeMat.emissive.setHex(0x000000);
      rimUpgradeMat.emissiveIntensity = 0;
    } else if (playerLevel >= 2) {
      rimUpgradeMat.color.setHex(0xa16207);
      rimUpgradeMat.roughness = 0.38;
      rimUpgradeMat.metalness = 0.68;
      rimUpgradeMat.emissive.setHex(0x000000);
      rimUpgradeMat.emissiveIntensity = 0;
    }
  }

  return {
    group,
    playerRigGroup,
    rodRoot,
    reelCrankPivot,
    bobberGroup,
    bobberGlowMat: bobTopMat,
    baitMesh,
    baitMat,
    fishingLine,
    lanternLight,
    lanternFlameMat,
    boatWormDishGroup,
    wormDishHitTargets,
    boatRadioGroup,
    radioHitTargets,
    setRadioState: (playing, loading, stationIndex) => {
      vintageRadio.setRadioState(playing, loading, stationIndex);
    },
    setRadioHovered: (hovered) => {
      vintageRadio.setHovered(hovered);
    },
    notifyWormStolen: (isOnBoat) => {
      const targetDish: 'pier' | 'boat' = isOnBoat ? 'boat' : 'pier';
      const candidates = dishWorms.filter((dw) => dw.dish === targetDish && dw.stolenTimer <= 0);
      const chosen = candidates.length > 0
        ? candidates[Math.floor(Math.random() * candidates.length)]
        : dishWorms.find((dw) => dw.dish === targetDish);
      if (chosen) {
        chosen.stolenTimer = 5.5;
        chosen.mesh.visible = false;
      }
    },
    setActiveBaitVisual,
    setUnlockedBaits,
    setPlayerRigTransform: (offset, pitch, roll, yaw = 0) => {
      playerRigGroup.position.copy(offset);
      rigSeatPivot.rotation.set(pitch * 0.4, yaw, roll * 0.4);
    },
    getRodTipWorldPos: (out) => {
      rodTipMarker.updateWorldMatrix(true, false);
      return rodTipMarker.getWorldPosition(out);
    },
    updateRodAndLine: ({
      elapsed,
      castBackAngle,
      rodBend,
      rodYawOffset,
      bobberPos,
      lurePos,
      bobberVisible,
      reeling,
      hooked = false,
      hookBaited = true,
      isOnBoat = false,
      baitingProgress = -1,
      nightFactor,
      windStrength,
      coldSnowFactor,
      lineTension,
      heavyFishFactor,
    }) => {
      snowUniform.value = THREE.MathUtils.lerp(snowUniform.value, THREE.MathUtils.clamp(coldSnowFactor, 0, 1), 0.04);
      const stress = THREE.MathUtils.clamp(Math.max(lineTension, heavyFishFactor * 0.68), 0, 1);
      const rodQuiver =
        reeling && stress > 0.48
          ? Math.sin(elapsed * 46) * 0.012 * ((stress - 0.48) / 0.52) * (0.6 + heavyFishFactor * 0.8)
          : 0;

      // Natural handheld seated posture + charging pull-back + subtle breathing + heavy strain tremor
      const breath = Math.sin(elapsed * 1.45) * 0.008;
      rodRoot.rotation.x = 0.28 + castBackAngle * 0.95 - rodBend * 0.24 + breath + rodQuiver * 0.45;
      rodRoot.rotation.y = rodYawOffset - 0.12 + rodQuiver * 0.6;
      rodRoot.rotation.z = Math.sin(elapsed * 0.9) * 0.012 * windStrength + rodQuiver;

      // Progressive bend along rod blank segments + tip quiver under heavy fish load
      rodSegments.forEach((seg, idx) => {
        const weight = (idx + 1) / rodSegments.length;
        const naturalDroop = -0.025 * weight;
        const fightBend = -rodBend * 0.135 * weight;
        const castWhip = castBackAngle * 0.04 * weight;
        const tipShake = idx >= 4 ? Math.sin(elapsed * 62 + idx * 1.3) * 0.018 * Math.max(0, stress - 0.45) * (0.5 + heavyFishFactor) : 0;
        seg.rotation.x = naturalDroop + fightBend + castWhip + tipShake;
      });

      if (reeling) {
        reelCrankPivot.rotation.x -= 0.26;
        // Left hand reaches smoothly over toward the spinning reel crank, rotates wrist & curls fingers onto knob
        leftArmPivot.rotation.y = THREE.MathUtils.lerp(leftArmPivot.rotation.y, -0.54, 0.18);
        leftArmPivot.rotation.x = THREE.MathUtils.lerp(
          leftArmPivot.rotation.x,
          0.16 + Math.sin(reelCrankPivot.rotation.x) * 0.06,
          0.25,
        );
        leftHandRig.root.rotation.z = THREE.MathUtils.lerp(leftHandRig.root.rotation.z, -1.05, 0.18);
        for (const f of leftHandRig.fingers) {
          f.prox.rotation.x = THREE.MathUtils.lerp(f.prox.rotation.x, -0.95, 0.2);
          f.mid.rotation.x = THREE.MathUtils.lerp(f.mid.rotation.x, -1.05, 0.2);
        }
      } else {
        // Left hand rests naturally in relaxed open posture above the left chair armrest
        leftArmPivot.rotation.y = THREE.MathUtils.lerp(leftArmPivot.rotation.y, -0.02 + rodYawOffset * 0.18, 0.12);
        leftArmPivot.rotation.x = THREE.MathUtils.lerp(leftArmPivot.rotation.x, 0.01 + breath * 0.7, 0.12);
        leftHandRig.root.rotation.z = THREE.MathUtils.lerp(leftHandRig.root.rotation.z, -0.18, 0.12);
        for (const f of leftHandRig.fingers) {
          f.prox.rotation.x = THREE.MathUtils.lerp(f.prox.rotation.x, -0.38, 0.12);
          f.mid.rotation.x = THREE.MathUtils.lerp(f.mid.rotation.x, -0.46, 0.12);
        }
      }

      // Lantern & bobber night illumination
      lanternLight.intensity = THREE.MathUtils.lerp(0, 3.6, nightFactor) + Math.sin(elapsed * 7.5) * 0.15 * nightFactor;
      lanternFlameMat.emissiveIntensity = THREE.MathUtils.lerp(0.25, 2.6, nightFactor);
      bobTopMat.emissiveIntensity = THREE.MathUtils.lerp(0.08, 1.4, nightFactor);

      rodRoot.updateMatrixWorld(true);
      rodTipMarker.getWorldPosition(tmpTip);

      bobberGroup.visible = bobberVisible;
      baitMesh.visible = bobberVisible;
      fishingLine.visible = true;

      // Update fishing line color & opacity under heavy load / tension stress
      if (bobberVisible && stress > 0.35) {
        if (stress < 0.70) {
          const k = (stress - 0.35) / 0.35;
          lineMat.color.copy(colNormal).lerp(colWarn, k);
        } else {
          const k = (stress - 0.70) / 0.30;
          lineMat.color.copy(colWarn).lerp(colDanger, k);
        }
        const dangerFlash = stress > 0.75 ? 0.08 * Math.sin(elapsed * 26) : 0;
        lineMat.opacity = THREE.MathUtils.clamp(0.78 + stress * 0.18 + dangerFlash, 0.75, 0.98);
      } else {
        lineMat.color.copy(colNormal);
        lineMat.opacity = 0.78;
      }

      // Wriggle worms continuously inside the ceramic dish + gently pulse highlight when hook is empty
      const dishDt = prevDishElapsed > 0 ? Math.min(0.1, Math.max(0, elapsed - prevDishElapsed)) : 0.016;
      prevDishElapsed = elapsed;
      for (let wi = 0; wi < dishWorms.length; wi++) {
        const dw = dishWorms[wi];
        if (dw.stolenTimer > 0) {
          dw.stolenTimer = Math.max(0, dw.stolenTimer - dishDt);
          dw.mesh.visible = dw.stolenTimer <= 0;
          if (!dw.mesh.visible) continue;
        } else {
          dw.mesh.visible = true;
        }
        const sq = Math.sin(elapsed * 3.6 + dw.phase);
        const sq2 = Math.cos(elapsed * 2.5 + dw.phase * 1.3);
        dw.mesh.rotation.y = dw.baseRotY + sq * 0.14;
        dw.mesh.rotation.z = sq2 * 0.08;
        dw.mesh.position.x = dw.baseX + sq2 * 0.004;
        dw.mesh.position.z = dw.baseZ + sq * 0.004;
      }
      // Night luminescence & subtle highlight on adaptive dish glow minnow + ring highlight
      glowMinnowMat.emissiveIntensity = 0.45 + nightFactor * 0.9 + Math.sin(elapsed * 3.1) * 0.18;
      const needBaitPulse = !bobberVisible && !hookBaited && baitingProgress < 0;
      wormHighlightRingMat.opacity = needBaitPulse ? 0.35 + Math.sin(elapsed * 4.5) * 0.25 : 0.0;
      for (let ri = 0; ri < dishRings.length; ri++) {
        dishRings[ri].visible = needBaitPulse;
      }

      // Animate vintage radio glowing dial, moving needle, and subtle acoustic cloth pulse
      vintageRadio.update(dishDt, elapsed, nightFactor, coldSnowFactor);

      const isBaitingNow = baitingProgress >= 0 && baitingProgress <= 1;
      const showBaitedVisual = hookBaited && !isBaitingNow;
      hookedWormMesh.visible = showBaitedVisual && activeBaitId === 'worm';
      baitCoreMesh.visible = showBaitedVisual && activeBaitId !== 'worm';
      if (hookedWormMesh.visible) {
        hookedWormMesh.rotation.x = Math.sin(elapsed * 7.2) * 0.14;
        hookedWormMesh.rotation.z = Math.cos(elapsed * 5.8) * 0.10;
      }

      if (bobberVisible) {
        bobberGroup.position.copy(bobberPos);
        baitMesh.position.copy(lurePos);
        baitMesh.scale.setScalar(hooked ? 1.75 : 1.0);
        if (!hooked && !reeling) {
          baitMesh.rotation.y = elapsed * 1.8;
        }
        transferWormMesh.visible = false;
        transferBaitMesh.visible = false;

        // First 14 points: taut catenary curve from rod tip to bobber + high-frequency stress vibration
        const sag = Math.max(0.005, 0.35 * (1 - Math.max(rodBend, stress)));
        tmpLineDir.subVectors(bobberPos, tmpTip).normalize();
        tmpLineSide.set(-tmpLineDir.z, 0, tmpLineDir.x);
        if (tmpLineSide.lengthSq() < 0.001) tmpLineSide.set(1, 0, 0);
        else tmpLineSide.normalize();

        const vibAmp =
          stress > 0.38
            ? ((stress - 0.38) / 0.62) * 0.044 * (0.55 + heavyFishFactor * 0.85)
            : 0;

        for (let i = 0; i < 14; i++) {
          const t = i / 13;
          tmpPt.lerpVectors(tmpTip, bobberPos, t);
          tmpPt.y -= Math.sin(t * Math.PI) * sag;

          if (vibAmp > 0.0005 && i > 0 && i < 13) {
            const env = Math.sin(t * Math.PI);
            const h1 = Math.sin(elapsed * 58 + t * 14.0);
            const h2 = Math.cos(elapsed * 94 - t * 22.0);
            const offsetSide = (h1 * 0.72 + h2 * 0.28) * vibAmp * env;
            const offsetVert = (h2 * 0.65 - h1 * 0.35) * vibAmp * 0.65 * env;
            tmpPt.addScaledVector(tmpLineSide, offsetSide);
            tmpPt.y += offsetVert;
          }

          linePositions[i * 3] = tmpPt.x;
          linePositions[i * 3 + 1] = tmpPt.y;
          linePositions[i * 3 + 2] = tmpPt.z;
        }
        // Remaining 4 points: underwater drop from bobber down to lure/hook
        for (let i = 14; i < linePointsCount; i++) {
          const t = (i - 13) / (linePointsCount - 14);
          tmpPt.lerpVectors(bobberPos, lurePos, t);
          linePositions[i * 3] = tmpPt.x;
          linePositions[i * 3 + 1] = tmpPt.y;
          linePositions[i * 3 + 2] = tmpPt.z;
        }
      } else {
        // Idle dangling bobber & hook right beneath rod tip (tilts closer if actively baiting a worm or lure)
        const dipOffset = isBaitingNow ? Math.sin(baitingProgress * Math.PI) * 0.22 : 0;
        bobberGroup.visible = true;
        bobberGroup.position.set(tmpTip.x, tmpTip.y - 0.50 - dipOffset * 0.5, tmpTip.z);
        baitMesh.visible = true;
        baitMesh.scale.setScalar(1.15);
        baitMesh.position.set(tmpTip.x, tmpTip.y - 0.80 - dipOffset, tmpTip.z);
        baitMesh.rotation.y = elapsed * 1.1;

        if (isBaitingNow) {
          const activeDish = isOnBoat ? boatWormDish : pierWormDish;
          activeDish.getWorldPosition(tmpDishWorld);
          tmpDishWorld.y += 0.06;
          const easeT = baitingProgress * baitingProgress * (3 - 2 * baitingProgress);
          const activeTransfer = activeBaitId === 'worm' ? transferWormMesh : transferBaitMesh;
          const inactiveTransfer = activeBaitId === 'worm' ? transferBaitMesh : transferWormMesh;
          inactiveTransfer.visible = false;
          activeTransfer.visible = true;
          activeTransfer.position.lerpVectors(tmpDishWorld, baitMesh.position, easeT);
          activeTransfer.position.y += Math.sin(easeT * Math.PI) * 0.38;
          activeTransfer.rotation.y = elapsed * 10.0;
          activeTransfer.rotation.z = Math.sin(elapsed * 14.0) * 0.45;
        } else {
          transferWormMesh.visible = false;
          transferBaitMesh.visible = false;
        }

        for (let i = 0; i < linePointsCount; i++) {
          const t = i / (linePointsCount - 1);
          tmpPt.set(tmpTip.x, tmpTip.y - t * (0.80 + dipOffset), tmpTip.z);
          linePositions[i * 3] = tmpPt.x;
          linePositions[i * 3 + 1] = tmpPt.y;
          linePositions[i * 3 + 2] = tmpPt.z;
        }
      }

      lineGeo.attributes.position.needsUpdate = true;
      return tmpTip;
    },
    dispose: () => {
      vintageRadio.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}
