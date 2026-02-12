import { useMemo } from "react";
import { computeDiff } from "../diff";
import { useInspectorStore } from "../inspector-store";
import type { TDiffEntry, TStateSnapshot } from "../types";

type TTimeMachine = {
	history: TStateSnapshot[];
	selectedIndex: number;
	selectedSnapshot: TStateSnapshot | null;
	previousSnapshot: TStateSnapshot | null;
	diff: TDiffEntry[];
	stepForward: () => void;
	stepBackward: () => void;
	goToLatest: () => void;
	goToFirst: () => void;
	goTo: (index: number) => void;
};

export function useTimeMachine(): TTimeMachine {
	const history = useInspectorStore((s) => s.history);
	const selectedIndex = useInspectorStore((s) => s.selectedIndex);
	const setSelectedIndex = useInspectorStore((s) => s.setSelectedIndex);

	const selectedSnapshot =
		selectedIndex >= 0 && selectedIndex < history.length
			? history[selectedIndex]
			: null;

	const previousSnapshot =
		selectedIndex > 0 ? history[selectedIndex - 1] : null;

	const diff = useMemo(() => {
		if (!selectedSnapshot || !previousSnapshot) return [];
		return computeDiff(previousSnapshot.state, selectedSnapshot.state);
	}, [selectedSnapshot, previousSnapshot]);

	function stepForward() {
		if (selectedIndex < history.length - 1) {
			setSelectedIndex(selectedIndex + 1);
		}
	}

	function stepBackward() {
		if (selectedIndex > 0) {
			setSelectedIndex(selectedIndex - 1);
		}
	}

	function goToLatest() {
		if (history.length > 0) {
			setSelectedIndex(history.length - 1);
		}
	}

	function goToFirst() {
		if (history.length > 0) {
			setSelectedIndex(0);
		}
	}

	function goTo(index: number) {
		if (index >= 0 && index < history.length) {
			setSelectedIndex(index);
		}
	}

	return {
		history,
		selectedIndex,
		selectedSnapshot,
		previousSnapshot,
		diff,
		stepForward,
		stepBackward,
		goToLatest,
		goToFirst,
		goTo,
	};
}
