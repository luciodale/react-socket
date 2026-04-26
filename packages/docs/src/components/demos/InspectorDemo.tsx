import {
	useSocketConnectionState,
	useSocketEvent,
	useSocketSend,
	WebSocketManager,
} from "@luciodale/react-socket";
import { InspectorPanel } from "@luciodale/react-socket/inspector";
import { useEffect, useMemo, useState } from "react";
import { getWsUrl } from "../../lib/ws-url";

// ── Protocol ────────────────────────────────────────────────────────

type TClientMsg = { type: "echo"; text: string };
type TServerMsg = { type: "echo"; text: string };

// ── Component ───────────────────────────────────────────────────────

export function InspectorDemo() {
	const [input, setInput] = useState("");
	const [messages, setMessages] = useState<
		Array<{ id: string; from: string; text: string }>
	>([]);

	const manager = useMemo(
		() =>
			new WebSocketManager<TClientMsg, TServerMsg>({
				url: getWsUrl(),
				serialize: (msg) => JSON.stringify(msg),
				deserialize: (raw) => JSON.parse(raw) as TServerMsg,
			}),
		[],
	);

	useEffect(() => {
		manager.connect();
		return () => manager.disconnect();
	}, [manager]);

	useSocketEvent(manager, "echo", (msg) => {
		setMessages((prev) => [
			...prev,
			{ id: crypto.randomUUID(), from: "server", text: msg.text },
		]);
	});

	const state = useSocketConnectionState(manager);
	const { send } = useSocketSend(manager);

	function handleSend() {
		if (!input.trim()) return;
		const text = input.trim();
		setMessages((prev) => [
			...prev,
			{ id: crypto.randomUUID(), from: "you", text },
		]);
		send({ type: "echo", text });
		setInput("");
	}

	return (
		<div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
			<div className="mb-3 flex items-center gap-2">
				<h3 className="text-lg font-semibold text-white">Echo</h3>
				<span className="text-xs text-white/40">{state}</span>
			</div>

			<div className="mb-3 min-h-[80px] max-h-[160px] overflow-y-auto rounded bg-black/40 p-3">
				{messages.length === 0 && (
					<p className="text-sm text-white/30">
						Send a message and watch the inspector.
					</p>
				)}
				{messages.map((m) => (
					<div key={m.id} className="mb-1 text-sm">
						<span className="font-semibold text-white/90">{m.from}:</span>{" "}
						<span className="text-white/70">{m.text}</span>
					</div>
				))}
			</div>

			<div className="flex gap-2">
				<input
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && handleSend()}
					placeholder="Type a message..."
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

			<InspectorPanel manager={manager} />
		</div>
	);
}
