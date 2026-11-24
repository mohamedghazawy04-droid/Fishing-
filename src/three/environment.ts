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
  // Generously expanded crystal alpine lake basin (~2.2x surface area) in front of dock
  const lx = x / 84;
  const lz = (z + 44) / 60;
  const lakeDist = Math.sqrt(lx * lx + lz * lz) + (fbm(x * 0.028, z * 0.028, 3) - 0.5) * 0.21;

  const distFromCenter = Math.hypot(x * 0.86, z + 42);

  let height = 0;

  if (lakeDist < 1.0) {
    // Smooth bowl from 0 at shoreline down to -6.7 in central alpine abyss
    const t = Math.max(0, 1.0 - lakeDist);
    const depth = Math.pow(t, 0.72) * 5.15;
    const abyssT = THREE.MathUtils.clamp((0.58 - lakeDist) / 0.58, 0, 1);
    const abyssExtra = Math.pow(abyssT, 1.35) * 1.55;
    const ledgeBump =
      (Math.sin(x * 0.11) * Math.cos(z * 0.1) * 0.35 + (fbm(x * 0.07, z * 0.07, 2) - 0.5) * 0.45) *
      Math.min(1, t * 2.5);
    height = -depth - abyssExtra + ledgeBump;
  } else {
    // Sweeping lush valley plains stretching out to the foothills
    const shoreFade = THREE.MathUtils.smoothstep(lakeDist, 1.0, 1.52);
    const meadow = (fbm(x * 0.02 + 3.1, z * 0.02 - 1.7, 4) - 0.3) * 9.8;
    height = shoreFade * (0.44 + Math.max(0, meadow));
  }

  // Keep dock approach flat and natural around x in [-6, 6], z in [2, 16]
  const dockFlatDist = Math.hypot(x / 7, (z - 8) / 8);
  if (dockFlatDist < 1.2 && z > 1.0) {
    const blend = THREE.MathUtils.smoothstep(dockFlatDist, 0.4, 1.2);
    height = THREE.MathUtils.lerp(0.68, height, blend);
  }

  // Towering Snow-Capped Alpine Mountain Range surrounding the expanded lake
  const mountainStart = 98;
  if (distFromCenter > mountainStart) {
    const mT = THREE.MathUtils.smoothstep(distFromCenter, mountainStart, 255);
    const valleyOpenMask = z > 24 ? 0.55 : 1.0;
    const primaryRidge = ridgedFbm(x * 0.0105 + 7.2, z * 0.0105 + 4.4, 5);
    const secondaryCrags = ridgedFbm(x * 0.025 - 2.1, z * 0.025 + 1.8, 3);
    const peakBoost = Math.pow(mT, 1.3) * (26 + primaryRidge * 70 + secondaryCrags * 15) * valleyOpenMask;
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
  const skyGeo = new THREE.SphereGeometry(500, 40, 24);
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
  const terrainSize = 660;
  const segs = isSoftwareGl ? 160 : 270;
  const terrainGeo = new THREE.PlaneGeometry(terrainSize, terrainSize, segs, segs);
  terrainGeo.rotateX(-Math.PI / 2);

  const posAttr = terrainGeo.attributes.position;
  const colors = new Float32Array(posAttr.count * 3);
  const cSand = new THREE.Color(0xb6a98a);
  const cPebble = new THREE.Color(0x7c7b6d);
  const cMeadow = new THREE.Color(0x4b7b40);
  const cLush = new THREE.Color(0x325e31);
  const cRock = new THREE.Color(0x5d6268);
  const cSnow = new THREE.Color(0xf3f7fb);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const y = groundHeightAt(x, z);
    posAttr.setY(i, y);

    const hx = groundHeightAt(x + 1.2, z);
    const hz = groundHeightAt(x, z + 1.2);
    const slope = Math.hypot(hx - y, hz - y) / 1.2;

    const n = hash2(Math.floor(x * 0.5), Math.floor(z * 0.5)) * 0.1;

    if (y < -0.35) {
      const deepT = THREE.MathUtils.clamp((-y - 0.35) / 4.0, 0, 1);
      tmpColor.copy(cSand).lerp(cPebble, deepT * 0.75 + n);
    } else if (y < 0.75) {
      const shoreT = THREE.MathUtils.clamp((y + 0.35) / 1.1, 0, 1);
      tmpColor.copy(cSand).lerp(cMeadow, shoreT);
    } else if (y < 14.5) {
      const lushT = fbm(x * 0.04, z * 0.04, 2);
      tmpColor.copy(cMeadow).lerp(cLush, lushT);
      if (slope > 0.52) {
        tmpColor.lerp(cRock, THREE.MathUtils.clamp((slope - 0.52) * 1.45, 0, 0.88));
      }
    } else if (y < 29) {
      const rockT = THREE.MathUtils.smoothstep(y, 14, 28);
      tmpColor.copy(cLush).lerp(cRock, Math.max(rockT, slope * 0.92));
    } else {
      const snowT = THREE.MathUtils.smoothstep(y, 28, 39) * (1 - THREE.MathUtils.clamp((slope - 0.78) * 1.05, 0, 0.85));
      tmpColor.copy(cRock).lerp(cSnow, snowT);
    }

    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }

  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();

  // Unreal-inspired multi-layer landscape shader: strata rocks, crevice AO, snow sheen, aerial haze & caustics
  const terrainMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: textures.meadowDetailMap,
    bumpMap: textures.terrainBumpMap,
    bumpScale: 0.14,
    roughness: 0.88,
    metalness: 0.02,
  });

  terrainMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uSunIntensity = { value: 1.0 };
    shader.uniforms.uSeasonWarmth = { value: 0.0 };
    shader.uniforms.uWinterSnow = { value: 0.0 };
    shader.uniforms.uSunDir = { value: new THREE.Vector3(0.3, 0.6, -0.7).normalize() };
    shader.uniforms.uSkyHorizon = { value: new THREE.Color(0xbce0f4) };
    shader.uniforms.uSunColor = { value: new THREE.Color(0xfff1d4) };
    terrainMaterial.userData.shader = shader;

    shader.vertexShader =
      `varying vec3 vWorldPosTerrain;\nvarying vec3 vWorldNormalTerrain;\n` +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         vWorldPosTerrain = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vWorldNormalTerrain = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader =
      `uniform float uTime;
       uniform float uSunIntensity;
       uniform float uSeasonWarmth;
       uniform float uWinterSnow;
       uniform vec3 uSunDir;
       uniform vec3 uSkyHorizon;
       uniform vec3 uSunColor;
       varying vec3 vWorldPosTerrain;
       varying vec3 vWorldNormalTerrain;

       float tHash(vec2 p) {
         return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
       }
       float tNoise(vec2 p) {
         vec2 i = floor(p);
         vec2 f = fract(p);
         vec2 u = f * f * (3.0 - 2.0 * f);
         return mix(
           mix(tHash(i), tHash(i + vec2(1.0, 0.0)), u.x),
           mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), u.x),
           u.y
         );
       }
       float tFbm(vec2 p) {
         float v = 0.0;
         float a = 0.5;
         for (int i = 0; i < 3; i++) {
           v += a * tNoise(p);
           p *= 2.04;
           a *= 0.5;
         }
         return v;
       }
       float causticPattern(vec2 uv, float t) {
         vec2 p = uv * 0.55;
         float c1 = sin(p.x * 3.1 + t * 1.3 + sin(p.y * 2.7 - t));
         float c2 = cos(p.y * 3.5 - t * 1.1 + cos(p.x * 2.9 + t * 0.9));
         return pow(clamp((c1 * c2) * 0.5 + 0.5, 0.0, 1.0), 3.0);
       }\n` +
      shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           vec3 wNorm = normalize(vWorldNormalTerrain);
           float tSlope = 1.0 - clamp(wNorm.y, 0.0, 1.0);
           float microDetail = tFbm(vWorldPosTerrain.xz * 0.24);
           float strata = sin(vWorldPosTerrain.y * 1.35 + tFbm(vWorldPosTerrain.xz * 0.06) * 5.2) * 0.5 + 0.5;

           if (vWorldPosTerrain.y > 0.45) {
             // Granitic cliff striations & crevice darkening on slopes
             float cliffMask = smoothstep(0.22, 0.56, tSlope);
             vec3 granite = mix(vec3(0.27, 0.29, 0.32), vec3(0.49, 0.51, 0.54), strata * 0.65 + microDetail * 0.35);
             diffuseColor.rgb = mix(diffuseColor.rgb, granite, cliffMask * 0.85);

             // Organic valley meadow hue variation
             float meadowMask = (1.0 - cliffMask) * (1.0 - smoothstep(14.0, 27.0, vWorldPosTerrain.y));
             vec3 richMoss = vec3(0.18, 0.36, 0.16);
             vec3 sunGrass = vec3(0.38, 0.52, 0.22);
             diffuseColor.rgb = mix(diffuseColor.rgb, mix(richMoss, sunGrass, microDetail), meadowMask * 0.42);
           }

           if (vWorldPosTerrain.y > 0.55 && vWorldPosTerrain.y < 30.0) {
             if (uSeasonWarmth > 0.01) {
               diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.58, 0.41, 0.17), uSeasonWarmth * 0.55);
             }
             if (uWinterSnow > 0.01) {
               float frostMask = smoothstep(0.6, 16.0, vWorldPosTerrain.y) * (1.0 - smoothstep(0.45, 0.78, tSlope)) * uWinterSnow;
               diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.91, 0.96), frostMask * 0.78);
             }
           }

           // Crisp alpine snow ridges with cool azure shadow facets
           if (vWorldPosTerrain.y > 24.0) {
             float snowLedge = smoothstep(24.0, 36.0, vWorldPosTerrain.y) * (1.0 - smoothstep(0.32, 0.68, tSlope));
             float sunFacing = clamp(dot(wNorm, normalize(uSunDir)), 0.0, 1.0);
             vec3 snowCol = mix(vec3(0.75, 0.83, 0.93), vec3(0.97, 0.98, 1.0), smoothstep(0.05, 0.45, sunFacing));
             diffuseColor.rgb = mix(diffuseColor.rgb, snowCol, snowLedge * 0.92);
           }

           // Underwater sun caustics
           if (vWorldPosTerrain.y < 0.02) {
             float depthFade = smoothstep(-5.0, -0.1, vWorldPosTerrain.y);
             float c = causticPattern(vWorldPosTerrain.xz, uTime);
             diffuseColor.rgb += vec3(0.19, 0.28, 0.26) * c * depthFade * uSunIntensity;
           }

           // Height-aware atmospheric aerial perspective on distant mountains
           vec3 viewVecT = vWorldPosTerrain - cameraPosition;
           float distT = length(viewVecT);
           float aerial = smoothstep(68.0, 245.0, distT) * 0.42;
           float sunScatter = pow(max(dot(normalize(viewVecT), normalize(uSunDir)), 0.0), 4.0) * 0.35 * uSunIntensity;
           vec3 hazeCol = mix(uSkyHorizon, uSunColor, sunScatter);
           diffuseColor.rgb = mix(diffuseColor.rgb, hazeCol, aerial);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
           float wetShore = 1.0 - smoothstep(0.0, 0.42, abs(vWorldPosTerrain.y - 0.05));
           roughnessFactor = mix(roughnessFactor, 0.34, wetShore);
           float snowRough = smoothstep(26.0, 38.0, vWorldPosTerrain.y) * (1.0 - smoothstep(0.32, 0.68, 1.0 - clamp(vWorldNormalTerrain.y, 0.0, 1.0)));
           roughnessFactor = mix(roughnessFactor, 0.56, snowRough);`,
        );
  };

  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMaterial);
  terrainMesh.receiveShadow = true;
  group.add(terrainMesh);

  // 3. Sculpted 4-Tier Organic Alpine Pine / Fir Trees with Wind Sway & Subsurface Glow
  function createOrganicPineTierGeometry(
    baseRadius: number,
    height: number,
    yOffset: number,
    lobes: number,
    phaseTwist: number,
  ): THREE.ConeGeometry {
    const geo = new THREE.ConeGeometry(baseRadius, height, 18, 5, false);
    geo.translate(0, yOffset, 0);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const r = Math.hypot(vx, vz);
      if (r > 0.02) {
        const ang = Math.atan2(vz, vx) + phaseTwist;
        const hNorm = THREE.MathUtils.clamp((vy - (yOffset - height * 0.5)) / height, 0, 1);
        const branchLobe = 0.80 + 0.24 * Math.sin(ang * lobes) + 0.09 * Math.cos(ang * lobes * 2.0);
        const radialScale = branchLobe * (1.0 + (1.0 - hNorm) * 0.08);
        const droop = (1.0 - hNorm) * -0.14 * (0.5 + 0.5 * Math.sin(ang * lobes));
        pos.setXYZ(i, vx * radialScale, vy + droop, vz * radialScale);
      }
    }
    geo.computeVertexNormals();
    return geo;
  }

  const treeCount = 620;
  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.30, 2.5, 8);
  trunkGeo.translate(0, 1.25, 0);
  const trunkMat = new THREE.MeshStandardMaterial({
    map: textures.barkMap,
    bumpMap: textures.barkBumpMap,
    bumpScale: 0.055,
    color: 0x6b4b35,
    roughness: 0.94,
  });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  trunks.castShadow = true;
  trunks.receiveShadow = true;

  const tier1Geo = createOrganicPineTierGeometry(2.05, 2.6, 2.75, 9, 0.0);
  const tier2Geo = createOrganicPineTierGeometry(1.65, 2.35, 4.05, 8, 0.55);
  const tier3Geo = createOrganicPineTierGeometry(1.22, 2.05, 5.25, 7, 1.15);
  const tier4Geo = createOrganicPineTierGeometry(0.76, 1.65, 6.32, 6, 1.85);

  const foliageMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.pineFoliageMap,
    bumpMap: textures.terrainBumpMap,
    bumpScale: 0.04,
    roughness: 0.84,
    metalness: 0.0,
  });

  foliageMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWind = { value: 1.0 };
    shader.uniforms.uSunDir = { value: new THREE.Vector3(0.3, 0.6, -0.7).normalize() };
    shader.uniforms.uSunIntensity = { value: 1.0 };
    foliageMat.userData.shader = shader;

    shader.vertexShader =
      `uniform float uTime;\nuniform float uWind;\nvarying vec3 vWorldPosTree;\n` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float treePhase = 0.0;
         #ifdef USE_INSTANCING
           treePhase = instanceMatrix[3][0] * 0.45 + instanceMatrix[3][2] * 0.35;
         #endif
         float canopyHeight = smoothstep(1.2, 7.2, position.y);
         transformed.x += sin(uTime * 1.15 + treePhase + position.y * 0.35) * 0.14 * canopyHeight * uWind;
         transformed.z += cos(uTime * 0.92 + treePhase * 1.3) * 0.09 * canopyHeight * uWind;`,
      ).replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         vec4 wpTree = vec4(transformed, 1.0);
         #ifdef USE_INSTANCING
           wpTree = instanceMatrix * wpTree;
         #endif
         vWorldPosTree = (modelMatrix * wpTree).xyz;`,
      );

    shader.fragmentShader =
      `uniform vec3 uSunDir;\nuniform float uSunIntensity;\nvarying vec3 vWorldPosTree;\n` +
      shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `vec3 viewDirTree = normalize(cameraPosition - vWorldPosTree);
         float backLit = pow(max(dot(-viewDirTree, normalize(uSunDir)), 0.0), 3.0);
         gl_FragColor.rgb += vec3(0.28, 0.45, 0.14) * backLit * 0.32 * uSunIntensity;
         #include <dithering_fragment>`,
      );
  };

  const foliage1 = new THREE.InstancedMesh(tier1Geo, foliageMat, treeCount);
  const foliage2 = new THREE.InstancedMesh(tier2Geo, foliageMat, treeCount);
  const foliage3 = new THREE.InstancedMesh(tier3Geo, foliageMat, treeCount);
  const foliage4 = new THREE.InstancedMesh(tier4Geo, foliageMat, treeCount);
  foliage1.castShadow = true;
  foliage2.castShadow = true;
  foliage3.castShadow = true;
  foliage4.castShadow = true;
  foliage1.receiveShadow = true;
  foliage2.receiveShadow = true;
  foliage3.receiveShadow = true;
  foliage4.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const treeColor = new THREE.Color();
  let placedTrees = 0;
  let attempts = 0;
  while (placedTrees < treeCount && attempts < 10500) {
    attempts++;
    const angle = (attempts * 2.39996) % (Math.PI * 2);
    const radius = 52 + ((attempts * 8.43) % 188);
    const tx = Math.cos(angle) * radius;
    const tz = Math.sin(angle) * radius - 42;
    if (Math.abs(tx) < 7.5 && tz > -2 && tz < 17) continue;
    const ty = groundHeightAt(tx, tz);
    if (ty < 0.72 || ty > 28.5) continue;

    const scale = 0.82 + hash2(tx, tz) * 0.72;
    dummy.position.set(tx, ty - 0.18, tz);
    dummy.rotation.set(0, hash2(tz, tx) * Math.PI * 2, 0);
    dummy.scale.set(scale, scale * (0.92 + hash2(tx + 3, tz) * 0.28), scale);
    dummy.updateMatrix();

    trunks.setMatrixAt(placedTrees, dummy.matrix);
    foliage1.setMatrixAt(placedTrees, dummy.matrix);
    foliage2.setMatrixAt(placedTrees, dummy.matrix);
    foliage3.setMatrixAt(placedTrees, dummy.matrix);
    foliage4.setMatrixAt(placedTrees, dummy.matrix);

    const gShift = 0.86 + hash2(tx * 2, tz * 2) * 0.30;
    treeColor.setRGB(0.16 * gShift, 0.36 * gShift, 0.19 * gShift);
    foliage1.setColorAt(placedTrees, treeColor);
    foliage2.setColorAt(placedTrees, treeColor.clone().multiplyScalar(1.07));
    foliage3.setColorAt(placedTrees, treeColor.clone().multiplyScalar(1.14));
    foliage4.setColorAt(placedTrees, treeColor.clone().multiplyScalar(1.22));
    placedTrees++;
  }
  trunks.count = placedTrees;
  foliage1.count = placedTrees;
  foliage2.count = placedTrees;
  foliage3.count = placedTrees;
  foliage4.count = placedTrees;
  trunks.instanceMatrix.needsUpdate = true;
  foliage1.instanceMatrix.needsUpdate = true;
  foliage2.instanceMatrix.needsUpdate = true;
  foliage3.instanceMatrix.needsUpdate = true;
  foliage4.instanceMatrix.needsUpdate = true;
  if (foliage1.instanceColor) foliage1.instanceColor.needsUpdate = true;
  if (foliage2.instanceColor) foliage2.instanceColor.needsUpdate = true;
  if (foliage3.instanceColor) foliage3.instanceColor.needsUpdate = true;
  if (foliage4.instanceColor) foliage4.instanceColor.needsUpdate = true;
  trunks.computeBoundingSphere();
  foliage1.computeBoundingSphere();
  foliage2.computeBoundingSphere();
  foliage3.computeBoundingSphere();
  foliage4.computeBoundingSphere();
  group.add(trunks, foliage1, foliage2, foliage3, foliage4);

  // 3a. Broadleaf / Birch Valley Trees for lush multi-species woodland contrast
  const leafTreeCount = 150;
  const leafTrunkGeo = new THREE.CylinderGeometry(0.09, 0.21, 2.3, 7);
  leafTrunkGeo.translate(0, 1.15, 0);
  const leafTrunkMat = new THREE.MeshStandardMaterial({
    map: textures.barkMap,
    color: 0xbcae9c,
    roughness: 0.9,
  });
  const leafTrunks = new THREE.InstancedMesh(leafTrunkGeo, leafTrunkMat, leafTreeCount);
  leafTrunks.castShadow = true;
  leafTrunks.receiveShadow = true;

  const crownGeo = new THREE.IcosahedronGeometry(1.45, 1);
  const crownPos = crownGeo.attributes.position;
  for (let i = 0; i < crownPos.count; i++) {
    const cx = crownPos.getX(i);
    const cy = crownPos.getY(i);
    const cz = crownPos.getZ(i);
    const bump = 0.82 + hash2(cx * 4 + cy * 3, cz * 5) * 0.34;
    crownPos.setXYZ(i, cx * bump, cy * bump * 0.84 + 3.1, cz * bump);
  }
  crownGeo.computeVertexNormals();
  const leafCrownMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    bumpMap: textures.terrainBumpMap,
    bumpScale: 0.04,
    roughness: 0.82,
  });
  leafCrownMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWind = { value: 1.0 };
    leafCrownMat.userData.shader = shader;
    shader.vertexShader =
      `uniform float uTime;\nuniform float uWind;\n` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float lPhase = 0.0;
         #ifdef USE_INSTANCING
           lPhase = instanceMatrix[3][0] * 0.5 + instanceMatrix[3][2] * 0.4;
         #endif
         float lHeight = smoothstep(1.8, 4.4, position.y);
         transformed.x += sin(uTime * 1.35 + lPhase) * 0.14 * lHeight * uWind;
         transformed.z += cos(uTime * 1.05 + lPhase * 1.2) * 0.10 * lHeight * uWind;`,
      );
  };
  const leafCrowns = new THREE.InstancedMesh(crownGeo, leafCrownMat, leafTreeCount);
  leafCrowns.castShadow = true;
  leafCrowns.receiveShadow = true;

  let placedLeafTrees = 0;
  for (let i = 0; i < 3000 && placedLeafTrees < leafTreeCount; i++) {
    const ang = (i * 2.39996 + 0.7) % (Math.PI * 2);
    const rad = 52 + ((i * 7.21) % 120);
    const lx = Math.cos(ang) * rad;
    const lz = Math.sin(ang) * rad - 42;
    if (Math.abs(lx) < 8 && lz > -2 && lz < 18) continue;
    const ly = groundHeightAt(lx, lz);
    if (ly < 0.68 || ly > 12.0) continue;

    const sc = 0.76 + hash2(lx + 4, lz - 2) * 0.62;
    dummy.position.set(lx, ly - 0.14, lz);
    dummy.rotation.set(0, hash2(lz, lx) * Math.PI * 2, 0);
    dummy.scale.set(sc, sc * (0.9 + hash2(lx, lz) * 0.25), sc);
    dummy.updateMatrix();
    leafTrunks.setMatrixAt(placedLeafTrees, dummy.matrix);
    leafCrowns.setMatrixAt(placedLeafTrees, dummy.matrix);

    const tint = 0.8 + hash2(lx * 3, lz * 3) * 0.32;
    treeColor.setRGB(0.28 * tint, 0.50 * tint, 0.20 * tint);
    leafCrowns.setColorAt(placedLeafTrees, treeColor);
    placedLeafTrees++;
  }
  leafTrunks.count = placedLeafTrees;
  leafCrowns.count = placedLeafTrees;
  leafTrunks.instanceMatrix.needsUpdate = true;
  leafCrowns.instanceMatrix.needsUpdate = true;
  if (leafCrowns.instanceColor) leafCrowns.instanceColor.needsUpdate = true;
  leafTrunks.computeBoundingSphere();
  leafCrowns.computeBoundingSphere();
  group.add(leafTrunks, leafCrowns);

  // 3b. Lush Shoreline Bushes & Meadow Shrubs
  const bushCount = 360;
  const bushGeo = new THREE.DodecahedronGeometry(0.62, 1);
  const bPos = bushGeo.attributes.position;
  for (let i = 0; i < bPos.count; i++) {
    const bx = bPos.getX(i);
    const by = bPos.getY(i);
    const bz = bPos.getZ(i);
    const n = 0.78 + hash2(bx * 6 + by * 2, bz * 6) * 0.38;
    bPos.setXYZ(i, bx * n * 1.25, Math.max(0.02, (by + 0.45) * n * 0.72), bz * n * 1.25);
  }
  bushGeo.computeVertexNormals();
  const bushMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    bumpMap: textures.terrainBumpMap,
    bumpScale: 0.04,
    roughness: 0.88,
  });
  const bushesMesh = new THREE.InstancedMesh(bushGeo, bushMat, bushCount);
  bushesMesh.castShadow = true;
  bushesMesh.receiveShadow = true;
  let placedBushes = 0;
  for (let i = 0; i < 4200 && placedBushes < bushCount; i++) {
    const bx = (hash2(i * 1.9, 14.3) - 0.5) * 230;
    const bz = (hash2(11.7, i * 2.9) - 0.5) * 190 - 42;
    if (Math.abs(bx) < 5.2 && bz > -2 && bz < 14) continue;
    const by = groundHeightAt(bx, bz);
    if (by < 0.38 || by > 11.5) continue;

    const bs = 0.65 + hash2(bx, bz) * 0.95;
    dummy.position.set(bx, by - 0.06, bz);
    dummy.rotation.set(0, hash2(i, 21) * Math.PI * 2, 0);
    dummy.scale.set(bs, bs * (0.78 + hash2(bz, bx) * 0.4), bs);
    dummy.updateMatrix();
    bushesMesh.setMatrixAt(placedBushes, dummy.matrix);

    const gVal = 0.34 + hash2(bx * 2, bz) * 0.24;
    treeColor.setRGB(gVal * 0.58, gVal * 1.05, gVal * 0.42);
    bushesMesh.setColorAt(placedBushes, treeColor);
    placedBushes++;
  }
  bushesMesh.count = placedBushes;
  bushesMesh.instanceMatrix.needsUpdate = true;
  if (bushesMesh.instanceColor) bushesMesh.instanceColor.needsUpdate = true;
  bushesMesh.computeBoundingSphere();
  group.add(bushesMesh);

  // 3c. Meadow Wildflower Blossoms for painterly lakeside banks
  const flowerCount = 260;
  const flowerGeo = new THREE.ConeGeometry(0.11, 0.28, 5);
  flowerGeo.rotateX(Math.PI);
  flowerGeo.translate(0, 0.26, 0);
  const flowerMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.65,
  });
  const flowerMesh = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerCount);
  let placedFlowers = 0;
  const flowerPalette = [0xf7d65a, 0xf2f0e4, 0xd8a8f0, 0xf29f74];
  for (let i = 0; i < 3400 && placedFlowers < flowerCount; i++) {
    const fx = (hash2(i * 4.3, 6.1) - 0.5) * 210;
    const fz = (hash2(8.3, i * 5.1) - 0.5) * 175 - 40;
    if (Math.abs(fx) < 3.5 && fz > -1 && fz < 12) continue;
    const fy = groundHeightAt(fx, fz);
    if (fy < 0.5 || fy > 6.8) continue;

    const fs = 0.75 + hash2(fx, fz) * 0.75;
    dummy.position.set(fx, fy - 0.02, fz);
    dummy.rotation.set((hash2(i, 3) - 0.5) * 0.2, hash2(i, 7) * Math.PI * 2, (hash2(i, 11) - 0.5) * 0.2);
    dummy.scale.setScalar(fs);
    dummy.updateMatrix();
    flowerMesh.setMatrixAt(placedFlowers, dummy.matrix);

    treeColor.setHex(flowerPalette[placedFlowers % flowerPalette.length]);
    flowerMesh.setColorAt(placedFlowers, treeColor);
    placedFlowers++;
  }
  flowerMesh.count = placedFlowers;
  flowerMesh.instanceMatrix.needsUpdate = true;
  if (flowerMesh.instanceColor) flowerMesh.instanceColor.needsUpdate = true;
  flowerMesh.computeBoundingSphere();
  group.add(flowerMesh);

  // 3d. Lush Meadow Grass & Shoreline Tufts swaying in wind
  const grassCount = 1350;
  const grassGeo = new THREE.ConeGeometry(0.18, 0.64, 5);
  grassGeo.translate(0, 0.32, 0);
  const grassMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
  });
  grassMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWind = { value: 1.0 };
    grassMat.userData.shader = shader;
    shader.vertexShader =
      `uniform float uTime;\nuniform float uWind;\n` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float gSway = smoothstep(0.0, 0.6, position.y);
         float gPhase = 0.0;
         #ifdef USE_INSTANCING
           gPhase = instanceMatrix[3][0] * 0.9 + instanceMatrix[3][2] * 0.7;
         #endif
         transformed.x += sin(uTime * 2.1 + gPhase) * 0.08 * gSway * uWind;`,
      );
  };
  const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, grassCount);
  grassMesh.castShadow = true;
  grassMesh.receiveShadow = true;
  let placedGrass = 0;
  for (let i = 0; i < 9500 && placedGrass < grassCount; i++) {
    const gx = (hash2(i * 2.3, 9.1) - 0.5) * 230;
    const gz = (hash2(4.1, i * 3.7) - 0.5) * 195 - 40;
    if (Math.abs(gx) < 3.0 && gz > -1 && gz < 12) continue;
    const gy = groundHeightAt(gx, gz);
    if (gy < 0.36 || gy > 8.2) continue;

    const gs = 0.75 + hash2(gx, gz) * 0.85;
    dummy.position.set(gx, gy - 0.04, gz);
    dummy.rotation.set((hash2(i, 5) - 0.5) * 0.25, hash2(i, 8) * Math.PI * 2, (hash2(i, 13) - 0.5) * 0.25);
    dummy.scale.set(gs * 1.15, gs, gs * 1.15);
    dummy.updateMatrix();
    grassMesh.setMatrixAt(placedGrass, dummy.matrix);

    const gg = 0.38 + hash2(gz, gx) * 0.22;
    treeColor.setRGB(gg * 0.62, gg * 1.05, gg * 0.42);
    grassMesh.setColorAt(placedGrass, treeColor);
    placedGrass++;
  }
  grassMesh.count = placedGrass;
  grassMesh.instanceMatrix.needsUpdate = true;
  if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;
  grassMesh.computeBoundingSphere();
  group.add(grassMesh);

  // 4. Instanced Shoreline & Submerged Lake Boulders
  const rockCount = 165;
  const rockGeo = new THREE.DodecahedronGeometry(1, 1);
  const rPos = rockGeo.attributes.position;
  for (let i = 0; i < rPos.count; i++) {
    const vx = rPos.getX(i);
    const vy = rPos.getY(i);
    const vz = rPos.getZ(i);
    const n = 0.80 + hash2(vx * 5 + vy * 3, vz * 7) * 0.35;
    rPos.setXYZ(i, vx * n, vy * n * 0.72, vz * n);
  }
  rockGeo.computeVertexNormals();
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    bumpMap: textures.terrainBumpMap,
    bumpScale: 0.06,
    roughness: 0.86,
    metalness: 0.04,
  });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  let placedRocks = 0;
  for (let i = 0; i < 720 && placedRocks < rockCount; i++) {
    const rx = (hash2(i, 11) - 0.5) * 195;
    const rz = (hash2(19, i) - 0.5) * 155 - 44;
    if (Math.hypot(rx, rz - 1) < 6.0) continue;
    const ry = groundHeightAt(rx, rz);
    if (ry < -4.2 || ry > 9.0) continue;

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
  const reedCount = 740;
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
  for (let i = 0; i < 7200 && placedReeds < reedCount; i++) {
    const rx = (hash2(i * 3.1, 7.2) - 0.5) * 190;
    const rz = (hash2(2.7, i * 4.3) - 0.5) * 145 - 44;
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
      const sunIntensity = Math.max(0.15, 1.0 - starAlpha * 0.75 - stormFactor * 0.5);
      if (tShader) {
        tShader.uniforms.uTime.value = elapsed;
        tShader.uniforms.uSunIntensity.value = sunIntensity;
        tShader.uniforms.uSeasonWarmth.value = season === 'autumn' ? 1.0 : 0.0;
        tShader.uniforms.uWinterSnow.value = season === 'winter' ? 1.0 : 0.0;
        tShader.uniforms.uSunDir.value.copy(sunDir);
        tShader.uniforms.uSkyHorizon.value.copy(skyHorizon);
        tShader.uniforms.uSunColor.value.copy(sunColor);
      }

      const fShader = foliageMat.userData.shader;
      const windSpeedFactor = (weather === 'storm' ? 2.4 : weather === 'rain' ? 1.5 : 1.0) * windMultiplier;
      if (fShader) {
        fShader.uniforms.uTime.value = elapsed;
        fShader.uniforms.uWind.value = windSpeedFactor;
        fShader.uniforms.uSunDir.value.copy(sunDir);
        fShader.uniforms.uSunIntensity.value = sunIntensity;
      }

      const gShader = grassMat.userData.shader;
      if (gShader) {
        gShader.uniforms.uTime.value = elapsed;
        gShader.uniforms.uWind.value = windSpeedFactor;
      }

      const lcShader = leafCrownMat.userData.shader;
      if (lcShader) {
        lcShader.uniforms.uTime.value = elapsed;
        lcShader.uniforms.uWind.value = windSpeedFactor;
      }

      flowerMesh.visible = season !== 'winter';
      if (season === 'autumn') {
        foliageMat.color.setHex(0xd4a45a);
        leafCrownMat.color.setHex(0xd8833b);
        bushMat.color.setHex(0xc49548);
        grassMat.color.setHex(0xc9a35d);
      } else if (season === 'winter') {
        foliageMat.color.setHex(0xc4d8de);
        leafCrownMat.color.setHex(0x9fb5bd);
        bushMat.color.setHex(0xa8bcc2);
        grassMat.color.setHex(0x9fb5ba);
      } else if (season === 'spring') {
        foliageMat.color.setHex(0xffffff);
        leafCrownMat.color.setHex(0xffffff);
        bushMat.color.setHex(0xffffff);
        grassMat.color.setHex(0xffffff);
      } else {
        foliageMat.color.setHex(0xebffe6);
        leafCrownMat.color.setHex(0xe0ffcf);
        bushMat.color.setHex(0xe5ffd9);
        grassMat.color.setHex(0xe8ffd9);
      }

      const rShader = reedMat.userData.shader;
      if (rShader) {
        rShader.uniforms.uTime.value = elapsed;
        rShader.uniforms.uWind.value = windSpeedFactor;
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
          bird.root.rotation.z = 0.16;
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
      tier4Geo.dispose();
      foliageMat.dispose();
      leafTrunkGeo.dispose();
      leafTrunkMat.dispose();
      crownGeo.dispose();
      leafCrownMat.dispose();
      bushGeo.dispose();
      bushMat.dispose();
      flowerGeo.dispose();
      flowerMat.dispose();
      grassGeo.dispose();
      grassMat.dispose();
      rockGeo.dispose();
      rockMat.dispose();
      reedGeo.dispose();
      reedMat.dispose();
      wingGeo.dispose();
      birdWingMat.dispose();
      gullMat.dispose();
    },
  };
}
