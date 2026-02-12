import { InspectorPanel } from "./components/inspector-panel";
import { InspectorToggle } from "./components/inspector-toggle";
import { useStateRecorder } from "./hooks/use-state-recorder";

export function SocketInspector() {
	useStateRecorder();

	return (
		<>
			<InspectorToggle />
			<InspectorPanel />
		</>
	);
}
