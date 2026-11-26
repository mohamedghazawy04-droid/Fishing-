import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  ChatMessage,
  PlayerAvatarStyle,
  PlayerSyncState,
} from './src/types/multiplayer.ts';

const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS_PER_ROOM = 2;
const MAX_CHAT_HISTORY = 60;
const MAX_PAYLOAD_BYTES = 4096;

const VALID_AVATARS = new Set<PlayerAvatarStyle>(['emerald', 'amber', 'sky', 'crimson']);
const VALID_PHASES = new Set([
  'idle',
  'charging',
  'casting',
  'waiting',
  'nibbling',
  'biting',
  'reeling',
  'caught',
]);

interface ClientSession {
  id: string;
  ws: WebSocket;
  roomCode: string | null;
  lastPingPong: number;
  chatTimestamps: number[];
}

interface GameRoom {
  code: string;
  createdAt: number;
  players: Map<string, PlayerSyncState>;
  sockets: Map<string, WebSocket>;
  chatHistory: ChatMessage[];
}

const rooms = new Map<string, GameRoom>();

function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'صياد البحيرة';
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20);
  return cleaned.length >= 2 ? cleaned : 'صياد البحيرة';
}

function sanitizeAvatar(raw: unknown): PlayerAvatarStyle {
  if (typeof raw === 'string' && VALID_AVATARS.has(raw as PlayerAvatarStyle)) {
    return raw as PlayerAvatarStyle;
  }
  return 'emerald';
}

function sanitizeRoomCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

function sanitizeChatText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 240);
}

function clampFinite(val: unknown, min: number, max: number, fallback: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, val));
}

function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 12; attempt++) {
    let code = '';
    const bytes = crypto.randomBytes(5);
    for (let i = 0; i < 5; i++) {
      code += alphabet[bytes[i] % alphabet.length];
    }
    if (!rooms.has(code)) return code;
  }
  return `L${Date.now().toString(36).toUpperCase().slice(-5)}`;
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastToRoom(room: GameRoom, payload: unknown, exceptClientId?: string): void {
  const encoded = JSON.stringify(payload);
  for (const [cid, sock] of room.sockets.entries()) {
    if (exceptClientId && cid === exceptClientId) continue;
    if (sock.readyState === WebSocket.OPEN) {
      sock.send(encoded);
    }
  }
}

function pushRoomChat(room: GameRoom, msg: ChatMessage): void {
  room.chatHistory.push(msg);
  if (room.chatHistory.length > MAX_CHAT_HISTORY) {
    room.chatHistory.splice(0, room.chatHistory.length - MAX_CHAT_HISTORY);
  }
  broadcastToRoom(room, { type: 'chat:message', message: msg });
}

function buildInitialPlayerState(
  id: string,
  slot: 1 | 2,
  name: string,
  avatarColor: PlayerAvatarStyle,
  partial?: Record<string, unknown>,
): PlayerSyncState {
  return {
    id,
    slot,
    name,
    avatarColor,
    level: Math.round(clampFinite(partial?.level, 1, 99, 1)),
    boatLevel: Math.round(clampFinite(partial?.boatLevel, 1, 4, 1)),
    isOnBoat: Boolean(partial?.isOnBoat),
    x: clampFinite(partial?.x, -260, 260, slot === 1 ? 0 : -0.92),
    y: clampFinite(partial?.y, -20, 40, 0.72),
    z: clampFinite(partial?.z, -260, 120, slot === 1 ? 2.3 : 1.85),
    yaw: clampFinite(partial?.yaw, -Math.PI * 2, Math.PI * 2, 0),
    phase:
      typeof partial?.phase === 'string' && VALID_PHASES.has(partial.phase)
        ? (partial.phase as PlayerSyncState['phase'])
        : 'idle',
    bobberVisible: Boolean(partial?.bobberVisible),
    bobberX: clampFinite(partial?.bobberX, -260, 260, 0),
    bobberY: clampFinite(partial?.bobberY, -20, 40, 0),
    bobberZ: clampFinite(partial?.bobberZ, -260, 120, -8),
    lureY: clampFinite(partial?.lureY, -25, 40, -1),
    reeling: Boolean(partial?.reeling),
    castPower: clampFinite(partial?.castPower, 0, 1, 0),
    lineTension: clampFinite(partial?.lineTension, 0, 1, 0),
    hookedSpeciesName:
      typeof partial?.hookedSpeciesName === 'string'
        ? partial.hookedSpeciesName.slice(0, 60)
        : null,
    catchesCount: Math.round(clampFinite(partial?.catchesCount, 0, 10000, 0)),
  };
}

function leaveCurrentRoom(session: ClientSession): void {
  if (!session.roomCode) return;
  const room = rooms.get(session.roomCode);
  session.roomCode = null;
  if (!room) return;

  const departing = room.players.get(session.id);
  room.players.delete(session.id);
  room.sockets.delete(session.id);

  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }

  if (departing) {
    pushRoomChat(room, {
      id: crypto.randomUUID(),
      senderId: 'system',
      senderName: 'النظام',
      senderSlot: 0,
      text: `غادر ${departing.name} الغرفة`,
      timestamp: Date.now(),
      kind: 'system',
    });
  }

  broadcastToRoom(room, {
    type: 'room:players',
    roomCode: room.code,
    players: Array.from(room.players.values()),
  });
}

function joinRoom(
  session: ClientSession,
  room: GameRoom,
  name: string,
  avatarColor: PlayerAvatarStyle,
  initialState?: Record<string, unknown>,
): void {
  if (session.roomCode === room.code && room.players.has(session.id)) {
    const existing = room.players.get(session.id)!;
    existing.name = name;
    existing.avatarColor = avatarColor;
    sendJson(session.ws, {
      type: 'room:joined',
      roomCode: room.code,
      selfId: session.id,
      selfSlot: existing.slot,
      players: Array.from(room.players.values()),
      chatHistory: room.chatHistory,
    });
    broadcastToRoom(
      room,
      {
        type: 'room:players',
        roomCode: room.code,
        players: Array.from(room.players.values()),
      },
      session.id,
    );
    return;
  }

  leaveCurrentRoom(session);

  if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
    sendJson(session.ws, {
      type: 'room:error',
      message: 'الغرفة مكتملة حالياً (الحد الأقصى لاعبان اثنان فقط).',
    });
    return;
  }

  const usedSlots = new Set(Array.from(room.players.values()).map((p) => p.slot));
  const slot: 1 | 2 = usedSlots.has(1) ? 2 : 1;

  const playerState = buildInitialPlayerState(session.id, slot, name, avatarColor, initialState);
  room.players.set(session.id, playerState);
  room.sockets.set(session.id, session.ws);
  session.roomCode = room.code;

  sendJson(session.ws, {
    type: 'room:joined',
    roomCode: room.code,
    selfId: session.id,
    selfSlot: slot,
    players: Array.from(room.players.values()),
    chatHistory: room.chatHistory,
  });

  pushRoomChat(room, {
    id: crypto.randomUUID(),
    senderId: 'system',
    senderName: 'النظام',
    senderSlot: 0,
    text: `انضم ${name} إلى جلسة الصيد (اللاعب ${slot}/2)`,
    timestamp: Date.now(),
    kind: 'system',
  });

  broadcastToRoom(
    room,
    {
      type: 'room:players',
      roomCode: room.code,
      players: Array.from(room.players.values()),
    },
    session.id,
  );
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      activeRooms: rooms.size,
      activePlayers: Array.from(rooms.values()).reduce((sum, r) => sum + r.players.size, 0),
    });
  });

  app.get('/api/rooms/open', (_req, res) => {
    const openRooms = Array.from(rooms.values())
      .filter((r) => r.players.size === 1)
      .map((r) => {
        const host = Array.from(r.players.values())[0];
        return {
          code: r.code,
          hostName: host?.name ?? 'صياد',
          playersCount: r.players.size,
        };
      });
    res.json({ openRooms });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_PAYLOAD_BYTES });

  wss.on('connection', (ws) => {
    const session: ClientSession = {
      id: crypto.randomUUID(),
      ws,
      roomCode: null,
      lastPingPong: Date.now(),
      chatTimestamps: [],
    };

    sendJson(ws, { type: 'session:welcome', selfId: session.id });

    ws.on('pong', () => {
      session.lastPingPong = Date.now();
    });

    ws.on('message', (rawBuf) => {
      let msg: Record<string, unknown>;
      try {
        const text = typeof rawBuf === 'string' ? rawBuf : rawBuf.toString('utf8');
        if (text.length > MAX_PAYLOAD_BYTES) return;
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object') return;
        msg = parsed as Record<string, unknown>;
      } catch {
        return;
      }

      const type = typeof msg.type === 'string' ? msg.type : '';

      if (type === 'room:create') {
        const name = sanitizeName(msg.name);
        const avatarColor = sanitizeAvatar(msg.avatarColor);
        const code = generateRoomCode();
        const room: GameRoom = {
          code,
          createdAt: Date.now(),
          players: new Map(),
          sockets: new Map(),
          chatHistory: [],
        };
        rooms.set(code, room);
        joinRoom(
          session,
          room,
          name,
          avatarColor,
          typeof msg.initialState === 'object' && msg.initialState !== null
            ? (msg.initialState as Record<string, unknown>)
            : undefined,
        );
        return;
      }

      if (type === 'room:join') {
        const code = sanitizeRoomCode(msg.roomCode);
        if (!code) {
          sendJson(ws, { type: 'room:error', message: 'يرجى إدخال رمز غرفة صحيح.' });
          return;
        }
        let room = rooms.get(code);
        if (!room) {
          // If invited via shared URL before host recreated or room expired, create room with that code seamlessly
          if (msg.createIfMissing) {
            room = {
              code,
              createdAt: Date.now(),
              players: new Map(),
              sockets: new Map(),
              chatHistory: [],
            };
            rooms.set(code, room);
          } else {
            sendJson(ws, { type: 'room:error', message: `لم يتم العثور على غرفة بالرمز ${code}.` });
            return;
          }
        }
        const name = sanitizeName(msg.name);
        const avatarColor = sanitizeAvatar(msg.avatarColor);
        joinRoom(
          session,
          room,
          name,
          avatarColor,
          typeof msg.initialState === 'object' && msg.initialState !== null
            ? (msg.initialState as Record<string, unknown>)
            : undefined,
        );
        return;
      }

      if (type === 'room:quick_join') {
        const name = sanitizeName(msg.name);
        const avatarColor = sanitizeAvatar(msg.avatarColor);
        let openRoom: GameRoom | undefined;
        for (const r of rooms.values()) {
          if (r.players.size === 1 && !r.players.has(session.id)) {
            openRoom = r;
            break;
          }
        }
        if (!openRoom) {
          const code = generateRoomCode();
          openRoom = {
            code,
            createdAt: Date.now(),
            players: new Map(),
            sockets: new Map(),
            chatHistory: [],
          };
          rooms.set(code, openRoom);
        }
        joinRoom(
          session,
          openRoom,
          name,
          avatarColor,
          typeof msg.initialState === 'object' && msg.initialState !== null
            ? (msg.initialState as Record<string, unknown>)
            : undefined,
        );
        return;
      }

      if (type === 'room:leave') {
        leaveCurrentRoom(session);
        sendJson(ws, { type: 'room:left' });
        return;
      }

      if (!session.roomCode) return;
      const room = rooms.get(session.roomCode);
      if (!room) return;
      const currentPlayer = room.players.get(session.id);
      if (!currentPlayer) return;

      if (type === 'player:update_profile') {
        const nextName = sanitizeName(msg.name);
        const nextAvatar = sanitizeAvatar(msg.avatarColor);
        const oldName = currentPlayer.name;
        currentPlayer.name = nextName;
        currentPlayer.avatarColor = nextAvatar;
        if (oldName !== nextName) {
          pushRoomChat(room, {
            id: crypto.randomUUID(),
            senderId: 'system',
            senderName: 'النظام',
            senderSlot: 0,
            text: `غيّر ${oldName} اسم شخصيته إلى ${nextName}`,
            timestamp: Date.now(),
            kind: 'system',
          });
        }
        broadcastToRoom(room, {
          type: 'room:players',
          roomCode: room.code,
          players: Array.from(room.players.values()),
        });
        return;
      }

      if (type === 'player:state') {
        const st =
          typeof msg.state === 'object' && msg.state !== null
            ? (msg.state as Record<string, unknown>)
            : null;
        if (!st) return;

        currentPlayer.level = Math.round(clampFinite(st.level, 1, 99, currentPlayer.level));
        currentPlayer.boatLevel = Math.round(clampFinite(st.boatLevel, 1, 4, currentPlayer.boatLevel));
        currentPlayer.isOnBoat = Boolean(st.isOnBoat);
        currentPlayer.x = clampFinite(st.x, -260, 260, currentPlayer.x);
        currentPlayer.y = clampFinite(st.y, -20, 40, currentPlayer.y);
        currentPlayer.z = clampFinite(st.z, -260, 120, currentPlayer.z);
        currentPlayer.yaw = clampFinite(st.yaw, -Math.PI * 2, Math.PI * 2, currentPlayer.yaw);
        if (typeof st.phase === 'string' && VALID_PHASES.has(st.phase)) {
          currentPlayer.phase = st.phase as PlayerSyncState['phase'];
        }
        currentPlayer.bobberVisible = Boolean(st.bobberVisible);
        currentPlayer.bobberX = clampFinite(st.bobberX, -260, 260, currentPlayer.bobberX);
        currentPlayer.bobberY = clampFinite(st.bobberY, -20, 40, currentPlayer.bobberY);
        currentPlayer.bobberZ = clampFinite(st.bobberZ, -260, 120, currentPlayer.bobberZ);
        currentPlayer.lureY = clampFinite(st.lureY, -25, 40, currentPlayer.lureY);
        currentPlayer.reeling = Boolean(st.reeling);
        currentPlayer.castPower = clampFinite(st.castPower, 0, 1, 0);
        currentPlayer.lineTension = clampFinite(st.lineTension, 0, 1, 0);
        currentPlayer.hookedSpeciesName =
          typeof st.hookedSpeciesName === 'string' ? st.hookedSpeciesName.slice(0, 60) : null;
        currentPlayer.catchesCount = Math.round(
          clampFinite(st.catchesCount, 0, 10000, currentPlayer.catchesCount),
        );

        broadcastToRoom(
          room,
          {
            type: 'player:state',
            player: currentPlayer,
          },
          session.id,
        );
        return;
      }

      if (type === 'player:catch') {
        const speciesName =
          typeof msg.speciesName === 'string'
            ? msg.speciesName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60)
            : '';
        const weightKg = clampFinite(msg.weightKg, 0.1, 200, 1);
        if (speciesName) {
          pushRoomChat(room, {
            id: crypto.randomUUID(),
            senderId: currentPlayer.id,
            senderName: currentPlayer.name,
            senderSlot: currentPlayer.slot,
            avatarColor: currentPlayer.avatarColor,
            text: `اصطاد ${currentPlayer.name} سمكة «${speciesName}» بوزن ${weightKg.toFixed(1)} كجم!`,
            timestamp: Date.now(),
            kind: 'catch',
          });
        }
        return;
      }

      if (type === 'chat:send') {
        const now = Date.now();
        session.chatTimestamps = session.chatTimestamps.filter((ts) => now - ts < 5000);
        if (session.chatTimestamps.length >= 8) {
          sendJson(ws, {
            type: 'room:error',
            message: 'أنت ترسل الرسائل بسرعة كبيرة، انتظر لحظة.',
          });
          return;
        }
        const text = sanitizeChatText(msg.text);
        if (!text) return;
        session.chatTimestamps.push(now);

        pushRoomChat(room, {
          id: crypto.randomUUID(),
          senderId: currentPlayer.id,
          senderName: currentPlayer.name,
          senderSlot: currentPlayer.slot,
          avatarColor: currentPlayer.avatarColor,
          text,
          timestamp: now,
          kind: 'chat',
        });
      }
    });

    ws.on('close', () => {
      leaveCurrentRoom(session);
    });
  });

  // Periodic keep-alive ping
  const heartbeatInterval = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      for (const sock of room.sockets.values()) {
        if (sock.readyState === WebSocket.OPEN) {
          sock.ping();
        }
      }
    }
    void now;
  }, 25000);

  server.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  const distDir = path.resolve(process.cwd(), 'dist');
  const distIndex = path.join(distDir, 'index.html');
  const isProd = process.env.NODE_ENV === 'production' || (process.env.NODE_ENV !== 'development' && fs.existsSync(distIndex));

  if (isProd && fs.existsSync(distIndex)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(distIndex);
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
