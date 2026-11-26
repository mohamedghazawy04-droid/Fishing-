import { useEffect, useRef, useState } from 'react';
import { FishingHUD } from './components/FishingHUD';
import { MultiplayerChatBox } from './components/MultiplayerChatBox';
import { MultiplayerModal } from './components/MultiplayerModal';
import {
  MultiplayerClient,
  loadSavedCharacterProfile,
  saveCharacterProfile,
} from './network/multiplayerClient';
import { FishingSceneManager } from './three/FishingSceneManager';
import {
  generateDailyChallenges,
  getTodayDateKey,
  type FishingHudState,
} from './types/fishing';
import type {
  ChatMessage,
  ConnectionStatus,
  PlayerCharacterProfile,
  PlayerSyncState,
} from './types/multiplayer';

const INITIAL_DATE_KEY = getTodayDateKey();

const INITIAL_HUD: FishingHudState = {
  phase: 'idle',
  castPower: 0,
  lineTension: 0,
  fishDistance: 0,
  fishStamina: 0,
  biteUrgency: 0,
  hookedSpeciesName: null,
  underwaterCamActive: false,
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
  hookBaited: false,
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
  regionNameAr: 'البحيرة الرئيسية',
  isOnBoat: false,
  isSailing: false,
  waterDepthUnderPlayer: 1.4,
  pois: [],
  poiDiscoveredNotice: null,
  nearbyPoiName: null,
};

function syncRoomParamInUrl(code: string | null): void {
  try {
    const url = new URL(window.location.href);
    if (code) {
      url.searchParams.set('room', code);
    } else {
      url.searchParams.delete('room');
    }
    window.history.replaceState({}, '', url.toString());
  } catch {
    // Ignore history API errors
  }
}

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const managerRef = useRef<FishingSceneManager | null>(null);
  const mpClientRef = useRef<MultiplayerClient | null>(null);

  const [hud, setHud] = useState<FishingHudState>(INITIAL_HUD);
  const [webglError, setWebglError] = useState(false);

  const [profile, setProfile] = useState<PlayerCharacterProfile>(() => loadSavedCharacterProfile());
  const [mpModalOpen, setMpModalOpen] = useState(false);
  const [mpStatus, setMpStatus] = useState<ConnectionStatus>('disconnected');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [roomPlayers, setRoomPlayers] = useState<PlayerSyncState[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(true);
  const [unreadChat, setUnreadChat] = useState(0);
  const [mpError, setMpError] = useState<string | null>(null);

  const selfIdRef = useRef<string | null>(null);
  const chatOpenRef = useRef(true);
  chatOpenRef.current = chatOpen;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let manager: FishingSceneManager | null = null;
    try {
      manager = new FishingSceneManager(container, (nextState) => {
        setHud(nextState);
      });
      managerRef.current = manager;
    } catch {
      setWebglError(true);
      return;
    }

    const syncRemoteToScene = (players: PlayerSyncState[], myId: string | null) => {
      const partner = players.find((p) => p.id !== myId) ?? null;
      manager?.setRemotePlayerState(partner);
    };

    const initialProfile = loadSavedCharacterProfile();
    const mpClient = new MultiplayerClient(initialProfile, {
      onStatusChange: (status) => {
        setMpStatus(status);
      },
      onRoomJoined: (snapshot) => {
        selfIdRef.current = snapshot.selfId;
        setSelfId(snapshot.selfId);
        setRoomCode(snapshot.roomCode);
        setRoomPlayers(snapshot.players);
        setChatMessages(snapshot.chatHistory);
        setMpError(null);
        setUnreadChat(0);
        syncRoomParamInUrl(snapshot.roomCode);
        syncRemoteToScene(snapshot.players, snapshot.selfId);
      },
      onRoomLeft: () => {
        setRoomCode(null);
        setRoomPlayers([]);
        setChatMessages([]);
        setUnreadChat(0);
        syncRoomParamInUrl(null);
        manager?.setRemotePlayerState(null);
      },
      onPlayersChange: (_code, players) => {
        setRoomPlayers(players);
        syncRemoteToScene(players, selfIdRef.current);
      },
      onRemotePlayerState: (remote) => {
        if (remote.id === selfIdRef.current) return;
        manager?.setRemotePlayerState(remote);
        setRoomPlayers((prev) => {
          const exists = prev.some((p) => p.id === remote.id);
          if (!exists) return [...prev, remote];
          return prev.map((p) => (p.id === remote.id ? remote : p));
        });
      },
      onChatMessage: (message) => {
        setChatMessages((prev) => {
          if (prev.some((m) => m.id === message.id)) return prev;
          const next = [...prev, message];
          return next.length > 80 ? next.slice(next.length - 80) : next;
        });
        if (!chatOpenRef.current && message.senderId !== selfIdRef.current) {
          setUnreadChat((c) => c + 1);
        }
      },
      onError: (message) => {
        setMpError(message);
      },
    });

    mpClient.setSnapshotGetter(() => manager!.getMultiplayerSnapshot());
    manager.setStateFrameHandler((snapshot) => {
      mpClient.maybeSendState(snapshot);
    });
    manager.setCatchBroadcastHandler((speciesName, weightKg) => {
      mpClient.sendCatchAnnouncement(speciesName, weightKg);
    });
    mpClientRef.current = mpClient;

    // Auto-join room from invite URL (?room=XXXXX) if present
    try {
      const params = new URLSearchParams(window.location.search);
      const urlRoom = params.get('room')?.trim().toUpperCase();
      if (urlRoom && /^[A-Z0-9]{3,8}$/.test(urlRoom)) {
        mpClient.joinRoom(urlRoom, initialProfile, manager.getMultiplayerSnapshot(), true);
        setMpModalOpen(true);
      }
    } catch {
      // Ignore URL parse errors
    }

    return () => {
      manager?.setStateFrameHandler(null);
      manager?.setCatchBroadcastHandler(null);
      mpClient.dispose();
      mpClientRef.current = null;
      manager?.dispose();
      managerRef.current = null;
    };
  }, []);

  const handleSaveProfile = (next: PlayerCharacterProfile) => {
    setProfile(next);
    saveCharacterProfile(next);
    mpClientRef.current?.updateProfile(next);
  };

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
        <>
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
            onSailToPoi={(poiId) => managerRef.current?.sailToPoi(poiId)}
            onLookAtPoi={(poiId) => managerRef.current?.lookAtPoi(poiId)}
            onCancelRivalCutaway={() => managerRef.current?.cancelRivalCutaway()}
            onCancelPlayerCutaway={() => managerRef.current?.cancelPlayerCutaway()}
            onToggleUnderwaterCam={() => managerRef.current?.toggleUnderwaterCam()}
            onAttachWorm={() => managerRef.current?.attachBaitToHook(true)}
            onResolveCatch={(rel) => managerRef.current?.resolveActiveCatch(rel)}
            characterName={profile.name}
            multiplayerRoomCode={roomCode}
            multiplayerPlayersCount={roomPlayers.length}
            onOpenMultiplayer={() => {
              setMpError(null);
              setMpModalOpen(true);
            }}
          />

          <MultiplayerChatBox
            roomCode={roomCode}
            selfId={selfId}
            players={roomPlayers}
            messages={chatMessages}
            open={chatOpen}
            unreadCount={unreadChat}
            onToggleOpen={() => {
              setChatOpen((prev) => {
                const next = !prev;
                if (next) setUnreadChat(0);
                return next;
              });
            }}
            onSendMessage={(text) => mpClientRef.current?.sendChat(text)}
            onOpenRoomModal={() => setMpModalOpen(true)}
          />

          <MultiplayerModal
            open={mpModalOpen}
            onClose={() => setMpModalOpen(false)}
            profile={profile}
            onSaveProfile={handleSaveProfile}
            connectionStatus={mpStatus}
            roomCode={roomCode}
            selfId={selfId}
            players={roomPlayers}
            errorMessage={mpError}
            onCreateRoom={() => {
              setMpError(null);
              mpClientRef.current?.createRoom(
                profile,
                managerRef.current?.getMultiplayerSnapshot(),
              );
            }}
            onJoinRoom={(code) => {
              setMpError(null);
              mpClientRef.current?.joinRoom(
                code,
                profile,
                managerRef.current?.getMultiplayerSnapshot(),
              );
            }}
            onQuickJoin={() => {
              setMpError(null);
              mpClientRef.current?.quickJoin(
                profile,
                managerRef.current?.getMultiplayerSnapshot(),
              );
            }}
            onLeaveRoom={() => {
              mpClientRef.current?.leaveRoom();
            }}
            onOpenChat={() => {
              setChatOpen(true);
              setUnreadChat(0);
            }}
          />
        </>
      )}
    </main>
  );
}
