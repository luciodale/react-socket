import {
	PING_INTERVAL_MS,
	PONG_TIMEOUT_MS,
	QUEUE_MAX_AGE_MS,
	RECONNECT_BASE_DELAY_MS,
	RECONNECT_MAX_ATTEMPTS,
	RECONNECT_MAX_DELAY_MS,
} from "./constants";
import {
	drainQueue,
	enqueue,
	loadQueue,
	pruneStaleMessages,
	removeByChannelAndType,
} from "./queue";
import { createTransport } from "./transport";
import type {
	IWebSocketTransport,
	TConnectionState,
	TQueuedMessage,
	TSocketError,
	TSocketMessageFromClientToServer,
	TSocketMessageFromServerToClient,
	TSubscriptionType,
	TWebSocketManagerConfig,
} from "./types";

function subKey(type: string, channel: string): string {
	return `${type}:${channel}`;
}

export class WebSocketManager {
	private readonly url: string;
	private readonly transport: IWebSocketTransport;
	private readonly pingIntervalMs: number;
	private readonly pongTimeoutMs: number;
	private readonly reconnectMaxAttempts: number;
	private readonly reconnectBaseDelayMs: number;
	private readonly reconnectMaxDelayMs: number;
	private readonly token: string | undefined;

	private readonly onMessage: TWebSocketManagerConfig["onMessage"];
	private readonly onConnectionStateChange: TWebSocketManagerConfig["onConnectionStateChange"];
	private readonly onError: TWebSocketManagerConfig["onError"];

	private readonly sendListeners = new Set<
		(msg: TSocketMessageFromClientToServer) => void
	>();
	private readonly subscriptionRefCounts = new Map<string, number>();
	private readonly pendingSubscriptions = new Set<string>();
	private readonly inFlightMessages = new Map<
		string,
		TSocketMessageFromClientToServer
	>();

	private connectionState: TConnectionState = "disconnected";
	private reconnectAttempt = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private pingTimer: ReturnType<typeof setInterval> | null = null;
	private pongTimer: ReturnType<typeof setTimeout> | null = null;
	private intentionalClose = false;
	private disposed = false;
	private queue: TQueuedMessage[];

	constructor(config: TWebSocketManagerConfig) {
		this.url = config.url;
		this.transport = config.transport ?? createTransport();
		this.pingIntervalMs = config.pingIntervalMs ?? PING_INTERVAL_MS;
		this.pongTimeoutMs = config.pongTimeoutMs ?? PONG_TIMEOUT_MS;
		this.reconnectMaxAttempts =
			config.reconnectMaxAttempts ?? RECONNECT_MAX_ATTEMPTS;
		this.reconnectBaseDelayMs =
			config.reconnectBaseDelayMs ?? RECONNECT_BASE_DELAY_MS;
		this.reconnectMaxDelayMs =
			config.reconnectMaxDelayMs ?? RECONNECT_MAX_DELAY_MS;
		this.token = config.token;
		this.onMessage = config.onMessage;
		this.onConnectionStateChange = config.onConnectionStateChange;
		this.onError = config.onError;

		this.queue = pruneStaleMessages(loadQueue(), QUEUE_MAX_AGE_MS);

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
		this.transport.onerror = () => {
			// onerror is always followed by onclose — no action needed
		};

		this.transport.connect(this.url, this.tokenProtocols());

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

	dispose(): void {
		this.disposed = true;
		this.disconnect();
		this.subscriptionRefCounts.clear();
		this.pendingSubscriptions.clear();
		this.inFlightMessages.clear();
	}

	// ── Subscriptions ─────────────────────────────────────────────────

	subscribe(type: string, channel: string): void {
		const key = subKey(type, channel);
		const current = this.subscriptionRefCounts.get(key) ?? 0;
		this.subscriptionRefCounts.set(key, current + 1);

		if (current === 0 && !this.pendingSubscriptions.has(key)) {
			this.sendSubscribe(type, channel);
		}
	}

	unsubscribe(type: string, channel: string): void {
		const key = subKey(type, channel);
		const current = this.subscriptionRefCounts.get(key) ?? 0;
		if (current <= 0) return;

		const next = current - 1;
		if (next === 0) {
			this.subscriptionRefCounts.delete(key);
			this.pendingSubscriptions.delete(key);
			this.sendUnsubscribe(type, channel);
		} else {
			this.subscriptionRefCounts.set(key, next);
		}
	}

	getRefCount(type: string, channel: string): number {
		return this.subscriptionRefCounts.get(subKey(type, channel)) ?? 0;
	}

	getPendingSubscriptions(): ReadonlySet<string> {
		return this.pendingSubscriptions;
	}

	getInFlightMessages(): ReadonlyMap<
		string,
		TSocketMessageFromClientToServer
	> {
		return this.inFlightMessages;
	}

	// ── Sending ───────────────────────────────────────────────────────

	send(msg: TSocketMessageFromClientToServer): boolean {
		if (this.connectionState !== "connected") {
			this.queue = enqueue(this.queue, msg);
			return false;
		}

		if ("channel" in msg && msg.action === "message") {
			const key = subKey(msg.type, msg.channel);
			if (!this.subscriptionRefCounts.has(key)) {
				const error: TSocketError = {
					action: "error",
					code: 4001,
					message: `Not subscribed to ${key}`,
					channel: msg.channel,
					type: msg.type,
				};
				this.onError?.(error);
				return false;
			}
		}

		const sent = this.rawSend(msg);
		if (sent && msg.action === "message") {
			this.inFlightMessages.set(msg.id, msg);
		}
		return sent;
	}

	getConnectionState(): TConnectionState {
		return this.connectionState;
	}

	getQueueLength(): number {
		return this.queue.length;
	}

	// ── Send listeners ───────────────────────────────────────────────

	addSendListener(
		cb: (msg: TSocketMessageFromClientToServer) => void,
	): void {
		this.sendListeners.add(cb);
	}

	removeSendListener(
		cb: (msg: TSocketMessageFromClientToServer) => void,
	): void {
		this.sendListeners.delete(cb);
	}

	private notifySendListeners(msg: TSocketMessageFromClientToServer): void {
		for (const cb of this.sendListeners) {
			cb(msg);
		}
	}

	// ── Private: handlers ─────────────────────────────────────────────

	private handleOpen(): void {
		this.reconnectAttempt = 0;
		this.setConnectionState("connected");
		this.startPingInterval();
		this.restoreSubscriptions();
		this.drainOutgoingQueue();
	}

	private handleClose(event: CloseEvent): void {
		this.clearTimers();
		this.pendingSubscriptions.clear();
		this.requeueInFlightMessages();

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
		let msg: TSocketMessageFromServerToClient;
		try {
			msg = JSON.parse(
				event.data as string,
			) as TSocketMessageFromServerToClient;
		} catch {
			return;
		}

		if (msg.action === "pong") {
			this.clearPongTimeout();
			return;
		}

		if (msg.action === "subscribe_ack" && "type" in msg && "channel" in msg) {
			this.pendingSubscriptions.delete(subKey(msg.type, msg.channel));
		}

		// Acknowledge in-flight message on echo + purge failed queue entries
		if (
			msg.action === "message" &&
			msg.type === "conversation" &&
			msg.delivery === "event"
		) {
			this.inFlightMessages.delete(msg.id);
			this.queue = removeByChannelAndType(
				this.queue,
				msg.channel,
				msg.type,
			);
		}

		// Remove from in-flight on business error (app controls retry)
		if (
			msg.action === "message" &&
			msg.type === "conversation" &&
			msg.delivery === "error" &&
			msg.messageId
		) {
			this.inFlightMessages.delete(msg.messageId);
		}

		// Re-queue message on protocol-level error
		if (msg.action === "error") {
			if (msg.messageId) {
				const original = this.inFlightMessages.get(msg.messageId);
				if (original) {
					this.inFlightMessages.delete(msg.messageId);
					this.queue = enqueue(this.queue, original);
				}
			}
			this.onError?.(msg);
		}

		this.onMessage?.(msg);
	}

	private handleOnline(): void {
		if (this.connectionState === "disconnected" && !this.intentionalClose) {
			this.reconnectAttempt = 0;
			this.scheduleReconnect();
		}
	}

	private handleOffline(): void {
		this.clearTimers();
		if (this.connectionState !== "disconnected") {
			this.setConnectionState("reconnecting");
		}
	}

	// ── Private: reconnection ─────────────────────────────────────────

	private scheduleReconnect(): void {
		if (this.disposed) return;
		if (this.reconnectAttempt >= this.reconnectMaxAttempts) {
			this.setConnectionState("disconnected");
			this.onError?.({
				action: "error",
				code: 4002,
				message: "Max reconnection attempts reached",
			});
			return;
		}

		this.setConnectionState("reconnecting");

		const delay = Math.min(
			this.reconnectBaseDelayMs * 2 ** this.reconnectAttempt +
				Math.random() * 1_000,
			this.reconnectMaxDelayMs,
		);
		this.reconnectAttempt++;

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.transport.onopen = () => this.handleOpen();
			this.transport.onclose = (e) => this.handleClose(e);
			this.transport.onmessage = (e) => this.handleMessage(e);
			this.transport.onerror = () => {
				// onerror is always followed by onclose — no action needed
			};
			this.transport.connect(this.url, this.tokenProtocols());
		}, delay);
	}

	private restoreSubscriptions(): void {
		for (const key of this.subscriptionRefCounts.keys()) {
			const [type, channel] = key.split(":");
			this.sendSubscribe(type, channel);
		}
	}

	private drainOutgoingQueue(): void {
		this.queue = drainQueue(
			this.queue,
			(data) => {
				try {
					this.transport.send(data);
					return true;
				} catch {
					return false;
				}
			},
			(entry) => this.notifySendListeners(entry.payload),
		);
	}

	// ── Private: in-flight ───────────────────────────────────────────

	private requeueInFlightMessages(): void {
		for (const msg of this.inFlightMessages.values()) {
			this.queue = enqueue(this.queue, msg);
		}
		this.inFlightMessages.clear();
	}

	// ── Private: ping / pong ──────────────────────────────────────────

	private startPingInterval(): void {
		this.clearTimers();
		this.pingTimer = setInterval(() => {
			this.rawSend({ action: "ping", timestamp: new Date().toISOString() });
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

	private rawSend(msg: TSocketMessageFromClientToServer): boolean {
		try {
			this.transport.send(JSON.stringify(msg));
			this.notifySendListeners(msg);
			return true;
		} catch {
			this.queue = enqueue(this.queue, msg);
			return false;
		}
	}

	private sendSubscribe(type: string, channel: string): void {
		if (this.connectionState !== "connected") return;
		const key = subKey(type, channel);
		this.pendingSubscriptions.add(key);
		this.rawSend({
			action: "subscribe",
			type: type as TSubscriptionType,
			channel,
		});
	}

	private sendUnsubscribe(type: string, channel: string): void {
		if (this.connectionState !== "connected") return;
		this.rawSend({
			action: "unsubscribe",
			type: type as TSubscriptionType,
			channel,
		});
	}

	private setConnectionState(state: TConnectionState): void {
		if (this.connectionState === state) return;
		this.connectionState = state;
		this.onConnectionStateChange?.(state);
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

	private tokenProtocols(): string[] | undefined {
		return this.token ? ["access_token", this.token] : undefined;
	}

	private removeWindowListeners(): void {
		if (typeof window !== "undefined") {
			window.removeEventListener("online", this.handleOnline);
			window.removeEventListener("offline", this.handleOffline);
		}
	}
}
