import { useConnectionState, WebSocketManager } from "@luciodale/react-socket";
import { useCallback, useEffect, useState } from "react";
import { create } from "zustand";
import { getWsUrl } from "../../lib/ws-url";

// ── Protocol ────────────────────────────────────────────────────────

type TClientMsg =
	| { action: "ping" }
	| { action: "subscribe"; channel: string }
	| { action: "unsubscribe"; channel: string }
	| { action: "message"; id: string; channel: string; text: string };

type TServerMsg =
	| { action: "pong" }
	| { action: "subscribe_ack"; channel: string }
	| { action: "unsubscribe_ack"; channel: string }
	| {
			action: "message";
			id: string;
			channel: string;
			sender: string;
			text: string;
	  };

type TMessage = { id: string; sender: string; text: string };

// ── Store ───────────────────────────────────────────────────────────

const useStore = create<{ messages: Record<string, TMessage[]> }>()(() => ({
	messages: {},
}));

// ── Manager ─────────────────────────────────────────────────────────

const manager = new WebSocketManager<TClientMsg, TServerMsg>({
	url: getWsUrl(),
	serialize: (msg) => JSON.stringify(msg),
	deserialize: (raw) => JSON.parse(raw) as TServerMsg,

	ping: () => ({ action: "ping" }),
	isPong: (msg) => msg.action === "pong",

	onSendIntent({ data, ackId }) {
		if (data.action !== "message" || !ackId) return;
		useStore.setState((s) => ({
			messages: {
				...s.messages,
				[data.channel]: [
					...(s.messages[data.channel] ?? []),
					{ id: ackId, sender: "you", text: data.text },
				],
			},
		}));
	},

	onMessageReceived(msg) {
		switch (msg.action) {
			case "subscribe_ack":
				manager.resolvePendingSubscription(msg.channel);
				break;

			case "message":
				manager.ackInFlight(msg.id);
				useStore.setState((s) => {
					const existing = s.messages[msg.channel] ?? [];
					if (existing.some((m) => m.id === msg.id)) return s;
					return {
						messages: {
							...s.messages,
							[msg.channel]: [
								...existing,
								{ id: msg.id, sender: msg.sender, text: msg.text },
							],
						},
					};
				});
				break;
		}
	},
});

// ── Hooks ───────────────────────────────────────────────────────────

const EMPTY: TMessage[] = [];

function useChat(channel: string) {
	const messages = useStore((s) => s.messages[channel] ?? EMPTY);

	useEffect(() => {
		manager.subscribe(channel, { action: "subscribe", channel });
		return () => {
			manager.unsubscribe(channel, { action: "unsubscribe", channel });
		};
	}, [channel]);

	const sendMessage = useCallback(
		(text: string) => {
			const id = crypto.randomUUID();
			manager.send({
				data: { action: "message", id, channel, text },
				ackId: id,
			});
		},
		[channel],
	);

	return { messages, sendMessage };
}

// ── Components ──────────────────────────────────────────────────────

function Channel({ channel }: { channel: string }) {
	const [input, setInput] = useState("");
	const state = useConnectionState(manager);
	const { messages, sendMessage } = useChat(channel);

	function handleSend() {
		if (!input.trim()) return;
		sendMessage(input.trim());
		setInput("");
	}

	return (
		<div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
			<div className="mb-3 flex items-center gap-2">
				<h3 className="text-lg font-semibold text-white">#{channel}</h3>
				<span className="text-xs text-white/40">{state}</span>
			</div>

			<div className="mb-3 min-h-[120px] max-h-[240px] overflow-y-auto rounded bg-black/40 p-3">
				{messages.length === 0 && (
					<p className="text-sm text-white/30">No messages yet.</p>
				)}
				{messages.map((m) => (
					<div key={m.id} className="mb-1 text-sm text-white/70">
						<span className="font-semibold text-white/90">{m.sender}:</span>{" "}
						{m.text}
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
		</div>
	);
}

// ── Exported Island ─────────────────────────────────────────────────

export function ChatRoom() {
	const [channel, setChannel] = useState("general");

	useEffect(() => {
		manager.connect();
		return () => manager.disconnect();
	}, []);

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-3">
				<label htmlFor="channel-select" className="text-sm text-white/50">
					Channel
				</label>
				<input
					id="channel-select"
					value={channel}
					onChange={(e) => setChannel(e.target.value)}
					className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white outline-none focus:border-accent"
				/>
			</div>
			<Channel channel={channel} />
		</div>
	);
}
