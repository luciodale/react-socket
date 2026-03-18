import { useConnectionState, WebSocketManager } from "@luciodale/react-socket";
import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "zustand";

// ── Types ────────────────────────────────────────────────────────────
//
// Subset of the OpenAI Realtime WebSocket API (text only, no audio).
// See: https://platform.openai.com/docs/api-reference/realtime

type TMessage = {
	id: string;
	role: "user" | "assistant";
	text: string;
	done: boolean;
};

type TClientEvent =
	| {
			type: "conversation.item.create";
			event_id: string;
			item: {
				type: "message";
				role: "user";
				content: { type: "input_text"; text: string }[];
			};
	  }
	| { type: "response.create" };

type TServerEvent =
	| { type: "session.created"; session: { id: string } }
	| { type: "conversation.item.created"; item: { id: string } }
	| {
			type: "response.text.delta";
			response_id: string;
			item_id: string;
			delta: string;
	  }
	| {
			type: "response.text.done";
			response_id: string;
			item_id: string;
			text: string;
	  }
	| {
			type: "response.done";
			response: { id: string; status: string };
	  };

// ── Store ────────────────────────────────────────────────────────────

const useStore = create<{ messages: TMessage[] }>()(() => ({
	messages: [],
}));

// ── Manager ──────────────────────────────────────────────────────────
//
// No ping/pong — WebSocket protocol handles keepalive.
// No subscriptions — direct conversation, not pub/sub.
// No in-flight tracking — OpenAI has no explicit message acks.

export const manager = new WebSocketManager<TClientEvent, TServerEvent>({
	url: "ws://localhost:3001/ws/openai",
	serialize: (msg) => JSON.stringify(msg),
	deserialize: (raw) => JSON.parse(raw) as TServerEvent,

	onSendIntent({ data }) {
		if (data.type !== "conversation.item.create") return;
		useStore.setState((s) => ({
			messages: [
				...s.messages,
				{
					id: data.event_id,
					role: "user",
					text: data.item.content[0].text,
					done: true,
				},
			],
		}));
	},

	onMessageReceived(event) {
		if (event.type === "response.text.delta") {
			useStore.setState((s) => {
				const existing = s.messages.find((m) => m.id === event.item_id);
				if (existing) {
					return {
						messages: s.messages.map((m) =>
							m.id === event.item_id ? { ...m, text: m.text + event.delta } : m,
						),
					};
				}
				// First delta — create assistant message
				return {
					messages: [
						...s.messages,
						{
							id: event.item_id,
							role: "assistant",
							text: event.delta,
							done: false,
						},
					],
				};
			});
			return;
		}

		if (event.type === "response.text.done") {
			useStore.setState((s) => ({
				messages: s.messages.map((m) =>
					m.id === event.item_id ? { ...m, text: event.text, done: true } : m,
				),
			}));
		}
	},
});

// ── Hooks ────────────────────────────────────────────────────────────

function useChat() {
	const messages = useStore((s) => s.messages);

	const send = useCallback((text: string) => {
		const eventId = crypto.randomUUID();

		// 1. Create user message item
		manager.send({
			data: {
				type: "conversation.item.create",
				event_id: eventId,
				item: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text }],
				},
			},
		});

		// 2. Trigger model response
		manager.send({ data: { type: "response.create" } });
	}, []);

	return { messages, send };
}

// ── Components ───────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: TMessage }) {
	const isUser = msg.role === "user";
	return (
		<div className={`mb-2 flex ${isUser ? "justify-end" : "justify-start"}`}>
			<div
				className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
					isUser ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-200"
				}`}
			>
				{msg.text}
				{!msg.done && (
					<span className="ml-1 inline-block h-3 w-1 animate-pulse bg-zinc-400" />
				)}
			</div>
		</div>
	);
}

function Chat() {
	const [input, setInput] = useState("");
	const connectionState = useConnectionState(manager);
	const { messages, send } = useChat();
	const bottomRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	function handleSend() {
		if (!input.trim()) return;
		send(input.trim());
		setInput("");
	}

	return (
		<div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
			<div className="mb-3 flex items-center gap-2">
				<h2 className="text-lg font-semibold text-zinc-100">Realtime Chat</h2>
				<span
					className={`text-xs ${connectionState === "connected" ? "text-emerald-500" : "text-red-400"}`}
				>
					{connectionState}
				</span>
			</div>

			<div className="mb-3 min-h-[200px] max-h-[400px] overflow-y-auto rounded bg-zinc-950 p-3">
				{messages.length === 0 && (
					<p className="text-sm text-zinc-600">
						Send a message to start the conversation.
					</p>
				)}
				{messages.map((m) => (
					<MessageBubble key={m.id} msg={m} />
				))}
				<div ref={bottomRef} />
			</div>

			<div className="flex gap-2">
				<input
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && handleSend()}
					placeholder="Type a message…"
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

export function OpenAIRealtimePage() {
	useEffect(() => {
		manager.connect();
		return () => manager.disconnect();
	}, []);

	return (
		<div className="mx-auto max-w-2xl space-y-6 p-6">
			<div>
				<h1 className="text-2xl font-bold text-zinc-100">
					OpenAI Realtime API
				</h1>
				<p className="mt-1 text-sm text-zinc-500">
					Mock server simulating the OpenAI Realtime WebSocket protocol.
					Text-only mode with streaming responses.
				</p>
			</div>

			<Chat />
		</div>
	);
}
