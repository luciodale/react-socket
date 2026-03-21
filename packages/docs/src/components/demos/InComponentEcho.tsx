import { WebSocketManager, useConnectionState } from "@luciodale/react-socket";
import { useEffect, useMemo, useState } from "react";
import { getWsUrl } from "../../lib/ws-url";

// ── Protocol ────────────────────────────────────────────────────────

type TClientMsg = { action: "echo"; text: string };
type TServerMsg = { action: "echo"; text: string };

// ── Component ───────────────────────────────────────────────────────

export function InComponentEcho() {
	const [response, setResponse] = useState<string | null>(null);

	const manager = useMemo(() => {
		const m = new WebSocketManager<TClientMsg, TServerMsg>({
			url: getWsUrl(),
			serialize: (msg) => JSON.stringify(msg),
			deserialize: (raw) => JSON.parse(raw) as TServerMsg,

			onMessageReceived(msg) {
				setResponse(msg.text);
			},
		});
		return m;
	}, []);

	useEffect(() => {
		manager.connect();
		return () => manager.disconnect();
	}, [manager]);

	const state = useConnectionState(manager);

	return (
		<div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
			<div className="mb-3 flex items-center gap-2">
				<h3 className="text-lg font-semibold text-white">Echo</h3>
				<span className="text-xs text-white/40">{state}</span>
			</div>

			<div className="mb-3 flex gap-2">
				<button
					type="button"
					onClick={() =>
						manager.send({ data: { action: "echo", text: "hello" } })
					}
					className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover cursor-pointer"
				>
					Send "hello"
				</button>
				<button
					type="button"
					onClick={() =>
						manager.send({ data: { action: "echo", text: "ping" } })
					}
					className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover cursor-pointer"
				>
					Send "ping"
				</button>
			</div>

			<div className="rounded bg-black/40 p-3 min-h-[48px]">
				{response ? (
					<p className="text-sm text-white/70">
						<span className="font-semibold text-white/90">Server said:</span>{" "}
						{response}
					</p>
				) : (
					<p className="text-sm text-white/30">
						Click a button to send a message.
					</p>
				)}
			</div>
		</div>
	);
}
