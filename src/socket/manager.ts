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
	TManagerConfig,
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

	private readonly serializeSubscribe:
		| ((type: string, channel: string) => string)
		| undefined;
	private readonly serializeUnsubscribe:
		| ((type: string, channel: string) => string)
		| undefined;

	private readonly onRawMessage: TManagerConfig["onRawMessage"];
	private readonly onConnectionStateChange:
		TManagerConfig["onConnectionStateChange"];
	private readonly onReady: TManagerConfig["onReady"];
	private readonly onInFlightDrop: TManagerConfig["onInFlightDrop"];

	private readonly subscriptionRefCounts = new Map<string, number>();
	private readonly pendingSubscriptions = new Set<string>();
	private readonly inFlightMessages = new Map<string, string>();

	private connectionState: TConnectionState = "disconnected";
	private reconnectAttempt = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private pingTimer: ReturnType<typeof setInterval> | null = null;
	private pongTimer: ReturnType<typeof setTimeout> | null = null;
	private intentionalClose = false;
	private disposed = false;

	constructor(config: TManagerConfig) {
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
		this.serializeSubscribe = config.serializeSubscribe;
		this.serializeUnsubscribe = config.serializeUnsubscribe;
		this.onRawMessage = config.onRawMessage;
		this.onConnectionStateChange = config.onConnectionStateChange;
		this.onReady = config.onReady;
		this.onInFlightDrop = config.onInFlightDrop;

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

	// ── In-flight ─────────────────────────────────────────────────────

	ackInFlight(id: string): void {
		this.inFlightMessages.delete(id);
	}

	resolvePendingSubscription(type: string, channel: string): void {
		this.pendingSubscriptions.delete(subKey(type, channel));
	}

	// ── Sending ───────────────────────────────────────────────────────

	send(id: string | null, data: string): boolean {
		if (this.connectionState !== "connected") return false;
		const sent = this.rawSend(data);
		if (sent && id) {
			this.inFlightMessages.set(id, data);
		}
		return sent;
	}

	getConnectionState(): TConnectionState {
		return this.connectionState;
	}

	// ── Private: handlers ─────────────────────────────────────────────

	private handleOpen(): void {
		this.reconnectAttempt = 0;
		this.setConnectionState("connected");
		this.startPingInterval();
		this.restoreSubscriptions();
		this.onReady?.();
	}

	private handleClose(event: CloseEvent): void {
		this.clearTimers();
		this.pendingSubscriptions.clear();

		if (this.inFlightMessages.size > 0) {
			this.onInFlightDrop?.(Array.from(this.inFlightMessages.keys()));
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
		let parsed: unknown;
		try {
			parsed = JSON.parse(event.data as string);
		} catch {
			return;
		}

		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"action" in parsed &&
			(parsed as { action: unknown }).action === "pong"
		) {
			this.clearPongTimeout();
			return;
		}

		this.onRawMessage?.(parsed);
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
			this.transport.onerror = () => {};
			this.transport.connect(this.url, this.tokenProtocols());
		}, delay);
	}

	private restoreSubscriptions(): void {
		for (const key of this.subscriptionRefCounts.keys()) {
			const [type, channel] = key.split(":");
			this.sendSubscribe(type, channel);
		}
	}

	// ── Private: ping / pong ──────────────────────────────────────────

	private startPingInterval(): void {
		this.clearTimers();
		this.pingTimer = setInterval(() => {
			this.rawSend(
				JSON.stringify({
					action: "ping",
					timestamp: new Date().toISOString(),
				}),
			);
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

	private sendSubscribe(type: string, channel: string): void {
		if (this.connectionState !== "connected") return;
		if (!this.serializeSubscribe) return;
		const key = subKey(type, channel);
		this.pendingSubscriptions.add(key);
		this.rawSend(this.serializeSubscribe(type, channel));
	}

	private sendUnsubscribe(type: string, channel: string): void {
		if (this.connectionState !== "connected") return;
		if (!this.serializeUnsubscribe) return;
		this.rawSend(this.serializeUnsubscribe(type, channel));
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
