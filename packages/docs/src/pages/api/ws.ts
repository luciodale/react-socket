import type { APIRoute } from "astro";

export const prerender = false;

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
	| { type: "unsubscribe-notifications" }
	| { type: "subscribe-ticks" }
	| { type: "unsubscribe-ticks" };

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
	| { type: "notification"; id: string; title: string; body: string }
	| { type: "tick"; n: number; ts: number };

// ── Handler ─────────────────────────────────────────────────────────

function handleMessage(ws: WebSocket, msg: TClientMsg) {
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
			send({ type: "delivered", ackId: msg.id });
			send({
				type: "chat",
				id: msg.id,
				channel: msg.channel,
				sender: "you",
				text: msg.text,
			});
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

// ── CF Workers WebSocket endpoint ───────────────────────────────────

export const GET: APIRoute = async ({ request }) => {
	const upgrade = request.headers.get("Upgrade");
	if (upgrade !== "websocket") {
		return new Response("Expected Upgrade: websocket", { status: 426 });
	}

	const url = new URL(request.url);
	const token = url.searchParams.get("token");

	const pair = new WebSocketPair();
	const [client, server] = Object.values(pair);

	server.accept();
	// If URL has a token, echo it for debugging; otherwise challenge for
	// a first-message auth frame.
	if (token !== null) {
		const hello: TServerMsg = { type: "hello", token };
		server.send(JSON.stringify(hello));
	} else {
		const challenge: TServerMsg = { type: "auth-required" };
		server.send(JSON.stringify(challenge));
	}

	let notifInterval: ReturnType<typeof setInterval> | null = null;
	function stopNotifications() {
		if (notifInterval) {
			clearInterval(notifInterval);
			notifInterval = null;
		}
	}
	function startNotifications() {
		stopNotifications();
		const titles = [
			"New activity",
			"Mention",
			"Build finished",
			"PR review requested",
			"Deploy succeeded",
		];
		let i = 0;
		notifInterval = setInterval(() => {
			const title = titles[i % titles.length] ?? "Notification";
			const msg: TServerMsg = {
				type: "notification",
				id: crypto.randomUUID(),
				title,
				body: `Pushed by the notifications connection (#${i + 1})`,
			};
			server.send(JSON.stringify(msg));
			i += 1;
		}, 4000);
	}

	let ticksInterval: ReturnType<typeof setInterval> | null = null;
	function stopTicks() {
		if (ticksInterval) {
			clearInterval(ticksInterval);
			ticksInterval = null;
		}
	}
	function startTicks() {
		stopTicks();
		let n = 0;
		ticksInterval = setInterval(() => {
			const msg: TServerMsg = { type: "tick", n, ts: Date.now() };
			server.send(JSON.stringify(msg));
			n += 1;
		}, 20);
	}

	server.addEventListener("message", (event: MessageEvent) => {
		try {
			const msg = JSON.parse(event.data as string) as TClientMsg;
			if (msg.type === "subscribe-notifications") {
				startNotifications();
				return;
			}
			if (msg.type === "unsubscribe-notifications") {
				stopNotifications();
				return;
			}
			if (msg.type === "subscribe-ticks") {
				startTicks();
				return;
			}
			if (msg.type === "unsubscribe-ticks") {
				stopTicks();
				return;
			}
			handleMessage(server, msg);
		} catch {
			// ignore invalid JSON
		}
	});

	server.addEventListener("close", () => {
		stopNotifications();
		stopTicks();
	});

	// @ts-expect-error CF Workers Response extension: webSocket property
	return new Response(null, { status: 101, webSocket: client });
};
