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

type TServerMsg = { type: "tick"; n: number; ts: number };

// ── Component ───────────────────────────────────────────────────────

export function HighFrequencyStream() {
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
				<h3 className="text-lg font-semibold text-white">
					High-frequency stream
				</h3>
				<span className="text-xs text-white/40">{state}</span>
			</div>

			<p className="mb-4 text-sm text-white/60">
				The server pushes 50 ticks per second. The left panel re-renders on
				every tick. The right panel buffers and flushes once every 100ms — six
				times fewer renders for the same data.
			</p>

			<div className="mb-4 flex gap-2">
				<button
					type="button"
					onClick={start}
					disabled={running || state !== "connected"}
					className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
				>
					Start stream
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
				<PerEventPanel manager={manager} running={running} />
				<BatchedPanel manager={manager} running={running} />
			</div>
		</div>
	);
}

// ── Per-event panel (no batching) ───────────────────────────────────

function PerEventPanel({
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
		<Panel
			title="Per-event"
			subtitle="useSocketEvent — re-render on every tick"
			received={received}
			renders={renderCountRef.current}
			latestN={latest?.n ?? null}
			running={running}
			tone="warn"
		/>
	);
}

// ── Batched panel ───────────────────────────────────────────────────

function BatchedPanel({
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

	useSocketEventBatch(
		manager,
		"tick",
		(msgs) => {
			if (msgs.length === 0) return;
			setReceived((n) => n + msgs.length);
			setLatest(msgs[msgs.length - 1]);
		},
		{ flushMs: 100 },
	);

	return (
		<Panel
			title="Batched"
			subtitle="useSocketEventBatch — flushMs: 100"
			received={received}
			renders={renderCountRef.current}
			latestN={latest?.n ?? null}
			running={running}
			tone="ok"
		/>
	);
}

// ── Shared panel UI ─────────────────────────────────────────────────

function Panel({
	title,
	subtitle,
	received,
	renders,
	latestN,
	running,
	tone,
}: {
	title: string;
	subtitle: string;
	received: number;
	renders: number;
	latestN: number | null;
	running: boolean;
	tone: "ok" | "warn";
}) {
	const accent = tone === "ok" ? "text-emerald-400" : "text-rose-400";

	return (
		<div className="rounded border border-white/10 bg-black/40 p-3">
			<div className="mb-1 text-sm font-semibold text-white">{title}</div>
			<div className="mb-3 text-xs text-white/40">{subtitle}</div>

			<div className="grid grid-cols-3 gap-2">
				<Stat label="Received" value={received.toString()} />
				<Stat label="Renders" value={renders.toString()} tone={accent} />
				<Stat label="Latest n" value={latestN === null ? "—" : `#${latestN}`} />
			</div>

			{!running && (
				<p className="mt-3 text-xs text-white/30">
					Press Start to begin the stream.
				</p>
			)}
		</div>
	);
}

function Stat({
	label,
	value,
	tone,
}: {
	label: string;
	value: string;
	tone?: string;
}) {
	return (
		<div className="rounded bg-white/[0.02] p-2">
			<div className="text-[10px] uppercase tracking-wide text-white/40">
				{label}
			</div>
			<div className={`text-sm font-mono ${tone ?? "text-white"}`}>{value}</div>
		</div>
	);
}
