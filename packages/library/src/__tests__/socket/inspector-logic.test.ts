import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInspectorPanel } from "../../inspector/use-inspector-panel";
import { useInspectorState } from "../../inspector/use-inspector-state";
import type { WebSocketManager } from "../../manager";
import type {
	TConnectionState,
	TDebugEvent,
	TDebugEventType,
	TManagerSnapshot,
} from "../../types";

type TClientMsg = { type: "chat"; text: string };
type TServerMsg = { type: "chat"; text: string };

type TDebugCb = (event: TDebugEvent<TClientMsg, TServerMsg>) => void;

// ── Fake manager ──────────────────────────────────────────────────────
// Mirrors the two surfaces the inspector hooks touch: addDebugListener and
// getSnapshot. getSnapshot returns the LIVE internal collections (the real
// manager does the same — see manager.ts getSnapshot doc comment), so the
// inspector is responsible for cloning before retaining.

type TFakeManager = {
	manager: WebSocketManager<TClientMsg, TServerMsg>;
	emit: (event: TDebugEvent<TClientMsg, TServerMsg>) => void;
	// live, mutable internals shared by every getSnapshot() read
	subscriptionRefCounts: Map<string, number>;
	subscriptionData: Map<string, TClientMsg | undefined>;
	pendingSubscriptions: Set<string>;
	inFlightMessages: Map<string, TClientMsg>;
	setConnectionState: (s: TConnectionState) => void;
};

function createFakeManager(): TFakeManager {
	const listeners = new Set<TDebugCb>();
	const subscriptionRefCounts = new Map<string, number>();
	const subscriptionData = new Map<string, TClientMsg | undefined>();
	const pendingSubscriptions = new Set<string>();
	const inFlightMessages = new Map<string, TClientMsg>();
	let connectionState: TConnectionState = "connected";

	const snapshot = (): TManagerSnapshot<TClientMsg> => ({
		connectionState,
		subscriptionRefCounts,
		subscriptionData,
		pendingSubscriptions,
		inFlightMessages,
		reconnectAttempt: 0,
		protocols: [],
		disposed: false,
		intentionalClose: false,
	});

	const manager = {
		addDebugListener(cb: TDebugCb) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		getSnapshot: snapshot,
		getConnectionState: () => connectionState,
	} as unknown as WebSocketManager<TClientMsg, TServerMsg>;

	return {
		manager,
		emit: (event) => {
			for (const cb of listeners) cb(event);
		},
		subscriptionRefCounts,
		subscriptionData,
		pendingSubscriptions,
		inFlightMessages,
		setConnectionState: (s) => {
			connectionState = s;
		},
	};
}

let nextId = 1;

function makeEvent(type: TDebugEventType): TDebugEvent<TClientMsg, TServerMsg> {
	const id = nextId++;
	// Cast: the inspector hooks only read `id`, `timestamp`, and `event.type`,
	// so a bare-typed payload is sufficient for navigation/filter logic.
	return {
		id,
		timestamp: Date.now() + id,
		type,
	} as TDebugEvent<TClientMsg, TServerMsg>;
}

beforeEach(() => {
	vi.useFakeTimers();
	try {
		localStorage.clear();
	} catch {
		// localStorage unavailable
	}
	nextId = 1;
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("useInspectorPanel — navigation, diff selection, pause/live", () => {
	it("selecting the 3rd snapshot diffs against the 2nd and pauses live", () => {
		const fake = createFakeManager();
		const { result } = renderHook(() =>
			useInspectorPanel(fake.manager, 500, "bottom-right"),
		);

		// Seed three snapshots, mutating live state between each so each diff is
		// observable. id 1: refCount a=1. id 2: refCount a=2. id 3: refCount a=3.
		act(() => {
			fake.subscriptionRefCounts.set("a", 1);
			fake.emit(makeEvent("subscribe"));
		});
		act(() => {
			fake.subscriptionRefCounts.set("a", 2);
			fake.emit(makeEvent("subscribe"));
		});
		act(() => {
			fake.subscriptionRefCounts.set("a", 3);
			fake.emit(makeEvent("subscribe"));
		});

		expect(result.current.snapshots).toHaveLength(3);
		expect(result.current.isLive).toBe(true);

		// Select the 3rd snapshot (id 3).
		const third = result.current.snapshots[2];
		act(() => {
			result.current.goTo(third.id);
		});

		expect(result.current.isLive).toBe(false);
		expect(result.current.selectedSnapshotId).toBe(third.id);
		// Diff is computed against the immediate predecessor (the 2nd snapshot),
		// where a went from 2 -> 3.
		const diff = result.current.diff;
		expect(diff).not.toBeNull();
		expect(diff?.subscriptionRefCounts.entries).toEqual([
			{ key: "a", change: "changed", from: 2, to: 3 },
		]);
	});

	it("selecting the 1st snapshot yields a null diff (no predecessor)", () => {
		const fake = createFakeManager();
		const { result } = renderHook(() =>
			useInspectorPanel(fake.manager, 500, "bottom-right"),
		);

		act(() => {
			fake.emit(makeEvent("subscribe"));
		});
		act(() => {
			fake.emit(makeEvent("subscribe"));
		});

		const first = result.current.snapshots[0];
		act(() => {
			result.current.goTo(first.id);
		});

		expect(result.current.selectedSnapshotId).toBe(first.id);
		expect(result.current.isLive).toBe(false);
		expect(result.current.diff).toBeNull();
	});

	it("a type filter excluding the middle snapshot diffs against the surviving predecessor", () => {
		const fake = createFakeManager();
		const { result } = renderHook(() =>
			useInspectorPanel(fake.manager, 500, "bottom-right"),
		);

		// id 1: subscribe, a=1
		// id 2: connection-state-change (the middle, will be filtered out), a=2
		// id 3: subscribe, a=3
		act(() => {
			fake.subscriptionRefCounts.set("a", 1);
			fake.emit(makeEvent("subscribe"));
		});
		act(() => {
			fake.subscriptionRefCounts.set("a", 2);
			fake.emit(makeEvent("connection-state-change"));
		});
		act(() => {
			fake.subscriptionRefCounts.set("a", 3);
			fake.emit(makeEvent("subscribe"));
		});

		const third = result.current.snapshots[2];

		// Apply a filter that keeps only "subscribe" events — this drops the
		// middle snapshot from `filtered`.
		act(() => {
			result.current.toggleFilter("subscribe");
		});

		expect(result.current.filtered).toHaveLength(2);
		expect(result.current.filtered.map((s) => s.id)).toEqual([1, 3]);

		act(() => {
			result.current.goTo(third.id);
		});

		// With the middle snapshot filtered out, the surviving predecessor of
		// id 3 is id 1 (a went 1 -> 3), NOT the unfiltered neighbour id 2.
		const diff = result.current.diff;
		expect(diff).not.toBeNull();
		expect(diff?.subscriptionRefCounts.entries).toEqual([
			{ key: "a", change: "changed", from: 1, to: 3 },
		]);
	});

	it("returning to live resets isLive to true and clears selection", () => {
		const fake = createFakeManager();
		const { result } = renderHook(() =>
			useInspectorPanel(fake.manager, 500, "bottom-right"),
		);

		act(() => {
			fake.emit(makeEvent("subscribe"));
		});
		act(() => {
			fake.emit(makeEvent("subscribe"));
		});

		const second = result.current.snapshots[1];
		act(() => {
			result.current.goTo(second.id);
		});
		expect(result.current.isLive).toBe(false);

		act(() => {
			result.current.goToLive();
		});

		expect(result.current.isLive).toBe(true);
		expect(result.current.selectedSnapshotId).toBeNull();
		// Live currentState tracks the newest snapshot.
		expect(result.current.currentState).toBe(
			result.current.snapshots[result.current.snapshots.length - 1].state,
		);
	});
});

describe("useInspectorState — clone isolation", () => {
	it("stored snapshot keeps capture-time values after manager internals mutate", () => {
		const fake = createFakeManager();
		const { result } = renderHook(() => useInspectorState(fake.manager, 500));

		// Capture #1 with a=1 and one pending key + one in-flight message.
		act(() => {
			fake.subscriptionRefCounts.set("a", 1);
			fake.pendingSubscriptions.add("p1");
			fake.inFlightMessages.set("m1", { type: "chat", text: "first" });
			fake.subscriptionData.set("a", { type: "chat", text: "data-1" });
			fake.emit(makeEvent("subscribe"));
		});

		// Mutate the LIVE internals AFTER the first capture.
		act(() => {
			fake.subscriptionRefCounts.set("a", 99);
			fake.subscriptionRefCounts.set("b", 5);
			fake.pendingSubscriptions.delete("p1");
			fake.pendingSubscriptions.add("p2");
			fake.inFlightMessages.set("m1", { type: "chat", text: "MUTATED" });
			fake.subscriptionData.set("a", { type: "chat", text: "data-2" });
			fake.emit(makeEvent("subscribe"));
		});

		const [first, second] = result.current.state.snapshots;

		// First snapshot must reflect capture-time state, not the later mutation.
		expect(first.state.subscriptionRefCounts.get("a")).toBe(1);
		expect(first.state.subscriptionRefCounts.has("b")).toBe(false);
		expect(first.state.pendingSubscriptions.has("p1")).toBe(true);
		expect(first.state.pendingSubscriptions.has("p2")).toBe(false);
		expect(first.state.inFlightMessages.get("m1")).toEqual({
			type: "chat",
			text: "first",
		});
		expect(first.state.subscriptionData.get("a")).toEqual({
			type: "chat",
			text: "data-1",
		});

		// Second snapshot reflects the mutated state.
		expect(second.state.subscriptionRefCounts.get("a")).toBe(99);
		expect(second.state.subscriptionRefCounts.get("b")).toBe(5);
		expect(second.state.inFlightMessages.get("m1")).toEqual({
			type: "chat",
			text: "MUTATED",
		});

		// The two snapshots must own independent Map/Set instances.
		expect(first.state.subscriptionRefCounts).not.toBe(
			second.state.subscriptionRefCounts,
		);
		expect(first.state.subscriptionRefCounts).not.toBe(
			fake.subscriptionRefCounts,
		);
	});
});

describe("useInspectorState — snapshot list capping", () => {
	it("evicts oldest snapshots once maxSnapshots is exceeded (FIFO)", () => {
		const fake = createFakeManager();
		const { result } = renderHook(() => useInspectorState(fake.manager, 3));

		// Emit 5 events into a cap of 3.
		for (let i = 0; i < 5; i++) {
			act(() => {
				fake.emit(makeEvent("subscribe"));
			});
		}

		const ids = result.current.state.snapshots.map((s) => s.id);
		// IDs 1 and 2 evicted; newest 3 retained in order.
		expect(ids).toEqual([3, 4, 5]);
		expect(result.current.state.snapshots).toHaveLength(3);
	});
});
