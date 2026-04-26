import {
	useSocketConnectionState,
	useSocketEvent,
	useSocketEventBatch,
	useSocketSend,
	WebSocketManager,
} from "@luciodale/react-socket";
import { useEffect, useMemo, useRef, useState } from "react";
import { getWsUrl } from "../../lib/ws-url";

// ── Protocol ────────────────────────────────────────────────────────

type TClientMsg = { type: "subscribe-ticks" } | { type: "unsubscribe-ticks" };

type TServerMsg = {
	type: "tick";
	symbol: string;
	n: number;
	ts: number;
	bid: number;
	ask: number;
	last: number;
};

// ── Component ───────────────────────────────────────────────────────

export function Trading() {
	const manager = useMemo(
		() =>
			new WebSocketManager<TClientMsg, TServerMsg>({
				url: getWsUrl(),
				serialize: (msg) => JSON.stringify(msg),
				deserialize: (raw) => JSON.parse(raw) as TServerMsg,
			}),
		[],
	);

	const [running, setRunning] = useState(false);
	const state = useSocketConnectionState(manager);
	const { send } = useSocketSend(manager);

	useEffect(() => {
		manager.connect();
		return () => manager.disconnect();
	}, [manager]);

	function start() {
		send({ type: "subscribe-ticks" });
		setRunning(true);
	}

	function stop() {
		send({ type: "unsubscribe-ticks" });
		setRunning(false);
	}

	return (
		<div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
			<div className="mb-3 flex items-center gap-2">
				<h3 className="text-lg font-semibold text-white">Trading ticks</h3>
				<span className="text-xs text-white/40">{state}</span>
			</div>

			<p className="mb-4 text-sm text-white/60">
				The market feed pushes 50 quotes per second. The left panel re-renders
				on every tick — fine for one badge, ruinous for a real ladder. The right
				panel buffers and flushes every 100ms; same data, ~6× fewer renders.
				Watch <span className="text-emerald-400">Last batch</span> on the right
				to see batching happen — each flush surfaces the size of the buffer that
				just drained.
			</p>

			<div className="mb-4 flex gap-2">
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
			</div>

			<div className="grid gap-4 md:grid-cols-2">
				<PerEventQuote manager={manager} running={running} />
				<BatchedQuote manager={manager} running={running} />
			</div>
		</div>
	);
}

// ── Per-event quote (no batching) ───────────────────────────────────

function PerEventQuote({
	manager,
	running,
}: {
	manager: WebSocketManager<TClientMsg, TServerMsg>;
	running: boolean;
}) {
	const [latest, setLatest] = useState<TServerMsg | null>(null);
	const [received, setReceived] = useState(0);
	const renderCountRef = useRef(0);
	renderCountRef.current += 1;

	useSocketEvent(manager, "tick", (msg) => {
		setLatest(msg);
		setReceived((n) => n + 1);
	});

	return (
		<QuoteCard
			title="Per-event"
			subtitle="useSocketEvent — re-render on every tick"
			received={received}
			renders={renderCountRef.current}
			latest={latest}
			running={running}
			tone="warn"
		/>
	);
}

// ── Batched quote ───────────────────────────────────────────────────

function BatchedQuote({
	manager,
	running,
}: {
	manager: WebSocketManager<TClientMsg, TServerMsg>;
	running: boolean;
}) {
	const [latest, setLatest] = useState<TServerMsg | null>(null);
	const [received, setReceived] = useState(0);
	const [lastBatchSize, setLastBatchSize] = useState(0);
	const renderCountRef = useRef(0);
	renderCountRef.current += 1;

	useSocketEventBatch(
		manager,
		"tick",
		(msgs) => {
			if (msgs.length === 0) return;
			setReceived((n) => n + msgs.length);
			setLatest(msgs[msgs.length - 1]);
			setLastBatchSize(msgs.length);
		},
		{ flushMs: 100 },
	);

	return (
		<QuoteCard
			title="Batched"
			subtitle="useSocketEventBatch — flushMs: 100"
			received={received}
			renders={renderCountRef.current}
			latest={latest}
			running={running}
			tone="ok"
			lastBatchSize={lastBatchSize}
		/>
	);
}

// ── Quote card UI ───────────────────────────────────────────────────

function QuoteCard({
	title,
	subtitle,
	received,
	renders,
	latest,
	running,
	tone,
	lastBatchSize,
}: {
	title: string;
	subtitle: string;
	received: number;
	renders: number;
	latest: TServerMsg | null;
	running: boolean;
	tone: "ok" | "warn";
	lastBatchSize?: number;
}) {
	const accent = tone === "ok" ? "text-emerald-400" : "text-rose-400";

	return (
		<div className="rounded border border-white/10 bg-black/40 p-3">
			<div className="mb-1 text-sm font-semibold text-white">{title}</div>
			<div className="mb-3 text-xs text-white/40">{subtitle}</div>

			<div className="mb-3 grid grid-cols-3 gap-2">
				<Stat
					label="Bid"
					value={latest ? latest.bid.toFixed(3) : "—"}
					tone="text-emerald-400"
				/>
				<Stat
					label="Ask"
					value={latest ? latest.ask.toFixed(3) : "—"}
					tone="text-rose-400"
				/>
				<Stat
					label="Last"
					value={latest ? latest.last.toFixed(3) : "—"}
					tone="text-white"
				/>
			</div>

			<div className="grid grid-cols-3 gap-2">
				<Stat label="Received" value={received.toString()} />
				<Stat label="Renders" value={renders.toString()} tone={accent} />
				{lastBatchSize !== undefined ? (
					<Stat
						label="Last batch"
						value={lastBatchSize > 0 ? lastBatchSize.toString() : "—"}
						tone="text-emerald-400"
						pulseKey={lastBatchSize > 0 ? renders : undefined}
					/>
				) : (
					<Stat
						label="Symbol"
						value={latest?.symbol ?? "—"}
						tone="text-white/60"
					/>
				)}
			</div>

			{!running && (
				<p className="mt-3 text-xs text-white/30">Press Start to begin.</p>
			)}
		</div>
	);
}

function Stat({
	label,
	value,
	tone,
	pulseKey,
}: {
	label: string;
	value: string;
	tone?: string;
	pulseKey?: number;
}) {
	const [pulsing, setPulsing] = useState(false);
	useEffect(() => {
		if (pulseKey === undefined) return;
		setPulsing(true);
		const t = setTimeout(() => setPulsing(false), 120);
		return () => clearTimeout(t);
	}, [pulseKey]);

	return (
		<div
			className={`rounded p-2 transition-colors ${
				pulsing ? "bg-emerald-500/20" : "bg-white/[0.02]"
			}`}
		>
			<div className="text-[10px] uppercase tracking-wide text-white/40">
				{label}
			</div>
			<div className={`text-sm font-mono ${tone ?? "text-white"}`}>{value}</div>
		</div>
	);
}
