import { useEffect, useState } from "react";
import { useWebSocketManager } from "../../socket/index";

export function usePendingSubscriptions(): string[] {
	const manager = useWebSocketManager();
	const [pending, setPending] = useState<string[]>([]);

	useEffect(() => {
		function read() {
			setPending([...manager.getPendingSubscriptions()]);
		}

		read();
		const id = setInterval(read, 500);
		return () => clearInterval(id);
	}, [manager]);

	return pending;
}
