// ── Connection state ────────────────────────────────────────────────

export type TConnectionState =
	| "disconnected"
	| "connecting"
	| "connected"
	| "reconnecting";

// ── Transport interface ─────────────────────────────────────────────

export interface IWebSocketTransport {
	connect(url: string, protocols?: string | string[]): void;
	disconnect(code?: number, reason?: string): void;
	send(data: string): void;
	readonly readyState: number;
	onopen: ((event: Event) => void) | null;
	onclose: ((event: CloseEvent) => void) | null;
	onmessage: ((event: MessageEvent) => void) | null;
	onerror: ((event: Event) => void) | null;
}

// ── Manager config ──────────────────────────────────────────────────

export type TManagerConfig = {
	url: string;
	transport?: IWebSocketTransport;
	pingIntervalMs?: number;
	pongTimeoutMs?: number;
	reconnectMaxAttempts?: number;
	reconnectBaseDelayMs?: number;
	reconnectMaxDelayMs?: number;
	serializePing?: () => string;
	isPong?: (parsed: unknown) => boolean;
	onMessage?: (parsed: unknown) => void;
	onConnectionStateChange?: (state: TConnectionState) => void;
	onReady?: () => void;
	onInFlightDrop?: (ids: string[]) => void;
	onLastUnsubscribe?: (key: string) => void;
};
