import * as THREE from 'three';

export interface VintageRadioSystem {
  pierRadio: THREE.Group;
  boatRadioGroup: THREE.Group;
  hitTargets: THREE.Object3D[];
  setRadioState: (playing: boolean, loading: boolean, stationIndex?: number) => void;
  setHovered: (hovered: boolean) => void;
  update: (dt: number, elapsed: number, nightFactor: number, coldSnowFactor: number) => void;
  dispose: () => void;
}

function createDialTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;

  // Warm vacuum-tube amber-brown backdrop
  const grad = ctx.createLinearGradient(0, 0, 0, 192);
  grad.addColorStop(0, '#2a1809');
  grad.addColorStop(0.5, '#3b210b');
  grad.addColorStop(1, '#201106');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 192);

  // Subtle brass inner border
  ctx.strokeStyle = 'rgba(245, 190, 95, 0.55)';
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, 496, 176);

  // Vintage Header
  ctx.fillStyle = '#fde68a';
  ctx.font = 'bold 20px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('CLASSIC LAKE RADIO', 256, 36);

  // FM band ticks & frequencies
  ctx.strokeStyle = '#fcd34d';
  ctx.fillStyle = '#fef3c7';
  ctx.font = 'bold 20px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('FM', 24, 78);

  const fmLabels = ['88', '92', '96', '100', '104', '108'];
  for (let i = 0; i <= 30; i++) {
    const x = 82 + (i / 30) * 392;
    const isMajor = i % 6 === 0;
    ctx.beginPath();
    ctx.moveTo(x, isMajor ? 58 : 66);
    ctx.lineTo(x, 78);
    ctx.lineWidth = isMajor ? 3 : 1.5;
    ctx.strokeStyle = isMajor ? '#fde68a' : 'rgba(253, 230, 138, 0.55)';
    ctx.stroke();
    if (isMajor) {
      const lbl = fmLabels[i / 6];
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fef3c7';
      ctx.font = 'bold 17px monospace';
      ctx.fillText(lbl, x, 100);
    }
  }

  // Horizontal golden divider line
  ctx.beginPath();
  ctx.moveTo(24, 114);
  ctx.lineTo(486, 114);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
  ctx.stroke();

  // AM band ticks & labels
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fbbf24';
  ctx.font = 'bold 18px monospace';
  ctx.fillText('AM', 24, 150);

  const amLabels = ['550', '700', '900', '1200', '1600'];
  for (let i = 0; i <= 24; i++) {
    const x = 82 + (i / 24) * 392;
    const isMajor = i % 6 === 0;
    ctx.beginPath();
    ctx.moveTo(x, 128);
    ctx.lineTo(x, isMajor ? 146 : 138);
    ctx.lineWidth = isMajor ? 2.5 : 1.3;
    ctx.strokeStyle = isMajor ? '#fbbf24' : 'rgba(251, 191, 36, 0.48)';
    ctx.stroke();
    if (isMajor) {
      const lbl = amLabels[i / 6];
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fde68a';
      ctx.font = '15px monospace';
      ctx.fillText(lbl, x, 166);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createGrilleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#cbb78d';
  ctx.fillRect(0, 0, 256, 256);

  // Subtle dark circular speaker cone recessed behind woven cloth
  const rad = ctx.createRadialGradient(128, 128, 22, 128, 128, 108);
  rad.addColorStop(0, 'rgba(38, 25, 14, 0.45)');
  rad.addColorStop(0.65, 'rgba(48, 32, 18, 0.25)');
  rad.addColorStop(1, 'rgba(48, 32, 18, 0.0)');
  ctx.fillStyle = rad;
  ctx.fillRect(0, 0, 256, 256);

  // Vintage woven acoustic tweed pattern
  for (let y = 0; y < 256; y += 6) {
    ctx.fillStyle = y % 12 === 0 ? 'rgba(92, 69, 41, 0.42)' : 'rgba(247, 238, 212, 0.28)';
    ctx.fillRect(0, y, 256, 2);
  }
  for (let x = 0; x < 256; x += 6) {
    ctx.fillStyle = x % 12 === 0 ? 'rgba(72, 52, 28, 0.36)' : 'rgba(244, 232, 200, 0.24)';
    ctx.fillRect(x, 0, 2, 256);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createVintageRadioSystem(
  contactShadowMat: THREE.MeshBasicMaterial,
  enableColdFrostDusting?: (mat: THREE.MeshStandardMaterial, strength?: number, edgeBias?: number) => void,
): VintageRadioSystem {
  const disposables: Array<{ dispose: () => void }> = [];

  const dialTex = createDialTexture();
  const grilleTex = createGrilleTexture();
  disposables.push(dialTex, grilleTex);

  const walnutMat = new THREE.MeshStandardMaterial({
    color: 0x5c361d,
    roughness: 0.52,
    metalness: 0.06,
  });
  const darkWoodMat = new THREE.MeshStandardMaterial({
    color: 0x2d180c,
    roughness: 0.68,
    metalness: 0.04,
  });
  const bezelMat = new THREE.MeshStandardMaterial({
    color: 0xe6d7b8,
    roughness: 0.45,
    metalness: 0.04,
  });
  const leatherMat = new THREE.MeshStandardMaterial({
    color: 0x4b2917,
    roughness: 0.74,
    metalness: 0.04,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xd4a94f,
    roughness: 0.24,
    metalness: 0.88,
  });
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xdde6ee,
    roughness: 0.16,
    metalness: 0.94,
  });
  const grilleMat = new THREE.MeshStandardMaterial({
    map: grilleTex,
    roughness: 0.88,
    metalness: 0.02,
  });
  const dialFaceMat = new THREE.MeshStandardMaterial({
    map: dialTex,
    emissive: 0xffa634,
    emissiveMap: dialTex,
    emissiveIntensity: 0.1,
    roughness: 0.3,
    metalness: 0.05,
  });
  const dialGlassMat = new THREE.MeshStandardMaterial({
    color: 0xfff8eb,
    transparent: true,
    opacity: 0.18,
    roughness: 0.1,
    metalness: 0.1,
  });
  const needleMat = new THREE.MeshStandardMaterial({
    color: 0xea3c23,
    emissive: 0xff5a2b,
    emissiveIntensity: 0.25,
    roughness: 0.3,
  });
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.1,
    roughness: 0.2,
  });
  const hoverRingMat = new THREE.MeshBasicMaterial({
    color: 0xfbbf24,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const hitBoxMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    colorWrite: false,
  });

  if (enableColdFrostDusting) {
    enableColdFrostDusting(walnutMat, 0.56, 0.12);
    enableColdFrostDusting(leatherMat, 0.62, 0.16);
    enableColdFrostDusting(bezelMat, 0.48, 0.1);
  }

  // Shared Geometries
  const shadowGeo = new THREE.PlaneGeometry(0.44, 0.24);
  shadowGeo.rotateX(-Math.PI / 2);
  const ringGeo = new THREE.RingGeometry(0.19, 0.225, 28);
  ringGeo.rotateX(-Math.PI / 2);
  const footGeo = new THREE.CylinderGeometry(0.015, 0.018, 0.014, 10);
  const bodyGeo = new THREE.BoxGeometry(0.36, 0.20, 0.136);
  const trimTopGeo = new THREE.BoxGeometry(0.372, 0.018, 0.144);
  const backGeo = new THREE.BoxGeometry(0.336, 0.176, 0.012);
  const bezelGeo = new THREE.BoxGeometry(0.334, 0.174, 0.014);
  const grilleGeo = new THREE.PlaneGeometry(0.138, 0.142);
  const grilleFrameGeo = new THREE.BoxGeometry(0.148, 0.152, 0.008);
  const dialWellGeo = new THREE.BoxGeometry(0.154, 0.068, 0.01);
  const dialPlaneGeo = new THREE.PlaneGeometry(0.146, 0.06);
  const needleGeo = new THREE.BoxGeometry(0.004, 0.056, 0.004);
  const dialGlassGeo = new THREE.PlaneGeometry(0.148, 0.062);
  const knobGeo = new THREE.CylinderGeometry(0.017, 0.019, 0.016, 16);
  knobGeo.rotateX(Math.PI / 2);
  const knobPointerGeo = new THREE.BoxGeometry(0.003, 0.012, 0.004);
  const switchGeo = new THREE.CylinderGeometry(0.0035, 0.0045, 0.014, 8);
  const lampGeo = new THREE.SphereGeometry(0.007, 10, 10);

  const handleCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.115, 0.214, 0),
    new THREE.Vector3(-0.085, 0.258, 0),
    new THREE.Vector3(0, 0.268, 0),
    new THREE.Vector3(0.085, 0.258, 0),
    new THREE.Vector3(0.115, 0.214, 0),
  ]);
  const handleGeo = new THREE.TubeGeometry(handleCurve, 20, 0.011, 8, false);
  const handleMountGeo = new THREE.BoxGeometry(0.03, 0.014, 0.028);
  const antennaBaseGeo = new THREE.CylinderGeometry(0.007, 0.01, 0.02, 8);
  const antennaRod1Geo = new THREE.CylinderGeometry(0.0036, 0.0046, 0.22, 8);
  const antennaRod2Geo = new THREE.CylinderGeometry(0.0022, 0.0034, 0.18, 8);
  const antennaTipGeo = new THREE.SphereGeometry(0.006, 8, 8);
  const hitBoxGeo = new THREE.BoxGeometry(0.44, 0.34, 0.26);

  disposables.push(
    walnutMat,
    darkWoodMat,
    bezelMat,
    leatherMat,
    brassMat,
    chromeMat,
    grilleMat,
    dialFaceMat,
    dialGlassMat,
    needleMat,
    lampMat,
    hoverRingMat,
    hitBoxMat,
    shadowGeo,
    ringGeo,
    footGeo,
    bodyGeo,
    trimTopGeo,
    backGeo,
    bezelGeo,
    grilleGeo,
    grilleFrameGeo,
    dialWellGeo,
    dialPlaneGeo,
    needleGeo,
    dialGlassGeo,
    knobGeo,
    knobPointerGeo,
    switchGeo,
    lampGeo,
    handleGeo,
    handleMountGeo,
    antennaBaseGeo,
    antennaRod1Geo,
    antennaRod2Geo,
    antennaTipGeo,
    hitBoxGeo,
  );

  interface RadioUnitAnim {
    root: THREE.Group;
    needle: THREE.Mesh;
    tuningKnob: THREE.Group;
    volumeKnob: THREE.Group;
    toggleSwitch: THREE.Mesh;
    grilleMesh: THREE.Mesh;
    ringMesh: THREE.Mesh;
    hitMesh: THREE.Mesh;
  }

  const units: RadioUnitAnim[] = [];

  function buildRadioUnit(scale: number): THREE.Group {
    const root = new THREE.Group();

    const shadow = new THREE.Mesh(shadowGeo, contactShadowMat);
    shadow.position.y = 0.003;
    const ringMesh = new THREE.Mesh(ringGeo, hoverRingMat);
    ringMesh.position.y = 0.006;
    ringMesh.scale.set(1.05, 1, 0.72);
    root.add(shadow, ringMesh);

    // 4 brass feet
    for (const [fx, fz] of [
      [-0.145, -0.048],
      [0.145, -0.048],
      [-0.145, 0.048],
      [0.145, 0.048],
    ]) {
      const foot = new THREE.Mesh(footGeo, brassMat);
      foot.position.set(fx, 0.007, fz);
      foot.castShadow = true;
      root.add(foot);
    }

    // Walnut wood cabinet + top/bottom beveled rim + dark rear plate
    const body = new THREE.Mesh(bodyGeo, walnutMat);
    body.position.set(0, 0.114, 0);
    body.castShadow = true;
    body.receiveShadow = true;

    const topRim = new THREE.Mesh(trimTopGeo, walnutMat);
    topRim.position.set(0, 0.208, 0);
    topRim.castShadow = true;
    topRim.receiveShadow = true;

    const botRim = new THREE.Mesh(trimTopGeo, darkWoodMat);
    botRim.position.set(0, 0.019, 0);
    botRim.castShadow = true;

    const backPlate = new THREE.Mesh(backGeo, darkWoodMat);
    backPlate.position.set(0, 0.114, -0.066);
    backPlate.receiveShadow = true;

    // Cream recessed front faceplate (+Z faces seated fisherman)
    const bezel = new THREE.Mesh(bezelGeo, bezelMat);
    bezel.position.set(0, 0.114, 0.064);
    bezel.receiveShadow = true;

    // Left Woven Speaker Grille + Brass Border
    const grilleFrame = new THREE.Mesh(grilleFrameGeo, brassMat);
    grilleFrame.position.set(-0.075, 0.114, 0.069);

    const grilleMesh = new THREE.Mesh(grilleGeo, grilleMat);
    grilleMesh.position.set(-0.075, 0.114, 0.0736);

    // Upper-right Backlit Frequency Dial Window + Moving Red Needle + Clear Glass
    const dialWell = new THREE.Mesh(dialWellGeo, darkWoodMat);
    dialWell.position.set(0.08, 0.148, 0.068);

    const dialPlane = new THREE.Mesh(dialPlaneGeo, dialFaceMat);
    dialPlane.position.set(0.08, 0.148, 0.0735);

    const needle = new THREE.Mesh(needleGeo, needleMat);
    needle.position.set(0.08, 0.148, 0.0752);

    const dialGlass = new THREE.Mesh(dialGlassGeo, dialGlassMat);
    dialGlass.position.set(0.08, 0.148, 0.0768);

    // Lower-right Brass Controls: Volume Knob, Power Toggle Switch, Status Lamp, Tuning Knob
    const volumeKnob = new THREE.Group();
    volumeKnob.position.set(0.036, 0.068, 0.076);
    const volCap = new THREE.Mesh(knobGeo, brassMat);
    volCap.castShadow = true;
    const volPtr = new THREE.Mesh(knobPointerGeo, darkWoodMat);
    volPtr.position.set(0, 0.008, 0.008);
    volumeKnob.add(volCap, volPtr);

    const tuningKnob = new THREE.Group();
    tuningKnob.position.set(0.124, 0.068, 0.076);
    const tunCap = new THREE.Mesh(knobGeo, brassMat);
    tunCap.castShadow = true;
    const tunPtr = new THREE.Mesh(knobPointerGeo, darkWoodMat);
    tunPtr.position.set(0, 0.008, 0.008);
    tuningKnob.add(tunCap, tunPtr);

    const toggleSwitch = new THREE.Mesh(switchGeo, chromeMat);
    toggleSwitch.position.set(0.08, 0.064, 0.075);
    toggleSwitch.rotation.x = 0.55;

    const statusLamp = new THREE.Mesh(lampGeo, lampMat);
    statusLamp.position.set(0.08, 0.088, 0.073);

    // Arching leather & brass top carry handle
    const handleStrap = new THREE.Mesh(handleGeo, leatherMat);
    handleStrap.castShadow = true;
    for (const mx of [-0.115, 0.115]) {
      const mount = new THREE.Mesh(handleMountGeo, brassMat);
      mount.position.set(mx, 0.219, 0);
      mount.castShadow = true;
      root.add(mount);
    }

    // Telescoping angled whip antenna at rear-left top
    const antennaPivot = new THREE.Group();
    antennaPivot.position.set(-0.135, 0.216, -0.042);
    antennaPivot.rotation.set(-0.22, 0, 0.18);
    const antBase = new THREE.Mesh(antennaBaseGeo, brassMat);
    antBase.position.y = 0.01;
    const antRod1 = new THREE.Mesh(antennaRod1Geo, chromeMat);
    antRod1.position.y = 0.12;
    const antRod2 = new THREE.Mesh(antennaRod2Geo, chromeMat);
    antRod2.position.y = 0.30;
    const antTip = new THREE.Mesh(antennaTipGeo, chromeMat);
    antTip.position.y = 0.39;
    antennaPivot.add(antBase, antRod1, antRod2, antTip);

    // Invisible padded raycast box
    const hitMesh = new THREE.Mesh(hitBoxGeo, hitBoxMat);
    hitMesh.position.set(0, 0.15, 0.01);

    root.add(
      body,
      topRim,
      botRim,
      backPlate,
      bezel,
      grilleFrame,
      grilleMesh,
      dialWell,
      dialPlane,
      needle,
      dialGlass,
      volumeKnob,
      tuningKnob,
      toggleSwitch,
      statusLamp,
      handleStrap,
      antennaPivot,
      hitMesh,
    );

    root.scale.setScalar(scale);
    units.push({
      root,
      needle,
      tuningKnob,
      volumeKnob,
      toggleSwitch,
      grilleMesh,
      ringMesh,
      hitMesh,
    });
    return root;
  }

  // 1. Pier Radio: front-left on wooden planks facing the seated fisherman directly
  const pierRadio = buildRadioUnit(1.0);
  pierRadio.position.set(-0.46, 0.72, 0.54);
  pierRadio.rotation.y = 0.30;

  // 2. Boat Radio: left bow foredeck right in front of the seated captain, clear of baskets & lantern
  const boatRadioGroup = new THREE.Group();
  const boatRadio = buildRadioUnit(0.76);
  boatRadio.position.set(-0.22, 0.37, -1.46);
  boatRadio.rotation.y = 0.16;
  boatRadioGroup.add(boatRadio);

  const hitTargets = units.map((u) => u.hitMesh);

  let isPlaying = false;
  let isLoading = false;
  let isHovered = false;
  let targetNeedleOffset = 0.018;
  let currentNeedleOffset = 0.018;
  let prevElapsed = 0;

  function setRadioState(playing: boolean, loading: boolean, stationIndex = 0): void {
    isPlaying = playing;
    isLoading = loading;
    // Map active station index smoothly across the FM dial window (-0.052 .. +0.052)
    const norm = Math.max(0, Math.min(1, (stationIndex % 12) / 11));
    targetNeedleOffset = -0.05 + norm * 0.1;
  }

  function setHovered(hovered: boolean): void {
    isHovered = hovered;
  }

  function update(dt: number, elapsed: number, nightFactor: number, _coldSnowFactor: number): void {
    const safeDt = dt > 0 ? dt : prevElapsed > 0 ? Math.min(0.1, Math.max(0, elapsed - prevElapsed)) : 0.016;
    prevElapsed = elapsed;

    // Dial lighting: cozy tube glow when playing, rhythmic amber search when connecting, subtle night hint
    const desiredDialGlow = isPlaying
      ? 1.18 + Math.sin(elapsed * 4.2) * 0.08
      : isLoading
        ? 0.65 + Math.sin(elapsed * 8.0) * 0.35
        : 0.08 + nightFactor * 0.24 + (isHovered ? 0.32 : 0);
    dialFaceMat.emissiveIntensity = THREE.MathUtils.lerp(dialFaceMat.emissiveIntensity, desiredDialGlow, Math.min(1, safeDt * 8));

    // Lamp color & glow
    if (isPlaying) {
      lampMat.color.setHex(0x34d399);
      lampMat.emissive.setHex(0x10b981);
      lampMat.emissiveIntensity = 1.65;
    } else if (isLoading) {
      lampMat.color.setHex(0xfbbf24);
      lampMat.emissive.setHex(0xf59e0b);
      lampMat.emissiveIntensity = 0.9 + Math.sin(elapsed * 10) * 0.65;
    } else {
      lampMat.color.setHex(0xb45309);
      lampMat.emissive.setHex(0xf59e0b);
      lampMat.emissiveIntensity = isHovered ? 0.55 : 0.08;
    }

    // Hover / playing subtle warm amber halo ring under the radio
    const targetRingOpacity = isHovered ? 0.68 : isPlaying ? 0.22 + Math.sin(elapsed * 3.0) * 0.08 : 0.0;
    hoverRingMat.opacity = THREE.MathUtils.lerp(hoverRingMat.opacity, targetRingOpacity, Math.min(1, safeDt * 10));

    // Needle & tuning knob motion
    const sweepOffset = isLoading ? Math.sin(elapsed * 4.5) * 0.048 : targetNeedleOffset;
    currentNeedleOffset = THREE.MathUtils.lerp(currentNeedleOffset, sweepOffset, Math.min(1, safeDt * 7));

    for (const u of units) {
      u.ringMesh.visible = hoverRingMat.opacity > 0.01;
      u.needle.position.x = 0.08 + currentNeedleOffset;
      u.tuningKnob.rotation.z = -currentNeedleOffset * 26.0;
      u.volumeKnob.rotation.z = isPlaying || isLoading ? -0.85 : 0.45;
      u.toggleSwitch.rotation.x = THREE.MathUtils.lerp(
        u.toggleSwitch.rotation.x,
        isPlaying || isLoading ? -0.45 : 0.55,
        Math.min(1, safeDt * 12),
      );
      // Very subtle acoustic cloth thrum while playing music
      const pulse = isPlaying ? Math.sin(elapsed * 22) * 0.0008 + Math.cos(elapsed * 13) * 0.0005 : 0;
      u.grilleMesh.position.z = 0.0736 + pulse;
    }
  }

  return {
    pierRadio,
    boatRadioGroup,
    hitTargets,
    setRadioState,
    setHovered,
    update,
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
