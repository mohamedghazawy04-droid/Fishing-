import * as THREE from 'three';
import { AVATAR_STYLE_OPTIONS, type PlayerAvatarStyle, type PlayerSyncState } from '../types/multiplayer';

export interface RemotePlayerSystem {
  group: THREE.Group;
  update: (params: {
    dt: number;
    elapsed: number;
    remote: PlayerSyncState | null;
    getWaterSurfaceY: (x: number, z: number) => number;
    onRipple: (x: number, z: number, strength: number) => void;
    onSplash: (x: number, z: number, intensity: number) => void;
  }) => void;
  dispose: () => void;
}

function drawNameplateCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  name: string,
  level: number,
  avatarColor: PlayerAvatarStyle,
  isHooked: boolean,
): void {
  ctx.clearRect(0, 0, width, height);

  const accentMap: Record<PlayerAvatarStyle, string> = {
    emerald: '#34d399',
    amber: '#fbbf24',
    sky: '#38bdf8',
    crimson: '#fb7185',
  };
  const accent = accentMap[avatarColor] ?? '#34d399';

  const padX = 18;
  const padY = 14;
  const boxW = width - padX * 2;
  const boxH = height - padY * 2;
  const r = 18;

  ctx.fillStyle = 'rgba(8, 17, 22, 0.86)';
  ctx.beginPath();
  ctx.moveTo(padX + r, padY);
  ctx.lineTo(padX + boxW - r, padY);
  ctx.quadraticCurveTo(padX + boxW, padY, padX + boxW, padY + r);
  ctx.lineTo(padX + boxW, padY + boxH - r);
  ctx.quadraticCurveTo(padX + boxW, padY + boxH, padX + boxW - r, padY + boxH);
  ctx.lineTo(padX + r, padY + boxH);
  ctx.quadraticCurveTo(padX, padY + boxH, padX, padY + boxH - r);
  ctx.lineTo(padX, padY + r);
  ctx.quadraticCurveTo(padX, padY, padX + r, padY);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Status dot on right
  ctx.fillStyle = isHooked ? '#f59e0b' : accent;
  ctx.beginPath();
  ctx.arc(width - 44, height * 0.44, 8, 0, Math.PI * 2);
  ctx.fill();

  // Character Name
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 34px Cairo, Tajawal, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, width * 0.5, height * 0.43);

  // Level + Live badge
  ctx.fillStyle = isHooked ? '#fcd34d' : '#94a3b8';
  ctx.font = '600 22px Cairo, Tajawal, sans-serif';
  ctx.fillText(
    isHooked ? `المستوى ${level} · يسحب سمكة!` : `المستوى ${level} · صديق أونلاين`,
    width * 0.5,
    height * 0.74,
  );
}

export function createRemotePlayerSystem(): RemotePlayerSystem {
  const group = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

  // Shared materials
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6f4a2b, roughness: 0.85 });
  const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x3f2a19, roughness: 0.9 });
  const fabricMat = new THREE.MeshStandardMaterial({ color: 0x2b4539, roughness: 0.92 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xdfa987, roughness: 0.58 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x2a3b4c, roughness: 0.9 });
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x2e1f16, roughness: 0.82 });
  const jacketMat = new THREE.MeshStandardMaterial({ color: 0x2a664b, roughness: 0.84 });
  const hatMat = new THREE.MeshStandardMaterial({ color: 0x4b6344, roughness: 0.88 });
  const carbonMat = new THREE.MeshStandardMaterial({ color: 0x1e2529, roughness: 0.35, metalness: 0.5 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xc59b47, roughness: 0.28, metalness: 0.85 });
  const bobRedMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.35 });
  const bobWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35 });
  const lineMat = new THREE.LineBasicMaterial({ color: 0xdbeaf2, transparent: true, opacity: 0.78 });
  const lanternMat = new THREE.MeshStandardMaterial({
    color: 0xffc86b,
    emissive: 0xffa73b,
    emissiveIntensity: 0.9,
    roughness: 0.2,
  });
  const fishMat = new THREE.MeshStandardMaterial({ color: 0x4b8f83, roughness: 0.25, metalness: 0.35 });

  disposables.push(
    woodMat,
    darkWoodMat,
    fabricMat,
    skinMat,
    pantsMat,
    bootMat,
    jacketMat,
    hatMat,
    carbonMat,
    brassMat,
    bobRedMat,
    bobWhiteMat,
    lineMat,
    lanternMat,
    fishMat,
  );

  // 1. Partner Pier Chair (appears on left side of pier when remote player is on pier)
  const pierChairGroup = new THREE.Group();
  pierChairGroup.position.set(-0.92, 0.72, 1.85);
  pierChairGroup.rotation.y = -0.14;

  const legGeo = new THREE.CylinderGeometry(0.024, 0.02, 0.42, 8);
  const seatGeo = new THREE.BoxGeometry(0.56, 0.06, 0.52);
  const backGeo = new THREE.BoxGeometry(0.54, 0.38, 0.05);
  const backPostGeo = new THREE.CylinderGeometry(0.02, 0.022, 0.58, 8);
  disposables.push(legGeo, seatGeo, backGeo, backPostGeo);

  for (const [lx, lz] of [[-0.24, -0.22], [0.24, -0.22], [-0.24, 0.22], [0.24, 0.22]]) {
    const leg = new THREE.Mesh(legGeo, darkWoodMat);
    leg.position.set(lx, 0.21, lz);
    leg.castShadow = true;
    pierChairGroup.add(leg);
  }
  const cSeat = new THREE.Mesh(seatGeo, fabricMat);
  cSeat.position.set(0, 0.44, 0);
  cSeat.castShadow = true;
  pierChairGroup.add(cSeat);

  for (const bx of [-0.24, 0.24]) {
    const bp = new THREE.Mesh(backPostGeo, darkWoodMat);
    bp.position.set(bx, 0.72, 0.24);
    bp.rotation.x = 0.14;
    pierChairGroup.add(bp);
  }
  const cBack = new THREE.Mesh(backGeo, fabricMat);
  cBack.position.set(0, 0.79, 0.26);
  cBack.rotation.x = 0.14;
  cBack.castShadow = true;
  pierChairGroup.add(cBack);
  pierChairGroup.visible = false;
  group.add(pierChairGroup);

  // 2. Partner Boat (appears at remote player's coordinates when remote.isOnBoat === true)
  const partnerBoatGroup = new THREE.Group();
  const boatHullGeo = new THREE.BoxGeometry(1.42, 0.42, 3.3);
  const boatBowGeo = new THREE.ConeGeometry(0.74, 1.15, 4);
  boatBowGeo.rotateY(Math.PI * 0.25);
  boatBowGeo.rotateX(-Math.PI * 0.5);
  const boatDeckGeo = new THREE.BoxGeometry(1.22, 0.06, 2.95);
  const boatThwartGeo = new THREE.BoxGeometry(1.28, 0.08, 0.36);
  const boatLanternGeo = new THREE.SphereGeometry(0.065, 10, 10);
  disposables.push(boatHullGeo, boatBowGeo, boatDeckGeo, boatThwartGeo, boatLanternGeo);

  const bHull = new THREE.Mesh(boatHullGeo, woodMat);
  bHull.position.set(0, 0.1, 0.15);
  bHull.castShadow = true;
  bHull.receiveShadow = true;
  const bBow = new THREE.Mesh(boatBowGeo, darkWoodMat);
  bBow.scale.set(1.0, 0.52, 1.0);
  bBow.position.set(0, 0.12, -2.02);
  bBow.castShadow = true;
  const bDeck = new THREE.Mesh(boatDeckGeo, darkWoodMat);
  bDeck.position.set(0, 0.25, 0.12);
  const bSeat = new THREE.Mesh(boatThwartGeo, woodMat);
  bSeat.position.set(0, 0.34, 0.2);
  const bLantern = new THREE.Mesh(boatLanternGeo, lanternMat);
  bLantern.position.set(0, 0.44, -1.75);

  partnerBoatGroup.add(bHull, bBow, bDeck, bSeat, bLantern);
  partnerBoatGroup.visible = false;
  group.add(partnerBoatGroup);

  // 3. Articulated Remote Fisherman Avatar + Rod
  const anglerRoot = new THREE.Group();
  anglerRoot.visible = false;

  const thighGeo = new THREE.CapsuleGeometry(0.072, 0.28, 5, 8);
  thighGeo.rotateX(Math.PI / 2);
  const shinGeo = new THREE.CapsuleGeometry(0.06, 0.32, 5, 8);
  const bootGeo = new THREE.BoxGeometry(0.13, 0.09, 0.24);
  const torsoGeo = new THREE.CapsuleGeometry(0.17, 0.36, 6, 10);
  const armGeo = new THREE.CapsuleGeometry(0.052, 0.32, 4, 8);
  armGeo.rotateX(Math.PI / 2);
  armGeo.translate(0, 0, -0.16);
  const handGeo = new THREE.SphereGeometry(0.045, 8, 8);
  const headGeo = new THREE.SphereGeometry(0.125, 12, 10);
  const hatBrimGeo = new THREE.CylinderGeometry(0.22, 0.23, 0.02, 14);
  const hatCrownGeo = new THREE.CylinderGeometry(0.12, 0.135, 0.11, 12);
  const reelBodyGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.055, 10);
  reelBodyGeo.rotateZ(Math.PI / 2);
  const crankGeo = new THREE.BoxGeometry(0.012, 0.055, 0.014);
  crankGeo.translate(0, 0.026, 0);
  const rodSegGeo = new THREE.CylinderGeometry(0.008, 0.014, 0.46, 8);
  rodSegGeo.rotateX(Math.PI / 2);
  rodSegGeo.translate(0, 0, -0.23);

  disposables.push(
    thighGeo,
    shinGeo,
    bootGeo,
    torsoGeo,
    armGeo,
    handGeo,
    headGeo,
    hatBrimGeo,
    hatCrownGeo,
    reelBodyGeo,
    crankGeo,
    rodSegGeo,
  );

  for (const side of [-1, 1]) {
    const thigh = new THREE.Mesh(thighGeo, pantsMat);
    thigh.position.set(side * 0.13, 0.5, -0.16);
    const shin = new THREE.Mesh(shinGeo, pantsMat);
    shin.position.set(side * 0.13, 0.24, -0.34);
    const boot = new THREE.Mesh(bootGeo, bootMat);
    boot.position.set(side * 0.13, 0.06, -0.4);
    anglerRoot.add(thigh, shin, boot);
  }

  const torsoPivot = new THREE.Group();
  torsoPivot.position.set(0, 0.52, 0.02);

  const torso = new THREE.Mesh(torsoGeo, jacketMat);
  torso.position.y = 0.26;
  torso.castShadow = true;
  torsoPivot.add(torso);

  const head = new THREE.Mesh(headGeo, skinMat);
  head.position.set(0, 0.62, -0.02);
  head.castShadow = true;
  const hatBrim = new THREE.Mesh(hatBrimGeo, hatMat);
  hatBrim.position.set(0, 0.70, -0.02);
  hatBrim.castShadow = true;
  const hatCrown = new THREE.Mesh(hatCrownGeo, hatMat);
  hatCrown.position.set(0, 0.75, -0.02);
  hatCrown.castShadow = true;
  torsoPivot.add(head, hatBrim, hatCrown);

  // Right arm holding fishing rod (pointing forward along -Z)
  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.20, 0.42, -0.02);
  const rightArmMesh = new THREE.Mesh(armGeo, jacketMat);
  rightArmMesh.castShadow = true;
  const rightHand = new THREE.Mesh(handGeo, skinMat);
  rightHand.position.set(0, 0, -0.34);
  rightArmPivot.add(rightArmMesh, rightHand);
  torsoPivot.add(rightArmPivot);

  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.20, 0.42, -0.02);
  leftArmPivot.rotation.set(-0.45, -0.45, 0);
  const leftArmMesh = new THREE.Mesh(armGeo, jacketMat);
  leftArmMesh.castShadow = true;
  const leftHand = new THREE.Mesh(handGeo, skinMat);
  leftHand.position.set(0, 0, -0.34);
  leftArmPivot.add(leftArmMesh, leftHand);
  torsoPivot.add(leftArmPivot);

  const rodPivot = new THREE.Group();
  rodPivot.position.set(0, -0.02, -0.32);
  rodPivot.rotation.x = 0.32;

  const reelBody = new THREE.Mesh(reelBodyGeo, brassMat);
  reelBody.position.set(0, -0.055, -0.24);
  const reelCrankPivot = new THREE.Group();
  reelCrankPivot.position.set(-0.04, -0.055, -0.24);
  reelCrankPivot.add(new THREE.Mesh(crankGeo, brassMat));
  rodPivot.add(reelBody, reelCrankPivot);

  const rodSegments: THREE.Group[] = [];
  let parentNode: THREE.Object3D = rodPivot;
  for (let s = 0; s < 5; s++) {
    const segGroup = new THREE.Group();
    segGroup.position.set(0, 0, s === 0 ? 0 : -0.45);
    const segMesh = new THREE.Mesh(rodSegGeo, carbonMat);
    segMesh.scale.set(1 - s * 0.14, 1 - s * 0.14, 1);
    segMesh.castShadow = true;
    segGroup.add(segMesh);
    parentNode.add(segGroup);
    rodSegments.push(segGroup);
    parentNode = segGroup;
  }
  const rodTipMarker = new THREE.Object3D();
  rodTipMarker.position.set(0, 0, -0.46);
  rodSegments[rodSegments.length - 1].add(rodTipMarker);

  rightArmPivot.add(rodPivot);
  anglerRoot.add(torsoPivot);

  // 4. Floating 3D Nameplate Sprite above head
  const nameCanvas = document.createElement('canvas');
  nameCanvas.width = 512;
  nameCanvas.height = 144;
  const nameCtx = nameCanvas.getContext('2d')!;
  const nameTex = new THREE.CanvasTexture(nameCanvas);
  nameTex.colorSpace = THREE.SRGBColorSpace;
  const nameMat = new THREE.SpriteMaterial({
    map: nameTex,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  const nameSprite = new THREE.Sprite(nameMat);
  nameSprite.position.set(0, 1.62, 0);
  nameSprite.scale.set(1.75, 0.49, 1);
  anglerRoot.add(nameSprite);
  disposables.push(nameTex, nameMat);

  group.add(anglerRoot);

  // 5. Remote Bobber, Line & Hooked Fish Preview
  const bobTopGeo = new THREE.SphereGeometry(0.062, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const bobBotGeo = new THREE.SphereGeometry(0.062, 10, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45);
  const bobberGroup = new THREE.Group();
  bobberGroup.add(new THREE.Mesh(bobTopGeo, bobRedMat), new THREE.Mesh(bobBotGeo, bobWhiteMat));
  bobberGroup.visible = false;
  group.add(bobberGroup);
  disposables.push(bobTopGeo, bobBotGeo);

  const hookedFishGeo = new THREE.CapsuleGeometry(0.09, 0.34, 6, 10);
  hookedFishGeo.rotateX(Math.PI * 0.5);
  const hookedFishMesh = new THREE.Mesh(hookedFishGeo, fishMat);
  hookedFishMesh.visible = false;
  group.add(hookedFishMesh);
  disposables.push(hookedFishGeo);

  const LINE_PTS = 16;
  const linePositions = new Float32Array(LINE_PTS * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  const fishingLine = new THREE.Line(lineGeo, lineMat);
  fishingLine.frustumCulled = false;
  fishingLine.visible = false;
  group.add(fishingLine);
  disposables.push(lineGeo);

  let smoothX = -0.92;
  let smoothY = 0.72;
  let smoothZ = 1.85;
  let smoothYaw = -0.14;
  let smoothBobX = -0.92;
  let smoothBobY = 0;
  let smoothBobZ = -8;
  let hasInitPos = false;
  let lastBadgeKey = '';
  let lastPhase = '';
  let rippleCooldown = 0;

  const tmpTip = new THREE.Vector3();

  return {
    group,
    update: ({ dt, elapsed, remote, getWaterSurfaceY, onRipple, onSplash }) => {
      if (!remote) {
        pierChairGroup.visible = false;
        partnerBoatGroup.visible = false;
        anglerRoot.visible = false;
        bobberGroup.visible = false;
        hookedFishMesh.visible = false;
        fishingLine.visible = false;
        hasInitPos = false;
        return;
      }

      const style =
        AVATAR_STYLE_OPTIONS.find((opt) => opt.id === remote.avatarColor) ?? AVATAR_STYLE_OPTIONS[0];
      jacketMat.color.setHex(style.jacketHex);
      hatMat.color.setHex(style.hatHex);

      const isHooked = remote.phase === 'reeling' || remote.phase === 'caught';
      const badgeKey = `${remote.name}|${remote.level}|${remote.avatarColor}|${isHooked ? 1 : 0}`;
      if (badgeKey !== lastBadgeKey) {
        lastBadgeKey = badgeKey;
        drawNameplateCanvas(
          nameCtx,
          nameCanvas.width,
          nameCanvas.height,
          remote.name,
          remote.level,
          remote.avatarColor,
          isHooked,
        );
        nameTex.needsUpdate = true;
      }

      const targetX = remote.isOnBoat ? remote.x : -0.92;
      const targetY = remote.isOnBoat ? getWaterSurfaceY(remote.x, remote.z) : 0.72;
      const targetZ = remote.isOnBoat ? remote.z : 1.85;
      const targetYaw = remote.isOnBoat ? remote.yaw : -0.14 + THREE.MathUtils.clamp(remote.yaw * 0.45, -0.5, 0.5);

      if (!hasInitPos) {
        hasInitPos = true;
        smoothX = targetX;
        smoothY = targetY;
        smoothZ = targetZ;
        smoothYaw = targetYaw;
        smoothBobX = remote.bobberX;
        smoothBobY = remote.bobberY;
        smoothBobZ = remote.bobberZ;
      } else {
        smoothX = THREE.MathUtils.damp(smoothX, targetX, 8, dt);
        smoothY = THREE.MathUtils.damp(smoothY, targetY, 8, dt);
        smoothZ = THREE.MathUtils.damp(smoothZ, targetZ, 8, dt);

        let yawDiff = targetYaw - smoothYaw;
        while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
        while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
        smoothYaw += yawDiff * Math.min(1, dt * 8);

        smoothBobX = THREE.MathUtils.damp(smoothBobX, remote.bobberX, 12, dt);
        smoothBobY = THREE.MathUtils.damp(smoothBobY, remote.bobberY, 12, dt);
        smoothBobZ = THREE.MathUtils.damp(smoothBobZ, remote.bobberZ, 12, dt);
      }

      pierChairGroup.visible = !remote.isOnBoat;
      partnerBoatGroup.visible = remote.isOnBoat;
      anglerRoot.visible = true;

      if (remote.isOnBoat) {
        const wavePitch = Math.sin(elapsed * 1.4 + smoothX * 0.3) * 0.025;
        const waveRoll = Math.cos(elapsed * 1.1 + smoothZ * 0.3) * 0.03;
        partnerBoatGroup.position.set(smoothX, smoothY, smoothZ);
        partnerBoatGroup.rotation.set(wavePitch, smoothYaw, waveRoll);
        anglerRoot.position.set(smoothX, smoothY + 0.2, smoothZ);
        anglerRoot.rotation.set(wavePitch * 0.5, smoothYaw, waveRoll * 0.5);
      } else {
        anglerRoot.position.set(smoothX, 0.72, smoothZ);
        anglerRoot.rotation.set(0, smoothYaw, 0);
      }

      // Trigger splash when remote casts into water
      if (lastPhase === 'casting' && remote.phase === 'waiting') {
        onSplash(smoothBobX, smoothBobZ, 0.8);
      }
      lastPhase = remote.phase;

      // Animate arms & rod bend based on remote fishing phase
      let armPitch = -0.15;
      let rodPitch = 0.28;
      let bendAmt = 0.03;
      let torsoLean = Math.sin(elapsed * 1.3) * 0.03;

      if (remote.phase === 'charging') {
        armPitch = 0.75 * remote.castPower;
        rodPitch = 0.65 * remote.castPower;
        torsoLean = -0.14 * remote.castPower;
        bendAmt = 0.08 * remote.castPower;
      } else if (remote.phase === 'biting') {
        rodPitch = 0.45;
        bendAmt = 0.16;
      } else if (remote.phase === 'reeling') {
        armPitch = 0.18 + Math.sin(elapsed * 4.2) * 0.06;
        rodPitch = 0.55 + Math.sin(elapsed * 5.0) * 0.06;
        torsoLean = 0.16;
        bendAmt = 0.22 + remote.lineTension * 0.14;
        if (remote.reeling) {
          reelCrankPivot.rotation.x -= dt * 11;
        }
      }

      torsoPivot.rotation.x = THREE.MathUtils.damp(torsoPivot.rotation.x, torsoLean, 10, dt);
      rightArmPivot.rotation.x = THREE.MathUtils.damp(rightArmPivot.rotation.x, armPitch, 10, dt);
      rodPivot.rotation.x = THREE.MathUtils.damp(rodPivot.rotation.x, rodPitch, 10, dt);
      for (let s = 0; s < rodSegments.length; s++) {
        rodSegments[s].rotation.x = -bendAmt * ((s + 1) / rodSegments.length);
      }

      anglerRoot.updateMatrixWorld(true);
      rodTipMarker.getWorldPosition(tmpTip);

      // Update remote bobber & line
      const showLine = remote.bobberVisible || remote.phase === 'reeling';
      bobberGroup.visible = remote.bobberVisible;
      fishingLine.visible = showLine;

      if (remote.bobberVisible) {
        bobberGroup.position.set(smoothBobX, smoothBobY, smoothBobZ);
      }

      if (remote.phase === 'reeling') {
        hookedFishMesh.visible = true;
        hookedFishMesh.position.set(smoothBobX, Math.min(-0.14, remote.lureY), smoothBobZ);
        hookedFishMesh.rotation.y = Math.atan2(smoothX - smoothBobX, smoothZ - smoothBobZ);
        rippleCooldown -= dt;
        if (rippleCooldown <= 0) {
          rippleCooldown = 0.45;
          onRipple(smoothBobX, smoothBobZ, 0.72);
        }
      } else {
        hookedFishMesh.visible = false;
      }

      if (showLine) {
        const endX = remote.bobberVisible ? smoothBobX : tmpTip.x;
        const endY = remote.bobberVisible ? smoothBobY : tmpTip.y - 0.35;
        const endZ = remote.bobberVisible ? smoothBobZ : tmpTip.z;
        const sag = remote.phase === 'reeling' ? 0.08 : 0.32;
        for (let i = 0; i < LINE_PTS; i++) {
          const t = i / (LINE_PTS - 1);
          const idx3 = i * 3;
          linePositions[idx3] = THREE.MathUtils.lerp(tmpTip.x, endX, t);
          linePositions[idx3 + 1] =
            THREE.MathUtils.lerp(tmpTip.y, endY, t) - Math.sin(t * Math.PI) * sag;
          linePositions[idx3 + 2] = THREE.MathUtils.lerp(tmpTip.z, endZ, t);
        }
        lineGeo.attributes.position.needsUpdate = true;
      }
    },
    dispose: () => {
      for (const item of disposables) {
        item.dispose();
      }
    },
  };
}
