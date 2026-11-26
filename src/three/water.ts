import * as THREE from 'three';
import { groundHeightAt } from './environment';
import type { WeatherType } from '../types/fishing';

export interface RippleEvent {
  x: number;
  z: number;
  startTime: number;
  strength: number;
}

export interface WaterNightReflectionUniforms {
  nightFactor: number;
  moonDir: THREE.Vector3;
  moonColor: THREE.Color;
  moonSize: number;
  moonReflBoost: number;
  starReflStrength: number;
  auroraStrength: number;
  auroraColorA: THREE.Color;
  auroraColorB: THREE.Color;
  waterDeepNightTint: THREE.Color;
  cloudCover: number;
}

export interface CrystalWaterSystem {
  group: THREE.Group;
  waterMesh: THREE.Mesh;
  addRipple: (x: number, z: number, strength?: number) => void;
  spawnSplash: (x: number, z: number, intensity?: number) => void;
  getSurfaceHeightAt: (x: number, z: number) => number;
  update: (
    dt: number,
    elapsed: number,
    sunDir: THREE.Vector3,
    skyTop: THREE.Color,
    skyHorizon: THREE.Color,
    sunColor: THREE.Color,
    weather: WeatherType,
    windSpeedKmh: number,
    fogColor: THREE.Color,
    fogDensity: number,
    nightRefl: WaterNightReflectionUniforms,
    underwaterBlend?: number,
    hookedPos?: THREE.Vector3 | null,
  ) => void;
  dispose: () => void;
}

const MAX_RIPPLES = 24;
const SPLASH_POOL_SIZE = 160;

export function createCrystalWater(isSoftwareGl: boolean): CrystalWaterSystem {
  const group = new THREE.Group();

  // 1. Expanded Crystal-Clear Lake Water Surface Mesh covering main lake + outer gorges & lagoons
  const waterWidth = 380;
  const waterDepthLen = 270;
  const segs = isSoftwareGl ? 120 : 210;
  const waterGeo = new THREE.PlaneGeometry(waterWidth, waterDepthLen, segs, segs);
  waterGeo.rotateX(-Math.PI / 2);
  waterGeo.translate(0, 0, -82);

  const pos = waterGeo.attributes.position;
  const depthAttr = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i);
    const wz = pos.getZ(i);
    const gh = groundHeightAt(wx, wz);
    depthAttr[i] = Math.max(0, -gh);
  }
  waterGeo.setAttribute('aWaterDepth', new THREE.BufferAttribute(depthAttr, 1));

  // Ripple uniform array: vec4(x, z, startTime, strength)
  const rippleArray: THREE.Vector4[] = [];
  for (let i = 0; i < MAX_RIPPLES; i++) {
    rippleArray.push(new THREE.Vector4(0, 0, -999, 0));
  }
  let rippleCursor = 0;
  let currentTime = 0;
  let smoothWaveAmp = 0.025;
  let smoothWindNorm = 0.2;
  let wavePhaseOffset = 0;
  const windDir = new THREE.Vector2(0.78, 0.62).normalize();

  const waterMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uUnderwater: { value: 0 },
      uHookedPos: { value: new THREE.Vector3(0, -999, 0) },
      uHookedActive: { value: 0 },
      uWavePhase: { value: 0 },
      uWaveAmp: { value: 0.025 },
      uWindNorm: { value: 0.2 },
      uWindDir: { value: windDir },
      uSunDir: { value: new THREE.Vector3(0.3, 0.5, -0.8).normalize() },
      uMoonDir: { value: new THREE.Vector3(-0.22, 0.44, -0.87).normalize() },
      uMoonColor: { value: new THREE.Color(0xdcecff) },
      uMoonSize: { value: 1.0 },
      uMoonReflBoost: { value: 1.15 },
      uNightFactor: { value: 0.0 },
      uStarReflStrength: { value: 1.15 },
      uAuroraStrength: { value: 0.25 },
      uAuroraColorA: { value: new THREE.Color(0x3ef0b4) },
      uAuroraColorB: { value: new THREE.Color(0x52a8ff) },
      uWaterNightTint: { value: new THREE.Color(0x082338) },
      uCloudCover: { value: 0.25 },
      uSkyTop: { value: new THREE.Color(0x2a66a8) },
      uSkyHorizon: { value: new THREE.Color(0xb8dcf0) },
      uSunColor: { value: new THREE.Color(0xfff1cc) },
      uShallowColor: { value: new THREE.Color(0x2d9c92) },
      uDeepColor: { value: new THREE.Color(0x0b4b5c) },
      uAbyssColor: { value: new THREE.Color(0x052638) },
      uFogColor: { value: new THREE.Color(0xb8dcf0) },
      uFogDensity: { value: 0.0014 },
      uRipples: { value: rippleArray },
    },
    vertexShader: `
      attribute float aWaterDepth;
      uniform float uTime;
      uniform float uWavePhase;
      uniform float uWaveAmp;
      uniform float uWindNorm;
      uniform vec2 uWindDir;
      uniform vec4 uRipples[${MAX_RIPPLES}];
      varying vec3 vWorldPos;
      varying float vDepth;
      varying float vWaveCrest;

      void main() {
        vDepth = aWaterDepth;
        vec3 p = position;
        float shoreDamp = smoothstep(0.0, 0.85, aWaterDepth);

        // Multi-directional wind-aligned rolling swells
        vec2 wDir1 = normalize(uWindDir);
        vec2 wDir2 = normalize(vec2(uWindDir.x * 0.82 - uWindDir.y * 0.57, uWindDir.x * 0.57 + uWindDir.y * 0.82));
        vec2 wDir3 = normalize(vec2(uWindDir.x * 0.76 + uWindDir.y * 0.65, -uWindDir.x * 0.65 + uWindDir.y * 0.76));

        float d1 = dot(p.xz, wDir1);
        float d2 = dot(p.xz, wDir2);
        float d3 = dot(p.xz, wDir3);

        float w1 = sin(d1 * 0.48 - uWavePhase * 1.35);
        float w2 = sin(d2 * 0.86 - uWavePhase * 1.95 + 1.2);
        float w3 = sin(d3 * 1.45 - uWavePhase * 2.55 + 2.4);
        float swell = w1 * 0.52 + w2 * 0.30 + w3 * 0.18;

        // Physical ripple rings directly lifting & dipping the 3D water mesh on cast/splash
        float rippleLift = 0.0;
        for (int i = 0; i < ${MAX_RIPPLES}; i++) {
          vec4 rip = uRipples[i];
          float age = uTime - rip.z;
          if (age > 0.0 && age < 4.5 && rip.w > 0.0) {
            float dist = length(p.xz - rip.xy);
            float radius = age * 2.85;
            float band = exp(-pow((dist - radius) * 1.85, 2.0));
            float fade = (1.0 - age / 4.5) * rip.w;
            rippleLift += sin((dist - radius) * 10.5) * band * fade * 0.085;
          }
        }

        p.y += (swell * uWaveAmp + rippleLift) * shoreDamp;
        vWaveCrest = clamp(swell * 0.5 + 0.5, 0.0, 1.0) * uWindNorm * shoreDamp;

        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uUnderwater;
      uniform vec3 uHookedPos;
      uniform float uHookedActive;
      uniform float uWavePhase;
      uniform float uWaveAmp;
      uniform float uWindNorm;
      uniform vec2 uWindDir;
      uniform vec3 uSunDir;
      uniform vec3 uMoonDir;
      uniform vec3 uMoonColor;
      uniform float uMoonSize;
      uniform float uMoonReflBoost;
      uniform float uNightFactor;
      uniform float uStarReflStrength;
      uniform float uAuroraStrength;
      uniform vec3 uAuroraColorA;
      uniform vec3 uAuroraColorB;
      uniform vec3 uWaterNightTint;
      uniform float uCloudCover;
      uniform vec3 uSkyTop;
      uniform vec3 uSkyHorizon;
      uniform vec3 uSunColor;
      uniform vec3 uShallowColor;
      uniform vec3 uDeepColor;
      uniform vec3 uAbyssColor;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform vec4 uRipples[${MAX_RIPPLES}];

      varying vec3 vWorldPos;
      varying float vDepth;
      varying float vWaveCrest;

      float wHash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      float wNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x),
          mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      void main() {
        if (vDepth <= 0.01) discard;

        vec2 p = vWorldPos.xz;
        float t = uTime;
        vec2 wDir1 = normalize(uWindDir);
        vec2 wDir2 = normalize(vec2(uWindDir.x * 0.78 - uWindDir.y * 0.62, uWindDir.x * 0.62 + uWindDir.y * 0.78));

        // Wind-driven multi-octave surface ripples
        float ph1 = dot(p, wDir1) * 1.15 - uWavePhase * 1.85;
        float ph2 = dot(p, wDir2) * 2.25 - uWavePhase * 2.45;
        float ph3 = dot(p, vec2(-wDir1.y, wDir1.x)) * 3.6 + t * (1.2 + uWindNorm * 2.1);

        float ampScale = 0.42 + uWindNorm * 1.65 + uWaveAmp * 7.5;
        float dx = (cos(ph1) * wDir1.x * 0.048 + cos(ph2) * wDir2.x * 0.032 + cos(ph3) * 0.018) * ampScale;
        float dz = (cos(ph1) * wDir1.y * 0.048 + cos(ph2) * wDir2.y * 0.032 + sin(ph3) * 0.018) * ampScale;

        // Expanding concentric ripples from casts, splashes, bites & raindrops
        float rippleHighlight = 0.0;
        for (int i = 0; i < ${MAX_RIPPLES}; i++) {
          vec4 rip = uRipples[i];
          float age = t - rip.z;
          if (age > 0.0 && age < 4.5 && rip.w > 0.0) {
            vec2 diff = p - rip.xy;
            float dist = length(diff);
            float radius = age * 2.85;
            float band = exp(-pow((dist - radius) * 2.2, 2.0));
            float fade = (1.0 - age / 4.5) * rip.w;
            float wave = sin((dist - radius) * 12.5) * band * fade;
            vec2 dir = dist > 0.001 ? diff / dist : vec2(0.0);
            dx += dir.x * wave * 0.34;
            dz += dir.y * wave * 0.34;
            rippleHighlight += max(0.0, wave) * 0.42;
          }
        }

        vec3 N = normalize(vec3(-dx, 1.0, -dz));
        vec3 V = normalize(cameraPosition - vWorldPos);
        float ndotv = clamp(dot(N, V), 0.0, 1.0);

        // Fresnel: crystal clear when looking down, luminous sky reflections toward horizon
        float fresnel = pow(1.0 - ndotv, 3.1);
        vec3 R = reflect(-V, N);
        vec3 skyRefl = mix(uSkyHorizon, uSkyTop, clamp(pow(max(R.y, 0.0), 0.6), 0.0, 1.0));

        // Night Aurora & Nebula Reflection across waves
        if (uNightFactor > 0.02 && uAuroraStrength > 0.01 && R.y > 0.01) {
          vec2 arUv = R.xz / (max(R.y, 0.05) + 0.34);
          float wA = sin(arUv.x * 2.4 + t * 0.14 + sin(arUv.y * 1.8 - t * 0.08) * 1.4);
          float curtain = smoothstep(0.15, 0.92, wA * 0.5 + 0.5);
          float streak = wNoise(vec2(arUv.x * 3.1 + t * 0.04, arUv.y * 1.2 - t * 0.06));
          float bandEnv = smoothstep(0.02, 0.24, R.y) * smoothstep(0.92, 0.20, R.y);
          float arMask = curtain * smoothstep(0.32, 0.78, streak) * bandEnv * uAuroraStrength * uNightFactor * (1.0 - uCloudCover * 0.72);
          vec3 arCol = mix(uAuroraColorA, uAuroraColorB, smoothstep(0.14, 0.55, R.y));
          skyRefl += arCol * arMask * 0.85;
        }

        // Daytime Sun specular sparkle (fades naturally below horizon at night)
        vec3 L = normalize(uSunDir);
        vec3 H = normalize(L + V);
        float daySpecMask = smoothstep(-0.08, 0.14, uSunDir.y);
        float sunSpec = pow(max(dot(N, H), 0.0), mix(180.0, 95.0, uWindNorm)) * (1.25 + uWindNorm * 0.55) * daySpecMask;

        // Nighttime Moonlight Glitter Ribbon + Reflected Moon Orb & Corona
        vec3 moonReflContribution = vec3(0.0);
        vec3 starReflContribution = vec3(0.0);
        if (uNightFactor > 0.01) {
          float clearSkyVis = 1.0 - clamp(uCloudCover * 0.78, 0.0, 0.85);
          vec3 Lm = normalize(uMoonDir);
          vec3 Hm = normalize(Lm + V);
          // Classic dancing moonlight path across wave facets
          float moonSpecExp = mix(210.0, 58.0, uWindNorm);
          float moonGlitter = pow(max(dot(N, Hm), 0.0), moonSpecExp) * (1.35 + uWindNorm * 0.75);
          // Secondary wider satin sheen along the moonbeam trail
          float moonSheen = pow(max(dot(N, Hm), 0.0), 28.0) * 0.16 * (1.0 + uMoonSize * 0.25);

          // Direct mirror reflection of moon disc & halo when looking along reflection ray R
          float moonReflDot = max(dot(normalize(R), Lm), 0.0);
          float discThresh = 0.9968 - clamp(uMoonSize - 1.0, -0.25, 0.5) * 0.0018;
          float moonDiscRefl = smoothstep(discThresh - 0.0015, discThresh + 0.0008, moonReflDot) * (1.0 - uWindNorm * 0.55);
          float moonHaloRefl = (pow(moonReflDot, 18.0) * 0.22 + pow(moonReflDot, 85.0) * 0.45);

          moonReflContribution =
            uMoonColor *
            (moonGlitter + moonSheen + moonDiscRefl * 0.95 + moonHaloRefl) *
            uNightFactor *
            uMoonReflBoost *
            clearSkyVis *
            (0.45 + 0.55 * fresnel);

          // Twinkling Starlight Reflections dancing across dark lake ripples
          if (R.y > 0.015 && uStarReflStrength > 0.05) {
            float starVis = uNightFactor * clearSkyVis * uStarReflStrength * smoothstep(0.015, 0.18, R.y) * (0.35 + 0.65 * fresnel);
            vec2 rUv1 = R.xz / (R.y + 0.32) * 86.0;
            vec2 rCell1 = floor(rUv1);
            vec2 rGv1 = fract(rUv1) - 0.5;
            float rRnd1 = wHash(rCell1);
            float starCutoff1 = mix(0.962, 0.918, clamp((uStarReflStrength - 0.7) * 0.85, 0.0, 1.0));
            if (rRnd1 > starCutoff1) {
              // Stretch slightly along wave slope for authentic liquid shimmer
              vec2 stretchedGv = vec2(rGv1.x * (1.0 + uWindNorm * 0.6), rGv1.y * 0.78);
              float dS = length(stretchedGv);
              float twink = 0.52 + 0.48 * sin(t * (2.6 + fract(rRnd1 * 19.0) * 3.0) + rRnd1 * 50.0 + N.x * 12.0);
              float starSpark = smoothstep(0.26, 0.02, dS) * twink;
              vec3 sCol = mix(vec3(0.84, 0.92, 1.0), uMoonColor, 0.28);
              starReflContribution += sCol * starSpark * starVis * 0.95;
            }

            // Fine shimmering micro-star glints
            vec2 rUv2 = R.xz / (R.y + 0.26) * 142.0 + vec2(9.2, 4.8);
            vec2 rCell2 = floor(rUv2);
            vec2 rGv2 = fract(rUv2) - 0.5;
            float rRnd2 = wHash(rCell2);
            float starCutoff2 = mix(0.968, 0.928, clamp((uStarReflStrength - 0.8) * 0.8, 0.0, 1.0));
            if (rRnd2 > starCutoff2) {
              float dS2 = length(rGv2);
              float twink2 = 0.45 + 0.55 * cos(t * 3.6 + rRnd2 * 70.0 - N.z * 14.0);
              float starSpark2 = smoothstep(0.22, 0.02, dS2) * twink2;
              starReflContribution += mix(vec3(0.88, 0.95, 1.0), uAuroraColorB, 0.25) * starSpark2 * starVis * 0.62;
            }
          }
        }

        // Subtle underwater solar caustics shimmer in shallow/mid depths
        float causticPattern = sin(p.x * 2.6 + ph1 * 0.8) * cos(p.y * 2.4 - ph2 * 0.7);
        float caustics = smoothstep(0.35, 0.95, causticPattern * 0.5 + 0.5) * (1.0 - smoothstep(0.6, 5.8, vDepth)) * 0.14 * daySpecMask;

        // Deeper 0..12m alpine water color absorption gradient
        float depthFactor = smoothstep(0.15, 6.8, vDepth);
        float abyssFactor = smoothstep(5.2, 11.6, vDepth);
        vec3 baseWaterTint = mix(uShallowColor, uDeepColor, depthFactor);
        baseWaterTint = mix(baseWaterTint, uAbyssColor, abyssFactor * 0.88);
        baseWaterTint = mix(baseWaterTint, uWaterNightTint, uNightFactor * (0.45 + 0.42 * depthFactor));
        vec3 waterTint = baseWaterTint + uSunColor * caustics;

        // Shoreline foam + wind-driven whitecap crest foam when wind speed is strong
        float shoreFoam = smoothstep(0.26, 0.02, vDepth) * (0.24 + uWindNorm * 0.35);
        float crestNoise = sin(p.x * 3.1 - uWavePhase * 2.2) * cos(p.y * 2.7 + uWavePhase * 1.7) * 0.5 + 0.5;
        float whitecapFoam = smoothstep(0.52, 0.92, vWaveCrest * 1.35 * (0.65 + crestNoise * 0.5)) * smoothstep(0.35, 1.0, uWindNorm) * 0.45;
        float totalFoam = clamp(shoreFoam + whitecapFoam, 0.0, 0.85);

        vec3 col = mix(waterTint, skyRefl, clamp(fresnel * 0.88 + 0.10 + uNightFactor * 0.06, 0.0, 0.95));
        col += uSunColor * sunSpec;
        col += moonReflContribution + starReflContribution;
        vec3 foamTint = mix(vec3(0.90, 0.97, 0.99), uMoonColor * 0.72 + vec3(0.18), uNightFactor * 0.75);
        col += foamTint * (rippleHighlight + totalFoam);

        // Exponential distance fog matching scene.fog
        float viewDist = length(cameraPosition - vWorldPos);
        float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * viewDist * viewDist);
        col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));

        // Crystal clarity in shallows, richer deep-water absorption over 7-12m abyss
        float baseAlpha = 0.14 + depthFactor * 0.24 + abyssFactor * 0.22;
        float alpha = mix(baseAlpha, 0.86, fresnel);
        alpha = clamp(alpha + totalFoam * 0.48 + rippleHighlight * 0.28 + length(moonReflContribution) * 0.12, 0.10, 0.96);

        if (!gl_FrontFacing) {
          // Looking upward from underwater: shimmering Snell's window + silvery total internal reflection
          vec3 Ndown = -N;
          float ndotvUnder = clamp(dot(Ndown, V), 0.0, 1.0);
          float snellWindow = smoothstep(0.32, 0.68, ndotvUnder);
          vec3 underBright = mix(uDeepColor * 1.45, mix(uSkyHorizon, uSunColor, 0.28), snellWindow * (0.72 - uNightFactor * 0.38));
          underBright += uSunColor * pow(max(dot(Ndown, normalize(uSunDir)), 0.0), 8.0) * 0.45 * daySpecMask;
          underBright += foamTint * (rippleHighlight * 0.85 + totalFoam * 0.55);
          underBright = mix(underBright, uFogColor, clamp(fogFactor, 0.0, 1.0));
          float underAlpha = mix(0.68, 0.28, snellWindow);
          gl_FragColor = vec4(underBright, underAlpha);
          return;
        }

        // Crystal-clear surface viewing window over the hooked fish so player above sees fish + hook underwater
        if (uHookedActive > 0.01) {
          float distHook = length(vWorldPos.xz - uHookedPos.xz);
          float hookedWindow = smoothstep(3.6, 0.6, distHook) * clamp(uHookedActive, 0.0, 1.0);
          col = mix(col, waterTint + foamTint * (rippleHighlight + totalFoam * 0.45), hookedWindow * 0.62);
          alpha = mix(alpha, clamp(0.14 + totalFoam * 0.28 + rippleHighlight * 0.22, 0.12, 0.42), hookedWindow * 0.88);
        }

        gl_FragColor = vec4(col, alpha * (1.0 - uUnderwater * 0.35));
      }
    `,
  });

  const waterMesh = new THREE.Mesh(waterGeo, waterMaterial);
  waterMesh.renderOrder = 2;
  group.add(waterMesh);

  // 2. 3D Splash Droplet & Mist Spray Particle System for Casts, Bites & Fish Surfacing
  const splashPositions = new Float32Array(SPLASH_POOL_SIZE * 3);
  const splashVelocities = new Float32Array(SPLASH_POOL_SIZE * 3);
  const splashLifetimes = new Float32Array(SPLASH_POOL_SIZE);
  const splashMaxLives = new Float32Array(SPLASH_POOL_SIZE);
  for (let i = 0; i < SPLASH_POOL_SIZE; i++) {
    splashPositions[i * 3 + 1] = -999;
    splashLifetimes[i] = 0;
  }
  const splashGeo = new THREE.BufferGeometry();
  splashGeo.setAttribute('position', new THREE.BufferAttribute(splashPositions, 3));
  const splashMat = new THREE.PointsMaterial({
    color: 0xeaf8ff,
    size: 0.16,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
  });
  const splashPoints = new THREE.Points(splashGeo, splashMat);
  splashPoints.frustumCulled = false;
  splashPoints.renderOrder = 3;
  group.add(splashPoints);
  let splashCursor = 0;

  function triggerRipple(x: number, z: number, strength = 1.0): void {
    rippleArray[rippleCursor].set(x, z, currentTime, strength);
    rippleCursor = (rippleCursor + 1) % MAX_RIPPLES;
  }

  function triggerSplashBurst(x: number, z: number, intensity = 1.0): void {
    // Primary impact wave + secondary outer echo ring
    triggerRipple(x, z, intensity * 1.45);
    triggerRipple(x + 0.08, z - 0.08, intensity * 0.85);

    const count = Math.min(36, Math.round(14 + intensity * 16));
    for (let i = 0; i < count; i++) {
      const idx = splashCursor;
      splashCursor = (splashCursor + 1) % SPLASH_POOL_SIZE;

      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;
      const radialSpeed = (0.65 + Math.random() * 1.55) * Math.sqrt(intensity);
      const upSpeed = (2.1 + Math.random() * 2.4) * Math.min(1.45, 0.75 + intensity * 0.45);

      splashPositions[idx * 3] = x + Math.cos(angle) * 0.08;
      splashPositions[idx * 3 + 1] = 0.06;
      splashPositions[idx * 3 + 2] = z + Math.sin(angle) * 0.08;

      splashVelocities[idx * 3] = Math.cos(angle) * radialSpeed;
      splashVelocities[idx * 3 + 1] = upSpeed;
      splashVelocities[idx * 3 + 2] = Math.sin(angle) * radialSpeed;

      const life = 0.45 + Math.random() * 0.35;
      splashLifetimes[idx] = life;
      splashMaxLives[idx] = life;
    }
    splashGeo.attributes.position.needsUpdate = true;
  }

  // 3. Underwater swaying aquatic plants anchored on lakebed & gorge bottoms
  const weedCount = 240;
  const weedGeo = new THREE.PlaneGeometry(0.18, 0.95, 1, 4);
  weedGeo.translate(0, 0.47, 0);
  const weedMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    side: THREE.DoubleSide,
  });
  weedMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uCurrent = { value: 1.0 };
    weedMat.userData.shader = shader;
    shader.vertexShader =
      `uniform float uTime;\nuniform float uCurrent;\n` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float sway = smoothstep(0.0, 0.9, position.y);
         float instPhase = 0.0;
         #ifdef USE_INSTANCING
           instPhase = instanceMatrix[3][0] * 0.9 + instanceMatrix[3][2] * 1.3;
         #endif
         transformed.x += sin(uTime * (1.2 + uCurrent * 0.6) + instPhase) * (0.11 + uCurrent * 0.06) * sway;
         transformed.z += cos(uTime * (1.0 + uCurrent * 0.5) + instPhase) * (0.08 + uCurrent * 0.04) * sway;`,
      );
  };
  const weeds = new THREE.InstancedMesh(weedGeo, weedMat, weedCount);
  const dummy = new THREE.Object3D();
  const cWeed = new THREE.Color();
  let placedWeeds = 0;
  for (let i = 0; i < 4200 && placedWeeds < weedCount; i++) {
    const wx = Math.sin(i * 12.7) * 165;
    const wz = Math.cos(i * 7.9) * 102 - 92;
    const gy = groundHeightAt(wx, wz);
    if (gy > -0.45 || gy < -5.5) continue;

    const s = 0.6 + ((i * 37) % 10) * 0.08;
    dummy.position.set(wx, gy - 0.05, wz);
    dummy.rotation.set(0, (i * 1.7) % Math.PI, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    weeds.setMatrixAt(placedWeeds, dummy.matrix);
    cWeed.setRGB(0.16, 0.4 + ((i * 13) % 5) * 0.04, 0.24);
    weeds.setColorAt(placedWeeds, cWeed);
    placedWeeds++;
  }
  weeds.count = placedWeeds;
  weeds.instanceMatrix.needsUpdate = true;
  if (weeds.instanceColor) weeds.instanceColor.needsUpdate = true;
  weeds.computeBoundingSphere();
  group.add(weeds);

  return {
    group,
    waterMesh,
    addRipple: triggerRipple,
    spawnSplash: triggerSplashBurst,
    getSurfaceHeightAt: (x: number, z: number): number => {
      const gh = groundHeightAt(x, z);
      const waterDepth = Math.max(0, -gh);
      const shoreDamp = THREE.MathUtils.smoothstep(waterDepth, 0.0, 0.85);

      const d1 = x * windDir.x + z * windDir.y;
      const w2x = windDir.x * 0.82 - windDir.y * 0.57;
      const w2y = windDir.x * 0.57 + windDir.y * 0.82;
      const d2 = x * w2x + z * w2y;
      const w3x = windDir.x * 0.76 + windDir.y * 0.65;
      const w3y = -windDir.x * 0.65 + windDir.y * 0.76;
      const d3 = x * w3x + z * w3y;

      const swell =
        Math.sin(d1 * 0.48 - wavePhaseOffset * 1.35) * 0.52 +
        Math.sin(d2 * 0.86 - wavePhaseOffset * 1.95 + 1.2) * 0.30 +
        Math.sin(d3 * 1.45 - wavePhaseOffset * 2.55 + 2.4) * 0.18;

      let rippleLift = 0;
      for (let i = 0; i < MAX_RIPPLES; i++) {
        const rip = rippleArray[i];
        const age = currentTime - rip.z;
        if (age > 0 && age < 4.5 && rip.w > 0) {
          const dist = Math.hypot(x - rip.x, z - rip.y);
          const radius = age * 2.85;
          const band = Math.exp(-Math.pow((dist - radius) * 1.85, 2));
          const fade = (1 - age / 4.5) * rip.w;
          rippleLift += Math.sin((dist - radius) * 10.5) * band * fade * 0.085;
        }
      }

      return (swell * smoothWaveAmp + rippleLift) * shoreDamp;
    },
    update: (dt, elapsed, sunDir, skyTop, skyHorizon, sunColor, weather, windSpeedKmh, fogColor, fogDensity, nightRefl, underwaterBlend = 0, hookedPos = null) => {
      currentTime = elapsed;

      // Map Wind Speed (0..45 km/h) directly to wave amplitude, speed & whitecap chop
      const windNorm = THREE.MathUtils.clamp(windSpeedKmh / 42, 0, 1.15);
      const weatherBoost = weather === 'storm' ? 0.025 : weather === 'rain' ? 0.01 : 0;
      const targetWaveAmp = 0.012 + Math.pow(windNorm, 1.35) * 0.125 + weatherBoost;

      smoothWaveAmp = THREE.MathUtils.damp(smoothWaveAmp, targetWaveAmp, 3.2, dt);
      smoothWindNorm = THREE.MathUtils.damp(smoothWindNorm, windNorm, 3.2, dt);

      // Integrate phase smoothly so changing wind speed never snaps wave positions
      const waveSpeed = 0.85 + smoothWindNorm * 2.45;
      wavePhaseOffset += dt * waveSpeed;

      // Subtle slow wind-direction veer over time
      const dirAngle = 0.65 + Math.sin(elapsed * 0.04) * 0.28;
      windDir.set(Math.cos(dirAngle), Math.sin(dirAngle)).normalize();

      // Update 3D Splash Particle Physics
      let anySplashActive = false;
      for (let i = 0; i < SPLASH_POOL_SIZE; i++) {
        if (splashLifetimes[i] > 0) {
          anySplashActive = true;
          splashLifetimes[i] -= dt;
          splashPositions[i * 3] += splashVelocities[i * 3] * dt;
          splashPositions[i * 3 + 1] += splashVelocities[i * 3 + 1] * dt;
          splashPositions[i * 3 + 2] += splashVelocities[i * 3 + 2] * dt;
          splashVelocities[i * 3 + 1] -= 9.8 * dt;

          if (splashLifetimes[i] <= 0 || splashPositions[i * 3 + 1] < -0.05) {
            splashLifetimes[i] = 0;
            splashPositions[i * 3 + 1] = -999;
          }
        }
      }
      if (anySplashActive) {
        splashGeo.attributes.position.needsUpdate = true;
      }

      waterMaterial.uniforms.uTime.value = elapsed;
      waterMaterial.uniforms.uUnderwater.value = underwaterBlend;
      if (hookedPos) {
        waterMaterial.uniforms.uHookedPos.value.copy(hookedPos);
        waterMaterial.uniforms.uHookedActive.value = THREE.MathUtils.damp(waterMaterial.uniforms.uHookedActive.value, 1, 6.0, dt);
      } else {
        waterMaterial.uniforms.uHookedActive.value = THREE.MathUtils.damp(waterMaterial.uniforms.uHookedActive.value, 0, 5.0, dt);
      }
      waterMaterial.uniforms.uWavePhase.value = wavePhaseOffset;
      waterMaterial.uniforms.uWaveAmp.value = smoothWaveAmp;
      waterMaterial.uniforms.uWindNorm.value = smoothWindNorm;
      waterMaterial.uniforms.uSunDir.value.copy(sunDir);
      waterMaterial.uniforms.uMoonDir.value.copy(nightRefl.moonDir);
      waterMaterial.uniforms.uMoonColor.value.copy(nightRefl.moonColor);
      waterMaterial.uniforms.uMoonSize.value = nightRefl.moonSize;
      waterMaterial.uniforms.uMoonReflBoost.value = nightRefl.moonReflBoost;
      waterMaterial.uniforms.uNightFactor.value = nightRefl.nightFactor;
      waterMaterial.uniforms.uStarReflStrength.value = nightRefl.starReflStrength;
      waterMaterial.uniforms.uAuroraStrength.value = nightRefl.auroraStrength;
      waterMaterial.uniforms.uAuroraColorA.value.copy(nightRefl.auroraColorA);
      waterMaterial.uniforms.uAuroraColorB.value.copy(nightRefl.auroraColorB);
      waterMaterial.uniforms.uWaterNightTint.value.copy(nightRefl.waterDeepNightTint);
      waterMaterial.uniforms.uCloudCover.value = nightRefl.cloudCover;
      waterMaterial.uniforms.uSkyTop.value.copy(skyTop);
      waterMaterial.uniforms.uSkyHorizon.value.copy(skyHorizon);
      waterMaterial.uniforms.uSunColor.value.copy(sunColor);
      waterMaterial.uniforms.uFogColor.value.copy(fogColor);
      waterMaterial.uniforms.uFogDensity.value = fogDensity;

      const wShader = weedMat.userData.shader;
      if (wShader) {
        wShader.uniforms.uTime.value = elapsed;
        wShader.uniforms.uCurrent.value = 0.4 + smoothWindNorm * 1.4;
      }
    },
    dispose: () => {
      waterGeo.dispose();
      waterMaterial.dispose();
      splashGeo.dispose();
      splashMat.dispose();
      weedGeo.dispose();
      weedMat.dispose();
    },
  };
}
