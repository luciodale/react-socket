import { describe, expect, it } from "vitest";
import type { TManagerState } from "../../inspector/inspector-types";
import { computeSnapshotDiff } from "../../inspector/snapshot-diff";

function makeState(
	overrides?: Partial<TManagerState<Record<string, unknown>>>,
): TManagerState<Record<string, unknown>> {
	return {
		connectionState: "disconnected",
		subscriptionRefCounts: new Map(),
		subscriptionData: new Map(),
		pendingSubscriptions: new Set(),
		inFlightMessages: new Map(),
		reconnectAttempt: 0,
		protocols: [],
		disposed: false,
		intentionalClose: false,
		...overrides,
	};
}

describe("computeSnapshotDiff", () => {
	it("identical states produce empty diffs", () => {
		const state = makeState();
		const diff = computeSnapshotDiff(state, state);
		expect(diff.scalars).toHaveLength(0);
		expect(diff.subscriptionRefCounts.entries).toHaveLength(0);
		expect(diff.subscriptionData.entries).toHaveLength(0);
		expect(diff.inFlightMessages.entries).toHaveLength(0);
		expect(diff.pendingSubscriptions.entries).toHaveLength(0);
		expect(diff.protocols).toBeNull();
	});

	it("detects connectionState change", () => {
		const prev = makeState({ connectionState: "disconnected" });
		const next = makeState({ connectionState: "connected" });
		const diff = computeSnapshotDiff(prev, next);
		expect(diff.scalars).toContainEqual({
			field: "connectionState",
			from: "disconnected",
			to: "connected",
		});
	});

	it("detects reconnectAttempt change", () => {
		const prev = makeState({ reconnectAttempt: 0 });
		const next = makeState({ reconnectAttempt: 3 });
		const diff = computeSnapshotDiff(prev, next);
		expect(diff.scalars).toContainEqual({
			field: "reconnectAttempt",
			from: 0,
			to: 3,
		});
	});

	it("detects disposed change", () => {
		const prev = makeState({ disposed: false });
		const next = makeState({ disposed: true });
		const diff = computeSnapshotDiff(prev, next);
		expect(diff.scalars).toContainEqual({
			field: "disposed",
			from: false,
			to: true,
		});
	});

	it("detects intentionalClose change", () => {
		const prev = makeState({ intentionalClose: false });
		const next = makeState({ intentionalClose: true });
		const diff = computeSnapshotDiff(prev, next);
		expect(diff.scalars).toContainEqual({
			field: "intentionalClose",
			from: false,
			to: true,
		});
	});

	it("detects subscription added", () => {
		const prev = makeState();
		const next = makeState({
			subscriptionRefCounts: new Map([["chat", 1]]),
		});
		const diff = computeSnapshotDiff(prev, next);
		expect(diff.subscriptionRefCounts.entries).toContainEqual({
			key: "chat",
			change: "added",
			to: 1,
		});
	});

	it("detects subscription removed", () => {
		const prev = makeState({
			subscriptionRefCounts: new Map([["chat", 1]]),
		});
		const next = makeState();
		const diff = computeSnapshotDiff(prev, next);
		expect(diff.subscriptionRefCounts.entries).toContainEqual({
			key: "chat",
			change: "removed",
			from: 1,
		});
	});

	it("detects subscription changed", () => {
		const prev = makeState({
			subscriptionRefCounts: new Map([["chat", 1]]),
		});
		const next = makeState({
			subscriptionRefCounts: new Map([["chat", 2]]),
		});
		const diff = computeSnapshotDiff(prev, next);
		expect(diff.subscriptionRefCounts.entries).toContainEqual({
			key: "chat",
			change: "changed",
			from: 1,
			to: 2,
		});
	});

	it("detects in-flight message added", () => {
		const prev = makeState();
		const next = makeState({
			inFlightMessages: new Map([["msg-1", { action: "send" }]]),
		});
		const diff = computeSnapshotDiff(prev, next);
		expect(diff.inFlightMessages.entries).toContainEqual({
			key: "msg-1",
			change: "added",
			to: { action: "send" },
		});
	});

	it("detects in-flight message removed", () => {
		const prev = makeState({
			inFlightMessages: new Map([["msg-1", { action: "send" }]]),
		});
		const next = makeState();
		const diff = computeSnapshotDiff(prev, next);
		expect(diff.inFlightMessages.entries).toContainEqual({
			key: "msg-1",
			change: "removed",
			from: { action: "send" },
		});
	});

	it("detects pending subscription added", () => {
		const prev = makeState();
		const next = makeState({
			pendingSubscriptions: new Set(["chat"]),
		});
		const diff = computeSnapshotDiff(prev, next);
		expect(diff.pendingSubscriptions.entries).toContainEqual({
			key: "chat",
			change: "added",
		});
	});

	it("detects pending subscription removed", () => {
		const prev = makeState({
			pendingSubscriptions: new Set(["chat"]),
		});
		const next = makeState();
		const diff = computeSnapshotDiff(prev, next);
		expect(diff.pendingSubscriptions.entries).toContainEqual({
			key: "chat",
			change: "removed",
		});
	});

	it("detects protocols changed by length", () => {
		const prev = makeState({ protocols: ["v1"] });
		const next = makeState({ protocols: ["v1", "v2"] });
		const diff = computeSnapshotDiff(prev, next);
		expect(diff.protocols).toEqual({
			from: ["v1"],
			to: ["v1", "v2"],
		});
	});

	it("detects protocols changed by differing element at same length", () => {
		const prev = makeState({ protocols: ["v1", "v2"] });
		const next = makeState({ protocols: ["v1", "v3"] });
		const diff = computeSnapshotDiff(prev, next);
		expect(diff.protocols).toEqual({
			from: ["v1", "v2"],
			to: ["v1", "v3"],
		});
	});

	it("detects subscriptionData present-undefined as changed (not absent)", () => {
		const prev = makeState({
			subscriptionData: new Map([["chat", { n: 1 }]]),
		});
		const next = makeState({
			subscriptionData: new Map([["chat", undefined]]),
		});
		const diff = computeSnapshotDiff(prev, next);
		expect(diff.subscriptionData.entries).toContainEqual({
			key: "chat",
			change: "changed",
			from: { n: 1 },
			to: undefined,
		});
		expect(diff.subscriptionData.entries).toHaveLength(1);
	});

	it("detects subscriptionData present-undefined as added when key absent in prev", () => {
		const prev = makeState();
		const next = makeState({
			subscriptionData: new Map([["chat", undefined]]),
		});
		const diff = computeSnapshotDiff(prev, next);
		expect(diff.subscriptionData.entries).toContainEqual({
			key: "chat",
			change: "added",
			to: undefined,
		});
		expect(diff.subscriptionData.entries).toHaveLength(1);
	});

	it("returns null protocols when unchanged", () => {
		const prev = makeState({ protocols: ["v1"] });
		const next = makeState({ protocols: ["v1"] });
		const diff = computeSnapshotDiff(prev, next);
		expect(diff.protocols).toBeNull();
	});
});
