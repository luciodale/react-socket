import { InspectorSection } from "./InspectorSection";
import type { TSnapshotDiff } from "./snapshot-diff";

type TInspectorDiffViewProps<TClientMsg> = {
	diff: TSnapshotDiff<TClientMsg> | null;
};

export function InspectorDiffView<TClientMsg>({
	diff,
}: TInspectorDiffViewProps<TClientMsg>) {
	if (!diff) {
		return <div className="rsi-empty">Select an event to view changes</div>;
	}

	const hasScalars = diff.scalars.length > 0;
	const hasSubs = diff.subscriptionRefCounts.entries.length > 0;
	const hasSubData = diff.subscriptionData.entries.length > 0;
	const hasInFlight = diff.inFlightMessages.entries.length > 0;
	const hasPending = diff.pendingSubscriptions.entries.length > 0;
	const hasProtocols = diff.protocols !== null;
	const hasChanges =
		hasScalars ||
		hasSubs ||
		hasSubData ||
		hasInFlight ||
		hasPending ||
		hasProtocols;

	if (!hasChanges) {
		return (
			<div className="rsi-empty">No state changes between these snapshots</div>
		);
	}

	return (
		<div className="rsi-content">
			{hasScalars && (
				<InspectorSection title="Scalars">
					{diff.scalars.map((s) => (
						<div key={s.field} className="rsi-diff-entry">
							<span className="rsi-diff-field">{s.field}</span>
							<span className="rsi-diff-arrow">: </span>
							<span className="rsi-diff-from">{String(s.from)}</span>
							<span className="rsi-diff-arrow">{" \u2192 "}</span>
							<span className="rsi-diff-to">{String(s.to)}</span>
						</div>
					))}
				</InspectorSection>
			)}

			{hasSubs && (
				<InspectorSection title="Subscription Ref Counts">
					{diff.subscriptionRefCounts.entries.map((e) => (
						<div key={e.key} className={`rsi-diff-entry rsi-diff-${e.change}`}>
							<span className="rsi-diff-prefix">
								{e.change === "added" && "+ "}
								{e.change === "removed" && "- "}
								{e.change === "changed" && "~ "}
							</span>
							{e.key}
							{e.change === "changed" && (
								<span>
									{" "}
									{String(e.from)} {"\u2192"} {String(e.to)}
								</span>
							)}
							{e.change === "added" && <span> = {String(e.to)}</span>}
							{e.change === "removed" && <span> (was {String(e.from)})</span>}
						</div>
					))}
				</InspectorSection>
			)}

			{hasSubData && (
				<InspectorSection title="Subscription Data">
					{diff.subscriptionData.entries.map((e) => (
						<div key={e.key} className={`rsi-diff-entry rsi-diff-${e.change}`}>
							<span className="rsi-diff-prefix">
								{e.change === "added" && "+ "}
								{e.change === "removed" && "- "}
								{e.change === "changed" && "~ "}
							</span>
							{e.key}
						</div>
					))}
				</InspectorSection>
			)}

			{hasInFlight && (
				<InspectorSection title="In-flight Messages">
					{diff.inFlightMessages.entries.map((e) => (
						<div key={e.key} className={`rsi-diff-entry rsi-diff-${e.change}`}>
							<span className="rsi-diff-prefix">
								{e.change === "added" && "+ "}
								{e.change === "removed" && "- "}
								{e.change === "changed" && "~ "}
							</span>
							{e.key}
						</div>
					))}
				</InspectorSection>
			)}

			{hasPending && (
				<InspectorSection title="Pending Subscriptions">
					{diff.pendingSubscriptions.entries.map((e) => (
						<div key={e.key} className={`rsi-diff-entry rsi-diff-${e.change}`}>
							<span className="rsi-diff-prefix">
								{e.change === "added" && "+ "}
								{e.change === "removed" && "- "}
							</span>
							{e.key}
						</div>
					))}
				</InspectorSection>
			)}

			{hasProtocols && diff.protocols && (
				<InspectorSection title="Protocols">
					<div className="rsi-diff-entry rsi-diff-removed">
						- [{diff.protocols.from.join(", ")}]
					</div>
					<div className="rsi-diff-entry rsi-diff-added">
						+ [{diff.protocols.to.join(", ")}]
					</div>
				</InspectorSection>
			)}
		</div>
	);
}
