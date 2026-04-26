import {
	createLocalStorage,
	createUndeliveredSync,
	useSocketConnectionState,
	useSocketEvent,
	useSocketInFlightDrop,
	useSocketSend,
	useSocketSendIntent,
	WebSocketManager,
} from "@luciodale/react-socket";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { getWsUrl } from "../../lib/ws-url";

// ── Protocol ────────────────────────────────────────────────────────

type TClientMsg =
	| { type: "ping" }
	| { type: "message"; id: string; channel: string; text: string };

type TServerMsg =
	| { type: "pong" }
	| { type: "delivered"; ackId: string }
	| {
			type: "chat";
			id: string;
			channel: string;
			sender: string;
			senderKind: "human" | "agent";
			text: string;
	  };

type TStoredMessage = { id: string; channel: string; text: string };

type TStatus = "sending" | "delivered" | "failed" | "retrying";

type TUIMessage = {
	id: string;
	sender: string;
	text: string;
	status: TStatus;
};

// ── Constants ───────────────────────────────────────────────────────

const CHANNEL = "space:resilient";

// ── Undelivered Store ───────────────────────────────────────────────

const undelivered = createUndeliveredSync<TStoredMessage>({
	storage: createLocalStorage(),
	storageKey: "react_socket_demo_undelivered",
});

// ── UI Store ────────────────────────────────────────────────────────

const useStore = create<{ messages: TUIMessage[] }>()(() => ({
	messages: [],
}));

// ── Manager ─────────────────────────────────────────────────────────

const manager = new WebSocketManager<TClientMsg, TServerMsg>({
	url: getWsUrl(),
	serialize: (msg) => JSON.stringify(msg),
	deserialize: (raw) => JSON.parse(raw) as TServerMsg,

	ping: () => ({ type: "ping" }),
	isPong: (msg) => msg.type === "pong",

	getAckId: (msg) => (msg.type === "delivered" ? msg.ackId : undefined),
});

// ── Bridges ─────────────────────────────────────────────────────────

function OptimisticBridge() {
	useSocketSendIntent(manager, ({ data, ackId }) => {
		if (data.type !== "message" || !ackId) return;
		useStore.setState((s) => {
			const existing = s.messages.find((m) => m.id === ackId);
			if (existing) {
				// Retry: bump to the end so the user sees it as "sent just now"
				// rather than stuck in its original failed position.
				const without = s.messages.filter((m) => m.id !== ackId);
				return {
					messages: [...without, { ...existing, status: "retrying" as const }],
				};
			}
			return {
				messages: [
					...s.messages,
					{ id: ackId, sender: "you", text: data.text, status: "sending" },
				],
			};
		});
	});

	useSocketInFlightDrop(manager, (messages) => {
		for (const { id, data } of messages) {
			if (data.type === "message") {
				undelivered.addMessage(data.channel, {
					id,
					channel: data.channel,
					text: data.text,
				});
			}
		}
		const droppedIds = new Set(messages.map((m) => m.id));
		useStore.setState((s) => ({
			messages: s.messages.map((m) =>
				droppedIds.has(m.id) ? { ...m, status: "failed" as const } : m,
			),
		}));
	});

	return null;
}

function DeliveredBridge() {
	useSocketEvent(manager, "delivered", (msg) => {
		undelivered.removeMessage(CHANNEL, msg.ackId);
		useStore.setState((s) => ({
			messages: s.messages.map((m) =>
				m.id === msg.ackId ? { ...m, status: "delivered" as const } : m,
			),
		}));
	});
	return null;
}

function ChatBridge() {
	useSocketEvent(manager, "chat", (msg) => {
		useStore.setState((s) => {
			const exists = s.messages.some((m) => m.id === msg.id);
			if (exists) return s;
			return {
				messages: [
					...s.messages,
					{
						id: msg.id,
						sender: msg.sender,
						text: msg.text,
						status: "delivered",
					},
				],
			};
		});
	});
	return null;
}

// ── Status Labels ───────────────────────────────────────────────────

const STATUS_LABEL: Record<TStatus, string> = {
	sending: "sending...",
	delivered: "delivered",
	failed: "failed",
	retrying: "retrying...",
};

const STATUS_COLOR: Record<TStatus, string> = {
	sending: "text-yellow-400/60",
	delivered: "text-green-400/60",
	failed: "text-red-400/60",
	retrying: "text-blue-400/60",
};

// ── Component ───────────────────────────────────────────────────────

export function UndeliveredSync() {
	const [input, setInput] = useState("");
	const messages = useStore((s) => s.messages);
	const state = useSocketConnectionState(manager);
	const { send } = useSocketSend(manager);

	useEffect(() => {
		undelivered.init().then(() => {
			const saved = undelivered.getChannelMessages(CHANNEL);
			for (const msg of saved) {
				useStore.setState((s) => {
					const exists = s.messages.some((m) => m.id === msg.id);
					if (exists) return s;
					return {
						messages: [
							...s.messages,
							{
								id: msg.id,
								sender: "you",
								text: msg.text,
								status: "failed" as const,
							},
						],
					};
				});
			}
			manager.connect();
		});
		return () => manager.disconnect();
	}, []);

	function handleSend() {
		if (!input.trim()) return;
		const text = input.trim();
		const id = crypto.randomUUID();
		const sent = send({ type: "message", id, channel: CHANNEL, text }, id);
		if (!sent) {
			undelivered.addMessage(CHANNEL, { id, channel: CHANNEL, text });
			useStore.setState((s) => ({
				messages: s.messages.map((m) =>
					m.id === id ? { ...m, status: "failed" as const } : m,
				),
			}));
		}
		setInput("");
	}

	function handleDisconnect() {
		manager.disconnect();
	}

	function handleReconnect() {
		manager.connect();
	}

	function handleRetry(id: string, text: string) {
		const sent = send({ type: "message", id, channel: CHANNEL, text }, id);
		if (!sent) {
			useStore.setState((s) => ({
				messages: s.messages.map((m) =>
					m.id === id ? { ...m, status: "failed" as const } : m,
				),
			}));
		}
	}

	const inFlight = messages.filter((m) => m.status === "sending").length;
	const delivered = messages.filter((m) => m.status !== "failed");
	const failedMessages = messages.filter((m) => m.status === "failed");

	return (
		<div className="space-y-4">
			<OptimisticBridge />
			<DeliveredBridge />
			<ChatBridge />
			<div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
				<div className="mb-3 flex items-center justify-between">
					<div className="flex items-center gap-2">
						<h3 className="text-lg font-semibold text-white">#{CHANNEL}</h3>
						<span className="text-xs text-white/40">{state}</span>
					</div>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={handleDisconnect}
							className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/60 hover:bg-white/10 cursor-pointer transition-colors"
						>
							Disconnect
						</button>
						<button
							type="button"
							onClick={handleReconnect}
							className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/60 hover:bg-white/10 cursor-pointer transition-colors"
						>
							Reconnect
						</button>
					</div>
				</div>

				{(inFlight > 0 || failedMessages.length > 0) && (
					<div className="mb-3 flex gap-4 text-xs">
						{inFlight > 0 && (
							<span className="text-yellow-400/60">{inFlight} in flight</span>
						)}
						{failedMessages.length > 0 && (
							<span className="text-red-400/60">
								{failedMessages.length} failed
							</span>
						)}
					</div>
				)}

				<div className="mb-3 min-h-[120px] max-h-[240px] overflow-y-auto rounded bg-black/40 p-3">
					{messages.length === 0 && (
						<p className="text-sm text-white/30">
							Send a message into the space, disconnect, then reconnect.
							Anything in flight that didn't get acked is held in localStorage
							and offered back to you.
						</p>
					)}
					{delivered.map((m) => (
						<div key={m.id} className="mb-1 flex items-baseline gap-2 text-sm">
							<span className="text-white/70">
								<span className="font-semibold text-white/90">{m.sender}:</span>{" "}
								{m.text}
							</span>
							<span className={`text-xs ${STATUS_COLOR[m.status]}`}>
								{STATUS_LABEL[m.status]}
							</span>
						</div>
					))}
				</div>

				{failedMessages.length > 0 && (
					<div className="mb-3 rounded border border-red-400/20 bg-red-400/[0.04] p-3">
						<div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-red-400/70">
							<span className="h-1.5 w-1.5 rounded-full bg-red-400/70" />
							Failed — tap retry to send again
						</div>
						{failedMessages.map((m) => (
							<div
								key={m.id}
								className="mb-1 flex items-baseline gap-2 text-sm last:mb-0"
							>
								<span className="text-white/60">
									<span className="font-semibold text-white/80">
										{m.sender}:
									</span>{" "}
									<span className="line-through opacity-70">{m.text}</span>
								</span>
								<button
									type="button"
									onClick={() => handleRetry(m.id, m.text)}
									className="ml-auto rounded border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs text-accent hover:bg-accent/20 cursor-pointer"
								>
									retry
								</button>
							</div>
						))}
					</div>
				)}

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
		</div>
	);
}
