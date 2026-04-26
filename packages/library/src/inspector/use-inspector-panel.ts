import { useEffect, useMemo, useState } from "react";
import type { WebSocketManager } from "../manager";
import type { TDebugEventType } from "../types";
import type { TInspectorPosition, TSnapshot } from "./inspector-types";
import { computeSnapshotDiff, type TSnapshotDiff } from "./snapshot-diff";
import { useInspectorDrag } from "./use-inspector-drag";
import { useInspectorState } from "./use-inspector-state";

export type TTab = "state" | "diff";

export function useInspectorPanel<
	TClientMsg,
	TServerMsg extends Record<TKey, string>,
	TKey extends string = "type",
>(
	manager: WebSocketManager<TClientMsg, TServerMsg, TKey>,
	maxSnapshots: number,
	defaultPosition: TInspectorPosition,
) {
	const [open, setOpen] = useState(() => {
		try {
			return localStorage.getItem("rsi-open") === "true";
		} catch {
			return false;
		}
	});
	const [activeTab, setActiveTab] = useState<TTab>("state");

	useEffect(() => {
		try {
			localStorage.setItem("rsi-open", String(open));
		} catch {
			// localStorage unavailable
		}
	}, [open]);

	function handleToggle() {
		setOpen((prev) => !prev);
	}

	function handleClose() {
		setOpen(false);
	}

	const { state, selectSnapshot, clear } = useInspectorState(
		manager,
		maxSnapshots,
	);

	// ── Event filter ─────────────────────────────────────────────────
	const [activeFilters, setActiveFilters] = useState<Set<TDebugEventType>>(
		new Set(),
	);

	const filtered = useMemo(() => {
		if (activeFilters.size === 0) return state.snapshots;
		return state.snapshots.filter((s) => activeFilters.has(s.event.type));
	}, [state.snapshots, activeFilters]);

	function toggleFilter(eventType: TDebugEventType) {
		setActiveFilters((prev) => {
			const next = new Set(prev);
			if (next.has(eventType)) next.delete(eventType);
			else next.add(eventType);
			return next;
		});
	}

	function clearFilters() {
		setActiveFilters(new Set());
	}

	// ── Snapshot navigation ──────────────────────────────────────────
	const selectedIndex = useMemo(() => {
		if (state.selectedSnapshotId === null) return null;
		return filtered.findIndex(
			(s: TSnapshot<TClientMsg, TServerMsg>) =>
				s.id === state.selectedSnapshotId,
		);
	}, [filtered, state.selectedSnapshotId]);

	const selectedSnapshot =
		selectedIndex !== null && selectedIndex >= 0
			? filtered[selectedIndex]
			: null;

	const diff = useMemo((): TSnapshotDiff<TClientMsg> | null => {
		if (selectedIndex === null || selectedIndex < 0) return null;
		if (selectedIndex === 0) return null;
		const prev = filtered[selectedIndex - 1];
		const curr = filtered[selectedIndex];
		return computeSnapshotDiff(prev.state, curr.state);
	}, [filtered, selectedIndex]);

	function goTo(id: number) {
		selectSnapshot(id);
	}

	function goToLive() {
		selectSnapshot(null);
	}

	// ── Drag / resize ────────────────────────────────────────────────
	const {
		bubblePosition,
		panelPosition,
		size,
		sidebarWidth,
		onBubbleDown,
		onHeaderDown,
		onResizeDown,
		onDividerDown,
	} = useInspectorDrag(defaultPosition, handleToggle);

	const isLive = state.selectedSnapshotId === null;

	const currentState = selectedSnapshot
		? selectedSnapshot.state
		: state.snapshots.length > 0
			? state.snapshots[state.snapshots.length - 1].state
			: null;

	const eventTypes = useMemo(
		() => Array.from(new Set(state.snapshots.map((s) => s.event.type))),
		[state.snapshots],
	);

	const connectionState =
		currentState?.connectionState ?? manager.getConnectionState();

	return {
		open,
		activeTab,
		setActiveTab,
		snapshots: state.snapshots,
		filtered,
		activeFilters,
		toggleFilter,
		clearFilters,
		selectedSnapshotId: state.selectedSnapshotId,
		diff,
		goTo,
		goToLive,
		isLive,
		currentState,
		eventTypes,
		connectionState,
		bubblePosition,
		panelPosition,
		size,
		sidebarWidth,
		clear,
		onBubbleDown,
		onHeaderDown,
		onResizeDown,
		onDividerDown,
		handleClose,
	};
}
