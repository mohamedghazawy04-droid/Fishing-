import type { FishingPhase } from './fishing';

export type PlayerAvatarStyle = 'emerald' | 'amber' | 'sky' | 'crimson';

export interface AvatarStyleOption {
  id: PlayerAvatarStyle;
  labelAr: string;
  jacketHex: number;
  hatHex: number;
  badgeClass: string;
  dotClass: string;
}

export const AVATAR_STYLE_OPTIONS: AvatarStyleOption[] = [
  {
    id: 'emerald',
    labelAr: 'أخضر زمردي',
    jacketHex: 0x2a664b,
    hatHex: 0x4b6344,
    badgeClass: 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200',
    dotClass: 'bg-emerald-400',
  },
  {
    id: 'amber',
    labelAr: 'عنبري دافئ',
    jacketHex: 0xa65b2b,
    hatHex: 0xb8975e,
    badgeClass: 'bg-amber-500/20 border-amber-400/50 text-amber-200',
    dotClass: 'bg-amber-400',
  },
  {
    id: 'sky',
    labelAr: 'أزرق سماوي',
    jacketHex: 0x265d84,
    hatHex: 0x3b4e5e,
    badgeClass: 'bg-sky-500/20 border-sky-400/50 text-sky-200',
    dotClass: 'bg-sky-400',
  },
  {
    id: 'crimson',
    labelAr: 'ياقوتي دافئ',
    jacketHex: 0x8a3442,
    hatHex: 0x4d3438,
    badgeClass: 'bg-rose-500/20 border-rose-400/50 text-rose-200',
    dotClass: 'bg-rose-400',
  },
];

export interface PlayerCharacterProfile {
  name: string;
  avatarColor: PlayerAvatarStyle;
}

export interface PlayerSyncState {
  id: string;
  slot: 1 | 2;
  name: string;
  avatarColor: PlayerAvatarStyle;
  level: number;
  boatLevel: number;
  isOnBoat: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  phase: FishingPhase;
  bobberVisible: boolean;
  bobberX: number;
  bobberY: number;
  bobberZ: number;
  lureY: number;
  reeling: boolean;
  castPower: number;
  lineTension: number;
  hookedSpeciesName: string | null;
  catchesCount: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderSlot: 1 | 2 | 0;
  avatarColor?: PlayerAvatarStyle;
  text: string;
  timestamp: number;
  kind: 'chat' | 'system' | 'catch';
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface MultiplayerRoomSnapshot {
  roomCode: string;
  selfId: string;
  selfSlot: 1 | 2;
  players: PlayerSyncState[];
  chatHistory: ChatMessage[];
}

export interface LocalPlayerSnapshot {
  level: number;
  boatLevel: number;
  isOnBoat: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  phase: FishingPhase;
  bobberVisible: boolean;
  bobberX: number;
  bobberY: number;
  bobberZ: number;
  lureY: number;
  reeling: boolean;
  castPower: number;
  lineTension: number;
  hookedSpeciesName: string | null;
  catchesCount: number;
}
