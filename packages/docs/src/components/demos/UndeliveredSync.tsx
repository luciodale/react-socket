import {
	createLocalStorage,
	createUndeliveredSync,
	useConnectionState,
	WebSocketManager,
} from "@luciodale/react-socket";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { getWsUrl } from "../../lib/ws-url";

// ── Protocol ────────────────────────────────────────────────────────

type TClientMsg =
	| { action: "ping" }
	| { action: "message"; id: string; channel: string; text: string };

type TServerMsg =
	| { action: "pong" }
	| {
			action: "message";
			id: string;
			channel: string;
			sender: string;
			text: string;
	  };

type TStoredMessage = { id: string; channel: string; text: string };

type TStatus = "sending" | "delivered" | "saved" | "retrying";

type TUIMessage = {
	id: string;
	sender: string;
	text: string;
	status: TStatus;
};

// ── Constants ───────────────────────────────────────────────────────

const CHANNEL = "demo";

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

	ping: () => ({ action: "ping" }),
	isPong: (msg) => msg.action === "pong",

	onSendIntent({ data, ackId }) {
		if (data.action !== "message" || !ackId) return;
		useStore.setState((s) => {
			const exists = s.messages.some((m) => m.id === ackId);
			if (exists) {
				return {
					messages: s.messages.map((m) =>
						m.id === ackId ? { ...m, status: "retrying" as const } : m,
					),
				};
			}
			return {
				messages: [
					...s.messages,
					{ id: ackId, sender: "you", text: data.text, status: "sending" },
				],
			};
		});
	},

	onMessageReceived(msg) {
		if (msg.action !== "message") return;

		manager.ackInFlight(msg.id);
		undelivered.removeMessage(msg.channel, msg.id);

		useStore.setState((s) => {
			const exists = s.messages.some((m) => m.id === msg.id);
			if (exists) {
				return {
					messages: s.messages.map((m) =>
						m.id === msg.id ? { ...m, status: "delivered" as const } : m,
					),
				};
			}
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
	},

	onInFlightDrop(messages) {
		for (const { id, data } of messages) {
			if (data.action === "message") {
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
				droppedIds.has(m.id) ? { ...m, status: "saved" as const } : m,
			),
		}));
	},

	onReady() {
		const saved = undelivered.getChannelMessages(CHANNEL);
		for (const msg of saved) {
			manager.send({
				data: {
					action: "message",
					id: msg.id,
					channel: CHANNEL,
					text: msg.text,
				},
				ackId: msg.id,
			});
		}
	},
});

// ── Status Labels ───────────────────────────────────────────────────

const STATUS_LABEL: Record<TStatus, string> = {
	sending: "sending...",
	delivered: "delivered",
	saved: "saved for retry",
	retrying: "retrying...",
};

const STATUS_COLOR: Record<TStatus, string> = {
	sending: "text-yellow-400/60",
	delivered: "text-green-400/60",
	saved: "text-orange-400/60",
	retrying: "text-blue-400/60",
};

// ── Component ───────────────────────────────────────────────────────

export function UndeliveredSync() {
	const [input, setInput] = useState("");
	const messages = useStore((s) => s.messages);
	const state = useConnectionState(manager);

	useEffect(() => {
		undelivered.init().then(() => manager.connect());
		return () => manager.disconnect();
	}, []);

	function handleSend() {
		if (!input.trim()) return;
		const text = input.trim();
		const id = crypto.randomUUID();
		const sent = manager.send({
			data: { action: "message", id, channel: CHANNEL, text },
			ackId: id,
		});
		if (!sent) {
			undelivered.addMessage(CHANNEL, { id, channel: CHANNEL, text });
			useStore.setState((s) => ({
				messages: s.messages.map((m) =>
					m.id === id ? { ...m, status: "saved" as const } : m,
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

	const inFlight = messages.filter((m) => m.status === "sending").length;
	const saved = messages.filter((m) => m.status === "saved").length;

	return (
		<div className="space-y-4">
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

				{(inFlight > 0 || saved > 0) && (
					<div className="mb-3 flex gap-4 text-xs">
						{inFlight > 0 && (
							<span className="text-yellow-400/60">{inFlight} in flight</span>
						)}
						{saved > 0 && (
							<span className="text-orange-400/60">
								{saved} saved for retry
							</span>
						)}
					</div>
				)}

				<div className="mb-3 min-h-[120px] max-h-[240px] overflow-y-auto rounded bg-black/40 p-3">
					{messages.length === 0 && (
						<p className="text-sm text-white/30">
							Send a message, disconnect, then reconnect to see persistence
							in action.
						</p>
					)}
					{messages.map((m) => (
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
