import type { TNotification } from "../src/mini-socket/types";

// ── Bun WebSocket server for mini-socket ────────────────────────────

const PORT = 3002;

type ConnectionState = {
	eventInterval: ReturnType<typeof setInterval> | null;
	counter: number;
};

const connections = new WeakMap<object, ConnectionState>();

const EVENT_PAYLOADS = [
	{ kind: "deploy", service: "api-gateway", version: "3.1.0" },
	{ kind: "alert", severity: "warning", node: "us-east-2" },
	{ kind: "metric", cpu: 72, memory: 58 },
	{ kind: "user_event", action: "signup", email: "alice@example.com" },
	{ kind: "build", pipeline: "#2041", status: "passed" },
	{ kind: "payment", amount: 129.99, currency: "USD" },
];

Bun.serve({
	port: PORT,
	fetch(req, server) {
		const url = new URL(req.url);
		if (url.pathname !== "/ws") {
			return new Response("Not found", { status: 404 });
		}

		// Extract token from Sec-WebSocket-Protocol header
		const protocols = req.headers.get("sec-websocket-protocol");
		let token: string | undefined;
		if (protocols) {
			const parts = protocols.split(",").map((p) => p.trim());
			const tokenIdx = parts.indexOf("access_token");
			if (tokenIdx !== -1 && parts[tokenIdx + 1]) {
				token = parts[tokenIdx + 1];
			}
		}

		console.log(`[connect] token=${token ?? "(none)"}`);

		// Echo back the subprotocols so the browser accepts the connection
		const upgraded = server.upgrade(req, {
			headers: protocols
				? { "Sec-WebSocket-Protocol": protocols }
				: undefined,
		});

		if (!upgraded) {
			return new Response("WebSocket upgrade failed", { status: 400 });
		}
		return undefined;
	},
	websocket: {
		open(ws) {
			const state: ConnectionState = { eventInterval: null, counter: 0 };
			connections.set(ws, state);

			// Stream 1 notification event per second
			state.eventInterval = setInterval(() => {
				const idx = state.counter % EVENT_PAYLOADS.length;
				const notification: TNotification = {
					id: crypto.randomUUID(),
					timestamp: Date.now(),
					payload: EVENT_PAYLOADS[idx],
				};
				ws.send(JSON.stringify(notification));
				state.counter++;
			}, 1000);
		},
		message(ws, raw) {
			const state = connections.get(ws);
			if (!state) return;

			let msg: Record<string, unknown>;
			try {
				msg = JSON.parse(
					typeof raw === "string" ? raw : new TextDecoder().decode(raw),
				) as Record<string, unknown>;
			} catch {
				return;
			}

			// Respond to ping with pong
			if (msg.action === "ping") {
				ws.send(
					JSON.stringify({
						action: "pong",
						timestamp: msg.timestamp,
					}),
				);
			}
		},
		close(ws) {
			const state = connections.get(ws);
			if (!state) return;
			if (state.eventInterval) {
				clearInterval(state.eventInterval);
			}
			connections.delete(ws);
		},
	},
});

console.log(`Mini-socket dev server running on ws://localhost:${PORT}/ws`);
