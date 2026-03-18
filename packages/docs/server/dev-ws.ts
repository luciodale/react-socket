// ── Types matching the minimal example ───────────────────────────────

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
	  }
	| {
			action: "unreliable_message";
			id: string;
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

// ── Message handler ──────────────────────────────────────────────────

function handleMessage(ws: { send: (data: string) => void }, msg: TClientMsg) {
	switch (msg.action) {
		case "ping": {
			const pong: TServerMsg = { action: "pong" };
			ws.send(JSON.stringify(pong));
			break;
		}

		case "subscribe": {
			const ack: TServerMsg = {
				action: "subscribe_ack",
				type: msg.type,
				channel: msg.channel,
			};
			ws.send(JSON.stringify(ack));
			break;
		}

		case "unsubscribe": {
			const ack: TServerMsg = {
				action: "unsubscribe_ack",
				type: msg.type,
				channel: msg.channel,
			};
			ws.send(JSON.stringify(ack));
			break;
		}

		case "message": {
			// Echo the user's message back
			const echo: TServerMsg = {
				action: "message",
				type: "conversation",
				channel: msg.channel,
				id: msg.id,
				sender: "user",
				text: msg.text,
			};
			ws.send(JSON.stringify(echo));

			// Single bot reply after a short delay
			setTimeout(() => {
				const reply: TServerMsg = {
					action: "message",
					type: "conversation",
					channel: msg.channel,
					id: crypto.randomUUID(),
					sender: "bot",
					text: `You said: "${msg.text}"`,
				};
				ws.send(JSON.stringify(reply));
			}, 300);
			break;
		}

		case "unreliable_message": {
			// 50% chance to drop the ack (for undelivered-sync example)
			if (Math.random() < 0.5) {
				console.log(`[drop] ${msg.id} — no ack sent`);
				break;
			}

			ws.send(
				JSON.stringify({ action: "message", id: msg.id, text: msg.text }),
			);
			break;
		}
	}
}

// ── OpenAI Realtime mock ─────────────────────────────────────────────

type TOpenAIClientEvent =
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

const MOCK_REPLIES = [
	"That's an interesting thought! Let me think about that for a moment. I'd say the key insight here is that simplicity often beats complexity.",
	"Great question! From what I understand, the best approach is to start small and iterate. Build something minimal first, then expand based on real feedback.",
	"I appreciate you asking that. There are several ways to look at this problem, but I think the most practical one is to focus on what delivers value soonest.",
	"Hello! I'm a simulated AI assistant. I can respond to your messages with streaming text, just like the real OpenAI Realtime API would.",
];

let replyIndex = 0;

function handleOpenAIMessage(
	ws: { send: (data: string) => void },
	event: TOpenAIClientEvent,
) {
	switch (event.type) {
		case "conversation.item.create": {
			ws.send(
				JSON.stringify({
					type: "conversation.item.created",
					item: { id: event.event_id },
				}),
			);
			break;
		}

		case "response.create": {
			const responseId = crypto.randomUUID();
			const itemId = crypto.randomUUID();
			const reply = MOCK_REPLIES[replyIndex % MOCK_REPLIES.length];
			replyIndex++;

			const words = reply.split(" ");
			let accumulated = "";

			for (let i = 0; i < words.length; i++) {
				const chunk = (i > 0 ? " " : "") + words[i];

				setTimeout(
					() => {
						accumulated += chunk;
						ws.send(
							JSON.stringify({
								type: "response.text.delta",
								response_id: responseId,
								item_id: itemId,
								delta: chunk,
							}),
						);

						if (i === words.length - 1) {
							ws.send(
								JSON.stringify({
									type: "response.text.done",
									response_id: responseId,
									item_id: itemId,
									text: accumulated,
								}),
							);
							ws.send(
								JSON.stringify({
									type: "response.done",
									response: { id: responseId, status: "completed" },
								}),
							);
						}
					},
					(i + 1) * 40,
				);
			}
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
		if (url.pathname === "/ws" || url.pathname === "/ws/openai") {
			const upgraded = server.upgrade(req, { data: { path: url.pathname } });
			if (!upgraded) {
				return new Response("WebSocket upgrade failed", { status: 400 });
			}
			return undefined;
		}
		return new Response("Not found", { status: 404 });
	},
	websocket: {
		open(ws) {
			const { path } = ws.data as { path: string };
			if (path === "/ws/openai") {
				ws.send(
					JSON.stringify({
						type: "session.created",
						session: { id: crypto.randomUUID() },
					}),
				);
			}
		},
		message(ws, raw) {
			const { path } = ws.data as { path: string };
			const str = typeof raw === "string" ? raw : new TextDecoder().decode(raw);

			let parsed: Record<string, unknown>;
			try {
				parsed = JSON.parse(str) as Record<string, unknown>;
			} catch {
				return;
			}

			if (path === "/ws/openai") {
				handleOpenAIMessage(
					{ send: (data: string) => ws.send(data) },
					parsed as TOpenAIClientEvent,
				);
			} else {
				handleMessage(
					{ send: (data: string) => ws.send(data) },
					parsed as TClientMsg,
				);
			}
		},
	},
});

console.log(`WebSocket dev server running on ws://localhost:${PORT}/ws`);
