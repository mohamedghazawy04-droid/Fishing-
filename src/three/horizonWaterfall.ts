import * as THREE from 'three';
import { groundHeightAt } from './environment';
import type { SeasonId, WeatherType } from '../types/fishing';

export interface HorizonWaterfallSystem {
  group: THREE.Group;
  worldCenter: THREE.Vector3;
  update: (params: {
    elapsed: number;
    sunDir: THREE.Vector3;
    sunColor: THREE.Color;
    skyHorizon: THREE.Color;
    moonDir: THREE.Vector3;
    moonColor: THREE.Color;
    nightFactor: number;
    sunIntensity: number;
    weather: WeatherType;
    season: SeasonId;
    windSpeedKmh: number;
    fogColor: THREE.Color;
    fogDensity: number;
  }) => void;
  dispose: () => void;
}

function detHash(a: number, b: number): number {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

/**
 * Builds a subdivided PlaneGeometry curved into a realistic parabolic free-fall water sheet
 * that arcs forward (+Z) as it drops downward and flares gently toward the plunge base.
 */
function createParabolicWaterfallGeometry(
  widthTop: number,
  widthBottom: number,
  height: number,
  arcForwardZ: number,
  cliffCurveZ: number,
  segsX: number,
  segsY: number,
): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(1, 1, segsX, segsY);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const ux = pos.getX(i); // -0.5 .. +0.5
    const uy = pos.getY(i); // -0.5 .. +0.5
    const vNorm = 0.5 - uy; // 0 at top lip -> 1 at bottom plunge
    const widthAtY = THREE.MathUtils.lerp(widthTop, widthBottom, Math.pow(vNorm, 0.85));
    const x = ux * widthAtY;
    const y = (uy + 0.5) * height; // 0 at bottom -> height at top
    // Parabolic free-fall arc + slight concave amphitheater wrap
    const zCurve = Math.pow(vNorm, 0.72) * arcForwardZ + (1.0 - 4.0 * ux * ux) * cliffCurveZ;
    const zRipple = Math.sin(ux * Math.PI * 5.0 + vNorm * 6.0) * 0.35 * vNorm;
    pos.setXYZ(i, x, y, zCurve + zRipple);
  }
  geo.computeVertexNormals();
  return geo;
}

export function createHorizonWaterfall(isSoftwareGl: boolean): HorizonWaterfallSystem {
  const group = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    disposables.push(m);
    return m;
  };

  // Position towering granite amphitheater on the northern alpine mountain horizon
  // Aligned cleanly in the pier & lake northern sightline (-Z) at (-16, 0, -292)
  const worldX = -16;
  const worldZ = -292;
  const baseTerrainY = Math.max(8, groundHeightAt(worldX, worldZ) - 4);
  const root = new THREE.Group();
  root.position.set(worldX, baseTerrainY, worldZ);
  root.rotation.y = Math.atan2(0 - worldX, 2.32 - worldZ);
  group.add(root);

  const worldCenter = new THREE.Vector3(worldX, baseTerrainY + 32, worldZ);

  // ---------------------------------------------------------------------------
  // 1. Sculpted Wet Granite Cliff Amphitheater, Spill Lip, Mid-Shelf & Snow Caps
  // ---------------------------------------------------------------------------
  const wetGraniteMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x323940,
      roughness: 0.32,
      metalness: 0.08,
    }),
  );
  const dryGraniteMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x52575d,
      roughness: 0.86,
      metalness: 0.03,
    }),
  );
  const cliffMossMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x264729,
      roughness: 0.9,
    }),
  );
  const snowCapMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xeff5fb,
      roughness: 0.62,
      metalness: 0.02,
    }),
  );

  const slabGeo = trackGeo(new THREE.DodecahedronGeometry(1.0, 2));
  const slabPos = slabGeo.attributes.position;
  for (let i = 0; i < slabPos.count; i++) {
    const sx = slabPos.getX(i);
    const sy = slabPos.getY(i);
    const sz = slabPos.getZ(i);
    const n = 0.82 + detHash(sx * 7.1 + sy * 3.7, sz * 5.3) * 0.34;
    slabPos.setXYZ(i, sx * n, sy * n, sz * n);
  }
  slabGeo.computeVertexNormals();

  // [x, y, z, sx, sy, sz, rx, ry, rz, isWet, hasSnowCap]
  const cliffMassifs: [number, number, number, number, number, number, number, number, number, boolean, boolean][] = [
    // Left towering granite wall
    [-22, 32, -3, 14, 34, 13, 0.08, 0.4, 0.12, false, true],
    [-14, 24, 1.5, 9.5, 25, 10, -0.05, 0.9, 0.06, true, false],
    [-28, 19, 3, 12, 22, 11, 0.1, -0.3, -0.08, false, false],
    // Right towering granite wall
    [22, 34, -2, 14, 36, 13, -0.06, -0.5, -0.1, false, true],
    [15, 22, 2, 9, 24, 9.5, 0.04, -0.8, -0.05, true, false],
    [29, 18, 4, 11, 20, 10, -0.08, 0.25, 0.09, false, false],
    // Rear headwall backing the falling sheets (solid wet dark cliff)
    [0, 34, -6.5, 21, 35, 7.5, 0.05, 0.12, 0.0, true, false],
    [0, 56, -8.0, 22, 14, 11, 0.12, -0.2, 0.0, false, true],
    // Upper spill lip & mid-cliff splitting boulder shelf
    [-3.8, 52.5, -1.8, 6.2, 4.2, 5.2, 0.18, 0.5, 0.04, true, false],
    [3.8, 52.0, -1.6, 5.8, 4.0, 5.0, -0.12, -0.4, 0.06, true, false],
    [0.2, 30.0, 2.2, 5.2, 4.5, 4.8, 0.14, 0.8, -0.05, true, false],
    [-8.2, 27.0, 3.6, 5.4, 5.2, 4.6, -0.1, 0.3, 0.12, true, false],
    [8.8, 25.5, 3.8, 5.2, 4.8, 4.6, 0.08, -0.6, -0.1, true, false],
    // Plunge basin rocky rim boulders
    [-11, 4.5, 11, 8.5, 6.0, 7.5, 0.1, 0.4, 0.05, true, false],
    [11, 4.0, 11.5, 8.5, 5.8, 7.5, -0.08, -0.45, -0.04, true, false],
    [0, 2.2, 13.5, 13, 3.2, 6.5, 0.04, 0.15, 0.0, true, false],
  ];

  const snowCaps: THREE.Mesh[] = [];
  cliffMassifs.forEach(([cx, cy, cz, sx, sy, sz, rx, ry, rz, isWet, hasSnow]) => {
    const m = new THREE.Mesh(slabGeo, isWet ? wetGraniteMat : dryGraniteMat);
    m.position.set(cx, cy, cz);
    m.scale.set(sx, sy, sz);
    m.rotation.set(rx, ry, rz);
    m.receiveShadow = true;
    root.add(m);

    if (hasSnow) {
      const cap = new THREE.Mesh(slabGeo, snowCapMat);
      cap.position.set(cx, cy + sy * 0.62, cz - 0.5);
      cap.scale.set(sx * 0.84, sy * 0.24, sz * 0.78);
      cap.rotation.set(rx * 0.5, ry + 0.3, rz * 0.5);
      root.add(cap);
      snowCaps.push(cap);
    }
  });

  // Lush wet moss shoulders clinging beside the spray zone
  const mossPads: [number, number, number, number, number, number][] = [
    [-10.5, 31, 4.2, 4.2, 2.4, 3.6],
    [10.2, 28, 4.4, 4.0, 2.2, 3.4],
    [-12.5, 12, 8.5, 5.5, 2.6, 4.2],
    [12.8, 11, 8.8, 5.6, 2.4, 4.2],
  ];
  mossPads.forEach(([mx, my, mz, sx, sy, sz]) => {
    const pad = new THREE.Mesh(slabGeo, cliffMossMat);
    pad.position.set(mx, my, mz);
    pad.scale.set(sx, sy, sz);
    root.add(pad);
  });

  // ---------------------------------------------------------------------------
  // 2. Shared Photographic Waterfall Shader Uniforms & GLSL Material
  // ---------------------------------------------------------------------------
  const sharedUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.3, 0.5, -0.8).normalize() },
    uSunColor: { value: new THREE.Color(0xfff1cc) },
    uSkyHorizon: { value: new THREE.Color(0xb8dcf0) },
    uMoonDir: { value: new THREE.Vector3(-0.22, 0.44, -0.87).normalize() },
    uMoonColor: { value: new THREE.Color(0xdcecff) },
    uNightFactor: { value: 0 },
    uSunIntensity: { value: 1.0 },
    uWind: { value: 1.0 },
    uFogColor: { value: new THREE.Color(0xb8dcf0) },
    uFogDensity: { value: 0.0014 },
  };

  function createWaterfallSheetMaterial(flowSpeed: number, densityBias: number, layerPhase: number): THREE.ShaderMaterial {
    return trackMat(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
        uniforms: {
          uTime: sharedUniforms.uTime,
          uSunDir: sharedUniforms.uSunDir,
          uSunColor: sharedUniforms.uSunColor,
          uSkyHorizon: sharedUniforms.uSkyHorizon,
          uMoonDir: sharedUniforms.uMoonDir,
          uMoonColor: sharedUniforms.uMoonColor,
          uNightFactor: sharedUniforms.uNightFactor,
          uSunIntensity: sharedUniforms.uSunIntensity,
          uWind: sharedUniforms.uWind,
          uFogColor: sharedUniforms.uFogColor,
          uFogDensity: sharedUniforms.uFogDensity,
          uFlowSpeed: { value: flowSpeed },
          uDensityBias: { value: densityBias },
          uLayerPhase: { value: layerPhase },
        },
        vertexShader: `
          uniform float uTime;
          uniform float uFlowSpeed;
          uniform float uWind;
          uniform float uLayerPhase;
          varying vec2 vUv;
          varying vec3 vWorldPos;
          varying vec3 vWorldNormal;

          void main() {
            vUv = uv;
            vec3 p = position;
            float fallProgress = 1.0 - uv.y;
            float wave1 = sin(uv.y * 16.0 + uTime * (uFlowSpeed * 9.5) + uv.x * 11.0 + uLayerPhase);
            float wave2 = cos(uv.y * 29.0 + uTime * (uFlowSpeed * 14.0) - uv.x * 19.0);
            p.z += (wave1 * 0.24 + wave2 * 0.11) * (0.25 + fallProgress * 0.85);
            p.x += sin(uTime * 1.4 + uv.y * 5.0 + uLayerPhase) * 0.35 * uWind * fallProgress;

            vec4 wp = modelMatrix * vec4(p, 1.0);
            vWorldPos = wp.xyz;
            vWorldNormal = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform vec3 uSunDir;
          uniform vec3 uSunColor;
          uniform vec3 uSkyHorizon;
          uniform vec3 uMoonDir;
          uniform vec3 uMoonColor;
          uniform float uNightFactor;
          uniform float uSunIntensity;
          uniform vec3 uFogColor;
          uniform float uFogDensity;
          uniform float uFlowSpeed;
          uniform float uDensityBias;
          uniform float uLayerPhase;

          varying vec2 vUv;
          varying vec3 vWorldPos;
          varying vec3 vWorldNormal;

          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
          }
          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
              mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
              u.y
            );
          }
          float fbm(vec2 p) {
            float v = 0.0;
            float a = 0.5;
            for (int i = 0; i < 4; i++) {
              v += a * noise(p);
              p = p * vec2(2.07, 2.03) + vec2(1.7, 9.2);
              a *= 0.5;
            }
            return v;
          }

          void main() {
            float fallT = 1.0 - vUv.y; // 0 crest -> 1 plunge base
            // Gravity-like downward acceleration warp
            float accelY = vUv.y + 0.22 * fallT * fallT;

            // Horizontal break-up & domain warp for organic braided water tongues
            float warp = fbm(vec2(vUv.x * 7.5 + uLayerPhase, accelY * 4.5 + uTime * uFlowSpeed * 1.15));
            float xWarped = vUv.x + (warp - 0.5) * 0.14 * (0.35 + fallT * 0.75);

            // 3 synchronized velocity streak layers
            float streamSlow = fbm(vec2(xWarped * 13.0, accelY * 5.2 + uTime * uFlowSpeed * 1.1 + uLayerPhase));
            float streamMed  = fbm(vec2(xWarped * 26.0 + 3.1, accelY * 9.0 + uTime * uFlowSpeed * 1.85));
            float filaments  = noise(vec2(xWarped * 68.0 - 2.4, accelY * 18.0 + uTime * uFlowSpeed * 2.95));

            // Combine into rich cascading foam veins & dark-teal translucent water curtains
            float waterBody = smoothstep(0.24, 0.74, streamSlow * 0.58 + streamMed * 0.42);
            float foamCore = smoothstep(0.46, 0.86, streamMed * 0.56 + filaments * 0.44 + fallT * 0.24);
            float brightCrests = smoothstep(0.66, 0.94, filaments * 0.55 + streamMed * 0.45);

            // Organic feathered side edges + ragged plunging mist breakup at bottom
            float edgeNoise = (warp - 0.5) * 0.20;
            float lateralMask = smoothstep(0.02, 0.20, vUv.x + edgeNoise) * smoothstep(0.98, 0.80, vUv.x + edgeNoise);
            float topMask = smoothstep(1.0, 0.92, vUv.y);
            float bottomMistMask = smoothstep(0.0, 0.22 + warp * 0.12, vUv.y);
            float silhouetteAlpha = lateralMask * topMask * mix(bottomMistMask, 1.0, foamCore * 0.45);

            float alpha = clamp((waterBody * 0.58 + foamCore * 0.65) * silhouetteAlpha * uDensityBias, 0.0, 0.95);
            if (alpha < 0.02) discard;

            // Physical lighting: translucent alpine teal core + sunlit aerated whitewater foam
            vec3 viewDir = normalize(cameraPosition - vWorldPos);
            vec3 nrm = normalize(vWorldNormal);
            float sunFront = max(dot(nrm, normalize(uSunDir)), 0.0);
            float sunBackScatter = pow(max(dot(-viewDir, normalize(uSunDir)), 0.0), 3.0);
            float fresnel = pow(1.0 - max(dot(viewDir, nrm), 0.0), 2.5);

            vec3 deepWaterCol = mix(vec3(0.08, 0.30, 0.36), uSkyHorizon * 0.58, fresnel * 0.55);
            vec3 dayFoamBase = mix(vec3(0.80, 0.90, 0.94), vec3(0.98, 0.99, 1.0), brightCrests);
            vec3 dayLitFoam = dayFoamBase * mix(vec3(0.55, 0.62, 0.68), uSunColor * 1.18, 0.52 + sunFront * 0.48);
            dayLitFoam += uSunColor * sunBackScatter * 0.22 * uSunIntensity;

            // Subtle sunlit atmospheric rainbow prism arc in lower spray zone
            float sprayZone = smoothstep(0.58, 0.92, fallT) * smoothstep(0.25, 0.72, foamCore);
            float arcCoord = vUv.x * 1.4 + (1.0 - vUv.y) * 0.6;
            float rainbowBand = exp(-pow((arcCoord - 0.82) * 5.8, 2.0));
            vec3 rainbowTint = 0.5 + 0.5 * cos(6.28318 * (arcCoord * 2.2 + vec3(0.0, 0.33, 0.67)));
            float rainbowStrength = sprayZone * rainbowBand * max(0.0, uSunIntensity - 0.42) * (1.0 - uNightFactor) * 0.24;

            // Night moonlit waterfall silver shimmer
            float moonSpec = pow(max(dot(nrm, normalize(uMoonDir)), 0.0), 2.0);
            vec3 nightWater = mix(vec3(0.04, 0.11, 0.18), uMoonColor * (0.48 + moonSpec * 0.55), foamCore * 0.85);

            vec3 col = mix(deepWaterCol, dayLitFoam, foamCore);
            col = mix(col * (0.36 + uSunIntensity * 0.72), nightWater, uNightFactor * 0.92);
            col += rainbowTint * rainbowStrength;

            // Match scene FogExp2 aerial haze seamlessly
            float dist = length(cameraPosition - vWorldPos);
            float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
            col = mix(col, uFogColor, clamp(fogFactor * 0.94, 0.0, 0.94));

            gl_FragColor = vec4(col, alpha);
          }
        `,
      }),
    );
  }

  const makeFixedWaterfallMat = createWaterfallSheetMaterial;

  // Multi-Tier Curved Cascading Ribbons
  const upperPlungeGeo = trackGeo(createParabolicWaterfallGeometry(11.5, 17.0, 26.0, 4.8, 1.4, isSoftwareGl ? 14 : 26, isSoftwareGl ? 24 : 44));
  const upperPlungeMesh = new THREE.Mesh(upperPlungeGeo, makeFixedWaterfallMat(0.85, 0.96, 0.0));
  upperPlungeMesh.position.set(0, 31.5, -1.2);
  upperPlungeMesh.renderOrder = 4;
  root.add(upperPlungeMesh);

  // Inner deeper translucent core sheet behind upper plunge for volumetric depth
  const upperCoreGeo = trackGeo(createParabolicWaterfallGeometry(9.8, 14.5, 25.0, 4.1, 1.2, 12, 20));
  const upperCoreMesh = new THREE.Mesh(upperCoreGeo, makeFixedWaterfallMat(0.68, 0.88, 2.3));
  upperCoreMesh.position.set(0.2, 31.8, -1.9);
  upperCoreMesh.renderOrder = 3;
  root.add(upperCoreMesh);

  // Lower Left Braided Cascade (from mid-cliff shelf y=33m down to plunge basin y=3m)
  const lowerLeftGeo = trackGeo(createParabolicWaterfallGeometry(8.5, 13.0, 29.5, 6.2, 1.2, isSoftwareGl ? 12 : 22, isSoftwareGl ? 22 : 38));
  const lowerLeftMesh = new THREE.Mesh(lowerLeftGeo, makeFixedWaterfallMat(0.95, 0.95, 4.1));
  lowerLeftMesh.position.set(-4.6, 3.2, 3.6);
  lowerLeftMesh.rotation.y = -0.06;
  lowerLeftMesh.renderOrder = 4;
  root.add(lowerLeftMesh);

  // Lower Right Broad Cascade
  const lowerRightGeo = trackGeo(createParabolicWaterfallGeometry(9.6, 14.5, 30.0, 6.4, 1.2, isSoftwareGl ? 12 : 22, isSoftwareGl ? 22 : 38));
  const lowerRightMesh = new THREE.Mesh(lowerRightGeo, makeFixedWaterfallMat(1.04, 0.96, 7.2));
  lowerRightMesh.position.set(4.8, 3.0, 3.7);
  lowerRightMesh.rotation.y = 0.07;
  lowerRightMesh.renderOrder = 4;
  root.add(lowerRightMesh);

  // Slender Secondary Silver Ribbon cascading on the right cliff flank
  const sideRibbonGeo = trackGeo(createParabolicWaterfallGeometry(2.6, 4.8, 34.0, 4.2, 0.6, 8, 22));
  const sideRibbonMesh = new THREE.Mesh(sideRibbonGeo, makeFixedWaterfallMat(1.12, 0.82, 11.4));
  sideRibbonMesh.position.set(12.2, 12.0, 2.4);
  sideRibbonMesh.rotation.y = 0.16;
  sideRibbonMesh.renderOrder = 4;
  root.add(sideRibbonMesh);

  // ---------------------------------------------------------------------------
  // 3. Swirling Volumetric Mist Plumes (mid-shelf & plunge pool aerosol clouds)
  // ---------------------------------------------------------------------------
  const mistMat = trackMat(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uSunColor: sharedUniforms.uSunColor,
        uMoonColor: sharedUniforms.uMoonColor,
        uNightFactor: sharedUniforms.uNightFactor,
        uSunIntensity: sharedUniforms.uSunIntensity,
        uWind: sharedUniforms.uWind,
        uFogColor: sharedUniforms.uFogColor,
        uFogDensity: sharedUniforms.uFogDensity,
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uSunColor;
        uniform vec3 uMoonColor;
        uniform float uNightFactor;
        uniform float uSunIntensity;
        uniform float uWind;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        float mHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float mNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mHash(i), mHash(i + vec2(1.0, 0.0)), u.x),
            mix(mHash(i + vec2(0.0, 1.0)), mHash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }
        float mFbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 3; i++) {
            v += a * mNoise(p);
            p *= 2.05;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec2 centered = vUv - 0.5;
          float radial = 1.0 - smoothstep(0.10, 0.49, length(centered));
          if (radial < 0.01) discard;

          vec2 drift = vec2(uTime * 0.08 * uWind, -uTime * 0.22);
          float billow = mFbm(vUv * 4.2 + drift + vWorldPos.xy * 0.03);
          float alpha = radial * smoothstep(0.28, 0.80, billow) * 0.54;
          if (alpha < 0.015) discard;

          vec3 dayMist = mix(vec3(0.86, 0.93, 0.97), uSunColor * 1.06, 0.26 * uSunIntensity);
          dayMist *= (0.48 + 0.52 * uSunIntensity);
          vec3 nightMist = mix(vec3(0.16, 0.26, 0.36), uMoonColor * 0.58, 0.55);
          vec3 col = mix(dayMist, nightMist, uNightFactor * 0.9);

          float dist = length(cameraPosition - vWorldPos);
          float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
          col = mix(col, uFogColor, clamp(fogFactor * 0.92, 0.0, 0.92));

          gl_FragColor = vec4(col, alpha);
        }
      `,
    }),
  );

  const mistGeo = trackGeo(new THREE.PlaneGeometry(1, 1));
  const mistConfigs: [number, number, number, number, number][] = [
    // Mid-cliff shelf swirling mist
    [-3.5, 32.5, 6.2, 20, 14],
    [4.0, 32.0, 6.4, 21, 15],
    [0.0, 34.0, 7.6, 26, 16],
    // Base plunge pool billowing mist clouds
    [-9.5, 8.5, 11.5, 28, 22],
    [0.0, 9.5, 12.8, 34, 24],
    [9.8, 8.2, 11.8, 28, 22],
    [-4.5, 14.5, 14.2, 32, 24],
    [4.5, 14.0, 14.4, 32, 24],
  ];
  mistConfigs.forEach(([mx, my, mz, sw, sh], idx) => {
    const m = new THREE.Mesh(mistGeo, mistMat);
    m.position.set(mx, my, mz);
    m.scale.set(sw, sh, 1);
    m.rotation.z = (idx % 3 - 1) * 0.14;
    m.renderOrder = 6;
    root.add(m);
  });

  // ---------------------------------------------------------------------------
  // 4. GPU-Animated Falling Spray Droplets (900 particles, zero JS loop!)
  // ---------------------------------------------------------------------------
  const particleCount = isSoftwareGl ? 380 : 900;
  const pPos = new Float32Array(particleCount * 3);
  const pSeed = new Float32Array(particleCount);
  const pSize = new Float32Array(particleCount);
  const pVel = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount; i++) {
    const tierChoice = i % 3;
    if (tierChoice === 0) {
      // Upper lip spray
      pPos[i * 3] = (detHash(i, 1.3) - 0.5) * 13.0;
      pPos[i * 3 + 1] = 56.5 + (detHash(i, 2.7) - 0.5) * 2.5;
      pPos[i * 3 + 2] = 0.2 + detHash(i, 3.1) * 2.0;
      pVel[i * 3] = (detHash(i, 4.1) - 0.5) * 3.5;
      pVel[i * 3 + 1] = -14.0 - detHash(i, 5.2) * 10.0;
      pVel[i * 3 + 2] = 2.6 + detHash(i, 6.4) * 3.0;
    } else if (tierChoice === 1) {
      // Mid-shelf bounce & burst spray
      const side = detHash(i, 7.9) < 0.5 ? -4.6 : 4.8;
      pPos[i * 3] = side + (detHash(i, 8.2) - 0.5) * 11.0;
      pPos[i * 3 + 1] = 32.5 + (detHash(i, 9.1) - 0.5) * 2.0;
      pPos[i * 3 + 2] = 4.2 + detHash(i, 10.3) * 2.6;
      pVel[i * 3] = (detHash(i, 11.1) - 0.5) * 5.2;
      pVel[i * 3 + 1] = -13.0 - detHash(i, 12.2) * 11.0;
      pVel[i * 3 + 2] = 3.2 + detHash(i, 13.3) * 3.8;
    } else {
      // Lower plunge upward mist & fine falling droplets
      pPos[i * 3] = (detHash(i, 14.7) - 0.5) * 24.0;
      pPos[i * 3 + 1] = 3.5 + detHash(i, 15.1) * 5.5;
      pPos[i * 3 + 2] = 9.0 + detHash(i, 16.4) * 5.5;
      pVel[i * 3] = (detHash(i, 17.2) - 0.5) * 4.5;
      pVel[i * 3 + 1] = 5.5 + detHash(i, 18.9) * 5.0;
      pVel[i * 3 + 2] = 2.2 + detHash(i, 19.6) * 3.0;
    }
    pSeed[i] = detHash(i, 21.7);
    pSize[i] = 2.4 + detHash(i, 23.1) * 3.8;
  }

  const sprayGeo = trackGeo(new THREE.BufferGeometry());
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  sprayGeo.setAttribute('aSeed', new THREE.BufferAttribute(pSeed, 1));
  sprayGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
  sprayGeo.setAttribute('aVel', new THREE.BufferAttribute(pVel, 3));

  const sprayMat = trackMat(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uSunColor: sharedUniforms.uSunColor,
        uMoonColor: sharedUniforms.uMoonColor,
        uNightFactor: sharedUniforms.uNightFactor,
        uSunIntensity: sharedUniforms.uSunIntensity,
        uFogColor: sharedUniforms.uFogColor,
        uFogDensity: sharedUniforms.uFogDensity,
      },
      vertexShader: `
        attribute float aSeed;
        attribute float aSize;
        attribute vec3 aVel;
        uniform float uTime;
        varying float vAlpha;
        varying vec3 vWorldPos;

        void main() {
          float life = fract(uTime * (0.48 + aSeed * 0.35) + aSeed * 7.13);
          vec3 p = position + aVel * life;
          p.y -= 9.5 * life * life;
          vAlpha = sin(life * 3.14159);

          vec4 wp = modelMatrix * vec4(p, 1.0);
          vWorldPos = wp.xyz;
          vec4 mvPos = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPos;
          gl_PointSize = clamp(aSize * (280.0 / max(1.0, -mvPos.z)), 1.5, 16.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uSunColor;
        uniform vec3 uMoonColor;
        uniform float uNightFactor;
        uniform float uSunIntensity;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        varying float vAlpha;
        varying vec3 vWorldPos;

        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float soft = pow(1.0 - d * 2.0, 1.6);

          vec3 dayCol = mix(vec3(0.88, 0.95, 1.0), uSunColor, 0.25) * (0.5 + 0.5 * uSunIntensity);
          vec3 nightCol = uMoonColor * 0.65;
          vec3 col = mix(dayCol, nightCol, uNightFactor * 0.88);

          float dist = length(cameraPosition - vWorldPos);
          float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
          col = mix(col, uFogColor, clamp(fogFactor * 0.9, 0.0, 0.9));

          gl_FragColor = vec4(col, soft * vAlpha * 0.68);
        }
      `,
    }),
  );
  const sprayPoints = new THREE.Points(sprayGeo, sprayMat);
  sprayPoints.renderOrder = 7;
  root.add(sprayPoints);

  // ---------------------------------------------------------------------------
  // 5. Foaming Whitewater Plunge Pool Apron at Cliff Base
  // ---------------------------------------------------------------------------
  const basinGeo = trackGeo(new THREE.CircleGeometry(15.5, 28));
  basinGeo.rotateX(-Math.PI / 2);
  const basinMat = trackMat(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uSunColor: sharedUniforms.uSunColor,
        uMoonColor: sharedUniforms.uMoonColor,
        uNightFactor: sharedUniforms.uNightFactor,
        uSunIntensity: sharedUniforms.uSunIntensity,
        uFogColor: sharedUniforms.uFogColor,
        uFogDensity: sharedUniforms.uFogDensity,
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uSunColor;
        uniform vec3 uMoonColor;
        uniform float uNightFactor;
        uniform float uSunIntensity;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        varying vec2 vUv;
        varying vec3 vWorldPos;

        void main() {
          vec2 c = vUv - 0.5;
          float r = length(c) * 2.0;
          if (r > 1.0) discard;

          float wave = sin(r * 24.0 - uTime * 3.8) * 0.5 + 0.5;
          float churn = smoothstep(0.95, 0.18, r) * (0.45 + 0.55 * wave);
          vec3 foamCol = mix(vec3(0.24, 0.54, 0.58), vec3(0.94, 0.98, 1.0), churn);
          foamCol *= mix(vec3(0.55, 0.65, 0.72), uSunColor, 0.35 * uSunIntensity);
          foamCol = mix(foamCol, uMoonColor * 0.45, uNightFactor * 0.88);

          float dist = length(cameraPosition - vWorldPos);
          float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
          foamCol = mix(foamCol, uFogColor, clamp(fogFactor * 0.92, 0.0, 0.92));

          gl_FragColor = vec4(foamCol, smoothstep(1.0, 0.25, r) * 0.78);
        }
      `,
    }),
  );
  const plungeBasin = new THREE.Mesh(basinGeo, basinMat);
  plungeBasin.position.set(0, 2.8, 10.5);
  plungeBasin.scale.set(1.2, 1.0, 0.65);
  plungeBasin.renderOrder = 3;
  root.add(plungeBasin);

  return {
    group,
    worldCenter,
    update: ({
      elapsed,
      sunDir,
      sunColor,
      skyHorizon,
      moonDir,
      moonColor,
      nightFactor,
      sunIntensity,
      weather,
      season,
      windSpeedKmh,
      fogColor,
      fogDensity,
    }) => {
      sharedUniforms.uTime.value = elapsed;
      sharedUniforms.uSunDir.value.copy(sunDir);
      sharedUniforms.uSunColor.value.copy(sunColor);
      sharedUniforms.uSkyHorizon.value.copy(skyHorizon);
      sharedUniforms.uMoonDir.value.copy(moonDir);
      sharedUniforms.uMoonColor.value.copy(moonColor);
      sharedUniforms.uNightFactor.value = nightFactor;
      sharedUniforms.uSunIntensity.value = sunIntensity;
      sharedUniforms.uWind.value = THREE.MathUtils.clamp(windSpeedKmh / 10, 0.4, 2.4);
      sharedUniforms.uFogColor.value.copy(fogColor);
      sharedUniforms.uFogDensity.value = fogDensity;

      // Adapt mountain snow caps & wet moss tint across seasons
      const isWinter = season === 'winter';
      const isAutumn = season === 'autumn';
      for (let i = 0; i < snowCaps.length; i++) {
        snowCaps[i].scale.y = isWinter ? 0.34 : season === 'summer' ? 0.14 : 0.24;
      }
      cliffMossMat.color.setHex(
        isWinter ? 0x5c726d : isAutumn ? 0x5c5b24 : weather === 'rain' || weather === 'storm' ? 0x1d4021 : 0x264729,
      );
      wetGraniteMat.roughness = weather === 'rain' || weather === 'storm' ? 0.2 : 0.32;
    },
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
