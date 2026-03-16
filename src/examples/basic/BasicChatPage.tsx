import { useState } from "react";
import { useAuth } from "../shared/hooks/use-auth";
import { chatSocket } from "../shared/socket";
import type { TChatMessage } from "../shared/types";
import { useBasicChat } from "./hooks/use-basic-chat";

// ── Message bubble ──────────────────────────────────────────────────

const STATUS_STYLES: Record<TChatMessage["status"], string> = {
	pending: "text-zinc-500",
	sent: "text-zinc-200",
	undelivered: "text-red-400",
};

function MessageBubble({ msg }: { msg: TChatMessage }) {
	const text = msg.content.map((c) => c.text).join(" ");

	return (
		<div className={`mb-1 flex items-baseline gap-2 ${STATUS_STYLES[msg.status]}`}>
			<span>
				<span className="font-semibold">{msg.sender}:</span> {text}
			</span>
			{msg.status === "pending" && (
				<span className="text-[10px] text-zinc-500">sending...</span>
			)}
			{msg.status === "undelivered" && (
				<span className="text-[10px] text-red-400">failed</span>
			)}
		</div>
	);
}

// ── Chat panel ──────────────────────────────────────────────────────

function ChatPanel({ chatId }: { chatId: string }) {
	const [input, setInput] = useState("");
	const { messages, sendMessage, isSubscribed, connectionState } =
		useBasicChat(chatId);

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

			<div className="mb-3 min-h-[140px] max-h-[300px] overflow-y-auto rounded bg-zinc-950 p-3">
				{messages.length === 0 && (
					<p className="text-sm text-zinc-600">No messages yet.</p>
				)}
				{messages.map((msg) => (
					<MessageBubble key={msg.id} msg={msg} />
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

export function BasicChatPage() {
	const { token } = useAuth();
	const [chatId, setChatId] = useState("general");

	return (
		<chatSocket.Provider url="ws://localhost:3001/ws" token={token}>
			<chatSocket.ConnectionStatus />

			<div className="mx-auto max-w-2xl space-y-6 p-6">
				<div>
					<h1 className="text-2xl font-bold text-zinc-100">
						Basic Chat
					</h1>
					<p className="mt-1 text-sm text-zinc-500">
						Simple send/receive with token-based auth via WebSocket
						sub-protocol.
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

				<ChatPanel chatId={chatId} />
			</div>
		</chatSocket.Provider>
	);
}
