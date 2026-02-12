import { useEffect, useState } from "react";
import { useSocketStore } from "../store";
import type { TConnectionState } from "../types";

type TConnectionStatus =
	| { visible: false }
	| {
			visible: true;
			state: Exclude<TConnectionState, "connected">;
			message: string;
	  }
	| { visible: true; state: "connected"; message: string };

export function useConnectionStatus(): TConnectionStatus {
	const connectionState = useSocketStore((s) => s.connectionState);
	const lastError = useSocketStore((s) => s.lastError);
	const [hasHadError, setHasHadError] = useState(false);

	useEffect(() => {
		if (lastError) {
			setHasHadError(true);
		}
	}, [lastError]);

	if (lastError) {
		return {
			visible: true,
			state: "disconnected",
			message: lastError.message,
		};
	}

	if (connectionState === "connected" && hasHadError) {
		return { visible: true, state: "connected", message: "Back online" };
	}

	if (connectionState === "reconnecting") {
		return { visible: true, state: "reconnecting", message: "Reconnecting..." };
	}

	if (connectionState === "disconnected") {
		return { visible: true, state: "disconnected", message: "Connection lost" };
	}

	return { visible: false };
}
