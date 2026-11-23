import * as THREE from 'three';

export interface ProceduralTextureSet {
  woodPlankMap: THREE.CanvasTexture;
  woodBumpMap: THREE.CanvasTexture;
  lakebedMap: THREE.CanvasTexture;
  meadowDetailMap: THREE.CanvasTexture;
  terrainBumpMap: THREE.CanvasTexture;
  contactShadowMap: THREE.CanvasTexture;
  barkMap: THREE.CanvasTexture;
  barkBumpMap: THREE.CanvasTexture;
  pineFoliageMap: THREE.CanvasTexture;
  skinMap: THREE.CanvasTexture;
  skinBumpMap: THREE.CanvasTexture;
  sleeveMap: THREE.CanvasTexture;
  dispose: () => void;
}

function createCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  // 1. Weathered cedar wood planks (SRGB)
  const [woodCanvas, wCtx] = createCanvas(512, 512);
  wCtx.fillStyle = '#7b5839';
  wCtx.fillRect(0, 0, 512, 512);
  const plankCount = 6;
  const plankH = 512 / plankCount;
  for (let p = 0; p < plankCount; p++) {
    const y0 = p * plankH;
    const shade = (Math.random() - 0.5) * 18;
    wCtx.fillStyle = `rgb(${124 + shade}, ${88 + shade * 0.8}, ${56 + shade * 0.5})`;
    wCtx.fillRect(0, y0 + 2, 512, plankH - 4);
    for (let g = 0; g < 65; g++) {
      const gy = y0 + 4 + Math.random() * (plankH - 8);
      wCtx.strokeStyle =
        g % 3 === 0 ? 'rgba(42, 26, 15, 0.22)' : 'rgba(176, 134, 92, 0.16)';
      wCtx.lineWidth = 0.8 + Math.random() * 1.4;
      wCtx.beginPath();
      wCtx.moveTo(0, gy);
      wCtx.bezierCurveTo(
        170,
        gy + (Math.random() - 0.5) * 5,
        340,
        gy + (Math.random() - 0.5) * 5,
        512,
        gy,
      );
      wCtx.stroke();
    }
    wCtx.fillStyle = '#2d1c10';
    wCtx.fillRect(0, y0, 512, 3);
  }
  const woodPlankMap = new THREE.CanvasTexture(woodCanvas);
  woodPlankMap.colorSpace = THREE.SRGBColorSpace;
  woodPlankMap.wrapS = THREE.RepeatWrapping;
  woodPlankMap.wrapT = THREE.RepeatWrapping;
  woodPlankMap.anisotropy = maxAnisotropy;

  // 2. Wood bump map (linear)
  const [bumpCanvas, bCtx] = createCanvas(256, 256);
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, 256, 256);
  for (let p = 0; p < plankCount; p++) {
    const y0 = (p * 256) / plankCount;
    bCtx.fillStyle = '#202020';
    bCtx.fillRect(0, y0, 256, 2);
    for (let g = 0; g < 40; g++) {
      const gy = y0 + 3 + Math.random() * (256 / plankCount - 6);
      bCtx.strokeStyle = g % 2 === 0 ? 'rgba(210,210,210,0.2)' : 'rgba(60,60,60,0.2)';
      bCtx.beginPath();
      bCtx.moveTo(0, gy);
      bCtx.lineTo(256, gy);
      bCtx.stroke();
    }
  }
  const woodBumpMap = new THREE.CanvasTexture(bumpCanvas);
  woodBumpMap.wrapS = THREE.RepeatWrapping;
  woodBumpMap.wrapT = THREE.RepeatWrapping;
  woodBumpMap.anisotropy = maxAnisotropy;

  // 3. Crystal lakebed river sand & pebbles (SRGB)
  const [bedCanvas, lCtx] = createCanvas(512, 512);
  lCtx.fillStyle = '#a99d83';
  lCtx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 1800; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 1.2 + Math.random() * 6.5;
    const tone = Math.random();
    if (tone < 0.35) lCtx.fillStyle = 'rgba(130, 121, 102, 0.55)';
    else if (tone < 0.7) lCtx.fillStyle = 'rgba(186, 173, 146, 0.5)';
    else lCtx.fillStyle = 'rgba(92, 95, 86, 0.45)';
    lCtx.beginPath();
    lCtx.ellipse(x, y, r, r * (0.65 + Math.random() * 0.35), Math.random() * Math.PI, 0, Math.PI * 2);
    lCtx.fill();
  }
  const lakebedMap = new THREE.CanvasTexture(bedCanvas);
  lakebedMap.colorSpace = THREE.SRGBColorSpace;
  lakebedMap.wrapS = THREE.RepeatWrapping;
  lakebedMap.wrapT = THREE.RepeatWrapping;
  lakebedMap.repeat.set(16, 16);
  lakebedMap.anisotropy = maxAnisotropy;

  // 4. Meadow & rock organic detail texture (SRGB neutral overlay)
  const [meadowCanvas, mCtx] = createCanvas(512, 512);
  mCtx.fillStyle = '#dcdcdc';
  mCtx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 5500; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = 175 + Math.floor(Math.random() * 75);
    mCtx.fillStyle = `rgb(${v}, ${v + 4}, ${v - 4})`;
    mCtx.fillRect(x, y, 2 + Math.random() * 3.5, 2 + Math.random() * 4.5);
  }
  const meadowDetailMap = new THREE.CanvasTexture(meadowCanvas);
  meadowDetailMap.colorSpace = THREE.SRGBColorSpace;
  meadowDetailMap.wrapS = THREE.RepeatWrapping;
  meadowDetailMap.wrapT = THREE.RepeatWrapping;
  meadowDetailMap.repeat.set(42, 42);
  meadowDetailMap.anisotropy = maxAnisotropy;

  // 4b. High-frequency terrain & rock micro-relief bump map (linear)
  const [tBumpCanvas, tbCtx] = createCanvas(512, 512);
  tbCtx.fillStyle = '#808080';
  tbCtx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 5000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 1 + Math.random() * 5.5;
    const shade = 75 + Math.floor(Math.random() * 115);
    tbCtx.fillStyle = `rgba(${shade}, ${shade}, ${shade}, 0.35)`;
    tbCtx.beginPath();
    tbCtx.ellipse(x, y, r * 1.4, r * 0.7, Math.random() * Math.PI, 0, Math.PI * 2);
    tbCtx.fill();
  }
  for (let s = 0; s < 140; s++) {
    const sy = Math.random() * 512;
    tbCtx.strokeStyle = s % 2 === 0 ? 'rgba(40,40,40,0.28)' : 'rgba(220,220,220,0.22)';
    tbCtx.lineWidth = 1 + Math.random() * 2.2;
    tbCtx.beginPath();
    tbCtx.moveTo(0, sy);
    tbCtx.bezierCurveTo(170, sy + (Math.random() - 0.5) * 18, 340, sy + (Math.random() - 0.5) * 18, 512, sy);
    tbCtx.stroke();
  }
  const terrainBumpMap = new THREE.CanvasTexture(tBumpCanvas);
  terrainBumpMap.wrapS = THREE.RepeatWrapping;
  terrainBumpMap.wrapT = THREE.RepeatWrapping;
  terrainBumpMap.repeat.set(48, 48);
  terrainBumpMap.anisotropy = maxAnisotropy;

  // 5. Furrowed alpine pine bark texture + bump (SRGB + linear)
  const [barkCanvas, bkCtx] = createCanvas(256, 256);
  const [barkBumpCanvas, bkbCtx] = createCanvas(256, 256);
  bkCtx.fillStyle = '#483324';
  bkCtx.fillRect(0, 0, 256, 256);
  bkbCtx.fillStyle = '#787878';
  bkbCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 280; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const w = 2.5 + Math.random() * 5.5;
    const h = 14 + Math.random() * 36;
    const dark = i % 2 === 0;
    bkCtx.fillStyle = dark ? '#2a1c13' : '#654935';
    bkCtx.fillRect(x, y, w, h);
    bkbCtx.fillStyle = dark ? '#343434' : '#cccccc';
    bkbCtx.fillRect(x, y, w, h);
  }
  const barkMap = new THREE.CanvasTexture(barkCanvas);
  barkMap.colorSpace = THREE.SRGBColorSpace;
  barkMap.wrapS = THREE.RepeatWrapping;
  barkMap.wrapT = THREE.RepeatWrapping;
  barkMap.anisotropy = maxAnisotropy;

  const barkBumpMap = new THREE.CanvasTexture(barkBumpCanvas);
  barkBumpMap.wrapS = THREE.RepeatWrapping;
  barkBumpMap.wrapT = THREE.RepeatWrapping;
  barkBumpMap.anisotropy = maxAnisotropy;

  // 6. Layered Pine Needle Cluster Foliage Texture (SRGB)
  const [pineCanvas, pCtx] = createCanvas(512, 512);
  pCtx.fillStyle = '#8b9d88';
  pCtx.fillRect(0, 0, 512, 512);
  for (let layer = 0; layer < 2600; layer++) {
    const cx = Math.random() * 512;
    const cy = Math.random() * 512;
    const angle = Math.random() * Math.PI * 2;
    const len = 8 + Math.random() * 14;
    const tone = layer < 900 ? 145 : layer < 1800 ? 195 : 235;
    pCtx.strokeStyle = `rgba(${Math.round(tone * 0.86)}, ${tone}, ${Math.round(tone * 0.82)}, 0.72)`;
    pCtx.lineWidth = 1.4 + Math.random() * 1.3;
    pCtx.beginPath();
    pCtx.moveTo(cx, cy);
    pCtx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
    pCtx.stroke();
  }
  const pineFoliageMap = new THREE.CanvasTexture(pineCanvas);
  pineFoliageMap.colorSpace = THREE.SRGBColorSpace;
  pineFoliageMap.wrapS = THREE.RepeatWrapping;
  pineFoliageMap.wrapT = THREE.RepeatWrapping;
  pineFoliageMap.repeat.set(3, 2);
  pineFoliageMap.anisotropy = maxAnisotropy;

  // 7. Anatomical Skin Texture + Pore Bump Map (SRGB + linear)
  const [skinCanvas, skCtx] = createCanvas(256, 256);
  const [skinBumpCanvas, skbCtx] = createCanvas(256, 256);
  skCtx.fillStyle = '#cf9775';
  skCtx.fillRect(0, 0, 256, 256);
  skbCtx.fillStyle = '#808080';
  skbCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2400; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const warm = i % 3 === 0;
    skCtx.fillStyle = warm ? 'rgba(196, 126, 98, 0.16)' : 'rgba(225, 178, 146, 0.14)';
    skCtx.fillRect(x, y, 2 + Math.random() * 3, 2 + Math.random() * 3);
    const bShade = i % 2 === 0 ? 112 : 144;
    skbCtx.fillStyle = `rgba(${bShade}, ${bShade}, ${bShade}, 0.25)`;
    skbCtx.fillRect(x, y, 1.5, 1.5);
  }
  // Subtle skin creases across joints
  for (let k = 0; k < 26; k++) {
    const ky = 20 + k * 8.5 + (Math.random() - 0.5) * 3;
    skCtx.strokeStyle = 'rgba(150, 92, 68, 0.18)';
    skCtx.lineWidth = 1;
    skCtx.beginPath();
    skCtx.moveTo(0, ky);
    skCtx.bezierCurveTo(85, ky + 2, 170, ky - 2, 256, ky);
    skCtx.stroke();

    skbCtx.strokeStyle = 'rgba(70, 70, 70, 0.28)';
    skbCtx.lineWidth = 1;
    skbCtx.beginPath();
    skbCtx.moveTo(0, ky);
    skbCtx.lineTo(256, ky);
    skbCtx.stroke();
  }
  const skinMap = new THREE.CanvasTexture(skinCanvas);
  skinMap.colorSpace = THREE.SRGBColorSpace;
  skinMap.wrapS = THREE.RepeatWrapping;
  skinMap.wrapT = THREE.RepeatWrapping;
  skinMap.anisotropy = maxAnisotropy;

  const skinBumpMap = new THREE.CanvasTexture(skinBumpCanvas);
  skinBumpMap.wrapS = THREE.RepeatWrapping;
  skinBumpMap.wrapT = THREE.RepeatWrapping;
  skinBumpMap.anisotropy = maxAnisotropy;

  // 8. Woven Rugged Outdoor Jacket Sleeve Texture (SRGB)
  const [sleeveCanvas, slCtx] = createCanvas(256, 256);
  slCtx.fillStyle = '#6c462d';
  slCtx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 4) {
    slCtx.fillStyle = y % 8 === 0 ? 'rgba(42, 24, 14, 0.24)' : 'rgba(145, 98, 66, 0.14)';
    slCtx.fillRect(0, y, 256, 2);
  }
  for (let x = 0; x < 256; x += 4) {
    slCtx.fillStyle = x % 8 === 0 ? 'rgba(38, 22, 12, 0.18)' : 'rgba(155, 108, 72, 0.12)';
    slCtx.fillRect(x, 0, 2, 256);
  }
  const sleeveMap = new THREE.CanvasTexture(sleeveCanvas);
  sleeveMap.colorSpace = THREE.SRGBColorSpace;
  sleeveMap.wrapS = THREE.RepeatWrapping;
  sleeveMap.wrapT = THREE.RepeatWrapping;
  sleeveMap.repeat.set(3, 3);
  sleeveMap.anisotropy = maxAnisotropy;

  // 9. Soft radial contact shadow (SRGB)
  const [shadowCanvas, sCtx] = createCanvas(128, 128);
  const grad = sCtx.createRadialGradient(64, 64, 6, 64, 64, 60);
  grad.addColorStop(0, 'rgba(8, 14, 16, 0.72)');
  grad.addColorStop(0.5, 'rgba(8, 14, 16, 0.28)');
  grad.addColorStop(1, 'rgba(8, 14, 16, 0)');
  sCtx.fillStyle = grad;
  sCtx.fillRect(0, 0, 128, 128);
  const contactShadowMap = new THREE.CanvasTexture(shadowCanvas);
  contactShadowMap.colorSpace = THREE.SRGBColorSpace;

  return {
    woodPlankMap,
    woodBumpMap,
    lakebedMap,
    meadowDetailMap,
    terrainBumpMap,
    contactShadowMap,
    barkMap,
    barkBumpMap,
    pineFoliageMap,
    skinMap,
    skinBumpMap,
    sleeveMap,
    dispose: () => {
      woodPlankMap.dispose();
      woodBumpMap.dispose();
      lakebedMap.dispose();
      meadowDetailMap.dispose();
      terrainBumpMap.dispose();
      contactShadowMap.dispose();
      barkMap.dispose();
      barkBumpMap.dispose();
      pineFoliageMap.dispose();
      skinMap.dispose();
      skinBumpMap.dispose();
      sleeveMap.dispose();
    },
  };
}
