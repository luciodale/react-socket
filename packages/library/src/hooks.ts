import { useSyncExternalStore } from "react";
import type { TConnectionState } from "./types";

type TConnectionStateSource = {
	subscribeToConnectionState: (listener: () => void) => () => void;
	getConnectionState: () => TConnectionState;
};

export function useConnectionState(
	manager: TConnectionStateSource,
): TConnectionState {
	return useSyncExternalStore(
		(listener) => manager.subscribeToConnectionState(listener),
		() => manager.getConnectionState(),
		() => manager.getConnectionState(),
	);
}
