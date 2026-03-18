import {
	createLocalStorage,
	createUndeliveredSync,
	useConnectionState,
	WebSocketManager,
} from "@luciodale/react-socket";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { create } from "zustand";

// ── Types ────────────────────────────────────────────────────────────

type TMessage = { id: string; text: string };
type TDisplayMessage = TMessage & { sentAt: number };
type TMessageStatus = "delivered" | "sending" | "retry";

type TClientMsg =
	| { action: "ping" }
	| { action: "unreliable_message"; id: string; text: string };

type TServerMsg =
	| { action: "pong" }
	| { action: "message"; id: string; text: string };

// ── Constants ────────────────────────────────────────────────────────

const ACK_TIMEOUT_MS = 10_000;
const CHANNEL = "default";

// ── Sync queue (persists undelivered IDs to localStorage) ────────────

const sync = createUndeliveredSync<TMessage>({
	storage: createLocalStorage(),
	storageKey: "chat_undelivered",
});

// ── Store ────────────────────────────────────────────────────────────

const useStore = create<{ messages: TDisplayMessage[] }>()(() => ({
	messages: [],
}));

// ── Manager ──────────────────────────────────────────────────────────

export const manager = new WebSocketManager<TClientMsg, TServerMsg>({
	url: "ws://localhost:3001/ws",
	serialize: (msg) => JSON.stringify(msg),
	deserialize: (raw) => JSON.parse(raw) as TServerMsg,
	ping: { action: "ping" },
	isPong: (msg) => msg.action === "pong",

	onSendIntent({ data, ackId }) {
		if (data.action !== "unreliable_message" || !ackId) return;
		useStore.setState((s) => {
			const exists = s.messages.some((m) => m.id === ackId);
			if (exists) {
				return {
					messages: s.messages.map((m) =>
						m.id === ackId ? { ...m, sentAt: Date.now() } : m,
					),
				};
			}
			return {
				messages: [
					...s.messages,
					{ id: ackId, text: data.text, sentAt: Date.now() },
				],
			};
		});
		sync.addMessage(CHANNEL, { id: ackId, text: data.text });
	},

	onMessageReceived(msg) {
		if (msg.action !== "message") return;
		manager.ackInFlight(msg.id);
		sync.removeMessage(CHANNEL, msg.id);
	},
});

// ── Hooks ────────────────────────────────────────────────────────────

function useMessageStatus(
	sentAt: number,
	isUndelivered: boolean,
): TMessageStatus {
	const [timedOut, setTimedOut] = useState(
		() =>
			isUndelivered && (sentAt === 0 || Date.now() - sentAt >= ACK_TIMEOUT_MS),
	);

	useEffect(() => {
		if (!isUndelivered || sentAt === 0) return;
		const remaining = ACK_TIMEOUT_MS - (Date.now() - sentAt);
		if (remaining <= 0) {
			setTimedOut(true);
			return;
		}
		setTimedOut(false);
		const timer = setTimeout(() => setTimedOut(true), remaining);
		return () => clearTimeout(timer);
	}, [isUndelivered, sentAt]);

	if (!isUndelivered) return "delivered";
	if (timedOut) return "retry";
	return "sending";
}

function useChat() {
	const messages = useStore((s) => s.messages);

	const undelivered = useSyncExternalStore(sync.subscribe, () =>
		sync.getChannelMessages(CHANNEL),
	);

	const undeliveredIds = useMemo(
		() => new Set(undelivered.map((m) => m.id)),
		[undelivered],
	);

	const send = useCallback((text: string) => {
		const id = crypto.randomUUID();
		manager.send({
			data: { action: "unreliable_message", id, text },
			ackId: id,
		});
	}, []);

	const retry = useCallback((msg: TDisplayMessage) => {
		manager.send({
			data: { action: "unreliable_message", id: msg.id, text: msg.text },
			ackId: msg.id,
		});
	}, []);

	return { messages, undeliveredIds, send, retry };
}

// ── Components ───────────────────────────────────────────────────────

const STATUS_TEXT_COLOR: Record<TMessageStatus, string> = {
	delivered: "text-zinc-300",
	sending: "text-zinc-400",
	retry: "text-zinc-500",
};

const STATUS_BADGE: Record<
	TMessageStatus,
	{ label: string; color: string } | null
> = {
	delivered: { label: "delivered", color: "text-emerald-500" },
	sending: { label: "sending...", color: "text-amber-400" },
	retry: { label: "failed", color: "text-red-400" },
};

function MessageRow({
	msg,
	isUndelivered,
	onRetry,
}: {
	msg: TDisplayMessage;
	isUndelivered: boolean;
	onRetry: () => void;
}) {
	const status = useMessageStatus(msg.sentAt, isUndelivered);
	const badge = STATUS_BADGE[status];

	return (
		<div className="mb-1.5 flex items-center gap-2 text-sm">
			<span className={STATUS_TEXT_COLOR[status]}>{msg.text}</span>
			<span className="ml-auto flex items-center gap-2">
				{badge && (
					<span className={`text-[10px] ${badge.color}`}>{badge.label}</span>
				)}
				{status === "retry" && (
					<button
						type="button"
						onClick={onRetry}
						className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700"
					>
						retry
					</button>
				)}
			</span>
		</div>
	);
}

function Chat() {
	const [input, setInput] = useState("");
	const connectionState = useConnectionState(manager);
	const { messages, undeliveredIds, send, retry } = useChat();
	const bottomRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages.length]);

	function handleSend() {
		if (!input.trim()) return;
		send(input.trim());
		setInput("");
	}

	return (
		<div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
			<div className="mb-3 flex items-center gap-2">
				<h2 className="text-lg font-semibold text-zinc-100">Messages</h2>
				<span
					className={`text-xs ${connectionState === "connected" ? "text-emerald-500" : "text-red-400"}`}
				>
					{connectionState}
				</span>
			</div>

			<div className="mb-3 min-h-[160px] max-h-[320px] overflow-y-auto rounded bg-zinc-950 p-3">
				{messages.length === 0 && (
					<p className="text-sm text-zinc-600">No messages yet.</p>
				)}
				{messages.map((m) => (
					<MessageRow
						key={m.id}
						msg={m}
						isUndelivered={undeliveredIds.has(m.id)}
						onRetry={() => retry(m)}
					/>
				))}
				<div ref={bottomRef} />
			</div>

			<p className="mb-3 text-xs text-zinc-600">
				Server drops 50% of acks. Unacked messages show "sending…" for{" "}
				{ACK_TIMEOUT_MS / 1000}s then switch to "failed" with retry.
			</p>

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

export function UndeliveredSyncPage() {
	const [ready, setReady] = useState(false);

	useEffect(() => {
		sync.init().then(() => {
			const persisted = sync.getChannelMessages(CHANNEL);
			if (persisted.length > 0) {
				useStore.setState({
					messages: persisted.map((m) => ({ ...m, sentAt: 0 })),
				});
			}
			setReady(true);
			manager.connect();
		});
		return () => manager.disconnect();
	}, []);

	if (!ready) return null;

	return (
		<div className="mx-auto max-w-2xl space-y-6 p-6">
			<div>
				<h1 className="text-2xl font-bold text-zinc-100">
					Undelivered Message Sync
				</h1>
				<p className="mt-1 text-sm text-zinc-500">
					Messages persist in localStorage until the server acknowledges them.
					Refresh the page to see them restored with retry buttons.
				</p>
			</div>

			<Chat />
		</div>
	);
}
