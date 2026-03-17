import { useEffect, useMemo, useState } from "react";
import type { WebSocketManager } from "../manager";
import type { TInspectorPosition } from "./inspector-types";
import { useEventFilter } from "./use-event-filter";
import { useInspectorDrag } from "./use-inspector-drag";
import { useInspectorState } from "./use-inspector-state";
import { useSnapshotNavigation } from "./use-snapshot-navigation";

export type TTab = "state" | "diff";

export function useInspectorPanel<TClientMsg, TServerMsg>(
	manager: WebSocketManager<TClientMsg, TServerMsg>,
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

	const { filtered, activeFilters, toggleFilter, clearFilters } =
		useEventFilter(state.snapshots);

	const { selectedSnapshot, diff, goTo, goToLive } = useSnapshotNavigation(
		filtered,
		state.selectedSnapshotId,
		selectSnapshot,
	);

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
