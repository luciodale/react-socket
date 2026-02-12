import { useInspectorStore } from "../../inspector-store";
import { JsonViewer } from "../shared/json-viewer";
import { Section } from "../shared/section";

export function OutgoingMessagesSection() {
	const outgoingLog = useInspectorStore((s) => s.outgoingLog);

	return (
		<Section title={`Outgoing Messages (${outgoingLog.length})`}>
			{outgoingLog.length === 0 ? (
				<p className="m-0 text-neutral-600">No outgoing messages</p>
			) : (
				<div className="flex flex-col gap-1">
					{outgoingLog.map((entry) => (
						<div
							key={entry.id}
							className="flex flex-col gap-0.5 border-b border-neutral-800 pb-1"
						>
							<div className="flex items-center gap-2 text-[10px]">
								<span className="text-neutral-500">
									{new Date(entry.timestamp).toLocaleTimeString()}
								</span>
								<span className="rounded bg-blue-900 px-1 py-0.5 font-mono text-blue-300">
									{entry.message.action}
								</span>
							</div>
							<JsonViewer data={entry.message} />
						</div>
					))}
				</div>
			)}
		</Section>
	);
}
