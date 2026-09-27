export type ContentKind = 'file' | 'text' | 'link';
export type ItemState = 'queued' | 'offered' | 'incoming' | 'preparing' | 'sending' | 'receiving' | 'verifying' | 'complete' | 'paused' | 'declined' | 'cancelled' | 'error';
export interface ShelfItem {
  id: string; name: string; mime: string; size: number; kind: ContentKind;
  direction: 'sent' | 'received'; state: ItemState; createdAt: number;
  bytes: number; speed: number; progress: number; accepted: boolean;
  file?: Blob; url?: string; text?: string; digest?: string; error?: string; pinned?: boolean;
  targetDeviceId?: string; targetDeviceName?: string; sourceDeviceId?: string; sourceDeviceName?: string;
}
export interface PairRequest { id: string; name: string; expiresAt: number }
export interface RoomState {
  roomId?: string; expiresAt?: number; owner?: boolean; ended?: boolean;
  peer?: { id: string; name: string; deviceId: string; online: boolean }; initiator?: boolean;
  code?: string; inviteSecret?: string; inviteExpiresAt?: number; pending?: PairRequest;
}
export interface ServerConfig { iceServers: RTCIceServer[]; iceTransportPolicy: RTCIceTransportPolicy; maxFileBytes: number }
export interface Session { id: string; token: string; name: string; deviceId: string; state: RoomState; config: ServerConfig }
export type Signal = { type: 'offer' | 'answer' | 'candidate' | 'restart'; connectionId: string; sdp?: string; candidate?: RTCIceCandidateInit };
export interface ServerEvent { type: string; seq?: number; state?: RoomState; request?: PairRequest; signal?: Signal; message?: string; reason?: string }
export interface Offer { type: 'offer'; id: string; name: string; mime: string; size: number; kind: ContentKind }
export type Control = Offer | { type: 'accept' | 'ack'; id: string; offset: number } | { type: 'finish' | 'complete'; id: string; digest: string } | { type: 'decline' | 'cancel'; id: string } | { type: 'error'; id: string; message: string };
export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'blocked';
export interface SecurityState { route: 'direct' | 'relay' | 'encrypted'; safetyCode: string }
