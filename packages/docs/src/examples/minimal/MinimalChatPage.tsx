import type { TConnectionState } from "@luciodale/react-socket";
import {
	useSend,
	useSubscription,
	WebSocketManager,
} from "@luciodale/react-socket";
import { useCallback, useEffect, useState } from "react";
import { create } from "zustand";

// ── Types ────────────────────────────────────────────────────────────

type TMessage = { id: string; sender: string; text: string };

type TServerMsg =
	| { action: "subscribe_ack"; type: string; channel: string }
	| {
			action: "message";
			type: "conversation";
			channel: string;
			id: string;
			sender: string;
			text: string;
	  };

// ── Store ────────────────────────────────────────────────────────────

type TStore = {
	connectionState: TConnectionState;
	messages: Record<string, TMessage[]>;
};

const useStore = create<TStore>()(() => ({
	connectionState: "disconnected",
	messages: {},
}));

// ── Manager ──────────────────────────────────────────────────────────

const manager = new WebSocketManager({
	url: "ws://localhost:3001/ws",

	serializePing: () => JSON.stringify({ action: "ping" }),
	isPong: (p) =>
		typeof p === "object" &&
		p !== null &&
		"action" in p &&
		(p as { action: unknown }).action === "pong",

	onConnectionStateChange(state) {
		useStore.setState({ connectionState: state });
	},

	onMessage(parsed) {
		const msg = parsed as TServerMsg;

		if (msg.action === "subscribe_ack") {
			manager.resolvePendingSubscription(`${msg.type}:${msg.channel}`);
			return;
		}

		if (msg.action === "message") {
			manager.ackInFlight(msg.id);
			useStore.setState((s) => ({
				messages: {
					...s.messages,
					[msg.channel]: [
						...(s.messages[msg.channel] ?? []),
						{ id: msg.id, sender: msg.sender, text: msg.text },
					],
				},
			}));
		}
	},
});

// ── Hooks ────────────────────────────────────────────────────────────

function useChat(channel: string) {
	const messages = useStore((s) => s.messages[channel] ?? EMPTY);
	const send = useSend(manager);

	const sendMessage = useCallback(
		(text: string) => {
			const id = crypto.randomUUID();
			send(
				id,
				JSON.stringify({
					action: "message",
					type: "conversation",
					id,
					channel,
					text,
				}),
			);
		},
		[send, channel],
	);

	return { messages, sendMessage };
}

const EMPTY: TMessage[] = [];

// ── Components ───────────────────────────────────────────────────────

function ChatRoom({ channel }: { channel: string }) {
	const [input, setInput] = useState("");
	const connectionState = useStore((s) => s.connectionState);
	const { messages, sendMessage } = useChat(channel);

	useSubscription(
		manager,
		`conversation:${channel}`,
		JSON.stringify({
			action: "subscribe",
			type: "conversation",
			channel,
		}),
	);

	function handleSend() {
		if (!input.trim()) return;
		sendMessage(input.trim());
		setInput("");
	}

	return (
		<div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
			<div className="mb-3 flex items-center gap-2">
				<h2 className="text-lg font-semibold text-zinc-100">#{channel}</h2>
				<span className="text-xs text-zinc-500">{connectionState}</span>
			</div>

			<div className="mb-3 min-h-[120px] max-h-[240px] overflow-y-auto rounded bg-zinc-950 p-3">
				{messages.length === 0 && (
					<p className="text-sm text-zinc-600">No messages yet.</p>
				)}
				{messages.map((m) => (
					<div key={m.id} className="mb-1 text-sm text-zinc-200">
						<span className="font-semibold">{m.sender}:</span> {m.text}
					</div>
				))}
			</div>

			<div className="flex gap-2">
				<input
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && handleSend()}
					placeholder="Type a message..."
					className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-indigo-500"
				/>
				<button
					type="button"
					onClick={handleSend}
					className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
				>
					Send
				</button>
			</div>
		</div>
	);
}

// ── Page ─────────────────────────────────────────────────────────────

export function MinimalChatPage() {
	const [channel, setChannel] = useState("general");

	useEffect(() => {
		manager.connect();
		return () => manager.disconnect();
	}, []);

	return (
		<div className="mx-auto max-w-2xl space-y-6 p-6">
			<div>
				<h1 className="text-2xl font-bold text-zinc-100">Minimal Chat</h1>
				<p className="mt-1 text-sm text-zinc-500">
					Everything in one file — manager, store, hooks, component.
				</p>
			</div>

			<div className="flex items-center gap-3">
				<label htmlFor="channel-input" className="text-sm text-zinc-400">
					Channel
				</label>
				<input
					id="channel-input"
					value={channel}
					onChange={(e) => setChannel(e.target.value)}
					className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
				/>
			</div>

			<ChatRoom channel={channel} />
		</div>
	);
}
