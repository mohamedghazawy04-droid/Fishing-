import * as THREE from 'three';

export interface ProceduralTextureSet {
  woodPlankMap: THREE.CanvasTexture;
  woodBumpMap: THREE.CanvasTexture;
  lakebedMap: THREE.CanvasTexture;
  meadowDetailMap: THREE.CanvasTexture;
  contactShadowMap: THREE.CanvasTexture;
  barkMap: THREE.CanvasTexture;
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
    // Grain streaks
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
    // Plank gap shadow
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
  for (let i = 0; i < 4500; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = 185 + Math.floor(Math.random() * 65);
    mCtx.fillStyle = `rgb(${v}, ${v + 4}, ${v - 4})`;
    mCtx.fillRect(x, y, 2 + Math.random() * 3, 2 + Math.random() * 4);
  }
  const meadowDetailMap = new THREE.CanvasTexture(meadowCanvas);
  meadowDetailMap.colorSpace = THREE.SRGBColorSpace;
  meadowDetailMap.wrapS = THREE.RepeatWrapping;
  meadowDetailMap.wrapT = THREE.RepeatWrapping;
  meadowDetailMap.repeat.set(32, 32);
  meadowDetailMap.anisotropy = maxAnisotropy;

  // 5. Pine bark texture (SRGB)
  const [barkCanvas, bkCtx] = createCanvas(256, 256);
  bkCtx.fillStyle = '#4a3525';
  bkCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 180; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    bkCtx.fillStyle = i % 2 === 0 ? '#312116' : '#634834';
    bkCtx.fillRect(x, y, 3 + Math.random() * 5, 16 + Math.random() * 34);
  }
  const barkMap = new THREE.CanvasTexture(barkCanvas);
  barkMap.colorSpace = THREE.SRGBColorSpace;
  barkMap.wrapS = THREE.RepeatWrapping;
  barkMap.wrapT = THREE.RepeatWrapping;
  barkMap.anisotropy = maxAnisotropy;

  // 6. Soft radial contact shadow (SRGB)
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
    contactShadowMap,
    barkMap,
    dispose: () => {
      woodPlankMap.dispose();
      woodBumpMap.dispose();
      lakebedMap.dispose();
      meadowDetailMap.dispose();
      contactShadowMap.dispose();
      barkMap.dispose();
    },
  };
}
