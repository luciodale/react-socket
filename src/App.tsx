import { useState } from "react";
import "./App.css";
import { SocketInspector } from "./inspector/socket-inspector";
import {
	ConnectionStatus,
	useSubConversation,
	useSubNotification,
	type TClientConversationMessage,
} from "./socket/index";

// ── Message row ──────────────────────────────────────────────────────

const STATUS_COLORS: Record<TClientConversationMessage["status"], string> = {
	pending: "#888",
	sent: "#ccc",
	failed: "#f87171",
};

function MessageRow({
	msg,
	onRetry,
}: {
	msg: TClientConversationMessage;
	onRetry: (id: string) => void;
}) {
	return (
		<div
			style={{
				marginBottom: 4,
				color: STATUS_COLORS[msg.status],
				display: "flex",
				alignItems: "baseline",
				gap: 6,
			}}
		>
			<span>
				<strong>{msg.sender}:</strong>{" "}
				{msg.content.map((c) => c.text).join(" ")}
			</span>
			{msg.status === "pending" && (
				<span style={{ fontSize: 10, color: "#888" }}>sending...</span>
			)}
			{msg.status === "failed" && (
				<button
					type="button"
					onClick={() => onRetry(msg.id)}
					style={{
						fontSize: 10,
						padding: "1px 6px",
						background: "#7f1d1d",
						color: "#fca5a5",
						border: "1px solid #991b1b",
						borderRadius: 3,
						cursor: "pointer",
					}}
				>
					retry
				</button>
			)}
		</div>
	);
}

// ── ChatPanel: sends messages + displays them ────────────────────────

function ChatPanel({ chatId }: { chatId: string }) {
	const [input, setInput] = useState("");
	const {
		messages,
		sendMessage,
		retryMessage,
		retryAll,
		isSubscribed,
		connectionState,
	} = useSubConversation({ chatId });

	const hasFailed = messages.some((m) => m.status === "failed");

	function handleSend() {
		if (!input.trim()) return;
		sendMessage(input.trim());
		setInput("");
	}

	return (
		<div style={{ border: "1px solid #555", borderRadius: 8, padding: 16 }}>
			<h3 style={{ margin: "0 0 8px" }}>
				ChatPanel — {chatId}
				<span style={{ fontSize: 12, marginLeft: 8, color: "#888" }}>
					{connectionState} {isSubscribed && "(subscribed)"}
				</span>
			</h3>

			<div
				style={{
					minHeight: 120,
					maxHeight: 250,
					overflowY: "auto",
					marginBottom: 8,
					padding: 8,
					background: "#1a1a1a",
					borderRadius: 4,
				}}
			>
				{messages.length === 0 && (
					<p style={{ color: "#666" }}>No messages yet.</p>
				)}
				{messages.map((msg) => (
					<MessageRow key={msg.id} msg={msg} onRetry={retryMessage} />
				))}
			</div>

			{hasFailed && (
				<button
					type="button"
					onClick={retryAll}
					style={{
						fontSize: 11,
						padding: "4px 10px",
						marginBottom: 8,
						background: "#7f1d1d",
						color: "#fca5a5",
						border: "1px solid #991b1b",
						borderRadius: 4,
						cursor: "pointer",
					}}
				>
					Retry all failed
				</button>
			)}

			<div style={{ display: "flex", gap: 8 }}>
				<input
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && handleSend()}
					placeholder="Type a message..."
					style={{ flex: 1, padding: 8 }}
				/>
				<button
					type="button"
					onClick={handleSend}
					style={{ padding: "8px 16px" }}
				>
					Send
				</button>
			</div>
		</div>
	);
}

// ── MessageList: read-only view using the SAME hook ──────────────────

function MessageList({ chatId }: { chatId: string }) {
	const { messages, isSubscribed, retryMessage } = useSubConversation({
		chatId,
	});

	return (
		<div style={{ border: "1px solid #555", borderRadius: 8, padding: 16 }}>
			<h3 style={{ margin: "0 0 8px" }}>
				MessageList — {chatId}
				<span style={{ fontSize: 12, marginLeft: 8, color: "#888" }}>
					{isSubscribed ? "subscribed" : "not subscribed"}
				</span>
			</h3>

			<div
				style={{
					minHeight: 120,
					maxHeight: 250,
					overflowY: "auto",
					padding: 8,
					background: "#1a1a1a",
					borderRadius: 4,
				}}
			>
				{messages.length === 0 && (
					<p style={{ color: "#666" }}>No messages yet.</p>
				)}
				{messages.map((msg) => (
					<MessageRow key={msg.id} msg={msg} onRetry={retryMessage} />
				))}
			</div>
			<p style={{ fontSize: 11, color: "#666", marginTop: 8 }}>
				Read-only mirror — same hook, same data, no extra subscription
			</p>
		</div>
	);
}

// ── NotificationPanel ────────────────────────────────────────────────

function NotificationPanel({ channel }: { channel: string }) {
	const { notifications, isSubscribed, connectionState } = useSubNotification({
		channel,
	});

	return (
		<div style={{ border: "1px solid #555", borderRadius: 8, padding: 16 }}>
			<h3 style={{ margin: "0 0 8px" }}>
				Notifications — {channel}
				<span style={{ fontSize: 12, marginLeft: 8, color: "#888" }}>
					{connectionState} {isSubscribed && "(subscribed)"}
				</span>
			</h3>

			<div
				style={{
					minHeight: 120,
					maxHeight: 250,
					overflowY: "auto",
					padding: 8,
					background: "#1a1a1a",
					borderRadius: 4,
				}}
			>
				{notifications.length === 0 && (
					<p style={{ color: "#666" }}>No notifications yet.</p>
				)}
				{notifications.map((n) => (
					<div
						key={n.id}
						style={{
							marginBottom: 6,
							padding: "4px 8px",
							background: "#262626",
							borderRadius: 4,
						}}
					>
						<strong>{n.title}</strong>
						<p style={{ margin: "2px 0 0", color: "#aaa", fontSize: 13 }}>
							{n.body}
						</p>
						<span style={{ fontSize: 10, color: "#666" }}>
							{new Date(n.timestamp).toLocaleTimeString()}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

// ── App ──────────────────────────────────────────────────────────────

export function App() {
	const [chatId, setChatId] = useState("demo-channel");

	return (
		<>
			<ConnectionStatus />
			<div style={{ maxWidth: 900, margin: "0 auto", padding: 20 }}>
				<h1>WebSocket Demo</h1>

				<div style={{ marginBottom: 16 }}>
					<label>
						Channel:{" "}
						<input
							value={chatId}
							onChange={(e) => setChatId(e.target.value)}
							style={{ padding: 4 }}
						/>
					</label>
				</div>

				<div
					style={{
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
						gap: 16,
						marginBottom: 24,
					}}
				>
					<ChatPanel chatId={chatId} />
					<MessageList chatId={chatId} />
				</div>

				<div style={{ marginBottom: 24 }}>
					<NotificationPanel channel="alerts" />
				</div>

				<SocketInspector />
			</div>
		</>
	);
}
