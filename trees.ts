import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ProceduralTextureSet } from './textures';
import type { SeasonId } from '../types/fishing';

export interface TreeSpot {
  x: number;
  z: number;
  radius: number;
}

export interface TreeSystem {
  group: THREE.Group;
  spots: TreeSpot[];
  update: (elapsed: number, wind: number, season: SeasonId) => void;
  dispose: () => void;
}

interface Buf {
  pos: number[];
  nor: number[];
  uv: number[];
  col: number[];
  flex: number[];
  leaf: number[];
  idx: number[];
  hasNormals: boolean;
}

function newBuf(): Buf {
  return { pos: [], nor: [], uv: [], col: [], flex: [], leaf: [], idx: [], hasNormals: false };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toGeometry(b: Buf, explicitNormals: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setAttribute('aFlex', new THREE.Float32BufferAttribute(b.flex, 1));
  g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(b.leaf, 1));
  g.setIndex(b.idx);
  if (explicitNormals) g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  else g.computeVertexNormals();
  return g;
}

/** Appends a tapered tube (branch / trunk) to a buffer. */
function addTube(
  b: Buf,
  a: THREE.Vector3,
  c: THREE.Vector3,
  r0: number,
  r1: number,
  segs: number,
  shade: number,
): void {
  const axis = new THREE.Vector3().subVectors(c, a);
  const len = axis.length();
  axis.normalize();
  const ref = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(axis, ref).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  const base = b.pos.length / 3;
  for (let ring = 0; ring < 2; ring++) {
    const center = ring === 0 ? a : c;
    const r = ring === 0 ? r0 : r1;
    for (let k = 0; k <= segs; k++) {
      const ang = (k / segs) * Math.PI * 2;
      const dx = u.x * Math.cos(ang) + v.x * Math.sin(ang);
      const dy = u.y * Math.cos(ang) + v.y * Math.sin(ang);
      const dz = u.z * Math.cos(ang) + v.z * Math.sin(ang);
      b.pos.push(center.x + dx * r, center.y + dy * r, center.z + dz * r);
      b.uv.push((k / segs) * 2, ring === 0 ? 0 : len * 0.6);
      b.col.push(shade, shade, shade);
      b.flex.push(0);
      b.leaf.push(0);
    }
  }
  for (let k = 0; k < segs; k++) {
    const a0 = base + k;
    const a1 = base + k + 1;
    const b0 = base + segs + 1 + k;
    const b1 = base + segs + 2 + k;
    b.idx.push(a0, b0, a1, a1, b0, b1);
  }
}

// ---------------------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------------------

function buildConiferFoliage(isSoftwareGl: boolean): THREE.BufferGeometry {
  const rnd = mulberry32(90210);
  const b = newBuf();
  const tiers = isSoftwareGl ? 8 : 13;
  const segs = isSoftwareGl ? 10 : 18;

  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const yBase = 1.5 + f * 5.3;
    const rBase = 1.95 * Math.pow(1 - f, 0.9) + 0.26;
    const tierH = 1.5 - 0.5 * f;
    const rot = rnd() * Math.PI * 2;
    const base = b.pos.length / 3;

    const outerIdx: number[] = [];
    const midIdx: number[] = [];

    for (let i = 0; i < segs; i++) {
      const a = rot + (i / segs) * Math.PI * 2 + (rnd() - 0.5) * 0.2;
      const long = i % 2 === 0;
      const rr = rBase * (0.78 + rnd() * 0.4) * (long ? 1.0 : 0.62);
      const y = yBase - 0.3 - rnd() * 0.28 - (long ? 0.1 : 0);
      outerIdx.push(b.pos.length / 3);
      b.pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
      b.uv.push(0, 0);
      const sh = 0.95 + rnd() * 0.2; // bright branch tips
      b.col.push(sh, sh, sh);
      b.flex.push(1.0);
      b.leaf.push(0);

      midIdx.push(b.pos.length / 3);
      const am = a + 0.05;
      b.pos.push(Math.cos(am) * rBase * 0.46, yBase + tierH * 0.34 + (rnd() - 0.5) * 0.1, Math.sin(am) * rBase * 0.46);
      b.uv.push(0, 0);
      const dm = 0.5 + rnd() * 0.1; // darker inner foliage
      b.col.push(dm, dm, dm);
      b.flex.push(0.45);
      b.leaf.push(0);
    }
    const apex = b.pos.length / 3;
    b.pos.push(0, yBase + tierH, 0);
    b.uv.push(0, 0);
    b.col.push(0.75, 0.75, 0.75);
    b.flex.push(0.5);
    b.leaf.push(0);

    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      b.idx.push(apex, midIdx[i], midIdx[j]);
      b.idx.push(midIdx[i], outerIdx[i], outerIdx[j]);
      b.idx.push(midIdx[i], outerIdx[j], midIdx[j]);
    }
    void base;
  }
  return toGeometry(b, false);
}

function buildConiferWood(): THREE.BufferGeometry {
  const b = newBuf();
  addTube(b, new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, 3.6, 0), 0.27, 0.15, 8, 1.0);
  addTube(b, new THREE.Vector3(0, 3.6, 0), new THREE.Vector3(0, 7.0, 0), 0.15, 0.03, 6, 0.9);
  return toGeometry(b, false);
}

function buildBroadleafWood(isSoftwareGl: boolean): THREE.BufferGeometry {
  const rnd = mulberry32(777);
  const b = newBuf();
  const segs = isSoftwareGl ? 6 : 9;
  addTube(b, new THREE.Vector3(0, -0.25, 0), new THREE.Vector3(0.05, 2.5, 0.02), 0.3, 0.2, segs, 1.0);
  // Major limbs forking from the crown base
  const limbs = 5;
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + rnd() * 0.8;
    const out = 0.9 + rnd() * 0.6;
    const top = new THREE.Vector3(Math.cos(a) * out, 3.9 + rnd() * 0.9, Math.sin(a) * out);
    const mid = new THREE.Vector3(Math.cos(a) * out * 0.45, 3.0 + rnd() * 0.2, Math.sin(a) * out * 0.45);
    addTube(b, new THREE.Vector3(0.05, 2.4, 0.02), mid, 0.16, 0.11, 6, 0.95);
    addTube(b, mid, top, 0.11, 0.04, 6, 0.9);
    // twigs
    for (let k = 0; k < 2; k++) {
      const ta = a + (k === 0 ? 0.7 : -0.7);
      const tw = new THREE.Vector3(
        mid.x + Math.cos(ta) * 0.7,
        mid.y + 0.9 + rnd() * 0.4,
        mid.z + Math.sin(ta) * 0.7,
      );
      addTube(b, mid, tw, 0.06, 0.02, 5, 0.85);
    }
  }
  return toGeometry(b, false);
}

function crownClusters(isSoftwareGl: boolean): { c: THREE.Vector3; r: number }[] {
  const rnd = mulberry32(4242);
  const n = isSoftwareGl ? 5 : 8;
  const out: { c: THREE.Vector3; r: number }[] = [];
  out.push({ c: new THREE.Vector3(0, 4.7, 0), r: 1.45 });
  for (let i = 1; i < n; i++) {
    const a = (i / (n - 1)) * Math.PI * 2 + rnd() * 0.5;
    const rad = 1.15 + rnd() * 0.5;
    out.push({
      c: new THREE.Vector3(Math.cos(a) * rad, 3.7 + rnd() * 1.4, Math.sin(a) * rad),
      r: 0.95 + rnd() * 0.5,
    });
  }
  return out;
}

function buildBroadleafBlobs(isSoftwareGl: boolean): THREE.BufferGeometry {
  const rnd = mulberry32(31337);
  const b = newBuf();
  const clusters = crownClusters(isSoftwareGl);
  for (const cl of clusters) {
    let ico: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, isSoftwareGl ? 1 : 2);
    ico.deleteAttribute('normal');
    ico.deleteAttribute('uv');
    ico = mergeVertices(ico, 1e-4);
    const posAttr = ico.getAttribute('position');
    const base = b.pos.length / 3;
    const seed = rnd() * 10;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);
      const n =
        Math.sin(x * 4.1 + seed) * Math.sin(y * 3.7 + seed * 1.3) * Math.sin(z * 4.4 + seed * 0.7) * 0.5 +
        Math.sin(x * 9.3 + z * 7.7 + seed) * 0.5 * Math.sin(y * 8.1) * 0.5;
      const rr = cl.r * (1.0 + n * 0.28);
      b.pos.push(cl.c.x + x * rr, cl.c.y + y * rr * 0.85, cl.c.z + z * rr);
      b.uv.push(0, 0);
      const shade = 0.5 + 0.5 * THREE.MathUtils.clamp((y + 1) / 2, 0, 1) + (rnd() - 0.5) * 0.08;
      b.col.push(shade, shade, shade);
      b.flex.push(0.8);
      b.leaf.push(1);
    }
    const index = ico.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) b.idx.push(base + index.getX(i));
    }
    ico.dispose();
  }
  return toGeometry(b, false);
}

function buildBroadleafCards(isSoftwareGl: boolean): THREE.BufferGeometry {
  const rnd = mulberry32(555);
  const b = newBuf();
  b.hasNormals = true;
  const clusters = crownClusters(isSoftwareGl);
  const perCluster = isSoftwareGl ? 26 : 70;
  const dir = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  for (const cl of clusters) {
    for (let i = 0; i < perCluster; i++) {
      // random point on a sphere (fibonacci-ish randomised)
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      dir.set(s * Math.cos(th), u * 0.9, s * Math.sin(th)).normalize();
      const rr = cl.r * (0.92 + rnd() * 0.3);
      const px = cl.c.x + dir.x * rr;
      const py = cl.c.y + dir.y * rr * 0.9;
      const pz = cl.c.z + dir.z * rr;

      // Card basis: faces outward with a random roll
      right.set(-dir.z, 0, dir.x);
      if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
      right.normalize();
      up.crossVectors(dir, right).normalize();
      const roll = rnd() * Math.PI * 2;
      const rx = right.clone().multiplyScalar(Math.cos(roll)).addScaledVector(up, Math.sin(roll));
      const ry = up.clone().multiplyScalar(Math.cos(roll)).addScaledVector(right, -Math.sin(roll));
      const size = 0.5 + rnd() * 0.38;
      const shade = 0.55 + 0.45 * THREE.MathUtils.clamp((dir.y + 1) / 2, 0, 1) + (rnd() - 0.5) * 0.12;

      const base = b.pos.length / 3;
      const corners: [number, number, number, number][] = [
        [-1, -1, 0, 0],
        [1, -1, 1, 0],
        [1, 1, 1, 1],
        [-1, 1, 0, 1],
      ];
      for (const [cx, cy, uu, vv] of corners) {
        b.pos.push(
          px + (rx.x * cx + ry.x * cy) * size,
          py + (rx.y * cx + ry.y * cy) * size,
          pz + (rx.z * cx + ry.z * cy) * size,
        );
        b.nor.push(dir.x, dir.y, dir.z);
        b.uv.push(uu, vv);
        b.col.push(shade, shade, shade);
        b.flex.push(1.0);
        b.leaf.push(1);
      }
      b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return toGeometry(b, true);
}

function createLeafTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  const rnd = mulberry32(2024);
  for (let i = 0; i < 16; i++) {
    const cx = 14 + rnd() * (size - 28);
    const cy = 14 + rnd() * (size - 28);
    const ang = rnd() * Math.PI * 2;
    const lw = 8 + rnd() * 7;
    const lh = 16 + rnd() * 10;
    const lum = Math.round(170 + rnd() * 85);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.fillStyle = `rgb(${lum},${lum},${lum})`;
    ctx.beginPath();
    ctx.moveTo(0, -lh);
    ctx.bezierCurveTo(lw, -lh * 0.4, lw, lh * 0.5, 0, lh);
    ctx.bezierCurveTo(-lw, lh * 0.5, -lw, -lh * 0.4, 0, -lh);
    ctx.fill();
    ctx.strokeStyle = `rgba(80,80,80,0.55)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -lh * 0.9);
    ctx.lineTo(0, lh * 0.9);
    ctx.stroke();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------------------------------
// Wind shader injection
// ---------------------------------------------------------------------------------------

interface SharedUniforms {
  uTime: { value: number };
  uWind: { value: number };
  uLeafAmount: { value: number };
}

function applyWindSway(mat: THREE.MeshStandardMaterial, shared: SharedUniforms, bendScale: number): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uWind = shared.uWind;
    shader.uniforms.uLeafAmount = shared.uLeafAmount;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aFlex;
         attribute float aLeaf;
         uniform float uTime;
         uniform float uWind;
         uniform float uLeafAmount;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float twPh = 0.0;
         #ifdef USE_INSTANCING
           twPh = instanceMatrix[3][0] * 0.13 + instanceMatrix[3][2] * 0.17;
         #endif
         float twH = max(position.y, 0.0);
         float twBend = twH * twH * ${bendScale.toFixed(5)};
         float twGust = sin(uTime * 0.85 + twPh) * 0.55 + sin(uTime * 1.63 + twPh * 1.7) * 0.28
                      + sin(uTime * 0.29 + twPh * 0.5) * 0.45 + 0.35;
         transformed.x += twGust * uWind * twBend;
         transformed.z += (sin(uTime * 1.1 + twPh * 1.3) * 0.4 + 0.25) * uWind * twBend * 0.6;
         float twFl = aFlex * uWind;
         transformed.x += sin(uTime * 3.1 + position.y * 2.3 + position.z * 1.7 + twPh) * 0.045 * twFl;
         transformed.y += sin(uTime * 2.4 + position.x * 2.1 + twPh * 2.0) * 0.03 * twFl;
         transformed.z += cos(uTime * 2.8 + position.y * 1.9 + position.x * 1.5 + twPh) * 0.045 * twFl;
         if (aLeaf > 0.5 && uLeafAmount < 0.5) { transformed.y -= 500.0; }`,
      );
  };
  mat.customProgramCacheKey = () => `treesway_${bendScale}`;
}

// ---------------------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------------------

export function createTreeSystem(
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean,
  groundHeightAt: (x: number, z: number) => number,
): TreeSystem {
  const group = new THREE.Group();
  const shared: SharedUniforms = {
    uTime: { value: 0 },
    uWind: { value: 1 },
    uLeafAmount: { value: 1 },
  };

  const conWoodGeo = buildConiferWood();
  const conFolGeo = buildConiferFoliage(isSoftwareGl);
  const broWoodGeo = buildBroadleafWood(isSoftwareGl);
  const broBlobGeo = buildBroadleafBlobs(isSoftwareGl);
  const broCardGeo = buildBroadleafCards(isSoftwareGl);
  const leafTex = createLeafTexture();

  const woodMat = new THREE.MeshStandardMaterial({
    map: textures.barkMap,
    color: 0x6b4b35,
    roughness: 0.95,
    vertexColors: true,
  });
  const conMat = new THREE.MeshStandardMaterial({
    color: 0x2f6b2f,
    roughness: 0.9,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  const blobMat = new THREE.MeshStandardMaterial({
    color: 0x4f8f35,
    roughness: 0.9,
    vertexColors: true,
  });
  const cardMat = new THREE.MeshStandardMaterial({
    color: 0x5a9a3a,
    map: leafTex,
    alphaTest: 0.5,
    roughness: 0.85,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  applyWindSway(woodMat, shared, 0.004);
  applyWindSway(conMat, shared, 0.0045);
  applyWindSway(blobMat, shared, 0.0045);
  applyWindSway(cardMat, shared, 0.0045);

  const maxConifers = isSoftwareGl ? 120 : 260;
  const maxBroad = isSoftwareGl ? 28 : 70;

  const conWood = new THREE.InstancedMesh(conWoodGeo, woodMat, maxConifers);
  const conFol = new THREE.InstancedMesh(conFolGeo, conMat, maxConifers);
  const broWood = new THREE.InstancedMesh(broWoodGeo, woodMat, maxBroad);
  const broBlob = new THREE.InstancedMesh(broBlobGeo, blobMat, maxBroad);
  const broCard = new THREE.InstancedMesh(broCardGeo, cardMat, maxBroad);
  for (const m of [conWood, conFol, broWood, broBlob]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  broCard.receiveShadow = true;

  const hash = (x: number, z: number): number => {
    const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };

  const spots: TreeSpot[] = [];
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  let nCon = 0;
  let nBro = 0;
  let attempts = 0;
  while ((nCon < maxConifers || nBro < maxBroad) && attempts < 4600) {
    attempts++;
    const angle = (attempts * 2.39996) % (Math.PI * 2);
    const radius = 44 + ((attempts * 9.13) % 125);
    const tx = Math.cos(angle) * radius;
    const tz = Math.sin(angle) * radius - 26;
    if (Math.abs(tx) < 7 && tz > -2 && tz < 16) continue;
    const ty = groundHeightAt(tx, tz);
    if (ty < 0.85 || ty > 28) continue;

    const wantBroad = ty < 9 && hash(tx + 1.3, tz - 0.7) > 0.42;
    if (wantBroad && nBro >= maxBroad) continue;
    if (!wantBroad && nCon >= maxConifers) continue;

    const scale = (wantBroad ? 0.95 : 0.8) + hash(tx, tz) * 0.62;
    dummy.position.set(tx, ty - 0.12, tz);
    dummy.rotation.set((hash(tz, tx) - 0.5) * 0.05, hash(tz + 2, tx) * Math.PI * 2, (hash(tx, tz + 5) - 0.5) * 0.05);
    dummy.scale.set(scale, scale * (0.9 + hash(tx + 3, tz) * 0.3), scale);
    dummy.updateMatrix();

    const jitter = 0.82 + hash(tx * 2, tz * 2) * 0.36;
    col.setRGB(jitter, 0.9 + hash(tx, tz * 3) * 0.2, jitter * (0.9 + hash(tz, tx * 3) * 0.2));

    if (wantBroad) {
      broWood.setMatrixAt(nBro, dummy.matrix);
      broBlob.setMatrixAt(nBro, dummy.matrix);
      broCard.setMatrixAt(nBro, dummy.matrix);
      broBlob.setColorAt(nBro, col);
      broCard.setColorAt(nBro, col);
      nBro++;
    } else {
      conWood.setMatrixAt(nCon, dummy.matrix);
      conFol.setMatrixAt(nCon, dummy.matrix);
      conFol.setColorAt(nCon, col);
      nCon++;
    }
    spots.push({ x: tx, z: tz, radius: wantBroad ? 1.8 * scale : 1.5 * scale });
  }

  conWood.count = nCon;
  conFol.count = nCon;
  broWood.count = nBro;
  broBlob.count = nBro;
  broCard.count = nBro;
  for (const m of [conWood, conFol, broWood, broBlob, broCard]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.frustumCulled = false; // vertex sway can push geometry outside the static bounds
  }
  group.add(conWood, conFol, broWood, broBlob, broCard);

  let lastSeason: SeasonId | null = null;

  return {
    group,
    spots,
    update: (elapsed, wind, season) => {
      shared.uTime.value = elapsed;
      shared.uWind.value = wind;
      if (season === lastSeason) return;
      lastSeason = season;
      shared.uLeafAmount.value = season === 'winter' ? 0 : 1;
      switch (season) {
        case 'spring':
          conMat.color.setHex(0x3a7a35);
          blobMat.color.setHex(0x78b24a);
          cardMat.color.setHex(0x8cc455);
          break;
        case 'autumn':
          conMat.color.setHex(0x3d6330);
          blobMat.color.setHex(0xc4781e);
          cardMat.color.setHex(0xe08a22);
          break;
        case 'winter':
          conMat.color.setHex(0x9db8b2); // snow-dusted pines
          blobMat.color.setHex(0x4f8f35);
          cardMat.color.setHex(0x5a9a3a);
          break;
        default:
          conMat.color.setHex(0x2f6b2f);
          blobMat.color.setHex(0x4a8a30);
          cardMat.color.setHex(0x5aa03a);
      }
    },
    dispose: () => {
      conWoodGeo.dispose();
      conFolGeo.dispose();
      broWoodGeo.dispose();
      broBlobGeo.dispose();
      broCardGeo.dispose();
      leafTex.dispose();
      woodMat.dispose();
      conMat.dispose();
      blobMat.dispose();
      cardMat.dispose();
    },
  };
}
