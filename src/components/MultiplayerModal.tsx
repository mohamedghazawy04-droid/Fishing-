import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Link2,
  LogOut,
  PlusCircle,
  UserCheck,
  Users,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import {
  AVATAR_STYLE_OPTIONS,
  type ConnectionStatus,
  type PlayerAvatarStyle,
  type PlayerCharacterProfile,
  type PlayerSyncState,
} from '../types/multiplayer';

interface MultiplayerModalProps {
  open: boolean;
  onClose: () => void;
  profile: PlayerCharacterProfile;
  onSaveProfile: (next: PlayerCharacterProfile) => void;
  connectionStatus: ConnectionStatus;
  roomCode: string | null;
  selfId: string | null;
  players: PlayerSyncState[];
  errorMessage: string | null;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onQuickJoin: () => void;
  onLeaveRoom: () => void;
  onOpenChat: () => void;
}

export const MultiplayerModal: React.FC<MultiplayerModalProps> = ({
  open,
  onClose,
  profile,
  onSaveProfile,
  connectionStatus,
  roomCode,
  selfId,
  players,
  errorMessage,
  onCreateRoom,
  onJoinRoom,
  onQuickJoin,
  onLeaveRoom,
  onOpenChat,
}) => {
  const [nameInput, setNameInput] = useState(profile.name);
  const [avatarInput, setAvatarInput] = useState<PlayerAvatarStyle>(profile.avatarColor);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [profileSavedToast, setProfileSavedToast] = useState(false);
  const [copiedType, setCopiedType] = useState<'code' | 'link' | null>(null);

  useEffect(() => {
    setNameInput(profile.name);
    setAvatarInput(profile.avatarColor);
  }, [profile.name, profile.avatarColor, open]);

  if (!open) return null;

  const trimmedName = nameInput.trim();
  const isNameValid = trimmedName.length >= 2 && trimmedName.length <= 20;

  const commitProfile = (): PlayerCharacterProfile => {
    const cleanName = isNameValid ? trimmedName : profile.name;
    const next: PlayerCharacterProfile = {
      name: cleanName,
      avatarColor: avatarInput,
    };
    onSaveProfile(next);
    return next;
  };

  const handleSaveProfileClick = () => {
    if (!isNameValid) return;
    commitProfile();
    setProfileSavedToast(true);
    window.setTimeout(() => setProfileSavedToast(false), 1800);
  };

  const copyToClipboard = async (value: string, kind: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedType(kind);
      window.setTimeout(() => setCopiedType(null), 2000);
    } catch {
      // Clipboard blocked in restricted context
    }
  };

  const slot1 = players.find((p) => p.slot === 1) ?? null;
  const slot2 = players.find((p) => p.slot === 2) ?? null;

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/65 backdrop-blur-xs p-3 sm:p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl max-h-[90vh] flex flex-col bg-[#0c161b] border border-white/15 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-white/10 bg-[#091115] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Users className="w-5 h-5 text-emerald-300 shrink-0" />
            <div className="min-w-0">
              <h2 className="font-display text-base sm:text-lg font-bold text-stone-50 truncate">
                اللعب أونلاين (لاعبان) والشخصية
              </h2>
              <p className="text-[11px] text-stone-400 truncate">
                اختر اسم شخصيتك ولونها، ثم أنشئ غرفة أو انضم لصديقك مع شات كتابي مباشر
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق نافذة اللعب أونلاين"
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-stone-300 hover:text-white border border-white/10 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs">
          {/* Section 1: Character Name & Appearance */}
          <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-stone-100 flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-amber-300 shrink-0" />
                <span>هوية شخصيتك في البحيرة</span>
              </span>
              {profileSavedToast && (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300 font-medium">
                  <Check className="w-3.5 h-3.5" />
                  <span>تم حفظ الاسم</span>
                </span>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1">
                <label htmlFor="character-name-input" className="block text-[11px] text-stone-400 mb-1">
                  اسم الشخصية (من 2 إلى 20 حرفاً)
                </label>
                <input
                  id="character-name-input"
                  type="text"
                  maxLength={20}
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveProfileClick();
                  }}
                  placeholder="اكتب اسم شخصيتك..."
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/15 focus:border-emerald-400 focus:outline-none text-stone-100 text-xs"
                />
              </div>

              <div className="sm:self-end">
                <button
                  type="button"
                  disabled={!isNameValid}
                  onClick={handleSaveProfileClick}
                  className="w-full sm:w-auto px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 disabled:text-stone-400 text-white font-semibold transition-colors whitespace-nowrap"
                >
                  حفظ الاسم
                </button>
              </div>
            </div>

            <div>
              <div className="text-[11px] text-stone-400 mb-1.5">لون سترة الصياد</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {AVATAR_STYLE_OPTIONS.map((opt) => {
                  const active = avatarInput === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setAvatarInput(opt.id);
                        onSaveProfile({
                          name: isNameValid ? trimmedName : profile.name,
                          avatarColor: opt.id,
                        });
                      }}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-[11px] font-medium transition-colors ${
                        active
                          ? 'bg-white/12 border-emerald-400 text-stone-50'
                          : 'bg-black/30 border-white/10 text-stone-300 hover:bg-white/8'
                      }`}
                    >
                      <span className={`w-3 h-3 rounded-full shrink-0 ${opt.dotClass}`} />
                      <span className="truncate">{opt.labelAr}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {errorMessage && (
            <div className="p-2.5 rounded-lg bg-rose-950/70 border border-rose-400/50 text-rose-100 text-[11px] font-medium">
              {errorMessage}
            </div>
          )}

          {/* Section 2: Active 2-Player Room OR Room Creation/Join */}
          {roomCode ? (
            <div className="p-3.5 rounded-xl bg-emerald-950/25 border border-emerald-400/35 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Wifi className="w-4 h-4 text-emerald-300" />
                  <span className="font-bold text-emerald-100">متصل بالغرفة:</span>
                  <span
                    dir="ltr"
                    className="font-mono-nums px-2.5 py-0.5 rounded-md bg-black/45 border border-emerald-400/40 text-emerald-200 font-bold tracking-widest text-sm"
                  >
                    {roomCode}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => copyToClipboard(roomCode, 'code')}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/8 hover:bg-white/15 border border-white/12 text-stone-100 text-[11px] transition-colors"
                  >
                    {copiedType === 'code' ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedType === 'code' ? 'تم النسخ' : 'نسخ الرمز'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const url = new URL(window.location.href);
                      url.searchParams.set('room', roomCode);
                      void copyToClipboard(url.toString(), 'link');
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/35 border border-sky-400/40 text-sky-100 text-[11px] transition-colors"
                  >
                    {copiedType === 'link' ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Link2 className="w-3.5 h-3.5" />}
                    <span>{copiedType === 'link' ? 'نُسخ الرابط!' : 'نسخ رابط الدعوة'}</span>
                  </button>
                </div>
              </div>

              {/* 2-Player Slots */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {[slot1, slot2].map((player, idx) => {
                  const slotNum = idx + 1;
                  const isSelf = player?.id === selfId;
                  const styleOpt = player
                    ? AVATAR_STYLE_OPTIONS.find((s) => s.id === player.avatarColor) ?? AVATAR_STYLE_OPTIONS[0]
                    : null;

                  return (
                    <div
                      key={slotNum}
                      className={`p-3 rounded-lg border ${
                        player
                          ? isSelf
                            ? 'bg-emerald-500/12 border-emerald-400/45'
                            : 'bg-sky-500/12 border-sky-400/45'
                          : 'bg-black/30 border-dashed border-white/15'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5 mb-1">
                        <span className="text-[10px] font-semibold text-stone-400">
                          اللاعب {slotNum} {isSelf ? '(أنت)' : ''}
                        </span>
                        {player && styleOpt && (
                          <span className={`w-2.5 h-2.5 rounded-full ${styleOpt.dotClass}`} />
                        )}
                      </div>

                      {player ? (
                        <>
                          <div className="font-bold text-stone-50 text-sm truncate">{player.name}</div>
                          <div className="text-[11px] text-stone-300 mt-0.5 flex flex-wrap items-center gap-1.5">
                            <span>المستوى {player.level}</span>
                            <span>·</span>
                            <span>{player.isOnBoat ? 'على القارب' : 'على الرصيف'}</span>
                            <span>·</span>
                            <span>صيد: {player.catchesCount}</span>
                          </div>
                        </>
                      ) : (
                        <div className="text-stone-400 py-1.5 text-[11px]">
                          في انتظار انضمام اللاعب الثاني... أرسل له الرمز أو رابط الدعوة.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onOpenChat();
                    onClose();
                  }}
                  className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors"
                >
                  فتح الشات الكتابي والعودة للبحيرة
                </button>

                <button
                  type="button"
                  onClick={onLeaveRoom}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-500/18 hover:bg-rose-500/30 border border-rose-400/45 text-rose-100 font-medium transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>مغادرة الغرفة</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[11px] text-stone-400">
                <span className="flex items-center gap-1.5">
                  {connectionStatus === 'connecting' ? (
                    <Wifi className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
                  ) : (
                    <WifiOff className="w-3.5 h-3.5 text-stone-400" />
                  )}
                  <span>
                    {connectionStatus === 'connecting'
                      ? 'جاري الاتصال بالخادم...'
                      : 'الحد الأقصى للغرفة: لاعبان (أنت وصديقك)'}
                  </span>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    commitProfile();
                    onCreateRoom();
                  }}
                  className="p-3.5 rounded-xl bg-emerald-600/22 hover:bg-emerald-600/35 border border-emerald-400/50 text-right transition-colors flex flex-col gap-1"
                >
                  <div className="flex items-center gap-1.5 font-bold text-emerald-100 text-sm">
                    <PlusCircle className="w-4 h-4 text-emerald-300 shrink-0" />
                    <span>إنشاء غرفة خاصة (2 لاعبين)</span>
                  </div>
                  <p className="text-[11px] text-stone-300">
                    أنشئ غرفة برمز فريد وشاركه مع صديقك للعب والتحدث معاً.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    commitProfile();
                    onQuickJoin();
                  }}
                  className="p-3.5 rounded-xl bg-sky-600/22 hover:bg-sky-600/35 border border-sky-400/50 text-right transition-colors flex flex-col gap-1"
                >
                  <div className="flex items-center gap-1.5 font-bold text-sky-100 text-sm">
                    <Zap className="w-4 h-4 text-sky-300 shrink-0" />
                    <span>انضمام سريع أونلاين</span>
                  </div>
                  <p className="text-[11px] text-stone-300">
                    يدخلك تلقائياً مع لاعب ينتظر شريكاً، أو يفتح لك غرفة جديدة.
                  </p>
                </button>
              </div>

              {/* Join with Code */}
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10">
                <label htmlFor="join-room-code" className="block text-[11px] text-stone-300 font-medium mb-1.5">
                  أو انضم برمز غرفة صديقك
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="join-room-code"
                    dir="ltr"
                    type="text"
                    maxLength={8}
                    value={joinCodeInput}
                    onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && joinCodeInput.trim().length >= 3) {
                        commitProfile();
                        onJoinRoom(joinCodeInput.trim());
                      }
                    }}
                    placeholder="مثال: A4K92"
                    className="flex-1 px-3 py-2 rounded-lg bg-black/45 border border-white/15 focus:border-sky-400 focus:outline-none text-stone-100 font-mono-nums uppercase tracking-widest text-xs"
                  />
                  <button
                    type="button"
                    disabled={joinCodeInput.trim().length < 3}
                    onClick={() => {
                      commitProfile();
                      onJoinRoom(joinCodeInput.trim());
                    }}
                    className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:bg-stone-700 disabled:text-stone-400 text-white font-semibold transition-colors whitespace-nowrap"
                  >
                    دخول الغرفة
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
