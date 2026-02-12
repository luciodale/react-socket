import { useEffect, useState } from "react";
import { QUEUE_STORAGE_KEY } from "../../socket/constants";
import type { TQueuedMessage } from "../../socket/types";

export function useLocalStorageQueue(): TQueuedMessage[] {
	const [queue, setQueue] = useState<TQueuedMessage[]>([]);

	useEffect(() => {
		function read() {
			try {
				const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
				if (!raw) {
					setQueue([]);
					return;
				}
				const parsed: unknown = JSON.parse(raw);
				setQueue(Array.isArray(parsed) ? (parsed as TQueuedMessage[]) : []);
			} catch {
				setQueue([]);
			}
		}

		read();
		const id = setInterval(read, 1000);
		return () => clearInterval(id);
	}, []);

	return queue;
}
