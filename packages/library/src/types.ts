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

export type TManagerConfig<TClientMsg, TServerMsg> = {
	url: string;
	serialize: (msg: TClientMsg) => string;
	deserialize: (raw: string) => TServerMsg;
	transport?: IWebSocketTransport;
	pingIntervalMs?: number;
	pongTimeoutMs?: number;
	reconnectMaxAttempts?: number;
	reconnectBaseDelayMs?: number;
	reconnectMaxDelayMs?: number;
	ping?: () => TClientMsg;
	isPong?: (msg: TServerMsg) => boolean;
	onMessageReceived?: (msg: TServerMsg) => void;
	onSendIntent?: (params: TSendParams<TClientMsg>) => void;
	onConnectionStateChange?: (state: TConnectionState) => void;
	onReady?: () => void;
	onInFlightDrop?: (messages: { id: string; data: TClientMsg }[]) => void;
	onLastUnsubscribe?: (key: string, data: TClientMsg | undefined) => void;
	onDebug?: (event: TDebugEvent<TClientMsg, TServerMsg>) => void;
};

// ── Send params ────────────────────────────────────────────────────

export type TSendParams<TClientMsg> = {
	data: TClientMsg;
	ackId?: string;
	meta?: unknown;
};

// ── Debug events ───────────────────────────────────────────────────

export type TDebugEventPayload<TClientMsg, TServerMsg> =
	| {
			type: "connection-state-change";
			from: TConnectionState;
			to: TConnectionState;
	  }
	| {
			type: "message-received";
			raw: string;
			deserialized: TServerMsg;
			isPong: boolean;
	  }
	| {
			type: "message-sent";
			ackId: string | undefined;
			raw: string;
			deserialized: TClientMsg;
	  }
	| {
			type: "subscribe";
			key: string;
			refCount: number;
			raw?: string;
			deserialized?: TClientMsg;
	  }
	| {
			type: "unsubscribe";
			key: string;
			refCount: number;
			raw?: string;
			deserialized?: TClientMsg;
	  }
	| { type: "in-flight-ack"; ackId: string }
	| { type: "in-flight-drop"; ids: string[] }
	| { type: "pending-subscription-resolved"; key: string }
	| { type: "reconnect-scheduled"; attempt: number; delayMs: number }
	| { type: "ready"; restoredKeys: string[] }
	| { type: "deserialize-error"; raw: string; error: unknown }
	| { type: "dispose" };

export type TDebugEvent<TClientMsg, TServerMsg> = {
	id: number;
	timestamp: number;
} & TDebugEventPayload<TClientMsg, TServerMsg>;

export type TDebugEventType = TDebugEvent<unknown, unknown>["type"];
