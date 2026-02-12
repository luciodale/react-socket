import { createTransport } from "../socket/transport";
import type {
	IWebSocketTransport,
	TConnectionState,
	TSocketPing,
	TSocketPong,
} from "../socket/types";
import {
	PING_INTERVAL_MS,
	PONG_TIMEOUT_MS,
	RECONNECT_BASE_DELAY_MS,
	RECONNECT_MAX_ATTEMPTS,
	RECONNECT_MAX_DELAY_MS,
} from "./constants";
import type { TMiniSocketConfig, TNotification } from "./types";

export class MiniSocketManager {
	private readonly url: string;
	private readonly token: string | undefined;
	private readonly transport: IWebSocketTransport;
	private readonly pingIntervalMs: number;
	private readonly pongTimeoutMs: number;
	private readonly reconnectMaxAttempts: number;
	private readonly reconnectBaseDelayMs: number;
	private readonly reconnectMaxDelayMs: number;

	private readonly onMessage: TMiniSocketConfig["onMessage"];
	private readonly onConnectionStateChange: TMiniSocketConfig["onConnectionStateChange"];
	private readonly onError: TMiniSocketConfig["onError"];

	private connectionState: TConnectionState = "disconnected";
	private reconnectAttempt = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private pingTimer: ReturnType<typeof setInterval> | null = null;
	private pongTimer: ReturnType<typeof setTimeout> | null = null;
	private intentionalClose = false;
	private disposed = false;

	constructor(config: TMiniSocketConfig) {
		this.url = config.url;
		this.token = config.token;
		this.transport = config.transport ?? createTransport();
		this.pingIntervalMs = config.pingIntervalMs ?? PING_INTERVAL_MS;
		this.pongTimeoutMs = config.pongTimeoutMs ?? PONG_TIMEOUT_MS;
		this.reconnectMaxAttempts =
			config.reconnectMaxAttempts ?? RECONNECT_MAX_ATTEMPTS;
		this.reconnectBaseDelayMs =
			config.reconnectBaseDelayMs ?? RECONNECT_BASE_DELAY_MS;
		this.reconnectMaxDelayMs =
			config.reconnectMaxDelayMs ?? RECONNECT_MAX_DELAY_MS;
		this.onMessage = config.onMessage;
		this.onConnectionStateChange = config.onConnectionStateChange;
		this.onError = config.onError;

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

		this.bindTransportHandlers();
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
	}

	getConnectionState(): TConnectionState {
		return this.connectionState;
	}

	// ── Private: handlers ─────────────────────────────────────────────

	private handleOpen(): void {
		this.reconnectAttempt = 0;
		this.setConnectionState("connected");
		this.startPingInterval();
	}

	private handleClose(event: CloseEvent): void {
		this.clearTimers();

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
		let msg: Record<string, unknown>;
		try {
			msg = JSON.parse(event.data as string) as Record<string, unknown>;
		} catch {
			return;
		}

		if ((msg as unknown as TSocketPong).action === "pong") {
			this.clearPongTimeout();
			return;
		}

		if (msg.action === "error") {
			this.onError?.(msg as unknown as Parameters<NonNullable<TMiniSocketConfig["onError"]>>[0]);
			return;
		}

		// Treat everything else as a notification
		this.onMessage?.(msg as unknown as TNotification);
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
			this.bindTransportHandlers();
			this.transport.connect(this.url, this.tokenProtocols());
		}, delay);
	}

	// ── Private: ping / pong ──────────────────────────────────────────

	private startPingInterval(): void {
		this.clearTimers();
		this.pingTimer = setInterval(() => {
			const ping: TSocketPing = {
				action: "ping",
				timestamp: new Date().toISOString(),
			};
			try {
				this.transport.send(JSON.stringify(ping));
			} catch {
				// send failure will trigger close
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

	private tokenProtocols(): string[] | undefined {
		return this.token ? ["access_token", this.token] : undefined;
	}

	private bindTransportHandlers(): void {
		this.transport.onopen = () => this.handleOpen();
		this.transport.onclose = (e) => this.handleClose(e);
		this.transport.onmessage = (e) => this.handleMessage(e);
		this.transport.onerror = () => {};
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

	private removeWindowListeners(): void {
		if (typeof window !== "undefined") {
			window.removeEventListener("online", this.handleOnline);
			window.removeEventListener("offline", this.handleOffline);
		}
	}
}
