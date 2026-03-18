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
		message(ws, raw) {
			let msg: TClientMsg;
			try {
				msg = JSON.parse(
					typeof raw === "string" ? raw : new TextDecoder().decode(raw),
				) as TClientMsg;
			} catch {
				return;
			}

			handleMessage({ send: (data: string) => ws.send(data) }, msg);
		},
	},
});

console.log(`WebSocket dev server running on ws://localhost:${PORT}/ws`);
