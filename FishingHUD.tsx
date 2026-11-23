import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Compass,
  Volume2,
  VolumeX,
  BookOpen,
  X,
  Lock,
  Check,
  ArrowUpRight,
  Radio,
  Film,
  Eye,
  EyeOff,
  Trophy,
  Sparkles,
} from 'lucide-react';
import {
  BAIT_CATALOG,
  FISH_SPECIES,
  HOOK_CATALOG,
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
  type LiveRadioStation,
  type SeasonId,
  type SkillKey,
  type TimePresetId,
  type WeatherType,
} from '../types/fishing';
import { LiveRadioPlayer, type RadioStatus } from './LiveRadioPlayer';
import { GRAPHICS_QUALITY_LABELS, type GraphicsQuality } from '../three/postFx';

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
  onSetGraphicsQuality: (q: GraphicsQuality) => void;
  onUpgradeSkill: (key: SkillKey) => void;
  onResolveCatch: (release: boolean) => void;
}

type DockTab = 'fishing' | 'atmosphere' | 'skills' | 'quests' | 'radio';

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
  onSetGraphicsQuality,
  onUpgradeSkill,
  onResolveCatch,
}) => {
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<DockTab>('fishing');
  const [journalOpen, setJournalOpen] = useState(false);
  const [catchCardHidden, setCatchCardHidden] = useState(false);

  useEffect(() => {
    if (hud.phase !== 'caught') {
      setCatchCardHidden(false);
    }
  }, [hud.phase]);

  // Persistent Live Internet Radio state (survives tab switches and dock collapse)
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
      if (e.key === 'h' || e.key === 'H' || e.key === 'ا') {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        setDockCollapsed((prev) => !prev);
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

    // Direct src assignment + play() preserves user gesture activation and avoids load() AbortError
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
    if (!dockCollapsed) {
      setActiveTab('radio');
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
  const nextThreshold = getNextLevelThreshold(hud.progression.level);
  const prevThreshold = hud.progression.level > 1 ? getNextLevelThreshold(hud.progression.level - 1) : 0;
  const levelProgressPct = Math.min(
    100,
    Math.max(0, ((hud.progression.totalXp - prevThreshold) / Math.max(1, nextThreshold - prevThreshold)) * 100),
  );

  const primaryLabel =
    hud.phase === 'idle'
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

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between">
      {/* Persistent HTML5 audio stream player (never unmounts on tab switch or dock collapse) */}
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

      {/* Top Minimal Atmospheric Bar (No pill boxes, no backdrop-blur, clean unboxed metadata) */}
      <header className="pointer-events-auto flex items-center justify-between gap-4 px-5 py-3.5 bg-gradient-to-b from-[#081014]/75 via-[#081014]/35 to-transparent">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
          <h1 className="font-display text-base sm:text-lg font-bold text-stone-50 tracking-tight whitespace-nowrap shrink-0">
            وادي الصيد الهادئ
          </h1>
          <span className="text-stone-400/70 hidden sm:inline" aria-hidden="true">·</span>
          <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-stone-200/90 font-mono-nums">
            <span>المستوى {hud.progression.level}</span>
            <span className="text-stone-400/70" aria-hidden="true">·</span>
            <span className="text-amber-300">{hud.progression.availableXp} خبرة متاحة</span>
            <span className="text-stone-400/70" aria-hidden="true">·</span>
            <span>{formatHourToClock(hud.timeOfDay)}</span>
            <span className="text-stone-400/70" aria-hidden="true">·</span>
            <span>{currentSeason.nameAr}</span>
            <span className="text-stone-400/70" aria-hidden="true">·</span>
            <span>{currentWeatherLabel}</span>
            <span className="text-stone-400/70 hidden md:inline" aria-hidden="true">·</span>
            <span className="hidden md:inline text-stone-300">رياح {hud.windSpeedKmh} كم/س</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleToggleRadioPlay}
            title="تشغيل أو إيقاف الراديو المباشر"
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              radioPlaying
                ? 'bg-amber-500/20 border-amber-400/60 text-amber-200 hover:bg-amber-500/30'
                : radioStatus === 'loading'
                  ? 'bg-sky-500/20 border-sky-400/60 text-sky-200 hover:bg-sky-500/30'
                  : 'text-stone-100 bg-[#0d171c]/85 hover:bg-[#16252c] border-white/15'
            }`}
          >
            <Radio
              className={`w-3.5 h-3.5 ${
                radioPlaying ? 'text-amber-300' : radioStatus === 'loading' ? 'text-sky-300' : 'text-stone-300'
              }`}
            />
            <span className="hidden sm:inline">
              {radioStatus === 'loading'
                ? 'جاري الاتصال...'
                : radioPlaying
                  ? 'إيقاف البث'
                  : 'راديو حي'}
            </span>
          </button>

          <button
            type="button"
            onClick={onToggleCinematic}
            title="تشغيل أو إيقاف اللقطة السينمائية حول البحيرة"
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              hud.cinematicActive
                ? 'bg-emerald-500/25 border-emerald-400/60 text-emerald-100 hover:bg-emerald-500/35'
                : 'text-stone-100 bg-[#0d171c]/85 hover:bg-[#16252c] border-white/15'
            }`}
          >
            <Film className={`w-3.5 h-3.5 ${hud.cinematicActive ? 'text-emerald-300' : 'text-stone-300'}`} />
            <span className="hidden sm:inline">{hud.cinematicActive ? 'إنهاء السينمائي' : 'لقطة سينمائية'}</span>
          </button>

          <button
            type="button"
            disabled={hud.graphicsLocked}
            onClick={() => {
              const order: GraphicsQuality[] = ['ultra', 'high', 'medium'];
              const next = order[(order.indexOf(hud.graphicsQuality) + 1) % order.length];
              onSetGraphicsQuality(next);
            }}
            title={
              hud.graphicsLocked
                ? 'الرسوميات ثابتة لأن المتصفح يعمل بدون تسريع الكرت'
                : 'تبديل جودة الرسوميات: فائقة / عالية / متوسطة'
            }
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-100 bg-[#0d171c]/85 hover:bg-[#16252c] border border-white/15 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span className="hidden sm:inline">جودة: {GRAPHICS_QUALITY_LABELS[hud.graphicsQuality]}</span>
          </button>

          <button
            type="button"
            onClick={onResetLook}
            title="توسيط النظر نحو البحيرة"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-100 bg-[#0d171c]/85 hover:bg-[#16252c] border border-white/15 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Compass className="w-3.5 h-3.5 text-emerald-300" />
            <span className="hidden sm:inline">توسيط النظر</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleMute(!hud.soundMuted)}
            title={hud.soundMuted ? 'تشغيل صوت الطبيعة' : 'كتم صوت الطبيعة'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-100 bg-[#0d171c]/85 hover:bg-[#16252c] border border-white/15 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {hud.soundMuted ? (
              <VolumeX className="w-3.5 h-3.5 text-stone-400" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 text-emerald-300" />
            )}
            <span className="hidden sm:inline">{hud.soundMuted ? 'صامت' : 'الطبيعة'}</span>
          </button>

          <button
            type="button"
            onClick={() => setJournalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-100 bg-[#0d171c]/85 hover:bg-[#16252c] border border-white/15 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <BookOpen className="w-3.5 h-3.5 text-amber-300" />
            <span>السجل ({hud.catchHistory.length})</span>
          </button>
        </div>
      </header>

      {/* Subtle Contextual Feedback (only visible during active cast/bite/fight/notices, never blocks horizon) */}
      <div className="pointer-events-none flex flex-col items-center justify-center gap-2.5 px-4">
        {hud.cinematicActive && (
          <div className="pointer-events-auto flex items-center gap-3 px-4 py-1.5 rounded-lg bg-[#0d171c]/88 border border-emerald-400/35 text-stone-100 text-xs shadow-lg">
            <Film className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
            <span>وضع اللقطة السينمائية — حرّك الشاشة أو اضغط للعودة إلى الكرسي</span>
            <button
              type="button"
              onClick={onToggleCinematic}
              className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium transition-colors shrink-0"
            >
              العودة للكرسي
            </button>
          </div>
        )}

        {hud.newlyUnlockedNotice && (
          <div className="px-4 py-2 rounded-lg bg-[#112622]/95 border border-emerald-400/40 text-emerald-100 text-xs sm:text-sm font-medium shadow-lg">
            {hud.newlyUnlockedNotice}
          </div>
        )}

        {hud.questNotice && (
          <div className="px-4 py-2 rounded-lg bg-[#2a2210]/95 border border-amber-400/50 text-amber-100 text-xs sm:text-sm font-medium shadow-lg flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-300 shrink-0" />
            <span>{hud.questNotice}</span>
          </div>
        )}

        {radioError && (dockCollapsed || activeTab !== 'radio') && (
          <div className="px-4 py-2 rounded-lg bg-[#2b1414]/95 border border-rose-400/40 text-rose-100 text-xs sm:text-sm font-medium shadow-lg">
            {radioError}
          </div>
        )}

        {hud.lineSnappedNotice && (
          <div className="px-4 py-2 rounded-lg bg-[#2b1414]/95 border border-rose-400/40 text-rose-100 text-xs sm:text-sm font-medium shadow-lg">
            {hud.lineSnappedNotice}
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
            <div className="text-sm font-bold text-amber-200 mb-1">غمزت السمكة! اضغط على الشاشة أو Space لتثبيت الخطاف</div>
            <div className="h-1.5 w-48 mx-auto bg-stone-800 rounded overflow-hidden">
              <div
                className="h-full bg-amber-400"
                style={{ width: `${Math.round(hud.biteUrgency * 100)}%` }}
              />
            </div>
          </div>
        )}

        {hud.phase === 'reeling' && (
          <div className="w-72 bg-[#0d171c]/92 border border-white/15 rounded-lg p-3 shadow-lg">
            <div className="flex items-center justify-between text-xs text-stone-200 mb-1.5">
              <span className="font-semibold text-emerald-200">{hud.hookedSpeciesName}</span>
              <span className="font-mono-nums text-stone-300">المسافة {hud.fishDistance} م</span>
            </div>
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
              <div
                className="h-full bg-sky-400"
                style={{ width: `${Math.round(hud.fishStamina * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Active Catch Celebration Card (positioned to the side so 3D fish showcase stays unobstructed) */}
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

              <div className="grid grid-cols-2 gap-2 font-mono-nums text-xs text-stone-200 bg-white/5 px-3 py-1.5 rounded-lg border border-white/10 mb-2.5">
                <div>الطول: {hud.activeCatch.lengthCm} سم</div>
                <div>الوزن: {hud.activeCatch.weightKg} كجم</div>
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

      {/* Bottom Collapsible Control Dock (Zero Viewport Occlusion) */}
      <div className="pointer-events-none flex flex-col items-center pb-4 px-3">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="pointer-events-auto flex items-center gap-1.5 px-3.5 py-1 rounded-t-lg bg-[#0d171c]/92 border border-b-0 border-white/15 text-[11px] text-stone-200 hover:text-white transition-colors"
        >
          {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>{dockCollapsed ? 'إظهار لوحة التحكم (H)' : 'إخفاء اللوحة للتأمل (H)'}</span>
        </button>

        {!dockCollapsed && (
          <div className="pointer-events-auto w-full max-w-[920px] bg-[#0d171c]/92 border border-white/15 rounded-xl p-3.5 shadow-2xl">
            {/* Top Row inside Dock: Status + Primary Action Button + Tab Switcher */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <button
                  type="button"
                  onPointerDown={onPrimaryPress}
                  onPointerUp={onPrimaryRelease}
                  onPointerLeave={() => {
                    if (hud.phase === 'charging' || hud.phase === 'reeling') onPrimaryRelease();
                  }}
                  disabled={hud.phase === 'casting' || hud.phase === 'caught'}
                  className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    hud.phase === 'biting'
                      ? 'bg-amber-500 hover:bg-amber-400 text-stone-950'
                      : hud.phase === 'reeling'
                        ? 'bg-sky-600 hover:bg-sky-500 text-white'
                        : 'bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 disabled:text-stone-400 text-white'
                  }`}
                >
                  {primaryLabel}
                </button>
                <div className="text-xs text-stone-300 truncate" title={hud.statusMessage}>
                  {hud.statusMessage}
                </div>
              </div>

              {/* Segmented Tabs */}
              <div className="flex items-center gap-1 p-1 bg-black/35 rounded-lg border border-white/10 shrink-0 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setActiveTab('fishing')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    activeTab === 'fishing' ? 'bg-stone-100 text-stone-900' : 'text-stone-300 hover:text-white'
                  }`}
                >
                  العدة والعمق
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('atmosphere')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    activeTab === 'atmosphere' ? 'bg-stone-100 text-stone-900' : 'text-stone-300 hover:text-white'
                  }`}
                >
                  الطقس والأوقات
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('skills')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    activeTab === 'skills' ? 'bg-stone-100 text-stone-900' : 'text-stone-300 hover:text-white'
                  }`}
                >
                  المهارات والتقدم
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('quests')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    activeTab === 'quests' ? 'bg-stone-100 text-stone-900' : 'text-stone-300 hover:text-white'
                  }`}
                >
                  المهام والإنجازات
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('radio')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    activeTab === 'radio' ? 'bg-stone-100 text-stone-900' : 'text-stone-300 hover:text-white'
                  }`}
                >
                  الصوت والراديو
                </button>
              </div>
            </div>

            {/* Tab 1: Fishing Gear, Baits, Hooks & Depth */}
            {activeTab === 'fishing' && (
              <div className="pt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div>
                  <div className="text-stone-400 mb-1.5">الطعم المستخدم</div>
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
                  <div className="text-stone-400 mb-1.5">نوع الخطاف</div>
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
                  <div className="text-stone-400 mb-1.5 flex items-center justify-between">
                    <span>عمق الطعم تحت العوامة</span>
                    {hud.currentCastZone && (
                      <span className="text-emerald-300">{LAKE_ZONE_LABELS[hud.currentCastZone]}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {[
                      { label: 'سطحي 0.6م', val: 0.6 },
                      { label: 'متوسط 1.5م', val: 1.5 },
                      { label: 'عميق 2.6م', val: 2.6 },
                    ].map((d) => (
                      <button
                        key={d.val}
                        type="button"
                        onClick={() => onSelectDepth(d.val)}
                        className={`flex-1 py-1.5 px-2 rounded-md border text-center transition-colors whitespace-nowrap ${
                          Math.abs(hud.lineDepthMeters - d.val) < 0.35
                            ? 'bg-emerald-600/30 border-emerald-400 text-emerald-100'
                            : 'bg-white/5 border-white/10 text-stone-200 hover:bg-white/10'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-1.5 text-[11px] text-stone-400">
                    اضغط مطولاً على الشاشة للرمي أو السحب · اسحب يميناً ويساراً للالتفات حول الجبال والكرسي
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Dynamic Weather, Seasons & Time of Day */}
            {activeTab === 'atmosphere' && (
              <div className="pt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="space-y-2.5">
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
                        className={`text-[11px] underline shrink-0 ${hud.autoWind ? 'text-emerald-300' : 'text-stone-400'}`}
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
                      className={`text-[11px] underline ${hud.autoWeather ? 'text-emerald-300' : 'text-stone-400'}`}
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
                      className={`text-[11px] underline ${hud.autoTimeCycle ? 'text-emerald-300' : 'text-stone-400'}`}
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
                    className="w-full accent-amber-400 cursor-pointer"
                  />
                  <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-stone-300">اللقطة السينمائية عند الخمول (18ث)</span>
                    <button
                      type="button"
                      onClick={() => onToggleCinematicAuto(!hud.cinematicAutoEnabled)}
                      className={`underline shrink-0 ${
                        hud.cinematicAutoEnabled ? 'text-emerald-300' : 'text-stone-400'
                      }`}
                    >
                      {hud.cinematicAutoEnabled ? 'مفعّلة' : 'متوقفة'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 3: Player XP Progression & Upgradeable Skills */}
            {activeTab === 'skills' && (
              <div className="pt-3 text-xs">
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

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  {SKILL_CATALOG.map((sk) => {
                    const lvl = hud.progression.skills[sk.key];
                    const maxed = lvl >= sk.maxLevel;
                    const cost = getSkillUpgradeCost(sk, lvl);
                    const canAfford = !maxed && hud.progression.availableXp >= cost;

                    return (
                      <div
                        key={sk.key}
                        className="p-2.5 rounded-lg bg-white/5 border border-white/10 flex flex-col justify-between gap-2"
                      >
                        <div>
                          <div className="flex items-center justify-between font-semibold text-stone-100 mb-0.5">
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

            {/* Tab: Daily Quests & Achievements */}
            {activeTab === 'quests' && (
              <div className="pt-3 text-xs">
                {(['daily', 'achievement'] as const).map((kind) => {
                  const items = hud.quests.filter((q) => q.kind === kind);
                  if (items.length === 0) return null;
                  const doneCount = items.filter((q) => q.completed).length;
                  return (
                    <div key={kind} className="mb-3 last:mb-0">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-stone-100">
                          {kind === 'daily' ? 'مهام اليوم (تتجدد كل يوم)' : 'الإنجازات الدائمة'}
                        </span>
                        <span className="text-stone-400 font-mono-nums">
                          {doneCount}/{items.length}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {items.map((q) => {
                          const pct = Math.round((q.progress / q.target) * 100);
                          return (
                            <div
                              key={q.id}
                              className={`p-2.5 rounded-lg border flex flex-col gap-1.5 ${
                                q.completed
                                  ? 'bg-emerald-950/50 border-emerald-500/40'
                                  : 'bg-white/5 border-white/10'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 font-semibold text-stone-100">
                                <span className="flex items-center gap-1.5">
                                  {q.completed ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-300" />
                                  ) : (
                                    <Trophy className="w-3.5 h-3.5 text-amber-300" />
                                  )}
                                  {q.titleAr}
                                </span>
                                <span className="text-amber-300 font-mono-nums text-[11px]">+{q.rewardXp} خبرة</span>
                              </div>
                              <p className="text-[11px] text-stone-400 leading-snug">{q.descriptionAr}</p>
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 flex-1 bg-stone-800 rounded overflow-hidden">
                                  <div
                                    className={`h-full transition-[width] ${q.completed ? 'bg-emerald-400' : 'bg-amber-400'}`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-stone-300 font-mono-nums text-[11px]">
                                  {q.progress}/{q.target}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Tab 4: Nature Ambience Library & Live Internet Radio Streams */}
            {activeTab === 'radio' && (
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
            )}
          </div>
        )}
      </div>

      {/* Fisherman's Journal & Species Field Guide Modal */}
      {journalOpen && (
        <div className="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-3xl max-h-[85vh] overflow-y-auto bg-[#0e181c] border border-white/15 rounded-xl p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-white/10">
              <div>
                <h2 className="font-display text-lg font-bold text-stone-50">دليل أسماك الوادي وسجل الصيد</h2>
                <div className="text-xs text-stone-400">
                  أنواع الأسماك في الأعماق: {FISH_SPECIES.length} (تظهر كمفاجأة عند الصيد) · إجمالي الصيد: {hud.catchHistory.length}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setJournalOpen(false)}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-stone-300 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mb-5">
              <h3 className="font-display text-sm font-semibold text-emerald-300 mb-2.5">أنواع الأسماك وسلوكياتها</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {FISH_SPECIES.map((sp) => (
                  <div key={sp.id} className="p-3 rounded-lg bg-white/5 border border-white/10 text-xs">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div>
                        <span className="font-semibold text-stone-100 block">{sp.nameAr}</span>
                        <span className="text-amber-300 text-[11px]">{sp.rarity}</span>
                      </div>
                      <FishIllustration species={sp} className="w-16 h-9 shrink-0" />
                    </div>
                    <p className="text-stone-300 mb-2 leading-relaxed">{sp.descriptionAr}</p>
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
                ))}
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
        </div>
      )}
    </div>
  );
};
