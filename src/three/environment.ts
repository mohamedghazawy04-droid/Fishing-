import * as THREE from 'three';
import type { ProceduralTextureSet } from './textures';
import type { SeasonId, WeatherType } from '../types/fishing';

// Fast deterministic 2D hash & gradient-like value noise
function hash2(ix: number, iz: number): number {
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function noise2(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);

  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);

  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbm(x: number, z: number, octaves = 4): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * noise2(x * freq, z * freq);
    freq *= 2.03;
    amp *= 0.5;
  }
  return val;
}

function ridgedFbm(x: number, z: number, octaves = 4): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    const n = 1.0 - Math.abs(noise2(x * freq, z * freq) * 2.0 - 1.0);
    val += amp * n * n;
    freq *= 2.12;
    amp *= 0.5;
  }
  return val;
}

/**
 * Global terrain heightfield.
 * Dock sits around (0, 2.5) facing -Z over the crystal mountain lake centered around (0, -16).
 */
export function groundHeightAt(x: number, z: number): number {
  // Expanded crystal alpine lake basin in front of dock
  const lx = x / 54;
  const lz = (z + 28) / 42;
  const lakeDist = Math.sqrt(lx * lx + lz * lz) + (fbm(x * 0.036, z * 0.036, 3) - 0.5) * 0.22;

  const distFromCenter = Math.hypot(x, z + 18);

  let height = 0;

  if (lakeDist < 1.0) {
    // Smooth bowl from 0 at shoreline down to -5.1 in deep basin
    const t = Math.max(0, 1.0 - lakeDist);
    const depth = Math.pow(t, 0.72) * 5.1;
    const ledgeBump =
      (Math.sin(x * 0.11) * Math.cos(z * 0.1) * 0.35 + (fbm(x * 0.07, z * 0.07, 2) - 0.5) * 0.45) *
      Math.min(1, t * 2.5);
    height = -depth + ledgeBump;
  } else {
    // Sweeping lush valley plains stretching out to the foothills
    const shoreFade = THREE.MathUtils.smoothstep(lakeDist, 1.0, 1.55);
    const meadow = (fbm(x * 0.022 + 3.1, z * 0.022 - 1.7, 4) - 0.3) * 9.5;
    height = shoreFade * (0.42 + Math.max(0, meadow));
  }

  // Keep dock approach flat and natural around x in [-6, 6], z in [2, 16]
  const dockFlatDist = Math.hypot(x / 7, (z - 8) / 8);
  if (dockFlatDist < 1.2 && z > 1.0) {
    const blend = THREE.MathUtils.smoothstep(dockFlatDist, 0.4, 1.2);
    height = THREE.MathUtils.lerp(0.68, height, blend);
  }

  // Towering Snow-Capped Alpine Mountain Range clearly visible across the horizon
  const mountainStart = 72;
  if (distFromCenter > mountainStart) {
    const mT = THREE.MathUtils.smoothstep(distFromCenter, mountainStart, 225);
    const valleyOpenMask = z > 18 ? 0.55 : 1.0;
    const ridge = ridgedFbm(x * 0.011 + 7.2, z * 0.011 + 4.4, 5);
    const peakBoost = Math.pow(mT, 1.35) * (24 + ridge * 68) * valleyOpenMask;
    height += peakBoost;
  }

  return height;
}

export interface EnvironmentSystem {
  group: THREE.Group;
  skyMaterial: THREE.ShaderMaterial;
  terrainMaterial: THREE.MeshStandardMaterial;
  reedsMesh: THREE.InstancedMesh;
  update: (
    elapsed: number,
    sunDir: THREE.Vector3,
    skyTop: THREE.Color,
    skyHorizon: THREE.Color,
    sunColor: THREE.Color,
    weather: WeatherType,
    season: SeasonId,
    starAlpha: number,
    cloudDensity: number,
    windMultiplier: number,
  ) => void;
  dispose: () => void;
}

export function createEnvironment(textures: ProceduralTextureSet, isSoftwareGl: boolean): EnvironmentSystem {
  const group = new THREE.Group();

  // 1. Atmospheric Sky Dome with Sun, Moon, Stars & Clouds
  const skyGeo = new THREE.SphereGeometry(420, 40, 24);
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.3, 0.5, -0.8).normalize() },
      uSkyTop: { value: new THREE.Color(0x2a66a8) },
      uSkyHorizon: { value: new THREE.Color(0xb8dcf0) },
      uSunColor: { value: new THREE.Color(0xfff1cc) },
      uTime: { value: 0 },
      uStarAlpha: { value: 0 },
      uCloudDensity: { value: 0.35 },
      uStormFactor: { value: 0 },
    },
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uSunDir;
      uniform vec3 uSkyTop;
      uniform vec3 uSkyHorizon;
      uniform vec3 uSunColor;
      uniform float uTime;
      uniform float uStarAlpha;
      uniform float uCloudDensity;
      uniform float uStormFactor;
      varying vec3 vWorldDir;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }
      float fbmCloud(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * vnoise(p);
          p *= 2.05;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 dir = normalize(vWorldDir);
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 col = mix(uSkyHorizon, uSkyTop, pow(h, 0.58));

        // Sun & atmospheric glow
        float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
        float sunHalo = pow(sunDot, 8.0) * 0.35 + pow(sunDot, 48.0) * 0.45;
        float sunDisc = smoothstep(0.9982, 0.9994, sunDot) * (1.0 - uStormFactor * 0.8);
        col += uSunColor * (sunHalo * (1.0 - uStormFactor * 0.5) + sunDisc * 1.8);

        // Crescent/Full Moon opposite sun when night
        vec3 moonDir = normalize(vec3(-uSunDir.x * 0.6, max(0.28, -uSunDir.y * 0.8 + 0.35), -0.65));
        float moonDot = max(dot(dir, moonDir), 0.0);
        float moonDisc = smoothstep(0.9991, 0.9996, moonDot) * uStarAlpha;
        float moonGlow = pow(moonDot, 36.0) * 0.28 * uStarAlpha;
        col += vec3(0.82, 0.9, 1.0) * (moonDisc * 1.4 + moonGlow);

        // Twinkling Stars at dusk/night
        if (uStarAlpha > 0.01 && dir.y > 0.04) {
          vec2 starUv = dir.xz / (dir.y + 0.35) * 95.0;
          vec2 cell = floor(starUv);
          vec2 gv = fract(starUv) - 0.5;
          float rnd = hash(cell);
          if (rnd > 0.965) {
            float d = length(gv);
            float twinkle = 0.65 + 0.35 * sin(uTime * 2.2 + rnd * 40.0);
            float star = smoothstep(0.18, 0.02, d) * twinkle;
            col += vec3(0.92, 0.95, 1.0) * star * uStarAlpha * smoothstep(0.04, 0.25, dir.y) * (1.0 - uStormFactor * 0.85);
          }
        }

        // Soft drifting clouds above horizon
        if (dir.y > 0.03) {
          vec2 cuv = dir.xz / (dir.y + 0.22) * 1.45 + vec2(uTime * 0.012, uTime * 0.006);
          float c = fbmCloud(cuv);
          float threshold = mix(0.68, 0.34, uCloudDensity);
          float cloudMask = smoothstep(threshold, threshold + 0.25, c) * smoothstep(0.03, 0.24, dir.y);
          vec3 cloudLit = mix(vec3(0.96, 0.97, 0.99), uSunColor, 0.28);
          cloudLit = mix(cloudLit, uSkyHorizon * 0.72, uStormFactor * 0.65);
          cloudLit = mix(cloudLit, vec3(0.24, 0.29, 0.38), uStarAlpha * 0.75);
          col = mix(col, cloudLit, cloudMask * mix(0.65, 0.92, uStormFactor));
        }

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const skyDome = new THREE.Mesh(skyGeo, skyMaterial);
  group.add(skyDome);

  // 2. Sculpted Valley, Mountains, Plains & Expanded Lakebed Terrain
  const terrainSize = 520;
  const segs = isSoftwareGl ? 140 : 210;
  const terrainGeo = new THREE.PlaneGeometry(terrainSize, terrainSize, segs, segs);
  terrainGeo.rotateX(-Math.PI / 2);

  const posAttr = terrainGeo.attributes.position;
  const colors = new Float32Array(posAttr.count * 3);
  const cSand = new THREE.Color(0xb6a98a);
  const cPebble = new THREE.Color(0x7c7b6d);
  const cMeadow = new THREE.Color(0x4c7c41);
  const cLush = new THREE.Color(0x366235);
  const cRock = new THREE.Color(0x63676b);
  const cSnow = new THREE.Color(0xf2f6fa);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const y = groundHeightAt(x, z);
    posAttr.setY(i, y);

    // Estimate slope for rock cliffs
    const hx = groundHeightAt(x + 1.2, z);
    const hz = groundHeightAt(x, z + 1.2);
    const slope = Math.hypot(hx - y, hz - y) / 1.2;

    const n = hash2(Math.floor(x * 0.5), Math.floor(z * 0.5)) * 0.1;

    if (y < -0.35) {
      // Underwater lakebed sand & stones
      const deepT = THREE.MathUtils.clamp((-y - 0.35) / 4.0, 0, 1);
      tmpColor.copy(cSand).lerp(cPebble, deepT * 0.75 + n);
    } else if (y < 0.75) {
      // Shoreline sand -> grassy bank
      const shoreT = THREE.MathUtils.clamp((y + 0.35) / 1.1, 0, 1);
      tmpColor.copy(cSand).lerp(cMeadow, shoreT);
    } else if (y < 15) {
      // Rolling green valley plains
      const lushT = fbm(x * 0.04, z * 0.04, 2);
      tmpColor.copy(cMeadow).lerp(cLush, lushT);
      if (slope > 0.65) {
        tmpColor.lerp(cRock, THREE.MathUtils.clamp((slope - 0.65) * 1.4, 0, 0.85));
      }
    } else if (y < 32) {
      // Foothills transitioning to alpine granite
      const rockT = THREE.MathUtils.smoothstep(y, 15, 30);
      tmpColor.copy(cLush).lerp(cRock, Math.max(rockT, slope * 0.85));
    } else {
      // Majestic snow-capped peaks
      const snowT = THREE.MathUtils.smoothstep(y, 31, 41) * (1 - THREE.MathUtils.clamp((slope - 0.9) * 0.9, 0, 0.75));
      tmpColor.copy(cRock).lerp(cSnow, snowT);
    }

    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }

  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();

  // Extend terrain MeshStandardMaterial with animated underwater sun caustics below y=0
  const terrainMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: textures.meadowDetailMap,
    roughness: 0.9,
    metalness: 0.02,
  });

  terrainMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uSunIntensity = { value: 1.0 };
    shader.uniforms.uSeasonWarmth = { value: 0.0 }; // >0 autumn gold, <0 winter frost
    shader.uniforms.uWinterSnow = { value: 0.0 };
    terrainMaterial.userData.shader = shader;

    shader.vertexShader =
      `varying vec3 vWorldPosTerrain;\n` +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         vWorldPosTerrain = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    shader.fragmentShader =
      `uniform float uTime;
       uniform float uSunIntensity;
       uniform float uSeasonWarmth;
       uniform float uWinterSnow;
       varying vec3 vWorldPosTerrain;
       float causticPattern(vec2 uv, float t) {
         vec2 p = uv * 0.55;
         float c1 = sin(p.x * 3.1 + t * 1.3 + sin(p.y * 2.7 - t));
         float c2 = cos(p.y * 3.5 - t * 1.1 + cos(p.x * 2.9 + t * 0.9));
         return pow(clamp((c1 * c2) * 0.5 + 0.5, 0.0, 1.0), 3.0);
       }\n` +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         if (vWorldPosTerrain.y > 0.55 && vWorldPosTerrain.y < 28.0) {
           if (uSeasonWarmth > 0.01) {
             diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.56, 0.42, 0.18), uSeasonWarmth * 0.52);
           }
           if (uWinterSnow > 0.01) {
             float frostMask = smoothstep(0.6, 16.0, vWorldPosTerrain.y) * uWinterSnow;
             diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.89, 0.94), frostMask * 0.72);
           }
         }
         if (vWorldPosTerrain.y < 0.02) {
           float depthFade = smoothstep(-5.0, -0.1, vWorldPosTerrain.y);
           float c = causticPattern(vWorldPosTerrain.xz, uTime);
           diffuseColor.rgb += vec3(0.18, 0.27, 0.25) * c * depthFade * uSunIntensity;
         }`,
      );
  };

  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMaterial);
  terrainMesh.receiveShadow = true;
  group.add(terrainMesh);

  // 3. Multi-Tiered Instanced Alpine Pine / Fir Trees
  const treeCount = 260;
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.28, 2.2, 7);
  trunkGeo.translate(0, 1.1, 0);
  const trunkMat = new THREE.MeshStandardMaterial({
    map: textures.barkMap,
    color: 0x6b4b35,
    roughness: 0.95,
  });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  trunks.castShadow = true;
  trunks.receiveShadow = true;

  // 3 foliage tiers merged visually via 3 InstancedMeshes for authentic conifer silhouette
  const tier1Geo = new THREE.ConeGeometry(1.75, 2.8, 8);
  tier1Geo.translate(0, 3.0, 0);
  const tier2Geo = new THREE.ConeGeometry(1.35, 2.4, 8);
  tier2Geo.translate(0, 4.4, 0);
  const tier3Geo = new THREE.ConeGeometry(0.9, 2.0, 8);
  tier3Geo.translate(0, 5.7, 0);

  const foliageMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0.0,
  });

  const foliage1 = new THREE.InstancedMesh(tier1Geo, foliageMat, treeCount);
  const foliage2 = new THREE.InstancedMesh(tier2Geo, foliageMat, treeCount);
  const foliage3 = new THREE.InstancedMesh(tier3Geo, foliageMat, treeCount);
  foliage1.castShadow = true;
  foliage2.castShadow = true;
  foliage3.castShadow = true;
  foliage1.receiveShadow = true;
  foliage2.receiveShadow = true;
  foliage3.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const treeColor = new THREE.Color();
  let placedTrees = 0;
  let attempts = 0;
  while (placedTrees < treeCount && attempts < 3600) {
    attempts++;
    const angle = (attempts * 2.39996) % (Math.PI * 2);
    const radius = 44 + ((attempts * 9.13) % 125);
    const tx = Math.cos(angle) * radius;
    const tz = Math.sin(angle) * radius - 26;
    if (Math.abs(tx) < 7 && tz > -2 && tz < 16) continue;
    const ty = groundHeightAt(tx, tz);
    if (ty < 0.85 || ty > 28) continue;

    const scale = 0.78 + hash2(tx, tz) * 0.68;
    dummy.position.set(tx, ty - 0.15, tz);
    dummy.rotation.set(0, hash2(tz, tx) * Math.PI * 2, 0);
    dummy.scale.set(scale, scale * (0.9 + hash2(tx + 3, tz) * 0.25), scale);
    dummy.updateMatrix();

    trunks.setMatrixAt(placedTrees, dummy.matrix);
    foliage1.setMatrixAt(placedTrees, dummy.matrix);
    foliage2.setMatrixAt(placedTrees, dummy.matrix);
    foliage3.setMatrixAt(placedTrees, dummy.matrix);

    const gShift = 0.88 + hash2(tx * 2, tz * 2) * 0.28;
    treeColor.setRGB(0.14 * gShift, 0.34 * gShift, 0.18 * gShift);
    foliage1.setColorAt(placedTrees, treeColor);
    foliage2.setColorAt(placedTrees, treeColor.clone().multiplyScalar(1.08));
    foliage3.setColorAt(placedTrees, treeColor.clone().multiplyScalar(1.16));
    placedTrees++;
  }
  trunks.count = placedTrees;
  foliage1.count = placedTrees;
  foliage2.count = placedTrees;
  foliage3.count = placedTrees;
  trunks.instanceMatrix.needsUpdate = true;
  foliage1.instanceMatrix.needsUpdate = true;
  foliage2.instanceMatrix.needsUpdate = true;
  foliage3.instanceMatrix.needsUpdate = true;
  if (foliage1.instanceColor) foliage1.instanceColor.needsUpdate = true;
  if (foliage2.instanceColor) foliage2.instanceColor.needsUpdate = true;
  if (foliage3.instanceColor) foliage3.instanceColor.needsUpdate = true;
  trunks.computeBoundingSphere();
  foliage1.computeBoundingSphere();
  foliage2.computeBoundingSphere();
  foliage3.computeBoundingSphere();
  group.add(trunks, foliage1, foliage2, foliage3);

  // 4. Instanced Shoreline & Submerged Lake Boulders
  const rockCount = 110;
  const rockGeo = new THREE.DodecahedronGeometry(1, 1);
  // Slightly perturb vertices for organic stone look
  const rPos = rockGeo.attributes.position;
  for (let i = 0; i < rPos.count; i++) {
    const vx = rPos.getX(i);
    const vy = rPos.getY(i);
    const vz = rPos.getZ(i);
    const n = 0.82 + hash2(vx * 5 + vy * 3, vz * 7) * 0.32;
    rPos.setXYZ(i, vx * n, vy * n * 0.72, vz * n);
  }
  rockGeo.computeVertexNormals();
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.86,
    metalness: 0.04,
  });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  let placedRocks = 0;
  for (let i = 0; i < 450 && placedRocks < rockCount; i++) {
    const rx = (hash2(i, 11) - 0.5) * 124;
    const rz = (hash2(19, i) - 0.5) * 108 - 28;
    if (Math.hypot(rx, rz - 1) < 6.0) continue; // Keep dock clear
    const ry = groundHeightAt(rx, rz);
    if (ry < -3.8 || ry > 9.0) continue;

    const s = 0.35 + hash2(rx, rz) * 1.25;
    dummy.position.set(rx, ry + s * 0.18, rz);
    dummy.rotation.set(hash2(i, 1) * 0.6, hash2(i, 2) * Math.PI * 2, hash2(i, 3) * 0.6);
    dummy.scale.set(s * 1.2, s * 0.85, s);
    dummy.updateMatrix();
    rocks.setMatrixAt(placedRocks, dummy.matrix);

    const shade = 0.36 + hash2(rz, rx) * 0.18;
    const moss = ry > -0.1 && ry < 1.2 ? 0.05 : 0;
    treeColor.setRGB(shade, shade + moss, shade - 0.02);
    rocks.setColorAt(placedRocks, treeColor);
    placedRocks++;
  }
  rocks.count = placedRocks;
  rocks.instanceMatrix.needsUpdate = true;
  if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
  rocks.computeBoundingSphere();
  group.add(rocks);

  // 5. Instanced Lakeside Reeds & Cattails in shallow banks
  const reedCount = 340;
  const reedGeo = new THREE.CylinderGeometry(0.015, 0.032, 1.45, 5);
  reedGeo.translate(0, 0.72, 0);
  const reedMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.82,
  });
  reedMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWind = { value: 1.0 };
    reedMat.userData.shader = shader;
    shader.vertexShader =
      `uniform float uTime;\nuniform float uWind;\n` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float sway = smoothstep(0.0, 1.4, position.y);
         float instPhase = 0.0;
         #ifdef USE_INSTANCING
           instPhase = instanceMatrix[3][0] * 0.7 + instanceMatrix[3][2] * 0.5;
         #endif
         transformed.x += sin(uTime * 1.7 + instPhase) * 0.09 * sway * uWind;
         transformed.z += cos(uTime * 1.3 + instPhase) * 0.06 * sway * uWind;`,
      );
  };
  const reedsMesh = new THREE.InstancedMesh(reedGeo, reedMat, reedCount);
  reedsMesh.receiveShadow = true;
  let placedReeds = 0;
  for (let i = 0; i < 3200 && placedReeds < reedCount; i++) {
    const rx = (hash2(i * 3.1, 7.2) - 0.5) * 106;
    const rz = (hash2(2.7, i * 4.3) - 0.5) * 88 - 28;
    if (Math.abs(rx) < 5.0 && rz > -2) continue;
    const ry = groundHeightAt(rx, rz);
    if (ry < -0.55 || ry > 0.38) continue;

    const hScale = 0.75 + hash2(rx, rz) * 0.65;
    dummy.position.set(rx, ry - 0.05, rz);
    dummy.rotation.set((hash2(i, 9) - 0.5) * 0.16, hash2(i, 12) * Math.PI * 2, (hash2(i, 15) - 0.5) * 0.16);
    dummy.scale.set(1, hScale, 1);
    dummy.updateMatrix();
    reedsMesh.setMatrixAt(placedReeds, dummy.matrix);

    const g = 0.42 + hash2(rz, rx) * 0.22;
    treeColor.setRGB(g * 0.68, g * 0.95, g * 0.38);
    reedsMesh.setColorAt(placedReeds, treeColor);
    placedReeds++;
  }
  reedsMesh.count = placedReeds;
  reedsMesh.instanceMatrix.needsUpdate = true;
  if (reedsMesh.instanceColor) reedsMesh.instanceColor.needsUpdate = true;
  reedsMesh.computeBoundingSphere();
  group.add(reedsMesh);

  // 6. Soaring Mountain Valley Birds & Flocks
  const birdsGroup = new THREE.Group();
  const birdWingMat = new THREE.MeshStandardMaterial({ color: 0x1e252d, roughness: 0.65, side: THREE.DoubleSide });
  const gullMat = new THREE.MeshStandardMaterial({ color: 0xf0f4f8, roughness: 0.55, side: THREE.DoubleSide });
  const birdList: {
    root: THREE.Group;
    leftWing: THREE.Mesh;
    rightWing: THREE.Mesh;
    phase: number;
    radius: number;
    speed: number;
    yBase: number;
    centerZ: number;
    flapSpeed: number;
    glideBias: number;
  }[] = [];
  const wingGeo = new THREE.BufferGeometry();
  const wingVerts = new Float32Array([
    0, 0, 0.08,
    0.42, 0.02, 0.03,
    0.72, 0.04, -0.1,
    0.34, 0, -0.12,
    0, 0, -0.1,
  ]);
  const wingIndices = [0, 1, 3, 1, 2, 3, 0, 3, 4];
  wingGeo.setAttribute('position', new THREE.BufferAttribute(wingVerts, 3));
  wingGeo.setIndex(wingIndices);
  wingGeo.computeVertexNormals();

  const tailGeo = new THREE.PlaneGeometry(0.18, 0.22);
  tailGeo.rotateX(-Math.PI / 2);
  tailGeo.translate(0, 0, -0.22);

  for (let b = 0; b < 16; b++) {
    const isHighHawk = b < 6;
    const mat = isHighHawk ? birdWingMat : gullMat;
    const scale = isHighHawk ? 1.45 + (b % 3) * 0.2 : 0.72 + (b % 3) * 0.12;
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.38, 6), mat);
    body.rotation.x = Math.PI / 2;
    const tail = new THREE.Mesh(tailGeo, mat);
    const lw = new THREE.Mesh(wingGeo, mat);
    const rw = new THREE.Mesh(wingGeo, mat);
    rw.scale.x = -1;
    root.add(body, tail, lw, rw);
    root.scale.setScalar(scale);
    birdsGroup.add(root);
    birdList.push({
      root,
      leftWing: lw,
      rightWing: rw,
      phase: b * 0.85,
      radius: isHighHawk ? 34 + b * 6.5 : 18 + (b - 6) * 3.8,
      speed: isHighHawk ? 0.09 + (b % 3) * 0.02 : 0.16 + (b % 4) * 0.025,
      yBase: isHighHawk ? 22 + (b % 3) * 5.0 : 8.5 + (b % 4) * 2.4,
      centerZ: isHighHawk ? -42 : -26,
      flapSpeed: isHighHawk ? 4.2 : 7.4,
      glideBias: isHighHawk ? 0.45 : 0.15,
    });
  }
  group.add(birdsGroup);

  return {
    group,
    skyMaterial,
    terrainMaterial,
    reedsMesh,
    update: (elapsed, sunDir, skyTop, skyHorizon, sunColor, weather, season, starAlpha, cloudDensity, windMultiplier) => {
      const stormFactor = weather === 'storm' ? 1.0 : weather === 'rain' ? 0.55 : weather === 'mist' ? 0.25 : 0.0;
      skyMaterial.uniforms.uSunDir.value.copy(sunDir);
      skyMaterial.uniforms.uSkyTop.value.copy(skyTop);
      skyMaterial.uniforms.uSkyHorizon.value.copy(skyHorizon);
      skyMaterial.uniforms.uSunColor.value.copy(sunColor);
      skyMaterial.uniforms.uTime.value = elapsed;
      skyMaterial.uniforms.uStarAlpha.value = starAlpha;
      skyMaterial.uniforms.uCloudDensity.value = cloudDensity;
      skyMaterial.uniforms.uStormFactor.value = stormFactor;

      const tShader = terrainMaterial.userData.shader;
      if (tShader) {
        tShader.uniforms.uTime.value = elapsed;
        tShader.uniforms.uSunIntensity.value = Math.max(0.15, 1.0 - starAlpha * 0.75 - stormFactor * 0.5);
        tShader.uniforms.uSeasonWarmth.value = season === 'autumn' ? 1.0 : 0.0;
        tShader.uniforms.uWinterSnow.value = season === 'winter' ? 1.0 : 0.0;
      }

      if (season === 'autumn') {
        foliageMat.color.setHex(0xd4a45a);
      } else if (season === 'winter') {
        foliageMat.color.setHex(0xc4d8de);
      } else if (season === 'spring') {
        foliageMat.color.setHex(0xffffff);
      } else {
        foliageMat.color.setHex(0xebffe6);
      }

      const rShader = reedMat.userData.shader;
      if (rShader) {
        rShader.uniforms.uTime.value = elapsed;
        rShader.uniforms.uWind.value = (weather === 'storm' ? 2.4 : weather === 'rain' ? 1.5 : 1.0) * windMultiplier;
      }

      const birdsVisible = weather !== 'storm' && starAlpha < 0.72;
      birdsGroup.visible = birdsVisible;
      if (birdsVisible) {
        for (const bird of birdList) {
          const ang = elapsed * bird.speed + bird.phase;
          const bx = Math.cos(ang) * bird.radius;
          const bz = Math.sin(ang) * bird.radius + bird.centerZ;
          bird.root.position.set(bx, bird.yBase + Math.sin(elapsed * 0.7 + bird.phase) * 1.1, bz);
          bird.root.rotation.y = -ang;
          bird.root.rotation.z = 0.16; // Graceful banking tilt while circling
          const flapWave = Math.sin(elapsed * bird.flapSpeed + bird.phase * 3);
          const glideMask = Math.max(0, Math.sin(elapsed * 0.45 + bird.phase) - bird.glideBias);
          const flap = flapWave * (0.14 + glideMask * 0.46);
          bird.leftWing.rotation.z = flap;
          bird.rightWing.rotation.z = -flap;
        }
      }
    },
    dispose: () => {
      skyGeo.dispose();
      skyMaterial.dispose();
      terrainGeo.dispose();
      terrainMaterial.dispose();
      trunkGeo.dispose();
      trunkMat.dispose();
      tier1Geo.dispose();
      tier2Geo.dispose();
      tier3Geo.dispose();
      foliageMat.dispose();
      rockGeo.dispose();
      rockMat.dispose();
      reedGeo.dispose();
      reedMat.dispose();
      wingGeo.dispose();
      birdWingMat.dispose();
    },
  };
}
