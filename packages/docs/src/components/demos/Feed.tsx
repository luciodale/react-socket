import {
	useSocketConnectionState,
	useSocketEventBatch,
	useSocketSend,
	WebSocketManager,
} from "@luciodale/react-socket";
import { useEffect, useRef, useState } from "react";
import { getWsUrl } from "../../lib/ws-url";

// ── Protocol ────────────────────────────────────────────────────────

type TClientMsg = { type: "subscribe-feed" } | { type: "unsubscribe-feed" };

type TFeedEvent = {
	type: "feed";
	id: string;
	actor: string;
	actorKind: "human" | "agent";
	verb: string;
	target: string;
	ts: number;
};

type TServerMsg = TFeedEvent;

// ── Manager ─────────────────────────────────────────────────────────

const manager = new WebSocketManager<TClientMsg, TServerMsg>({
	url: getWsUrl(),
	serialize: (msg) => JSON.stringify(msg),
	deserialize: (raw) => JSON.parse(raw),
});

// ── Component ───────────────────────────────────────────────────────

const MAX_VISIBLE = 60;

export function Feed() {
	const [items, setItems] = useState<TFeedEvent[]>([]);
	const [running, setRunning] = useState(false);
	const renderCountRef = useRef(0);
	renderCountRef.current += 1;
	const state = useSocketConnectionState(manager);
	const { send } = useSocketSend(manager);

	useEffect(() => {
		manager.connect();
		return () => manager.disconnect();
	}, []);

	// Bursts of 4–12 events arrive back to back, then a 1.5–3s pause.
	// flushMs caps the steady-state work; idleMs trims the trailing
	// latency so the last events of a burst land within ~80ms of the
	// final wire frame instead of waiting for the next tick.
	// `msgs` is inferred as TFeedEvent[] from the "feed" literal — no cast.
	useSocketEventBatch(
		manager,
		"feed",
		(msgs) => {
			if (msgs.length === 0) return;
			setItems((prev) => [...msgs, ...prev].slice(0, MAX_VISIBLE));
		},
		{ flushMs: 80, idleMs: 40 },
	);

	function start() {
		send({ type: "subscribe-feed" });
		setRunning(true);
	}

	function stop() {
		send({ type: "unsubscribe-feed" });
		setRunning(false);
	}

	function clear() {
		setItems([]);
	}

	return (
		<div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
			<div className="mb-3 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<h3 className="text-lg font-semibold text-white">Activity feed</h3>
					<span className="text-xs text-white/40">{state}</span>
				</div>
				<div className="flex items-center gap-3 text-xs text-white/40">
					<span>renders: {renderCountRef.current}</span>
					<span>events: {items.length}</span>
				</div>
			</div>

			<p className="mb-4 text-sm text-white/60">
				Bursty server: 4–12 events arrive back-to-back, then a 1.5–3s pause.{" "}
				<span className="text-white/80">flushMs: 80, idleMs: 40</span> — the
				batch coalesces the burst into one render, and idleMs flushes the tail
				without waiting for the next tick.
			</p>

			<div className="mb-3 flex gap-2">
				<button
					type="button"
					onClick={start}
					disabled={running || state !== "connected"}
					className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
				>
					Start feed
				</button>
				<button
					type="button"
					onClick={stop}
					disabled={!running}
					className="rounded border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
				>
					Stop
				</button>
				<button
					type="button"
					onClick={clear}
					className="ml-auto rounded border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60 hover:bg-white/10 cursor-pointer"
				>
					Clear
				</button>
			</div>

			<div className="min-h-[200px] max-h-[320px] overflow-y-auto rounded bg-black/40 p-3">
				{items.length === 0 && (
					<p className="text-sm text-white/30">
						Press Start. Events will stream in as bursts.
					</p>
				)}
				{items.map((event) => (
					<FeedRow key={event.id} event={event} />
				))}
			</div>
		</div>
	);
}

function FeedRow({ event }: { event: TFeedEvent }) {
	const isAgent = event.actorKind === "agent";
	return (
		<div className="mb-1 flex items-baseline gap-2 text-sm">
			<span className="text-[10px] tabular-nums text-white/30">
				{new Date(event.ts).toLocaleTimeString([], { hour12: false })}
			</span>
			<span
				className={`font-semibold ${isAgent ? "text-accent" : "text-white/90"}`}
			>
				{event.actor}
				{isAgent && (
					<span className="ml-1 text-[10px] uppercase tracking-wide opacity-60">
						agent
					</span>
				)}
			</span>
			<span className="text-white/50">{event.verb}</span>
			<span className="text-white/70">{event.target}</span>
		</div>
	);
}
