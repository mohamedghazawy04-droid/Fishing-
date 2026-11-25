import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { NatureSoundEngine } from '../audio/soundEngine';
import {
  BAIT_CATALOG,
  HOOK_CATALOG,
  SEASON_CATALOG,
  SKILL_CATALOG,
  WEATHER_OPTIONS,
  classifyLakeZone,
  computeLevelFromXp,
  formatHourToClock,
  getPresetFromHour,
  getSkillUpgradeCost,
  type AmbienceMix,
  type BaitId,
  type CaughtFishRecord,
  type FishingHudState,
  type FishingPhase,
  type HookId,
  type PlayerProgression,
  type SeasonId,
  type SkillKey,
  type TimePresetId,
  type WeatherType,
} from '../types/fishing';
import { createDockAndRig } from './dockAndRig';
import { createEnvironment, groundHeightAt } from './environment';
import { createFishSystem, type ActiveFish } from './fishSystem';
import { applyCatchToQuests, buildQuestViews, loadQuestSave, saveQuestSave, type QuestSave } from '../game/quests';
import { createBaskets } from './baskets';
import { createWildlife } from './wildlife';
import { createPostFx, loadSavedQuality, saveQuality, type GraphicsQuality, type PostFx } from './postFx';
import { createProceduralTextures } from './textures';
import { createCrystalWater } from './water';

const STORAGE_KEY = 'serene_valley_angler_save_v1';

function createInitialProgression(): PlayerProgression {
  return {
    level: 1,
    totalXp: 0,
    availableXp: 0,
    skills: {
      castMastery: 1,
      reelSpeed: 1,
      lineStrength: 1,
      anglerSense: 1,
    },
    unlockedBaits: ['worm', 'fly'],
    unlockedHooks: ['light_bronze', 'barbed_steel'],
  };
}

function loadSavedProgression(): PlayerProgression {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialProgression();
    const parsed = JSON.parse(raw) as Partial<PlayerProgression>;
    const base = createInitialProgression();
    const totalXp = typeof parsed.totalXp === 'number' ? Math.max(0, parsed.totalXp) : 0;
    const level = computeLevelFromXp(totalXp);
    const unlockedBaits = BAIT_CATALOG.filter((b) => b.unlockLevel <= level).map((b) => b.id);
    const unlockedHooks = HOOK_CATALOG.filter((h) => h.unlockLevel <= level).map((h) => h.id);
    return {
      level,
      totalXp,
      availableXp: typeof parsed.availableXp === 'number' ? Math.max(0, parsed.availableXp) : 0,
      skills: {
        castMastery: THREE.MathUtils.clamp(parsed.skills?.castMastery ?? 1, 1, 5),
        reelSpeed: THREE.MathUtils.clamp(parsed.skills?.reelSpeed ?? 1, 1, 5),
        lineStrength: THREE.MathUtils.clamp(parsed.skills?.lineStrength ?? 1, 1, 5),
        anglerSense: THREE.MathUtils.clamp(parsed.skills?.anglerSense ?? 1, 1, 5),
      },
      unlockedBaits,
      unlockedHooks,
    };
  } catch {
    return createInitialProgression();
  }
}

function saveProgression(prog: PlayerProgression): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prog));
  } catch {
    // Ignore storage quota errors
  }
}

export class FishingSceneManager {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl: boolean;
  private pmremEnv: THREE.WebGLRenderTarget;

  private textures: ReturnType<typeof createProceduralTextures>;
  private environment: ReturnType<typeof createEnvironment>;
  private water: ReturnType<typeof createCrystalWater>;
  private wildlife: ReturnType<typeof createWildlife>;
  private baskets: ReturnType<typeof createBaskets>;
  private fishSystem: ReturnType<typeof createFishSystem>;
  private dockRig: ReturnType<typeof createDockAndRig>;
  private sound = new NatureSoundEngine();

  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private catchShowcaseLight: THREE.PointLight;
  private fog: THREE.FogExp2;

  // Weather particle systems (Rain / Snow & Fireflies)
  private rainPoints: THREE.Points;
  private rainGeo: THREE.BufferGeometry;
  private rainMat: THREE.PointsMaterial;
  private rainPositions: Float32Array;
  private fireflyPoints: THREE.Points;
  private fireflyGeo: THREE.BufferGeometry;
  private fireflyMat: THREE.PointsMaterial;
  private fireflyBase: Float32Array;

  // Seated Camera Look Controls + Screen Press-and-Hold Disambiguation
  private targetYaw = 0; // 0 looks straight across lake (-Z)
  private targetPitch = -0.20;
  private currentYaw = 0;
  private currentPitch = -0.20;
  private isDragging = false;
  private pointerDown = false;
  private pointerDownX = 0;
  private pointerDownY = 0;
  private pointerMoved = false;
  private holdTriggered = false;
  private holdTimer: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private keyState: Record<string, boolean> = {};

  // Cinematic Mode (idle panoramic aerial flight around the mountain lake)
  private cinematicAutoEnabled = true;
  private cinematicManualActive = false;
  private cinematicWasActive = false;
  private cinematicBlend = 0;
  private cinematicTime = 0;
  private lastActivityTime = 0;

  // Simulation Clock & Pacing
  private clock = new THREE.Clock();
  private elapsed = 0;
  private frameId = 0;
  private disposed = false;

  // Dynamic Environment State
  private timeOfDay = 8.8; // Crisp sunlit morning
  private autoTimeCycle = true;
  private season: SeasonId = 'spring';
  private weather: WeatherType = 'clear';
  private autoWeather = true;
  private autoWind = true;
  private manualWindKmh = 10;
  private currentWindSpeedKmh = 7;
  private soundMuted = false;
  private weatherChangeTimer = 42;
  private lightningAlpha = 0;
  private nextLightningTimer = 7;
  private rainDropTimer = 0;

  // Fishing State
  private phase: FishingPhase = 'idle';
  private castPower = 0;
  private castPowerDir = 1;
  private chargeHeld = false;
  private reelHeld = false;
  private lineTension = 0;
  private rodBend = 0;
  private bobberPos = new THREE.Vector3(0, 0, -9);
  private bobberVel = new THREE.Vector3();
  private castStartPos = new THREE.Vector3();
  private castTargetPos = new THREE.Vector3();
  private castFlightT = 0;
  private lurePos = new THREE.Vector3(0, -1.2, -9);
  private lineDepthMeters = 1.4;
  private selectedBait: BaitId = 'worm';
  private selectedHook: HookId = 'barbed_steel';
  private hookedFish: ActiveFish | null = null;
  private catchInspectAngle = Math.PI * 0.45;
  private catchInspectTilt = 0.06;
  private activeCatch: CaughtFishRecord | null = null;
  private catchHistory: CaughtFishRecord[] = [];
  private statusMessage = 'اضغط مطولاً على الشاشة للرمي أو السحب · اسحب للتلفت حول البحيرة والكرسي';
  private lineSnappedNotice: string | null = null;
  private lineSnapTimer = 0;
  private newlyUnlockedNotice: string | null = null;
  private unlockNoticeTimer = 0;
  private progression: PlayerProgression;
  private hookNearDock = false;
  private postFx: PostFx | null = null;
  private graphicsQuality: GraphicsQuality = loadSavedQuality();
  private questSave: QuestSave = loadQuestSave();
  private questNotice: string | null = null;
  private questNoticeTimer = 0;

  private onHudUpdate: (state: FishingHudState) => void;
  private lastHudEmit = 0;

  // Pre-allocated scratch math objects (zero GC in loop)
  private _sunDir = new THREE.Vector3();
  private _skyTop = new THREE.Color();
  private _skyHorizon = new THREE.Color();
  private _sunColor = new THREE.Color();
  private _fogColor = new THREE.Color();
  private _hemiSky = new THREE.Color();
  private _hemiGround = new THREE.Color();
  private _rodTip = new THREE.Vector3();
  private _toDock = new THREE.Vector3();
  private _rightVec = new THREE.Vector3();
  private _camLookDir = new THREE.Vector3();
  private _seatedPos = new THREE.Vector3();
  private _seatedTarget = new THREE.Vector3();
  private _cinePos = new THREE.Vector3();
  private _cineTarget = new THREE.Vector3();
  private _seatedQuat = new THREE.Quaternion();
  private _cineQuat = new THREE.Quaternion();
  private _lookMatrix = new THREE.Matrix4();
  private _camUp = new THREE.Vector3(0, 1, 0);

  constructor(container: HTMLElement, onHudUpdate: (state: FishingHudState) => void) {
    this.container = container;
    this.onHudUpdate = onHudUpdate;
    this.progression = loadSavedProgression();

    // Probe software WebGL (SwiftShader / llvmpipe / WARP)
    this.isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.fog = new THREE.FogExp2(0xb8dcf0, 0.0014);
    this.scene.fog = this.fog;

    // Seated fisherman eye-height camera on chair (chair at z=2.30, pierTopY=0.72)
    this.camera = new THREE.PerspectiveCamera(68, width / height, 0.08, 650);
    this.camera.position.set(0, 1.76, 2.32);

    // Studio RoomEnvironment reflection map
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmremEnv = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.pmremEnv.texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    // Balanced outdoor sun + hemisphere fill
    this.hemiLight = new THREE.HemisphereLight(0x9fd3f5, 0x455838, 0.72);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff1d4, 2.1);
    this.sunLight.position.set(28, 36, -24);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 140;
    const d = 38;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.025;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    this.sunLight.target.position.set(0, 0, -12);

    this.catchShowcaseLight = new THREE.PointLight(0xfff5e2, 0, 7, 1.4);
    this.catchShowcaseLight.position.set(0.3, 2.2, 1.8);
    this.scene.add(this.catchShowcaseLight);

    // Build modular world
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.textures = createProceduralTextures(maxAniso);
    this.environment = createEnvironment(this.textures, this.isSoftwareGl);
    this.water = createCrystalWater(this.isSoftwareGl);
    this.fishSystem = createFishSystem();
    this.dockRig = createDockAndRig(this.textures);
    this.dockRig.setActiveBaitVisual(this.selectedBait);

    this.scene.add(this.environment.group);
    this.scene.add(this.dockRig.group);

    // Wicker baskets on the pier where kept fish are placed (common left, rare & legendary right)
    this.baskets = createBaskets(0.72);
    this.scene.add(this.baskets.group);
    this.scene.add(this.fishSystem.group);
    this.scene.add(this.water.group);

    // Wildlife: deer, goats, bear, herons, ducks and pond turtles
    this.wildlife = createWildlife({
      groundHeightAt,
      waterHeightAt: (x, z) => this.water.getSurfaceHeightAt(x, z),
      treeSpots: this.environment.treeSpots,
      isSoftwareGl: this.isSoftwareGl,
    });
    this.scene.add(this.wildlife.group);

    // Rain / Snow Particles
    const rainCount = 950;
    this.rainGeo = new THREE.BufferGeometry();
    this.rainPositions = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount; i++) {
      this.rainPositions[i * 3] = (Math.random() - 0.5) * 60;
      this.rainPositions[i * 3 + 1] = Math.random() * 24;
      this.rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 60 - 16;
    }
    this.rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
    this.rainMat = new THREE.PointsMaterial({
      color: 0xd9ecff,
      size: 0.14,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.rainPoints = new THREE.Points(this.rainGeo, this.rainMat);
    this.rainPoints.visible = false;
    this.scene.add(this.rainPoints);

    // Fireflies for dusk/night
    const ffCount = 64;
    this.fireflyGeo = new THREE.BufferGeometry();
    this.fireflyBase = new Float32Array(ffCount * 3);
    const ffPos = new Float32Array(ffCount * 3);
    for (let i = 0; i < ffCount; i++) {
      const fx = (Math.random() - 0.5) * 58;
      const fz = -4 - Math.random() * 42;
      const fy = Math.max(0.4, groundHeightAt(fx, fz)) + 0.5 + Math.random() * 1.8;
      this.fireflyBase[i * 3] = fx;
      this.fireflyBase[i * 3 + 1] = fy;
      this.fireflyBase[i * 3 + 2] = fz;
      ffPos[i * 3] = fx;
      ffPos[i * 3 + 1] = fy;
      ffPos[i * 3 + 2] = fz;
    }
    this.fireflyGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
    this.fireflyMat = new THREE.PointsMaterial({
      color: 0xffe47a,
      size: 0.16,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.fireflyPoints = new THREE.Points(this.fireflyGeo, this.fireflyMat);
    this.scene.add(this.fireflyPoints);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    if (this.isSoftwareGl) this.graphicsQuality = 'medium';
    this.applyGraphicsQuality(this.graphicsQuality, false);

    this.bindEvents();
    this.emitHudState(true);
    this.tick();
  }

  private bindEvents(): void {
    const dom = this.renderer.domElement;

    dom.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('resize', this.onResize);
    dom.addEventListener('webglcontextlost', this.onContextLost);
  }

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    cancelAnimationFrame(this.frameId);
    window.clearTimeout(this.frameId);
  };

  private clearHoldTimer(): void {
    if (this.holdTimer !== null) {
      window.clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  private markUserActivity(cancelManual = true): void {
    this.lastActivityTime = this.elapsed;
    if (cancelManual && this.cinematicManualActive) {
      this.cinematicManualActive = false;
      this.emitHudState(true);
    }
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.sound.unlock();
    this.markUserActivity(true);
    if (e.button !== 0) return;

    this.pointerDown = true;
    this.isDragging = false;
    this.pointerMoved = false;
    this.holdTriggered = false;
    this.pointerDownX = e.clientX;
    this.pointerDownY = e.clientY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    this.clearHoldTimer();
    this.holdTimer = window.setTimeout(() => {
      if (this.pointerDown && !this.pointerMoved && !this.disposed) {
        this.holdTriggered = true;
        this.isDragging = false;
        this.handlePrimaryActionPress();
      }
    }, 175);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointerDown || this.holdTriggered) return;

    if (!this.pointerMoved) {
      const dist = Math.hypot(e.clientX - this.pointerDownX, e.clientY - this.pointerDownY);
      if (dist > 7) {
        this.pointerMoved = true;
        this.isDragging = true;
        this.clearHoldTimer();
      } else {
        return;
      }
    }

    if (!this.isDragging) return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    if (this.phase === 'caught') {
      this.catchInspectAngle += dx * 0.012;
      this.catchInspectTilt = THREE.MathUtils.clamp(this.catchInspectTilt + dy * 0.006, -0.45, 0.45);
    } else {
      this.targetYaw = THREE.MathUtils.clamp(this.targetYaw - dx * 0.0045, -2.55, 2.55);
      this.targetPitch = THREE.MathUtils.clamp(this.targetPitch - dy * 0.0040, -1.25, 0.85);
    }
    this.markUserActivity(true);
  };

  private onPointerUp = (): void => {
    this.clearHoldTimer();
    if (this.holdTriggered) {
      this.handlePrimaryActionRelease();
    } else if (this.pointerDown && !this.pointerMoved && this.phase === 'biting') {
      this.attemptHookSet();
    }
    this.pointerDown = false;
    this.isDragging = false;
    this.holdTriggered = false;
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    this.keyState[e.code] = true;
    if (
      e.code === 'ArrowLeft' ||
      e.code === 'ArrowRight' ||
      e.code === 'ArrowUp' ||
      e.code === 'ArrowDown' ||
      e.code === 'KeyA' ||
      e.code === 'KeyD' ||
      e.code === 'KeyW' ||
      e.code === 'KeyS'
    ) {
      this.markUserActivity(true);
    }
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      this.sound.unlock();
      this.markUserActivity(true);
      this.handlePrimaryActionPress();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    this.keyState[e.code] = false;
    if (e.code === 'Space') {
      e.preventDefault();
      this.handlePrimaryActionRelease();
    }
  };

  private onResize = (): void => {
    if (this.disposed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.postFx) {
      this.postFx.setSize(w, h);
    } else {
      this.renderer.setSize(w, h);
      this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 1.25));
    }
  };

  /** Switches between ultra / high (post-processing) and medium (direct render). */
  public setGraphicsQuality(q: GraphicsQuality): void {
    if (this.isSoftwareGl) return;
    this.applyGraphicsQuality(q, true);
  }

  private applyGraphicsQuality(q: GraphicsQuality, persist: boolean): void {
    this.graphicsQuality = q;
    if (persist) saveQuality(q);

    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    // Shadow resolution follows quality (4096 on capable GPUs in ultra)
    const maxTex = this.renderer.capabilities.maxTextureSize;
    const shadowRes = !this.isSoftwareGl && q === 'ultra' && maxTex >= 8192 ? 4096 : 2048;
    if (this.sunLight.shadow.mapSize.x !== shadowRes) {
      this.sunLight.shadow.mapSize.set(shadowRes, shadowRes);
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose();
        this.sunLight.shadow.map = null;
      }
    }

    if (this.isSoftwareGl || q === 'medium') {
      if (this.postFx) {
        this.postFx.dispose();
        this.postFx = null;
      }
      this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 1.25));
      this.renderer.setSize(w, h);
    } else if (this.postFx) {
      this.postFx.setQuality(q);
    } else {
      this.postFx = createPostFx(this.renderer, this.scene, this.camera, w, h, q);
    }
    this.emitHudState(true);
  }

  // --- Public Controls called by React HUD ---
  public handlePrimaryActionPress(): void {
    this.sound.unlock();
    this.markUserActivity(true);
    if (this.phase === 'idle') {
      this.phase = 'charging';
      this.castPower = 0.08;
      this.castPowerDir = 1;
      this.chargeHeld = true;
      this.lineSnappedNotice = null;
      this.statusMessage = 'توجيه القصبة... حرّر للرمي في البحيرة';
      this.emitHudState(true);
    } else if (this.phase === 'biting') {
      this.attemptHookSet();
    } else if (this.phase === 'waiting' || this.phase === 'nibbling') {
      // Retrieve line back to idle
      this.resetToIdle('تم سحب الخيط بنجاح — اختر نقطة جديدة وارمِ الصنارة');
    } else if (this.phase === 'reeling') {
      this.reelHeld = true;
      this.emitHudState(true);
    }
  }

  public handlePrimaryActionRelease(): void {
    if (this.phase === 'charging' && this.chargeHeld) {
      this.chargeHeld = false;
      this.launchCast();
    } else if (this.phase === 'reeling') {
      this.reelHeld = false;
      this.emitHudState(true);
    }
  }

  public setBait(baitId: BaitId): void {
    if (!this.progression.unlockedBaits.includes(baitId)) return;
    this.selectedBait = baitId;
    this.dockRig.setActiveBaitVisual(baitId);
    const b = BAIT_CATALOG.find((x) => x.id === baitId);
    if (b) {
      this.lineDepthMeters = b.targetDepthOffset;
      this.statusMessage = `تم تجهيز الطعم: ${b.nameAr}`;
    }
    this.emitHudState(true);
  }

  public setHook(hookId: HookId): void {
    if (!this.progression.unlockedHooks.includes(hookId)) return;
    this.selectedHook = hookId;
    const h = HOOK_CATALOG.find((x) => x.id === hookId);
    if (h) this.statusMessage = `تم تركيب: ${h.nameAr}`;
    this.emitHudState(true);
  }

  public setLineDepth(depthMeters: number): void {
    this.lineDepthMeters = THREE.MathUtils.clamp(depthMeters, 0.5, 3.2);
    this.emitHudState(true);
  }

  public setTimePreset(presetId: TimePresetId, hour: number): void {
    this.timeOfDay = hour;
    this.autoTimeCycle = false;
    this.emitHudState(true);
    void presetId;
  }

  public setTimeHour(hour: number): void {
    this.timeOfDay = ((hour % 24) + 24) % 24;
    this.emitHudState(true);
  }

  public setAutoTimeCycle(enabled: boolean): void {
    this.autoTimeCycle = enabled;
    this.emitHudState(true);
  }

  public setWeather(weather: WeatherType): void {
    this.weather = weather;
    this.autoWeather = false;
    this.emitHudState(true);
  }

  public setAutoWeather(enabled: boolean): void {
    this.autoWeather = enabled;
    this.emitHudState(true);
  }

  public setWindSpeed(kmh: number): void {
    this.manualWindKmh = THREE.MathUtils.clamp(Math.round(kmh), 0, 45);
    this.autoWind = false;
    this.currentWindSpeedKmh = this.manualWindKmh;
    this.emitHudState(true);
  }

  public setAutoWind(enabled: boolean): void {
    this.autoWind = enabled;
    this.emitHudState(true);
  }

  public setSeason(season: SeasonId): void {
    this.season = season;
    this.emitHudState(true);
  }

  public setSoundMuted(muted: boolean): void {
    this.soundMuted = muted;
    this.sound.setMuted(muted);
    this.emitHudState(true);
  }

  public setAmbienceMix(mix: Partial<AmbienceMix>): void {
    this.sound.unlock();
    this.sound.setAmbienceMix(mix);
    this.emitHudState(true);
  }

  public toggleCinematicMode(): void {
    const currentlyActive = this.cinematicManualActive || this.cinematicWasActive;
    if (currentlyActive) {
      this.cinematicManualActive = false;
      this.cinematicWasActive = false;
      this.lastActivityTime = this.elapsed;
    } else {
      this.cinematicManualActive = true;
      this.cinematicTime = 0;
    }
    this.emitHudState(true);
  }

  public setCinematicAutoEnabled(enabled: boolean): void {
    this.cinematicAutoEnabled = enabled;
    if (!enabled) {
      this.lastActivityTime = this.elapsed;
    }
    this.emitHudState(true);
  }

  public lookReset(): void {
    this.markUserActivity(true);
    this.targetYaw = 0;
    this.targetPitch = -0.20;
  }

  public upgradeSkill(key: SkillKey): void {
    const def = SKILL_CATALOG.find((s) => s.key === key);
    if (!def) return;
    const current = this.progression.skills[key];
    if (current >= def.maxLevel) return;
    const cost = getSkillUpgradeCost(def, current);
    if (this.progression.availableXp < cost) return;

    this.progression = {
      ...this.progression,
      availableXp: this.progression.availableXp - cost,
      skills: {
        ...this.progression.skills,
        [key]: current + 1,
      },
    };
    saveProgression(this.progression);
    this.sound.playCatchChime();
    this.statusMessage = `تمت ترقية مهارة ${def.nameAr} إلى المستوى ${current + 1}`;
    this.emitHudState(true);
  }

  public resolveActiveCatch(releaseFish: boolean): void {
    if (!this.activeCatch) return;
    const record: CaughtFishRecord = {
      ...this.activeCatch,
      released: releaseFish,
    };
    let bonusXp = 0;
    if (releaseFish) {
      bonusXp = Math.round(record.xpEarned * 0.2);
      record.xpEarned += bonusXp;
      this.applyXpGain(bonusXp);
      this.water.spawnSplash(0, -3.5, 1.0);
      this.sound.playSplash(0.6);
      this.statusMessage = `أُطلقت السمكة في المياه الصافية (+${bonusXp} خبرة إضافية للحفاظ على البيئة)`;
    } else {
      this.statusMessage = `تم حفظ ${record.species.nameAr} في سجل الصيد`;
    }

    this.catchHistory = [record, ...this.catchHistory];
    this.activeCatch = null;
    this.applyQuestProgress(record);
    if (this.hookedFish && !releaseFish) {
      this.baskets.addFish(
        this.hookedFish.mesh,
        this.hookedFish.bodyMat,
        this.hookedFish.lengthScale,
        record.species.rarity,
        this.hookedFish.mesh.position.clone(),
      );
      this.sound.playSplash(0.3);
      this.statusMessage = `وُضعت ${record.species.nameAr} في السلة`;
    }
    this.hookNearDock = false;
    if (this.hookedFish) {
      this.hookedFish.mesh.scale.setScalar(this.hookedFish.lengthScale);
      this.hookedFish.mesh.rotation.set(0, this.hookedFish.heading, 0);
      this.hookedFish = null;
    }
    this.fishSystem.releaseHookedFish();
    this.phase = 'idle';
    this.emitHudState(true);
  }

  // --- Internal Fishing Mechanics ---
  private launchCast(): void {
    this.sound.playCast();
    this.phase = 'casting';
    this.castFlightT = 0;

    this.dockRig.getRodTipWorldPos(this.castStartPos);

    // Cast along seated view yaw toward expanded lake (-Z)
    const castYaw = THREE.MathUtils.clamp(this.currentYaw, -1.25, 1.25);
    const castBonus = 1 + (this.progression.skills.castMastery - 1) * 0.14;
    const baseDist = (8.5 + this.castPower * 34.0) * castBonus;
    const windDriftX =
      (0.18 + (this.currentWindSpeedKmh / 18) * 1.15) *
      (1 - (this.progression.skills.castMastery - 1) * 0.18) *
      (Math.random() - 0.5);

    let tx = -Math.sin(castYaw) * baseDist + windDriftX;
    let tz = 1.0 - Math.cos(castYaw) * baseDist;

    // Clamp target into valid expanded lake water
    tx = THREE.MathUtils.clamp(tx, -44, 44);
    tz = THREE.MathUtils.clamp(tz, -56, -2.5);
    let bedY = groundHeightAt(tx, tz);
    for (let i = 0; i < 8 && bedY > -0.45; i++) {
      tx *= 0.85;
      tz = THREE.MathUtils.lerp(tz, -24, 0.25);
      bedY = groundHeightAt(tx, tz);
    }

    this.castTargetPos.set(tx, 0.0, tz);
    this.bobberPos.copy(this.castStartPos);
    this.statusMessage = 'الصنارة في الهواء...';
    this.emitHudState(true);
  }

  private attemptHookSet(): void {
    const hooked = this.fishSystem.hookBitingFish();
    if (!hooked) {
      this.resetToIdle('أفلت الطعم! حاول الاستجابة فور غوص العوامة');
      return;
    }
    this.hookedFish = hooked;
    this.phase = 'reeling';
    this.lineTension = 0.28;
    this.reelHeld = false;
    this.sound.playSplash(1.1);
    this.water.spawnSplash(hooked.position.x, hooked.position.z, 1.15);
    this.statusMessage = `علقت ${hooked.species.nameAr}! اسحب بحذر وراقب شدّ الخيط`;
    this.emitHudState(true);
  }

  private resetToIdle(message: string): void {
    this.hookNearDock = false;
    this.phase = 'idle';
    this.castPower = 0;
    this.lineTension = 0;
    this.rodBend = 0;
    this.reelHeld = false;
    this.chargeHeld = false;
    if (this.hookedFish) {
      this.hookedFish.mesh.scale.setScalar(this.hookedFish.lengthScale);
      this.hookedFish.mesh.rotation.set(0, this.hookedFish.heading, 0);
    }
    this.hookedFish = null;
    this.fishSystem.releaseHookedFish();
    this.statusMessage = message;
    this.emitHudState(true);
  }

  private applyQuestProgress(record: CaughtFishRecord): void {
    const result = applyCatchToQuests(this.questSave, record);
    this.questSave = result.save;
    saveQuestSave(this.questSave);
    if (result.newlyCompleted.length > 0) {
      this.applyXpGain(result.totalRewardXp);
      const names = result.newlyCompleted.map((q) => q.titleAr).join('، ');
      this.questNotice = `أنجزت: ${names} (+${result.totalRewardXp} خبرة)`;
      this.questNoticeTimer = 6.5;
      this.sound.playCatchChime();
    }
  }

  private applyXpGain(xp: number): void {
    const oldLevel = this.progression.level;
    const newTotal = this.progression.totalXp + xp;
    const newLevel = computeLevelFromXp(newTotal);
    const unlockedBaits = BAIT_CATALOG.filter((b) => b.unlockLevel <= newLevel).map((b) => b.id);
    const unlockedHooks = HOOK_CATALOG.filter((h) => h.unlockLevel <= newLevel).map((h) => h.id);

    const newGearNames: string[] = [];
    if (newLevel > oldLevel) {
      for (const b of BAIT_CATALOG) {
        if (b.unlockLevel > oldLevel && b.unlockLevel <= newLevel) newGearNames.push(b.nameAr);
      }
      for (const h of HOOK_CATALOG) {
        if (h.unlockLevel > oldLevel && h.unlockLevel <= newLevel) newGearNames.push(h.nameAr);
      }
      this.newlyUnlockedNotice =
        newGearNames.length > 0
          ? `ترقية إلى المستوى ${newLevel}! فُتحت معدات جديدة: ${newGearNames.join('، ')}`
          : `ترقية إلى المستوى ${newLevel}!`;
      this.unlockNoticeTimer = 6.5;
    }

    this.progression = {
      ...this.progression,
      level: newLevel,
      totalXp: newTotal,
      availableXp: this.progression.availableXp + xp,
      unlockedBaits,
      unlockedHooks,
    };
    saveProgression(this.progression);
  }

  private completeCatch(fish: ActiveFish): void {
    this.sound.playCatchChime();
    this.sound.playSplash(0.9);
    this.phase = 'caught';
    this.reelHeld = false;
    this.lineTension = 0;
    this.rodBend = 0.25;

    const sp = fish.species;
    const ratio = THREE.MathUtils.clamp((fish.lengthScale - 0.65) / 0.85, 0.15, 1.0);
    const lengthCm = Math.round(THREE.MathUtils.lerp(sp.minLengthCm, sp.maxLengthCm, ratio));
    const weightKg = Number((sp.baseWeightKg * (0.65 + ratio * 0.85)).toFixed(2));
    const rarityBase = sp.rarity === 'أسطوري' ? 190 : sp.rarity === 'نادر' ? 95 : 42;
    const xpEarned = Math.round(rarityBase + weightKg * 14);

    this.applyXpGain(xpEarned);

    const bedDepth = Math.max(0.3, -groundHeightAt(this.castTargetPos.x, this.castTargetPos.z));
    const zone = classifyLakeZone(this.castTargetPos.x, this.castTargetPos.z, bedDepth);

    this.activeCatch = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      species: sp,
      lengthCm,
      weightKg,
      xpEarned,
      caughtAtTime: formatHourToClock(this.timeOfDay),
      weather: this.weather,
      season: this.season,
      zone,
      baitUsed: this.selectedBait,
      hookUsed: this.selectedHook,
      released: false,
    };

    // Reveal caught fish by lifting it gracefully into close-up 3D showcase in front of the angler
    fish.mesh.visible = true;
    this.targetYaw = 0;
    this.targetPitch = -0.09;
    this.cinematicManualActive = false;
    this.lastActivityTime = this.elapsed;
    this.catchInspectAngle = Math.PI * 0.45;
    this.catchInspectTilt = 0.06;

    this.statusMessage = `مفاجأة الصيد! ${sp.nameAr} (+${xpEarned} نقطة خبرة)`;
    this.emitHudState(true);
  }

  private updateAtmosphere(dt: number): {
    nightFactor: number;
    windSpeedKmh: number;
    conditionLabel: string;
  } {
    if (this.autoTimeCycle) {
      // Full 24h cycle every ~4 minutes (gentle, noticeable sunset/dawn transitions)
      this.timeOfDay = (this.timeOfDay + dt * 0.1) % 24;
    }

    const seasonDef = SEASON_CATALOG.find((s) => s.id === this.season)!;

    if (this.autoWeather) {
      this.weatherChangeTimer -= dt;
      if (this.weatherChangeTimer <= 0) {
        this.weatherChangeTimer = 34 + Math.random() * 28;
        const weights = seasonDef.preferredWeatherWeights;
        const totalW = Object.values(weights).reduce((a, b) => a + b, 0);
        let r = Math.random() * totalW;
        for (const opt of WEATHER_OPTIONS) {
          r -= weights[opt.id];
          if (r <= 0) {
            this.weather = opt.id;
            break;
          }
        }
      }
    }

    // Sun Elevation based on timeOfDay (6:00 sunrise -> 12:30 zenith -> 18:30 sunset)
    const sunAngle = ((this.timeOfDay - 6) / 24) * Math.PI * 2;
    const sunElev = Math.sin(sunAngle);
    const sunHoriz = Math.cos(sunAngle);
    this._sunDir.set(sunHoriz * 0.68, Math.max(-0.45, sunElev), -0.68).normalize();

    const daylight = THREE.MathUtils.smoothstep(sunElev, -0.14, 0.35);
    const golden = Math.exp(-Math.pow((sunElev - 0.06) * 4.5, 2));
    const nightFactor = 1 - daylight;

    // Base Sky & Horizon Colors across Time of Day
    const noonTop = new THREE.Color(0x2869b2);
    const noonHorizon = new THREE.Color(0xbce0f4);
    const sunsetTop = new THREE.Color(0x3a3f75);
    const sunsetHorizon = new THREE.Color(0xf49d64);
    const nightTop = new THREE.Color(0x091326);
    const nightHorizon = new THREE.Color(0x1b2d45);

    this._skyTop.copy(nightTop).lerp(noonTop, daylight).lerp(sunsetTop, golden * 0.72);
    this._skyHorizon.copy(nightHorizon).lerp(noonHorizon, daylight).lerp(sunsetHorizon, golden * 0.85);
    this._sunColor.setHex(0xfff4db).lerp(new THREE.Color(0xff9a52), golden * 0.85).lerp(new THREE.Color(0xa6c4eb), nightFactor);

    // Weather Atmospheric Overrides (crisp clear mountains & plains in good weather)
    let targetFogDensity = 0.0014 * seasonDef.fogMultiplier;
    let cloudDensity = 0.25;
    let windBase = 7;

    if (this.weather === 'cloudy') {
      this._skyTop.lerp(new THREE.Color(0x5d7285), 0.45);
      this._skyHorizon.lerp(new THREE.Color(0x9fb0bd), 0.5);
      targetFogDensity = 0.0028 * seasonDef.fogMultiplier;
      cloudDensity = 0.72;
      windBase = 13;
    } else if (this.weather === 'mist') {
      this._skyTop.lerp(new THREE.Color(0x88a2ad), 0.55);
      this._skyHorizon.lerp(new THREE.Color(0xc5d5dc), 0.72);
      targetFogDensity = 0.0125 * seasonDef.fogMultiplier;
      cloudDensity = 0.62;
      windBase = 5;
    } else if (this.weather === 'rain') {
      this._skyTop.lerp(new THREE.Color(0x3d4e5e), 0.68);
      this._skyHorizon.lerp(new THREE.Color(0x6e808f), 0.7);
      targetFogDensity = 0.0068 * seasonDef.fogMultiplier;
      cloudDensity = 0.88;
      windBase = 18;
    } else if (this.weather === 'storm') {
      this._skyTop.lerp(new THREE.Color(0x1f2833), 0.82);
      this._skyHorizon.lerp(new THREE.Color(0x3e4b59), 0.82);
      targetFogDensity = 0.0095 * seasonDef.fogMultiplier;
      cloudDensity = 0.96;
      windBase = 34;

      this.nextLightningTimer -= dt;
      if (this.nextLightningTimer <= 0) {
        this.nextLightningTimer = 6 + Math.random() * 11;
        this.lightningAlpha = 1.0;
        this.sound.playThunder();
      }
    }

    this.lightningAlpha = Math.max(0, this.lightningAlpha - dt * 3.8);
    const windSpeedKmh = this.autoWind
      ? Math.max(0, Math.round(windBase * seasonDef.windMultiplier + Math.sin(this.elapsed * 0.6) * 2.5))
      : Math.round(this.manualWindKmh);
    this.currentWindSpeedKmh = windSpeedKmh;

    // Sync Scene Fog & Background
    this._fogColor.copy(this._skyHorizon);
    this.fog.color.copy(this._fogColor);
    this.fog.density = THREE.MathUtils.damp(this.fog.density, targetFogDensity, 2.5, dt);

    // Sync Directional Sun/Moon Light
    const weatherDim =
      this.weather === 'storm' ? 0.34 : this.weather === 'rain' ? 0.52 : this.weather === 'mist' ? 0.68 : this.weather === 'cloudy' ? 0.74 : 1.0;

    if (sunElev > -0.05) {
      this.sunLight.position.copy(this._sunDir).multiplyScalar(68);
      this.sunLight.position.z -= 12;
      this.sunLight.color.copy(this._sunColor);
      this.sunLight.intensity = (0.35 + daylight * 2.15) * weatherDim + this.lightningAlpha * 2.6;
    } else {
      // Moonlight from above-front
      this.sunLight.position.set(-18, 42, -45);
      this.sunLight.color.setHex(0x8cb2e6);
      this.sunLight.intensity = 0.45 * weatherDim + this.lightningAlpha * 2.6;
    }

    this._hemiSky.copy(this._skyTop).lerp(new THREE.Color(0xffffff), 0.25);
    this._hemiGround.setHex(this.season === 'winter' ? 0x5c6b70 : this.season === 'autumn' ? 0x5a4c2d : 0x3b4d33);
    this.hemiLight.color.copy(this._hemiSky);
    this.hemiLight.groundColor.copy(this._hemiGround);
    this.hemiLight.intensity = THREE.MathUtils.lerp(0.28, 0.78, daylight) * (0.65 + weatherDim * 0.35);

    // Update Rain or Snow particles
    const precipitating = this.weather === 'rain' || this.weather === 'storm';
    this.rainPoints.visible = precipitating;
    if (precipitating) {
      const isWinterSnow = this.season === 'winter';
      this.rainMat.color.setHex(isWinterSnow ? 0xf2f7fa : 0xcfe4f5);
      this.rainMat.size = isWinterSnow ? 0.22 : 0.13;
      this.rainMat.opacity = isWinterSnow ? 0.8 : this.weather === 'storm' ? 0.68 : 0.48;

      const fallSpeed = isWinterSnow ? 4.2 : this.weather === 'storm' ? 24 : 16;
      const windX = (this.weather === 'storm' ? 5.5 : 1.6) * seasonDef.windMultiplier;
      for (let i = 0; i < this.rainPositions.length; i += 3) {
        this.rainPositions[i] += windX * dt;
        this.rainPositions[i + 1] -= fallSpeed * dt;
        if (this.rainPositions[i + 1] < 0) {
          this.rainPositions[i] = (Math.random() - 0.5) * 60;
          this.rainPositions[i + 1] = 18 + Math.random() * 6;
          this.rainPositions[i + 2] = (Math.random() - 0.5) * 60 - 16;
        }
      }
      this.rainGeo.attributes.position.needsUpdate = true;

      // Raindrop rings across the clear lake surface (skip for soft snow)
      if (!isWinterSnow) {
        this.rainDropTimer -= dt;
        if (this.rainDropTimer <= 0) {
          this.rainDropTimer = this.weather === 'storm' ? 0.08 : 0.16;
          const rx = (Math.random() - 0.5) * 56;
          const rz = -3 - Math.random() * 48;
          if (groundHeightAt(rx, rz) < -0.2) {
            this.water.addRipple(rx, rz, 0.42);
          }
        }
      }
    }

    // Fireflies at dusk/night in clear/misty non-winter weather
    const showFireflies = nightFactor > 0.35 && this.weather !== 'storm' && this.season !== 'winter';
    this.fireflyMat.opacity = showFireflies ? Math.min(0.85, (nightFactor - 0.35) * 1.4) : 0;
    this.fireflyPoints.visible = showFireflies;
    if (showFireflies) {
      const ffAttr = this.fireflyGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < ffAttr.count; i++) {
        const bx = this.fireflyBase[i * 3];
        const by = this.fireflyBase[i * 3 + 1];
        const bz = this.fireflyBase[i * 3 + 2];
        ffAttr.setXYZ(
          i,
          bx + Math.sin(this.elapsed * 0.9 + i) * 0.8,
          by + Math.cos(this.elapsed * 1.3 + i * 1.7) * 0.35,
          bz + Math.sin(this.elapsed * 0.7 + i * 2.3) * 0.8,
        );
      }
      ffAttr.needsUpdate = true;
    }

    const effectiveWindMult = Math.max(0.25, windSpeedKmh / 10);

    this.environment.update(
      this.elapsed,
      this._sunDir,
      this._skyTop,
      this._skyHorizon,
      this._sunColor,
      this.weather,
      this.season,
      nightFactor,
      cloudDensity,
      effectiveWindMult,
    );

    this.water.update(
      dt,
      this.elapsed,
      this._sunDir,
      this._skyTop,
      this._skyHorizon,
      this._sunColor,
      this.weather,
      windSpeedKmh,
      this._fogColor,
      this.fog.density,
    );

    this.sound.updateAmbience(this.weather, this.timeOfDay, this.elapsed, windSpeedKmh);

    let conditionLabel = 'جيد للصيد';
    if (this.weather === 'storm') conditionLabel = 'عاصف · فرص نادرة لأسماك العمق';
    else if (this.weather === 'rain') conditionLabel = 'ممطر · نشاط مرتفع للمفترسات';
    else if (this.weather === 'mist') conditionLabel = 'ضبابي · مثالي للشبوط والسلمون';
    else if (this.season === 'winter') conditionLabel = 'بارد · الأسماك تفضل الأعماق';
    else if (this.timeOfDay < 7.5 || (this.timeOfDay >= 16.5 && this.timeOfDay <= 19.5)) {
      conditionLabel = 'ذهبي · ذروة نشاط الأسماك';
    } else {
      conditionLabel = 'صافٍ · رؤية واضحة لقاع البحيرة';
    }

    return { nightFactor, windSpeedKmh, conditionLabel };
  }

  private tick = (): void => {
    if (this.disposed) return;

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;

    // Keyboard head-look support (Arrows / WASD)
    const lookSpeed = 1.45 * dt;
    if (this.keyState['ArrowLeft'] || this.keyState['KeyA']) {
      this.targetYaw = THREE.MathUtils.clamp(this.targetYaw + lookSpeed, -2.55, 2.55);
    }
    if (this.keyState['ArrowRight'] || this.keyState['KeyD']) {
      this.targetYaw = THREE.MathUtils.clamp(this.targetYaw - lookSpeed, -2.55, 2.55);
    }
    if (this.keyState['ArrowUp'] || this.keyState['KeyW']) {
      this.targetPitch = THREE.MathUtils.clamp(this.targetPitch + lookSpeed, -1.25, 0.85);
    }
    if (this.keyState['ArrowDown'] || this.keyState['KeyS']) {
      this.targetPitch = THREE.MathUtils.clamp(this.targetPitch - lookSpeed, -1.25, 0.85);
    }

    // Damped seated camera orientation + tiny natural breathing sway
    this.currentYaw = THREE.MathUtils.damp(this.currentYaw, this.targetYaw, 10, dt);
    this.currentPitch = THREE.MathUtils.damp(this.currentPitch, this.targetPitch, 10, dt);

    const headBob = Math.sin(this.elapsed * 1.45) * 0.005;
    this._seatedPos.set(0, 1.76 + headBob, 2.32);
    this._camLookDir.set(
      -Math.sin(this.currentYaw) * Math.cos(this.currentPitch),
      Math.sin(this.currentPitch),
      -Math.cos(this.currentYaw) * Math.cos(this.currentPitch),
    );
    this._seatedTarget.copy(this._seatedPos).addScaledVector(this._camLookDir, 10);
    this._lookMatrix.lookAt(this._seatedPos, this._seatedTarget, this._camUp);
    this._seatedQuat.setFromRotationMatrix(this._lookMatrix);

    // Cinematic Mode (idle panoramic orbit over the mountain lake)
    const canAutoIdle = this.cinematicAutoEnabled && (this.phase === 'idle' || this.phase === 'waiting');
    const idleSeconds = this.elapsed - this.lastActivityTime;
    const shouldCinematic = this.cinematicManualActive || (canAutoIdle && idleSeconds >= 18.0);

    if (shouldCinematic && !this.cinematicWasActive) {
      this.cinematicTime = 0;
      this.cinematicWasActive = true;
      this.emitHudState(true);
    } else if (!shouldCinematic && this.cinematicWasActive) {
      this.cinematicWasActive = false;
      this.emitHudState(true);
    }

    this.cinematicBlend = THREE.MathUtils.damp(
      this.cinematicBlend,
      shouldCinematic ? 1 : 0,
      shouldCinematic ? 1.15 : 2.8,
      dt,
    );

    if (this.cinematicBlend > 0.002) {
      this.cinematicTime += dt;
      const t = this.cinematicTime;
      const theta = Math.PI * 0.5 + t * 0.115;
      const rx = 24 + Math.sin(t * 0.19) * 5.0;
      const rz = 16 + Math.cos(t * 0.16) * 3.0;
      const cx = Math.cos(theta) * rx;
      const cz = -25 + Math.sin(theta) * rz;
      const groundY = Math.max(0, groundHeightAt(cx, cz));
      const cy = Math.max(groundY + 2.2, 3.6 + Math.sin(t * 0.24) * 2.1 + Math.cos(t * 0.11) * 1.1);

      this._cinePos.set(cx, cy, cz);
      this._cineTarget.set(
        Math.sin(t * 0.17) * 11.0,
        2.4 + Math.sin(t * 0.21) * 1.15,
        -26 + Math.cos(t * 0.13) * 9.0,
      );
      this._lookMatrix.lookAt(this._cinePos, this._cineTarget, this._camUp);
      this._cineQuat.setFromRotationMatrix(this._lookMatrix);

      this.camera.position.lerpVectors(this._seatedPos, this._cinePos, this.cinematicBlend);
      this.camera.quaternion.slerpQuaternions(this._seatedQuat, this._cineQuat, this.cinematicBlend);
    } else {
      this.camera.position.copy(this._seatedPos);
      this.camera.quaternion.copy(this._seatedQuat);
    }

    const { nightFactor, windSpeedKmh, conditionLabel } = this.updateAtmosphere(dt);

    // Clear timed notices
    if (this.lineSnapTimer > 0) {
      this.lineSnapTimer -= dt;
      if (this.lineSnapTimer <= 0) this.lineSnappedNotice = null;
    }
    if (this.questNoticeTimer > 0) {
      this.questNoticeTimer -= dt;
      if (this.questNoticeTimer <= 0) this.questNotice = null;
    }
    if (this.unlockNoticeTimer > 0) {
      this.unlockNoticeTimer -= dt;
      if (this.unlockNoticeTimer <= 0) this.newlyUnlockedNotice = null;
    }

    // --- Fishing Gameplay Loop ---
    if (this.phase === 'charging') {
      this.castPower += this.castPowerDir * dt * 1.15;
      if (this.castPower >= 1) {
        this.castPower = 1;
        this.castPowerDir = -1;
      } else if (this.castPower <= 0.08) {
        this.castPower = 0.08;
        this.castPowerDir = 1;
      }
    } else if (this.phase === 'casting') {
      this.castFlightT += dt * 1.45;
      const t = Math.min(1, this.castFlightT);
      this.bobberPos.lerpVectors(this.castStartPos, this.castTargetPos, t);
      this.bobberPos.y += Math.sin(t * Math.PI) * 2.8;
      this.lurePos.set(this.bobberPos.x, this.bobberPos.y - 0.3, this.bobberPos.z);

      if (t >= 1) {
        this.phase = 'waiting';
        this.bobberPos.y = this.water.getSurfaceHeightAt(this.bobberPos.x, this.bobberPos.z);
        const bedY = groundHeightAt(this.bobberPos.x, this.bobberPos.z);
        const safeLureY = Math.max(bedY + 0.22, -this.lineDepthMeters);
        this.lurePos.set(this.bobberPos.x, safeLureY, this.bobberPos.z);

        this.water.spawnSplash(this.bobberPos.x, this.bobberPos.z, 0.8 + this.castPower * 0.75);
        this.sound.playSplash(0.8);
        this.fishSystem.spookNear(this.bobberPos.x, this.bobberPos.z, 2.2);

        const zone = classifyLakeZone(this.bobberPos.x, this.bobberPos.z, Math.max(0.2, -bedY));
        const zoneMap = {
          dock_shade: 'ظل الرصيف',
          shore_reeds: 'ضفة القصب',
          rocky_ledge: 'الحافة الصخرية',
          deep_basin: 'الحوض العميق',
        };
        this.statusMessage = `العوامة مستقرة في ${zoneMap[zone]} — راقب العوامة وانتظر المفاجأة`;
        this.emitHudState(true);
      }
    } else if (this.phase === 'waiting' || this.phase === 'nibbling' || this.phase === 'biting') {
      const surfaceY = this.water.getSurfaceHeightAt(this.bobberPos.x, this.bobberPos.z);
      let bobOffset = 0;
      if (this.phase === 'nibbling') {
        bobOffset = -0.055 + Math.sin(this.elapsed * 18) * 0.03;
      } else if (this.phase === 'biting') {
        bobOffset = -0.18 + Math.sin(this.elapsed * 22) * 0.04;
      }
      this.bobberPos.y = surfaceY + bobOffset;
      const bedY = groundHeightAt(this.bobberPos.x, this.bobberPos.z);
      const safeLureY = Math.max(bedY + 0.22, -this.lineDepthMeters);
      this.lurePos.set(
        this.bobberPos.x + Math.sin(this.elapsed * 0.9) * 0.04,
        safeLureY,
        this.bobberPos.z + Math.cos(this.elapsed * 0.8) * 0.04,
      );
    } else if (this.phase === 'reeling' && this.hookedFish) {
      const f = this.hookedFish;
      const hookDef = HOOK_CATALOG.find((h) => h.id === this.selectedHook)!;
      const reelSkill = 1 + (this.progression.skills.reelSpeed - 1) * 0.16;
      const strengthSkill = 1 + (this.progression.skills.lineStrength - 1) * 0.15;

      // Fish fight surge timer
      f.surgeTimer -= dt;
      if (f.surgeTimer <= 0) {
        f.surgeTimer = 1.1 + Math.random() * 1.4;
        f.surgeDir = Math.random() < 0.5 ? -1 : 1;
      }

      const isSurging = f.stamina > 0.12 && Math.sin(this.elapsed * 2.6 + f.id) > 0.15;
      const dockPos = this._toDock.set(0, -0.5, 0.2).sub(f.position);
      const distToDock = Math.hypot(f.position.x, f.position.z - 0.2);
      dockPos.y = 0;
      if (distToDock > 0.01) dockPos.divideScalar(distToDock);

      // Perpendicular dart direction
      this._rightVec.set(-dockPos.z, 0, dockPos.x).multiplyScalar(f.surgeDir);

      const fightForce = f.species.fightStrength * (isSurging ? 1.35 : 0.55) * (0.45 + f.stamina * 0.55);

      if (this.reelHeld) {
        this.sound.playReelTick(this.elapsed);
        const pullSpeed = 3.2 * reelSkill - fightForce * 1.25;
        f.position.addScaledVector(dockPos, Math.max(0.45, pullSpeed) * dt);
        f.position.addScaledVector(this._rightVec, fightForce * 1.15 * dt);
        f.stamina = Math.max(0, f.stamina - dt * 0.22 * reelSkill);

        const tensionGain = (0.34 + fightForce * 0.58) / (hookDef.tensionTolerance * strengthSkill);
        this.lineTension = Math.min(1.05, this.lineTension + tensionGain * dt);
      } else {
        // Letting line breathe reduces tension while fish still pulls out slowly
        f.position.addScaledVector(dockPos, -fightForce * 1.15 * dt);
        f.position.addScaledVector(this._rightVec, fightForce * 1.65 * dt);
        f.stamina = Math.max(0, f.stamina - dt * 0.06);
        this.lineTension = Math.max(0.12, this.lineTension - dt * 0.55);
      }

      // Fish stay underwater (and visible) until reeled close to the dock
      // The hooked fish is now visible underwater the whole fight; it only breaks the surface near the dock
      const wasNear = this.hookNearDock;
      const shouldReveal = distToDock <= 7.0;
      this.hookNearDock = shouldReveal;
      f.mesh.visible = true;
      if (shouldReveal && !wasNear) {
        this.sound.playSplash(1.0);
        this.water.spawnSplash(f.position.x, f.position.z, 1.35);
      }

      // Clamp hooked fish inside water basin
      const bedY = groundHeightAt(f.position.x, f.position.z);
      f.position.y = THREE.MathUtils.clamp(f.position.y, Math.max(bedY + 0.22, -2.5), shouldReveal ? -0.14 : -0.35);
      f.mesh.position.copy(f.position);
      f.mesh.rotation.y = Math.atan2(
        this.reelHeld ? -dockPos.x : this._rightVec.x,
        this.reelHeld ? -dockPos.z : this._rightVec.z,
      );

      this.bobberPos.set(f.position.x, this.water.getSurfaceHeightAt(f.position.x, f.position.z) - 0.04, f.position.z);
      this.lurePos.copy(f.position);
      if (Math.random() < dt * 3.5) {
        this.water.addRipple(f.position.x, f.position.z, 0.75);
      }

      this.rodBend = THREE.MathUtils.damp(this.rodBend, 0.35 + this.lineTension * 0.65, 9, dt);

      // Check line snap vs landing catch
      if (this.lineTension >= 0.99) {
        this.lineSnappedNotice = 'انقطع الخيط بسبب الشد الزائد! هدّئ السحب عند احمرار المؤشر أو طوّر متانة الخيط.';
        this.lineSnapTimer = 4.5;
        this.resetToIdle('انقطع الخيط! اضغط للرمي مجدداً');
      } else if (distToDock <= 2.9) {
        this.completeCatch(f);
      }
    } else if (this.phase === 'caught' && this.hookedFish) {
      const f = this.hookedFish;
      f.mesh.visible = true;

      // Smoothly lift fish from water up into an unobstructed close-up showcase in front of the fisherman
      const targetX = -0.22;
      const targetY = 1.62 + Math.sin(this.elapsed * 2.1) * 0.024;
      const targetZ = 0.92;
      f.position.x = THREE.MathUtils.damp(f.position.x, targetX, 5.5, dt);
      f.position.y = THREE.MathUtils.damp(f.position.y, targetY, 5.5, dt);
      f.position.z = THREE.MathUtils.damp(f.position.z, targetZ, 5.5, dt);
      f.mesh.position.copy(f.position);

      const showcaseScale = THREE.MathUtils.clamp(f.lengthScale * 0.88, 0.72, 1.15);
      f.mesh.scale.setScalar(showcaseScale);

      if (!this.isDragging) {
        this.catchInspectAngle += dt * 0.42;
      }
      f.mesh.rotation.set(this.catchInspectTilt, this.catchInspectAngle, 0.08);

      this.bobberPos.set(f.position.x, f.position.y + 0.14, f.position.z);
      this.lurePos.set(f.position.x, f.position.y + 0.04, f.position.z);
    }

    // Smoothly ramp showcase fill light so caught fish scales & markings shine clearly even at dusk/night
    const wantShowcaseLight = this.phase === 'caught' && this.hookedFish !== null;
    this.catchShowcaseLight.intensity = THREE.MathUtils.damp(
      this.catchShowcaseLight.intensity,
      wantShowcaseLight ? 2.2 : 0,
      7,
      dt,
    );
    if (wantShowcaseLight && this.hookedFish) {
      this.catchShowcaseLight.position.set(
        this.hookedFish.position.x + 0.35,
        this.hookedFish.position.y + 0.48,
        this.hookedFish.position.z + 0.95,
      );
    }

    // Update Fish AI System
    const lureInWater = this.phase === 'waiting' || this.phase === 'nibbling' || this.phase === 'biting';
    this.fishSystem.update({
      dt,
      elapsed: this.elapsed,
      lurePos: lureInWater ? this.lurePos : null,
      lureInWater,
      baitId: this.selectedBait,
      hookId: this.selectedHook,
      weather: this.weather,
      season: this.season,
      timePreset: getPresetFromHour(this.timeOfDay),
      anglerSenseLevel: this.progression.skills.anglerSense,
      isReelingPhase: this.phase === 'reeling' || this.phase === 'caught',
      onNibble: (rx, rz) => {
        if (this.phase === 'waiting' || this.phase === 'nibbling') {
          this.phase = 'nibbling';
          this.water.addRipple(rx, rz, 0.65);
          this.sound.playNibble();
          this.statusMessage = 'سمكة تتفحص الطعم... استعد!';
          this.emitHudState(true);
        }
      },
      onBiteStart: (fish) => {
        if (this.phase === 'waiting' || this.phase === 'nibbling') {
          this.phase = 'biting';
          this.water.spawnSplash(fish.position.x, fish.position.z, 0.95);
          this.sound.playBiteAlert();
          this.statusMessage = 'غمزت السمكة! اضغط الآن (Space أو على الشاشة) لتثبيت الخطاف!';
          this.emitHudState(true);
        }
      },
      onBiteExpired: () => {
        if (this.phase === 'biting' || this.phase === 'nibbling') {
          this.phase = 'waiting';
          this.statusMessage = 'تراجعت السمكة... انتظر اقتراب أخرى';
          this.emitHudState(true);
        }
      },
    });

    // Update Rod, Chair, Lantern & Fishing Line
    const rodBendTarget =
      this.phase === 'reeling'
        ? this.rodBend
        : this.phase === 'caught'
          ? 0.16
          : this.phase === 'biting'
            ? 0.22
            : this.phase === 'nibbling'
              ? 0.08
              : 0.02;
    this.rodBend = THREE.MathUtils.damp(this.rodBend, rodBendTarget, 8, dt);

    const bobberVisible =
      this.phase === 'casting' ||
      this.phase === 'waiting' ||
      this.phase === 'nibbling' ||
      this.phase === 'biting' ||
      this.phase === 'reeling';

    this.dockRig.updateRodAndLine({
      elapsed: this.elapsed,
      castBackAngle: this.phase === 'charging' ? this.castPower : 0,
      rodBend: this.rodBend,
      rodYawOffset: THREE.MathUtils.clamp(this.currentYaw * 0.45, -0.55, 0.55),
      bobberPos: this.bobberPos,
      lurePos: this.lurePos,
      bobberVisible,
      reeling: this.phase === 'reeling' && this.reelHeld,
      nightFactor,
      windStrength: windSpeedKmh / 12,
    });

    // Periodic HUD refresh (15 Hz smooth meters without React spam)
    if (this.elapsed - this.lastHudEmit > 0.065) {
      this.emitHudState(false, windSpeedKmh, conditionLabel);
    }

    this.baskets.update(dt, this.elapsed);
    this.wildlife.update(dt, this.elapsed, nightFactor, this.weather);

    if (this.postFx) {
      const weatherSun: Record<string, number> = { clear: 1, cloudy: 0.55, mist: 0.7, rain: 0.2, storm: 0.05 };
      const sunUp = THREE.MathUtils.smoothstep(this._sunDir.y, -0.03, 0.14);
      const lowSun = 1 - THREE.MathUtils.smoothstep(Math.abs(this._sunDir.y), 0.0, 0.42);
      this.postFx.setSun(this.camera, this._sunDir, sunUp * (weatherSun[this.weather] ?? 0.5));
      this.postFx.setBloomStrength(0.26 + 0.24 * nightFactor + 0.1 * lowSun * sunUp);
      this.postFx.setWarmth(0.05 * lowSun * sunUp);
      this.postFx.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private emitHudState(force: boolean, windSpeedKmh = this.currentWindSpeedKmh, conditionLabel = 'صافٍ · رؤية واضحة لقاع البحيرة'): void {
    if (!force && this.elapsed - this.lastHudEmit < 0.06) return;
    this.lastHudEmit = this.elapsed;

    const biting = this.fishSystem.getBitingFish();
    const castZone =
      this.phase === 'waiting' || this.phase === 'nibbling' || this.phase === 'biting'
        ? classifyLakeZone(
            this.bobberPos.x,
            this.bobberPos.z,
            Math.max(0.2, -groundHeightAt(this.bobberPos.x, this.bobberPos.z)),
          )
        : null;

    this.onHudUpdate({
      phase: this.phase,
      castPower: this.castPower,
      lineTension: this.lineTension,
      fishDistance: this.hookedFish ? Math.max(0, Number(Math.hypot(this.hookedFish.position.x, this.hookedFish.position.z - 0.2).toFixed(1))) : 0,
      fishStamina: this.hookedFish ? this.hookedFish.stamina : 0,
      biteUrgency: biting ? THREE.MathUtils.clamp(biting.stateTimer / 2.4, 0, 1) : 0,
      hookedSpeciesName: this.hookedFish ? this.hookedFish.species.nameAr : null,
      statusMessage: this.statusMessage,
      timeOfDay: this.timeOfDay,
      timePreset: getPresetFromHour(this.timeOfDay),
      autoTimeCycle: this.autoTimeCycle,
      season: this.season,
      weather: this.weather,
      autoWeather: this.autoWeather,
      windSpeedKmh,
      autoWind: this.autoWind,
      fishingConditionLabel: conditionLabel,
      soundMuted: this.soundMuted,
      ambienceMix: this.sound.getAmbienceMix(),
      cinematicActive: this.cinematicManualActive || this.cinematicWasActive || this.cinematicBlend > 0.08,
      cinematicAutoEnabled: this.cinematicAutoEnabled,
      fishVisibleCount: this.fishSystem.fishes.length,
      selectedBait: this.selectedBait,
      selectedHook: this.selectedHook,
      lineDepthMeters: this.lineDepthMeters,
      currentCastZone: castZone,
      activeCatch: this.activeCatch,
      catchHistory: this.catchHistory,
      lineSnappedNotice: this.lineSnappedNotice,
      progression: this.progression,
      newlyUnlockedNotice: this.newlyUnlockedNotice,
      quests: buildQuestViews(this.questSave),
      graphicsQuality: this.graphicsQuality,
      graphicsLocked: this.isSoftwareGl,
      questNotice: this.questNotice,
    });
  }

  public dispose(): void {
    this.disposed = true;
    this.clearHoldTimer();
    cancelAnimationFrame(this.frameId);
    window.clearTimeout(this.frameId);

    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.onResize);
    dom.removeEventListener('webglcontextlost', this.onContextLost);

    this.sound.dispose();
    this.environment.dispose();
    this.water.dispose();
    this.fishSystem.dispose();
    this.dockRig.dispose();
    this.textures.dispose();
    this.rainGeo.dispose();
    this.rainMat.dispose();
    this.fireflyGeo.dispose();
    this.fireflyMat.dispose();
    this.pmremEnv.dispose();
    this.baskets.dispose();
    this.wildlife.dispose();
    this.postFx?.dispose();
    this.postFx = null;
    this.renderer.dispose();

    if (dom.parentElement === this.container) {
      this.container.removeChild(dom);
    }
  }
}
