import type { TConnectionState, TDebugEvent } from "../types";

export type TManagerState<TClientMsg> = {
	connectionState: TConnectionState;
	subscriptionRefCounts: ReadonlyMap<string, number>;
	subscriptionData: ReadonlyMap<string, TClientMsg | undefined>;
	pendingSubscriptions: ReadonlySet<string>;
	inFlightMessages: ReadonlyMap<string, TClientMsg>;
	reconnectAttempt: number;
	protocols: readonly string[];
	disposed: boolean;
	intentionalClose: boolean;
};

export type TSnapshot<TClientMsg, TServerMsg> = {
	id: number;
	timestamp: number;
	event: TDebugEvent<TClientMsg, TServerMsg>;
	state: TManagerState<TClientMsg>;
};

export type TInspectorState<TClientMsg, TServerMsg> = {
	snapshots: TSnapshot<TClientMsg, TServerMsg>[];
	maxSnapshots: number;
	selectedSnapshotId: number | null;
};

export type TInspectorAction<TClientMsg, TServerMsg> =
	| { type: "add-snapshot"; snapshot: TSnapshot<TClientMsg, TServerMsg> }
	| { type: "select-snapshot"; id: number | null }
	| { type: "clear" };

export type TInspectorPosition =
	| "top-left"
	| "top-right"
	| "bottom-left"
	| "bottom-right";
