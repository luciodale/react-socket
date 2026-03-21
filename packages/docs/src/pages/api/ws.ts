import type { APIRoute } from "astro";

export const prerender = false;

// ── Types ────────────────────────────────────────────────────────────

type TClientMsg =
	| { action: "ping" }
	| { action: "echo"; text: string }
	| { action: "subscribe"; channel: string }
	| { action: "unsubscribe"; channel: string }
	| { action: "message"; id: string; channel: string; text: string };

type TServerMsg =
	| { action: "pong" }
	| { action: "echo"; text: string }
	| { action: "subscribe_ack"; channel: string }
	| { action: "unsubscribe_ack"; channel: string }
	| {
			action: "message";
			id: string;
			channel: string;
			sender: string;
			text: string;
	  };

// ── Handler ─────────────────────────────────────────────────────────

function handleMessage(ws: WebSocket, msg: TClientMsg) {
	const send = (data: TServerMsg) => ws.send(JSON.stringify(data));

	switch (msg.action) {
		case "ping":
			send({ action: "pong" });
			break;

		case "echo":
			send({ action: "echo", text: msg.text });
			break;

		case "subscribe":
			send({ action: "subscribe_ack", channel: msg.channel });
			break;

		case "unsubscribe":
			send({ action: "unsubscribe_ack", channel: msg.channel });
			break;

		case "message": {
			send({
				action: "message",
				id: msg.id,
				channel: msg.channel,
				sender: "you",
				text: msg.text,
			});
			setTimeout(() => {
				send({
					action: "message",
					id: crypto.randomUUID(),
					channel: msg.channel,
					sender: "bot",
					text: `You said: "${msg.text}"`,
				});
			}, 300);
			break;
		}
	}
}

// ── CF Workers WebSocket endpoint ───────────────────────────────────

export const GET: APIRoute = async ({ request }) => {
	const upgrade = request.headers.get("Upgrade");
	if (upgrade !== "websocket") {
		return new Response("Expected Upgrade: websocket", { status: 426 });
	}

	const pair = new WebSocketPair();
	const [client, server] = Object.values(pair);

	server.accept();
	server.addEventListener("message", (event: MessageEvent) => {
		try {
			const msg = JSON.parse(event.data as string) as TClientMsg;
			handleMessage(server, msg);
		} catch {
			// ignore invalid JSON
		}
	});

	// @ts-expect-error CF Workers Response extension: webSocket property
	return new Response(null, { status: 101, webSocket: client });
};
