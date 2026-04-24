// ── Types ────────────────────────────────────────────────────────────

type TClientMsg =
	| { type: "ping" }
	| { type: "echo"; text: string }
	| { type: "subscribe"; channel: string }
	| { type: "unsubscribe"; channel: string }
	| { type: "message"; id: string; channel: string; text: string }
	| { type: "ask"; id: string; prompt: string }
	| { type: "invalidate-token" }
	| { type: "auth"; token: string }
	| { type: "simulate-session-expiry" }
	| { type: "subscribe-notifications" }
	| { type: "unsubscribe-notifications" };

type TServerMsg =
	| { type: "pong" }
	| { type: "echo"; text: string }
	| { type: "subscribe-ack"; channel: string }
	| { type: "unsubscribe-ack"; channel: string }
	| { type: "delivered"; ackId: string }
	| {
			type: "chat";
			id: string;
			channel: string;
			sender: string;
			text: string;
	  }
	| { type: "stream-start"; id: string; role: "assistant" }
	| { type: "stream-delta"; id: string; delta: string }
	| { type: "stream-end"; id: string }
	| { type: "hello"; token: string }
	| { type: "unauthorized"; reason: string }
	| { type: "auth-required" }
	| { type: "auth-expired" }
	| { type: "auth-ok"; userId: string }
	| { type: "notification"; id: string; title: string; body: string };

// ── Message handler ─────────────────────────────────────────────────

function handleMessage(ws: { send: (data: string) => void }, msg: TClientMsg) {
	const send = (data: TServerMsg) => ws.send(JSON.stringify(data));

	switch (msg.type) {
		case "ping":
			send({ type: "pong" });
			break;

		case "echo":
			send({ type: "echo", text: msg.text });
			break;

		case "subscribe":
			send({ type: "subscribe-ack", channel: msg.channel });
			break;

		case "unsubscribe":
			send({ type: "unsubscribe-ack", channel: msg.channel });
			break;

		case "message": {
			// Echo the user's message back (confirms delivery via ack)
			send({ type: "delivered", ackId: msg.id });
			send({
				type: "chat",
				id: msg.id,
				channel: msg.channel,
				sender: "you",
				text: msg.text,
			});

			// Bot reply after a short delay
			setTimeout(() => {
				send({
					type: "chat",
					id: crypto.randomUUID(),
					channel: msg.channel,
					sender: "bot",
					text: `You said: "${msg.text}"`,
				});
			}, 300);
			break;
		}

		case "ask": {
			streamFakeResponse(send, msg.id, msg.prompt);
			break;
		}

		case "invalidate-token": {
			send({ type: "unauthorized", reason: "token expired" });
			break;
		}

		case "auth": {
			if (!msg.token || msg.token.startsWith("bad-")) {
				send({ type: "unauthorized", reason: "invalid token" });
				break;
			}
			send({ type: "auth-ok", userId: `user-${msg.token.slice(-4)}` });
			break;
		}

		case "simulate-session-expiry": {
			send({ type: "auth-expired" });
			break;
		}
	}
}

// ── Fake LLM streaming ──────────────────────────────────────────────

function buildResponse(prompt: string): string {
	const trimmed = prompt.trim() || "hello";
	return `I read your prompt: "${trimmed}". Here is a fake streamed response that arrives word by word so you can watch the tokens accumulate in the UI. This is rendered by a separate streaming buffer while the history stays still behind it.`;
}

function streamFakeResponse(
	send: (data: TServerMsg) => void,
	id: string,
	prompt: string,
) {
	send({ type: "stream-start", id, role: "assistant" });

	const tokens = buildResponse(prompt).split(/(\s+)/).filter(Boolean);
	let i = 0;

	function next() {
		if (i >= tokens.length) {
			send({ type: "stream-end", id });
			return;
		}
		send({ type: "stream-delta", id, delta: tokens[i] });
		i++;
		setTimeout(next, 40 + Math.random() * 80);
	}

	setTimeout(next, 150);
}

// ── Notifications: timed pushes to subscribed clients ──────────────

type TNotifHandle = { stop: () => void };

const NOTIFICATION_TITLES = [
	"New activity",
	"Mention",
	"Build finished",
	"PR review requested",
	"Deploy succeeded",
];

function startNotifications(send: (msg: TServerMsg) => void): TNotifHandle {
	let i = 0;
	const interval = setInterval(() => {
		const title =
			NOTIFICATION_TITLES[i % NOTIFICATION_TITLES.length] ?? "Notification";
		send({
			type: "notification",
			id: crypto.randomUUID(),
			title,
			body: `Pushed by the notifications connection (#${i + 1})`,
		});
		i += 1;
	}, 4000);
	return {
		stop: () => clearInterval(interval),
	};
}

// ── Bun WebSocket server ────────────────────────────────────────────

const PORT = 3001;

type TWsData = {
	token: string | null;
	notifs: TNotifHandle | null;
};

Bun.serve<TWsData>({
	port: PORT,
	fetch(req, server) {
		const url = new URL(req.url);
		if (url.pathname === "/ws") {
			const token = url.searchParams.get("token");
			const upgraded = server.upgrade(req, {
				data: { token, notifs: null },
			});
			if (!upgraded) {
				return new Response("WebSocket upgrade failed", { status: 400 });
			}
			return undefined;
		}
		return new Response("Not found", { status: 404 });
	},
	websocket: {
		open(ws) {
			// If the client authed via URL, echo the token for debugging.
			// If not, challenge for a first-message auth frame.
			if (ws.data.token !== null) {
				const msg: TServerMsg = { type: "hello", token: ws.data.token };
				ws.send(JSON.stringify(msg));
			} else {
				const msg: TServerMsg = { type: "auth-required" };
				ws.send(JSON.stringify(msg));
			}
		},
		message(ws, raw) {
			const str = typeof raw === "string" ? raw : new TextDecoder().decode(raw);

			let parsed: Record<string, unknown>;
			try {
				parsed = JSON.parse(str) as Record<string, unknown>;
			} catch {
				return;
			}

			const msg = parsed as TClientMsg;
			const send = (data: TServerMsg) => ws.send(JSON.stringify(data));

			if (msg.type === "subscribe-notifications") {
				ws.data.notifs?.stop();
				ws.data.notifs = startNotifications(send);
				return;
			}
			if (msg.type === "unsubscribe-notifications") {
				ws.data.notifs?.stop();
				ws.data.notifs = null;
				return;
			}

			handleMessage({ send: (data: string) => ws.send(data) }, msg);
		},
		close(ws) {
			ws.data.notifs?.stop();
			ws.data.notifs = null;
		},
	},
});

console.log(`WebSocket dev server running on ws://localhost:${PORT}/ws`);
