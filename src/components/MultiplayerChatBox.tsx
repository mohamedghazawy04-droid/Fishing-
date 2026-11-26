import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, Minus, Send, Sparkles } from 'lucide-react';
import {
  AVATAR_STYLE_OPTIONS,
  type ChatMessage,
  type PlayerSyncState,
} from '../types/multiplayer';

interface MultiplayerChatBoxProps {
  roomCode: string | null;
  selfId: string | null;
  players: PlayerSyncState[];
  messages: ChatMessage[];
  open: boolean;
  unreadCount: number;
  onToggleOpen: () => void;
  onSendMessage: (text: string) => void;
  onOpenRoomModal: () => void;
}

function formatMsgTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export const MultiplayerChatBox: React.FC<MultiplayerChatBoxProps> = ({
  roomCode,
  selfId,
  players,
  messages,
  open,
  unreadCount,
  onToggleOpen,
  onSendMessage,
  onOpenRoomModal,
}) => {
  const [draft, setDraft] = useState('');
  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, open]);

  if (!roomCode) return null;

  const partner = players.find((p) => p.id !== selfId) ?? null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSendMessage(text);
    setDraft('');
  };

  if (!open) {
    return (
      <div className="pointer-events-auto fixed bottom-4 right-3 sm:bottom-5 sm:right-5 z-25">
        <button
          type="button"
          onClick={onToggleOpen}
          className="relative flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#0a1419]/90 hover:bg-[#102129] border border-emerald-400/45 text-stone-100 text-xs font-semibold shadow-xl transition-colors"
        >
          <MessageSquare className="w-4 h-4 text-emerald-300 shrink-0" />
          <span>شات الغرفة ({players.length}/2)</span>
          {unreadCount > 0 && (
            <span className="font-mono-nums px-1.5 py-0.5 rounded-full bg-amber-500 text-stone-950 text-[10px] font-bold">
              {unreadCount}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto fixed bottom-16 right-3 sm:bottom-5 sm:right-5 z-25 w-[calc(100vw-1.5rem)] max-w-xs sm:w-80 rounded-2xl bg-[#091318]/92 backdrop-blur-md border border-white/15 shadow-2xl overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/10 bg-white/[0.03] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="w-4 h-4 text-emerald-300 shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-bold text-stone-100 truncate">
              شات الصيادين ({players.length}/2)
            </div>
            <div className="text-[10px] text-stone-400 truncate">
              {partner ? `معك: ${partner.name}` : 'في انتظار دخول اللاعب الثاني...'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onOpenRoomModal}
            className="px-2 py-0.5 rounded bg-white/8 hover:bg-white/15 text-[10px] font-mono-nums text-emerald-200 border border-white/10"
            title="عرض رمز الغرفة واللاعبين"
          >
            {roomCode}
          </button>
          <button
            type="button"
            onClick={onToggleOpen}
            aria-label="تصغير الشات"
            className="p-1 rounded-lg hover:bg-white/10 text-stone-300 hover:text-white transition-colors"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Messages Feed */}
      <div className="h-52 overflow-y-auto p-2.5 space-y-2 text-xs">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center text-[11px] text-stone-400 px-4">
            ابدأ المحادثة مع شريكك في الصيد! ستظهر رسائلكم وإشعارات الصيد هنا.
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.kind === 'system' || msg.kind === 'catch') {
              return (
                <div
                  key={msg.id}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] text-center border ${
                    msg.kind === 'catch'
                      ? 'bg-amber-500/15 border-amber-400/35 text-amber-100 font-medium'
                      : 'bg-white/[0.04] border-white/8 text-stone-300'
                  }`}
                >
                  {msg.kind === 'catch' && (
                    <Sparkles className="w-3 h-3 text-amber-300 inline-block ml-1 -mt-0.5" />
                  )}
                  <span>{msg.text}</span>
                </div>
              );
            }

            const isSelf = msg.senderId === selfId;
            const dotClass =
              AVATAR_STYLE_OPTIONS.find((s) => s.id === msg.avatarColor)?.dotClass ?? 'bg-sky-400';

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isSelf ? 'items-start' : 'items-end'}`}
              >
                <div className="flex items-center gap-1.5 text-[10px] text-stone-400 mb-0.5 px-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
                  <span className="font-semibold text-stone-300">
                    {isSelf ? `${msg.senderName} (أنت)` : msg.senderName}
                  </span>
                  <span className="font-mono-nums text-[9px] text-stone-500">
                    {formatMsgTime(msg.timestamp)}
                  </span>
                </div>
                <div
                  className={`max-w-[88%] px-2.5 py-1.5 rounded-xl text-xs leading-relaxed break-words ${
                    isSelf
                      ? 'bg-emerald-600/30 border border-emerald-400/35 text-stone-50'
                      : 'bg-sky-600/25 border border-sky-400/35 text-stone-50'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            );
          })
        )}
        <div ref={listEndRef} />
      </div>

      {/* Input Bar */}
      <form
        onSubmit={handleSubmit}
        className="p-2 border-t border-white/10 bg-black/35 flex items-center gap-1.5"
      >
        <input
          type="text"
          maxLength={240}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="اكتب رسالة لصديقك..."
          className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-white/6 border border-white/12 focus:border-emerald-400 focus:outline-none text-xs text-stone-100 placeholder:text-stone-500"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label="إرسال رسالة"
          className="p-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 disabled:text-stone-400 text-white transition-colors shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
};
