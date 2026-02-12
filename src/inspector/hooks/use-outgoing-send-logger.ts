import { useEffect } from "react";
import { useWebSocketManager } from "../../socket";
import { useInspectorStore } from "../inspector-store";

export function useOutgoingSendLogger(): void {
	const manager = useWebSocketManager();
	const enabled = useInspectorStore((s) => s.enabled);
	const pushOutgoingMessage = useInspectorStore(
		(s) => s.pushOutgoingMessage,
	);

	useEffect(() => {
		if (!enabled) return;

		manager.addSendListener(pushOutgoingMessage);
		return () => {
			manager.removeSendListener(pushOutgoingMessage);
		};
	}, [manager, enabled, pushOutgoingMessage]);
}
