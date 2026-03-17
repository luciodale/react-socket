import { useConnectionState, WebSocketManager } from "@luciodale/react-socket";
import { InspectorPanel } from "@luciodale/react-socket/inspector";
import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

// ── Types ────────────────────────────────────────────────────────────

type TMessage = { id: string; sender: string; text: string };

type TClientMsg =
	| { action: "ping" }
	| { action: "subscribe"; type: string; channel: string }
	| { action: "unsubscribe"; type: string; channel: string }
	| {
			action: "message";
			type: "conversation";
			id: string;
			channel: string;
			text: string;
	  };

type TServerMsg =
	| { action: "pong" }
	| { action: "subscribe_ack"; type: string; channel: string }
	| { action: "unsubscribe_ack"; type: string; channel: string }
	| {
			action: "message";
			type: "conversation";
			channel: string;
			id: string;
			sender: string;
			text: string;
	  };

// ── Query Client ────────────────────────────────────────────────────

const queryClient = new QueryClient({
	defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
});

// ── Manager ─────────────────────────────────────────────────────────

const manager = new WebSocketManager<TClientMsg, TServerMsg>({
	url: "ws://localhost:3001/ws",
	serialize: (msg) => JSON.stringify(msg),
	deserialize: (raw) => JSON.parse(raw) as TServerMsg,

	ping: { action: "ping" },
	isPong: (msg) => msg.action === "pong",
	onLastUnsubscribe(key) {
		queryClient.removeQueries({
			queryKey: [key],
		});
	},

	onMessage(msg) {
		if (msg.action === "subscribe_ack") {
			manager.resolvePendingSubscription(`${msg.type}:${msg.channel}`);
			return;
		}

		if (msg.action === "message") {
			manager.ackInFlight(msg.id);
			queryClient.setQueryData<TMessage[]>(
				[`${msg.type}:${msg.channel}`],
				(prev) => [
					...(prev ?? []),
					{ id: msg.id, sender: msg.sender, text: msg.text },
				],
			);
		}
	},
});

// ── Hooks ────────────────────────────────────────────────────────────

function useMessages(channel: string): TMessage[] {
	const { data } = useQuery<TMessage[]>({
		queryKey: ["messages", channel],
		queryFn: () => [],
		staleTime: Number.POSITIVE_INFINITY,
	});
	return data ?? EMPTY;
}

function useChat(channel: string) {
	const messages = useMessages(channel);

	const sendMessage = useCallback(
		(text: string) => {
			const id = crypto.randomUUID();
			manager.send(id, {
				action: "message",
				type: "conversation",
				id,
				channel,
				text,
			});
		},
		[channel],
	);

	return { messages, sendMessage };
}

const EMPTY: TMessage[] = [];

// ── Components ───────────────────────────────────────────────────────

function ChatRoom({ channel }: { channel: string }) {
	const [input, setInput] = useState("");
	const connectionState = useConnectionState(manager);
	const { messages, sendMessage } = useChat(channel);

	useEffect(() => {
		manager.subscribe(`conversation:${channel}`, {
			action: "subscribe",
			type: "conversation",
			channel,
		});
		return () => {
			manager.unsubscribe(`conversation:${channel}`, {
				action: "unsubscribe",
				type: "conversation",
				channel,
			});
		};
	}, [channel]);

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
		<QueryClientProvider client={queryClient}>
			<div className="mx-auto max-w-2xl space-y-6 p-6">
				<div>
					<h1 className="text-2xl font-bold text-zinc-100">
						Minimal Chat (React Query)
					</h1>
					<p className="mt-1 text-sm text-zinc-500">
						Same minimal example — but with TanStack React Query instead of
						Zustand.
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
			<InspectorPanel manager={manager} />
		</QueryClientProvider>
	);
}
