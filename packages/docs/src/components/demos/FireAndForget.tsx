import { useConnectionState, WebSocketManager } from "@luciodale/react-socket";
import { useEffect, useMemo, useState } from "react";
import { getWsUrl } from "../../lib/ws-url";

// ── Protocol ────────────────────────────────────────────────────────

type TClientMsg = { action: "echo"; text: string };
type TServerMsg = { action: "echo"; text: string };

// ── Component ───────────────────────────────────────────────────────

export function FireAndForget() {
	const [input, setInput] = useState("");
	const [messages, setMessages] = useState<
		Array<{ id: string; from: "you" | "server"; text: string }>
	>([]);

	const manager = useMemo(() => {
		const m = new WebSocketManager<TClientMsg, TServerMsg>({
			url: getWsUrl(),
			serialize: (msg) => JSON.stringify(msg),
			deserialize: (raw) => JSON.parse(raw) as TServerMsg,

			onMessageReceived(msg) {
				setMessages((prev) => [
					...prev,
					{ id: crypto.randomUUID(), from: "server", text: msg.text },
				]);
			},
		});
		return m;
	}, []);

	useEffect(() => {
		manager.connect();
		return () => manager.disconnect();
	}, [manager]);

	const state = useConnectionState(manager);

	function handleSend() {
		if (!input.trim()) return;
		const text = input.trim();
		setMessages((prev) => [
			...prev,
			{ id: crypto.randomUUID(), from: "you", text },
		]);
		manager.send({ data: { action: "echo", text } });
		setInput("");
	}

	return (
		<div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
			<div className="mb-3 flex items-center gap-2">
				<h3 className="text-lg font-semibold text-white">Echo</h3>
				<span className="text-xs text-white/40">{state}</span>
			</div>

			<div className="mb-3 min-h-[120px] max-h-[240px] overflow-y-auto rounded bg-black/40 p-3">
				{messages.length === 0 && (
					<p className="text-sm text-white/30">
						Send a message to see the echo.
					</p>
				)}
				{messages.map((m) => (
					<div key={m.id} className="mb-1 text-sm text-white/70">
						<span className="font-semibold text-white/90">{m.from}:</span>{" "}
						{m.text}
					</div>
				))}
			</div>

			<div className="flex gap-2">
				<input
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && handleSend()}
					placeholder="Type something..."
					className="flex-1 rounded border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-accent"
				/>
				<button
					type="button"
					onClick={handleSend}
					className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover cursor-pointer"
				>
					Send
				</button>
			</div>
		</div>
	);
}
