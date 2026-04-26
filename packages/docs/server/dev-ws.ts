// ── Types ────────────────────────────────────────────────────────────

type TClientMsg =
	| { type: "ping" }
	| { type: "echo"; text: string }
	// Spaces
	| { type: "subscribe"; channel: string }
	| { type: "unsubscribe"; channel: string }
	| { type: "message"; id: string; channel: string; text: string }
	| { type: "typing-start"; channel: string }
	| { type: "typing-stop"; channel: string }
	// AI conversation
	| {
			type: "ask";
			id: string;
			prompt: string;
			preset?: "summarize" | "translate" | "explain" | "code";
	  }
	| { type: "quick-ask"; id: string; prompt: string }
	// Auth
	| { type: "invalidate-token" }
	| { type: "auth"; token: string }
	| { type: "simulate-session-expiry" }
	| { type: "subscribe-notifications" }
	| { type: "unsubscribe-notifications" }
	// Trading
	| { type: "subscribe-ticks" }
	| { type: "unsubscribe-ticks" }
	// Feed
	| { type: "subscribe-feed" }
	| { type: "unsubscribe-feed" };

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
			senderKind: "human" | "agent";
			text: string;
	  }
	| {
			type: "presence";
			channel: string;
			members: Array<{
				id: string;
				name: string;
				kind: "human" | "agent";
			}>;
	  }
	| {
			type: "typing";
			channel: string;
			userId: string;
			name: string;
			active: boolean;
	  }
	// AI streams
	| { type: "stream-start"; id: string; role: "assistant" }
	| { type: "stream-delta"; id: string; delta: string }
	| {
			type: "artifact";
			id: string;
			kind: "code" | "doc" | "table";
			title: string;
			body: string;
	  }
	| { type: "stream-end"; id: string }
	// Auth
	| { type: "hello"; token: string }
	| { type: "unauthorized"; reason: string }
	| { type: "auth-required" }
	| { type: "auth-expired" }
	| { type: "auth-ok"; userId: string }
	| { type: "notification"; id: string; title: string; body: string }
	// Trading
	| {
			type: "tick";
			symbol: string;
			n: number;
			ts: number;
			bid: number;
			ask: number;
			last: number;
	  }
	// Feed
	| {
			type: "feed";
			id: string;
			actor: string;
			actorKind: "human" | "agent";
			verb: string;
			target: string;
			ts: number;
	  };

// ── Helpers ─────────────────────────────────────────────────────────

type TArtifactMsg = Extract<TServerMsg, { type: "artifact" }>;

function pickPreset(
	preset: "summarize" | "translate" | "explain" | "code" | undefined,
	prompt: string,
): { reply: string; artifact?: TArtifactMsg } {
	const trimmed = prompt.trim() || "your input";
	switch (preset) {
		case "summarize":
			return {
				reply: `Here is a short summary of ${JSON.stringify(trimmed)}: a concise, three-sentence digest produced by the model would normally appear here. Streaming as we go.`,
			};
		case "translate":
			return {
				reply: `Translation of ${JSON.stringify(trimmed)} into a target language streams in token by token.`,
			};
		case "explain":
			return {
				reply: `Explanation: I read your prompt and now walk through the answer step by step so the reasoning is visible as tokens arrive.`,
			};
		case "code":
			return {
				reply: `Drafting a small TypeScript snippet for ${JSON.stringify(trimmed)}. Code lands in an artifact card after the stream ends.`,
				artifact: {
					type: "artifact",
					id: "",
					kind: "code",
					title: "fizzbuzz.ts",
					body:
						`export function fizzbuzz(n: number): string {\n` +
						`  if (n % 15 === 0) return "FizzBuzz";\n` +
						`  if (n % 3 === 0) return "Fizz";\n` +
						`  if (n % 5 === 0) return "Buzz";\n` +
						`  return String(n);\n` +
						`}\n`,
				},
			};
		default:
			return {
				reply: `I read your prompt: ${JSON.stringify(trimmed)}. Here is a streamed response that arrives word by word so you can watch tokens accumulate.`,
			};
	}
}

function botReplyTo(text: string): string {
	const lower = text.toLowerCase();
	if (lower.includes("status") || lower.includes("ready")) {
		return "All systems green. Anything else?";
	}
	if (lower.includes("?")) {
		return "Looking into it. I will report back when I have a draft.";
	}
	return `Noted: "${text}".`;
}

// ── Message handler ─────────────────────────────────────────────────

function handleMessage(
	ws: { send: (data: string) => void; data: TWsData },
	msg: TClientMsg,
) {
	const send = (data: TServerMsg) => ws.send(JSON.stringify(data));

	switch (msg.type) {
		case "ping":
			send({ type: "pong" });
			break;

		case "echo":
			send({ type: "echo", text: msg.text });
			break;

		case "subscribe": {
			send({ type: "subscribe-ack", channel: msg.channel });
			// Seed presence for "space:*" channels with a small fixed roster +
			// the joining user. Lets the demo show a multi-actor space without a
			// real user system.
			if (msg.channel.startsWith("space:")) {
				ws.data.spaces.add(msg.channel);
				const members: Array<{
					id: string;
					name: string;
					kind: "human" | "agent";
				}> = [
					{ id: "you", name: "You", kind: "human" },
					{ id: "ada", name: "Ada", kind: "human" },
					{ id: "agent-orion", name: "Orion", kind: "agent" },
				];
				send({ type: "presence", channel: msg.channel, members });
			}
			break;
		}

		case "unsubscribe":
			send({ type: "unsubscribe-ack", channel: msg.channel });
			ws.data.spaces.delete(msg.channel);
			break;

		case "message": {
			send({ type: "delivered", ackId: msg.id });
			send({
				type: "chat",
				id: msg.id,
				channel: msg.channel,
				sender: "You",
				senderKind: "human",
				text: msg.text,
			});

			// Agent reply after a short delay (only for spaces, otherwise stays
			// the simple "bot" reply for legacy chat channels).
			const isSpace = msg.channel.startsWith("space:");
			setTimeout(
				() => {
					send({
						type: "chat",
						id: crypto.randomUUID(),
						channel: msg.channel,
						sender: isSpace ? "Orion" : "bot",
						senderKind: isSpace ? "agent" : "human",
						text: botReplyTo(msg.text),
					});
				},
				500 + Math.random() * 600,
			);
			break;
		}

		case "typing-start": {
			// Echo a typing event from a fake teammate so the demo shows
			// "X is typing" without needing a second client. Lasts 2s.
			send({
				type: "typing",
				channel: msg.channel,
				userId: "ada",
				name: "Ada",
				active: true,
			});
			setTimeout(() => {
				send({
					type: "typing",
					channel: msg.channel,
					userId: "ada",
					name: "Ada",
					active: false,
				});
			}, 2000);
			break;
		}

		case "typing-stop":
			break;

		case "ask": {
			streamFakeResponse(send, msg.id, msg.prompt, msg.preset);
			break;
		}

		case "quick-ask": {
			const { reply } = pickPreset(undefined, msg.prompt);
			// One-shot fire and forget answer: emit the full reply as a single
			// chat-style frame after a short delay.
			setTimeout(() => {
				send({
					type: "chat",
					id: msg.id,
					channel: "quick",
					sender: "Assistant",
					senderKind: "agent",
					text: reply,
				});
			}, 200);
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

type TPreset = "summarize" | "translate" | "explain" | "code" | undefined;

function streamFakeResponse(
	send: (data: TServerMsg) => void,
	id: string,
	prompt: string,
	preset: TPreset,
) {
	send({ type: "stream-start", id, role: "assistant" });

	const { reply, artifact } = pickPreset(preset, prompt);
	const tokens = reply.split(/(\s+)/).filter(Boolean);
	let i = 0;

	function next() {
		if (i >= tokens.length) {
			if (artifact) send({ ...artifact, id });
			send({ type: "stream-end", id });
			return;
		}
		send({ type: "stream-delta", id, delta: tokens[i] });
		i++;
		setTimeout(next, 35 + Math.random() * 70);
	}

	setTimeout(next, 120);
}

// ── Notifications: timed pushes to subscribed clients ──────────────

type TPushHandle = { stop: () => void };

const NOTIFICATION_TITLES = [
	"New activity",
	"Mention",
	"Build finished",
	"PR review requested",
	"Deploy succeeded",
];

const FEED_VERBS = [
	{ verb: "uploaded", target: "Q3-roadmap.pdf" },
	{ verb: "commented on", target: "specs/auth-flow" },
	{ verb: "ran", target: "knowledge-sync" },
	{ verb: "shared", target: "competitor-analysis.md" },
	{ verb: "completed", target: "task: refactor pricing" },
	{ verb: "indexed", target: "vendor docs" },
	{ verb: "summarised", target: "weekly-standup transcript" },
];

const FEED_ACTORS: Array<{ name: string; kind: "human" | "agent" }> = [
	{ name: "Ada", kind: "human" },
	{ name: "Mia", kind: "human" },
	{ name: "Orion", kind: "agent" },
	{ name: "Atlas", kind: "agent" },
	{ name: "Nova", kind: "human" },
];

function startTicks(send: (msg: TServerMsg) => void): TPushHandle {
	let n = 0;
	let mid = 100;
	// 50 ticks/second, fast enough to make per-event vs batched
	// rendering cost visibly different.
	const interval = setInterval(() => {
		// Random walk around ~100, keeps the demo readable.
		mid += (Math.random() - 0.5) * 0.4;
		mid = Math.max(80, Math.min(120, mid));
		const spread = 0.05 + Math.random() * 0.08;
		const bid = +(mid - spread / 2).toFixed(3);
		const ask = +(mid + spread / 2).toFixed(3);
		const last = +(mid + (Math.random() - 0.5) * spread).toFixed(3);
		send({
			type: "tick",
			symbol: "RXS-USD",
			n,
			ts: Date.now(),
			bid,
			ask,
			last,
		});
		n += 1;
	}, 20);
	return {
		stop: () => clearInterval(interval),
	};
}

function startNotifications(send: (msg: TServerMsg) => void): TPushHandle {
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

function startFeed(send: (msg: TServerMsg) => void): TPushHandle {
	// Emits in irregular bursts: 4–12 events back-to-back, then a 1.5–3s
	// pause. Lets `idleMs` flushing visibly trail the burst without the
	// trailing token problem useSocketEventBatch is meant to solve.
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | null = null;

	function burst() {
		if (stopped) return;
		const count = 4 + Math.floor(Math.random() * 9);
		let i = 0;
		function fire() {
			if (stopped || i >= count) {
				timer = setTimeout(burst, 1500 + Math.random() * 1500);
				return;
			}
			const actor = FEED_ACTORS[Math.floor(Math.random() * FEED_ACTORS.length)];
			const event = FEED_VERBS[Math.floor(Math.random() * FEED_VERBS.length)];
			send({
				type: "feed",
				id: crypto.randomUUID(),
				actor: actor.name,
				actorKind: actor.kind,
				verb: event.verb,
				target: event.target,
				ts: Date.now(),
			});
			i += 1;
			timer = setTimeout(fire, 30 + Math.random() * 80);
		}
		fire();
	}

	burst();

	return {
		stop: () => {
			stopped = true;
			if (timer) clearTimeout(timer);
		},
	};
}

// ── Bun WebSocket server ────────────────────────────────────────────

const PORT = 3001;

type TWsData = {
	token: string | null;
	notifs: TPushHandle | null;
	ticks: TPushHandle | null;
	feed: TPushHandle | null;
	spaces: Set<string>;
};

Bun.serve<TWsData>({
	port: PORT,
	fetch(req, server) {
		const url = new URL(req.url);
		if (url.pathname === "/ws") {
			const token = url.searchParams.get("token");
			const upgraded = server.upgrade(req, {
				data: {
					token,
					notifs: null,
					ticks: null,
					feed: null,
					spaces: new Set<string>(),
				},
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
			if (msg.type === "subscribe-ticks") {
				ws.data.ticks?.stop();
				ws.data.ticks = startTicks(send);
				return;
			}
			if (msg.type === "unsubscribe-ticks") {
				ws.data.ticks?.stop();
				ws.data.ticks = null;
				return;
			}
			if (msg.type === "subscribe-feed") {
				ws.data.feed?.stop();
				ws.data.feed = startFeed(send);
				return;
			}
			if (msg.type === "unsubscribe-feed") {
				ws.data.feed?.stop();
				ws.data.feed = null;
				return;
			}

			handleMessage(
				{ send: (data: string) => ws.send(data), data: ws.data },
				msg,
			);
		},
		close(ws) {
			ws.data.notifs?.stop();
			ws.data.notifs = null;
			ws.data.ticks?.stop();
			ws.data.ticks = null;
			ws.data.feed?.stop();
			ws.data.feed = null;
			ws.data.spaces.clear();
		},
	},
});

console.log(`WebSocket dev server running on ws://localhost:${PORT}/ws`);
