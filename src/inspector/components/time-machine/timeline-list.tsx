import type { TStateSnapshot } from "../../types";

type TTimelineListProps = {
	history: TStateSnapshot[];
	selectedIndex: number;
	onSelect: (index: number) => void;
};

function formatTime(ts: number): string {
	const d = new Date(ts);
	const h = String(d.getHours()).padStart(2, "0");
	const m = String(d.getMinutes()).padStart(2, "0");
	const s = String(d.getSeconds()).padStart(2, "0");
	const ms = String(d.getMilliseconds()).padStart(3, "0");
	return `${h}:${m}:${s}.${ms}`;
}

export function TimelineList({
	history,
	selectedIndex,
	onSelect,
}: TTimelineListProps) {
	return (
		<div className="h-full overflow-y-auto border-r border-neutral-800">
			{history.length === 0 && (
				<p className="p-3 text-neutral-600">No snapshots yet</p>
			)}
			{history.map((snap, idx) => (
				<button
					key={snap.id}
					type="button"
					onClick={() => onSelect(idx)}
					className={`w-full text-left px-2 py-1 text-[11px] border-b border-neutral-900 hover:bg-neutral-800/50 flex gap-2 ${
						idx === selectedIndex
							? "bg-neutral-800 text-neutral-100"
							: "text-neutral-400"
					}`}
				>
					<span className="text-neutral-600 shrink-0 w-6 text-right">
						{idx}
					</span>
					<span className="text-neutral-500 shrink-0">
						{formatTime(snap.timestamp)}
					</span>
					<span className="truncate">{snap.actionName}</span>
				</button>
			))}
		</div>
	);
}
