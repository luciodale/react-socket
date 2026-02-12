import type {
	TConversationContentBlock,
	TNotificationEventFromServer,
	TSocketMessageFromClientToServer,
	TSocketMessageFromServerToClient,
	TStoredConversationMessage,
} from "../src/socket/types";

// ── Per-connection state ─────────────────────────────────────────────

type ConnectionState = {
	notificationIntervals: Map<string, ReturnType<typeof setInterval>>;
};

const connections = new WeakMap<object, ConnectionState>();

// ── Shared state ─────────────────────────────────────────────────────

const channelHistory = new Map<string, TStoredConversationMessage[]>();
const failedMessageIds = new Set<string>();

// ── Notification simulation data ─────────────────────────────────────

const NOTIFICATION_TITLES = [
	"New deployment",
	"Build succeeded",
	"User signed up",
	"Payment received",
	"Alert triggered",
	"Task completed",
];

const NOTIFICATION_BODIES = [
	"Production v2.4.1 is live.",
	"Pipeline #1087 passed all checks.",
	"jane.doe@example.com joined.",
	"Invoice #4821 — $49.00 charged.",
	"CPU usage exceeded 90% on node-3.",
	"Ticket PROJ-312 marked as done.",
];

// ── AI agent simulation data ─────────────────────────────────────────

type TAgentStep = {
	delayMs: number;
	sender: string;
	content: TConversationContentBlock[];
};

function buildAgentSteps(userMessage: string): TAgentStep[] {
	return [
		{
			delayMs: 300,
			sender: "agent",
			content: [{ type: "text", text: "Thinking..." }],
		},
		{
			delayMs: 800,
			sender: "agent",
			content: [
				{
					type: "text",
					text: `Analyzing: "${userMessage}"`,
				},
			],
		},
		{
			delayMs: 600,
			sender: "agent",
			content: [
				{
					type: "text",
					text: "I've considered multiple approaches.",
				},
			],
		},
		{
			delayMs: 400,
			sender: "agent",
			content: [
				{
					type: "text",
					text: `Here's my final answer regarding "${userMessage}": The operation completed successfully.`,
				},
			],
		},
	];
}

function sendAgentSteps(
	ws: { send: (data: string) => void },
	channel: string,
	steps: TAgentStep[],
	history: TStoredConversationMessage[],
) {
	let cumulativeDelay = 0;

	for (const step of steps) {
		cumulativeDelay += step.delayMs;

		setTimeout(() => {
			const id = crypto.randomUUID();

			const event: TSocketMessageFromServerToClient = {
				action: "message",
				type: "conversation",
				delivery: "event",
				id,
				channel,
				sender: step.sender,
				content: step.content,
			};

			const stored: TStoredConversationMessage = {
				id,
				sender: step.sender,
				content: step.content,
			};
			history.push(stored);

			ws.send(JSON.stringify(event));
		}, cumulativeDelay);
	}
}

// ── Message handler ──────────────────────────────────────────────────

function handleMessage(
	ws: { send: (data: string) => void },
	state: ConnectionState,
	msg: TSocketMessageFromClientToServer,
) {
	switch (msg.action) {
		case "ping": {
			const pong: TSocketMessageFromServerToClient = {
				action: "pong",
				timestamp: msg.timestamp,
			};
			ws.send(JSON.stringify(pong));
			break;
		}

		case "subscribe": {
			const ack: TSocketMessageFromServerToClient = {
				action: "subscribe_ack",
				type: msg.type,
				channel: msg.channel,
			};
			ws.send(JSON.stringify(ack));

			if (msg.type === "conversation") {
				const history = channelHistory.get(msg.channel) ?? [];
				const dump: TSocketMessageFromServerToClient = {
					action: "message",
					type: "conversation",
					delivery: "dump",
					channel: msg.channel,
					messages: history,
				};
				ws.send(JSON.stringify(dump));
			} else if (msg.type === "notification") {
				const dump: TSocketMessageFromServerToClient = {
					action: "message",
					type: "notification",
					delivery: "dump",
					channel: msg.channel,
					notifications: [],
				};
				ws.send(JSON.stringify(dump));

				let counter = 0;
				const intervalId = setInterval(() => {
					const idx = counter % NOTIFICATION_TITLES.length;
					const notif: TNotificationEventFromServer = {
						action: "message",
						type: "notification",
						delivery: "event",
						id: crypto.randomUUID(),
						channel: msg.channel,
						title: NOTIFICATION_TITLES[idx],
						body: NOTIFICATION_BODIES[idx],
						timestamp: new Date().toISOString(),
					};
					ws.send(JSON.stringify(notif));
					counter++;
				}, 1000);

				state.notificationIntervals.set(msg.channel, intervalId);
			}
			break;
		}

		case "unsubscribe": {
			const ack: TSocketMessageFromServerToClient = {
				action: "unsubscribe_ack",
				type: msg.type,
				channel: msg.channel,
			};
			ws.send(JSON.stringify(ack));

			if (msg.type === "notification") {
				const intervalId = state.notificationIntervals.get(msg.channel);
				if (intervalId) {
					clearInterval(intervalId);
					state.notificationIntervals.delete(msg.channel);
				}
			}
			break;
		}

		case "message": {
			if (msg.message === "403" && !failedMessageIds.has(msg.id)) {
				failedMessageIds.add(msg.id);
				const error: TSocketMessageFromServerToClient = {
					action: "message",
					type: "conversation",
					delivery: "error",
					channel: msg.channel,
					error: "token_expired",
					message: "Session token has expired. Please re-authenticate.",
					messageId: msg.id,
				};
				ws.send(JSON.stringify(error));
				break;
			}
			failedMessageIds.delete(msg.id);

			const history = channelHistory.get(msg.channel) ?? [];
			channelHistory.set(msg.channel, history);

			const userStored: TStoredConversationMessage = {
				id: msg.id,
				sender: "user",
				content: [{ type: "text", text: msg.message }],
			};
			history.push(userStored);

			const echo: TSocketMessageFromServerToClient = {
				action: "message",
				type: "conversation",
				delivery: "event",
				id: msg.id,
				channel: msg.channel,
				sender: "user",
				content: [{ type: "text", text: msg.message }],
			};
			ws.send(JSON.stringify(echo));

			const steps = buildAgentSteps(msg.message);
			sendAgentSteps(ws, msg.channel, steps, history);
			break;
		}
	}
}

// ── Bun WebSocket server ─────────────────────────────────────────────

const PORT = 3001;

Bun.serve({
	port: PORT,
	fetch(req, server) {
		const url = new URL(req.url);
		if (url.pathname === "/ws") {
			const upgraded = server.upgrade(req);
			if (!upgraded) {
				return new Response("WebSocket upgrade failed", { status: 400 });
			}
			return undefined;
		}
		return new Response("Not found", { status: 404 });
	},
	websocket: {
		open(ws) {
			const state: ConnectionState = {
				notificationIntervals: new Map(),
			};
			connections.set(ws, state);
		},
		message(ws, raw) {
			const state = connections.get(ws);
			if (!state) return;

			let msg: TSocketMessageFromClientToServer;
			try {
				msg = JSON.parse(
					typeof raw === "string" ? raw : new TextDecoder().decode(raw),
				) as TSocketMessageFromClientToServer;
			} catch {
				return;
			}

			handleMessage(
				{ send: (data: string) => ws.send(data) },
				state,
				msg,
			);
		},
		close(ws) {
			const state = connections.get(ws);
			if (!state) return;

			for (const [, intervalId] of state.notificationIntervals) {
				clearInterval(intervalId);
			}
			state.notificationIntervals.clear();
			connections.delete(ws);
		},
	},
});

console.log(`WebSocket dev server running on ws://localhost:${PORT}/ws`);
