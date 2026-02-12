import type {
	IWebSocketTransport,
	TConnectionState,
	TSocketError,
} from "../socket/types";

export type TNotification = {
	id: string;
	timestamp: number;
	payload: Record<string, unknown>;
};

export type TMiniSocketConfig = {
	url: string;
	token?: string;
	transport?: IWebSocketTransport;
	pingIntervalMs?: number;
	pongTimeoutMs?: number;
	reconnectMaxAttempts?: number;
	reconnectBaseDelayMs?: number;
	reconnectMaxDelayMs?: number;
	onMessage?: (msg: TNotification) => void;
	onConnectionStateChange?: (state: TConnectionState) => void;
	onError?: (error: TSocketError) => void;
};
