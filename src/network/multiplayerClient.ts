import type {
  ChatMessage,
  ConnectionStatus,
  LocalPlayerSnapshot,
  MultiplayerRoomSnapshot,
  PlayerAvatarStyle,
  PlayerCharacterProfile,
  PlayerSyncState,
} from '../types/multiplayer';

const PROFILE_STORAGE_KEY = 'serene_valley_player_profile_v1';

export function loadSavedCharacterProfile(): PlayerCharacterProfile {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PlayerCharacterProfile>;
      const name =
        typeof parsed.name === 'string' && parsed.name.trim().length >= 2
          ? parsed.name.trim().slice(0, 20)
          : 'صياد الوادي';
      const avatarColor: PlayerAvatarStyle =
        parsed.avatarColor === 'emerald' ||
        parsed.avatarColor === 'amber' ||
        parsed.avatarColor === 'sky' ||
        parsed.avatarColor === 'crimson'
          ? parsed.avatarColor
          : 'emerald';
      return { name, avatarColor };
    }
  } catch {
    // Ignore storage read errors
  }
  return { name: 'صياد الوادي', avatarColor: 'emerald' };
}

export function saveCharacterProfile(profile: PlayerCharacterProfile): void {
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore storage write errors
  }
}

export interface MultiplayerCallbacks {
  onStatusChange: (status: ConnectionStatus) => void;
  onRoomJoined: (snapshot: MultiplayerRoomSnapshot) => void;
  onRoomLeft: () => void;
  onPlayersChange: (roomCode: string, players: PlayerSyncState[]) => void;
  onRemotePlayerState: (player: PlayerSyncState) => void;
  onChatMessage: (message: ChatMessage) => void;
  onError: (message: string) => void;
}

type PendingRoomAction =
  | { kind: 'create'; profile: PlayerCharacterProfile; initialState?: LocalPlayerSnapshot }
  | { kind: 'join'; roomCode: string; profile: PlayerCharacterProfile; initialState?: LocalPlayerSnapshot; createIfMissing?: boolean }
  | { kind: 'quick_join'; profile: PlayerCharacterProfile; initialState?: LocalPlayerSnapshot };

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private callbacks: MultiplayerCallbacks;
  private activeRoomCode: string | null = null;
  private selfId: string | null = null;
  private pendingAction: PendingRoomAction | null = null;
  private latestProfile: PlayerCharacterProfile;
  private latestSnapshotGetter: (() => LocalPlayerSnapshot) | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private disposed = false;
  private lastStateSentAt = 0;
  private lastSentPhase = '';
  private lastSentBoat = false;

  constructor(initialProfile: PlayerCharacterProfile, callbacks: MultiplayerCallbacks) {
    this.latestProfile = initialProfile;
    this.callbacks = callbacks;
  }

  public setSnapshotGetter(getter: () => LocalPlayerSnapshot): void {
    this.latestSnapshotGetter = getter;
  }

  public getRoomCode(): string | null {
    return this.activeRoomCode;
  }

  public getSelfId(): string | null {
    return this.selfId;
  }

  private setStatus(next: ConnectionStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.callbacks.onStatusChange(next);
  }

  private ensureSocket(): void {
    if (this.disposed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;
    this.setStatus('connecting');

    const socket = new WebSocket(url);
    this.ws = socket;

    socket.onopen = () => {
      if (this.disposed || this.ws !== socket) return;
      this.reconnectAttempts = 0;
      this.setStatus('connected');

      if (this.pendingAction) {
        const act = this.pendingAction;
        this.pendingAction = null;
        this.dispatchRoomAction(act);
      } else if (this.activeRoomCode) {
        this.dispatchRoomAction({
          kind: 'join',
          roomCode: this.activeRoomCode,
          profile: this.latestProfile,
          initialState: this.latestSnapshotGetter?.(),
          createIfMissing: true,
        });
      }
    };

    socket.onmessage = (evt) => {
      if (this.disposed) return;
      let msg: Record<string, unknown>;
      try {
        const parsed = JSON.parse(String(evt.data));
        if (!parsed || typeof parsed !== 'object') return;
        msg = parsed as Record<string, unknown>;
      } catch {
        return;
      }

      const type = typeof msg.type === 'string' ? msg.type : '';
      if (type === 'session:welcome') {
        if (typeof msg.selfId === 'string') {
          this.selfId = msg.selfId;
        }
        return;
      }

      if (type === 'room:joined') {
        const roomCode = typeof msg.roomCode === 'string' ? msg.roomCode : '';
        const selfId = typeof msg.selfId === 'string' ? msg.selfId : (this.selfId ?? '');
        const selfSlot = msg.selfSlot === 2 ? 2 : 1;
        const players = Array.isArray(msg.players) ? (msg.players as PlayerSyncState[]) : [];
        const chatHistory = Array.isArray(msg.chatHistory) ? (msg.chatHistory as ChatMessage[]) : [];
        this.selfId = selfId;
        this.activeRoomCode = roomCode;
        this.callbacks.onRoomJoined({
          roomCode,
          selfId,
          selfSlot,
          players,
          chatHistory,
        });
        return;
      }

      if (type === 'room:left') {
        this.activeRoomCode = null;
        this.callbacks.onRoomLeft();
        return;
      }

      if (type === 'room:players') {
        const roomCode = typeof msg.roomCode === 'string' ? msg.roomCode : (this.activeRoomCode ?? '');
        const players = Array.isArray(msg.players) ? (msg.players as PlayerSyncState[]) : [];
        this.callbacks.onPlayersChange(roomCode, players);
        return;
      }

      if (type === 'player:state') {
        if (msg.player && typeof msg.player === 'object') {
          this.callbacks.onRemotePlayerState(msg.player as PlayerSyncState);
        }
        return;
      }

      if (type === 'chat:message') {
        if (msg.message && typeof msg.message === 'object') {
          this.callbacks.onChatMessage(msg.message as ChatMessage);
        }
        return;
      }

      if (type === 'room:error') {
        const text = typeof msg.message === 'string' ? msg.message : 'تعذر إتمام الطلب.';
        this.callbacks.onError(text);
      }
    };

    socket.onclose = () => {
      if (this.ws === socket) {
        this.ws = null;
      }
      if (this.disposed) return;
      this.setStatus('disconnected');

      // Auto-reconnect if player is actively inside a room
      if (this.activeRoomCode || this.pendingAction) {
        if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
        const delay = Math.min(8000, 1000 * Math.pow(1.6, this.reconnectAttempts));
        this.reconnectAttempts += 1;
        this.reconnectTimer = window.setTimeout(() => {
          this.ensureSocket();
        }, delay);
      }
    };

    socket.onerror = () => {
      // Handled via onclose
    };
  }

  private sendRaw(payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private dispatchRoomAction(act: PendingRoomAction): void {
    this.latestProfile = act.profile;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingAction = act;
      this.ensureSocket();
      return;
    }

    if (act.kind === 'create') {
      this.sendRaw({
        type: 'room:create',
        name: act.profile.name,
        avatarColor: act.profile.avatarColor,
        initialState: act.initialState,
      });
    } else if (act.kind === 'join') {
      this.sendRaw({
        type: 'room:join',
        roomCode: act.roomCode,
        name: act.profile.name,
        avatarColor: act.profile.avatarColor,
        initialState: act.initialState,
        createIfMissing: act.createIfMissing ?? false,
      });
    } else {
      this.sendRaw({
        type: 'room:quick_join',
        name: act.profile.name,
        avatarColor: act.profile.avatarColor,
        initialState: act.initialState,
      });
    }
  }

  public createRoom(profile: PlayerCharacterProfile, initialState?: LocalPlayerSnapshot): void {
    this.dispatchRoomAction({ kind: 'create', profile, initialState });
  }

  public joinRoom(
    roomCode: string,
    profile: PlayerCharacterProfile,
    initialState?: LocalPlayerSnapshot,
    createIfMissing = false,
  ): void {
    this.dispatchRoomAction({
      kind: 'join',
      roomCode,
      profile,
      initialState,
      createIfMissing,
    });
  }

  public quickJoin(profile: PlayerCharacterProfile, initialState?: LocalPlayerSnapshot): void {
    this.dispatchRoomAction({ kind: 'quick_join', profile, initialState });
  }

  public leaveRoom(): void {
    this.activeRoomCode = null;
    this.pendingAction = null;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.sendRaw({ type: 'room:leave' });
    this.callbacks.onRoomLeft();
  }

  public updateProfile(profile: PlayerCharacterProfile): void {
    this.latestProfile = profile;
    saveCharacterProfile(profile);
    if (this.activeRoomCode && this.ws?.readyState === WebSocket.OPEN) {
      this.sendRaw({
        type: 'player:update_profile',
        name: profile.name,
        avatarColor: profile.avatarColor,
      });
    }
  }

  public sendChat(text: string): void {
    const trimmed = text.trim().slice(0, 240);
    if (!trimmed || !this.activeRoomCode) return;
    this.sendRaw({ type: 'chat:send', text: trimmed });
  }

  public sendCatchAnnouncement(speciesName: string, weightKg: number): void {
    if (!this.activeRoomCode) return;
    this.sendRaw({
      type: 'player:catch',
      speciesName,
      weightKg,
    });
  }

  public maybeSendState(snapshot: LocalPlayerSnapshot): void {
    if (!this.activeRoomCode || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    const importantChange =
      snapshot.phase !== this.lastSentPhase || snapshot.isOnBoat !== this.lastSentBoat;
    if (!importantChange && now - this.lastStateSentAt < 85) return;

    this.lastStateSentAt = now;
    this.lastSentPhase = snapshot.phase;
    this.lastSentBoat = snapshot.isOnBoat;
    this.sendRaw({
      type: 'player:state',
      state: snapshot,
    });
  }

  public dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
