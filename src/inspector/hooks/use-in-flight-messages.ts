import { useEffect, useState } from "react";
import { useWebSocketManager } from "../../socket/index";
import type { TSocketMessageFromClientToServer } from "../../socket/types";

export function useInFlightMessages(): Array<
	[string, TSocketMessageFromClientToServer]
> {
	const manager = useWebSocketManager();
	const [entries, setEntries] = useState<
		Array<[string, TSocketMessageFromClientToServer]>
	>([]);

	useEffect(() => {
		function read() {
			setEntries([...manager.getInFlightMessages()]);
		}

		read();
		const id = setInterval(read, 500);
		return () => clearInterval(id);
	}, [manager]);

	return entries;
}
