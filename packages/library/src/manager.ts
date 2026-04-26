import {
	PING_INTERVAL_MS,
	PONG_TIMEOUT_MS,
	RECONNECT_BASE_DELAY_MS,
	RECONNECT_MAX_ATTEMPTS,
	RECONNECT_MAX_DELAY_MS,
} from "./constants";
import { createTransport } from "./transport";
import type {
	IWebSocketTransport,
	TConnectionState,
	TDebugEvent,
	TDebugEventPayload,
	TIncomingData,
	TManagerConfig,
	TManagerSnapshot,
	TSendParams,
	TWireData,
} from "./types";

class ListenerSet<TArgs extends readonly unknown[]> {
	private readonly listeners = new Set<(...args: TArgs) => void>();

	add(cb: (...args: TArgs) => void): () => void {
		this.listeners.add(cb);
		return () => {
			this.listeners.delete(cb);
		};
	}

	emit(...args: TArgs): void {
		for (const listener of this.listeners) listener(...args);
	}

	get size(): number {
		return this.listeners.size;
	}
}

export class WebSocketManager<
	TClientMsg,
	TServerMsg extends Record<TKey, string>,
	TKey extends string = "type",
	TWire extends TWireData = string,
	TIncoming extends TIncomingData = string,
> {
	readonly discriminator: TKey;

	private readonly urlStatic: string | null;
	private readonly urlDynamic: (() => string | Promise<string>) | null;
	private readonly transport: IWebSocketTransport;
	private readonly serialize: (msg: TClientMsg) => TWire;
	private readonly deserialize: (raw: TIncoming) => TServerMsg;
	private readonly pingIntervalMs: number;
	private readonly pongTimeoutMs: number;
	private readonly pauseHeartbeatWhenHidden: boolean;
	private readonly reconnectMaxAttempts: number;
	private readonly reconnectBaseDelayMs: number;
	private readonly reconnectMaxDelayMs: number;

	private readonly ping: (() => TClientMsg) | undefined;
	private readonly isPong: ((msg: TServerMsg) => boolean) | undefined;
	private readonly getAckIdCb:
		| ((msg: TServerMsg) => string | undefined)
		| undefined;
	private readonly getSubscriptionResolvedKeyCb:
		| ((msg: TServerMsg) => string | undefined)
		| undefined;

	private readonly onReady: TManagerConfig<
		TClientMsg,
		TServerMsg,
		TKey
	>["onReady"];
	private readonly onDebugCb: TManagerConfig<
		TClientMsg,
		TServerMsg,
		TKey
	>["onDebug"];

	private readonly subscriptionRefCounts = new Map<string, number>();
	private readonly subscriptionData = new Map<string, TClientMsg | undefined>();
	private readonly pendingSubscriptions = new Set<string>();
	private readonly inFlightMessages = new Map<string, TClientMsg>();
	private readonly connectionStateListeners = new ListenerSet<[]>();
	private readonly messageListeners = new ListenerSet<[TServerMsg]>();
	private readonly pendingSubscriptionListeners = new ListenerSet<[]>();
	private readonly sendIntentListeners = new ListenerSet<
		[TSendParams<TClientMsg>]
	>();
	private readonly inFlightDropListeners = new ListenerSet<
		[{ id: string; data: TClientMsg }[]]
	>();
	private readonly readyListeners = new ListenerSet<[string[]]>();
	private readonly lastUnsubscribeListeners = new ListenerSet<
		[string, TClientMsg | undefined]
	>();
	private readonly debugListeners = new ListenerSet<
		[TDebugEvent<TClientMsg, TServerMsg>]
	>();

	private protocols: string[] = [];
	private connectionState: TConnectionState = "disconnected";
	private reconnectAttempt = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private pingTimer: ReturnType<typeof setInterval> | null = null;
	private pongTimer: ReturnType<typeof setTimeout> | null = null;
	private intentionalClose = false;
	private disposed = false;
	private debugEventCounter = 0;
	private connectAttemptId = 0;
	private windowListenersAttached = false;

	constructor(
		config: TManagerConfig<TClientMsg, TServerMsg, TKey, TWire, TIncoming>,
	) {
		const configUrl = config.url;
		if (typeof configUrl === "function") {
			this.urlStatic = null;
			this.urlDynamic = configUrl;
		} else {
			this.urlStatic = configUrl;
			this.urlDynamic = null;
		}
		this.serialize = config.serialize;
		this.deserialize = config.deserialize;
		this.discriminator = (config.discriminator ?? "type") as TKey;
		this.transport = config.transport ?? createTransport();
		if (config.binaryType !== undefined) {
			this.transport.binaryType = config.binaryType;
		}
		this.pingIntervalMs = config.pingIntervalMs ?? PING_INTERVAL_MS;
		this.pongTimeoutMs = config.pongTimeoutMs ?? PONG_TIMEOUT_MS;
		this.pauseHeartbeatWhenHidden = config.pauseHeartbeatWhenHidden ?? false;
		this.reconnectMaxAttempts =
			config.reconnectMaxAttempts ?? RECONNECT_MAX_ATTEMPTS;
		this.reconnectBaseDelayMs =
			config.reconnectBaseDelayMs ?? RECONNECT_BASE_DELAY_MS;
		this.reconnectMaxDelayMs =
			config.reconnectMaxDelayMs ?? RECONNECT_MAX_DELAY_MS;
		this.ping = config.ping;
		this.isPong = config.isPong;
		this.getAckIdCb = config.getAckId;
		this.getSubscriptionResolvedKeyCb = config.getSubscriptionResolvedKey;
		this.onReady = config.onReady;
		this.onDebugCb = config.onDebug;

		this.handleOnline = this.handleOnline.bind(this);
		this.handleOffline = this.handleOffline.bind(this);
		this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
	}

	// ── Connection lifecycle ──────────────────────────────────────────

	connect(): void {
		this.disposed = false;
		if (
			this.connectionState === "connected" ||
			this.connectionState === "connecting"
		)
			return;

		this.intentionalClose = false;
		this.setConnectionState("connecting");

		this.transport.onopen = () => this.handleOpen();
		this.transport.onclose = (e) => this.handleClose(e);
		this.transport.onmessage = (e) => this.handleMessage(e);
		this.transport.onerror = () => this.emitDebug({ type: "transport-error" });

		this.initiateTransportConnect(++this.connectAttemptId);

		this.addWindowListeners();
	}

	private initiateTransportConnect(attemptId: number): void {
		if (this.urlStatic !== null) {
			this.transport.connect(
				this.urlStatic,
				this.protocols.length ? this.protocols : undefined,
			);
			return;
		}
		this.resolveDynamicUrl(attemptId);
	}

	private async resolveDynamicUrl(attemptId: number): Promise<void> {
		const resolver = this.urlDynamic;
		if (!resolver) return;
		let resolvedUrl: string;
		try {
			resolvedUrl = await resolver();
		} catch (error) {
			if (attemptId !== this.connectAttemptId) return;
			this.emitDebug({ type: "url-resolve-error", error });
			if (this.intentionalClose || this.disposed) return;
			this.scheduleReconnect();
			return;
		}

		if (attemptId !== this.connectAttemptId) return;
		if (this.intentionalClose || this.disposed) return;

		this.transport.connect(
			resolvedUrl,
			this.protocols.length ? this.protocols : undefined,
		);
	}

	disconnect(): void {
		this.intentionalClose = true;
		this.clearTimers();
		this.clearPendingSubscriptions();
		this.dropInFlight();
		this.transport.disconnect(1000, "client disconnect");
		this.setConnectionState("disconnected");
		this.removeWindowListeners();
	}

	forceReconnect(): void {
		if (this.disposed) return;
		this.clearTimers();
		this.clearPendingSubscriptions();
		this.dropInFlight();

		// Detach old handlers to prevent stale close events from interfering
		this.transport.onclose = null;
		this.transport.onopen = null;
		this.transport.onmessage = null;
		this.transport.onerror = null;
		this.transport.disconnect(4000, "force reconnect");

		this.setConnectionState("disconnected");
		this.removeWindowListeners();

		// Start fresh connection
		this.intentionalClose = false;
		this.reconnectAttempt = 0;
		this.connect();
	}

	dispose(): void {
		this.disposed = true;
		this.disconnect();
		this.subscriptionRefCounts.clear();
		this.subscriptionData.clear();
		this.clearPendingSubscriptions();
		this.inFlightMessages.clear();
		this.emitDebug({ type: "dispose" });
	}

	// ── Subscriptions ─────────────────────────────────────────────────

	subscribe(key: string, data?: TClientMsg): void {
		const current = this.subscriptionRefCounts.get(key) ?? 0;
		this.subscriptionRefCounts.set(key, current + 1);
		// First-payload wins: the stored data is what gets replayed on reconnect.
		// Later subscribers only bump the ref count.
		if (current === 0) {
			this.subscriptionData.set(key, data);
		}

		if (current === 0 && !this.pendingSubscriptions.has(key)) {
			this.sendSubscribe(key);
		}

		this.emitDebug({
			type: "subscribe",
			key,
			refCount: current + 1,
			...(data !== undefined
				? { raw: this.serialize(data), deserialized: data }
				: {}),
		});
	}

	unsubscribe(key: string, data?: TClientMsg): void {
		const current = this.subscriptionRefCounts.get(key) ?? 0;
		if (current <= 0) return;

		const next = current - 1;
		if (next === 0) {
			const storedData = this.subscriptionData.get(key);
			this.subscriptionRefCounts.delete(key);
			this.subscriptionData.delete(key);
			const hadPending = this.pendingSubscriptions.delete(key);
			if (hadPending) {
				this.pendingSubscriptionListeners.emit();
			}
			if (data && this.connectionState === "connected") {
				this.rawSend(this.serialize(data));
			}
			this.lastUnsubscribeListeners.emit(key, storedData);
		} else {
			this.subscriptionRefCounts.set(key, next);
		}

		this.emitDebug({
			type: "unsubscribe",
			key,
			refCount: next,
			...(data !== undefined
				? { raw: this.serialize(data), deserialized: data }
				: {}),
		});
	}

	getRefCount(key: string): number {
		return this.subscriptionRefCounts.get(key) ?? 0;
	}

	hasPendingSubscription(key: string): boolean {
		return this.pendingSubscriptions.has(key);
	}

	subscribeToPendingSubscriptions(listener: () => void): () => void {
		return this.pendingSubscriptionListeners.add(listener);
	}

	// ── In-flight ─────────────────────────────────────────────────────
	//
	// Prefer wiring `getAckId` / `getSubscriptionResolvedKey` in the manager
	// config so the library calls these automatically on incoming messages.
	// These are only exposed for the rare case where you need to resolve
	// imperatively (e.g. tests, non-standard flows).

	ackInFlight(ackId: string): void {
		this.inFlightMessages.delete(ackId);
		this.emitDebug({ type: "in-flight-ack", ackId });
	}

	resolvePendingSubscription(key: string): void {
		const hadPending = this.pendingSubscriptions.delete(key);
		if (hadPending) {
			this.pendingSubscriptionListeners.emit();
		}
		this.emitDebug({ type: "pending-subscription-resolved", key });
	}

	// ── Sending ───────────────────────────────────────────────────────

	send(params: TSendParams<TClientMsg>): boolean {
		this.sendIntentListeners.emit(params);
		if (this.connectionState !== "connected") return false;
		const serialized = this.serialize(params.data);
		const sent = this.rawSend(serialized);
		if (sent && params.ackId) {
			this.inFlightMessages.set(params.ackId, params.data);
		}
		if (sent) {
			this.emitDebug({
				type: "message-sent",
				ackId: params.ackId,
				raw: serialized,
				deserialized: params.data,
			});
		}
		return sent;
	}

	getConnectionState(): TConnectionState {
		return this.connectionState;
	}

	// ── Observable connection state ──────────────────────────────────

	subscribeToConnectionState(listener: () => void): () => void {
		return this.connectionStateListeners.add(listener);
	}

	// ── Observable messages ───────────────────────────────────────────

	addMessageListener(cb: (msg: TServerMsg) => void): () => void {
		return this.messageListeners.add(cb);
	}

	addSendIntentListener(
		cb: (params: TSendParams<TClientMsg>) => void,
	): () => void {
		return this.sendIntentListeners.add(cb);
	}

	addInFlightDropListener(
		cb: (messages: { id: string; data: TClientMsg }[]) => void,
	): () => void {
		return this.inFlightDropListeners.add(cb);
	}

	addReadyListener(cb: (restoredKeys: string[]) => void): () => void {
		return this.readyListeners.add(cb);
	}

	addLastUnsubscribeListener(
		cb: (key: string, data: TClientMsg | undefined) => void,
	): () => void {
		return this.lastUnsubscribeListeners.add(cb);
	}

	// ── Debug ─────────────────────────────────────────────────────────

	addDebugListener(
		cb: (event: TDebugEvent<TClientMsg, TServerMsg>) => void,
	): () => void {
		return this.debugListeners.add(cb);
	}

	// ── Snapshot ──────────────────────────────────────────────────────

	/**
	 * Returns a single-read view of the manager's internal state. Use this
	 * for the Inspector or for tests that need to assert across multiple
	 * collections without juggling separate accessors. The returned Maps and
	 * Set are typed Readonly but reference the live internal collections;
	 * clone them before retaining.
	 */
	getSnapshot(): TManagerSnapshot<TClientMsg> {
		return {
			connectionState: this.connectionState,
			subscriptionRefCounts: this.subscriptionRefCounts,
			subscriptionData: this.subscriptionData,
			pendingSubscriptions: this.pendingSubscriptions,
			inFlightMessages: this.inFlightMessages,
			reconnectAttempt: this.reconnectAttempt,
			protocols: this.protocols,
			disposed: this.disposed,
			intentionalClose: this.intentionalClose,
		};
	}

	// ── Private: handlers ─────────────────────────────────────────────

	private handleOpen(): void {
		this.reconnectAttempt = 0;
		this.setConnectionState("connected");
		this.startPingInterval();
		const restoredKeys = this.restoreSubscriptions();
		this.onReady?.(restoredKeys);
		this.readyListeners.emit(restoredKeys);
		this.emitDebug({ type: "ready", restoredKeys });
	}

	private handleClose(event: CloseEvent): void {
		this.clearTimers();
		this.clearPendingSubscriptions();
		this.dropInFlight();

		if (this.intentionalClose || this.disposed) {
			this.setConnectionState("disconnected");
			return;
		}

		if (event.code === 1000) {
			this.setConnectionState("disconnected");
			return;
		}

		this.scheduleReconnect();
	}

	private handleMessage(event: MessageEvent): void {
		const raw = event.data as TIncoming;
		let parsed: TServerMsg;
		try {
			parsed = this.deserialize(raw);
		} catch (error) {
			this.emitDebug({ type: "deserialize-error", raw, error });
			return;
		}

		if (this.isPong?.(parsed)) {
			this.clearPongTimeout();
			this.emitDebug({
				type: "message-received",
				raw,
				deserialized: parsed,
				isPong: true,
			});
			return;
		}

		this.emitDebug({
			type: "message-received",
			raw,
			deserialized: parsed,
			isPong: false,
		});

		const ackId = this.getAckIdCb?.(parsed);
		if (ackId !== undefined) this.ackInFlight(ackId);

		const subKey = this.getSubscriptionResolvedKeyCb?.(parsed);
		if (subKey !== undefined) this.resolvePendingSubscription(subKey);

		this.messageListeners.emit(parsed);
	}

	private handleOnline(): void {
		if (this.intentionalClose || this.disposed) return;
		if (
			this.connectionState === "disconnected" ||
			this.connectionState === "reconnecting"
		) {
			this.reconnectAttempt = 0;
			this.scheduleReconnect();
		}
	}

	private handleOffline(): void {
		this.clearTimers();
		// Detach all transport handlers so a stale ws cannot fire close /
		// open / message / error after we have moved on.
		this.transport.onclose = null;
		this.transport.onopen = null;
		this.transport.onmessage = null;
		this.transport.onerror = null;
		this.transport.disconnect(4000, "offline");
		this.setConnectionState("reconnecting");
	}

	private handleVisibilityChange(): void {
		if (typeof document === "undefined") return;
		if (document.hidden) {
			// Pause heartbeat while hidden. Mobile browsers throttle
			// background timers, which can fire pong timeouts on connections
			// that are actually fine.
			if (this.pingTimer) {
				clearInterval(this.pingTimer);
				this.pingTimer = null;
			}
			this.clearPongTimeout();
		} else if (this.connectionState === "connected") {
			// Fire one ping immediately on resume to validate the socket.
			// On iOS WKWebView the OS may close the underlying connection
			// without firing `onclose` until much later (or at all if the
			// socket is left in a zombie state). This catches a dead
			// connection within `pongTimeoutMs` instead of waiting up to
			// `pingIntervalMs`.
			this.startPingInterval();
			this.firePing();
		}
	}

	// ── Private: reconnection ─────────────────────────────────────────

	private scheduleReconnect(): void {
		if (this.disposed) return;
		if (this.reconnectAttempt >= this.reconnectMaxAttempts) {
			this.setConnectionState("disconnected");
			return;
		}

		this.setConnectionState("reconnecting");

		const delay = Math.min(
			this.reconnectBaseDelayMs * 2 ** this.reconnectAttempt +
				Math.random() * 1_000,
			this.reconnectMaxDelayMs,
		);
		this.reconnectAttempt++;
		this.emitDebug({
			type: "reconnect-scheduled",
			attempt: this.reconnectAttempt,
			delayMs: delay,
		});

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.transport.onopen = () => this.handleOpen();
			this.transport.onclose = (e) => this.handleClose(e);
			this.transport.onmessage = (e) => this.handleMessage(e);
			this.transport.onerror = () =>
				this.emitDebug({ type: "transport-error" });
			this.initiateTransportConnect(++this.connectAttemptId);
		}, delay);
	}

	private restoreSubscriptions(): string[] {
		const restoredKeys: string[] = [];
		for (const key of this.subscriptionData.keys()) {
			this.sendSubscribe(key);
			restoredKeys.push(key);
		}
		return restoredKeys;
	}

	// ── Private: ping / pong ──────────────────────────────────────────

	private firePing(): void {
		if (!this.ping) return;
		const msg = this.ping();
		const raw = this.serialize(msg);
		this.rawSend(raw);
		this.emitDebug({
			type: "message-sent",
			ackId: undefined,
			raw,
			deserialized: msg,
		});
		this.pongTimer = setTimeout(() => {
			this.transport.disconnect(4000, "pong timeout");
		}, this.pongTimeoutMs);
	}

	private startPingInterval(): void {
		this.clearTimers();
		if (!this.ping) return;
		this.pingTimer = setInterval(() => this.firePing(), this.pingIntervalMs);
	}

	private clearPongTimeout(): void {
		if (this.pongTimer) {
			clearTimeout(this.pongTimer);
			this.pongTimer = null;
		}
	}

	// ── Private: helpers ──────────────────────────────────────────────

	private rawSend(data: TWire): boolean {
		try {
			this.transport.send(data);
			return true;
		} catch {
			return false;
		}
	}

	private sendSubscribe(key: string): void {
		if (this.connectionState !== "connected") return;
		const data = this.subscriptionData.get(key);
		const added = !this.pendingSubscriptions.has(key);
		this.pendingSubscriptions.add(key);
		if (added) {
			this.pendingSubscriptionListeners.emit();
		}
		if (data) {
			this.rawSend(this.serialize(data));
		}
	}

	private setConnectionState(state: TConnectionState): void {
		if (this.connectionState === state) return;
		const from = this.connectionState;
		this.connectionState = state;
		this.connectionStateListeners.emit();
		this.emitDebug({ type: "connection-state-change", from, to: state });
	}

	private clearPendingSubscriptions(): void {
		if (this.pendingSubscriptions.size === 0) return;
		this.pendingSubscriptions.clear();
		this.pendingSubscriptionListeners.emit();
	}

	private dropInFlight(): void {
		if (this.inFlightMessages.size === 0) return;
		const messages = Array.from(this.inFlightMessages, ([id, data]) => ({
			id,
			data,
		}));
		this.inFlightMessages.clear();
		this.inFlightDropListeners.emit(messages);
		this.emitDebug({
			type: "in-flight-drop",
			ids: messages.map((m) => m.id),
		});
	}

	private emitDebug(payload: TDebugEventPayload<TClientMsg, TServerMsg>): void {
		if (this.debugListeners.size === 0 && !this.onDebugCb) return;
		const event = {
			...payload,
			id: ++this.debugEventCounter,
			timestamp: Date.now(),
		} as TDebugEvent<TClientMsg, TServerMsg>;
		this.onDebugCb?.(event);
		this.debugListeners.emit(event);
	}

	private clearTimers(): void {
		if (this.pingTimer) {
			clearInterval(this.pingTimer);
			this.pingTimer = null;
		}
		this.clearPongTimeout();
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}

	/**
	 * Replace the WebSocket subprotocols offered on the next connect.
	 * Pass an empty array to drop them.
	 */
	setProtocols(protocols: readonly string[]): void {
		this.protocols = [...protocols];
	}

	private addWindowListeners(): void {
		if (this.windowListenersAttached) return;
		if (typeof window === "undefined") return;
		window.addEventListener("online", this.handleOnline);
		window.addEventListener("offline", this.handleOffline);
		if (this.pauseHeartbeatWhenHidden && typeof document !== "undefined") {
			document.addEventListener(
				"visibilitychange",
				this.handleVisibilityChange,
			);
		}
		this.windowListenersAttached = true;
	}

	private removeWindowListeners(): void {
		if (!this.windowListenersAttached) return;
		if (typeof window !== "undefined") {
			window.removeEventListener("online", this.handleOnline);
			window.removeEventListener("offline", this.handleOffline);
		}
		if (this.pauseHeartbeatWhenHidden && typeof document !== "undefined") {
			document.removeEventListener(
				"visibilitychange",
				this.handleVisibilityChange,
			);
		}
		this.windowListenersAttached = false;
	}
}
