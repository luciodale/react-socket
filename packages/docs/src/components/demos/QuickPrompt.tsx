import {
	useSocketConnectionState,
	useSocketEvent,
	useSocketSend,
	WebSocketManager,
} from "@luciodale/react-socket";
import { useEffect, useMemo, useState } from "react";
import { getWsUrl } from "../../lib/ws-url";

// ── Protocol ────────────────────────────────────────────────────────

type TClientMsg = { type: "quick-ask"; id: string; prompt: string };

type TServerMsg = {
	type: "chat";
	id: string;
	channel: string;
	sender: string;
	senderKind: "human" | "agent";
	text: string;
};

type TEntry =
	| { id: string; kind: "you"; text: string }
	| { id: string; kind: "assistant"; text: string }
	| { id: string; kind: "not-sent"; text: string };

// ── Component ───────────────────────────────────────────────────────

export function QuickPrompt() {
	const [input, setInput] = useState("");
	const [messages, setMessages] = useState<TEntry[]>([]);

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

	useSocketEvent(manager, "chat", (msg) => {
		setMessages((prev) => [
			...prev,
			{ id: msg.id, kind: "assistant", text: msg.text },
		]);
	});

	const state = useSocketConnectionState(manager);
	const connected = state === "connected";
	const { send } = useSocketSend(manager);

	function handleSend() {
		if (!input.trim()) return;
		const text = input.trim();
		const id = crypto.randomUUID();
		const ok = send({ type: "quick-ask", id, prompt: text });
		setMessages((prev) => [
			...prev,
			{ id, kind: ok ? "you" : "not-sent", text },
		]);
		setInput("");
	}

	return (
		<div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
			<div className="mb-3 flex items-center gap-2">
				<h3 className="text-lg font-semibold text-white">Quick prompt</h3>
				<span className="text-xs text-white/40">{state}</span>
			</div>

			<div className="mb-3 min-h-[120px] max-h-[240px] overflow-y-auto rounded bg-black/40 p-3">
				{messages.length === 0 && (
					<p className="text-sm text-white/30">
						Ask the assistant something. The reply lands as a single message (no
						streaming, no tracking).
					</p>
				)}
				{messages.map((m) => (
					<div key={m.id} className="mb-1 text-sm text-white/70">
						{m.kind === "not-sent" ? (
							<>
								<span className="font-semibold text-rose-400">not sent:</span>{" "}
								<span className="line-through">{m.text}</span>
								<span className="ml-2 text-xs text-rose-400/70">(offline)</span>
							</>
						) : m.kind === "you" ? (
							<>
								<span className="font-semibold text-white/90">you:</span>{" "}
								{m.text}
							</>
						) : (
							<>
								<span className="font-semibold text-accent">assistant:</span>{" "}
								{m.text}
							</>
						)}
					</div>
				))}
			</div>

			<div className="flex gap-2">
				<input
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && handleSend()}
					placeholder={
						connected ? "Ask anything..." : "Offline — reconnecting..."
					}
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

			{!connected && (
				<p className="mt-2 text-xs text-rose-400/80">
					You are offline. Prompts you send now will be marked as not sent.
				</p>
			)}
		</div>
	);
}
