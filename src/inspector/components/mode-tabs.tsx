import { useInspectorStore } from "../inspector-store";
import type { TInspectorMode } from "../types";

const TABS: { mode: TInspectorMode; label: string }[] = [
	{ mode: "live", label: "Live State" },
	{ mode: "timemachine", label: "Time Machine" },
];

export function ModeTabs() {
	const mode = useInspectorStore((s) => s.mode);
	const setMode = useInspectorStore((s) => s.setMode);
	const clearHistory = useInspectorStore((s) => s.clearHistory);
	const historyLength = useInspectorStore((s) => s.history.length);

	return (
		<div className="flex items-center border-b border-neutral-800">
			{TABS.map((tab) => (
				<button
					key={tab.mode}
					type="button"
					onClick={() => setMode(tab.mode)}
					className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
						mode === tab.mode
							? "border-sky-500 text-sky-400"
							: "border-transparent text-neutral-500 hover:text-neutral-300"
					}`}
				>
					{tab.label}
					{tab.mode === "timemachine" && historyLength > 0 && (
						<span className="ml-1.5 text-[10px] text-neutral-500">
							({historyLength})
						</span>
					)}
				</button>
			))}
			<div className="ml-auto pr-3">
				<button
					type="button"
					onClick={clearHistory}
					className="text-[10px] text-neutral-600 hover:text-neutral-400"
				>
					Clear
				</button>
			</div>
		</div>
	);
}
