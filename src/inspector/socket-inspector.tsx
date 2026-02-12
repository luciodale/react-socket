import { useEffect, useState } from "react";
import { QUEUE_STORAGE_KEY } from "../socket/constants";
import { useWebSocketManager } from "../socket/index";
import { useSocketStore } from "../socket/store";
import type {
	TQueuedMessage,
	TSocketMessageFromClientToServer,
} from "../socket/types";

// ── Helpers ──────────────────────────────────────────────────────────

function JsonBlock({ data }: { data: unknown }) {
	return (
		<pre
			style={{
				background: "#111",
				padding: 8,
				borderRadius: 4,
				fontSize: 11,
				overflowX: "auto",
				maxHeight: 300,
				overflowY: "auto",
				margin: 0,
				whiteSpace: "pre-wrap",
				wordBreak: "break-all",
			}}
		>
			{JSON.stringify(data, null, 2)}
		</pre>
	);
}

function Section({
	title,
	children,
	defaultOpen = true,
}: {
	title: string;
	children: React.ReactNode;
	defaultOpen?: boolean;
}) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<div style={{ marginBottom: 12 }}>
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				style={{
					background: "none",
					border: "none",
					color: "#aaa",
					cursor: "pointer",
					fontSize: 13,
					fontWeight: "bold",
					padding: "4px 0",
					textAlign: "left",
					width: "100%",
				}}
			>
				{open ? "▼" : "▶"} {title}
			</button>
			{open && <div style={{ paddingLeft: 12 }}>{children}</div>}
		</div>
	);
}

// ── Queue reader (localStorage) ──────────────────────────────────────

function useLocalStorageQueue(): TQueuedMessage[] {
	const [queue, setQueue] = useState<TQueuedMessage[]>([]);

	useEffect(() => {
		function read() {
			try {
				const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
				if (!raw) {
					setQueue([]);
					return;
				}
				const parsed: unknown = JSON.parse(raw);
				setQueue(Array.isArray(parsed) ? (parsed as TQueuedMessage[]) : []);
			} catch {
				setQueue([]);
			}
		}

		read();
		const id = setInterval(read, 1000);
		return () => clearInterval(id);
	}, []);

	return queue;
}

// ── Pending subscriptions reader (manager) ───────────────────────────

function usePendingSubscriptions(): string[] {
	const manager = useWebSocketManager();
	const [pending, setPending] = useState<string[]>([]);

	useEffect(() => {
		function read() {
			setPending([...manager.getPendingSubscriptions()]);
		}

		read();
		const id = setInterval(read, 500);
		return () => clearInterval(id);
	}, [manager]);

	return pending;
}

// ── In-flight messages reader (manager) ──────────────────────────────

function useInFlightMessages(): Array<
	[string, TSocketMessageFromClientToServer]
> {
	const manager = useWebSocketManager();
	const [entries, setEntries] = useState<
		Array<[string, TSocketMessageFromClientToServer]>
	>([]);

	useEffect(() => {
		function read() {
			setEntries([...manager.getInFlightMessages()]);
		}

		read();
		const id = setInterval(read, 500);
		return () => clearInterval(id);
	}, [manager]);

	return entries;
}

// ── Inspector ────────────────────────────────────────────────────────

export function SocketInspector() {
	const connectionState = useSocketStore((s) => s.connectionState);
	const hasConnected = useSocketStore((s) => s.hasConnected);
	const conversationMessages = useSocketStore((s) => s.conversationMessages);
	const subscriptionRefCounts = useSocketStore((s) => s.subscriptionRefCounts);
	const pendingQueueLength = useSocketStore((s) => s.pendingQueueLength);
	const lastError = useSocketStore((s) => s.lastError);
	const localQueue = useLocalStorageQueue();
	const pendingSubscriptions = usePendingSubscriptions();
	const inFlightMessages = useInFlightMessages();

	const channels = Object.keys(conversationMessages);
	const totalMessages = Object.values(conversationMessages).reduce(
		(sum, msgs) => sum + msgs.length,
		0,
	);

	return (
		<div
			style={{
				border: "1px solid #444",
				borderRadius: 8,
				padding: 16,
				background: "#0d0d0d",
				fontFamily: "monospace",
				fontSize: 12,
				color: "#ccc",
			}}
		>
			<h3 style={{ margin: "0 0 12px", color: "#fff" }}>
				Socket Inspector
			</h3>

			{/* ── Connection ──────────────────────────────────────── */}
			<Section title="Connection">
				<table style={{ borderCollapse: "collapse" }}>
					<tbody>
						<tr>
							<td style={{ paddingRight: 16, color: "#888" }}>state</td>
							<td>
								<strong
									style={{
										color:
											connectionState === "connected"
												? "#4ade80"
												: connectionState === "reconnecting"
													? "#facc15"
													: "#f87171",
									}}
								>
									{connectionState}
								</strong>
							</td>
						</tr>
						<tr>
							<td style={{ paddingRight: 16, color: "#888" }}>hasConnected</td>
							<td>{String(hasConnected)}</td>
						</tr>
					</tbody>
				</table>
			</Section>

			{/* ── Subscriptions ────────────────────────────────────── */}
			<Section title={`Subscriptions (${Object.keys(subscriptionRefCounts).length})`}>
				{Object.keys(subscriptionRefCounts).length === 0 ? (
					<p style={{ color: "#666", margin: 0 }}>No active subscriptions</p>
				) : (
					<table style={{ borderCollapse: "collapse", width: "100%" }}>
						<thead>
							<tr style={{ color: "#888" }}>
								<th style={{ textAlign: "left", paddingRight: 16 }}>key</th>
								<th style={{ textAlign: "right" }}>refCount</th>
							</tr>
						</thead>
						<tbody>
							{Object.entries(subscriptionRefCounts).map(([key, count]) => (
								<tr key={key}>
									<td style={{ paddingRight: 16 }}>{key}</td>
									<td style={{ textAlign: "right" }}>
										<strong
											style={{
												color: count > 1 ? "#facc15" : "#4ade80",
											}}
										>
											{count}
										</strong>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</Section>

			{/* ── Pending subscriptions (manager) ─────────────────── */}
			<Section title={`Pending Subscriptions (${pendingSubscriptions.length})`}>
				{pendingSubscriptions.length === 0 ? (
					<p style={{ color: "#666", margin: 0 }}>
						No pending subscribe acks
					</p>
				) : (
					<ul style={{ margin: 0, paddingLeft: 16 }}>
						{pendingSubscriptions.map((key) => (
							<li key={key} style={{ color: "#facc15" }}>
								{key}
							</li>
						))}
					</ul>
				)}
			</Section>

			{/* ── Messages in memory ──────────────────────────────── */}
			<Section
				title={`Messages in Memory (${totalMessages} across ${channels.length} channels)`}
			>
				{channels.length === 0 ? (
					<p style={{ color: "#666", margin: 0 }}>No messages in store</p>
				) : (
					channels.map((channel) => (
						<Section
							key={channel}
							title={`#${channel} (${conversationMessages[channel].length})`}
							defaultOpen={false}
						>
							<JsonBlock data={conversationMessages[channel]} />
						</Section>
					))
				)}
			</Section>

			{/* ── Outgoing queue ───────────────────────────────────── */}
			<Section title={`Outgoing Queue — Store (${pendingQueueLength})`}>
				<p style={{ color: "#888", margin: 0 }}>
					pendingQueueLength: {pendingQueueLength}
				</p>
			</Section>

			<Section title={`Outgoing Queue — localStorage (${localQueue.length})`}>
				{localQueue.length === 0 ? (
					<p style={{ color: "#666", margin: 0 }}>Queue empty</p>
				) : (
					<JsonBlock data={localQueue} />
				)}
			</Section>

			{/* ── In-flight messages ──────────────────────────────── */}
			<Section title={`In-Flight Messages (${inFlightMessages.length})`}>
				{inFlightMessages.length === 0 ? (
					<p style={{ color: "#666", margin: 0 }}>
						No messages awaiting server ack
					</p>
				) : (
					<JsonBlock
						data={Object.fromEntries(
							inFlightMessages.map(([id, msg]) => [id, msg]),
						)}
					/>
				)}
			</Section>

			{/* ── Last error ───────────────────────────────────────── */}
			<Section title="Last Error">
				{lastError ? (
					<JsonBlock data={lastError} />
				) : (
					<p style={{ color: "#666", margin: 0 }}>No errors</p>
				)}
			</Section>
		</div>
	);
}
