// ── Connection state ────────────────────────────────────────────────

export type TConnectionState =
	| "disconnected"
	| "connecting"
	| "connected"
	| "reconnecting";

// ── Wire data ───────────────────────────────────────────────────────

/**
 * Anything WebSocket.send accepts. Returned by `serialize` and consumed by
 * the transport. Default for `TWire` is `string`; widen the type parameter
 * when sending binary frames.
 */
export type TWireData = string | ArrayBuffer | ArrayBufferView | Blob;

/**
 * Anything a `MessageEvent.data` can hold. Consumed by `deserialize`.
 * Depends on `binaryType`: defaults to `string`, can be `ArrayBuffer` or
 * `Blob` when binary mode is enabled.
 */
export type TIncomingData = string | ArrayBuffer | Blob;

// ── Transport interface ─────────────────────────────────────────────

export interface IWebSocketTransport {
	connect(url: string, protocols?: string | string[]): void;
	disconnect(code?: number, reason?: string): void;
	send(data: TWireData): void;
	binaryType?: "blob" | "arraybuffer";
	readonly readyState: number;
	onopen: ((event: Event) => void) | null;
	onclose: ((event: CloseEvent) => void) | null;
	onmessage: ((event: MessageEvent) => void) | null;
	onerror: ((event: Event) => void) | null;
}

// ── Manager config ──────────────────────────────────────────────────

export type TManagerConfig<
	TClientMsg,
	TServerMsg extends Record<TKey, string>,
	TKey extends string = "type",
	TWire extends TWireData = string,
	TIncoming extends TIncomingData = string,
> = {
	url: string | (() => string | Promise<string>);
	serialize: (msg: TClientMsg) => TWire;
	deserialize: (raw: TIncoming) => TServerMsg;
	discriminator?: TKey;
	transport?: IWebSocketTransport;
	binaryType?: "blob" | "arraybuffer";
	pingIntervalMs?: number;
	pongTimeoutMs?: number;
	reconnectMaxAttempts?: number;
	reconnectBaseDelayMs?: number;
	reconnectMaxDelayMs?: number;
	ping?: () => TClientMsg;
	isPong?: (msg: TServerMsg) => boolean;
	getAckId?: (msg: TServerMsg) => string | undefined;
	getSubscriptionResolvedKey?: (msg: TServerMsg) => string | undefined;
	// Construction-time callbacks. The other lifecycle events
	// (send-intent, connection-state-change, in-flight-drop, last-unsubscribe)
	// are exposed through `addXxxListener` methods on the manager. Wire those
	// from your React tree (or a top-level bridge) so they have a clear
	// teardown story.
	onReady?: (restoredKeys: string[]) => void;
	onDebug?: (event: TDebugEvent<TClientMsg, TServerMsg>) => void;
};

// ── Send params ────────────────────────────────────────────────────

export type TSendParams<TClientMsg> = {
	data: TClientMsg;
	ackId?: string;
};

// ── Manager snapshot ────────────────────────────────────────────────

/**
 * Frozen view of the manager's internal state. Returned by
 * `manager.getSnapshot()`. Useful for the Inspector and for tests that
 * need to assert across multiple internal collections in one read.
 */
export type TManagerSnapshot<TClientMsg> = {
	connectionState: TConnectionState;
	subscriptionRefCounts: ReadonlyMap<string, number>;
	subscriptionData: ReadonlyMap<string, TClientMsg | undefined>;
	pendingSubscriptions: ReadonlySet<string>;
	inFlightMessages: ReadonlyMap<string, TClientMsg>;
	reconnectAttempt: number;
	protocols: readonly string[];
	disposed: boolean;
	intentionalClose: boolean;
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
			raw: TIncomingData;
			deserialized: TServerMsg;
			isPong: boolean;
	  }
	| {
			type: "message-sent";
			ackId: string | undefined;
			raw: TWireData;
			deserialized: TClientMsg;
	  }
	| {
			type: "subscribe";
			key: string;
			refCount: number;
			raw?: TWireData;
			deserialized?: TClientMsg;
	  }
	| {
			type: "unsubscribe";
			key: string;
			refCount: number;
			raw?: TWireData;
			deserialized?: TClientMsg;
	  }
	| { type: "in-flight-ack"; ackId: string }
	| { type: "in-flight-drop"; ids: string[] }
	| { type: "pending-subscription-resolved"; key: string }
	| { type: "reconnect-scheduled"; attempt: number; delayMs: number }
	| { type: "ready"; restoredKeys: string[] }
	| { type: "deserialize-error"; raw: TIncomingData; error: unknown }
	| { type: "url-resolve-error"; error: unknown }
	| { type: "dispose" };

export type TDebugEvent<TClientMsg, TServerMsg> = {
	id: number;
	timestamp: number;
} & TDebugEventPayload<TClientMsg, TServerMsg>;

export type TDebugEventType = TDebugEvent<unknown, unknown>["type"];
