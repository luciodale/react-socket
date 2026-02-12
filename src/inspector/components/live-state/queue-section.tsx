import { useSocketStore } from "../../../socket/store";
import { useLocalStorageQueue } from "../../hooks/use-local-storage-queue";
import { JsonViewer } from "../shared/json-viewer";
import { Section } from "../shared/section";

export function QueueSection() {
	const pendingQueueLength = useSocketStore((s) => s.pendingQueueLength);
	const localQueue = useLocalStorageQueue();

	return (
		<>
			<Section title={`Store Queue (${pendingQueueLength})`}>
				<p className="m-0 text-neutral-500">
					pendingQueueLength: {pendingQueueLength}
				</p>
			</Section>

			<Section title={`localStorage Queue (${localQueue.length})`}>
				{localQueue.length === 0 ? (
					<p className="m-0 text-neutral-600">Queue empty</p>
				) : (
					<JsonViewer data={localQueue} />
				)}
			</Section>
		</>
	);
}
