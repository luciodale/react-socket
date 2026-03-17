import { describe, expect, it } from "vitest";
import { inspectorReducer } from "../../inspector/inspector-reducer";
import type {
	TInspectorState,
	TSnapshot,
} from "../../inspector/inspector-types";

function makeSnapshot(
	id: number,
): TSnapshot<Record<string, unknown>, Record<string, unknown>> {
	return {
		id,
		timestamp: Date.now() + id,
		event: { id, timestamp: Date.now() + id, type: "dispose" },
		state: {
			connectionState: "connected",
			subscriptionRefCounts: new Map(),
			subscriptionData: new Map(),
			pendingSubscriptions: new Set(),
			inFlightMessages: new Map(),
			reconnectAttempt: 0,
			protocols: [],
			disposed: false,
			intentionalClose: false,
		},
	};
}

function makeState(
	overrides?: Partial<
		TInspectorState<Record<string, unknown>, Record<string, unknown>>
	>,
): TInspectorState<Record<string, unknown>, Record<string, unknown>> {
	return {
		snapshots: [],
		maxSnapshots: 500,
		selectedSnapshotId: null,
		...overrides,
	};
}

describe("inspectorReducer", () => {
	it("add-snapshot adds a snapshot to the list", () => {
		const state = makeState();
		const snapshot = makeSnapshot(1);
		const next = inspectorReducer(state, {
			type: "add-snapshot",
			snapshot,
		});
		expect(next.snapshots).toHaveLength(1);
		expect(next.snapshots[0]).toBe(snapshot);
	});

	it("add-snapshot respects maxSnapshots", () => {
		const snapshots = [makeSnapshot(1), makeSnapshot(2), makeSnapshot(3)];
		const state = makeState({ snapshots, maxSnapshots: 3 });
		const newSnapshot = makeSnapshot(4);
		const next = inspectorReducer(state, {
			type: "add-snapshot",
			snapshot: newSnapshot,
		});
		expect(next.snapshots).toHaveLength(3);
		expect(next.snapshots[0]?.id).toBe(2);
		expect(next.snapshots[2]?.id).toBe(4);
	});

	it("select-snapshot sets selectedSnapshotId", () => {
		const state = makeState();
		const next = inspectorReducer(state, {
			type: "select-snapshot",
			id: 42,
		});
		expect(next.selectedSnapshotId).toBe(42);
	});

	it("select-snapshot null sets selectedSnapshotId to null (live mode)", () => {
		const state = makeState({ selectedSnapshotId: 5 });
		const next = inspectorReducer(state, {
			type: "select-snapshot",
			id: null,
		});
		expect(next.selectedSnapshotId).toBeNull();
	});

	it("clear empties snapshots and resets selectedSnapshotId to null", () => {
		const state = makeState({
			snapshots: [makeSnapshot(1), makeSnapshot(2)],
			selectedSnapshotId: 1,
		});
		const next = inspectorReducer(state, { type: "clear" });
		expect(next.snapshots).toHaveLength(0);
		expect(next.selectedSnapshotId).toBeNull();
	});
});
