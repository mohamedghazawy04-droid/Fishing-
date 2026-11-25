import { useEffect, useRef, useState } from 'react';
import { FishingHUD } from './components/FishingHUD';
import { FishingSceneManager } from './three/FishingSceneManager';
import type { FishingHudState } from './types/fishing';

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
  season: 'spring',
  weather: 'clear',
  autoWeather: true,
  windSpeedKmh: 7,
  autoWind: true,
  fishingConditionLabel: 'صافٍ · رؤية واضحة لقاع البحيرة',
  soundMuted: false,
  ambienceMix: { water: 0.78, trees: 0.72, birds: 0.75 },
  cinematicActive: false,
  cinematicAutoEnabled: true,
  fishVisibleCount: 21,
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
  quests: [],
  questNotice: null,
  graphicsQuality: 'ultra',
  graphicsLocked: false,
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
          onSetGraphicsQuality={(q) => managerRef.current?.setGraphicsQuality(q)}
          onUpgradeSkill={(k) => managerRef.current?.upgradeSkill(k)}
          onResolveCatch={(rel) => managerRef.current?.resolveActiveCatch(rel)}
        />
      )}
      <div
        dir="ltr"
        className="pointer-events-none select-none fixed top-0.5 left-3 z-30 text-[10px] leading-3 tracking-[0.14em] text-white/40"
        style={{ textShadow: '0 1px 3px rgba(0,0,0,0.55)' }}
      >
        inspired by eman elshemy
      </div>
    </main>
  );
}
