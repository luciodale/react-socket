import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { WebSocketManager } from "./manager";
import type { TConnectionState } from "./types";

export function useConnectionState(
	manager: WebSocketManager,
): TConnectionState {
	return useSyncExternalStore(
		(listener) => manager.subscribeToConnectionState(listener),
		() => manager.getConnectionState(),
		() => manager.getConnectionState(),
	);
}

export function useSubscription(
	manager: WebSocketManager,
	key: string,
	data?: string,
): void {
	useEffect(() => {
		manager.subscribe(key, data);
		return () => {
			manager.unsubscribe(key);
		};
	}, [manager, key, data]);
}

export function useSend(
	manager: WebSocketManager,
): (id: string | null, data: string) => boolean {
	return useCallback(
		(id: string | null, data: string) => manager.send(id, data),
		[manager],
	);
}
