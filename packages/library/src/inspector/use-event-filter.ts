import { useMemo, useState } from "react";
import type { TDebugEventType } from "../types";
import type { TSnapshot } from "./inspector-types";

export function useEventFilter<TClientMsg, TServerMsg>(
	snapshots: TSnapshot<TClientMsg, TServerMsg>[],
) {
	const [activeFilters, setActiveFilters] = useState<Set<TDebugEventType>>(
		new Set(),
	);

	const filtered = useMemo(() => {
		if (activeFilters.size === 0) return snapshots;
		return snapshots.filter((s) => activeFilters.has(s.event.type));
	}, [snapshots, activeFilters]);

	function toggleFilter(eventType: TDebugEventType) {
		setActiveFilters((prev) => {
			const next = new Set(prev);
			if (next.has(eventType)) {
				next.delete(eventType);
			} else {
				next.add(eventType);
			}
			return next;
		});
	}

	function clearFilters() {
		setActiveFilters(new Set());
	}

	return {
		filtered,
		activeFilters,
		toggleFilter,
		clearFilters,
	};
}
