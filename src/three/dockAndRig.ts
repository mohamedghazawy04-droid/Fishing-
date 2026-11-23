import * as THREE from 'three';
import type { ProceduralTextureSet } from './textures';
import { groundHeightAt } from './environment';
import { BAIT_CATALOG, type BaitId } from '../types/fishing';

export interface DockAndRigSystem {
  group: THREE.Group;
  rodRoot: THREE.Group;
  reelCrankPivot: THREE.Group;
  bobberGroup: THREE.Group;
  bobberGlowMat: THREE.MeshStandardMaterial;
  baitMesh: THREE.Mesh;
  baitMat: THREE.MeshStandardMaterial;
  fishingLine: THREE.Line;
  lanternLight: THREE.PointLight;
  lanternFlameMat: THREE.MeshStandardMaterial;
  setActiveBaitVisual: (baitId: BaitId) => void;
  updateRodAndLine: (params: {
    elapsed: number;
    castBackAngle: number; // 0..1 when charging
    rodBend: number; // 0..1 when fighting fish
    rodYawOffset: number;
    bobberPos: THREE.Vector3;
    lurePos: THREE.Vector3;
    bobberVisible: boolean;
    reeling: boolean;
    nightFactor: number;
    windStrength: number;
  }) => THREE.Vector3;
  getRodTipWorldPos: (out: THREE.Vector3) => THREE.Vector3;
  dispose: () => void;
}

export function createDockAndRig(textures: ProceduralTextureSet): DockAndRigSystem {
  const group = new THREE.Group();
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

  // 4 Chair legs grounded on pier
  for (const [lx, lz] of [[-0.31, -0.26], [0.31, -0.26], [-0.31, 0.26], [0.31, 0.26]]) {
    const leg = new THREE.Mesh(legGeo, darkTimberMat);
    leg.position.set(lx, 0.22, lz);
    leg.castShadow = true;
    chairGroup.add(leg);
  }
  const seatFrame = new THREE.Mesh(seatFrameGeo, pierWoodMat);
  seatFrame.position.set(0, 0.44, -0.04);
  seatFrame.castShadow = true;
  chairGroup.add(seatFrame);

  const cushion = new THREE.Mesh(cushionGeo, canvasFabricMat);
  cushion.position.set(0, 0.485, -0.04);
  cushion.receiveShadow = true;
  chairGroup.add(cushion);

  // Backrest tilted slightly back (+Z)
  const backGroup = new THREE.Group();
  backGroup.position.set(0, 0.46, 0.26);
  backGroup.rotation.x = 0.16;
  for (const bx of [-0.30, 0.30]) {
    const bp = new THREE.Mesh(backPostGeo, darkTimberMat);
    bp.position.set(bx, 0.32, 0);
    backGroup.add(bp);
  }
  const backCanvas = new THREE.Mesh(backCanvasGeo, canvasFabricMat);
  backCanvas.position.set(0, 0.38, 0);
  backGroup.add(backCanvas);
  chairGroup.add(backGroup);

  // Extended Left & Right Wooden Armrests clearly framing the lower viewport corners during fishing
  for (const ax of [-0.35, 0.35]) {
    const arm = new THREE.Mesh(armGeo, pierWoodMat);
    arm.position.set(ax, 0.72, -0.10);
    arm.castShadow = true;
    const armCap = new THREE.Mesh(armCapGeo, pierWoodMat);
    armCap.position.set(ax, 0.72, -0.44);
    armCap.castShadow = true;
    const frontPost = new THREE.Mesh(armPostGeo, darkTimberMat);
    frontPost.position.set(ax, 0.57, -0.34);
    const rearPost = new THREE.Mesh(armPostGeo, darkTimberMat);
    rearPost.position.set(ax, 0.57, 0.16);
    chairGroup.add(arm, armCap, frontPost, rearPost);
  }
  group.add(chairGroup);

  // 3. Seated Fisherman Lower Body (knees & boots resting naturally on pier planks)
  const bodyGroup = new THREE.Group();
  bodyGroup.position.set(0, pierTopY, 2.30);

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

    const shin = new THREE.Mesh(shinGeo, denimMat);
    shin.position.set(side * 0.165, 0.28, -0.45);
    shin.rotation.x = 0.12;
    shin.castShadow = true;

    const boot = new THREE.Mesh(bootGeo, bootMat);
    boot.position.set(side * 0.175, 0.05, -0.54);
    boot.rotation.y = side * -0.08;
    boot.castShadow = true;
    boot.receiveShadow = true;

    bodyGroup.add(thigh, shin, boot);
  }
  group.add(bodyGroup);

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
  const lGlass = new THREE.Mesh(lGlassGeo, lGlassMat);
  lGlass.position.y = 0.18;
  const lCap = new THREE.Mesh(lCapGeo, brassMat);
  lCap.position.y = 0.33;
  const lFlame = new THREE.Mesh(lFlameGeo, lanternFlameMat);
  lFlame.position.y = 0.16;
  lanternGroup.add(lBase, lGlass, lCap, lFlame);

  const lanternLight = new THREE.PointLight(0xffa94d, 0.0, 14, 1.8);
  lanternLight.position.set(0, 0.22, 0);
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
  const tbLid = new THREE.Mesh(tbLidGeo, pierWoodMat);
  tbLid.position.y = 0.24;
  const tbLatch = new THREE.Mesh(tbLatchGeo, brassMat);
  tbLatch.position.set(0, 0.21, -0.13);
  tackleBox.add(tbBody, tbLid, tbLatch);
  group.add(tackleBox);

  // 5. Articulated First-Person 3D Fishing Rod & Both Fisherman Hands in Foreground
  const rodRoot = new THREE.Group();
  rodRoot.position.set(0.24, pierTopY + 0.90, 1.82);
  group.add(rodRoot);

  // Right Forearm, Cuff, Hand, Thumb & Fingers gripping rod cork handle
  const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x7e4a2b, roughness: 0.85 });
  const cuffMat = new THREE.MeshStandardMaterial({ color: 0x5d351e, roughness: 0.88 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc99674, roughness: 0.72 });
  const forearmGeo = new THREE.CapsuleGeometry(0.048, 0.34, 6, 10);
  forearmGeo.rotateX(Math.PI / 2);
  const cuffGeo = new THREE.CylinderGeometry(0.050, 0.052, 0.05, 10);
  cuffGeo.rotateX(Math.PI / 2);
  const wristGeo = new THREE.CylinderGeometry(0.036, 0.040, 0.07, 10);
  wristGeo.rotateX(Math.PI / 2);
  const handGeo = new THREE.SphereGeometry(0.046, 10, 8);
  handGeo.scale(0.88, 0.82, 1.25);
  const fingerGeo = new THREE.CapsuleGeometry(0.011, 0.038, 4, 6);
  const thumbGeo = new THREE.CapsuleGeometry(0.012, 0.034, 4, 6);
  disposables.push(sleeveMat, cuffMat, skinMat, forearmGeo, cuffGeo, wristGeo, handGeo, fingerGeo, thumbGeo);

  const rightArmHolder = new THREE.Group();
  rightArmHolder.position.set(0.02, -0.02, 0.02);
  const rightForearm = new THREE.Mesh(forearmGeo, sleeveMat);
  rightForearm.position.set(0.03, -0.04, 0.25);
  rightForearm.rotation.set(0.18, 0.14, 0);
  rightForearm.castShadow = true;
  const rightCuff = new THREE.Mesh(cuffGeo, cuffMat);
  rightCuff.position.set(0.01, -0.01, 0.09);
  const rightWrist = new THREE.Mesh(wristGeo, skinMat);
  rightWrist.position.set(0.005, -0.005, 0.045);
  const rightHand = new THREE.Mesh(handGeo, skinMat);
  rightHand.position.set(0, 0.0, 0.0);
  rightHand.castShadow = true;
  rightArmHolder.add(rightForearm, rightCuff, rightWrist, rightHand);

  for (let f = 0; f < 4; f++) {
    const finger = new THREE.Mesh(fingerGeo, skinMat);
    finger.position.set(-0.022, -0.008, -0.03 + f * 0.018);
    finger.rotation.z = Math.PI * 0.42;
    rightArmHolder.add(finger);
  }
  const rightThumb = new THREE.Mesh(thumbGeo, skinMat);
  rightThumb.position.set(-0.024, 0.024, -0.01);
  rightThumb.rotation.set(0.4, 0, -0.35);
  rightArmHolder.add(rightThumb);
  rodRoot.add(rightArmHolder);

  // Left Forearm & Hand (visibly resting on left foreground near rod/armrest and moving to crank reel when reeling!)
  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.30, pierTopY + 0.78, 2.22);
  const leftSleeve = new THREE.Mesh(forearmGeo, sleeveMat);
  leftSleeve.position.set(0.04, 0.02, -0.18);
  leftSleeve.rotation.set(-0.14, -0.20, 0);
  leftSleeve.castShadow = true;
  const leftCuff = new THREE.Mesh(cuffGeo, cuffMat);
  leftCuff.position.set(0.08, 0.045, -0.34);
  leftCuff.rotation.y = -0.20;
  const leftHandGroup = new THREE.Group();
  leftHandGroup.position.set(0.10, 0.055, -0.40);
  const leftWrist = new THREE.Mesh(wristGeo, skinMat);
  leftWrist.position.set(0, 0, 0.03);
  const leftPalm = new THREE.Mesh(handGeo, skinMat);
  leftPalm.scale.set(0.95, 0.78, 1.15);
  leftPalm.castShadow = true;
  leftHandGroup.add(leftWrist, leftPalm);
  for (let f = 0; f < 4; f++) {
    const lf = new THREE.Mesh(fingerGeo, skinMat);
    lf.position.set(0.022, -0.006, -0.025 + f * 0.017);
    lf.rotation.z = -Math.PI * 0.42;
    leftHandGroup.add(lf);
  }
  const leftThumb = new THREE.Mesh(thumbGeo, skinMat);
  leftThumb.position.set(0.024, 0.022, -0.01);
  leftThumb.rotation.set(0.35, 0, 0.35);
  leftHandGroup.add(leftThumb);
  leftArmPivot.add(leftSleeve, leftCuff, leftHandGroup);
  group.add(leftArmPivot);

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

  // Underwater Bait & Hook assembly
  const baitGeo = new THREE.CapsuleGeometry(0.024, 0.075, 4, 8);
  const baitMat = new THREE.MeshStandardMaterial({
    color: BAIT_CATALOG[0].color,
    roughness: 0.45,
    emissive: 0x000000,
    emissiveIntensity: 0.0,
  });
  const baitMesh = new THREE.Mesh(baitGeo, baitMat);
  baitMesh.visible = false;
  disposables.push(baitGeo, baitMat);
  group.add(baitMesh);

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

  function setActiveBaitVisual(baitId: BaitId): void {
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

  return {
    group,
    rodRoot,
    reelCrankPivot,
    bobberGroup,
    bobberGlowMat: bobTopMat,
    baitMesh,
    baitMat,
    fishingLine,
    lanternLight,
    lanternFlameMat,
    setActiveBaitVisual,
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
      nightFactor,
      windStrength,
    }) => {
      // Natural handheld seated posture + charging pull-back + subtle breathing
      const breath = Math.sin(elapsed * 1.45) * 0.008;
      rodRoot.rotation.x = 0.28 + castBackAngle * 0.95 - rodBend * 0.24 + breath;
      rodRoot.rotation.y = rodYawOffset - 0.12;
      rodRoot.rotation.z = Math.sin(elapsed * 0.9) * 0.012 * windStrength;

      // Progressive bend along rod blank segments
      rodSegments.forEach((seg, idx) => {
        const weight = (idx + 1) / rodSegments.length;
        const naturalDroop = -0.025 * weight;
        const fightBend = -rodBend * 0.135 * weight;
        const castWhip = castBackAngle * 0.04 * weight;
        seg.rotation.x = naturalDroop + fightBend + castWhip;
      });

      if (reeling) {
        reelCrankPivot.rotation.x -= 0.26;
        // Left hand reaches smoothly over toward the spinning reel crank & orbits with it
        leftArmPivot.rotation.y = THREE.MathUtils.lerp(leftArmPivot.rotation.y, -0.58, 0.18);
        leftArmPivot.rotation.x = THREE.MathUtils.lerp(
          leftArmPivot.rotation.x,
          0.16 + Math.sin(reelCrankPivot.rotation.x) * 0.06,
          0.25,
        );
      } else {
        // Left hand rests naturally in view above the left chair armrest
        leftArmPivot.rotation.y = THREE.MathUtils.lerp(leftArmPivot.rotation.y, -0.04 + rodYawOffset * 0.18, 0.12);
        leftArmPivot.rotation.x = THREE.MathUtils.lerp(leftArmPivot.rotation.x, 0.02 + breath * 0.7, 0.12);
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

      if (bobberVisible) {
        bobberGroup.position.copy(bobberPos);
        baitMesh.position.copy(lurePos);
        baitMesh.rotation.y = elapsed * 1.8;

        // First 14 points: catenary curve from rod tip to bobber
        const sag = Math.max(0.02, 0.35 * (1 - rodBend));
        for (let i = 0; i < 14; i++) {
          const t = i / 13;
          tmpPt.lerpVectors(tmpTip, bobberPos, t);
          tmpPt.y -= Math.sin(t * Math.PI) * sag;
          linePositions[i * 3] = tmpPt.x;
          linePositions[i * 3 + 1] = tmpPt.y;
          linePositions[i * 3 + 2] = tmpPt.z;
        }
        // Remaining 4 points: straight underwater drop from bobber down to lure/hook
        for (let i = 14; i < linePointsCount; i++) {
          const t = (i - 13) / (linePointsCount - 14);
          tmpPt.lerpVectors(bobberPos, lurePos, t);
          linePositions[i * 3] = tmpPt.x;
          linePositions[i * 3 + 1] = tmpPt.y;
          linePositions[i * 3 + 2] = tmpPt.z;
        }
      } else {
        // Idle dangling bobber right beneath rod tip
        bobberGroup.visible = true;
        bobberGroup.position.set(tmpTip.x, tmpTip.y - 0.55, tmpTip.z);
        baitMesh.visible = true;
        baitMesh.position.set(tmpTip.x, tmpTip.y - 0.85, tmpTip.z);

        for (let i = 0; i < linePointsCount; i++) {
          const t = i / (linePointsCount - 1);
          tmpPt.set(tmpTip.x, tmpTip.y - t * 0.85, tmpTip.z);
          linePositions[i * 3] = tmpPt.x;
          linePositions[i * 3 + 1] = tmpPt.y;
          linePositions[i * 3 + 2] = tmpPt.z;
        }
      }

      lineGeo.attributes.position.needsUpdate = true;
      return tmpTip;
    },
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
