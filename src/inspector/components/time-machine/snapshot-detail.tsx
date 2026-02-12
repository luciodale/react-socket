import type { TDiffEntry, TStateSnapshot } from "../../types";
import { JsonViewer } from "../shared/json-viewer";
import { Section } from "../shared/section";

type TSnapshotDetailProps = {
	snapshot: TStateSnapshot | null;
	diff: TDiffEntry[];
};

const DIFF_COLORS: Record<TDiffEntry["type"], string> = {
	added: "text-emerald-400",
	removed: "text-red-400",
	changed: "text-amber-400",
};

const DIFF_PREFIXES: Record<TDiffEntry["type"], string> = {
	added: "+",
	removed: "-",
	changed: "~",
};

function formatValue(value: unknown): string {
	if (value === undefined) return "undefined";
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

export function SnapshotDetail({ snapshot, diff }: TSnapshotDetailProps) {
	if (!snapshot) {
		return (
			<div className="flex items-center justify-center h-full text-neutral-600">
				Select a snapshot from the timeline
			</div>
		);
	}

	return (
		<div className="h-full overflow-y-auto p-3">
			<div className="mb-3 text-xs text-neutral-500">
				<span className="font-bold text-neutral-300">
					#{snapshot.id}
				</span>{" "}
				— {snapshot.actionName} —{" "}
				{new Date(snapshot.timestamp).toLocaleTimeString()}
			</div>

			{diff.length > 0 && (
				<Section title={`Diff (${diff.length} changes)`} defaultOpen>
					<div className="space-y-1">
						{diff.map((entry) => (
							<div
								key={entry.path}
								className={`text-[11px] ${DIFF_COLORS[entry.type]}`}
							>
								<span className="font-bold">
									{DIFF_PREFIXES[entry.type]}
								</span>{" "}
								<span className="text-neutral-400">{entry.path}</span>
								{entry.type === "changed" && (
									<>
										<div className="pl-4 text-red-400/70">
											- {formatValue(entry.oldValue)}
										</div>
										<div className="pl-4 text-emerald-400/70">
											+ {formatValue(entry.newValue)}
										</div>
									</>
								)}
								{entry.type === "added" && (
									<div className="pl-4 text-emerald-400/70">
										{formatValue(entry.newValue)}
									</div>
								)}
								{entry.type === "removed" && (
									<div className="pl-4 text-red-400/70">
										{formatValue(entry.oldValue)}
									</div>
								)}
							</div>
						))}
					</div>
				</Section>
			)}

			<Section title="Full State" defaultOpen={diff.length === 0}>
				<JsonViewer data={snapshot.state} />
			</Section>
		</div>
	);
}
