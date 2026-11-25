import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { NatureSoundEngine, type AudioLocationContext } from '../audio/soundEngine';
import {
  BAIT_CATALOG,
  BOAT_CATALOG,
  HOOK_CATALOG,
  LAKE_ANCHOR_SPOTS,
  NIGHT_REFLECTION_MOODS,
  SEASON_CATALOG,
  SKILL_CATALOG,
  WEATHER_OPTIONS,
  classifyLakeZone,
  computeLevelFromXp,
  formatHourToClock,
  generateDailyChallenges,
  getPresetFromHour,
  getSkillUpgradeCost,
  getTodayDateKey,
  type AmbienceMix,
  type BaitId,
  type CaughtFishRecord,
  type DailyChallengesState,
  type FishingHudState,
  type FishingPhase,
  type HookId,
  type LakeSpotId,
  type NightReflectionMoodId,
  type PlayerProgression,
  type PoiDiscoveryNotice,
  type PoiHudItem,
  type PoiId,
  type SeasonId,
  type SkillKey,
  type SpeciesRecordEntry,
  type TimePresetId,
  type WeatherType,
} from '../types/fishing';
import { createBoatSystem } from './boatSystem';
import { createCrocodilesAndFrogs } from './crocodilesAndFrogs';
import { createDockAndRig } from './dockAndRig';
import { createEnvironment, groundHeightAt, type NightSkyMoodUniforms } from './environment';
import { createFishSystem, type ActiveFish } from './fishSystem';
import { createPointsOfInterest } from './pointsOfInterest';
import { createRivalAnglers } from './rivalAnglers';
import { createProceduralTextures } from './textures';
import { createCrystalWater, type WaterNightReflectionUniforms } from './water';
import { createWildlifeSystem } from './wildlife';
import { createPerchingBirdSystem } from './perchingBird';
import { createFishDripAndKeepnetSystem } from './fishDripAndKeepnet';

const STORAGE_KEY = 'serene_valley_angler_save_v1';
const DAILY_STORAGE_KEY = 'serene_valley_daily_challenges_v1';
const SPECIES_RECORDS_STORAGE_KEY = 'serene_valley_species_records_v1';
const DISCOVERED_POIS_STORAGE_KEY = 'serene_valley_discovered_pois_v1';
const NIGHT_MOOD_STORAGE_KEY = 'serene_valley_night_mood_v1';

const AUTO_NIGHT_MOOD_CYCLE: Exclude<NightReflectionMoodId, 'auto'>[] = [
  'silver_mirror',
  'aurora_emerald',
  'starlight_nebula',
  'golden_harvest',
];

function loadSavedNightMood(): NightReflectionMoodId {
  try {
    const raw = localStorage.getItem(NIGHT_MOOD_STORAGE_KEY);
    if (raw && NIGHT_REFLECTION_MOODS.some((m) => m.id === raw)) {
      return raw as NightReflectionMoodId;
    }
  } catch {
    // Ignore storage access errors
  }
  return 'auto';
}

function saveNightMood(mood: NightReflectionMoodId): void {
  try {
    localStorage.setItem(NIGHT_MOOD_STORAGE_KEY, mood);
  } catch {
    // Ignore storage quota errors
  }
}

function createInitialProgression(): PlayerProgression {
  return {
    level: 1,
    totalXp: 0,
    availableXp: 0,
    boatLevel: 1,
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
    const totalXp = typeof parsed.totalXp === 'number' ? Math.max(0, parsed.totalXp) : 0;
    const level = computeLevelFromXp(totalXp);
    const unlockedBaits = BAIT_CATALOG.filter((b) => b.unlockLevel <= level).map((b) => b.id);
    const unlockedHooks = HOOK_CATALOG.filter((h) => h.unlockLevel <= level).map((h) => h.id);
    return {
      level,
      totalXp,
      availableXp: typeof parsed.availableXp === 'number' ? Math.max(0, parsed.availableXp) : 0,
      boatLevel: THREE.MathUtils.clamp(typeof parsed.boatLevel === 'number' ? parsed.boatLevel : 1, 1, 4),
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

function loadDailyChallenges(unlockedBaits: BaitId[]): DailyChallengesState {
  const todayKey = getTodayDateKey();
  try {
    const raw = localStorage.getItem(DAILY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DailyChallengesState>;
      const prevCompletedTotal = typeof parsed.completedTotal === 'number' ? Math.max(0, parsed.completedTotal) : 0;
      if (parsed.dateKey === todayKey && Array.isArray(parsed.challenges) && parsed.challenges.length === 3) {
        return {
          dateKey: todayKey,
          challenges: parsed.challenges,
          completedTotal: prevCompletedTotal,
        };
      }
      const fresh: DailyChallengesState = {
        dateKey: todayKey,
        challenges: generateDailyChallenges(todayKey, unlockedBaits),
        completedTotal: prevCompletedTotal,
      };
      saveDailyChallenges(fresh);
      return fresh;
    }
  } catch {
    // Fall back to fresh challenges
  }
  const initial: DailyChallengesState = {
    dateKey: todayKey,
    challenges: generateDailyChallenges(todayKey, unlockedBaits),
    completedTotal: 0,
  };
  saveDailyChallenges(initial);
  return initial;
}

function saveDailyChallenges(state: DailyChallengesState): void {
  try {
    localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

function loadSpeciesRecords(): Record<string, SpeciesRecordEntry> {
  try {
    const raw = localStorage.getItem(SPECIES_RECORDS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, SpeciesRecordEntry>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveSpeciesRecords(records: Record<string, SpeciesRecordEntry>): void {
  try {
    localStorage.setItem(SPECIES_RECORDS_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage quota errors
  }
}

function loadDiscoveredPois(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DISCOVERED_POIS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveDiscoveredPois(records: Record<string, string>): void {
  try {
    localStorage.setItem(DISCOVERED_POIS_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage quota errors
  }
}

function formatArabicCompassBearing(dx: number, dz: number): string {
  // World +X = East, -X = West, -Z = North (across lake), +Z = South (behind pier)
  const angle = Math.atan2(dx, -dz); // 0 = North, +PI/2 = East
  const deg = ((angle * 180) / Math.PI + 360) % 360;
  if (deg < 22.5 || deg >= 337.5) return 'شمال';
  if (deg < 67.5) return 'شمال شرق';
  if (deg < 112.5) return 'شرق';
  if (deg < 157.5) return 'جنوب شرق';
  if (deg < 202.5) return 'جنوب';
  if (deg < 247.5) return 'جنوب غرب';
  if (deg < 292.5) return 'غرب';
  return 'شمال غرب';
}

export class FishingSceneManager {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl: boolean;
  private pmremEnv: THREE.WebGLRenderTarget;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;

  private textures: ReturnType<typeof createProceduralTextures>;
  private environment: ReturnType<typeof createEnvironment>;
  private water: ReturnType<typeof createCrystalWater>;
  private fishSystem: ReturnType<typeof createFishSystem>;
  private dockRig: ReturnType<typeof createDockAndRig>;
  private boatSystem: ReturnType<typeof createBoatSystem>;
  private poiSystem: ReturnType<typeof createPointsOfInterest>;
  private wildlife: ReturnType<typeof createWildlifeSystem>;
  private perchingBird: ReturnType<typeof createPerchingBirdSystem>;
  private fishDripAndKeepnet: ReturnType<typeof createFishDripAndKeepnetSystem>;
  private crocsAndFrogs: ReturnType<typeof createCrocodilesAndFrogs>;
  private rivalAnglers: ReturnType<typeof createRivalAnglers>;
  private sound = new NatureSoundEngine();

  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private catchShowcaseLight: THREE.PointLight;
  private fog: THREE.FogExp2;

  // Weather particle systems (Rain / Snow, Fireflies, Morning/Sunset Pollen, Cold Breath Vapor)
  private rainPoints: THREE.Points;
  private rainGeo: THREE.BufferGeometry;
  private rainMat: THREE.PointsMaterial;
  private rainPositions: Float32Array;
  private fireflyPoints: THREE.Points;
  private fireflyGeo: THREE.BufferGeometry;
  private fireflyMat: THREE.PointsMaterial;
  private fireflyBase: Float32Array;
  private pollenPoints: THREE.Points;
  private pollenGeo: THREE.BufferGeometry;
  private pollenMat: THREE.ShaderMaterial;
  private pollenPositions: Float32Array;
  private pollenSeeds: Float32Array;
  private breathPoints: THREE.Points;
  private breathGeo: THREE.BufferGeometry;
  private breathMat: THREE.ShaderMaterial;
  private breathPositions: Float32Array;
  private breathVelocities: Float32Array;
  private breathAges: Float32Array;
  private breathMaxAges: Float32Array;
  private breathSizes: Float32Array;
  private breathAlphas: Float32Array;
  private breathBurstTimer = 1.4;
  private breathCursor = 0;

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
  private nightReflectionMood: NightReflectionMoodId = loadSavedNightMood();
  private weatherChangeTimer = 160;
  private lightningAlpha = 0;
  private nextLightningTimer = 10;
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
  private challengeCompletedNotice: string | null = null;
  private challengeNoticeTimer = 0;
  private progression: PlayerProgression;
  private dailyChallenges: DailyChallengesState;
  private coldIntensity = 0;
  private crocThreatActive = false;
  private crocDistanceMeters = 999;
  private crocCloseEscape = false;
  private crocSurfaceSplashPending = false;
  private rivalContestActive = false;
  private rivalName: string | null = null;
  private rivalContestBalance = 0.56;
  private rivalWonThisCatch = false;
  private rivalNotice: string | null = null;
  private rivalNoticeTimer = 0;
  private rivalCutawayTimer = 0;
  private rivalCutawayBlend = 0;
  private rivalCutawayCooldown = 0;
  private rivalCutawaySpeciesName: string | null = null;
  private rivalCutawayWasActive = false;
  private _rivalCamQuat = new THREE.Quaternion();
  private playerCutawayTimer = 0;
  private playerCutawayBlend = 0;
  private playerCutawaySpeciesName: string | null = null;
  private playerCutawayWasActive = false;
  private _playerCutCamPos = new THREE.Vector3();
  private _playerCutLookAt = new THREE.Vector3();
  private _playerCutQuat = new THREE.Quaternion();
  private _prevBoatAudioPos = new THREE.Vector3();
  private _hasPrevBoatAudioPos = false;
  private smoothBoatSpeedNorm = 0;
  private _audioLocation: AudioLocationContext = {
    isOnBoat: false,
    isSailing: false,
    boatSpeedNorm: 0,
    waterDepthMeters: 1.4,
    shoreProximity: 1,
    nearCaveOrRock: 0,
  };
  private speciesRecords: Record<string, SpeciesRecordEntry>;
  private recordBrokenNotice: string | null = null;
  private recordNoticeTimer = 0;
  private heavyFishFactor = 0;
  private isHeavyHookedFish = false;
  private discoveredPois: Record<string, string>;
  private poiDiscoveredNotice: PoiDiscoveryNotice | null = null;
  private poiNoticeTimer = 0;
  private nearbyPoiName: string | null = null;
  private uiSteerForward = 0;
  private uiSteerTurn = 0;
  private prevBoatYaw = 0.18;

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
  private _breathOrigin = new THREE.Vector3();
  private _breathForward = new THREE.Vector3();
  private _breathDown = new THREE.Vector3();
  private _playerAnchorOffset = new THREE.Vector3();
  private _boatWorldPos = new THREE.Vector3();
  private _landingPoint = new THREE.Vector3();

  // Night reflection mood smoothed state & zero-GC shader payloads
  private _moonDir = new THREE.Vector3(-0.22, 0.44, -0.87).normalize();
  private _smoothMoonColor = new THREE.Color(0xdcecff);
  private _smoothSkyTopNight = new THREE.Color(0x091326);
  private _smoothSkyHorizonNight = new THREE.Color(0x1b2d45);
  private _smoothWaterDeepNight = new THREE.Color(0x082338);
  private _smoothAuroraA = new THREE.Color(0x3ef0b4);
  private _smoothAuroraB = new THREE.Color(0x52a8ff);
  private _targetColorA = new THREE.Color();
  private _targetColorB = new THREE.Color();
  private _noonTop = new THREE.Color(0x2869b2);
  private _noonHorizon = new THREE.Color(0xbce0f4);
  private _sunsetTop = new THREE.Color(0x3a3f75);
  private _sunsetHorizon = new THREE.Color(0xf49d64);
  private _tintColor = new THREE.Color();
  private smoothMoonSize = 1.0;
  private smoothStarDensity = 1.15;
  private smoothStarReflBoost = 1.15;
  private smoothMoonReflBoost = 1.15;
  private smoothAuroraStrength = 0.25;
  private _skyMoodPayload: NightSkyMoodUniforms = {
    moonDir: this._moonDir,
    moonColor: this._smoothMoonColor,
    moonSize: 1.0,
    starDensity: 1.15,
    auroraStrength: 0.25,
    auroraColorA: this._smoothAuroraA,
    auroraColorB: this._smoothAuroraB,
  };
  private _waterNightPayload: WaterNightReflectionUniforms = {
    nightFactor: 0,
    moonDir: this._moonDir,
    moonColor: this._smoothMoonColor,
    moonSize: 1.0,
    moonReflBoost: 1.15,
    starReflStrength: 1.15,
    auroraStrength: 0.25,
    auroraColorA: this._smoothAuroraA,
    auroraColorB: this._smoothAuroraB,
    waterDeepNightTint: this._smoothWaterDeepNight,
    cloudCover: 0.25,
  };

  constructor(container: HTMLElement, onHudUpdate: (state: FishingHudState) => void) {
    this.container = container;
    this.onHudUpdate = onHudUpdate;
    this.progression = loadSavedProgression();
    this.dailyChallenges = loadDailyChallenges(this.progression.unlockedBaits);
    this.speciesRecords = loadSpeciesRecords();
    this.discoveredPois = loadDiscoveredPois();

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
    this.sunLight.position.set(36, 48, -32);
    this.sunLight.castShadow = !this.isSoftwareGl;
    const shadowRes = this.isSoftwareGl ? 1024 : 4096;
    this.sunLight.shadow.mapSize.set(shadowRes, shadowRes);
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 210;
    const d = 64;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.00025;
    this.sunLight.shadow.normalBias = 0.014;
    this.sunLight.shadow.radius = 2.2;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    this.sunLight.target.position.set(0, 0, -18);

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
    this.boatSystem = createBoatSystem(this.textures);
    this.boatSystem.setBoatLevel(this.progression.boatLevel);
    this.poiSystem = createPointsOfInterest(this.textures);
    this.poiSystem.setDiscoveredIds(Object.keys(this.discoveredPois) as PoiId[]);
    this.wildlife = createWildlifeSystem();
    this.perchingBird = createPerchingBirdSystem();
    this.fishDripAndKeepnet = createFishDripAndKeepnetSystem(this.textures);
    this.crocsAndFrogs = createCrocodilesAndFrogs();
    this.rivalAnglers = createRivalAnglers();

    this.scene.add(this.environment.group);
    this.scene.add(this.dockRig.group);
    this.scene.add(this.boatSystem.group);
    this.boatSystem.boatRoot.add(this.fishDripAndKeepnet.boatKeepnetGroup);
    this.scene.add(this.poiSystem.group);
    this.scene.add(this.fishSystem.group);
    this.scene.add(this.water.group);
    this.scene.add(this.wildlife.group);
    this.scene.add(this.perchingBird.group);
    this.scene.add(this.fishDripAndKeepnet.group);
    this.scene.add(this.crocsAndFrogs.group);
    this.scene.add(this.rivalAnglers.group);

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

    // Sunlit Morning & Sunset Wind-Drifting Pollen / Dust Motes
    const pollenCount = 300;
    this.pollenGeo = new THREE.BufferGeometry();
    this.pollenPositions = new Float32Array(pollenCount * 3);
    this.pollenSeeds = new Float32Array(pollenCount);
    const pollenSizes = new Float32Array(pollenCount);
    const pollenPhases = new Float32Array(pollenCount);
    for (let i = 0; i < pollenCount; i++) {
      this.pollenPositions[i * 3] = (Math.random() - 0.5) * 58;
      this.pollenPositions[i * 3 + 1] = 0.45 + Math.random() * 9.5;
      this.pollenPositions[i * 3 + 2] = -36 + Math.random() * 42;
      this.pollenSeeds[i] = Math.random();
      pollenSizes[i] = 16 + Math.random() * 26;
      pollenPhases[i] = Math.random() * Math.PI * 2;
    }
    this.pollenGeo.setAttribute('position', new THREE.BufferAttribute(this.pollenPositions, 3));
    this.pollenGeo.setAttribute('aSize', new THREE.BufferAttribute(pollenSizes, 1));
    this.pollenGeo.setAttribute('aPhase', new THREE.BufferAttribute(pollenPhases, 1));

    this.pollenMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0.5 },
        uColor: { value: new THREE.Color(0xffe7a3) },
        uPixelRatio: { value: this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: `
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vAlpha;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float dist = max(1.0, -mvPosition.z);
          gl_PointSize = clamp(aSize * uPixelRatio / dist, 1.5, 18.0);
          vAlpha = (0.45 + 0.55 * sin(uTime * 1.9 + aPhase)) * smoothstep(42.0, 6.0, dist);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float r = length(c) * 2.0;
          if (r > 1.0) discard;
          float softGlow = pow(1.0 - r, 2.1);
          gl_FragColor = vec4(uColor, softGlow * vAlpha * uOpacity);
        }
      `,
    });
    this.pollenPoints = new THREE.Points(this.pollenGeo, this.pollenMat);
    this.pollenPoints.frustumCulled = false;
    this.scene.add(this.pollenPoints);

    // Cold-Weather Angler Breath Vapor Pool
    const breathCount = 32;
    this.breathGeo = new THREE.BufferGeometry();
    this.breathPositions = new Float32Array(breathCount * 3);
    this.breathVelocities = new Float32Array(breathCount * 3);
    this.breathAges = new Float32Array(breathCount).fill(99);
    this.breathMaxAges = new Float32Array(breathCount).fill(1.5);
    this.breathSizes = new Float32Array(breathCount).fill(28);
    this.breathAlphas = new Float32Array(breathCount).fill(0);
    this.breathGeo.setAttribute('position', new THREE.BufferAttribute(this.breathPositions, 3));
    this.breathGeo.setAttribute('aSize', new THREE.BufferAttribute(this.breathSizes, 1));
    this.breathGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.breathAlphas, 1));
    this.breathMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uPixelRatio: { value: this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        uniform float uPixelRatio;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = max(0.35, -mv.z);
          gl_PointSize = clamp(aSize * uPixelRatio / d, 2.0, 96.0);
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float r = length(c) * 2.0;
          if (r > 1.0) discard;
          float puff = pow(1.0 - r, 1.85);
          gl_FragColor = vec4(0.88, 0.94, 0.99, puff * vAlpha);
        }
      `,
    });
    this.breathPoints = new THREE.Points(this.breathGeo, this.breathMat);
    this.breathPoints.frustumCulled = false;
    this.scene.add(this.breathPoints);

    if (!this.isSoftwareGl) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.composer.setSize(width, height);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.24, 0.55, 0.88);
      this.composer.addPass(this.bloomPass);
      this.composer.addPass(new OutputPass());
      this.renderer.compile(this.scene, this.camera);
    }

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
    let changed = false;
    if (cancelManual && this.cinematicManualActive) {
      this.cinematicManualActive = false;
      changed = true;
    }
    if (cancelManual && this.rivalCutawayTimer > 0) {
      this.rivalCutawayTimer = 0;
      this.rivalCutawaySpeciesName = null;
      changed = true;
    }
    if (cancelManual && this.playerCutawayTimer > 0 && this.playerCutawayTimer < 2.85) {
      this.playerCutawayTimer = 0;
      this.playerCutawaySpeciesName = null;
      changed = true;
    }
    if (changed) {
      this.emitHudState(true);
    }
  }

  public cancelRivalCutaway(): void {
    if (this.rivalCutawayTimer > 0 || this.rivalCutawayWasActive) {
      this.rivalCutawayTimer = 0;
      this.rivalCutawayWasActive = false;
      this.rivalCutawaySpeciesName = null;
      this.lastActivityTime = this.elapsed;
      this.emitHudState(true);
    }
  }

  public cancelPlayerCutaway(): void {
    if (this.playerCutawayTimer > 0 || this.playerCutawayWasActive) {
      this.playerCutawayTimer = 0;
      this.playerCutawayWasActive = false;
      this.playerCutawaySpeciesName = null;
      this.lastActivityTime = this.elapsed;
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
      const rigYaw = this.boatSystem.isOnBoat() ? this.boatSystem.getBoatYaw() : 0;
      const nextYaw = this.targetYaw - dx * 0.0045;
      const rel = Math.atan2(Math.sin(nextYaw - rigYaw), Math.cos(nextYaw - rigYaw));
      this.targetYaw = rigYaw + THREE.MathUtils.clamp(rel, -2.55, 2.55);
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
    const dpr = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2);
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(dpr);
    this.pollenMat.uniforms.uPixelRatio.value = dpr;
    this.breathMat.uniforms.uPixelRatio.value = dpr;
    if (this.composer) {
      this.composer.setPixelRatio(dpr);
      this.composer.setSize(w, h);
    }
  };

  // --- Public Controls called by React HUD ---
  public handlePrimaryActionPress(): void {
    this.sound.unlock();
    this.markUserActivity(true);
    if (this.boatSystem.isSailing()) {
      this.statusMessage = 'انتظر قليلاً حتى يرسو القارب في الموقع المحدد...';
      this.emitHudState(true);
      return;
    }
    if (this.phase === 'idle') {
      if (this.playerCutawayTimer > 0) {
        this.playerCutawayTimer = 0;
        this.playerCutawaySpeciesName = null;
      }
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
    this.lineDepthMeters = THREE.MathUtils.clamp(depthMeters, 0.5, 10.5);
    this.emitHudState(true);
  }

  public setNightReflectionMood(mood: NightReflectionMoodId): void {
    this.nightReflectionMood = mood;
    saveNightMood(mood);
    const def = NIGHT_REFLECTION_MOODS.find((m) => m.id === mood);
    if (def) {
      this.statusMessage = `تم ضبط مزاج انعكاس الليل: ${def.nameAr}`;
    }
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
    this.targetYaw = this.boatSystem.isOnBoat() ? this.boatSystem.getBoatYaw() : 0;
    this.targetPitch = -0.20;
  }

  public boardBoatFreeRoam(): void {
    this.sound.unlock();
    this.markUserActivity(true);
    if (this.phase === 'caught') {
      this.statusMessage = 'احفظ أو أطلق السمكة أولاً قبل ركوب القارب';
      this.emitHudState(true);
      return;
    }
    if (this.phase !== 'idle') {
      this.resetToIdle('تم سحب الخيط للانطلاق بالقارب...');
    }
    this.boatSystem.boardForFreeRoam();
    this.prevBoatYaw = this.boatSystem.getBoatYaw();
    this.targetYaw = this.prevBoatYaw;
    this.currentYaw = this.prevBoatYaw;
    this.sound.playSplash(0.65);
    this.statusMessage = 'أنت الآن على متن القارب — حرّك بـ W/A/S/D أو أزرار الدفة لاستكشاف معالم البحيرة!';
    this.emitHudState(true);
  }

  public setBoatSteer(forward: number, turn: number): void {
    this.sound.unlock();
    this.markUserActivity(true);
    if ((Math.abs(forward) > 0.05 || Math.abs(turn) > 0.05) && !this.boatSystem.isOnBoat()) {
      this.boardBoatFreeRoam();
    }
    this.uiSteerForward = forward;
    this.uiSteerTurn = turn;
  }

  public sailToPoi(poiId: PoiId): void {
    if (!this.discoveredPois[poiId]) return;
    const approach = this.poiSystem.getPoiApproach(poiId);
    if (!approach) return;
    if (this.phase === 'caught') {
      this.statusMessage = 'احفظ أو أطلق السمكة أولاً قبل تحريك القارب';
      this.emitHudState(true);
      return;
    }
    if (this.phase !== 'idle') {
      this.resetToIdle('تم سحب الخيط للتحرك نحو المعلم...');
    }
    this.sound.unlock();
    this.markUserActivity(true);
    this.boatSystem.sailToCoordinates(approach.x, approach.z);
    this.sound.playSplash(0.75);
    const info = this.poiSystem.getPoiInfos().find((p) => p.definition.id === poiId);
    this.statusMessage = `جاري الإبحار نحو ${info?.definition.nameAr ?? 'المعلم'}...`;
    this.emitHudState(true);
  }

  public lookAtPoi(poiId: PoiId): void {
    const info = this.poiSystem.getPoiInfos().find((p) => p.definition.id === poiId);
    if (!info) return;
    this.markUserActivity(true);
    const px = this.boatSystem.isOnBoat() ? this._boatWorldPos.x : 0;
    const pz = this.boatSystem.isOnBoat() ? this._boatWorldPos.z : 2.3;
    const desiredYaw = Math.atan2(-(info.worldX - px), -(info.worldZ - pz));
    this.targetYaw = desiredYaw;
    this.targetPitch = -0.06;
    this.statusMessage = info.discovered
      ? `توجيه النظر نحو: ${info.definition.nameAr}`
      : `تم توجيه النظر نحو ${info.definition.mysteryTitleAr} — أبحر بالقارب لاستكشافه!`;
    this.emitHudState(true);
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

  public selectLakeLocation(spotId: LakeSpotId): void {
    const spot = LAKE_ANCHOR_SPOTS.find((s) => s.id === spotId);
    if (!spot) return;
    if (spot.requiredBoatLevel > this.progression.boatLevel) {
      this.statusMessage = `يتطلب الوصول إلى «${spot.nameAr}» ترقية القارب إلى المستوى ${spot.requiredBoatLevel}`;
      this.emitHudState(true);
      return;
    }
    if (this.phase === 'caught') {
      this.statusMessage = 'احفظ أو أطلق السمكة المصطادة أولاً قبل تحريك القارب';
      this.emitHudState(true);
      return;
    }
    if (this.phase !== 'idle') {
      this.resetToIdle(`تم سحب الخيط للتحرك نحو ${spot.nameAr}...`);
    }

    this.sound.unlock();
    this.markUserActivity(true);
    this.boatSystem.setTargetLocation(spotId, false);
    this.sound.playSplash(0.75);
    this.statusMessage =
      spotId === 'pier'
        ? 'جاري الإبحار والعودة إلى رصيف الصيد الخشبي...'
        : `جاري الإبحار بالقارب نحو ${spot.nameAr} (عمق ${spot.waterDepthMeters}م)...`;
    this.emitHudState(true);
  }

  public upgradeBoat(): void {
    const nextTier = BOAT_CATALOG.find((b) => b.level === this.progression.boatLevel + 1);
    if (!nextTier) return;
    if (this.progression.availableXp < nextTier.upgradeCostXp) return;

    this.progression = {
      ...this.progression,
      availableXp: this.progression.availableXp - nextTier.upgradeCostXp,
      boatLevel: nextTier.level,
    };
    saveProgression(this.progression);
    this.boatSystem.setBoatLevel(nextTier.level);
    this.sound.playCatchChime();
    this.newlyUnlockedNotice = `تمت ترقية القارب إلى «${nextTier.nameAr}»! ${nextTier.unlockSummaryAr}`;
    this.unlockNoticeTimer = 3.0;
    this.statusMessage = `أصبح لديك «${nextTier.nameAr}» — أبحر الآن نحو المناطق الأعمق في وسط البحيرة!`;
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
      this.getPlayerLandingAnchor(this._landingPoint);
      this.water.spawnSplash(this._landingPoint.x, this._landingPoint.z, 1.0);
      this.sound.playSplash(0.6);
      this.statusMessage = `أُطلقت السمكة في المياه الصافية (+${bonusXp} خبرة إضافية للحفاظ على البيئة)`;
    } else {
      const dropStart = this.hookedFish ? this.hookedFish.position : this.getPlayerLandingAnchor(this._landingPoint);
      const dropScale = this.hookedFish ? this.hookedFish.lengthScale : 1.0;
      this.fishDripAndKeepnet.onPlaceInKeepnet(
        dropStart,
        record.species,
        dropScale,
        this.boatSystem.isOnBoat(),
      );
      this.rivalCutawayTimer = 0;
      this.rivalCutawaySpeciesName = null;
      this.playerCutawayTimer = 3.25;
      this.playerCutawaySpeciesName = record.species.nameAr;
      this.lastActivityTime = this.elapsed;
      this.statusMessage = `تم وضع ${record.species.nameAr} في السبت وحفظها في السجل`;
    }

    this.catchHistory = [record, ...this.catchHistory];
    this.activeCatch = null;
    if (this.hookedFish) {
      this.hookedFish.mesh.scale.setScalar(this.hookedFish.lengthScale);
      this.hookedFish.mesh.rotation.set(0, this.hookedFish.heading, 0);
      this.hookedFish = null;
    }
    this.fishSystem.releaseHookedFish();
    this.phase = 'idle';
    this.emitHudState(true);
  }

  private getPlayerLandingAnchor(out: THREE.Vector3): THREE.Vector3 {
    if (this.boatSystem.isOnBoat()) {
      this.boatSystem.getBoatPosition(this._boatWorldPos);
      const yaw = this.boatSystem.getBoatYaw();
      return out.set(
        this._boatWorldPos.x - Math.sin(yaw) * 2.35,
        -0.5,
        this._boatWorldPos.z - Math.cos(yaw) * 2.35,
      );
    }
    return out.set(0, -0.5, 0.2);
  }

  // --- Internal Fishing Mechanics ---
  private launchCast(): void {
    this.sound.playCast();
    this.phase = 'casting';
    this.castFlightT = 0;

    this.dockRig.getRodTipWorldPos(this.castStartPos);

    const onBoat = this.boatSystem.isOnBoat();
    const rigYaw = onBoat ? this.boatSystem.getBoatYaw() : 0;
    const relYaw = Math.atan2(Math.sin(this.currentYaw - rigYaw), Math.cos(this.currentYaw - rigYaw));
    const maxRelYaw = onBoat ? 2.15 : 1.25;
    const castYaw = rigYaw + THREE.MathUtils.clamp(relYaw, -maxRelYaw, maxRelYaw);
    const castBonus = 1 + (this.progression.skills.castMastery - 1) * 0.14;
    const baseDist = (8.5 + this.castPower * 32.0) * castBonus;
    const windDriftX =
      (0.18 + (this.currentWindSpeedKmh / 18) * 1.15) *
      (1 - (this.progression.skills.castMastery - 1) * 0.18) *
      (Math.random() - 0.5);

    const originX = this._playerAnchorOffset.x - Math.sin(rigYaw) * 0.5;
    const originZ = (onBoat ? 2.3 : 1.0) + this._playerAnchorOffset.z - Math.cos(rigYaw) * 0.5;

    let tx = originX - Math.sin(castYaw) * baseDist + windDriftX;
    let tz = originZ - Math.cos(castYaw) * baseDist;

    // Clamp target into valid expanded lake water
    tx = THREE.MathUtils.clamp(tx, -74, 74);
    tz = THREE.MathUtils.clamp(tz, -92, 4.0);
    let bedY = groundHeightAt(tx, tz);
    for (let i = 0; i < 10 && bedY > -0.45; i++) {
      tx = THREE.MathUtils.lerp(tx, 0, 0.22);
      tz = THREE.MathUtils.lerp(tz, -44, 0.25);
      bedY = groundHeightAt(tx, tz);
    }

    this.castTargetPos.set(tx, 0.0, tz);
    this.bobberPos.copy(this.castStartPos);
    this.statusMessage = 'الصنارة في الهواء...';
    this.emitHudState(true);
  }

  private computeFishDimensions(fish: ActiveFish): { lengthCm: number; weightKg: number; heavyFactor: number } {
    const sp = fish.species;
    const ratio = THREE.MathUtils.clamp((fish.lengthScale - 0.65) / 0.85, 0.12, 1.0);
    const lengthCm = Math.round(THREE.MathUtils.lerp(sp.minLengthCm, sp.maxLengthCm, ratio));
    const weightKg = Number((sp.baseWeightKg * (0.65 + ratio * 0.95)).toFixed(2));
    const heavyFactor = THREE.MathUtils.clamp((weightKg - 1.3) / 4.2, 0, 1);
    return { lengthCm, weightKg, heavyFactor };
  }

  private attemptHookSet(): void {
    const hooked = this.fishSystem.hookBitingFish();
    if (!hooked) {
      this.resetToIdle('أفلت الطعم! حاول الاستجابة فور غوص العوامة');
      return;
    }
    this.hookedFish = hooked;
    const dims = this.computeFishDimensions(hooked);
    this.heavyFishFactor = dims.heavyFactor;
    this.isHeavyHookedFish = dims.weightKg >= 2.2 || dims.heavyFactor >= 0.25;

    this.phase = 'reeling';
    this.lineTension = 0.28 + this.heavyFishFactor * 0.14;
    this.reelHeld = false;
    this.crocCloseEscape = false;
    this.crocSurfaceSplashPending = true;
    this.rivalWonThisCatch = false;
    this.rivalAnglers.resetContest();
    this.sound.playSplash(1.1);
    this.water.spawnSplash(hooked.position.x, hooked.position.z, 1.15 + this.heavyFishFactor * 0.45);
    this.statusMessage = this.isHeavyHookedFish
      ? `سمكة ثقيلة جداً (${hooked.species.nameAr})! راقب إجهاد الخيط واهتزازه!`
      : `علقت ${hooked.species.nameAr}! اسحب بحذر وراقب التماسيح والمنافسين`;
    this.emitHudState(true);
  }

  private resetToIdle(message: string): void {
    this.phase = 'idle';
    this.castPower = 0;
    this.lineTension = 0;
    this.rodBend = 0;
    this.reelHeld = false;
    this.chargeHeld = false;
    this.heavyFishFactor = 0;
    this.isHeavyHookedFish = false;
    this.crocThreatActive = false;
    this.crocDistanceMeters = 999;
    this.crocCloseEscape = false;
    this.rivalContestActive = false;
    this.rivalName = null;
    this.rivalWonThisCatch = false;
    this.rivalAnglers.resetContest();
    if (this.hookedFish) {
      this.hookedFish.mesh.scale.setScalar(this.hookedFish.lengthScale);
      this.hookedFish.mesh.rotation.set(0, this.hookedFish.heading, 0);
    }
    this.hookedFish = null;
    this.fishSystem.releaseHookedFish();
    this.statusMessage = message;
    this.emitHudState(true);
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
          ? `ترقية للمستوى ${newLevel}: ${newGearNames.join('، ')}`
          : `ترقية إلى المستوى ${newLevel}!`;
      this.unlockNoticeTimer = 3.0;
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
    this.fishDripAndKeepnet.onFishEmerged(fish.position, fish.lengthScale);
    this.phase = 'caught';
    this.reelHeld = false;
    this.lineTension = 0;
    this.rodBend = 0.25;

    const sp = fish.species;
    const { lengthCm, weightKg } = this.computeFishDimensions(fish);
    const rarityBase = sp.rarity === 'أسطوري' ? 190 : sp.rarity === 'نادر' ? 95 : 42;
    const xpEarned = Math.round(rarityBase + weightKg * 14);

    // Check & update Species Record Weight
    const existingRecord = this.speciesRecords[sp.id];
    let isNewRecord = false;
    let previousRecordKg: number | undefined;
    let recordBonusXp = 0;

    if (!existingRecord || weightKg > existingRecord.maxWeightKg) {
      isNewRecord = true;
      previousRecordKg = existingRecord?.maxWeightKg;
      recordBonusXp = existingRecord ? 40 : 20;
      const updatedRecords: Record<string, SpeciesRecordEntry> = {
        ...this.speciesRecords,
        [sp.id]: {
          speciesId: sp.id,
          maxWeightKg: weightKg,
          maxLengthCm: Math.max(lengthCm, existingRecord?.maxLengthCm ?? 0),
          achievedAt: formatHourToClock(this.timeOfDay),
        },
      };
      this.speciesRecords = updatedRecords;
      saveSpeciesRecords(updatedRecords);

      this.recordBrokenNotice = existingRecord
        ? `رقم قياسي جديد لـ ${sp.nameAr}: ${weightKg} كجم (+${recordBonusXp} XP)`
        : `أول رقم قياسي لـ ${sp.nameAr}: ${weightKg} كجم (+${recordBonusXp} XP)`;
      this.recordNoticeTimer = 3.0;
    }

    const challengeBonusXp = this.evaluateDailyChallenges(sp.id, this.selectedBait, this.weather);
    const crocEscapeBonusXp = this.crocCloseEscape ? 35 : 0;
    const rivalWinBonusXp = this.rivalWonThisCatch ? 50 : 0;
    this.applyXpGain(xpEarned + challengeBonusXp + crocEscapeBonusXp + rivalWinBonusXp + recordBonusXp);

    this.heavyFishFactor = 0;
    this.isHeavyHookedFish = false;
    this.crocCloseEscape = false;
    this.rivalWonThisCatch = false;
    this.crocThreatActive = false;
    this.rivalContestActive = false;
    this.rivalName = null;
    this.rivalAnglers.resetContest();

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
      dailyChallengeBonusXp: challengeBonusXp > 0 ? challengeBonusXp : undefined,
      crocEscapeBonusXp: crocEscapeBonusXp > 0 ? crocEscapeBonusXp : undefined,
      rivalWinBonusXp: rivalWinBonusXp > 0 ? rivalWinBonusXp : undefined,
      isNewRecord,
      previousRecordKg,
      recordBonusXp: recordBonusXp > 0 ? recordBonusXp : undefined,
    };

    // Reveal caught fish by lifting it gracefully into close-up 3D showcase in front of the angler
    fish.mesh.visible = true;
    this.targetYaw = 0;
    this.targetPitch = -0.09;
    this.cinematicManualActive = false;
    this.lastActivityTime = this.elapsed;
    this.catchInspectAngle = Math.PI * 0.45;
    this.catchInspectTilt = 0.06;

    const totalBonus = challengeBonusXp + crocEscapeBonusXp + rivalWinBonusXp + recordBonusXp;
    this.statusMessage =
      totalBonus > 0
        ? `مفاجأة الصيد! ${sp.nameAr} (+${xpEarned} XP + ${totalBonus} مكافأة!)`
        : `مفاجأة الصيد! ${sp.nameAr} (+${xpEarned} نقطة خبرة)`;
    this.emitHudState(true);
  }

  private ensureTodayChallenges(): void {
    const todayKey = getTodayDateKey();
    if (this.dailyChallenges.dateKey !== todayKey) {
      this.dailyChallenges = {
        dateKey: todayKey,
        challenges: generateDailyChallenges(todayKey, this.progression.unlockedBaits),
        completedTotal: this.dailyChallenges.completedTotal,
      };
      saveDailyChallenges(this.dailyChallenges);
    }
  }

  private evaluateDailyChallenges(speciesId: string, baitId: BaitId, weather: WeatherType): number {
    this.ensureTodayChallenges();
    let changed = false;
    let bonusXp = 0;
    const completedTitles: string[] = [];

    const updatedChallenges = this.dailyChallenges.challenges.map((ch) => {
      if (ch.completed) return ch;
      if (ch.speciesId && ch.speciesId !== speciesId) return ch;
      if (ch.baitId && ch.baitId !== baitId) return ch;
      if (ch.weather && ch.weather !== weather) return ch;

      changed = true;
      const nextProgress = Math.min(ch.targetCount, ch.progress + 1);
      const justCompleted = nextProgress >= ch.targetCount;
      if (justCompleted) {
        bonusXp += ch.xpReward;
        completedTitles.push(ch.titleAr);
      }
      return {
        ...ch,
        progress: nextProgress,
        completed: justCompleted,
      };
    });

    if (changed) {
      this.dailyChallenges = {
        ...this.dailyChallenges,
        challenges: updatedChallenges,
        completedTotal: this.dailyChallenges.completedTotal + completedTitles.length,
      };
      saveDailyChallenges(this.dailyChallenges);

      if (completedTitles.length > 0) {
        this.challengeCompletedNotice = `إنجاز تحدٍّ يومي: ${completedTitles.join(' و ')} (+${bonusXp} XP)`;
        this.challengeNoticeTimer = 3.0;
      }
    }

    return bonusXp;
  }

  private updateAtmosphere(dt: number): {
    nightFactor: number;
    windSpeedKmh: number;
    conditionLabel: string;
  } {
    if (this.autoTimeCycle) {
      // Full 24h cycle every ~16 minutes for natural, unhurried dawn/day/sunset/night transitions
      this.timeOfDay = (this.timeOfDay + dt * 0.025) % 24;
    }

    const seasonDef = SEASON_CATALOG.find((s) => s.id === this.season)!;

    if (this.autoWeather) {
      this.weatherChangeTimer -= dt;
      if (this.weatherChangeTimer <= 0) {
        this.weatherChangeTimer = 160 + Math.random() * 110;
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

    // Resolve active Night Reflection Mood (supports 'auto' smooth cycling or explicit preset)
    let targetMoonSize = 1.0;
    let targetStarDensity = 1.15;
    let targetStarReflBoost = 1.15;
    let targetMoonReflBoost = 1.15;
    let targetAuroraStrength = 0.25;

    if (this.nightReflectionMood === 'auto') {
      const cyclePos = (this.timeOfDay * 0.14 + this.elapsed * 0.0045) % AUTO_NIGHT_MOOD_CYCLE.length;
      const idxA = Math.floor(cyclePos);
      const idxB = (idxA + 1) % AUTO_NIGHT_MOOD_CYCLE.length;
      const blend = THREE.MathUtils.smoothstep(cyclePos - idxA, 0.15, 0.85);
      const moodA = NIGHT_REFLECTION_MOODS.find((m) => m.id === AUTO_NIGHT_MOOD_CYCLE[idxA]) ?? NIGHT_REFLECTION_MOODS[1];
      const moodB = NIGHT_REFLECTION_MOODS.find((m) => m.id === AUTO_NIGHT_MOOD_CYCLE[idxB]) ?? NIGHT_REFLECTION_MOODS[2];

      const dampRate = 3.2;
      this._targetColorA.setHex(moodA.moonColor).lerp(this._targetColorB.setHex(moodB.moonColor), blend);
      this._smoothMoonColor.lerp(this._targetColorA, Math.min(1, dt * dampRate));

      this._targetColorA.setHex(moodA.skyTopNight).lerp(this._targetColorB.setHex(moodB.skyTopNight), blend);
      this._smoothSkyTopNight.lerp(this._targetColorA, Math.min(1, dt * dampRate));

      this._targetColorA.setHex(moodA.skyHorizonNight).lerp(this._targetColorB.setHex(moodB.skyHorizonNight), blend);
      this._smoothSkyHorizonNight.lerp(this._targetColorA, Math.min(1, dt * dampRate));

      this._targetColorA.setHex(moodA.waterDeepNight).lerp(this._targetColorB.setHex(moodB.waterDeepNight), blend);
      this._smoothWaterDeepNight.lerp(this._targetColorA, Math.min(1, dt * dampRate));

      this._targetColorA.setHex(moodA.auroraColorA).lerp(this._targetColorB.setHex(moodB.auroraColorA), blend);
      this._smoothAuroraA.lerp(this._targetColorA, Math.min(1, dt * dampRate));

      this._targetColorA.setHex(moodA.auroraColorB).lerp(this._targetColorB.setHex(moodB.auroraColorB), blend);
      this._smoothAuroraB.lerp(this._targetColorA, Math.min(1, dt * dampRate));

      targetMoonSize = THREE.MathUtils.lerp(moodA.moonSize, moodB.moonSize, blend);
      targetStarDensity = THREE.MathUtils.lerp(moodA.starDensity, moodB.starDensity, blend);
      targetStarReflBoost = THREE.MathUtils.lerp(moodA.starReflBoost, moodB.starReflBoost, blend);
      targetMoonReflBoost = THREE.MathUtils.lerp(moodA.moonReflBoost, moodB.moonReflBoost, blend);
      targetAuroraStrength = THREE.MathUtils.lerp(moodA.auroraStrength, moodB.auroraStrength, blend);
    } else {
      const mood = NIGHT_REFLECTION_MOODS.find((m) => m.id === this.nightReflectionMood) ?? NIGHT_REFLECTION_MOODS[1];
      const dampRate = 3.6;
      this._targetColorA.setHex(mood.moonColor);
      this._smoothMoonColor.lerp(this._targetColorA, Math.min(1, dt * dampRate));
      this._targetColorA.setHex(mood.skyTopNight);
      this._smoothSkyTopNight.lerp(this._targetColorA, Math.min(1, dt * dampRate));
      this._targetColorA.setHex(mood.skyHorizonNight);
      this._smoothSkyHorizonNight.lerp(this._targetColorA, Math.min(1, dt * dampRate));
      this._targetColorA.setHex(mood.waterDeepNight);
      this._smoothWaterDeepNight.lerp(this._targetColorA, Math.min(1, dt * dampRate));
      this._targetColorA.setHex(mood.auroraColorA);
      this._smoothAuroraA.lerp(this._targetColorA, Math.min(1, dt * dampRate));
      this._targetColorA.setHex(mood.auroraColorB);
      this._smoothAuroraB.lerp(this._targetColorA, Math.min(1, dt * dampRate));

      targetMoonSize = mood.moonSize;
      targetStarDensity = mood.starDensity;
      targetStarReflBoost = mood.starReflBoost;
      targetMoonReflBoost = mood.moonReflBoost;
      targetAuroraStrength = mood.auroraStrength;
    }

    this.smoothMoonSize = THREE.MathUtils.damp(this.smoothMoonSize, targetMoonSize, 3.4, dt);
    this.smoothStarDensity = THREE.MathUtils.damp(this.smoothStarDensity, targetStarDensity, 3.4, dt);
    this.smoothStarReflBoost = THREE.MathUtils.damp(this.smoothStarReflBoost, targetStarReflBoost, 3.4, dt);
    this.smoothMoonReflBoost = THREE.MathUtils.damp(this.smoothMoonReflBoost, targetMoonReflBoost, 3.4, dt);
    this.smoothAuroraStrength = THREE.MathUtils.damp(this.smoothAuroraStrength, targetAuroraStrength, 3.4, dt);

    // Moon trajectory over the alpine lake (-Z) across nighttime hours
    const nightArc = this.timeOfDay >= 18 ? this.timeOfDay - 24 : this.timeOfDay;
    const moonX = Math.sin(nightArc * 0.22) * 0.44;
    const moonY = Math.max(0.16, 0.24 + Math.cos(nightArc * 0.24) * 0.24);
    this._moonDir.set(moonX, moonY, -0.85).normalize();

    // Base Sky & Horizon Colors across Time of Day
    this._skyTop.copy(this._smoothSkyTopNight).lerp(this._noonTop, daylight).lerp(this._sunsetTop, golden * 0.72);
    this._skyHorizon.copy(this._smoothSkyHorizonNight).lerp(this._noonHorizon, daylight).lerp(this._sunsetHorizon, golden * 0.85);
    this._sunColor.setHex(0xfff4db).lerp(this._targetColorA.setHex(0xff9a52), golden * 0.85).lerp(this._smoothMoonColor, nightFactor);

    // Weather Atmospheric Overrides (crisp clear mountains & plains in good weather)
    let targetFogDensity = 0.0014 * seasonDef.fogMultiplier;
    let cloudDensity = 0.25;
    let windBase = 7;

    if (this.weather === 'cloudy') {
      this._skyTop.lerp(this._tintColor.setHex(0x5d7285), 0.45);
      this._skyHorizon.lerp(this._tintColor.setHex(0x9fb0bd), 0.5);
      targetFogDensity = 0.0028 * seasonDef.fogMultiplier;
      cloudDensity = 0.72;
      windBase = 13;
    } else if (this.weather === 'mist') {
      this._skyTop.lerp(this._tintColor.setHex(0x88a2ad), 0.55);
      this._skyHorizon.lerp(this._tintColor.setHex(0xc5d5dc), 0.72);
      targetFogDensity = 0.0125 * seasonDef.fogMultiplier;
      cloudDensity = 0.62;
      windBase = 5;
    } else if (this.weather === 'rain') {
      this._skyTop.lerp(this._tintColor.setHex(0x3d4e5e), 0.68);
      this._skyHorizon.lerp(this._tintColor.setHex(0x6e808f), 0.7);
      targetFogDensity = 0.0068 * seasonDef.fogMultiplier;
      cloudDensity = 0.88;
      windBase = 18;
    } else if (this.weather === 'storm') {
      this._skyTop.lerp(this._tintColor.setHex(0x1f2833), 0.82);
      this._skyHorizon.lerp(this._tintColor.setHex(0x3e4b59), 0.82);
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
      this.sunLight.position.copy(this.sunLight.target.position).addScaledVector(this._sunDir, 88);
      this.sunLight.color.copy(this._sunColor);
      this.sunLight.intensity = (0.35 + daylight * 2.15) * weatherDim + this.lightningAlpha * 2.6;
    } else {
      // Sync directional moonlight & shadows with the moon mood position & tint
      this.sunLight.position.copy(this.sunLight.target.position).addScaledVector(this._moonDir, 88);
      this.sunLight.color.copy(this._smoothMoonColor);
      this.sunLight.intensity = (0.42 + (this.smoothMoonReflBoost - 1.0) * 0.25) * weatherDim + this.lightningAlpha * 2.6;
    }

    if (this.bloomPass) {
      this.bloomPass.strength =
        0.22 + nightFactor * (0.12 + this.smoothAuroraStrength * 0.08 + (this.smoothMoonReflBoost - 1.0) * 0.06) + golden * 0.06;
    }

    this._hemiSky.copy(this._skyTop).lerp(this._tintColor.setHex(0xffffff), 0.25);
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
          const rx = (Math.random() - 0.5) * 90;
          const rz = -3 - Math.random() * 76;
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

    // Morning & Sunset Wind-Drifting Golden Dust & Pollen Motes
    const morningGlow = Math.exp(-Math.pow((this.timeOfDay - 8.2) / 2.6, 2));
    const sunsetGlow = Math.exp(-Math.pow((this.timeOfDay - 17.6) / 2.2, 2));
    const goldenAirStrength = Math.max(morningGlow, sunsetGlow);
    const weatherPollenDim =
      this.weather === 'storm' ? 0.06 : this.weather === 'rain' ? 0.18 : this.weather === 'cloudy' ? 0.52 : 1.0;
    const pollenAlpha = goldenAirStrength * weatherPollenDim * (this.season === 'winter' ? 0.42 : 0.88);

    this.pollenPoints.visible = pollenAlpha > 0.03;
    if (this.pollenPoints.visible) {
      this.pollenMat.uniforms.uTime.value = this.elapsed;
      this.pollenMat.uniforms.uOpacity.value = pollenAlpha;
      const sunsetMix = sunsetGlow > morningGlow ? 0.65 : 0.15;
      this.pollenMat.uniforms.uColor.value
        .setHex(this.season === 'winter' ? 0xf2f7ff : 0xffe8a6)
        .lerp(new THREE.Color(0xffb866), sunsetMix * (this.season === 'winter' ? 0.25 : 1.0));

      const windDriftX = (0.35 + windSpeedKmh * 0.11) * seasonDef.windMultiplier;
      const windDriftZ = (0.12 + windSpeedKmh * 0.035) * seasonDef.windMultiplier;
      for (let i = 0; i < this.pollenSeeds.length; i++) {
        const s = this.pollenSeeds[i];
        const idx = i * 3;
        let px = this.pollenPositions[idx] + (windDriftX * (0.65 + s * 0.7) + Math.sin(this.elapsed * 0.75 + s * 14.0) * 0.28) * dt;
        let py = this.pollenPositions[idx + 1] + (Math.sin(this.elapsed * 1.15 + s * 22.0) * 0.24 + (s - 0.45) * 0.12) * dt;
        let pz = this.pollenPositions[idx + 2] + (windDriftZ + Math.cos(this.elapsed * 0.65 + s * 18.0) * 0.2) * dt;

        if (px > 29) px = -29;
        if (px < -29) px = 29;
        if (py > 10.0) py = 0.5;
        if (py < 0.45) py = 9.5;
        if (pz > 6) pz = -36;
        if (pz < -36) pz = 6;

        this.pollenPositions[idx] = px;
        this.pollenPositions[idx + 1] = py;
        this.pollenPositions[idx + 2] = pz;
      }
      this.pollenGeo.attributes.position.needsUpdate = true;
    }

    // Cold Weather Intensity & Angler Cold Breath Vapor Emitter (gentle, realistic frost ramp)
    let targetCold = 0.0;
    if (this.season === 'winter') {
      targetCold = 1.0;
    } else if (this.season === 'autumn') {
      targetCold = nightFactor > 0.45 || this.weather === 'mist' || this.weather === 'rain' || this.weather === 'storm' ? 0.52 : 0.14;
    } else if (this.season === 'spring') {
      targetCold = nightFactor > 0.78 ? 0.28 : 0.0;
    }
    this.coldIntensity = THREE.MathUtils.damp(this.coldIntensity, targetCold, 0.18, dt);

    const canBreathe = this.coldIntensity > 0.32 && this.cinematicBlend < 0.25;
    this.breathPoints.visible = this.coldIntensity > 0.2 && this.cinematicBlend < 0.35;
    if (canBreathe) {
      this.breathBurstTimer -= dt;
      if (this.breathBurstTimer <= 0) {
        this.breathBurstTimer = 2.9 + Math.random() * 0.7;
        this._breathForward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
        this._breathDown.set(0, -1, 0).applyQuaternion(this.camera.quaternion);
        this._breathOrigin
          .copy(this.camera.position)
          .addScaledVector(this._breathForward, 0.38)
          .addScaledVector(this._breathDown, 0.14);

        for (let b = 0; b < 7; b++) {
          const idx = this.breathCursor;
          this.breathCursor = (this.breathCursor + 1) % this.breathAges.length;
          const pIdx = idx * 3;
          this.breathPositions[pIdx] = this._breathOrigin.x + (Math.random() - 0.5) * 0.04;
          this.breathPositions[pIdx + 1] = this._breathOrigin.y + (Math.random() - 0.5) * 0.03;
          this.breathPositions[pIdx + 2] = this._breathOrigin.z + (Math.random() - 0.5) * 0.04;

          this.breathVelocities[pIdx] = this._breathForward.x * (0.42 + Math.random() * 0.18) + (windSpeedKmh * 0.015) + (Math.random() - 0.5) * 0.08;
          this.breathVelocities[pIdx + 1] = 0.09 + Math.random() * 0.08;
          this.breathVelocities[pIdx + 2] = this._breathForward.z * (0.42 + Math.random() * 0.18) + (Math.random() - 0.5) * 0.08;

          this.breathAges[idx] = -b * 0.055;
          this.breathMaxAges[idx] = 1.35 + Math.random() * 0.45;
        }
      }
    }

    if (this.breathPoints.visible) {
      for (let i = 0; i < this.breathAges.length; i++) {
        this.breathAges[i] += dt;
        const age = this.breathAges[i];
        const maxA = this.breathMaxAges[i];
        if (age < 0 || age >= maxA) {
          this.breathAlphas[i] = 0;
          continue;
        }
        const pIdx = i * 3;
        this.breathPositions[pIdx] += this.breathVelocities[pIdx] * dt;
        this.breathPositions[pIdx + 1] += this.breathVelocities[pIdx + 1] * dt;
        this.breathPositions[pIdx + 2] += this.breathVelocities[pIdx + 2] * dt;
        this.breathVelocities[pIdx] *= 1 - dt * 1.4;
        this.breathVelocities[pIdx + 2] *= 1 - dt * 1.4;
        const normAge = age / maxA;
        this.breathSizes[i] = 24 + normAge * 58;
        this.breathAlphas[i] = Math.sin(normAge * Math.PI) * 0.24 * this.coldIntensity;
      }
      this.breathGeo.attributes.position.needsUpdate = true;
      (this.breathGeo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
      (this.breathGeo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    }

    // Distant Forest Wildlife & Aquatic Surface Animals (Deer, Fox, Turtles & Sparkling Jumping Fish)
    this.wildlife.update(
      dt,
      this.elapsed,
      this.weather,
      nightFactor,
      (rx, rz, strength) => {
        this.water.addRipple(rx, rz, strength);
      },
      (wx, wz) => this.water.getSurfaceHeightAt(wx, wz),
      (sx, sz, intensity) => {
        this.water.spawnSplash(sx, sz, intensity);
      },
    );

    const effectiveWindMult = Math.max(0.25, windSpeedKmh / 10);

    this._skyMoodPayload.moonSize = this.smoothMoonSize;
    this._skyMoodPayload.starDensity = this.smoothStarDensity;
    this._skyMoodPayload.auroraStrength = this.smoothAuroraStrength;

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
      this._skyMoodPayload,
    );

    this._waterNightPayload.nightFactor = nightFactor;
    this._waterNightPayload.moonSize = this.smoothMoonSize;
    this._waterNightPayload.moonReflBoost = this.smoothMoonReflBoost;
    this._waterNightPayload.starReflStrength = this.smoothStarReflBoost;
    this._waterNightPayload.auroraStrength = this.smoothAuroraStrength;
    this._waterNightPayload.cloudCover = THREE.MathUtils.clamp(cloudDensity, 0, 1);

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
      this._waterNightPayload,
    );

    const isOnBoatAudio = this.boatSystem.isOnBoat();
    this.boatSystem.getBoatPosition(this._boatWorldPos);
    let rawBoatSpeed = 0;
    if (isOnBoatAudio && this._hasPrevBoatAudioPos && dt > 0.0001) {
      const dx = this._boatWorldPos.x - this._prevBoatAudioPos.x;
      const dz = this._boatWorldPos.z - this._prevBoatAudioPos.z;
      rawBoatSpeed = Math.hypot(dx, dz) / dt;
    }
    this._prevBoatAudioPos.copy(this._boatWorldPos);
    this._hasPrevBoatAudioPos = true;
    this.smoothBoatSpeedNorm = THREE.MathUtils.damp(
      this.smoothBoatSpeedNorm,
      THREE.MathUtils.clamp(rawBoatSpeed / 5.5, 0, 1),
      4.5,
      dt,
    );

    const playerX = isOnBoatAudio ? this._boatWorldPos.x : 0;
    const playerZ = isOnBoatAudio ? this._boatWorldPos.z : 2.3;
    const depthHere = Math.max(0.5, -groundHeightAt(playerX, playerZ));
    // Open center lake around (0, -44) -> shoreProximity = 0; wooden pier / shoreline -> shoreProximity = 1
    const distFromCenter = Math.hypot(playerX / 62, (playerZ + 44) / 40);
    const shoreProx = isOnBoatAudio
      ? THREE.MathUtils.clamp(0.15 + Math.max(0, distFromCenter - 0.35) * 1.15 - (depthHere - 2.0) * 0.05, 0.08, 0.88)
      : 1.0;

    let nearCaveOrRock = 0;
    for (const info of this.poiSystem.getPoiInfos()) {
      if (info.definition.id === 'hidden_cave' || info.definition.id === 'wrecked_skiff_cove') {
        const dPoi = Math.hypot(info.worldX - playerX, info.worldZ - playerZ);
        if (dPoi < 22) {
          nearCaveOrRock = Math.max(nearCaveOrRock, THREE.MathUtils.clamp(1 - dPoi / 22, 0, 1));
        }
      }
    }

    this._audioLocation.isOnBoat = isOnBoatAudio;
    this._audioLocation.isSailing = this.boatSystem.isSailing();
    this._audioLocation.boatSpeedNorm = this.smoothBoatSpeedNorm;
    this._audioLocation.waterDepthMeters = depthHere;
    this._audioLocation.shoreProximity = shoreProx;
    this._audioLocation.nearCaveOrRock = nearCaveOrRock;

    this.sound.updateAmbience(this.weather, this.timeOfDay, this.elapsed, windSpeedKmh, this._audioLocation);

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

    // Keyboard look (Arrows always look; WASD steers boat when on boat & idle, or looks when on pier)
    const onBoat = this.boatSystem.isOnBoat();
    const rigYawNow = onBoat ? this.boatSystem.getBoatYaw() : 0;
    const canSteerBoat = onBoat && this.phase === 'idle';
    const lookSpeed = 1.45 * dt;

    let yawDeltaInput = 0;
    if (this.keyState['ArrowLeft'] || (!canSteerBoat && this.keyState['KeyA'])) yawDeltaInput += lookSpeed;
    if (this.keyState['ArrowRight'] || (!canSteerBoat && this.keyState['KeyD'])) yawDeltaInput -= lookSpeed;
    if (yawDeltaInput !== 0) {
      const nextYaw = this.targetYaw + yawDeltaInput;
      const rel = Math.atan2(Math.sin(nextYaw - rigYawNow), Math.cos(nextYaw - rigYawNow));
      this.targetYaw = rigYawNow + THREE.MathUtils.clamp(rel, -2.55, 2.55);
    }

    if (this.keyState['ArrowUp'] || (!canSteerBoat && this.keyState['KeyW'])) {
      this.targetPitch = THREE.MathUtils.clamp(this.targetPitch + lookSpeed, -1.25, 0.85);
    }
    if (this.keyState['ArrowDown'] || (!canSteerBoat && this.keyState['KeyS'])) {
      this.targetPitch = THREE.MathUtils.clamp(this.targetPitch - lookSpeed, -1.25, 0.85);
    }

    // Free-roam boat steering (W/S/A/D when on boat & idle + UI Helm buttons)
    let kbForward = 0;
    let kbTurn = 0;
    if (canSteerBoat) {
      if (this.keyState['KeyW']) kbForward += 1;
      if (this.keyState['KeyS']) kbForward -= 1;
      if (this.keyState['KeyA']) kbTurn += 1;
      if (this.keyState['KeyD']) kbTurn -= 1;
    }
    const totalFwd = this.phase === 'idle' ? THREE.MathUtils.clamp(kbForward + this.uiSteerForward, -1, 1) : 0;
    const totalTurn = this.phase === 'idle' ? THREE.MathUtils.clamp(kbTurn + this.uiSteerTurn, -1, 1) : 0;
    this.boatSystem.setSteerInput(totalFwd, totalTurn);

    const { nightFactor, windSpeedKmh, conditionLabel } = this.updateAtmosphere(dt);

    // Update Boat Buoyancy & Sailing Navigation
    this.boatSystem.getBoatPosition(this._boatWorldPos);
    const waterDepthAtBoat = Math.max(0.2, -groundHeightAt(this._boatWorldPos.x, this._boatWorldPos.z));
    const boatResult = this.boatSystem.update({
      dt,
      elapsed: this.elapsed,
      windSpeedKmh,
      nightFactor,
      coldSnowFactor: this.coldIntensity,
      waterDepthAtBoat,
      getWaterSurfaceY: (wx, wz) => this.water.getSurfaceHeightAt(wx, wz),
      onRipple: (rx, rz, str) => this.water.addRipple(rx, rz, str),
      onSplash: (sx, sz, inten) => this.water.spawnSplash(sx, sz, inten),
    });

    // Update Lake Points of Interest (POIs) & Check Boat Exploration Discovery
    this.boatSystem.getBoatPosition(this._boatWorldPos);
    const poiResult = this.poiSystem.update({
      dt,
      elapsed: this.elapsed,
      nightFactor,
      coldSnowFactor: this.coldIntensity,
      boatPos: this._boatWorldPos,
      isOnBoat: this.boatSystem.isOnBoat(),
      onRipple: (rx, rz, str) => this.water.addRipple(rx, rz, str),
    });

    if (poiResult.newlyDiscoveredId) {
      const poiInfo = this.poiSystem.getPoiInfos().find((p) => p.definition.id === poiResult.newlyDiscoveredId);
      if (poiInfo) {
        const def = poiInfo.definition;
        this.discoveredPois = {
          ...this.discoveredPois,
          [def.id]: formatHourToClock(this.timeOfDay),
        };
        saveDiscoveredPois(this.discoveredPois);
        this.applyXpGain(def.xpReward);
        this.sound.playDiscoveryChime();
        this.water.spawnSplash(this._boatWorldPos.x, this._boatWorldPos.z, 1.3);
        this.poiDiscoveredNotice = {
          id: def.id,
          titleAr: def.nameAr,
          storyAr: def.discoveryStoryAr,
          xpReward: def.xpReward,
        };
        this.poiNoticeTimer = 3.0;
        this.statusMessage = `اكتشفت معلماً جديداً: ${def.nameAr}! (+${def.xpReward} XP للاستكشاف)`;
        this.emitHudState(true);
      }
    }

    if (poiResult.nearbyUndiscoveredId) {
      const nearby = this.poiSystem.getPoiInfos().find((p) => p.definition.id === poiResult.nearbyUndiscoveredId);
      this.nearbyPoiName = nearby
        ? `${nearby.definition.mysteryTitleAr} (${Math.round(poiResult.nearbyDistance)} م)`
        : null;
    } else {
      this.nearbyPoiName = null;
    }

    if (boatResult.arrivedSpotId) {
      this.sound.playSplash(0.5);
      if (boatResult.arrivedSpotId === 'free_roam') {
        this.statusMessage = 'وصل القارب إلى المعلم المختار — استعد لرمي الصنارة أو التجول بالجوار!';
      } else {
        const spot = LAKE_ANCHOR_SPOTS.find((s) => s.id === boatResult.arrivedSpotId);
        if (spot) {
          this.statusMessage =
            spot.id === 'pier'
              ? 'رسا القارب بجانب الرصيف — مرحباً بك على الشاطئ!'
              : `رسا القارب في ${spot.nameAr} (عمق ${spot.waterDepthMeters}م) — ارمِ الصنارة في الأعماق!`;
        }
      }
      this.emitHudState(true);
    }

    const isOnBoatNow = this.boatSystem.isOnBoat();
    const rigYaw = isOnBoatNow ? this.boatSystem.getBoatYaw() : 0;
    if (isOnBoatNow) {
      const yawDelta = Math.atan2(Math.sin(rigYaw - this.prevBoatYaw), Math.cos(rigYaw - this.prevBoatYaw));
      this.targetYaw += yawDelta;
      this.currentYaw += yawDelta;
      this.boatSystem.getPlayerRigOffset(this._playerAnchorOffset);
    } else {
      this._playerAnchorOffset.set(0, 0, 0);
    }
    this.prevBoatYaw = rigYaw;

    const { pitch: boatPitch, roll: boatRoll } = this.boatSystem.getBoatPitchRoll();
    this.dockRig.setPlayerRigTransform(this._playerAnchorOffset, boatPitch, boatRoll, rigYaw);

    // Damped seated camera orientation + tiny natural breathing sway (tracks pier OR boat)
    this.currentYaw = THREE.MathUtils.damp(this.currentYaw, this.targetYaw, 10, dt);
    this.currentPitch = THREE.MathUtils.damp(this.currentPitch, this.targetPitch, 10, dt);

    const headBob = Math.sin(this.elapsed * 1.45) * 0.005;
    this._seatedPos.set(
      this._playerAnchorOffset.x - Math.sin(rigYaw) * 0.02,
      1.76 + headBob + this._playerAnchorOffset.y,
      2.30 + this._playerAnchorOffset.z - Math.cos(rigYaw) * 0.02,
    );
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

    // Perching Lakeside Bird (periodically swoops in to land on boat gunwale or wooden pier, flutters, then flies off)
    this.perchingBird.update({
      dt,
      elapsed: this.elapsed,
      weather: this.weather,
      nightFactor,
      cinematicActive: shouldCinematic,
      isOnBoat: isOnBoatNow,
      boatRoot: this.boatSystem.boatRoot,
      boatYaw: rigYaw,
      boatMovingFast: this.boatSystem.isSailing() || Math.abs(totalFwd) > 0.45,
      onBirdChirp: (pan) => this.sound.playCloseBirdChirp(pan),
      onWingFlutter: (pan) => this.sound.playWingFlutter(pan),
    });

    this.cinematicBlend = THREE.MathUtils.damp(
      this.cinematicBlend,
      shouldCinematic ? 1 : 0,
      shouldCinematic ? 1.15 : 2.8,
      dt,
    );

    if (this.cinematicBlend > 0.002) {
      this.cinematicTime += dt;
      const t = this.cinematicTime;
      const theta = Math.PI * 0.5 + t * 0.105;
      const rx = 38 + Math.sin(t * 0.19) * 8.0;
      const rz = 26 + Math.cos(t * 0.16) * 5.0;
      const cx = Math.cos(theta) * rx;
      const cz = -40 + Math.sin(theta) * rz;
      const groundY = Math.max(0, groundHeightAt(cx, cz));
      const cy = Math.max(groundY + 2.4, 4.2 + Math.sin(t * 0.24) * 2.2 + Math.cos(t * 0.11) * 1.1);

      this._cinePos.set(cx, cy, cz);
      this._cineTarget.set(
        Math.sin(t * 0.17) * 16.0,
        2.5 + Math.sin(t * 0.21) * 1.15,
        -40 + Math.cos(t * 0.13) * 12.0,
      );
      this._lookMatrix.lookAt(this._cinePos, this._cineTarget, this._camUp);
      this._cineQuat.setFromRotationMatrix(this._lookMatrix);

      this.camera.position.lerpVectors(this._seatedPos, this._cinePos, this.cinematicBlend);
      this.camera.quaternion.slerpQuaternions(this._seatedQuat, this._cineQuat, this.cinematicBlend);
    } else {
      this.camera.position.copy(this._seatedPos);
      this.camera.quaternion.copy(this._seatedQuat);
    }

    // Note: atmosphere was updated before camera/boat sync above

    // Clear timed notices
    if (this.lineSnapTimer > 0) {
      this.lineSnapTimer -= dt;
      if (this.lineSnapTimer <= 0) this.lineSnappedNotice = null;
    }
    if (this.unlockNoticeTimer > 0) {
      this.unlockNoticeTimer -= dt;
      if (this.unlockNoticeTimer <= 0) this.newlyUnlockedNotice = null;
    }
    if (this.challengeNoticeTimer > 0) {
      this.challengeNoticeTimer -= dt;
      if (this.challengeNoticeTimer <= 0) this.challengeCompletedNotice = null;
    }
    if (this.rivalNoticeTimer > 0) {
      this.rivalNoticeTimer -= dt;
      if (this.rivalNoticeTimer <= 0) this.rivalNotice = null;
    }
    if (this.recordNoticeTimer > 0) {
      this.recordNoticeTimer -= dt;
      if (this.recordNoticeTimer <= 0) this.recordBrokenNotice = null;
    }
    if (this.poiNoticeTimer > 0) {
      this.poiNoticeTimer -= dt;
      if (this.poiNoticeTimer <= 0) this.poiDiscoveredNotice = null;
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
          alpine_abyss: 'أعماق وسط البحيرة',
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
      this.getPlayerLandingAnchor(this._landingPoint);
      const dockPos = this._toDock.copy(this._landingPoint).sub(f.position);
      const distToDock = Math.hypot(f.position.x - this._landingPoint.x, f.position.z - this._landingPoint.z);
      dockPos.y = 0;
      if (distToDock > 0.01) dockPos.divideScalar(distToDock);

      // Perpendicular dart direction
      this._rightVec.set(-dockPos.z, 0, dockPos.x).multiplyScalar(f.surgeDir);

      const heavyLoadMult = 1 + this.heavyFishFactor * 0.36;
      const fightForce =
        f.species.fightStrength *
        (isSurging ? 1.35 : 0.55) *
        (0.45 + f.stamina * 0.55) *
        heavyLoadMult;

      if (this.reelHeld) {
        this.sound.playReelTick(this.elapsed);
        const pullSpeed = 3.2 * reelSkill - fightForce * 1.15;
        f.position.addScaledVector(dockPos, Math.max(0.42, pullSpeed) * dt);
        f.position.addScaledVector(this._rightVec, fightForce * 1.15 * dt);
        f.stamina = Math.max(0, f.stamina - (dt * 0.22 * reelSkill) / (1 + this.heavyFishFactor * 0.25));

        const tensionGain = (0.34 + fightForce * 0.58) / (hookDef.tensionTolerance * strengthSkill);
        this.lineTension = Math.min(1.05, this.lineTension + tensionGain * dt);
      } else {
        // Letting line breathe reduces tension while heavy fish still pulls out slowly
        f.position.addScaledVector(dockPos, -fightForce * 1.1 * dt);
        f.position.addScaledVector(this._rightVec, fightForce * 1.65 * dt);
        f.stamina = Math.max(0, f.stamina - dt * 0.06);
        this.lineTension = Math.max(0.12 + this.heavyFishFactor * 0.12, this.lineTension - dt * 0.55);
      }

      // Trigger dramatic surface splash as hooked fish is pulled within 7m (fish remains permanently visible underwater)
      f.mesh.visible = true;
      if (distToDock <= 7.0 && this.crocSurfaceSplashPending) {
        this.crocSurfaceSplashPending = false;
        this.sound.playSplash(1.0);
        this.water.spawnSplash(f.position.x, f.position.z, 1.35);
      }

      // Clamp hooked fish inside deepened lake water basin (up to ~12m)
      const bedY = groundHeightAt(f.position.x, f.position.z);
      f.position.y = THREE.MathUtils.clamp(f.position.y, Math.max(bedY + 0.22, -11.0), distToDock <= 7.0 ? -0.14 : -0.35);
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
        this.lineSnappedNotice = 'انقطع الخيط بسبب الشد الزائد! خفّف السحب عند الاحمرار.';
        this.lineSnapTimer = 3.0;
        this.resetToIdle('انقطع الخيط! اضغط للرمي مجدداً');
      } else if (distToDock <= 2.9) {
        this.completeCatch(f);
      }
    } else if (this.phase === 'caught' && this.hookedFish) {
      const f = this.hookedFish;
      f.mesh.visible = true;

      // Smoothly lift fish from water up into an unobstructed close-up showcase in front of the fisherman (pier or boat)
      const rigYaw = this.boatSystem.isOnBoat() ? this.boatSystem.getBoatYaw() : 0;
      const cosY = Math.cos(rigYaw);
      const sinY = Math.sin(rigYaw);
      const localX = -0.22;
      const localZ = -1.38; // 1.38m ahead of seat pivot (2.30 - 1.38 = 0.92 on pier)
      const seatWorldX = this._playerAnchorOffset.x;
      const seatWorldZ = 2.30 + this._playerAnchorOffset.z;
      const targetX = seatWorldX + localX * cosY + localZ * sinY;
      const targetY = 1.62 + this._playerAnchorOffset.y + Math.sin(this.elapsed * 2.1) * 0.024;
      const targetZ = seatWorldZ - localX * sinY + localZ * cosY;
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

    // Update falling water droplets from caught fish & keepnet drop animation
    this.fishDripAndKeepnet.update({
      dt,
      elapsed: this.elapsed,
      isCaughtShowcase: this.phase === 'caught' && this.hookedFish !== null,
      fishWorldPos: this.hookedFish ? this.hookedFish.position : null,
      fishYaw: this.catchInspectAngle,
      fishScale: this.hookedFish ? this.hookedFish.mesh.scale.x : 1.0,
      isOnBoat: isOnBoatNow,
      boatRoot: this.boatSystem.boatRoot,
      getWaterSurfaceY: (wx, wz) => this.water.getSurfaceHeightAt(wx, wz),
      onWaterRipple: (rx, rz, str) => this.water.addRipple(rx, rz, str),
      onWaterDripSound: (pan, inten) => this.sound.playWaterDrip(pan, inten),
      onKeepnetDropSound: (pan) => this.sound.playKeepnetDrop(pan),
    });

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
    const boatDef = BOAT_CATALOG.find((b) => b.level === this.progression.boatLevel) ?? BOAT_CATALOG[0];
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
      rareAttractionBonus: this.boatSystem.isOnBoat() ? boatDef.rareAttractionBonus : 1.0,
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

    // Update Crocodiles, Frogs & Rival Anglers Tug-of-War
    this.getPlayerLandingAnchor(this._landingPoint);
    const activeReelingFish = this.phase === 'reeling' && this.hookedFish ? this.hookedFish : null;
    const hookedDist = activeReelingFish
      ? Math.hypot(activeReelingFish.position.x - this._landingPoint.x, activeReelingFish.position.z - this._landingPoint.z)
      : 999;

    const rivalTargets = this.rivalAnglers.getActiveFishTargets();
    const crocResult = this.crocsAndFrogs.update({
      dt,
      elapsed: this.elapsed,
      weather: this.weather,
      nightFactor,
      hookedFishPos: activeReelingFish ? activeReelingFish.position : null,
      hookedFishDistToDock: hookedDist,
      playerReeling: this.reelHeld,
      rivalFishTargets: rivalTargets,
      getWaterSurfaceY: (wx, wz) => this.water.getSurfaceHeightAt(wx, wz),
      onRipple: (rx, rz, str) => this.water.addRipple(rx, rz, str),
      onSplash: (sx, sz, inten) => this.water.spawnSplash(sx, sz, inten),
      onCrocSnap: () => this.sound.playCrocSnap(),
      onFrogCroak: (pan) => this.sound.playFrogCroak(pan),
    });

    for (const rIdx of crocResult.devouredRivalIndices) {
      // Visual 3D crocodile lunge & splash happens directly on the lake without popping text banners
      this.rivalAnglers.devourRivalFish(rIdx);
    }

    this.crocThreatActive = crocResult.threatActive;
    this.crocDistanceMeters = crocResult.distanceToFish;
    if (crocResult.threatActive && crocResult.distanceToFish < 7.0) {
      this.crocCloseEscape = true;
    }
    if (crocResult.devoured && activeReelingFish) {
      this.fishSystem.consumeHookedFish();
      this.hookedFish = null;
      this.lineSnappedNotice = 'التهم التمساح السمكة! اسحب بسرعة أكبر قبل اقترابه.';
      this.lineSnapTimer = 3.0;
      this.resetToIdle('التهم التمساح السمكة! ارمِ الصنارة من جديد');
    }

    const reelSkillFactor = 1 + (this.progression.skills.reelSpeed - 1) * 0.14;
    const stillReelingFish = this.phase === 'reeling' && this.hookedFish ? this.hookedFish : null;
    const stillHookedDist = stillReelingFish
      ? Math.hypot(stillReelingFish.position.x - this._landingPoint.x, stillReelingFish.position.z - this._landingPoint.z)
      : 999;

    const rivalResult = this.rivalAnglers.update({
      dt,
      elapsed: this.elapsed,
      hookedFishPos: stillReelingFish ? stillReelingFish.position : null,
      hookedFishDistToDock: stillHookedDist,
      playerReeling: this.reelHeld,
      reelSkillFactor,
      getWaterSurfaceY: (wx, wz) => this.water.getSurfaceHeightAt(wx, wz),
      onRipple: (rx, rz, str) => this.water.addRipple(rx, rz, str),
      onSplash: (sx, sz, inten) => this.water.spawnSplash(sx, sz, inten),
    });

    this.rivalContestActive = rivalResult.contestActive;
    this.rivalName = rivalResult.rivalName;
    this.rivalContestBalance = rivalResult.contestBalance;

    if (rivalResult.justStarted && rivalResult.rivalName) {
      this.rivalNotice = `اشتبك ${rivalResult.rivalName} على نفس السمكة! اسحب بقوة!`;
      this.rivalNoticeTimer = 3.0;
    }
    if (rivalResult.contestActive && stillReelingFish) {
      stillReelingFish.position.x += rivalResult.pullVectorX * dt;
      stillReelingFish.position.z += rivalResult.pullVectorZ * dt;
      stillReelingFish.mesh.position.copy(stillReelingFish.position);
    }
    if (rivalResult.justWon) {
      this.rivalWonThisCatch = true;
      this.rivalNotice = 'حسمت صراع السحب ضد المنافس! (+50 XP)';
      this.rivalNoticeTimer = 3.0;
    } else if (rivalResult.justStolen && stillReelingFish) {
      this.fishSystem.consumeHookedFish();
      this.hookedFish = null;
      this.rivalNotice = 'خطف الصياد المنافس السمكة في صراع السحب!';
      this.rivalNoticeTimer = 3.0;
      this.resetToIdle('فاز المنافس بالسمكة! ارمِ الصنارة في نقطة أخرى');
    }

    // Main player's ~3.25s short close-up video placing caught fish into their woven basket ("السبت")
    if (this.playerCutawayTimer > 0 && this.phase === 'idle' && !this.boatSystem.isSailing()) {
      this.playerCutawayTimer = Math.max(0, this.playerCutawayTimer - dt);
      this.lastActivityTime = this.elapsed;
    } else if (this.playerCutawayTimer > 0) {
      this.playerCutawayTimer = 0;
      this.playerCutawaySpeciesName = null;
    }

    const playerCutawayActiveNow = this.playerCutawayTimer > 0;
    if (playerCutawayActiveNow !== this.playerCutawayWasActive) {
      this.playerCutawayWasActive = playerCutawayActiveNow;
      this.emitHudState(true);
    }

    this.playerCutawayBlend = THREE.MathUtils.damp(
      this.playerCutawayBlend,
      playerCutawayActiveNow ? 1 : 0,
      playerCutawayActiveNow ? 5.2 : 4.5,
      dt,
    );

    // Short ~4-second live focus cutaway when Abu Ali lifts his catch off the hook & drops it in his basket
    if (this.rivalCutawayCooldown > 0) {
      this.rivalCutawayCooldown = Math.max(0, this.rivalCutawayCooldown - dt);
    }
    const playerAvailableForCutaway =
      (this.phase === 'idle' || this.phase === 'waiting') &&
      !this.isDragging &&
      !this.pointerDown &&
      !this.boatSystem.isSailing() &&
      !this.cinematicManualActive &&
      this.playerCutawayTimer <= 0;

    if (rivalResult.abuAliCutaway.justStarted && playerAvailableForCutaway && this.rivalCutawayCooldown <= 0) {
      this.rivalCutawayTimer = 4.0;
      this.rivalCutawayCooldown = 14.0;
      this.rivalCutawaySpeciesName = rivalResult.abuAliCutaway.speciesNameAr;
    }

    if (
      this.rivalCutawayTimer > 0 &&
      rivalResult.abuAliCutaway.active &&
      (this.phase === 'idle' || this.phase === 'waiting') &&
      this.playerCutawayTimer <= 0
    ) {
      this.rivalCutawayTimer = Math.max(0, this.rivalCutawayTimer - dt);
      this.rivalCutawaySpeciesName = rivalResult.abuAliCutaway.speciesNameAr;
    } else if (this.rivalCutawayTimer > 0) {
      this.rivalCutawayTimer = 0;
      this.rivalCutawaySpeciesName = null;
    }

    const cutawayActiveNow = this.rivalCutawayTimer > 0;
    if (cutawayActiveNow !== this.rivalCutawayWasActive) {
      this.rivalCutawayWasActive = cutawayActiveNow;
      this.emitHudState(true);
    }

    this.rivalCutawayBlend = THREE.MathUtils.damp(
      this.rivalCutawayBlend,
      cutawayActiveNow ? 1 : 0,
      cutawayActiveNow ? 4.2 : 5.2,
      dt,
    );
    if (this.playerCutawayBlend > 0.002) {
      this.fishDripAndKeepnet.getCutawayPose(
        isOnBoatNow,
        this.boatSystem.boatRoot,
        this._playerCutCamPos,
        this._playerCutLookAt,
      );
      this._lookMatrix.lookAt(this._playerCutCamPos, this._playerCutLookAt, this._camUp);
      this._playerCutQuat.setFromRotationMatrix(this._lookMatrix);
      this.camera.position.lerp(this._playerCutCamPos, this.playerCutawayBlend);
      this.camera.quaternion.slerp(this._playerCutQuat, this.playerCutawayBlend);
    } else if (this.rivalCutawayBlend > 0.002) {
      this._lookMatrix.lookAt(rivalResult.abuAliCutaway.camPos, rivalResult.abuAliCutaway.lookAt, this._camUp);
      this._rivalCamQuat.setFromRotationMatrix(this._lookMatrix);
      this.camera.position.lerp(rivalResult.abuAliCutaway.camPos, this.rivalCutawayBlend);
      this.camera.quaternion.slerp(this._rivalCamQuat, this.rivalCutawayBlend);
    }

    const rigYawForRod = this.boatSystem.isOnBoat() ? this.boatSystem.getBoatYaw() : 0;
    const relRodYaw = Math.atan2(Math.sin(this.currentYaw - rigYawForRod), Math.cos(this.currentYaw - rigYawForRod));

    this.dockRig.updateRodAndLine({
      elapsed: this.elapsed,
      castBackAngle: this.phase === 'charging' ? this.castPower : 0,
      rodBend: this.rodBend,
      rodYawOffset: THREE.MathUtils.clamp(relRodYaw * 0.45, -0.55, 0.55),
      bobberPos: this.bobberPos,
      lurePos: this.lurePos,
      bobberVisible,
      reeling: this.phase === 'reeling' && this.reelHeld,
      nightFactor,
      windStrength: windSpeedKmh / 12,
      coldSnowFactor: this.coldIntensity,
      lineTension: this.lineTension,
      heavyFishFactor: this.phase === 'reeling' ? this.heavyFishFactor : 0,
    });

    // Periodic HUD refresh (15 Hz smooth meters without React spam)
    if (this.elapsed - this.lastHudEmit > 0.065) {
      this.emitHudState(false, windSpeedKmh, conditionLabel);
    }

    if (this.composer) {
      this.composer.render();
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

    this.getPlayerLandingAnchor(this._landingPoint);
    const playerDepthX = this.boatSystem.isOnBoat() ? this._boatWorldPos.x : 0;
    const playerDepthZ = this.boatSystem.isOnBoat() ? this._boatWorldPos.z : 2.3;
    const waterDepthUnderPlayer = Math.max(0.5, Number((-groundHeightAt(playerDepthX, playerDepthZ)).toFixed(1)));

    const poisHud: PoiHudItem[] = this.poiSystem.getPoiInfos().map((info) => {
      const dx = info.worldX - playerDepthX;
      const dz = info.worldZ - playerDepthZ;
      return {
        ...info.definition,
        discovered: info.discovered || Boolean(this.discoveredPois[info.definition.id]),
        discoveredAt: this.discoveredPois[info.definition.id],
        distanceMeters: Math.round(Math.hypot(dx, dz)),
        bearingLabelAr: formatArabicCompassBearing(dx, dz),
        worldX: info.worldX,
        worldZ: info.worldZ,
      };
    });

    this.onHudUpdate({
      phase: this.phase,
      castPower: this.castPower,
      lineTension: this.lineTension,
      fishDistance: this.hookedFish
        ? Math.max(
            0,
            Number(
              Math.hypot(
                this.hookedFish.position.x - this._landingPoint.x,
                this.hookedFish.position.z - this._landingPoint.z,
              ).toFixed(1),
            ),
          )
        : 0,
      fishStamina: this.hookedFish ? this.hookedFish.stamina : 0,
      biteUrgency: biting ? THREE.MathUtils.clamp(biting.stateTimer / 2.4, 0, 1) : 0,
      hookedSpeciesName: this.hookedFish ? this.hookedFish.species.nameAr : null,
      statusMessage: this.statusMessage,
      timeOfDay: this.timeOfDay,
      timePreset: getPresetFromHour(this.timeOfDay),
      autoTimeCycle: this.autoTimeCycle,
      nightReflectionMood: this.nightReflectionMood,
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
      dailyChallenges: this.dailyChallenges,
      challengeCompletedNotice: this.challengeCompletedNotice,
      coldIntensity: this.coldIntensity,
      crocThreatActive: this.crocThreatActive,
      crocDistanceMeters: Number(this.crocDistanceMeters.toFixed(1)),
      rivalContestActive: this.rivalContestActive,
      rivalName: this.rivalName,
      rivalContestBalance: this.rivalContestBalance,
      rivalNotice: this.rivalNotice,
      rivalCutawayActive: this.rivalCutawayTimer > 0 || this.rivalCutawayBlend > 0.08,
      rivalCutawaySpeciesName: this.rivalCutawaySpeciesName,
      playerBasketCutawayActive: this.playerCutawayTimer > 0 || this.playerCutawayBlend > 0.08,
      playerBasketCutawaySpeciesName: this.playerCutawaySpeciesName,
      speciesRecords: this.speciesRecords,
      recordBrokenNotice: this.recordBrokenNotice,
      isHeavyHookedFish: this.phase === 'reeling' && this.isHeavyHookedFish,
      heavyFishStress: this.phase === 'reeling' ? THREE.MathUtils.clamp(Math.max(this.lineTension, this.heavyFishFactor * 0.68), 0, 1) : 0,
      currentLocationId: this.boatSystem.getCurrentLocationId(),
      isOnBoat: this.boatSystem.isOnBoat(),
      isSailing: this.boatSystem.isSailing(),
      waterDepthUnderPlayer,
      pois: poisHud,
      poiDiscoveredNotice: this.poiDiscoveredNotice,
      nearbyPoiName: this.nearbyPoiName,
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
    this.boatSystem.dispose();
    this.poiSystem.dispose();
    this.wildlife.dispose();
    this.perchingBird.dispose();
    this.fishDripAndKeepnet.dispose();
    this.crocsAndFrogs.dispose();
    this.rivalAnglers.dispose();
    this.textures.dispose();
    this.rainGeo.dispose();
    this.rainMat.dispose();
    this.fireflyGeo.dispose();
    this.fireflyMat.dispose();
    this.pollenGeo.dispose();
    this.pollenMat.dispose();
    this.breathGeo.dispose();
    this.breathMat.dispose();
    this.pmremEnv.dispose();
    this.bloomPass?.dispose();
    this.composer?.dispose();
    this.renderer.dispose();

    if (dom.parentElement === this.container) {
      this.container.removeChild(dom);
    }
  }
}
