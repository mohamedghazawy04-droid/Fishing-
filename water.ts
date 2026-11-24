import * as THREE from 'three';
import { groundHeightAt } from './environment';
import type { WeatherType } from '../types/fishing';

export interface RippleEvent {
  x: number;
  z: number;
  startTime: number;
  strength: number;
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
  ) => void;
  dispose: () => void;
}

const MAX_RIPPLES = 14;
const SPLASH_POOL_SIZE = 160;

export function createCrystalWater(isSoftwareGl: boolean): CrystalWaterSystem {
  const group = new THREE.Group();

  // 1. Expanded Crystal-Clear Lake Water Surface Mesh with higher vertex density for physical wave swells & ripples
  const waterWidth = 140;
  const waterDepthLen = 120;
  const segs = isSoftwareGl ? 84 : 148;
  const waterGeo = new THREE.PlaneGeometry(waterWidth, waterDepthLen, segs, segs);
  waterGeo.rotateX(-Math.PI / 2);
  waterGeo.translate(0, 0, -28);

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
    uniforms: {
      uTime: { value: 0 },
      uWavePhase: { value: 0 },
      uWaveAmp: { value: 0.025 },
      uWindNorm: { value: 0.2 },
      uWindDir: { value: windDir },
      uSunDir: { value: new THREE.Vector3(0.3, 0.5, -0.8).normalize() },
      uSkyTop: { value: new THREE.Color(0x2a66a8) },
      uSkyHorizon: { value: new THREE.Color(0xb8dcf0) },
      uSunColor: { value: new THREE.Color(0xfff1cc) },
      uShallowColor: { value: new THREE.Color(0x2d9c92) },
      uDeepColor: { value: new THREE.Color(0x0b4b5c) },
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
      uniform float uWavePhase;
      uniform float uWaveAmp;
      uniform float uWindNorm;
      uniform vec2 uWindDir;
      uniform vec3 uSunDir;
      uniform vec3 uSkyTop;
      uniform vec3 uSkyHorizon;
      uniform vec3 uSunColor;
      uniform vec3 uShallowColor;
      uniform vec3 uDeepColor;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform vec4 uRipples[${MAX_RIPPLES}];

      varying vec3 vWorldPos;
      varying float vDepth;
      varying float vWaveCrest;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      // Smooth, non-repeating, wind-stretched water height field (no sine grids = no "particle" look)
      float waterHeight(vec2 p, float ph, float wind) {
        vec2 w = normalize(uWindDir);
        vec2 q = vec2(dot(p, w), dot(p, vec2(-w.y, w.x)));
        float h = 0.0;
        h += vnoise(vec2(q.x * 0.30 - ph * 0.50, q.y * 0.75 + ph * 0.05)) * 0.60;
        h += vnoise(vec2(q.x * 0.72 - ph * 0.85 + 5.2, q.y * 1.55 - ph * 0.10)) * 0.32;
        h += vnoise(vec2(q.x * 1.70 - ph * 1.40 + 9.1, q.y * 3.20 + ph * 0.22)) * 0.16 * (0.35 + wind);
        h += vnoise(vec2(q.x * 3.90 - ph * 2.10 + 2.7, q.y * 6.50 - ph * 0.30)) * 0.07 * (0.25 + wind * 1.3);
        return h;
      }

      void main() {
        if (vDepth <= 0.01) discard;

        vec2 p = vWorldPos.xz;
        float t = uTime;
        float ph = uWavePhase;
        float viewDist = length(cameraPosition - vWorldPos);

        // Surface slope from the height field (forward differences)
        float e = 0.09;
        float h0 = waterHeight(p, ph, uWindNorm);
        float hx = waterHeight(p + vec2(e, 0.0), ph, uWindNorm);
        float hz = waterHeight(p + vec2(0.0, e), ph, uWindNorm);
        float ampScale = 0.55 + uWindNorm * 1.5 + uWaveAmp * 5.0;
        float distFade = mix(1.0, 0.28, smoothstep(30.0, 150.0, viewDist));
        float k = 0.11 * ampScale * distFade / e;
        float dx = (hx - h0) * k;
        float dz = (hz - h0) * k;

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
            dx += dir.x * wave * 0.30;
            dz += dir.y * wave * 0.30;
            rippleHighlight += max(0.0, wave) * 0.30;
          }
        }

        vec3 N = normalize(vec3(-dx, 1.0, -dz));
        vec3 V = normalize(cameraPosition - vWorldPos);
        float ndotv = clamp(dot(N, V), 0.0, 1.0);

        // Fresnel (Schlick-like): clear when looking down, mirror-like toward the horizon
        float fresnel = clamp(0.04 + 0.96 * pow(1.0 - ndotv, 4.0), 0.0, 1.0);

        vec3 R = reflect(-V, N);
        R.y = max(R.y, 0.02);
        vec3 skyRefl = mix(uSkyHorizon, uSkyTop, clamp(pow(R.y, 0.45), 0.0, 1.0));

        // Fake reflection of the dark tree line / mountains near the horizon
        float skyLum = dot(uSkyHorizon, vec3(0.299, 0.587, 0.114));
        vec3 landRefl = vec3(0.075, 0.13, 0.10) * clamp(skyLum * 1.5, 0.12, 1.0);
        float shoreBand = smoothstep(0.20, 0.0, R.y);
        skyRefl = mix(skyRefl, landRefl, shoreBand * 0.55);

        // Sun glitter: broad path built from continuous normals
        vec3 L = normalize(uSunDir);
        vec3 H = normalize(L + V);
        float ndh = max(dot(N, H), 0.0);
        float spec = pow(ndh, mix(260.0, 140.0, uWindNorm)) * 2.0 + pow(ndh, 28.0) * 0.14;

        // Soft underwater caustics (organic web, not a sine grid)
        float c1 = vnoise(p * 1.6 + vec2(ph * 0.35, -ph * 0.20));
        float c2 = vnoise(p * 2.1 - vec2(ph * 0.28, -ph * 0.31) + 7.0);
        float web = pow(1.0 - abs(c1 - c2), 7.0);
        float caustics = web * (1.0 - smoothstep(0.5, 3.4, vDepth)) * 0.20;

        float dayL = clamp(L.y * 3.0 + 0.35, 0.12, 1.0);
        float depthFactor = smoothstep(0.1, 4.4, vDepth);
        vec3 waterTint = mix(uShallowColor, uDeepColor, depthFactor) * mix(0.45, 1.0, dayL) + uSunColor * caustics;

        // Organic shoreline foam + wind whitecaps (noise-broken, never repeating)
        float n1 = vnoise(p * 1.8 + vec2(ph * 0.40, -ph * 0.25));
        float n2 = vnoise(p * 4.5 - vec2(ph * 0.70, ph * 0.20));
        float shoreFoam = smoothstep(0.30 + (n1 - 0.5) * 0.22, 0.02, vDepth) * (0.22 + uWindNorm * 0.35) * (0.6 + 0.4 * n2);
        float whitecap = smoothstep(0.55, 0.90, vWaveCrest * 1.4 + (n2 - 0.5) * 0.4) * smoothstep(0.35, 1.0, uWindNorm) * 0.5;
        float totalFoam = clamp(shoreFoam + whitecap, 0.0, 0.85);

        vec3 col = mix(waterTint, skyRefl, fresnel);
        col += uSunColor * spec;
        col += vec3(0.90, 0.97, 0.99) * (rippleHighlight + totalFoam);

        // Exponential distance fog matching scene.fog
        float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * viewDist * viewDist);
        col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));

        float alpha = mix(0.16 + depthFactor * 0.30, 0.95, fresnel);
        alpha = clamp(alpha + totalFoam * 0.48 + rippleHighlight * 0.28, 0.10, 0.96);

        gl_FragColor = vec4(col, alpha);
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
  // Soft round droplet sprite (instead of square GL points)
  const dropCanvas = document.createElement('canvas');
  dropCanvas.width = 64;
  dropCanvas.height = 64;
  {
    const dctx = dropCanvas.getContext('2d')!;
    const g = dctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(235,248,255,0.85)');
    g.addColorStop(1, 'rgba(235,248,255,0)');
    dctx.fillStyle = g;
    dctx.fillRect(0, 0, 64, 64);
  }
  const dropTex = new THREE.CanvasTexture(dropCanvas);
  dropTex.colorSpace = THREE.SRGBColorSpace;
  const splashMat = new THREE.PointsMaterial({
    color: 0xeaf8ff,
    size: 0.2,
    map: dropTex,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    alphaTest: 0.02,
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

  // 3. Underwater swaying aquatic plants anchored on lakebed (swaying stronger in higher wind/currents)
  const weedCount = 150;
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
  for (let i = 0; i < 1600 && placedWeeds < weedCount; i++) {
    const wx = Math.sin(i * 12.7) * 46;
    const wz = Math.cos(i * 7.9) * 38 - 28;
    const gy = groundHeightAt(wx, wz);
    if (gy > -0.45 || gy < -2.9) continue;

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
    update: (dt, elapsed, sunDir, skyTop, skyHorizon, sunColor, weather, windSpeedKmh, fogColor, fogDensity) => {
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
      waterMaterial.uniforms.uWavePhase.value = wavePhaseOffset;
      waterMaterial.uniforms.uWaveAmp.value = smoothWaveAmp;
      waterMaterial.uniforms.uWindNorm.value = smoothWindNorm;
      waterMaterial.uniforms.uSunDir.value.copy(sunDir);
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
      dropTex.dispose();
      weedGeo.dispose();
      weedMat.dispose();
    },
  };
}
