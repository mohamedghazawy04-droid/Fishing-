import React, { useState } from 'react';
import { Play, Pause, Radio, Volume2, VolumeX, Link2, Waves, Trees, Bird, Music2 } from 'lucide-react';
import { LIVE_RADIO_STATIONS, type AmbienceMix, type LiveRadioStation } from '../types/fishing';

export type RadioStatus = 'idle' | 'loading' | 'playing' | 'error';

interface LiveRadioPlayerProps {
  activeStation: LiveRadioStation | null;
  customUrl: string;
  isCustomActive: boolean;
  isPlaying: boolean;
  status: RadioStatus;
  volume: number;
  errorMessage: string | null;
  ambienceMix: AmbienceMix;
  soundMuted: boolean;
  onToggleMute: (muted: boolean) => void;
  onSetAmbienceMix: (mix: Partial<AmbienceMix>) => void;
  onSelectStation: (station: LiveRadioStation) => void;
  onPlayCustomUrl: (url: string) => void;
  onTogglePlay: () => void;
  onVolumeChange: (vol: number) => void;
}

export const LiveRadioPlayer: React.FC<LiveRadioPlayerProps> = ({
  activeStation,
  customUrl,
  isCustomActive,
  isPlaying,
  status,
  volume,
  errorMessage,
  ambienceMix,
  soundMuted,
  onToggleMute,
  onSetAmbienceMix,
  onSelectStation,
  onPlayCustomUrl,
  onTogglePlay,
  onVolumeChange,
}) => {
  const [draftUrl, setDraftUrl] = useState(customUrl);
  const [stationFilter, setStationFilter] = useState<'all' | 'arabic' | 'chill'>('all');

  const filteredStations =
    stationFilter === 'all'
      ? LIVE_RADIO_STATIONS
      : LIVE_RADIO_STATIONS.filter((s) => s.category === stationFilter);

  const statusText =
    status === 'loading'
      ? 'جاري الاتصال بالبث المباشر...'
      : status === 'playing'
        ? 'البث المباشر يعمل الآن'
        : status === 'error'
          ? errorMessage || 'تعذر تشغيل هذا البث، جرّب محطة أخرى'
          : 'متوقف — اختر محطة للاستماع أثناء الصيد';

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draftUrl.trim();
    if (!trimmed) return;
    onPlayCustomUrl(trimmed);
  };

  const ambienceChannels: Array<{
    key: keyof AmbienceMix;
    label: string;
    subtitle: string;
    icon: React.ReactNode;
    accentClass: string;
  }> = [
    {
      key: 'water',
      label: 'خرير المياه والموج',
      subtitle: 'تلاطم لطيف يتفاعل مع سرعة الرياح',
      icon: <Waves className="w-3.5 h-3.5 text-sky-300 shrink-0" />,
      accentClass: 'accent-sky-400',
    },
    {
      key: 'trees',
      label: 'حفيف الأشجار والنسيم',
      subtitle: 'همس أوراق الوادي في الاتجاهين',
      icon: <Trees className="w-3.5 h-3.5 text-emerald-300 shrink-0" />,
      accentClass: 'accent-emerald-400',
    },
    {
      key: 'birds',
      label: 'طيور الجبل المتقطعة',
      subtitle: 'تغريد هادئ مع صدى القمم',
      icon: <Bird className="w-3.5 h-3.5 text-amber-300 shrink-0" />,
      accentClass: 'accent-amber-400',
    },
    {
      key: 'frogs',
      label: 'نقيق الضفادع',
      subtitle: 'أصوات الضفادع على أوراق الزنبق والضفاف',
      icon: <Music2 className="w-3.5 h-3.5 text-lime-300 shrink-0" />,
      accentClass: 'accent-lime-400',
    },
  ];

  return (
    <div className="pt-3 space-y-3 text-xs">
      {/* Nature Ambience Sound Library Mixer */}
      <div className="p-2.5 rounded-lg bg-white/5 border border-white/10">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="text-stone-200 font-semibold flex items-center gap-1.5">
            <Waves className="w-3.5 h-3.5 text-emerald-300" />
            <span>مكتبة الأصوات المحيطية للطبيعة</span>
          </div>
          <button
            type="button"
            onClick={() => onToggleMute(!soundMuted)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] transition-colors ${
              soundMuted
                ? 'bg-rose-500/20 border-rose-400/50 text-rose-200 hover:bg-rose-500/30'
                : 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/25'
            }`}
          >
            {soundMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
            <span>{soundMuted ? 'صوت الطبيعة مكتوم — انقر للتشغيل' : 'صوت الطبيعة مفعّل'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {ambienceChannels.map((ch) => {
            const pct = Math.round(ambienceMix[ch.key] * 100);
            return (
              <div
                key={ch.key}
                className="px-2.5 py-2 rounded-md bg-black/25 border border-white/10 flex flex-col gap-1"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="flex items-center gap-1.5 text-stone-100 font-medium truncate">
                    {ch.icon}
                    <span className="truncate">{ch.label}</span>
                  </span>
                  <span className="font-mono-nums text-[11px] text-stone-300 shrink-0">{pct}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={ambienceMix[ch.key]}
                  onChange={(e) => onSetAmbienceMix({ [ch.key]: parseFloat(e.target.value) })}
                  aria-label={ch.label}
                  className={`w-full cursor-pointer ${ch.accentClass}`}
                />
                <div className="text-[10px] text-stone-400 truncate">{ch.subtitle}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Live Internet Radio Stations & Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2">
          <div className="text-stone-400 mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-stone-200 font-medium">
                <Radio className="w-3.5 h-3.5 text-amber-300" />
                <span>محطات الراديو</span>
              </span>
              <div className="flex items-center gap-1 bg-black/30 p-0.5 rounded border border-white/10">
                {[
                  { id: 'all' as const, label: 'الكل' },
                  { id: 'arabic' as const, label: 'مصرية وعربية' },
                  { id: 'chill' as const, label: 'هادئة' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setStationFilter(f.id)}
                    className={`px-2 py-0.5 rounded text-[11px] transition-colors whitespace-nowrap ${
                      stationFilter === f.id
                        ? 'bg-amber-500/25 text-amber-200 font-medium'
                        : 'text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <span
              className={
                status === 'playing'
                  ? 'text-emerald-300'
                  : status === 'error'
                    ? 'text-rose-300'
                    : status === 'loading'
                      ? 'text-amber-300'
                      : 'text-stone-400'
              }
            >
              {statusText}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-36 overflow-y-auto pl-1">
            {filteredStations.map((station) => {
              const selected = !isCustomActive && activeStation?.id === station.id;
              return (
                <button
                  key={station.id}
                  type="button"
                  onClick={() => onSelectStation(station)}
                  className={`flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border text-right transition-colors ${
                    selected
                      ? 'bg-emerald-600/25 border-emerald-400 text-emerald-100'
                      : 'bg-white/5 border-white/10 text-stone-200 hover:bg-white/10'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{station.nameAr}</div>
                    <div className="text-[11px] text-stone-400 truncate">{station.genreAr}</div>
                  </div>
                  <span className="shrink-0 text-[11px] font-medium text-amber-300">
                    {selected && status === 'loading'
                      ? 'اتصال...'
                      : selected && isPlaying
                        ? 'إيقاف'
                        : 'تشغيل'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Playback controls + Custom stream URL */}
        <div className="flex flex-col justify-between gap-2.5">
          <div className="p-2.5 rounded-lg bg-white/5 border border-white/10 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={onTogglePlay}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition-colors whitespace-nowrap ${
                  isPlaying || status === 'loading'
                    ? 'bg-amber-500 hover:bg-amber-400 text-stone-950'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {isPlaying || status === 'loading' ? (
                  <Pause className="w-3.5 h-3.5" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                <span>
                  {status === 'loading' ? 'إلغاء الاتصال' : isPlaying ? 'إيقاف مؤقت' : 'تشغيل البث'}
                </span>
              </button>

              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Volume2 className="w-3.5 h-3.5 text-stone-300 shrink-0" />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                  aria-label="مستوى صوت الراديو"
                  className="w-full accent-emerald-400 cursor-pointer"
                />
              </div>
            </div>

            <form onSubmit={handleCustomSubmit} className="space-y-1.5">
              <label className="text-[11px] text-stone-400 flex items-center gap-1">
                <Link2 className="w-3 h-3" />
                <span>أو أدخل رابط بث مباشر (MP3 / AAC / HTTPS)</span>
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="url"
                  dir="ltr"
                  value={draftUrl}
                  onChange={(e) => setDraftUrl(e.target.value)}
                  placeholder="https://stream.radioparadise.com/mellow-128"
                  className="flex-1 min-w-0 px-2.5 py-1.5 rounded bg-black/40 border border-white/15 text-stone-100 placeholder:text-stone-500 text-[11px] focus:outline-none focus:border-emerald-400"
                />
                <button
                  type="submit"
                  className="px-2.5 py-1.5 rounded bg-white/10 hover:bg-white/20 text-stone-100 border border-white/15 whitespace-nowrap shrink-0"
                >
                  تشغيل
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
