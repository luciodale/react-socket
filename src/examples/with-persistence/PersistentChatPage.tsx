import { useState } from "react";
import { useAuth } from "../shared/hooks/use-auth";
import { chatSocket } from "../shared/socket";
import type { TChatMessage } from "../shared/types";
import { usePersistentChat } from "./hooks/use-persistent-chat";

// ── Message bubble ──────────────────────────────────────────────────

const STATUS_STYLES: Record<TChatMessage["status"], string> = {
	pending: "text-zinc-500",
	sent: "text-zinc-200",
	undelivered: "text-red-400",
};

function MessageBubble({
	msg,
	onRetry,
	onDiscard,
}: {
	msg: TChatMessage;
	onRetry: (id: string) => void;
	onDiscard: (id: string) => void;
}) {
	const text = msg.content.map((c) => c.text).join(" ");

	return (
		<div className={`mb-1.5 flex items-baseline gap-2 ${STATUS_STYLES[msg.status]}`}>
			<span>
				<span className="font-semibold">{msg.sender}:</span> {text}
			</span>

			{msg.status === "pending" && (
				<span className="text-[10px] text-zinc-500">sending...</span>
			)}

			{msg.status === "undelivered" && (
				<span className="flex gap-1">
					<button
						type="button"
						onClick={() => onRetry(msg.id)}
						className="rounded border border-red-800 bg-red-950 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-900"
					>
						retry
					</button>
					<button
						type="button"
						onClick={() => onDiscard(msg.id)}
						className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700"
					>
						discard
					</button>
				</span>
			)}
		</div>
	);
}

// ── Undelivered summary bar ─────────────────────────────────────────

function UndeliveredBar({
	count,
	onRetryAll,
	onDiscardAll,
}: {
	count: number;
	onRetryAll: () => void;
	onDiscardAll: () => void;
}) {
	if (count === 0) return null;

	return (
		<div className="mb-3 flex items-center justify-between rounded border border-red-800 bg-red-950/50 px-3 py-2">
			<span className="text-xs text-red-300">
				{count} undelivered message{count > 1 ? "s" : ""} (persisted via
				zustand)
			</span>
			<span className="flex gap-2">
				<button
					type="button"
					onClick={onRetryAll}
					className="rounded bg-red-800 px-2.5 py-1 text-[11px] font-medium text-red-100 hover:bg-red-700"
				>
					Retry all
				</button>
				<button
					type="button"
					onClick={onDiscardAll}
					className="rounded bg-zinc-700 px-2.5 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-600"
				>
					Discard all
				</button>
			</span>
		</div>
	);
}

// ── Chat panel ──────────────────────────────────────────────────────

function PersistentChatPanel({ chatId }: { chatId: string }) {
	const [input, setInput] = useState("");
	const {
		messages,
		sendMessage,
		undelivered,
		retryUndelivered,
		retryAllUndelivered,
		discardUndelivered,
		discardAllUndelivered,
		isSubscribed,
		connectionState,
	} = usePersistentChat(chatId);

	function handleSend() {
		if (!input.trim()) return;
		sendMessage(input.trim());
		setInput("");
	}

	return (
		<div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
			<div className="mb-3 flex items-center gap-2">
				<h2 className="text-lg font-semibold text-zinc-100">
					Chat — {chatId}
				</h2>
				<span className="text-xs text-zinc-500">
					{connectionState} {isSubscribed && "· subscribed"}
				</span>
			</div>

			<UndeliveredBar
				count={undelivered.length}
				onRetryAll={retryAllUndelivered}
				onDiscardAll={discardAllUndelivered}
			/>

			<div className="mb-3 min-h-[140px] max-h-[300px] overflow-y-auto rounded bg-zinc-950 p-3">
				{messages.length === 0 && (
					<p className="text-sm text-zinc-600">No messages yet.</p>
				)}
				{messages.map((msg) => (
					<MessageBubble
						key={msg.id}
						msg={msg}
						onRetry={retryUndelivered}
						onDiscard={discardUndelivered}
					/>
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

export function PersistentChatPage() {
	const { token } = useAuth();
	const [chatId, setChatId] = useState("general");

	return (
		<chatSocket.Provider url="ws://localhost:3001/ws" token={token}>
			<chatSocket.ConnectionStatus />

			<div className="mx-auto max-w-2xl space-y-6 p-6">
				<div>
					<h1 className="text-2xl font-bold text-zinc-100">
						Persistent Chat
					</h1>
					<p className="mt-1 text-sm text-zinc-500">
						Undelivered messages are persisted via a zustand store
						with the persist middleware. Refresh the page — they
						survive.
					</p>
				</div>

				<div className="flex items-center gap-3">
					<label className="text-sm text-zinc-400">Channel</label>
					<input
						value={chatId}
						onChange={(e) => setChatId(e.target.value)}
						className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
					/>
				</div>

				<PersistentChatPanel chatId={chatId} />

				<div className="rounded border border-zinc-800 bg-zinc-900/50 p-4 text-xs text-zinc-500 space-y-1">
					<p className="font-medium text-zinc-400">
						How persistence works
					</p>
					<p>
						1. A separate zustand store with the{" "}
						<code className="text-zinc-300">persist</code>{" "}
						middleware tracks undelivered messages
					</p>
					<p>
						2. On mount, persisted messages hydrate back into the
						socket store
					</p>
					<p>
						3. Store changes sync automatically to localStorage
					</p>
					<p>
						4. Retry or discard updates both stores atomically
					</p>
				</div>
			</div>
		</chatSocket.Provider>
	);
}
