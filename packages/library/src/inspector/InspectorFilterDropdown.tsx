import { useEffect, useRef, useState } from "react";
import type { TDebugEventType } from "../types";
import { ChevronDownIcon } from "./icons";

type TInspectorFilterDropdownProps = {
	eventTypes: TDebugEventType[];
	activeFilters: Set<TDebugEventType>;
	toggleFilter: (eventType: TDebugEventType) => void;
	clearFilters: () => void;
};

function useDropdown() {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		function handleClickOutside(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [open]);

	function toggle() {
		setOpen((prev) => !prev);
	}

	return { open, ref, toggle };
}

export function InspectorFilterDropdown({
	eventTypes,
	activeFilters,
	toggleFilter,
	clearFilters,
}: TInspectorFilterDropdownProps) {
	const { open, ref, toggle } = useDropdown();

	if (eventTypes.length === 0) return null;

	return (
		<div ref={ref} className="rsi-filter-dropdown">
			<button type="button" className="rsi-filter-trigger" onClick={toggle}>
				Filter
				{activeFilters.size > 0 && (
					<span className="rsi-filter-count">{activeFilters.size}</span>
				)}
				<ChevronDownIcon />
			</button>
			{open && (
				<div className="rsi-filter-menu">
					<label className="rsi-filter-option">
						<input
							type="checkbox"
							className="rsi-filter-check"
							checked={activeFilters.size === 0}
							onChange={clearFilters}
						/>
						All events
					</label>
					{eventTypes.map((et) => (
						<label key={et} className="rsi-filter-option">
							<input
								type="checkbox"
								className="rsi-filter-check"
								checked={activeFilters.has(et)}
								onChange={() => toggleFilter(et)}
							/>
							{et}
						</label>
					))}
				</div>
			)}
		</div>
	);
}
