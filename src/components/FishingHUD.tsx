import React, { useEffect, useRef, useState } from 'react';
import {
  Settings,
  Compass,
  BookOpen,
  X,
  Lock,
  Check,
  ArrowUpRight,
  Radio,
  Film,
  Eye,
  EyeOff,
  Target,
  AlertTriangle,
  Snowflake,
  Swords,
  Trophy,
  Activity,
  Anchor,
  Navigation,
  Waves,
  MapPin,
  Sparkles,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Sailboat,
  Play,
  Pause,
} from 'lucide-react';
import {
  BAIT_CATALOG,
  BOAT_CATALOG,
  FISH_SPECIES,
  HOOK_CATALOG,
  LAKE_ANCHOR_SPOTS,
  LAKE_ZONE_LABELS,
  LIVE_RADIO_STATIONS,
  SEASON_CATALOG,
  SKILL_CATALOG,
  TIME_PRESETS,
  WEATHER_OPTIONS,
  formatHourToClock,
  getNextLevelThreshold,
  getSkillUpgradeCost,
  type AmbienceMix,
  type BaitId,
  type FishSpecies,
  type FishingHudState,
  type HookId,
  type LakeSpotId,
  type LiveRadioStation,
  type PoiId,
  type SeasonId,
  type SkillKey,
  type TimePresetId,
  type WeatherType,
} from '../types/fishing';
import { LiveRadioPlayer, type RadioStatus } from './LiveRadioPlayer';

function hexColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

const FishIllustration: React.FC<{ species: FishSpecies; className?: string }> = ({
  species,
  className = 'w-20 h-11',
}) => {
  const body = hexColor(species.bodyColor);
  const belly = hexColor(species.bellyColor);
  const fin = hexColor(species.finColor);
  const gradId = `fish_grad_${species.id}`;

  return (
    <svg viewBox="0 0 120 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={body} />
          <stop offset="58%" stopColor={body} />
          <stop offset="100%" stopColor={belly} />
        </linearGradient>
      </defs>
      {/* Tail fin */}
      <path d="M26 32 L6 14 L14 32 L6 50 Z" fill={fin} opacity="0.9" />
      {/* Dorsal & anal fins */}
      <path d="M52 16 L66 5 L80 17 Z" fill={fin} opacity="0.88" />
      <path d="M48 45 L58 56 L68 46 Z" fill={fin} opacity="0.85" />
      {/* Main streamlined body */}
      <path
        d="M24 32 C34 15, 76 11, 108 31 C111 33, 111 35, 108 37 C76 53, 34 49, 24 32 Z"
        fill={`url(#${gradId})`}
        stroke="rgba(255,255,255,0.22)"
        strokeWidth="1"
      />
      {/* Species markings */}
      {species.id === 'rainbow_trout' && (
        <path d="M34 31 Q72 28 96 33" stroke="#e4728c" strokeWidth="3.2" fill="none" opacity="0.72" />
      )}
      {species.id === 'lake_perch' && (
        <g stroke="#1b2615" strokeWidth="3" opacity="0.55">
          <line x1="46" y1="21" x2="48" y2="39" />
          <line x1="58" y1="19" x2="60" y2="41" />
          <line x1="70" y1="19" x2="72" y2="41" />
          <line x1="82" y1="21" x2="83" y2="39" />
        </g>
      )}
      {species.id === 'northern_pike' && (
        <g fill="#dde9c8" opacity="0.55">
          <circle cx="48" cy="28" r="2.1" />
          <circle cx="60" cy="33" r="2.2" />
          <circle cx="72" cy="27" r="2" />
          <circle cx="83" cy="33" r="2.1" />
        </g>
      )}
      {/* Pectoral fin */}
      <path d="M74 37 L64 47 L82 43 Z" fill={fin} opacity="0.88" />
      {/* Gill arc & eye */}
      <path d="M88 23 Q83 32 88 41" stroke="rgba(15,20,24,0.45)" strokeWidth="1.6" fill="none" />
      <circle cx="98" cy="29" r="3.4" fill="#e5c878" />
      <circle cx="98.8" cy="29" r="1.9" fill="#0d1014" />
    </svg>
  );
};

interface FishingHUDProps {
  hud: FishingHudState;
  onPrimaryPress: () => void;
  onPrimaryRelease: () => void;
  onSelectBait: (id: BaitId) => void;
  onSelectHook: (id: HookId) => void;
  onSelectDepth: (depth: number) => void;
  onSelectTimePreset: (id: TimePresetId, hour: number) => void;
  onSetTimeHour: (hour: number) => void;
  onToggleAutoTime: (enabled: boolean) => void;
  onSelectWeather: (w: WeatherType) => void;
  onToggleAutoWeather: (enabled: boolean) => void;
  onSetWindSpeed: (kmh: number) => void;
  onToggleAutoWind: (enabled: boolean) => void;
  onSelectSeason: (s: SeasonId) => void;
  onToggleMute: (muted: boolean) => void;
  onSetAmbienceMix: (mix: Partial<AmbienceMix>) => void;
  onToggleCinematic: () => void;
  onToggleCinematicAuto: (enabled: boolean) => void;
  onResetLook: () => void;
  onUpgradeSkill: (key: SkillKey) => void;
  onUpgradeBoat: () => void;
  onSelectLocation: (spotId: LakeSpotId) => void;
  onBoardBoatFreeRoam: () => void;
  onBoatSteer: (forward: number, turn: number) => void;
  onSailToPoi: (poiId: PoiId) => void;
  onLookAtPoi: (poiId: PoiId) => void;
  onResolveCatch: (release: boolean) => void;
}

type SettingsTab =
  | 'fishing'
  | 'boat'
  | 'challenges'
  | 'atmosphere'
  | 'skills'
  | 'radio'
  | 'journal';

export const FishingHUD: React.FC<FishingHUDProps> = ({
  hud,
  onPrimaryPress,
  onPrimaryRelease,
  onSelectBait,
  onSelectHook,
  onSelectDepth,
  onSelectTimePreset,
  onSetTimeHour,
  onToggleAutoTime,
  onSelectWeather,
  onToggleAutoWeather,
  onSetWindSpeed,
  onToggleAutoWind,
  onSelectSeason,
  onToggleMute,
  onSetAmbienceMix,
  onToggleCinematic,
  onToggleCinematicAuto,
  onResetLook,
  onUpgradeSkill,
  onUpgradeBoat,
  onSelectLocation,
  onBoardBoatFreeRoam,
  onBoatSteer,
  onSailToPoi,
  onLookAtPoi,
  onResolveCatch,
}) => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>('fishing');
  const [catchCardHidden, setCatchCardHidden] = useState(false);

  useEffect(() => {
    if (hud.phase !== 'caught') {
      setCatchCardHidden(false);
    }
  }, [hud.phase]);

  // Persistent Live Internet Radio state (stays mounted outside settingsOpen)
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playSessionRef = useRef(0);
  const fallbackQueueRef = useRef<string[]>([]);
  const stallTimerRef = useRef<number | null>(null);
  const radioStatusRef = useRef<RadioStatus>('idle');
  const [activeStation, setActiveStation] = useState<LiveRadioStation | null>(LIVE_RADIO_STATIONS[0]);
  const [customUrl, setCustomUrl] = useState('');
  const [isCustomActive, setIsCustomActive] = useState(false);
  const [radioPlaying, setRadioPlaying] = useState(false);
  const [radioStatus, setRadioStatus] = useState<RadioStatus>('idle');
  const [radioVolume, setRadioVolume] = useState(0.65);
  const [radioError, setRadioError] = useState<string | null>(null);

  const updateRadioStatus = (next: RadioStatus) => {
    radioStatusRef.current = next;
    setRadioStatus(next);
  };

  const clearStallTimer = () => {
    if (stallTimerRef.current !== null) {
      window.clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        setSettingsOpen(false);
      } else if (e.key === 'h' || e.key === 'H' || e.key === 'ا') {
        setSettingsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = radioVolume;
    }
  }, [radioVolume]);

  useEffect(() => {
    const audioEl = audioRef.current;
    return () => {
      clearStallTimer();
      playSessionRef.current += 1;
      if (audioEl) {
        audioEl.pause();
        audioEl.removeAttribute('src');
      }
    };
  }, []);

  const attemptPlayCandidate = (url: string, sessionId: number) => {
    const el = audioRef.current;
    if (!el || sessionId !== playSessionRef.current) return;

    clearStallTimer();
    setRadioError(null);
    updateRadioStatus('loading');

    el.src = url;
    el.volume = radioVolume;

    stallTimerRef.current = window.setTimeout(() => {
      if (sessionId !== playSessionRef.current || radioStatusRef.current !== 'loading') return;
      const nextFallback = fallbackQueueRef.current.shift();
      if (nextFallback) {
        attemptPlayCandidate(nextFallback, sessionId);
      } else {
        setRadioPlaying(false);
        updateRadioStatus('error');
        setRadioError('استغرق البث وقتاً طويلاً للاتصال، جرّب محطة أخرى');
      }
    }, 6500);

    const p = el.play();
    if (p) {
      p.then(() => {
        if (sessionId !== playSessionRef.current) return;
        clearStallTimer();
        setRadioPlaying(true);
        updateRadioStatus('playing');
      }).catch((err: unknown) => {
        if (sessionId !== playSessionRef.current) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        clearStallTimer();
        const nextFallback = fallbackQueueRef.current.shift();
        if (nextFallback) {
          attemptPlayCandidate(nextFallback, sessionId);
        } else {
          setRadioPlaying(false);
          updateRadioStatus('error');
          setRadioError('تعذر تشغيل هذا البث، جرّب محطة أخرى أو تأكد من اتصال الإنترنت');
        }
      });
    }
  };

  const startStreamQueue = (urls: string[]) => {
    if (urls.length === 0) return;
    playSessionRef.current += 1;
    const sessionId = playSessionRef.current;
    const [primary, ...rest] = urls;
    fallbackQueueRef.current = [...rest];
    attemptPlayCandidate(primary, sessionId);
  };

  const stopRadio = () => {
    playSessionRef.current += 1;
    clearStallTimer();
    fallbackQueueRef.current = [];
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute('src');
    }
    setRadioPlaying(false);
    setRadioError(null);
    updateRadioStatus('idle');
  };

  const handleSelectStation = (station: LiveRadioStation) => {
    if (!isCustomActive && activeStation?.id === station.id && (radioPlaying || radioStatus === 'loading')) {
      stopRadio();
      return;
    }
    setActiveStation(station);
    setIsCustomActive(false);
    startStreamQueue([station.streamUrl, ...(station.fallbackUrls ?? [])]);
  };

  const handlePlayCustomUrl = (url: string) => {
    if (!/^https?:\/\//i.test(url)) {
      updateRadioStatus('error');
      setRadioError('يرجى إدخال رابط بث مباشر يبدأ بـ https:// أو http://');
      return;
    }
    setCustomUrl(url);
    setIsCustomActive(true);
    startStreamQueue([url]);
  };

  const handleToggleRadioPlay = () => {
    if (radioPlaying || radioStatus === 'loading') {
      stopRadio();
      return;
    }
    if (isCustomActive && customUrl) {
      startStreamQueue([customUrl]);
    } else {
      const station = activeStation ?? LIVE_RADIO_STATIONS[0];
      if (!activeStation) setActiveStation(station);
      startStreamQueue([station.streamUrl, ...(station.fallbackUrls ?? [])]);
    }
  };

  const currentSeason = SEASON_CATALOG.find((s) => s.id === hud.season)!;
  const currentWeatherLabel = WEATHER_OPTIONS.find((w) => w.id === hud.weather)?.label ?? '';
  const currentBoat = BOAT_CATALOG.find((b) => b.level === hud.progression.boatLevel) ?? BOAT_CATALOG[0];
  const nextBoat = BOAT_CATALOG.find((b) => b.level === hud.progression.boatLevel + 1) ?? null;
  const currentSpot =
    hud.currentLocationId === 'free_roam'
      ? null
      : (LAKE_ANCHOR_SPOTS.find((s) => s.id === hud.currentLocationId) ?? LAKE_ANCHOR_SPOTS[0]);
  const completedChallengesToday = hud.dailyChallenges.challenges.filter((c) => c.completed).length;
  const totalChallengesToday = hud.dailyChallenges.challenges.length;
  const discoveredPoisCount = hud.pois.filter((p) => p.discovered).length;
  const nextThreshold = getNextLevelThreshold(hud.progression.level);
  const prevThreshold = hud.progression.level > 1 ? getNextLevelThreshold(hud.progression.level - 1) : 0;
  const levelProgressPct = Math.min(
    100,
    Math.max(0, ((hud.progression.totalXp - prevThreshold) / Math.max(1, nextThreshold - prevThreshold)) * 100),
  );

  const primaryLabel = hud.isSailing
    ? 'جاري الإبحار...'
    : hud.phase === 'idle'
      ? 'اضغط مطولاً لرمي الصنارة'
      : hud.phase === 'charging'
        ? 'أفلت للرمي الآن'
        : hud.phase === 'casting'
          ? 'جاري الرمي...'
          : hud.phase === 'waiting' || hud.phase === 'nibbling'
            ? 'سحب الخيط'
            : hud.phase === 'biting'
              ? 'ثبّت الخطاف الآن!'
              : hud.phase === 'reeling'
                ? 'اضغط مطولاً للسحب'
                : 'تم الصيد';

  const currentLocationLabel =
    hud.currentLocationId === 'pier'
      ? 'الرصيف'
      : hud.currentLocationId === 'free_roam'
        ? `تجول حر بالقارب (${hud.waterDepthUnderPlayer}م)`
        : `${currentSpot?.nameAr ?? 'البحيرة'} (${hud.waterDepthUnderPlayer}م)`;

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between">
      {/* Persistent HTML5 audio stream player (stays mounted regardless of Settings state) */}
      <audio
        ref={audioRef}
        preload="none"
        onPlaying={() => {
          clearStallTimer();
          setRadioPlaying(true);
          updateRadioStatus('playing');
          setRadioError(null);
        }}
        onWaiting={() => {
          if (radioPlaying) updateRadioStatus('loading');
        }}
        onPause={() => {
          if (radioStatusRef.current === 'loading' || radioStatusRef.current === 'error') return;
          setRadioPlaying(false);
          updateRadioStatus('idle');
        }}
        onError={() => {
          if (radioStatusRef.current === 'idle') return;
          clearStallTimer();
          const nextFallback = fallbackQueueRef.current.shift();
          if (nextFallback) {
            attemptPlayCandidate(nextFallback, playSessionRef.current);
          } else {
            setRadioPlaying(false);
            updateRadioStatus('error');
            setRadioError('تعذر الاتصال بمحطة البث الحالية، جرّب محطة أخرى');
          }
        }}
      />

      {/* Minimal Top Edge: Settings + Boat Free-Roam Icon + Radio Only (Zero View Obstruction) */}
      <div className="flex items-start justify-between gap-2 p-3 sm:p-3.5">
        <div className="pointer-events-auto flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="الإعدادات والتحكم الكامل (H)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0a1317]/82 hover:bg-[#122026]/95 border border-white/15 text-stone-100 text-xs font-medium shadow-lg transition-colors"
          >
            <Settings className="w-4 h-4 text-emerald-300 shrink-0" />
            <span>الإعدادات</span>
          </button>

          <button
            type="button"
            disabled={hud.isSailing || hud.phase === 'caught'}
            onClick={() => {
              if (hud.isOnBoat) {
                onSelectLocation('pier');
              } else {
                onBoardBoatFreeRoam();
              }
            }}
            title={
              hud.isOnBoat
                ? 'أنت على القارب — اضغط للعودة إلى الرصيف'
                : 'ركوب القارب والتجول الحر في البحيرة'
            }
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium shadow-lg transition-colors whitespace-nowrap disabled:opacity-50 ${
              hud.isOnBoat
                ? 'bg-sky-500/25 hover:bg-sky-500/35 border-sky-400/60 text-sky-100'
                : 'bg-[#0a1317]/82 hover:bg-[#122026]/95 border-white/15 text-stone-100'
            }`}
          >
            <Sailboat className={`w-4 h-4 shrink-0 ${hud.isOnBoat ? 'text-sky-200' : 'text-sky-300'}`} />
            <span>{hud.isOnBoat ? 'العودة للرصيف' : 'تجول بالقارب'}</span>
          </button>
        </div>

        {/* Compact Radio-Only Control at Top Edge */}
        <div className="pointer-events-auto flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#0a1317]/80 border border-white/15 text-xs shadow-lg max-w-[240px] sm:max-w-[290px]">
          <button
            type="button"
            onClick={handleToggleRadioPlay}
            title={radioPlaying || radioStatus === 'loading' ? 'إيقاف الراديو' : 'تشغيل الراديو'}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg font-medium transition-colors whitespace-nowrap shrink-0 ${
              radioPlaying
                ? 'bg-amber-500/25 border border-amber-400/60 text-amber-100 hover:bg-amber-500/35'
                : radioStatus === 'loading'
                  ? 'bg-sky-500/25 border border-sky-400/60 text-sky-100'
                  : 'bg-white/8 hover:bg-white/15 border border-white/10 text-stone-100'
            }`}
          >
            {radioPlaying || radioStatus === 'loading' ? (
              <Pause className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <Play className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>
              {radioStatus === 'loading' ? 'اتصال...' : radioPlaying ? 'إيقاف' : 'راديو'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('radio');
              setSettingsOpen(true);
            }}
            title="تغيير محطة الراديو"
            className="flex items-center gap-1.5 px-1.5 py-1 rounded-lg hover:bg-white/8 text-stone-200 min-w-0 transition-colors"
          >
            <Radio className={`w-3.5 h-3.5 shrink-0 ${radioPlaying ? 'text-amber-300' : 'text-stone-400'}`} />
            <span className="truncate text-[11px]">
              {isCustomActive ? 'بث مخصص' : (activeStation?.nameAr ?? 'الراديو الحي')}
            </span>
          </button>
        </div>
      </div>

      {/* Active Fishing & Exploration Feedback ONLY (No clutter when idle) */}
      <div className="pointer-events-none flex flex-col items-center justify-center gap-2.5 px-4">
        {hud.poiDiscoveredNotice && (
          <div className="max-w-md w-full bg-[#12221a]/95 border border-amber-400/60 rounded-xl px-4 py-3 shadow-2xl text-right">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 text-amber-200 font-bold text-sm">
                <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
                <span>اكتشاف معلم جديد!</span>
              </div>
              <span className="font-mono-nums text-xs font-semibold text-emerald-300">
                +{hud.poiDiscoveredNotice.xpReward} XP
              </span>
            </div>
            <div className="font-display font-bold text-stone-50 text-sm mb-0.5">
              {hud.poiDiscoveredNotice.titleAr}
            </div>
            <p className="text-xs text-stone-200 leading-relaxed">{hud.poiDiscoveredNotice.storyAr}</p>
          </div>
        )}

        {hud.isOnBoat && hud.nearbyPoiName && !hud.poiDiscoveredNotice && (
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[#0d1d24]/90 border border-amber-400/40 text-amber-100 text-xs shadow-lg">
            <Compass className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <span>معلم قريب: {hud.nearbyPoiName} — اقترب بالقارب لاكتشافه</span>
          </div>
        )}

        {hud.isSailing && (
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-[#0d1d26]/92 border border-sky-400/45 text-sky-100 text-xs font-medium shadow-lg">
            <Waves className="w-3.5 h-3.5 text-sky-300 shrink-0" />
            <span>جاري الإبحار بالقارب نحو الموقع المختار... العمق الحالي {hud.waterDepthUnderPlayer}م</span>
          </div>
        )}

        {hud.cinematicActive && (
          <div className="pointer-events-auto flex items-center gap-3 px-4 py-1.5 rounded-lg bg-[#0d171c]/88 border border-emerald-400/35 text-stone-100 text-xs shadow-lg">
            <Film className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
            <span>وضع اللقطة السينمائية — حرّك الشاشة أو اضغط للعودة</span>
            <button
              type="button"
              onClick={onToggleCinematic}
              className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium transition-colors shrink-0"
            >
              إنهاء اللقطة
            </button>
          </div>
        )}

        {hud.challengeCompletedNotice && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1d220e]/95 border border-amber-400/50 text-amber-100 text-xs sm:text-sm font-medium shadow-lg">
            <Target className="w-4 h-4 text-amber-300 shrink-0" />
            <span>{hud.challengeCompletedNotice}</span>
          </div>
        )}

        {hud.newlyUnlockedNotice && (
          <div className="px-4 py-2 rounded-lg bg-[#112622]/95 border border-emerald-400/40 text-emerald-100 text-xs sm:text-sm font-medium shadow-lg">
            {hud.newlyUnlockedNotice}
          </div>
        )}

        {radioError && (!settingsOpen || activeTab !== 'radio') && (
          <div className="px-4 py-2 rounded-lg bg-[#2b1414]/95 border border-rose-400/40 text-rose-100 text-xs sm:text-sm font-medium shadow-lg">
            {radioError}
          </div>
        )}

        {hud.lineSnappedNotice && (
          <div className="px-4 py-2 rounded-lg bg-[#2b1414]/95 border border-rose-400/40 text-rose-100 text-xs sm:text-sm font-medium shadow-lg">
            {hud.lineSnappedNotice}
          </div>
        )}

        {hud.recordBrokenNotice && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#241d0a]/95 border border-amber-400/60 text-amber-100 text-xs sm:text-sm font-semibold shadow-lg">
            <Trophy className="w-4 h-4 text-amber-300 shrink-0" />
            <span>{hud.recordBrokenNotice}</span>
          </div>
        )}

        {hud.rivalNotice && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#22190f]/95 border border-amber-400/45 text-amber-100 text-xs sm:text-sm font-medium shadow-lg">
            <Swords className="w-4 h-4 text-amber-300 shrink-0" />
            <span>{hud.rivalNotice}</span>
          </div>
        )}

        {hud.phase === 'charging' && (
          <div className="w-60 bg-[#0d171c]/90 border border-white/15 rounded-lg p-2.5 shadow-lg">
            <div className="flex items-center justify-between text-xs text-stone-200 mb-1.5">
              <span>قوة الرمي</span>
              <span className="font-mono-nums">{Math.round(hud.castPower * 100)}%</span>
            </div>
            <div className="h-2 w-full bg-stone-800 rounded overflow-hidden">
              <div
                className="h-full bg-emerald-400 transition-[width] duration-75"
                style={{ width: `${Math.round(hud.castPower * 100)}%` }}
              />
            </div>
          </div>
        )}

        {hud.phase === 'biting' && (
          <div className="bg-[#23190c]/95 border border-amber-400/60 rounded-lg px-5 py-2.5 text-center shadow-lg">
            <div className="text-sm font-bold text-amber-200 mb-1">
              غمزت السمكة! اضغط على الشاشة أو Space لتثبيت الخطاف
            </div>
            <div className="h-1.5 w-48 mx-auto bg-stone-800 rounded overflow-hidden">
              <div className="h-full bg-amber-400" style={{ width: `${Math.round(hud.biteUrgency * 100)}%` }} />
            </div>
          </div>
        )}

        {hud.phase === 'reeling' && (
          <div className="flex flex-col items-center gap-2">
            {hud.crocThreatActive && (
              <div className="w-72 bg-[#2b1012]/95 border border-rose-400/65 rounded-lg px-3 py-2 shadow-lg">
                <div className="flex items-center justify-between text-xs text-rose-100 font-semibold mb-1">
                  <span className="flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-300 shrink-0" />
                    تمساح يطارد سمكتك — اسحب بسرعة!
                  </span>
                  <span className="font-mono-nums text-rose-200">{hud.crocDistanceMeters.toFixed(1)} م</span>
                </div>
                <div className="h-1.5 w-full bg-rose-950 rounded overflow-hidden">
                  <div
                    className="h-full bg-rose-400 transition-[width] duration-75"
                    style={{
                      width: `${Math.min(100, Math.max(8, Math.round((1 - Math.min(20, hud.crocDistanceMeters) / 20) * 100)))}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {hud.rivalContestActive && hud.rivalName && (
              <div className="w-72 bg-[#1c160e]/95 border border-amber-400/60 rounded-lg px-3 py-2 shadow-lg">
                <div className="flex items-center justify-between text-xs text-amber-100 font-semibold mb-1">
                  <span className="flex items-center gap-1.5">
                    <Swords className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                    صراع على نفس السمكة مع {hud.rivalName}
                  </span>
                  <span className="font-mono-nums text-amber-200">
                    {Math.round(hud.rivalContestBalance * 100)}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-stone-300 mb-1">
                  <span>{hud.rivalName}</span>
                  <span>أنت (واصل السحب!)</span>
                </div>
                <div className="h-2 w-full bg-rose-900/70 rounded overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 transition-[width] duration-75"
                    style={{ width: `${Math.round(hud.rivalContestBalance * 100)}%` }}
                  />
                </div>
              </div>
            )}

            <div className="w-72 bg-[#0d171c]/92 border border-white/15 rounded-lg p-3 shadow-lg">
              <div className="flex items-center justify-between text-xs text-stone-200 mb-1.5">
                <span className="font-semibold text-emerald-200">{hud.hookedSpeciesName}</span>
                <span className="font-mono-nums text-stone-300">المسافة {hud.fishDistance} م</span>
              </div>
              {(hud.isHeavyHookedFish || hud.heavyFishStress > 0.62) && (
                <div className="flex items-center justify-between text-[11px] font-medium px-2 py-1 rounded bg-amber-500/15 border border-amber-400/40 text-amber-200 mb-2">
                  <span className="flex items-center gap-1">
                    <Activity className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                    {hud.heavyFishStress > 0.72
                      ? 'إجهاد حرج على الخيط — خفّف السحب!'
                      : 'سمكة ثقيلة — الخيط يتوتر ويهتز'}
                  </span>
                </div>
              )}
              <div className="text-[11px] text-stone-400 flex justify-between mb-1">
                <span>شدّ الخيط</span>
                <span className="font-mono-nums">{Math.round(hud.lineTension * 100)}%</span>
              </div>
              <div className="h-2.5 w-full bg-stone-800 rounded overflow-hidden mb-2">
                <div
                  className={`h-full transition-colors ${
                    hud.lineTension > 0.78
                      ? 'bg-rose-500'
                      : hud.lineTension > 0.52
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                  }`}
                  style={{ width: `${Math.min(100, Math.round(hud.lineTension * 100))}%` }}
                />
              </div>
              <div className="text-[11px] text-stone-400 flex justify-between mb-1">
                <span>طاقة السمكة</span>
                <span className="font-mono-nums">{Math.round(hud.fishStamina * 100)}%</span>
              </div>
              <div className="h-1.5 w-full bg-stone-800 rounded overflow-hidden">
                <div className="h-full bg-sky-400" style={{ width: `${Math.round(hud.fishStamina * 100)}%` }} />
              </div>
            </div>
          </div>
        )}

        {/* Active Catch Celebration Card */}
        {hud.phase === 'caught' && hud.activeCatch && (
          catchCardHidden ? (
            <div className="pointer-events-auto self-start md:mr-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0e191d]/92 border border-emerald-400/40 shadow-xl">
              <span className="text-xs text-emerald-200 font-semibold">
                {hud.activeCatch.species.nameAr} · {hud.activeCatch.lengthCm} سم
              </span>
              <button
                type="button"
                onClick={() => setCatchCardHidden(false)}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>إظهار البطاقة</span>
              </button>
            </div>
          ) : (
            <div className="pointer-events-auto self-start md:mr-4 w-full max-w-sm bg-[#0e191d]/94 border border-emerald-400/35 rounded-xl p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-2 mb-2.5">
                <div className="min-w-0">
                  <div className="text-xs text-emerald-300 font-medium mb-0.5">
                    صيد موفق · {hud.activeCatch.species.rarity} · +{hud.activeCatch.xpEarned} خبرة
                  </div>
                  {hud.activeCatch.isNewRecord && (
                    <div className="inline-flex items-center gap-1 text-[11px] text-amber-200 bg-amber-500/20 border border-amber-400/50 rounded px-2 py-0.5 font-semibold mb-1">
                      <Trophy className="w-3 h-3 text-amber-300" />
                      <span>
                        رقم قياسي جديد!
                        {hud.activeCatch.previousRecordKg
                          ? ` (تجاوز ${hud.activeCatch.previousRecordKg} كجم)`
                          : ' (أول وزن مسجّل)'}
                        {hud.activeCatch.recordBonusXp ? ` · +${hud.activeCatch.recordBonusXp} XP` : ''}
                      </span>
                    </div>
                  )}
                  {hud.activeCatch.dailyChallengeBonusXp ? (
                    <div className="text-[11px] text-amber-300 font-semibold mb-0.5">
                      مكافأة تحدٍّ يومي: +{hud.activeCatch.dailyChallengeBonusXp} XP إضافية!
                    </div>
                  ) : null}
                  {hud.activeCatch.crocEscapeBonusXp ? (
                    <div className="text-[11px] text-rose-300 font-semibold mb-0.5">
                      مكافأة نجاة من التمساح: +{hud.activeCatch.crocEscapeBonusXp} XP إضافية!
                    </div>
                  ) : null}
                  {hud.activeCatch.rivalWinBonusXp ? (
                    <div className="text-[11px] text-sky-300 font-semibold mb-0.5">
                      مكافأة التفوق على المنافس: +{hud.activeCatch.rivalWinBonusXp} XP إضافية!
                    </div>
                  ) : null}
                  <h2 className="font-display text-lg font-bold text-stone-50 truncate">
                    {hud.activeCatch.species.nameAr}
                  </h2>
                  <div className="text-[11px] text-stone-400">{hud.activeCatch.species.scientificName}</div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <FishIllustration species={hud.activeCatch.species} className="w-16 h-9" />
                  <button
                    type="button"
                    onClick={() => setCatchCardHidden(true)}
                    title="إخفاء البطاقة لمعاينة السمكة ثلاثية الأبعاد بحرية"
                    className="flex items-center gap-1 text-[11px] text-stone-300 hover:text-white underline"
                  >
                    <EyeOff className="w-3 h-3" />
                    <span>معاينة كاملة</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 font-mono-nums text-xs text-stone-200 bg-white/5 px-3 py-1.5 rounded-lg border border-white/10 mb-2.5">
                <div>الطول: {hud.activeCatch.lengthCm} سم</div>
                <div>الوزن: {hud.activeCatch.weightKg} كجم</div>
                <div className="text-amber-300">
                  القياسي: {hud.speciesRecords[hud.activeCatch.species.id]?.maxWeightKg ?? hud.activeCatch.weightKg} كجم
                </div>
              </div>

              <p className="text-xs text-stone-300 leading-relaxed mb-2.5">
                {hud.activeCatch.species.descriptionAr}
              </p>

              <div className="text-[11px] text-stone-400 flex flex-wrap items-center gap-1.5 mb-3">
                <span>الموقع: {LAKE_ZONE_LABELS[hud.activeCatch.zone]}</span>
                <span aria-hidden="true">·</span>
                <span>اسحب الشاشة لتدوير السمكة ومعاينتها</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onResolveCatch(false)}
                  className="flex-1 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
                >
                  حفظ في السجل
                </button>
                <button
                  type="button"
                  onClick={() => onResolveCatch(true)}
                  className="flex-1 py-2 px-3 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-100 text-xs font-medium border border-white/15 transition-colors"
                >
                  إطلاق للبحيرة (+20% خبرة)
                </button>
              </div>
            </div>
          )
        )}
      </div>

      {/* Minimal Bottom Fishing Action Strip (Cast/Reel + Compact Boat Helm only while steering on boat) */}
      <div className="pointer-events-none flex items-center justify-center gap-2.5 pb-4 px-3">
        <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 p-1.5 rounded-xl bg-[#0a1317]/82 border border-white/15 shadow-xl">
          <button
            type="button"
            onPointerDown={onPrimaryPress}
            onPointerUp={onPrimaryRelease}
            onPointerLeave={() => {
              if (hud.phase === 'charging' || hud.phase === 'reeling') onPrimaryRelease();
            }}
            disabled={hud.isSailing || hud.phase === 'casting' || hud.phase === 'caught'}
            className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
              hud.phase === 'biting'
                ? 'bg-amber-500 hover:bg-amber-400 text-stone-950'
                : hud.phase === 'reeling'
                  ? 'bg-sky-600 hover:bg-sky-500 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 disabled:text-stone-400 text-white'
            }`}
          >
            {primaryLabel}
          </button>

          {hud.isOnBoat && hud.phase === 'idle' && (
            <div
              className="flex items-center gap-1 pr-2 border-r border-white/15"
              title="قيادة القارب (يمكنك استخدام مفاتيح W/A/S/D)"
            >
              <button
                type="button"
                aria-label="تقدم بالقارب"
                onPointerDown={() => onBoatSteer(1, 0)}
                onPointerUp={() => onBoatSteer(0, 0)}
                onPointerLeave={() => onBoatSteer(0, 0)}
                onPointerCancel={() => onBoatSteer(0, 0)}
                className="p-2 rounded-lg bg-white/8 hover:bg-sky-500/30 active:bg-sky-500/45 text-stone-100 border border-white/10 transition-colors"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="انعطاف يمين"
                onPointerDown={() => onBoatSteer(0, -1)}
                onPointerUp={() => onBoatSteer(0, 0)}
                onPointerLeave={() => onBoatSteer(0, 0)}
                onPointerCancel={() => onBoatSteer(0, 0)}
                className="p-2 rounded-lg bg-white/8 hover:bg-sky-500/30 active:bg-sky-500/45 text-stone-100 border border-white/10 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="انعطاف يسار"
                onPointerDown={() => onBoatSteer(0, 1)}
                onPointerUp={() => onBoatSteer(0, 0)}
                onPointerLeave={() => onBoatSteer(0, 0)}
                onPointerCancel={() => onBoatSteer(0, 0)}
                className="p-2 rounded-lg bg-white/8 hover:bg-sky-500/30 active:bg-sky-500/45 text-stone-100 border border-white/10 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="تراجع بالقارب"
                onPointerDown={() => onBoatSteer(-1, 0)}
                onPointerUp={() => onBoatSteer(0, 0)}
                onPointerLeave={() => onBoatSteer(0, 0)}
                onPointerCancel={() => onBoatSteer(0, 0)}
                className="p-2 rounded-lg bg-white/8 hover:bg-sky-500/30 active:bg-sky-500/45 text-stone-100 border border-white/10 transition-colors"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Unified Settings Control Center (ALL controls, radio, audio, boat, POIs, weather, skills & journal) */}
      {settingsOpen && (
        <div
          className="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-3 sm:p-5"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false);
          }}
        >
          <div className="w-full max-w-4xl max-h-[88vh] flex flex-col bg-[#0c161b] border border-white/15 rounded-2xl shadow-2xl overflow-hidden">
            {/* Settings Header + Valley Status Bar */}
            <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-white/10 bg-[#091115] space-y-2.5 shrink-0">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Settings className="w-5 h-5 text-emerald-300 shrink-0" />
                  <h2 className="font-display text-base sm:text-lg font-bold text-stone-50 truncate">
                    إعدادات الوادي والصيد
                  </h2>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      onResetLook();
                      setSettingsOpen(false);
                    }}
                    title="توسيط النظر نحو البحيرة"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-100 bg-white/5 hover:bg-white/10 border border-white/15 rounded-lg transition-colors"
                  >
                    <Compass className="w-3.5 h-3.5 text-emerald-300" />
                    <span>توسيط النظر</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(false)}
                    aria-label="إغلاق الإعدادات"
                    className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-stone-300 hover:text-white border border-white/10 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Status metadata strip */}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-stone-300 font-mono-nums">
                <span>المستوى {hud.progression.level}</span>
                <span className="text-stone-500">·</span>
                <span className="text-amber-300">{hud.progression.availableXp} خبرة متاحة</span>
                <span className="text-stone-500">·</span>
                <span>{formatHourToClock(hud.timeOfDay)}</span>
                <span className="text-stone-500">·</span>
                <span>{currentSeason.nameAr}</span>
                <span className="text-stone-500">·</span>
                <span>{currentWeatherLabel}</span>
                <span className="text-stone-500">·</span>
                <span>رياح {hud.windSpeedKmh} كم/س</span>
                <span className="text-stone-500">·</span>
                <span className="text-sky-200">{currentLocationLabel}</span>
                {hud.coldIntensity > 0.45 && (
                  <>
                    <span className="text-stone-500">·</span>
                    <span className="inline-flex items-center gap-1 text-sky-200">
                      <Snowflake className="w-3.5 h-3.5 text-sky-300" />
                      طقس بارد
                    </span>
                  </>
                )}
              </div>

              {/* 7 Unified Tabs */}
              <div className="flex items-center gap-1 p-1 bg-black/40 rounded-xl border border-white/10 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setActiveTab('fishing')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    activeTab === 'fishing' ? 'bg-stone-100 text-stone-900' : 'text-stone-300 hover:text-white'
                  }`}
                >
                  العدة والعمق
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('boat')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                    activeTab === 'boat' ? 'bg-stone-100 text-stone-900' : 'text-stone-300 hover:text-white'
                  }`}
                >
                  <Anchor className="w-3.5 h-3.5" />
                  <span>القارب والاستكشاف</span>
                  <span
                    className={`font-mono-nums text-[10px] ${
                      activeTab === 'boat' ? 'text-sky-700' : 'text-sky-300'
                    }`}
                  >
                    ({discoveredPoisCount}/{hud.pois.length || 5})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('challenges')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                    activeTab === 'challenges' ? 'bg-stone-100 text-stone-900' : 'text-stone-300 hover:text-white'
                  }`}
                >
                  <Target className="w-3.5 h-3.5" />
                  <span>التحديات اليومية</span>
                  <span
                    className={`font-mono-nums text-[10px] ${
                      activeTab === 'challenges'
                        ? 'text-emerald-700'
                        : completedChallengesToday === totalChallengesToday
                          ? 'text-emerald-300'
                          : 'text-amber-300'
                    }`}
                  >
                    ({completedChallengesToday}/{totalChallengesToday})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('atmosphere')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    activeTab === 'atmosphere' ? 'bg-stone-100 text-stone-900' : 'text-stone-300 hover:text-white'
                  }`}
                >
                  الطقس والأوقات
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('skills')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    activeTab === 'skills' ? 'bg-stone-100 text-stone-900' : 'text-stone-300 hover:text-white'
                  }`}
                >
                  المهارات والتقدم
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('radio')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                    activeTab === 'radio' ? 'bg-stone-100 text-stone-900' : 'text-stone-300 hover:text-white'
                  }`}
                >
                  <Radio className="w-3.5 h-3.5" />
                  <span>السينما والراديو والصوت</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('journal')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                    activeTab === 'journal' ? 'bg-stone-100 text-stone-900' : 'text-stone-300 hover:text-white'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>السجل والأسماك ({hud.catchHistory.length})</span>
                </button>
              </div>
            </div>

            {/* Settings Scrollable Body */}
            <div className="p-4 sm:p-5 overflow-y-auto flex-1">
              {/* Tab 1: Fishing Gear, Baits, Hooks & Depth */}
              {activeTab === 'fishing' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div>
                    <div className="text-stone-400 mb-2 font-medium">الطعم المستخدم</div>
                    <div className="flex flex-wrap gap-1.5">
                      {BAIT_CATALOG.map((bait) => {
                        const unlocked = hud.progression.unlockedBaits.includes(bait.id);
                        const active = hud.selectedBait === bait.id;
                        return (
                          <button
                            key={bait.id}
                            type="button"
                            disabled={!unlocked}
                            onClick={() => onSelectBait(bait.id)}
                            title={unlocked ? bait.subtitleAr : `يُفتح عند المستوى ${bait.unlockLevel}`}
                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md border transition-colors whitespace-nowrap ${
                              active
                                ? 'bg-emerald-600/30 border-emerald-400 text-emerald-100'
                                : unlocked
                                  ? 'bg-white/5 border-white/10 text-stone-200 hover:bg-white/10'
                                  : 'bg-black/25 border-white/5 text-stone-500 cursor-not-allowed'
                            }`}
                          >
                            {!unlocked && <Lock className="w-3 h-3" />}
                            <span>{bait.nameAr}</span>
                            {!unlocked && <span className="font-mono-nums text-[10px]">({bait.unlockLevel})</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="text-stone-400 mb-2 font-medium">نوع الخطاف</div>
                    <div className="flex flex-wrap gap-1.5">
                      {HOOK_CATALOG.map((hook) => {
                        const unlocked = hud.progression.unlockedHooks.includes(hook.id);
                        const active = hud.selectedHook === hook.id;
                        return (
                          <button
                            key={hook.id}
                            type="button"
                            disabled={!unlocked}
                            onClick={() => onSelectHook(hook.id)}
                            title={unlocked ? hook.subtitleAr : `يُفتح عند المستوى ${hook.unlockLevel}`}
                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md border transition-colors whitespace-nowrap ${
                              active
                                ? 'bg-emerald-600/30 border-emerald-400 text-emerald-100'
                                : unlocked
                                  ? 'bg-white/5 border-white/10 text-stone-200 hover:bg-white/10'
                                  : 'bg-black/25 border-white/5 text-stone-500 cursor-not-allowed'
                            }`}
                          >
                            {!unlocked && <Lock className="w-3 h-3" />}
                            <span>{hook.nameAr}</span>
                            {!unlocked && <span className="font-mono-nums text-[10px]">({hook.unlockLevel})</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="text-stone-400 mb-2 flex items-center justify-between font-medium">
                      <span>عمق الطعم تحت العوامة</span>
                      {hud.currentCastZone && (
                        <span className="text-emerald-300">{LAKE_ZONE_LABELS[hud.currentCastZone]}</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { label: 'سطحي 0.6م', val: 0.6 },
                        { label: 'متوسط 1.5م', val: 1.5 },
                        { label: 'عميق 2.6م', val: 2.6 },
                        { label: 'أعماق 4.4م', val: 4.4 },
                      ].map((d) => (
                        <button
                          key={d.val}
                          type="button"
                          onClick={() => onSelectDepth(d.val)}
                          className={`py-2 px-2 rounded-md border text-center transition-colors whitespace-nowrap ${
                            Math.abs(hud.lineDepthMeters - d.val) < 0.45
                              ? 'bg-emerald-600/30 border-emerald-400 text-emerald-100'
                              : 'bg-white/5 border-white/10 text-stone-200 hover:bg-white/10'
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2.5 text-[11px] text-stone-400 leading-relaxed">
                      اضغط مطولاً على الشاشة للرمي أو السحب · اسحب يميناً ويساراً للالتفات حول الجبال والبحيرة.
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: Boat Upgrades, Free Roam, Anchor Spots & POIs */}
              {activeTab === 'boat' && (
                <div className="space-y-4 text-xs">
                  {/* Free Roam Explorer Banner */}
                  <div className="p-3 rounded-xl bg-sky-950/35 border border-sky-400/30 flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="font-semibold text-sky-100 flex items-center gap-1.5">
                        <Compass className="w-4 h-4 text-sky-300 shrink-0" />
                        <span>التجول الحر بالقارب واستكشاف البحيرة</span>
                      </div>
                      <p className="text-[11px] text-stone-300">
                        {hud.isOnBoat
                          ? 'أنت الآن على متن القارب — استخدم مفاتيح W / A / S / D أو أزرار الدفة أسفل الشاشة للإبحار بحرية.'
                          : 'انطلق بالقارب في أي اتجاه لاستكشاف الخلجان الضحلة والكهوف والمزارات حول البحيرة.'}
                      </p>
                    </div>
                    {!hud.isOnBoat ? (
                      <button
                        type="button"
                        disabled={hud.phase === 'caught'}
                        onClick={() => {
                          onBoardBoatFreeRoam();
                          setSettingsOpen(false);
                        }}
                        className="px-3.5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:bg-stone-700 disabled:text-stone-400 text-stone-950 font-semibold transition-colors whitespace-nowrap shrink-0"
                      >
                        انطلاق للتجول الحر بالقارب
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={hud.isSailing || hud.phase === 'caught'}
                        onClick={() => {
                          onSelectLocation('pier');
                          setSettingsOpen(false);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-stone-100 font-medium transition-colors whitespace-nowrap shrink-0"
                      >
                        العودة للرصيف
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                    {/* Boat Tier Status & Upgrade Card */}
                    <div className="lg:col-span-5 p-3 rounded-lg bg-white/5 border border-white/10 flex flex-col justify-between gap-2.5">
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-1.5 font-semibold text-stone-100">
                            <Anchor className="w-4 h-4 text-sky-300 shrink-0" />
                            <span>{currentBoat.nameAr}</span>
                          </div>
                          <span className="font-mono-nums text-[11px] text-sky-300">
                            المستوى {currentBoat.level}/4
                          </span>
                        </div>
                        <p className="text-[11px] text-stone-300 leading-snug mb-2">{currentBoat.subtitleAr}</p>
                        <div className="grid grid-cols-3 gap-1.5 text-[11px] font-mono-nums bg-black/30 rounded p-2 border border-white/10 text-stone-200">
                          <div>
                            <span className="text-stone-400 block text-[10px]">أقصى عمق</span>
                            <span>{currentBoat.maxReachDepthMeters} م</span>
                          </div>
                          <div>
                            <span className="text-stone-400 block text-[10px]">السرعة</span>
                            <span>{currentBoat.speedMps} م/ث</span>
                          </div>
                          <div>
                            <span className="text-stone-400 block text-[10px]">جذب النوادر</span>
                            <span className="text-emerald-300">
                              +{Math.round((currentBoat.rareAttractionBonus - 1) * 100)}%
                            </span>
                          </div>
                        </div>
                      </div>

                      {nextBoat ? (
                        <div className="pt-2 border-t border-white/10 space-y-1.5">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-amber-300 font-semibold">الترقية التالية: {nextBoat.nameAr}</span>
                            <span className="font-mono-nums text-stone-300">
                              متاح: {hud.progression.availableXp} XP
                            </span>
                          </div>
                          <div className="text-[11px] text-stone-400">{nextBoat.unlockSummaryAr}</div>
                          <button
                            type="button"
                            disabled={hud.progression.availableXp < nextBoat.upgradeCostXp}
                            onClick={onUpgradeBoat}
                            className={`w-full py-2 px-3 rounded-md flex items-center justify-center gap-1.5 font-semibold transition-colors ${
                              hud.progression.availableXp >= nextBoat.upgradeCostXp
                                ? 'bg-amber-500 hover:bg-amber-400 text-stone-950'
                                : 'bg-stone-800 text-stone-500 cursor-not-allowed'
                            }`}
                          >
                            <ArrowUpRight className="w-3.5 h-3.5" />
                            <span className="font-mono-nums">
                              ترقية القارب ({nextBoat.upgradeCostXp} نقطة خبرة)
                            </span>
                          </button>
                        </div>
                      ) : (
                        <div className="pt-2 border-t border-white/10 flex items-center gap-1.5 text-emerald-300 font-semibold text-[11px]">
                          <Check className="w-4 h-4 shrink-0" />
                          <span>وصلت لأعلى فئة قوارب — جميع أعماق وسط البحيرة مفتوحة!</span>
                        </div>
                      )}
                    </div>

                    {/* Lake Anchor Spots Selector */}
                    <div className="lg:col-span-7 flex flex-col gap-2">
                      <div className="flex items-center justify-between text-stone-300">
                        <span className="font-semibold flex items-center gap-1.5">
                          <Navigation className="w-3.5 h-3.5 text-emerald-300" />
                          <span>مواقع الصيد العميقة</span>
                        </span>
                        <span className="font-mono-nums text-[11px] text-sky-300">
                          العمق تحتك: {hud.waterDepthUnderPlayer} م
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {LAKE_ANCHOR_SPOTS.map((spot) => {
                          const unlocked = hud.progression.boatLevel >= spot.requiredBoatLevel;
                          const isCurrent = hud.currentLocationId === spot.id;
                          return (
                            <button
                              key={spot.id}
                              type="button"
                              disabled={!unlocked || isCurrent || hud.isSailing || hud.phase === 'caught'}
                              onClick={() => {
                                onSelectLocation(spot.id);
                                setSettingsOpen(false);
                              }}
                              className={`p-2 rounded-lg border text-right transition-colors flex flex-col justify-between gap-1 ${
                                isCurrent
                                  ? 'bg-sky-600/25 border-sky-400/70 text-sky-100'
                                  : unlocked
                                    ? 'bg-white/5 border-white/12 text-stone-200 hover:bg-white/12'
                                    : 'bg-black/30 border-white/5 text-stone-500 cursor-not-allowed'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1.5 w-full">
                                <span className="font-semibold truncate flex items-center gap-1">
                                  {!unlocked && <Lock className="w-3 h-3 shrink-0" />}
                                  <span>{spot.nameAr}</span>
                                </span>
                                <span className="font-mono-nums text-[10px] px-1.5 py-0.5 rounded bg-black/35 text-amber-300 shrink-0">
                                  {spot.waterDepthMeters}م
                                </span>
                              </div>
                              <div className="text-[10px] text-stone-400 truncate w-full">
                                الأسماك: {spot.notableSpeciesAr}
                              </div>
                              <div className="text-[10px] font-medium mt-0.5">
                                {isCurrent ? (
                                  <span className="text-sky-300">● موقعك الحالي</span>
                                ) : !unlocked ? (
                                  <span className="text-stone-500">
                                    يتطلب ترقية القارب للمستوى {spot.requiredBoatLevel}
                                  </span>
                                ) : hud.isSailing ? (
                                  <span className="text-stone-400">جاري الإبحار...</span>
                                ) : (
                                  <span className="text-emerald-300">
                                    {spot.id === 'pier' ? '← العودة للرصيف' : '← أبحر إلى هذه المنطقة'}
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Points of Interest (POI) Explorer Directory */}
                  <div className="pt-3 border-t border-white/10">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                      <div className="flex items-center gap-1.5 font-semibold text-stone-100">
                        <MapPin className="w-4 h-4 text-amber-300 shrink-0" />
                        <span>نقاط الاهتمام والمعالم السرية حول البحيرة</span>
                      </div>
                      <span className="font-mono-nums text-amber-300 text-[11px]">
                        المكتشف: {discoveredPoisCount} / {hud.pois.length || 5}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {hud.pois.map((poi) => (
                        <div
                          key={poi.id}
                          className={`p-3 rounded-lg border flex flex-col justify-between gap-2 ${
                            poi.discovered
                              ? 'bg-emerald-950/30 border-emerald-400/35'
                              : 'bg-white/5 border-white/10'
                          }`}
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <div className="min-w-0">
                                <div className="font-semibold text-stone-100 truncate">
                                  {poi.discovered ? poi.nameAr : poi.mysteryTitleAr}
                                </div>
                                <div className="text-[10px] text-stone-400">{poi.categoryAr}</div>
                              </div>
                              {poi.discovered ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-[10px] font-semibold shrink-0">
                                  <Check className="w-3 h-3" />
                                  مكتشف
                                </span>
                              ) : (
                                <span className="font-mono-nums px-2 py-0.5 rounded bg-amber-500/15 border border-amber-400/35 text-amber-200 text-[10px] font-semibold shrink-0">
                                  +{poi.xpReward} XP
                                </span>
                              )}
                            </div>

                            <p className="text-[11px] text-stone-300 leading-relaxed mb-2">
                              {poi.discovered ? poi.discoveryStoryAr : poi.hintAr}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/8">
                            <span className="font-mono-nums text-[11px] text-sky-200">
                              الاتجاه: {poi.bearingLabelAr} · {poi.distanceMeters} م
                            </span>

                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  onLookAtPoi(poi.id);
                                  setSettingsOpen(false);
                                }}
                                className="px-2.5 py-1 rounded bg-white/8 hover:bg-white/15 border border-white/12 text-stone-100 text-[11px] transition-colors"
                              >
                                توجيه النظر
                              </button>
                              {poi.discovered && (
                                <button
                                  type="button"
                                  disabled={hud.isSailing || hud.phase === 'caught'}
                                  onClick={() => {
                                    onSailToPoi(poi.id);
                                    setSettingsOpen(false);
                                  }}
                                  className="px-2.5 py-1 rounded bg-emerald-600/80 hover:bg-emerald-500 disabled:bg-stone-700 text-white text-[11px] font-medium transition-colors"
                                >
                                  إبحار للمعلم
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 3: Daily Challenges */}
              {activeTab === 'challenges' && (
                <div className="text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-stone-100">
                        تحديات اليوم ({hud.dailyChallenges.dateKey})
                      </span>
                      <span className="text-stone-400">· تتجدد يومياً بمهام ومكافآت خبرة إضافية</span>
                    </div>
                    <div className="flex items-center gap-3 font-mono-nums">
                      <span className="text-emerald-300">
                        المكتمل اليوم: {completedChallengesToday}/{totalChallengesToday}
                      </span>
                      <span className="text-amber-300">إجمالي المنجز: {hud.dailyChallenges.completedTotal}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                    {hud.dailyChallenges.challenges.map((ch) => {
                      const targetSpecies = ch.speciesId
                        ? FISH_SPECIES.find((s) => s.id === ch.speciesId)
                        : undefined;
                      const targetBait = ch.baitId ? BAIT_CATALOG.find((b) => b.id === ch.baitId) : undefined;
                      const targetWeather = ch.weather
                        ? WEATHER_OPTIONS.find((w) => w.id === ch.weather)
                        : undefined;

                      const baitMatched = !ch.baitId || hud.selectedBait === ch.baitId;
                      const baitUnlocked = !ch.baitId || hud.progression.unlockedBaits.includes(ch.baitId);
                      const weatherMatched = !ch.weather || hud.weather === ch.weather;
                      const pct = Math.min(100, Math.round((ch.progress / Math.max(1, ch.targetCount)) * 100));

                      return (
                        <div
                          key={ch.id}
                          className={`p-3 rounded-lg border flex flex-col justify-between gap-2 ${
                            ch.completed
                              ? 'bg-emerald-950/35 border-emerald-400/40'
                              : 'bg-white/5 border-white/10'
                          }`}
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <span className="font-semibold text-stone-100">{ch.titleAr}</span>
                              {ch.completed ? (
                                <span className="flex items-center gap-1 text-emerald-300 font-semibold shrink-0">
                                  <Check className="w-3.5 h-3.5" />
                                  <span>مكتمل</span>
                                </span>
                              ) : (
                                <span className="font-mono-nums text-amber-300 font-semibold shrink-0">
                                  +{ch.xpReward} XP
                                </span>
                              )}
                            </div>

                            <p className="text-stone-200 leading-snug mb-2">{ch.descriptionAr}</p>

                            <div className="flex flex-wrap gap-1.5 mb-2 text-[11px]">
                              {targetSpecies && (
                                <span className="px-2 py-0.5 rounded bg-black/30 border border-white/10 text-stone-200">
                                  السمكة: {targetSpecies.nameAr}
                                </span>
                              )}
                              {targetBait && (
                                <button
                                  type="button"
                                  disabled={!baitUnlocked || baitMatched || ch.completed}
                                  onClick={() => ch.baitId && onSelectBait(ch.baitId)}
                                  title={
                                    baitMatched
                                      ? 'الطعم مجهز حالياً'
                                      : baitUnlocked
                                        ? `اضغط لتجهيز ${targetBait.nameAr}`
                                        : `يُفتح عند المستوى ${targetBait.unlockLevel}`
                                  }
                                  className={`px-2 py-0.5 rounded border transition-colors ${
                                    baitMatched
                                      ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                                      : baitUnlocked && !ch.completed
                                        ? 'bg-amber-500/15 border-amber-400/40 text-amber-200 hover:bg-amber-500/25'
                                        : 'bg-black/30 border-white/10 text-stone-400'
                                  }`}
                                >
                                  الطُعم: {targetBait.nameAr}{' '}
                                  {baitMatched ? '✓' : baitUnlocked && !ch.completed ? '· تجهيز' : ''}
                                </button>
                              )}
                              {targetWeather && (
                                <button
                                  type="button"
                                  disabled={weatherMatched || ch.completed}
                                  onClick={() => ch.weather && onSelectWeather(ch.weather)}
                                  title={
                                    weatherMatched
                                      ? 'الطقس الحالي مطابق'
                                      : `اضغط لضبط الطقس إلى ${targetWeather.label}`
                                  }
                                  className={`px-2 py-0.5 rounded border transition-colors ${
                                    weatherMatched
                                      ? 'bg-sky-500/20 border-sky-400/50 text-sky-200'
                                      : !ch.completed
                                        ? 'bg-amber-500/15 border-amber-400/40 text-amber-200 hover:bg-amber-500/25'
                                        : 'bg-black/30 border-white/10 text-stone-400'
                                  }`}
                                >
                                  الطقس: {targetWeather.label}{' '}
                                  {weatherMatched ? '✓' : !ch.completed ? '· ضبط' : ''}
                                </button>
                              )}
                            </div>
                          </div>

                          <div>
                            <div className="flex items-center justify-between text-[11px] text-stone-400 mb-1">
                              <span className="truncate">{ch.hintAr}</span>
                              <span className="font-mono-nums text-stone-200 shrink-0 mr-2">
                                {ch.progress}/{ch.targetCount}
                              </span>
                            </div>
                            <div className="h-1.5 w-full bg-stone-800 rounded overflow-hidden">
                              <div
                                className={`h-full transition-[width] ${
                                  ch.completed ? 'bg-emerald-400' : 'bg-amber-400'
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Tab 4: Dynamic Weather, Seasons & Time of Day */}
              {activeTab === 'atmosphere' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div className="space-y-3">
                    <div>
                      <div className="text-stone-400 mb-1.5 flex items-center justify-between gap-2">
                        <span>الموسم</span>
                        <span className="text-stone-300 truncate">{hud.fishingConditionLabel}</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {SEASON_CATALOG.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => onSelectSeason(s.id)}
                            title={s.descriptionAr}
                            className={`py-1.5 px-2 rounded-md border transition-colors whitespace-nowrap ${
                              hud.season === s.id
                                ? 'bg-emerald-600/30 border-emerald-400 text-emerald-100'
                                : 'bg-white/5 border-white/10 text-stone-200 hover:bg-white/10'
                            }`}
                          >
                            {s.nameAr}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-stone-400 mb-1 flex items-center justify-between gap-2">
                        <span>
                          سرعة الرياح والأمواج ({hud.windSpeedKmh} كم/س ·{' '}
                          {hud.windSpeedKmh >= 24 ? 'أمواج عالية' : hud.windSpeedKmh >= 10 ? 'متموجة' : 'هادئة'})
                        </span>
                        <button
                          type="button"
                          onClick={() => onToggleAutoWind(!hud.autoWind)}
                          className={`text-[11px] underline shrink-0 ${
                            hud.autoWind ? 'text-emerald-300' : 'text-stone-400'
                          }`}
                        >
                          {hud.autoWind ? 'تلقائية' : 'يدوية'}
                        </button>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={45}
                        step={1}
                        value={hud.windSpeedKmh}
                        onChange={(e) => onSetWindSpeed(parseInt(e.target.value, 10))}
                        aria-label="سرعة الرياح"
                        className="w-full accent-sky-400 cursor-pointer"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="text-stone-400 mb-1.5 flex items-center justify-between">
                      <span>حالة الطقس</span>
                      <button
                        type="button"
                        onClick={() => onToggleAutoWeather(!hud.autoWeather)}
                        className={`text-[11px] underline ${
                          hud.autoWeather ? 'text-emerald-300' : 'text-stone-400'
                        }`}
                      >
                        {hud.autoWeather ? 'تغير تلقائي: مفعّل' : 'تغير تلقائي: متوقف'}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {WEATHER_OPTIONS.map((w) => (
                        <button
                          key={w.id}
                          type="button"
                          onClick={() => onSelectWeather(w.id)}
                          className={`px-2.5 py-1.5 rounded-md border transition-colors whitespace-nowrap ${
                            hud.weather === w.id
                              ? 'bg-sky-600/30 border-sky-400 text-sky-100'
                              : 'bg-white/5 border-white/10 text-stone-200 hover:bg-white/10'
                          }`}
                        >
                          {w.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-stone-400 mb-1.5 flex items-center justify-between">
                      <span>الوقت ({formatHourToClock(hud.timeOfDay)})</span>
                      <button
                        type="button"
                        onClick={() => onToggleAutoTime(!hud.autoTimeCycle)}
                        className={`text-[11px] underline ${
                          hud.autoTimeCycle ? 'text-emerald-300' : 'text-stone-400'
                        }`}
                      >
                        {hud.autoTimeCycle ? 'دورة تلقائية: مفعّلة' : 'دورة تلقائية: متوقفة'}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {TIME_PRESETS.map((tp) => (
                        <button
                          key={tp.id}
                          type="button"
                          onClick={() => onSelectTimePreset(tp.id, tp.hour)}
                          className={`px-2 py-1 rounded border text-[11px] transition-colors whitespace-nowrap ${
                            hud.timePreset === tp.id
                              ? 'bg-amber-500/25 border-amber-400 text-amber-100'
                              : 'bg-white/5 border-white/10 text-stone-300 hover:bg-white/10'
                          }`}
                        >
                          {tp.label}
                        </button>
                      ))}
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={23.9}
                      step={0.1}
                      value={hud.timeOfDay}
                      onChange={(e) => onSetTimeHour(parseFloat(e.target.value))}
                      aria-label="الوقت"
                      className="w-full accent-amber-400 cursor-pointer"
                    />
                  </div>
                </div>
              )}

              {/* Tab 5: Player XP Progression & Upgradeable Skills */}
              {activeTab === 'skills' && (
                <div className="text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-stone-100">مستوى الصياد {hud.progression.level}</span>
                      <span className="text-stone-400 font-mono-nums">
                        إجمالي الخبرة: {hud.progression.totalXp} / {nextThreshold}
                      </span>
                    </div>
                    <div className="text-amber-300 font-semibold font-mono-nums">
                      نقاط خبرة للترقية: {hud.progression.availableXp}
                    </div>
                  </div>
                  <div className="h-1.5 w-full bg-stone-800 rounded overflow-hidden mb-3">
                    <div className="h-full bg-amber-400 transition-[width]" style={{ width: `${levelProgressPct}%` }} />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                    {SKILL_CATALOG.map((sk) => {
                      const lvl = hud.progression.skills[sk.key];
                      const maxed = lvl >= sk.maxLevel;
                      const cost = getSkillUpgradeCost(sk, lvl);
                      const canAfford = !maxed && hud.progression.availableXp >= cost;

                      return (
                        <div
                          key={sk.key}
                          className="p-3 rounded-lg bg-white/5 border border-white/10 flex flex-col justify-between gap-2"
                        >
                          <div>
                            <div className="flex items-center justify-between font-semibold text-stone-100 mb-1">
                              <span>{sk.nameAr}</span>
                              <span className="font-mono-nums text-emerald-300">
                                {lvl}/{sk.maxLevel}
                              </span>
                            </div>
                            <p className="text-[11px] text-stone-400 leading-snug">{sk.effectAr}</p>
                          </div>
                          <button
                            type="button"
                            disabled={!canAfford}
                            onClick={() => onUpgradeSkill(sk.key)}
                            className={`w-full py-1.5 px-2 rounded flex items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
                              maxed
                                ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/30'
                                : canAfford
                                  ? 'bg-amber-500 hover:bg-amber-400 text-stone-950'
                                  : 'bg-stone-800 text-stone-500 cursor-not-allowed'
                            }`}
                          >
                            {maxed ? (
                              <>
                                <Check className="w-3 h-3" />
                                <span>مكتمل</span>
                              </>
                            ) : (
                              <>
                                <ArrowUpRight className="w-3 h-3" />
                                <span className="font-mono-nums">ترقية ({cost} خبرة)</span>
                              </>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Tab 6: Cinematic View, Nature Ambience Mixer (incl. Frogs) & Live Radio */}
              {activeTab === 'radio' && (
                <div className="space-y-2 text-xs">
                  {/* Cinematic Camera Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-white/5 border border-white/10">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-emerald-300 flex items-center gap-1.5">
                        <Film className="w-4 h-4 shrink-0" />
                        <span>الرؤية السينمائية</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onToggleCinematic();
                          if (!hud.cinematicActive) setSettingsOpen(false);
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border font-medium transition-colors ${
                          hud.cinematicActive
                            ? 'bg-emerald-500/25 border-emerald-400/70 text-emerald-100 hover:bg-emerald-500/35'
                            : 'bg-emerald-600/20 hover:bg-emerald-600/35 border-emerald-400/40 text-emerald-100'
                        }`}
                      >
                        <span>
                          {hud.cinematicActive ? 'إنهاء الرؤية السينمائية' : 'تشغيل لقطة سينمائية الآن'}
                        </span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => onToggleCinematicAuto(!hud.cinematicAutoEnabled)}
                      className={`px-2.5 py-1.5 rounded-md border text-[11px] transition-colors ${
                        hud.cinematicAutoEnabled
                          ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200'
                          : 'bg-black/25 border-white/10 text-stone-400 hover:text-stone-200'
                      }`}
                    >
                      تفعيل تلقائي عند الخمول (18ث): {hud.cinematicAutoEnabled ? 'مفعّل' : 'متوقف'}
                    </button>
                  </div>

                  <LiveRadioPlayer
                    activeStation={activeStation}
                    customUrl={customUrl}
                    isCustomActive={isCustomActive}
                    isPlaying={radioPlaying}
                    status={radioStatus}
                    volume={radioVolume}
                    errorMessage={radioError}
                    ambienceMix={hud.ambienceMix}
                    soundMuted={hud.soundMuted}
                    onToggleMute={onToggleMute}
                    onSetAmbienceMix={onSetAmbienceMix}
                    onSelectStation={handleSelectStation}
                    onPlayCustomUrl={handlePlayCustomUrl}
                    onTogglePlay={handleToggleRadioPlay}
                    onVolumeChange={setRadioVolume}
                  />
                </div>
              )}

              {/* Tab 7: Fisherman's Journal & Species Field Guide */}
              {activeTab === 'journal' && (
                <div className="space-y-5">
                  <div className="text-xs text-stone-400">
                    أنواع الأسماك في الأعماق: {FISH_SPECIES.length} (تظهر كمفاجأة عند الصيد) · إجمالي الصيد:{' '}
                    {hud.catchHistory.length}
                  </div>

                  <div>
                    <h3 className="font-display text-sm font-semibold text-emerald-300 mb-2.5">
                      أنواع الأسماك وسلوكياتها
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {FISH_SPECIES.map((sp) => {
                        const rec = hud.speciesRecords[sp.id];
                        return (
                          <div key={sp.id} className="p-3 rounded-lg bg-white/5 border border-white/10 text-xs">
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <div>
                                <span className="font-semibold text-stone-100 block">{sp.nameAr}</span>
                                <span className="text-amber-300 text-[11px]">{sp.rarity}</span>
                              </div>
                              <FishIllustration species={sp} className="w-16 h-9 shrink-0" />
                            </div>
                            <p className="text-stone-300 mb-2 leading-relaxed">{sp.descriptionAr}</p>
                            <div className="flex items-center justify-between px-2.5 py-1 rounded bg-black/30 border border-white/10 mb-2 text-[11px] font-mono-nums">
                              <span className="flex items-center gap-1 text-amber-300">
                                <Trophy className="w-3.5 h-3.5 shrink-0" />
                                <span>الوزن القياسي:</span>
                              </span>
                              <span className={rec ? 'text-stone-100 font-semibold' : 'text-stone-500'}>
                                {rec ? `${rec.maxWeightKg} كجم (${rec.maxLengthCm} سم)` : 'لم يُسجّل بعد'}
                              </span>
                            </div>
                            <div className="text-[11px] text-stone-400 space-y-0.5">
                              <div>السلوك: {sp.behaviorLabelAr}</div>
                              <div>المواقع: {sp.preferredZones.map((z) => LAKE_ZONE_LABELS[z]).join(' · ')}</div>
                              <div>
                                الطعوم المفضلة:{' '}
                                {sp.favoriteBaits
                                  .map((bId) => BAIT_CATALOG.find((b) => b.id === bId)?.nameAr ?? bId)
                                  .join('، ')}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <h3 className="font-display text-sm font-semibold text-amber-300 mb-2.5">سجل صيدك الأخير</h3>
                    {hud.catchHistory.length === 0 ? (
                      <div className="p-4 rounded-lg bg-black/25 border border-white/10 text-xs text-stone-400 text-center">
                        لم تصطد أي سمكة بعد — اضغط مطولاً على الشاشة لرمي الصنارة وانتظر مفاجأة الأعماق.
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {hud.catchHistory.map((item) => (
                          <div
                            key={item.id}
                            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs"
                          >
                            <div className="flex items-center gap-2.5">
                              <FishIllustration species={item.species} className="w-12 h-7 shrink-0" />
                              <span className="font-semibold text-stone-100">{item.species.nameAr}</span>
                              {item.isNewRecord && (
                                <span className="inline-flex items-center gap-1 text-[10px] text-amber-200 bg-amber-500/20 border border-amber-400/40 rounded px-1.5 py-0.5">
                                  <Trophy className="w-2.5 h-2.5 text-amber-300" />
                                  قياسي
                                </span>
                              )}
                              <span className="text-stone-400">·</span>
                              <span className="text-stone-300">{LAKE_ZONE_LABELS[item.zone]}</span>
                            </div>
                            <div className="flex items-center gap-3 font-mono-nums text-stone-300">
                              <span>{item.lengthCm} سم</span>
                              <span>{item.weightKg} كجم</span>
                              <span className="text-amber-300">+{item.xpEarned} XP</span>
                              <span className="text-stone-400">{item.released ? 'أُطلقت' : 'محتفظ بها'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
