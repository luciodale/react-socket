import {
	useSocketConnectionState,
	useSocketEvent,
	useSocketPendingSubscription,
	useSocketSend,
	useSocketSubscription,
	WebSocketManager,
} from "@luciodale/react-socket";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { getWsUrl } from "../../lib/ws-url";

// ── Protocol ────────────────────────────────────────────────────────

type TClientMsg =
	| { type: "ping" }
	| { type: "subscribe"; channel: string }
	| { type: "unsubscribe"; channel: string }
	| { type: "message"; id: string; channel: string; text: string }
	| { type: "typing-start"; channel: string }
	| { type: "typing-stop"; channel: string };

type TMember = { id: string; name: string; kind: "human" | "agent" };

type TServerMsg =
	| { type: "pong" }
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
	| { type: "presence"; channel: string; members: TMember[] }
	| {
			type: "typing";
			channel: string;
			userId: string;
			name: string;
			active: boolean;
	  };

type TMessage = {
	id: string;
	sender: string;
	senderKind: "human" | "agent";
	text: string;
};

// ── Manager ─────────────────────────────────────────────────────────

const manager = new WebSocketManager<TClientMsg, TServerMsg>({
	url: getWsUrl(),
	serialize: (msg) => JSON.stringify(msg),
	deserialize: (raw) => JSON.parse(raw) as TServerMsg,

	ping: () => ({ type: "ping" }),
	isPong: (msg) => msg.type === "pong",

	getAckId: (msg) => (msg.type === "delivered" ? msg.ackId : undefined),
	getSubscriptionResolvedKey: (msg) =>
		msg.type === "subscribe-ack" ? msg.channel : undefined,
});

// ── Store ───────────────────────────────────────────────────────────

type TState = {
	messages: Record<string, TMessage[]>;
	presence: Record<string, TMember[]>;
	typing: Record<string, Record<string, string>>; // channel → userId → name
};

const useStore = create<TState>()(() => ({
	messages: {},
	presence: {},
	typing: {},
}));

function appendMessage(channel: string, message: TMessage) {
	useStore.setState((s) => {
		const existing = s.messages[channel] ?? [];
		if (existing.some((m) => m.id === message.id)) return s;
		return {
			messages: { ...s.messages, [channel]: [...existing, message] },
		};
	});
}

function setPresence(channel: string, members: TMember[]) {
	useStore.setState((s) => ({
		presence: { ...s.presence, [channel]: members },
	}));
}

function setTyping(
	channel: string,
	userId: string,
	name: string,
	active: boolean,
) {
	useStore.setState((s) => {
		const channelTyping = { ...(s.typing[channel] ?? {}) };
		if (active) channelTyping[userId] = name;
		else delete channelTyping[userId];
		return { typing: { ...s.typing, [channel]: channelTyping } };
	});
}

// ── Bridges ─────────────────────────────────────────────────────────

function SpaceBridge() {
	useSocketEvent(manager, "chat", (msg) => {
		appendMessage(msg.channel, {
			id: msg.id,
			sender: msg.sender,
			senderKind: msg.senderKind,
			text: msg.text,
		});
	});
	useSocketEvent(manager, "presence", (msg) => {
		setPresence(msg.channel, msg.members);
	});
	useSocketEvent(manager, "typing", (msg) => {
		setTyping(msg.channel, msg.userId, msg.name, msg.active);
	});
	return null;
}

// ── Centralised subscription hook ───────────────────────────────────
//
// Every consumer in the Space tree calls this hook. The key + payloads
// are derived from the same `spaceId` argument, so two siblings cannot
// drift on params.

function useSpaceSubscription(spaceId: string) {
	useSocketSubscription(manager, {
		key: spaceId,
		subscribe: { type: "subscribe", channel: spaceId },
		unsubscribe: { type: "unsubscribe", channel: spaceId },
	});
}

// ── Composition hooks ───────────────────────────────────────────────

const EMPTY_MESSAGES: TMessage[] = [];
const EMPTY_MEMBERS: TMember[] = [];
const EMPTY_TYPING: Record<string, string> = {};

function useSpace(spaceId: string) {
	useSpaceSubscription(spaceId);
	const joining = useSocketPendingSubscription(manager, spaceId);
	const messages = useStore((s) => s.messages[spaceId] ?? EMPTY_MESSAGES);
	const presence = useStore((s) => s.presence[spaceId] ?? EMPTY_MEMBERS);
	const typing = useStore((s) => s.typing[spaceId] ?? EMPTY_TYPING);
	return { joining, messages, presence, typing };
}

// ── Components ──────────────────────────────────────────────────────

function MemberPill({ member }: { member: TMember }) {
	const isAgent = member.kind === "agent";
	return (
		<span
			className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
				isAgent
					? "border-accent/30 bg-accent/10 text-accent"
					: "border-white/10 bg-white/5 text-white/70"
			}`}
		>
			<span
				className={`h-1.5 w-1.5 rounded-full ${
					isAgent ? "bg-accent" : "bg-emerald-400"
				}`}
			/>
			{member.name}
			{isAgent && <span className="text-[10px] opacity-60">agent</span>}
		</span>
	);
}

function TypingIndicator({ names }: { names: string[] }) {
	if (names.length === 0) return null;
	const text =
		names.length === 1
			? `${names[0]} is typing`
			: `${names.slice(0, 2).join(", ")}${names.length > 2 ? ` +${names.length - 2}` : ""} typing`;
	return (
		<div className="flex items-center gap-1.5 text-xs text-white/40">
			<span className="flex gap-0.5">
				<span className="h-1 w-1 animate-pulse rounded-full bg-white/40 [animation-delay:0ms]" />
				<span className="h-1 w-1 animate-pulse rounded-full bg-white/40 [animation-delay:150ms]" />
				<span className="h-1 w-1 animate-pulse rounded-full bg-white/40 [animation-delay:300ms]" />
			</span>
			{text}
		</div>
	);
}

function MessageRow({ message }: { message: TMessage }) {
	const isAgent = message.senderKind === "agent";
	return (
		<div className="mb-1 flex items-baseline gap-2 text-sm">
			<span
				className={`font-semibold ${isAgent ? "text-accent" : "text-white/90"}`}
			>
				{message.sender}:
			</span>
			<span className="text-white/70">{message.text}</span>
		</div>
	);
}

function SpaceView({ spaceId }: { spaceId: string }) {
	const [input, setInput] = useState("");
	const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const state = useSocketConnectionState(manager);
	const { joining, messages, presence, typing } = useSpace(spaceId);
	const { send } = useSocketSend(manager);

	const typingNames = Object.values(typing);

	function handleType() {
		if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
		send({ type: "typing-start", channel: spaceId });
		typingTimerRef.current = setTimeout(() => {
			send({ type: "typing-stop", channel: spaceId });
		}, 1500);
	}

	function handleSend() {
		if (!input.trim()) return;
		const id = crypto.randomUUID();
		send({ type: "message", id, channel: spaceId, text: input.trim() }, id);
		setInput("");
		if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
		send({ type: "typing-stop", channel: spaceId });
	}

	return (
		<div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
			<div className="mb-3 flex items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<h3 className="text-lg font-semibold text-white">#{spaceId}</h3>
					<span className="text-xs text-white/40">
						{joining ? "joining..." : state}
					</span>
				</div>
				<div className="flex flex-wrap items-center gap-1.5">
					{presence.map((m) => (
						<MemberPill key={m.id} member={m} />
					))}
				</div>
			</div>

			<div className="mb-2 min-h-[160px] max-h-[280px] overflow-y-auto rounded bg-black/40 p-3">
				{messages.length === 0 && (
					<p className="text-sm text-white/30">
						Say hi. Orion (the agent) will reply, and Ada types back when you
						do.
					</p>
				)}
				{messages.map((m) => (
					<MessageRow key={m.id} message={m} />
				))}
			</div>

			<div className="mb-2 h-4">
				<TypingIndicator names={typingNames} />
			</div>

			<div className="flex gap-2">
				<input
					value={input}
					onChange={(e) => {
						setInput(e.target.value);
						handleType();
					}}
					onKeyDown={(e) => e.key === "Enter" && handleSend()}
					placeholder="Message the space..."
					className="flex-1 rounded border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-accent"
				/>
				<button
					type="button"
					onClick={handleSend}
					className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover cursor-pointer"
				>
					Send
				</button>
			</div>
		</div>
	);
}

// ── Exported Island ─────────────────────────────────────────────────

export function Space() {
	const [spaceId, setSpaceId] = useState("space:design-review");

	useEffect(() => {
		manager.connect();
		return () => manager.disconnect();
	}, []);

	return (
		<div className="space-y-4">
			<SpaceBridge />
			<div className="flex items-center gap-3">
				<label htmlFor="space-select" className="text-sm text-white/50">
					Space
				</label>
				<select
					id="space-select"
					value={spaceId}
					onChange={(e) => setSpaceId(e.target.value)}
					className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white outline-none focus:border-accent"
				>
					<option value="space:design-review">space:design-review</option>
					<option value="space:roadmap">space:roadmap</option>
					<option value="space:research">space:research</option>
				</select>
			</div>
			<SpaceView spaceId={spaceId} />
		</div>
	);
}
