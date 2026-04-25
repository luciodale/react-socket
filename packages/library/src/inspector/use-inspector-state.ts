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

function cloneManagerState<
	TClientMsg,
	TServerMsg extends Record<TKey, string>,
	TKey extends string = "type",
>(
	manager: WebSocketManager<TClientMsg, TServerMsg, TKey>,
): TManagerState<TClientMsg> {
	const s = manager.getSnapshot();
	return {
		connectionState: s.connectionState,
		subscriptionRefCounts: new Map(s.subscriptionRefCounts),
		subscriptionData: new Map(s.subscriptionData),
		pendingSubscriptions: new Set(s.pendingSubscriptions),
		inFlightMessages: new Map(s.inFlightMessages),
		reconnectAttempt: s.reconnectAttempt,
		protocols: [...s.protocols],
		disposed: s.disposed,
		intentionalClose: s.intentionalClose,
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

export function useInspectorState<
	TClientMsg,
	TServerMsg extends Record<TKey, string>,
	TKey extends string = "type",
>(manager: WebSocketManager<TClientMsg, TServerMsg, TKey>, maxSnapshots = 500) {
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
