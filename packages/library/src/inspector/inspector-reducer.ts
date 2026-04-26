import type { TInspectorAction, TInspectorState } from "./inspector-types";

export function inspectorReducer<TClientMsg, TServerMsg>(
	state: TInspectorState<TClientMsg, TServerMsg>,
	action: TInspectorAction<TClientMsg, TServerMsg>,
): TInspectorState<TClientMsg, TServerMsg> {
	switch (action.type) {
		case "add-snapshot": {
			const snapshots = [...state.snapshots, action.snapshot];
			if (snapshots.length > state.maxSnapshots) snapshots.shift();
			return { ...state, snapshots };
		}
		case "select-snapshot":
			return { ...state, selectedSnapshotId: action.id };
		case "clear":
			return { ...state, snapshots: [], selectedSnapshotId: null };
	}
}
