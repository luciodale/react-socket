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

// ── Store adapter interface ─────────────────────────────────────────

export type TStoreAdapter<TState> = {
	get: () => TState;
	set: (fn: (state: TState) => Partial<TState>) => void;
	useSelector: <T>(selector: (state: TState) => T) => T;
};

// ── Manager config (internal) ───────────────────────────────────────

export type TManagerConfig = {
	url: string;
	token?: string;
	transport?: IWebSocketTransport;
	pingIntervalMs?: number;
	pongTimeoutMs?: number;
	reconnectMaxAttempts?: number;
	reconnectBaseDelayMs?: number;
	reconnectMaxDelayMs?: number;
	serializeSubscribe?: (type: string, channel: string) => string;
	serializeUnsubscribe?: (type: string, channel: string) => string;
	onRawMessage?: (parsed: unknown) => void;
	onConnectionStateChange?: (state: TConnectionState) => void;
	onReady?: () => void;
	onInFlightDrop?: (ids: string[]) => void;
};

// ── Factory types ───────────────────────────────────────────────────

export type TStoreApi<TUserState> = {
	set: (fn: (state: TUserState) => Partial<TUserState>) => void;
	get: () => TUserState;
};

export type TMessageApi<TUserState, TClientMsg> = TStoreApi<TUserState> & {
	send: (msg: TClientMsg) => boolean;
};

export type TCreateSocketConfig<TServerMsg, TClientMsg, TUserState> = {
	store: TStoreAdapter<TUserState>;

	onMessage: (
		msg: TServerMsg,
		api: TMessageApi<TUserState, TClientMsg>,
	) => void;

	subscribe?: (type: string, channel: string) => TClientMsg;
	unsubscribe?: (type: string, channel: string) => TClientMsg;

	resolveSubscriptionAck?: (
		msg: TServerMsg,
	) => { type: string; channel: string } | null;

	resolveInFlight?: (
		msg: TServerMsg,
	) => { ack?: string; drop?: string } | null;

	getOutboundId?: (msg: TClientMsg) => string | null;

	onInFlightDrop?: (ids: string[], api: TStoreApi<TUserState>) => void;

	onConnect?: (api: { send: (msg: TClientMsg) => boolean }) => void;

	onChannelCleanup?: (
		type: string,
		channel: string,
		api: TStoreApi<TUserState>,
	) => void;

	onBeforeConnect?: () => Promise<void>;
};
