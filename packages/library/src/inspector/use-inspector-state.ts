import { useCallback, useEffect, useReducer } from "react";
import type { WebSocketManager } from "../manager";
import type { TDebugEvent } from "../types";
import { inspectorReducer } from "./inspector-reducer";
import type {
	TInspectorAction,
	TInspectorState,
	TManagerState,
	TSnapshot,
} from "./inspector-types";

function cloneManagerState<TClientMsg, TServerMsg>(
	manager: WebSocketManager<TClientMsg, TServerMsg>,
): TManagerState<TClientMsg> {
	return {
		connectionState: manager.getConnectionState(),
		subscriptionRefCounts: new Map(manager.getSubscriptionRefCounts()),
		subscriptionData: new Map(manager.getSubscriptionData()),
		pendingSubscriptions: new Set(manager.getPendingSubscriptions()),
		inFlightMessages: new Map(manager.getInFlightMessages()),
		reconnectAttempt: manager.getReconnectAttempt(),
		protocols: [...manager.getProtocols()],
		disposed: manager.isDisposed(),
		intentionalClose: manager.isIntentionalClose(),
	};
}

function createInitialState<TClientMsg, TServerMsg>(
	maxSnapshots: number,
): TInspectorState<TClientMsg, TServerMsg> {
	return {
		snapshots: [],
		maxSnapshots,
		selectedSnapshotId: null,
	};
}

export function useInspectorState<TClientMsg, TServerMsg>(
	manager: WebSocketManager<TClientMsg, TServerMsg>,
	maxSnapshots = 500,
) {
	const [state, dispatch] = useReducer(
		(
			s: TInspectorState<TClientMsg, TServerMsg>,
			a: TInspectorAction<TClientMsg, TServerMsg>,
		) => inspectorReducer(s, a),
		maxSnapshots,
		createInitialState<TClientMsg, TServerMsg>,
	);

	useEffect(() => {
		return manager.addDebugListener(
			(event: TDebugEvent<TClientMsg, TServerMsg>) => {
				const snapshot: TSnapshot<TClientMsg, TServerMsg> = {
					id: event.id,
					timestamp: event.timestamp,
					event,
					state: cloneManagerState(manager),
				};
				dispatch({ type: "add-snapshot", snapshot });
			},
		);
	}, [manager]);

	const selectSnapshot = useCallback((id: number | null) => {
		dispatch({ type: "select-snapshot", id });
	}, []);

	const clear = useCallback(() => {
		dispatch({ type: "clear" });
	}, []);

	return {
		state,
		selectSnapshot,
		clear,
	};
}
