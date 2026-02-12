import { useEffect } from "react";
import { _actionRef, useSocketStore } from "../../socket/store";
import { extractState } from "../extract-state";
import { nextSnapshotId, useInspectorStore } from "../inspector-store";

export function useStateRecorder(): void {
	const enabled = useInspectorStore((s) => s.enabled);
	const pushSnapshot = useInspectorStore((s) => s.pushSnapshot);

	useEffect(() => {
		if (!enabled) return;

		// Push @@INIT snapshot on enable
		pushSnapshot({
			id: nextSnapshotId(),
			timestamp: Date.now(),
			actionName: "@@INIT",
			state: extractState(useSocketStore.getState()),
		});

		const unsub = useSocketStore.subscribe((state) => {
			const actionName = _actionRef.current;
			_actionRef.current = "unknown";
			pushSnapshot({
				id: nextSnapshotId(),
				timestamp: Date.now(),
				actionName,
				state: extractState(state),
			});
		});

		return unsub;
	}, [enabled, pushSnapshot]);
}
