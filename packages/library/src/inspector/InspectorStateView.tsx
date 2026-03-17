import { InspectorJsonViewer } from "./InspectorJsonViewer";
import { InspectorSection } from "./InspectorSection";
import type { TManagerState } from "./inspector-types";

type TInspectorStateViewProps<TClientMsg> = {
	state: TManagerState<TClientMsg>;
	isLive: boolean;
};

export function InspectorStateView<TClientMsg>({
	state,
	isLive,
}: TInspectorStateViewProps<TClientMsg>) {
	const subEntries = Array.from(state.subscriptionRefCounts.entries());
	const inFlightEntries = Array.from(state.inFlightMessages.entries());

	return (
		<div className="rsi-content">
			<InspectorSection title="Connection">
				<div className="rsi-connection-row">
					<span
						className="rsi-connection-dot"
						data-state={state.connectionState}
					/>
					<span className="rsi-connection-label">{state.connectionState}</span>
					{isLive && <span className="rsi-live-badge">LIVE</span>}
				</div>
				<div className="rsi-state-meta">
					Reconnect attempt: {state.reconnectAttempt}
				</div>
				{state.protocols.length > 0 && (
					<div className="rsi-state-meta">
						Protocols: {state.protocols.join(", ")}
					</div>
				)}
				<div className="rsi-state-meta">
					Disposed: {String(state.disposed)} | Intentional close:{" "}
					{String(state.intentionalClose)}
				</div>
			</InspectorSection>

			<InspectorSection title={`Subscriptions (${subEntries.length})`}>
				{subEntries.length === 0 ? (
					<div className="rsi-muted">No subscriptions</div>
				) : (
					<table className="rsi-sub-table">
						<thead>
							<tr>
								<th>Key</th>
								<th>Refs</th>
								<th>Pending</th>
							</tr>
						</thead>
						<tbody>
							{subEntries.map(([key, count]) => (
								<tr key={key}>
									<td>{key}</td>
									<td>{count}</td>
									<td>
										{state.pendingSubscriptions.has(key) ? (
											<span className="rsi-pending">pending</span>
										) : (
											<span className="rsi-no-pending">{"\u2014"}</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</InspectorSection>

			<InspectorSection title={`In-flight (${inFlightEntries.length})`}>
				{inFlightEntries.length === 0 ? (
					<div className="rsi-muted">No in-flight messages</div>
				) : (
					<div>
						{inFlightEntries.map(([id, msg]) => (
							<div key={id} className="rsi-inflight-item">
								<div className="rsi-inflight-id">{id}</div>
								<div className="rsi-inflight-data">
									<InspectorJsonViewer data={msg} />
								</div>
							</div>
						))}
					</div>
				)}
			</InspectorSection>
		</div>
	);
}
