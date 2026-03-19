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
	TManagerConfig,
	TSendParams,
} from "./types";

export class WebSocketManager<TClientMsg, TServerMsg> {
	private readonly url: string;
	private readonly transport: IWebSocketTransport;
	private readonly serialize: (msg: TClientMsg) => string;
	private readonly deserialize: (raw: string) => TServerMsg;
	private readonly pingIntervalMs: number;
	private readonly pongTimeoutMs: number;
	private readonly reconnectMaxAttempts: number;
	private readonly reconnectBaseDelayMs: number;
	private readonly reconnectMaxDelayMs: number;

	private readonly ping: (() => TClientMsg) | undefined;
	private readonly isPong: ((msg: TServerMsg) => boolean) | undefined;

	private readonly onMessageReceivedCb: TManagerConfig<
		TClientMsg,
		TServerMsg
	>["onMessageReceived"];
	private readonly onSendIntentCb: TManagerConfig<
		TClientMsg,
		TServerMsg
	>["onSendIntent"];
	private readonly onConnectionStateChange: TManagerConfig<
		TClientMsg,
		TServerMsg
	>["onConnectionStateChange"];
	private readonly onReady: TManagerConfig<TClientMsg, TServerMsg>["onReady"];
	private readonly onInFlightDrop: TManagerConfig<
		TClientMsg,
		TServerMsg
	>["onInFlightDrop"];
	private readonly onLastUnsubscribe: TManagerConfig<
		TClientMsg,
		TServerMsg
	>["onLastUnsubscribe"];
	private readonly onDebugCb: TManagerConfig<TClientMsg, TServerMsg>["onDebug"];

	private readonly subscriptionRefCounts = new Map<string, number>();
	private readonly subscriptionData = new Map<string, TClientMsg | undefined>();
	private readonly pendingSubscriptions = new Set<string>();
	private readonly inFlightMessages = new Map<string, TClientMsg>();
	private readonly connectionStateListeners = new Set<() => void>();
	private readonly debugListeners = new Set<
		(event: TDebugEvent<TClientMsg, TServerMsg>) => void
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

	constructor(config: TManagerConfig<TClientMsg, TServerMsg>) {
		this.url = config.url;
		this.serialize = config.serialize;
		this.deserialize = config.deserialize;
		this.transport = config.transport ?? createTransport();
		this.pingIntervalMs = config.pingIntervalMs ?? PING_INTERVAL_MS;
		this.pongTimeoutMs = config.pongTimeoutMs ?? PONG_TIMEOUT_MS;
		this.reconnectMaxAttempts =
			config.reconnectMaxAttempts ?? RECONNECT_MAX_ATTEMPTS;
		this.reconnectBaseDelayMs =
			config.reconnectBaseDelayMs ?? RECONNECT_BASE_DELAY_MS;
		this.reconnectMaxDelayMs =
			config.reconnectMaxDelayMs ?? RECONNECT_MAX_DELAY_MS;
		this.ping = config.ping;
		this.isPong = config.isPong;
		this.onMessageReceivedCb = config.onMessageReceived;
		this.onSendIntentCb = config.onSendIntent;
		this.onConnectionStateChange = config.onConnectionStateChange;
		this.onReady = config.onReady;
		this.onInFlightDrop = config.onInFlightDrop;
		this.onLastUnsubscribe = config.onLastUnsubscribe;
		this.onDebugCb = config.onDebug;

		this.handleOnline = this.handleOnline.bind(this);
		this.handleOffline = this.handleOffline.bind(this);
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
		this.transport.onerror = () => {};

		this.transport.connect(
			this.url,
			this.protocols.length ? this.protocols : undefined,
		);

		if (typeof window !== "undefined") {
			window.addEventListener("online", this.handleOnline);
			window.addEventListener("offline", this.handleOffline);
		}
	}

	disconnect(): void {
		this.intentionalClose = true;
		this.clearTimers();
		this.transport.disconnect(1000, "client disconnect");
		this.setConnectionState("disconnected");
		this.removeWindowListeners();
	}

	forceReconnect(): void {
		if (this.disposed) return;
		this.clearTimers();
		this.pendingSubscriptions.clear();

		if (this.inFlightMessages.size > 0) {
			const messages = Array.from(this.inFlightMessages, ([id, data]) => ({
				id,
				data,
			}));
			this.onInFlightDrop?.(messages);
			this.emitDebug({
				type: "in-flight-drop",
				ids: messages.map((m) => m.id),
			});
			this.inFlightMessages.clear();
		}

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
		this.pendingSubscriptions.clear();
		this.inFlightMessages.clear();
		this.emitDebug({ type: "dispose" });
	}

	// ── Subscriptions ─────────────────────────────────────────────────

	subscribe(key: string, data?: TClientMsg): void {
		const current = this.subscriptionRefCounts.get(key) ?? 0;
		this.subscriptionRefCounts.set(key, current + 1);
		this.subscriptionData.set(key, data);

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
			this.pendingSubscriptions.delete(key);
			if (data && this.connectionState === "connected") {
				this.rawSend(this.serialize(data));
			}
			this.onLastUnsubscribe?.(key, storedData);
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

	getPendingSubscriptions(): ReadonlySet<string> {
		return this.pendingSubscriptions;
	}

	// ── In-flight ─────────────────────────────────────────────────────

	ackInFlight(ackId: string): void {
		this.inFlightMessages.delete(ackId);
		this.emitDebug({ type: "in-flight-ack", ackId });
	}

	resolvePendingSubscription(key: string): void {
		this.pendingSubscriptions.delete(key);
		this.emitDebug({ type: "pending-subscription-resolved", key });
	}

	// ── Sending ───────────────────────────────────────────────────────

	send(params: TSendParams<TClientMsg>): boolean {
		this.onSendIntentCb?.(params);
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
		this.connectionStateListeners.add(listener);
		return () => {
			this.connectionStateListeners.delete(listener);
		};
	}

	// ── Debug ─────────────────────────────────────────────────────────

	addDebugListener(
		cb: (event: TDebugEvent<TClientMsg, TServerMsg>) => void,
	): () => void {
		this.debugListeners.add(cb);
		return () => {
			this.debugListeners.delete(cb);
		};
	}

	// ── Read-only getters ─────────────────────────────────────────────

	getSubscriptionRefCounts(): ReadonlyMap<string, number> {
		return this.subscriptionRefCounts;
	}

	getSubscriptionData(): ReadonlyMap<string, TClientMsg | undefined> {
		return this.subscriptionData;
	}

	getInFlightMessages(): ReadonlyMap<string, TClientMsg> {
		return this.inFlightMessages;
	}

	getReconnectAttempt(): number {
		return this.reconnectAttempt;
	}

	getProtocols(): readonly string[] {
		return this.protocols;
	}

	isDisposed(): boolean {
		return this.disposed;
	}

	isIntentionalClose(): boolean {
		return this.intentionalClose;
	}

	// ── Private: handlers ─────────────────────────────────────────────

	private handleOpen(): void {
		this.reconnectAttempt = 0;
		this.setConnectionState("connected");
		this.startPingInterval();
		const restoredKeys = this.restoreSubscriptions();
		this.onReady?.();
		this.emitDebug({ type: "ready", restoredKeys });
	}

	private handleClose(event: CloseEvent): void {
		this.clearTimers();
		this.pendingSubscriptions.clear();

		if (this.inFlightMessages.size > 0) {
			const messages = Array.from(this.inFlightMessages, ([id, data]) => ({
				id,
				data,
			}));
			this.onInFlightDrop?.(messages);
			this.emitDebug({
				type: "in-flight-drop",
				ids: messages.map((m) => m.id),
			});
			this.inFlightMessages.clear();
		}

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
		const raw = event.data as string;
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
		this.onMessageReceivedCb?.(parsed);
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
		this.transport.onclose = null;
		this.transport.disconnect(4000, "offline");
		this.setConnectionState("reconnecting");
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
			this.transport.onerror = () => {};
			this.transport.connect(
				this.url,
				this.protocols.length ? this.protocols : undefined,
			);
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

	private startPingInterval(): void {
		this.clearTimers();
		if (!this.ping) return;

		this.pingTimer = setInterval(() => {
			if (this.ping) {
				const msg = this.ping();
				const raw = this.serialize(msg);
				this.rawSend(raw);
				this.emitDebug({
					type: "message-sent",
					ackId: undefined,
					raw,
					deserialized: msg,
				});
			}
			this.pongTimer = setTimeout(() => {
				this.transport.disconnect(4000, "pong timeout");
			}, this.pongTimeoutMs);
		}, this.pingIntervalMs);
	}

	private clearPongTimeout(): void {
		if (this.pongTimer) {
			clearTimeout(this.pongTimer);
			this.pongTimer = null;
		}
	}

	// ── Private: helpers ──────────────────────────────────────────────

	private rawSend(data: string): boolean {
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
		this.pendingSubscriptions.add(key);
		if (data) {
			this.rawSend(this.serialize(data));
		}
	}

	private setConnectionState(state: TConnectionState): void {
		if (this.connectionState === state) return;
		const from = this.connectionState;
		this.connectionState = state;
		this.onConnectionStateChange?.(state);
		for (const listener of this.connectionStateListeners) {
			listener();
		}
		this.emitDebug({ type: "connection-state-change", from, to: state });
	}

	private emitDebug(payload: TDebugEventPayload<TClientMsg, TServerMsg>): void {
		if (this.debugListeners.size === 0 && !this.onDebugCb) return;
		const event = {
			...payload,
			id: ++this.debugEventCounter,
			timestamp: Date.now(),
		} as TDebugEvent<TClientMsg, TServerMsg>;
		this.onDebugCb?.(event);
		for (const listener of this.debugListeners) {
			listener(event);
		}
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

	addProtocols(protocols: string[]): void {
		this.protocols = [...this.protocols, ...protocols];
	}

	private removeWindowListeners(): void {
		if (typeof window !== "undefined") {
			window.removeEventListener("online", this.handleOnline);
			window.removeEventListener("offline", this.handleOffline);
		}
	}
}
