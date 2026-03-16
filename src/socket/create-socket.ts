import type { ReactNode } from "react";
import {
	createContext,
	createElement,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { createInternalStore } from "./internal-store";
import { WebSocketManager } from "./manager";
import type {
	TConnectionState,
	TCreateSocketConfig,
	IWebSocketTransport,
} from "./types";

// ── Provider props ──────────────────────────────────────────────────

export type TProviderProps = {
	url: string;
	token?: string;
	transport?: IWebSocketTransport;
	pingIntervalMs?: number;
	pongTimeoutMs?: number;
	reconnectMaxAttempts?: number;
	reconnectBaseDelayMs?: number;
	reconnectMaxDelayMs?: number;
	children: ReactNode;
};

// ── Connection status ───────────────────────────────────────────────

type TConnectionStatus =
	| { visible: false }
	| {
			visible: true;
			state: Exclude<TConnectionState, "connected">;
			message: string;
	  }
	| { visible: true; state: "connected"; message: string };

// ── Factory ─────────────────────────────────────────────────────────

export function createSocket<TServerMsg, TClientMsg, TUserState>(
	config: TCreateSocketConfig<TServerMsg, TClientMsg, TUserState>,
) {
	const adapter = config.store;
	const internalStore = createInternalStore();

	function getStoreApi() {
		return {
			set: (fn: (state: TUserState) => Partial<TUserState>) => {
				adapter.set(fn);
			},
			get: () => adapter.get(),
		};
	}

	// ── Context ──────────────────────────────────────────────────────

	type TSocketContext = {
		manager: WebSocketManager;
		send: (msg: TClientMsg) => boolean;
	};

	const SocketContext = createContext<TSocketContext | null>(null);

	function useSocketContext(): TSocketContext {
		const ctx = useContext(SocketContext);
		if (!ctx) {
			throw new Error("Socket hooks must be used within <Provider>");
		}
		return ctx;
	}

	// ── Provider ─────────────────────────────────────────────────────

	function Provider(props: TProviderProps) {
		const ctxRef = useRef<TSocketContext | null>(null);

		if (!ctxRef.current) {
			let managerRef: WebSocketManager | null = null;

			function typedSend(msg: TClientMsg): boolean {
				if (!managerRef) return false;
				const id = config.getOutboundId?.(msg) ?? null;
				const data = JSON.stringify(msg);
				return managerRef.send(id, data);
			}

			const manager = new WebSocketManager({
				url: props.url,
				token: props.token,
				transport: props.transport,
				pingIntervalMs: props.pingIntervalMs,
				pongTimeoutMs: props.pongTimeoutMs,
				reconnectMaxAttempts: props.reconnectMaxAttempts,
				reconnectBaseDelayMs: props.reconnectBaseDelayMs,
				reconnectMaxDelayMs: props.reconnectMaxDelayMs,
				serializeSubscribe: config.subscribe
					? (type, channel) =>
							JSON.stringify(config.subscribe!(type, channel))
					: undefined,
				serializeUnsubscribe: config.unsubscribe
					? (type, channel) =>
							JSON.stringify(config.unsubscribe!(type, channel))
					: undefined,
				onRawMessage(parsed) {
					const msg = parsed as TServerMsg;

					if (config.resolveSubscriptionAck) {
						const sub = config.resolveSubscriptionAck(msg);
						if (sub) {
							manager.resolvePendingSubscription(
								sub.type,
								sub.channel,
							);
						}
					}

					if (config.resolveInFlight) {
						const resolution = config.resolveInFlight(msg);
						if (resolution) {
							if (resolution.ack) {
								manager.ackInFlight(resolution.ack);
							}
							if (resolution.drop) {
								manager.ackInFlight(resolution.drop);
								config.onInFlightDrop?.(
									[resolution.drop],
									getStoreApi(),
								);
							}
						}
					}

					config.onMessage(msg, {
						...getStoreApi(),
						send: typedSend,
					});
				},
				onConnectionStateChange(state) {
					internalStore.set((s) => ({
						connectionState: state,
						hasConnected: s.hasConnected || state === "connected",
						hasDisconnected:
							s.hasDisconnected ||
							state === "disconnected" ||
							state === "reconnecting",
					}));
				},
				onReady() {
					config.onConnect?.({ send: typedSend });
				},
				onInFlightDrop(ids) {
					config.onInFlightDrop?.(ids, getStoreApi());
				},
			});

			managerRef = manager;
			ctxRef.current = { manager, send: typedSend };
		}

		useEffect(() => {
			const { manager } = ctxRef.current!;

			if (config.onBeforeConnect) {
				config.onBeforeConnect().then(() => manager.connect());
			} else {
				manager.connect();
			}

			return () => manager.dispose();
		}, []);

		return createElement(
			SocketContext.Provider,
			{ value: ctxRef.current! },
			props.children,
		);
	}

	// ── useSend ──────────────────────────────────────────────────────

	function useSend(): (msg: TClientMsg) => boolean {
		const ctx = useSocketContext();
		return useCallback(
			(msg: TClientMsg) => ctx.send(msg),
			[ctx.send],
		);
	}

	// ── useSubscription ──────────────────────────────────────────────

	function useSubscription<T>(
		type: string,
		channel: string,
		selector: (state: TUserState) => T,
	): { data: T; isSubscribed: boolean; connectionState: TConnectionState } {
		const { manager } = useSocketContext();

		const data = adapter.useSelector(selector);
		const connectionState = internalStore.useSelector(
			(s) => s.connectionState,
		);

		const refKey = `${type}:${channel}`;
		const isSubscribed = internalStore.useSelector(
			(s) => (s._refCounts[refKey] ?? 0) > 0,
		);

		useEffect(() => {
			internalStore.set((s) => ({
				_refCounts: {
					...s._refCounts,
					[refKey]: (s._refCounts[refKey] ?? 0) + 1,
				},
			}));
			manager.subscribe(type, channel);

			return () => {
				manager.unsubscribe(type, channel);
				internalStore.set((s) => {
					const current = s._refCounts[refKey] ?? 0;
					if (current <= 1) {
						const { [refKey]: _, ...rest } = s._refCounts;
						config.onChannelCleanup?.(
							type,
							channel,
							getStoreApi(),
						);
						return { _refCounts: rest };
					}
					return {
						_refCounts: {
							...s._refCounts,
							[refKey]: current - 1,
						},
					};
				});
			};
		}, [manager, type, channel, refKey]);

		return { data, isSubscribed, connectionState };
	}

	// ── useConnectionStatus ──────────────────────────────────────────

	function useConnectionStatus(): TConnectionStatus {
		const connectionState = internalStore.useSelector(
			(s) => s.connectionState,
		);
		const hasDisconnected = internalStore.useSelector(
			(s) => s.hasDisconnected,
		);

		if (connectionState === "connected" && hasDisconnected) {
			return {
				visible: true,
				state: "connected",
				message: "Back online",
			};
		}

		if (connectionState === "reconnecting") {
			return {
				visible: true,
				state: "reconnecting",
				message: "Reconnecting...",
			};
		}

		if (connectionState === "disconnected" && hasDisconnected) {
			return {
				visible: true,
				state: "disconnected",
				message: "Connection lost",
			};
		}

		return { visible: false };
	}

	// ── ConnectionStatus component ───────────────────────────────────

	const BANNER_STYLE: React.CSSProperties = {
		position: "fixed",
		top: 0,
		left: 0,
		right: 0,
		padding: "8px 16px",
		textAlign: "center",
		fontSize: 14,
		fontWeight: 500,
		zIndex: 9999,
		transition: "transform 0.3s ease, opacity 0.3s ease",
	};

	const BANNER_COLORS: Record<string, { bg: string; fg: string }> = {
		reconnecting: { bg: "#fef3c7", fg: "#92400e" },
		disconnected: { bg: "#fee2e2", fg: "#991b1b" },
		connected: { bg: "#d1fae5", fg: "#065f46" },
	};

	function ConnectionStatus() {
		const status = useConnectionStatus();
		const visible = status.visible;
		const state: TConnectionState | null = status.visible
			? status.state
			: null;
		const message = status.visible ? status.message : null;

		const [show, setShow] = useState(false);
		const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

		useEffect(() => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}

			if (!visible) {
				setShow(false);
				return;
			}

			setShow(true);

			if (state === "connected") {
				timerRef.current = setTimeout(() => setShow(false), 3_000);
			}

			return () => {
				if (timerRef.current) {
					clearTimeout(timerRef.current);
					timerRef.current = null;
				}
			};
		}, [visible, state]);

		if (!visible || !state) return null;

		const colors = BANNER_COLORS[state] ?? BANNER_COLORS.disconnected;

		return createElement("div", {
			style: {
				...BANNER_STYLE,
				backgroundColor: colors.bg,
				color: colors.fg,
				transform: show ? "translateY(0)" : "translateY(-100%)",
				opacity: show ? 1 : 0,
			},
			children: message,
		});
	}

	// ── Return ───────────────────────────────────────────────────────

	return {
		Provider,
		useSubscription,
		useSend,
		useConnectionStatus,
		ConnectionStatus,
	};
}
