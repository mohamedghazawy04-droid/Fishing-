import { useEffect, useRef, useState } from 'react';
import { FishingHUD } from './components/FishingHUD';
import { FishingSceneManager } from './three/FishingSceneManager';
import {
  generateDailyChallenges,
  getTodayDateKey,
  type FishingHudState,
} from './types/fishing';

const INITIAL_DATE_KEY = getTodayDateKey();

const INITIAL_HUD: FishingHudState = {
  phase: 'idle',
  castPower: 0,
  lineTension: 0,
  fishDistance: 0,
  fishStamina: 0,
  biteUrgency: 0,
  hookedSpeciesName: null,
  statusMessage: 'جاري تهيئة البحيرة الجبلية...',
  timeOfDay: 8.8,
  timePreset: 'morning',
  autoTimeCycle: true,
  nightReflectionMood: 'auto',
  season: 'spring',
  weather: 'clear',
  autoWeather: true,
  windSpeedKmh: 7,
  autoWind: true,
  fishingConditionLabel: 'صافٍ · رؤية واضحة لقاع البحيرة',
  soundMuted: false,
  ambienceMix: { water: 0.78, trees: 0.72, birds: 0.75, frogs: 0.76 },
  cinematicActive: false,
  cinematicAutoEnabled: true,
  fishVisibleCount: 26,
  selectedBait: 'worm',
  selectedHook: 'barbed_steel',
  lineDepthMeters: 1.4,
  currentCastZone: null,
  activeCatch: null,
  catchHistory: [],
  lineSnappedNotice: null,
  progression: {
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
  },
  newlyUnlockedNotice: null,
  dailyChallenges: {
    dateKey: INITIAL_DATE_KEY,
    challenges: generateDailyChallenges(INITIAL_DATE_KEY, ['worm', 'fly']),
    completedTotal: 0,
  },
  challengeCompletedNotice: null,
  coldIntensity: 0,
  crocThreatActive: false,
  crocDistanceMeters: 999,
  rivalContestActive: false,
  rivalName: null,
  rivalContestBalance: 0.56,
  rivalNotice: null,
  rivalCutawayActive: false,
  rivalCutawaySpeciesName: null,
  playerBasketCutawayActive: false,
  playerBasketCutawaySpeciesName: null,
  speciesRecords: {},
  recordBrokenNotice: null,
  isHeavyHookedFish: false,
  heavyFishStress: 0,
  currentLocationId: 'pier',
  isOnBoat: false,
  isSailing: false,
  isSwimming: false,
  waterDepthUnderPlayer: 1.4,
  pois: [],
  poiDiscoveredNotice: null,
  nearbyPoiName: null,
};

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const managerRef = useRef<FishingSceneManager | null>(null);
  const [hud, setHud] = useState<FishingHudState>(INITIAL_HUD);
  const [webglError, setWebglError] = useState(false);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    try {
      const manager = new FishingSceneManager(container, (nextState) => {
        setHud(nextState);
      });
      managerRef.current = manager;
      return () => {
        manager.dispose();
        managerRef.current = null;
      };
    } catch {
      setWebglError(true);
    }
  }, []);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#0b1316]">
      <div
        ref={mountRef}
        className="w-full h-full cursor-grab active:cursor-grabbing touch-none select-none"
        aria-label="مشهد الصيد ثلاثي الأبعاد"
      />

      {webglError ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1316] p-6 text-center">
          <div className="max-w-md rounded-xl border border-white/15 bg-[#101c21] p-6">
            <h2 className="font-display text-lg font-bold text-stone-100 mb-2">تعذر تشغيل الرسوميات ثلاثية الأبعاد</h2>
            <p className="text-sm text-stone-300">
              يرجى التأكد من تفعيل دعم WebGL في المتصفح ثم إعادة تحميل الصفحة للاستمتاع بالبحيرة والجبال.
            </p>
          </div>
        </div>
      ) : (
        <FishingHUD
          hud={hud}
          onPrimaryPress={() => managerRef.current?.handlePrimaryActionPress()}
          onPrimaryRelease={() => managerRef.current?.handlePrimaryActionRelease()}
          onSelectBait={(id) => managerRef.current?.setBait(id)}
          onSelectHook={(id) => managerRef.current?.setHook(id)}
          onSelectDepth={(d) => managerRef.current?.setLineDepth(d)}
          onSelectTimePreset={(id, hr) => managerRef.current?.setTimePreset(id, hr)}
          onSetTimeHour={(hr) => managerRef.current?.setTimeHour(hr)}
          onToggleAutoTime={(en) => managerRef.current?.setAutoTimeCycle(en)}
          onSelectNightMood={(m) => managerRef.current?.setNightReflectionMood(m)}
          onSelectWeather={(w) => managerRef.current?.setWeather(w)}
          onToggleAutoWeather={(en) => managerRef.current?.setAutoWeather(en)}
          onSetWindSpeed={(kmh) => managerRef.current?.setWindSpeed(kmh)}
          onToggleAutoWind={(en) => managerRef.current?.setAutoWind(en)}
          onSelectSeason={(s) => managerRef.current?.setSeason(s)}
          onToggleMute={(m) => managerRef.current?.setSoundMuted(m)}
          onSetAmbienceMix={(mix) => managerRef.current?.setAmbienceMix(mix)}
          onToggleCinematic={() => managerRef.current?.toggleCinematicMode()}
          onToggleCinematicAuto={(en) => managerRef.current?.setCinematicAutoEnabled(en)}
          onResetLook={() => managerRef.current?.lookReset()}
          onUpgradeSkill={(k) => managerRef.current?.upgradeSkill(k)}
          onUpgradeBoat={() => managerRef.current?.upgradeBoat()}
          onSelectLocation={(spotId) => managerRef.current?.selectLakeLocation(spotId)}
          onBoardBoatFreeRoam={() => managerRef.current?.boardBoatFreeRoam()}
          onBoatSteer={(fwd, turn) => managerRef.current?.setBoatSteer(fwd, turn)}
          onToggleSwim={() => managerRef.current?.toggleSwimming()}
          onSwimSteer={(fwd, strafe) => managerRef.current?.setSwimSteer(fwd, strafe)}
          onSailToPoi={(poiId) => managerRef.current?.sailToPoi(poiId)}
          onLookAtPoi={(poiId) => managerRef.current?.lookAtPoi(poiId)}
          onCancelRivalCutaway={() => managerRef.current?.cancelRivalCutaway()}
          onCancelPlayerCutaway={() => managerRef.current?.cancelPlayerCutaway()}
          onResolveCatch={(rel) => managerRef.current?.resolveActiveCatch(rel)}
        />
      )}
    </main>
  );
}
