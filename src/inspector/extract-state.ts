import type { TSocketStore } from "../socket/store";
import type { TSocketStoreState } from "./types";

export function extractState(fullState: TSocketStore): TSocketStoreState {
	return {
		connectionState: fullState.connectionState,
		hasConnected: fullState.hasConnected,
		conversationMessages: fullState.conversationMessages,
		notificationMessages: fullState.notificationMessages,
		subscriptionRefCounts: fullState.subscriptionRefCounts,
		pendingQueueLength: fullState.pendingQueueLength,
		lastError: fullState.lastError,
	};
}
