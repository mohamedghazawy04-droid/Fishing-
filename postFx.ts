import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export type GraphicsQuality = 'ultra' | 'high' | 'medium';

export const GRAPHICS_QUALITY_LABELS: Record<GraphicsQuality, string> = {
  ultra: 'فائقة',
  high: 'عالية',
  medium: 'متوسطة',
};

const GFX_STORAGE_KEY = 'serene_valley_gfx_v1';

export function loadSavedQuality(): GraphicsQuality {
  try {
    const raw = localStorage.getItem(GFX_STORAGE_KEY);
    if (raw === 'ultra' || raw === 'high' || raw === 'medium') return raw;
  } catch {
    // ignore
  }
  return 'ultra';
}

export function saveQuality(q: GraphicsQuality): void {
  try {
    localStorage.setItem(GFX_STORAGE_KEY, q);
  } catch {
    // ignore
  }
}

/**
 * Final cinematic grade pass (runs in linear HDR, before tone-mapping):
 * - screen-space sun shafts (radial light scattering toward the sun)
 * - subtle chromatic aberration towards the edges
 * - gentle saturation / contrast grade
 * - soft vignette + fine film grain
 */
const CinematicShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSunUv: { value: new THREE.Vector2(0.5, 0.8) },
    uSunAmt: { value: 0 },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1280, 720) },
    uVignette: { value: 0.42 },
    uGrain: { value: 0.028 },
    uAberration: { value: 0.0016 },
    uSaturation: { value: 1.1 },
    uContrast: { value: 1.06 },
    uWarmth: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uSunUv;
    uniform float uSunAmt;
    uniform float uTime;
    uniform vec2 uRes;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uWarmth;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);

      // Chromatic aberration (edges only)
      vec2 off = d * r2 * uAberration * 18.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;

      // Sun shafts: march from this pixel toward the sun, gathering bright pixels
      if (uSunAmt > 0.002) {
        vec2 toSun = uSunUv - uv;
        float dist = length(toSun);
        const int SAMPLES = 28;
        vec2 stepv = toSun / float(SAMPLES) * 0.85;
        vec2 p = uv + stepv * hash12(uv * uRes + uTime) ; // jitter hides banding
        float decay = 1.0;
        vec3 acc = vec3(0.0);
        for (int i = 0; i < SAMPLES; i++) {
          p += stepv;
          vec3 s = texture2D(tDiffuse, p).rgb;
          float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
          float m = smoothstep(0.82, 1.9, l);
          acc += s * m * decay;
          decay *= 0.935;
        }
        acc /= float(SAMPLES);
        float falloff = exp(-dist * 1.6);
        col += acc * uSunAmt * falloff * 0.95;
      }

      // Grade: saturation + contrast around mid-grey, slight warm/cool split
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);
      col = (col - 0.18) * uContrast + 0.18;
      col *= vec3(1.0 + uWarmth, 1.0, 1.0 - uWarmth);
      col = max(col, vec3(0.0));

      // Vignette
      float vig = smoothstep(0.95, 0.18, length(d) * 1.32);
      col *= mix(1.0 - uVignette, 1.0, vig);

      // Film grain (luma-weighted so shadows are not crushed)
      float g = hash12(uv * uRes + fract(uTime) * 61.0) - 0.5;
      col += g * uGrain * (0.35 + 0.65 * smoothstep(0.0, 0.6, luma));

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export interface PostFx {
  render: (dt: number) => void;
  setSize: (width: number, height: number) => void;
  setQuality: (q: GraphicsQuality) => void;
  /** Sun direction (world, normalized) + how visible the sun is (0..1, weather/night weighted). */
  setSun: (camera: THREE.PerspectiveCamera, sunDir: THREE.Vector3, visibility: number) => void;
  setBloomStrength: (strength: number) => void;
  setWarmth: (warmth: number) => void;
  getPixelRatio: () => number;
  dispose: () => void;
}

const QUALITY_PIXEL_RATIO_CAP: Record<GraphicsQuality, number> = {
  ultra: 2,
  high: 1.5,
  medium: 1.15,
};

export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  initialWidth: number,
  initialHeight: number,
  initialQuality: GraphicsQuality,
): PostFx {
  let quality: GraphicsQuality = initialQuality;
  let width = initialWidth;
  let height = initialHeight;
  let adaptiveScale = 1; // 0.7..1, lowered automatically if FPS is poor

  const deviceRatio = () => Math.min(window.devicePixelRatio || 1, QUALITY_PIXEL_RATIO_CAP[quality]);
  const effectiveRatio = () => Math.max(0.7, deviceRatio() * adaptiveScale);

  // Multisampled HDR target (WebGL2) = real MSAA even with post-processing
  const target = new THREE.WebGLRenderTarget(
    Math.max(2, Math.floor(width * effectiveRatio())),
    Math.max(2, Math.floor(height * effectiveRatio())),
    {
      type: THREE.HalfFloatType,
      samples: 4,
    },
  );

  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.3, 0.6, 0.9);
  const cinematicPass = new ShaderPass(CinematicShader);
  const outputPass = new OutputPass();

  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(cinematicPass);
  composer.addPass(outputPass);

  const uniforms = cinematicPass.uniforms as typeof CinematicShader.uniforms;
  let shaftsEnabled = true;
  let sunVisibility = 0;
  let baseBloom = 0.3;
  let elapsed = 0;

  // Adaptive resolution (only ever steps down, then recovers slowly)
  let frameCount = 0;
  let accumDt = 0;
  let goodWindows = 0;

  const applySize = () => {
    const pr = effectiveRatio();
    renderer.setPixelRatio(pr);
    renderer.setSize(width, height);
    composer.setPixelRatio(pr);
    composer.setSize(width, height);
    uniforms.uRes.value.set(width * pr, height * pr);
  };

  const applyQuality = () => {
    shaftsEnabled = quality === 'ultra';
    bloomPass.enabled = true;
    bloomPass.radius = quality === 'ultra' ? 0.65 : 0.5;
    uniforms.uAberration.value = quality === 'ultra' ? 0.0016 : 0.0009;
    uniforms.uGrain.value = quality === 'ultra' ? 0.028 : 0.018;
    applySize();
  };

  applyQuality();

  const adapt = (dt: number) => {
    frameCount++;
    accumDt += dt;
    if (frameCount < 90) return;
    const avg = accumDt / frameCount;
    frameCount = 0;
    accumDt = 0;
    if (avg > 1 / 36 && adaptiveScale > 0.71) {
      adaptiveScale = Math.max(0.7, adaptiveScale - 0.12);
      goodWindows = 0;
      applySize();
    } else if (avg < 1 / 56 && adaptiveScale < 1) {
      goodWindows++;
      if (goodWindows >= 4) {
        adaptiveScale = Math.min(1, adaptiveScale + 0.08);
        goodWindows = 0;
        applySize();
      }
    } else {
      goodWindows = 0;
    }
  };

  const _ndc = new THREE.Vector3();
  const _fwd = new THREE.Vector3();

  return {
    render: (dt) => {
      elapsed += dt;
      uniforms.uTime.value = elapsed;
      uniforms.uSunAmt.value = shaftsEnabled ? sunVisibility : 0;
      adapt(dt);
      composer.render(dt);
    },
    setSize: (w, h) => {
      width = w;
      height = h;
      applySize();
    },
    setQuality: (q) => {
      quality = q;
      adaptiveScale = 1;
      applyQuality();
    },
    setSun: (cam, sunDir, visibility) => {
      cam.getWorldDirection(_fwd);
      const facing = _fwd.dot(sunDir);
      // Sun position on screen (project a far point along the sun direction)
      _ndc.copy(cam.position).addScaledVector(sunDir, 400).project(cam);
      uniforms.uSunUv.value.set(_ndc.x * 0.5 + 0.5, _ndc.y * 0.5 + 0.5);
      const inFront = THREE.MathUtils.smoothstep(facing, 0.05, 0.55);
      sunVisibility = THREE.MathUtils.clamp(visibility, 0, 1) * inFront;
    },
    setBloomStrength: (strength) => {
      baseBloom = strength;
      bloomPass.strength = baseBloom;
    },
    setWarmth: (warmth) => {
      uniforms.uWarmth.value = warmth;
    },
    getPixelRatio: () => effectiveRatio(),
    dispose: () => {
      composer.dispose();
      target.dispose();
      bloomPass.dispose();
      outputPass.dispose();
    },
  };
}
