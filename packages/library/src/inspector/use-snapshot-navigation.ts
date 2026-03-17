import { useMemo } from "react";
import type { TSnapshot } from "./inspector-types";
import { computeSnapshotDiff, type TSnapshotDiff } from "./snapshot-diff";

export function useSnapshotNavigation<TClientMsg, TServerMsg>(
	snapshots: TSnapshot<TClientMsg, TServerMsg>[],
	selectedSnapshotId: number | null,
	selectSnapshot: (id: number | null) => void,
) {
	const selectedIndex = useMemo(() => {
		if (selectedSnapshotId === null) return null;
		return snapshots.findIndex((s) => s.id === selectedSnapshotId);
	}, [snapshots, selectedSnapshotId]);

	const selectedSnapshot =
		selectedIndex !== null && selectedIndex >= 0
			? snapshots[selectedIndex]
			: null;

	const diff = useMemo((): TSnapshotDiff<TClientMsg> | null => {
		if (selectedIndex === null || selectedIndex < 0) return null;
		if (selectedIndex === 0) return null;
		const prev = snapshots[selectedIndex - 1];
		const curr = snapshots[selectedIndex];
		return computeSnapshotDiff(prev.state, curr.state);
	}, [snapshots, selectedIndex]);

	function goTo(id: number) {
		selectSnapshot(id);
	}

	function goToLive() {
		selectSnapshot(null);
	}

	return {
		selectedIndex,
		selectedSnapshot,
		diff,
		goTo,
		goToLive,
	};
}
