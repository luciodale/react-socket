import { useSocketStore } from "../../../socket/store";
import { JsonViewer } from "../shared/json-viewer";
import { Section } from "../shared/section";

export function ErrorSection() {
	const lastError = useSocketStore((s) => s.lastError);

	return (
		<Section title="Last Error">
			{lastError ? (
				<JsonViewer data={lastError} defaultExpanded />
			) : (
				<p className="m-0 text-neutral-600">No errors</p>
			)}
		</Section>
	);
}
