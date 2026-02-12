import { InspectorPanel } from "./components/inspector-panel";
import { InspectorToggle } from "./components/inspector-toggle";
import { useOutgoingSendLogger } from "./hooks/use-outgoing-send-logger";
import { useStateRecorder } from "./hooks/use-state-recorder";

export function SocketInspector() {
	useStateRecorder();
	useOutgoingSendLogger();

	return (
		<>
			<InspectorToggle />
			<InspectorPanel />
		</>
	);
}
