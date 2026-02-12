import type { ReactNode } from "react";
import {
	createContext,
	createElement,
	useContext,
	useEffect,
	useRef,
} from "react";
import { WS_URL } from "./constants";
import { WebSocketManager } from "./manager";
import { useSocketStore } from "./store";
import type { TWebSocketManagerConfig } from "./types";

// ── Context ─────────────────────────────────────────────────────────

const WebSocketManagerContext = createContext<WebSocketManager | null>(null);

export function useWebSocketManager(): WebSocketManager {
	const manager = useContext(WebSocketManagerContext);
	if (!manager) {
		throw new Error(
			"useWebSocketManager must be used within <WebSocketProvider>",
		);
	}
	return manager;
}

// ── Provider ────────────────────────────────────────────────────────

type TWebSocketProviderProps = {
	url?: string;
	token?: string;
	config?: Partial<TWebSocketManagerConfig>;
	children: ReactNode;
};

export function WebSocketProvider({
	url = WS_URL,
	token,
	config,
	children,
}: TWebSocketProviderProps) {
	const store = useSocketStore;

	const managerRef = useRef<WebSocketManager | null>(null);
	if (!managerRef.current) {
		managerRef.current = new WebSocketManager({
			url,
			token,
			...config,
			onMessage: (msg) => {
				store.getState().handleServerMessage(msg);
				config?.onMessage?.(msg);
			},
			onConnectionStateChange: (state) => {
				store.getState().setConnectionState(state);
				config?.onConnectionStateChange?.(state);
			},
			onError: (error) => {
				store.getState().setLastError(error);
				config?.onError?.(error);
			},
		});
	}

	useEffect(() => {
		const manager = managerRef.current;
		if (!manager) return;
		manager.connect();
		return () => {
			manager.dispose();
		};
	}, []);

	return createElement(
		WebSocketManagerContext.Provider,
		{ value: managerRef.current },
		children,
	);
}

// ── Barrel exports ──────────────────────────────────────────────────

export { ConnectionStatus } from "./hooks/connection-status";
export { useConnectionStatus } from "./hooks/use-connection-status";
export { useSubConversation } from "./hooks/use-sub-conversation";
export { useSubNotification } from "./hooks/use-sub-notification";
export { WebSocketManager } from "./manager";
export {
	selectConnectionState,
	selectConversationMessages,
	selectHasDisconnected,
	selectIsSubscribed,
	selectLastError,
	selectNotificationMessages,
	useSocketStore,
} from "./store";
export type {
	IWebSocketTransport,
	TClientConversationMessage,
	TConnectionState,
	TConversationContentBlock,
	TConversationDumpFromServer,
	TConversationErrorFromServer,
	TConversationErrorType,
	TConversationEventFromServer,
	TConversationFromClientToServer,
	TConversationFromServerToClient,
	TMessageStatus,
	TNotificationDumpFromServer,
	TNotificationEventFromServer,
	TNotificationFromServerToClient,
	TQueuedMessage,
	TSocketError,
	TSocketMessageFromClientToServer,
	TSocketMessageFromServerToClient,
	TSocketPing,
	TSocketPong,
	TStoredConversationMessage,
	TStoredNotification,
	TSubscribe,
	TSubscribeAck,
	TSubscriptionType,
	TUnsubscribe,
	TUnsubscribeAck,
	TWebSocketManagerConfig,
} from "./types";
