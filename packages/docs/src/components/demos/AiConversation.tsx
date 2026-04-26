import {
	useSocketConnectionState,
	useSocketEvent,
	useSocketEventBatch,
	useSocketSend,
	WebSocketManager,
} from "@luciodale/react-socket";
import { memo, useEffect, useState } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import { getWsUrl } from "../../lib/ws-url";

// ── Protocol ────────────────────────────────────────────────────────

type TPreset = "summarize" | "translate" | "explain" | "code";

type TClientMsg = {
	type: "ask";
	id: string;
	prompt: string;
	preset?: TPreset;
};

type TArtifact = {
	id: string;
	kind: "code" | "doc" | "table";
	title: string;
	body: string;
};

type TServerMsg =
	| { type: "stream-start"; id: string; role: "assistant" }
	| { type: "stream-delta"; id: string; delta: string }
	| {
			type: "artifact";
			id: string;
			kind: "code" | "doc" | "table";
			title: string;
			body: string;
	  }
	| { type: "stream-end"; id: string };

// ── Store ───────────────────────────────────────────────────────────

type TTurn = {
	id: string;
	role: "user" | "assistant";
	text: string;
	preset?: TPreset;
};

type TStore = {
	history: TTurn[];
	streaming: Record<string, string>;
	artifacts: Record<string, TArtifact>;
	pushUserTurn: (id: string, text: string, preset?: TPreset) => void;
	startStream: (id: string) => void;
	appendDeltas: (id: string, deltas: string[]) => void;
	addArtifact: (id: string, artifact: TArtifact) => void;
	endStream: (id: string) => void;
};

const useStore = create<TStore>()((set) => ({
	history: [],
	streaming: {},
	artifacts: {},

	pushUserTurn: (id, text, preset) =>
		set((s) => ({
			history: [...s.history, { id, role: "user", text, preset }],
		})),

	startStream: (id) =>
		set((s) => ({ streaming: { ...s.streaming, [id]: "" } })),

	appendDeltas: (id, deltas) =>
		set((s) => ({
			streaming: {
				...s.streaming,
				[id]: (s.streaming[id] ?? "") + deltas.join(""),
			},
		})),

	addArtifact: (id, artifact) =>
		set((s) => ({ artifacts: { ...s.artifacts, [id]: artifact } })),

	endStream: (id) =>
		set((s) => {
			const text = s.streaming[id] ?? "";
			const { [id]: _done, ...rest } = s.streaming;
			return {
				history: [...s.history, { id, role: "assistant", text }],
				streaming: rest,
			};
		}),
}));

// ── Manager ─────────────────────────────────────────────────────────

const manager = new WebSocketManager<TClientMsg, TServerMsg>({
	url: getWsUrl(),
	serialize: (msg) => JSON.stringify(msg),
	deserialize: (raw) => JSON.parse(raw) as TServerMsg,
});

// ── Bridge ──────────────────────────────────────────────────────────
//
// `stream-delta` is high-frequency: useSocketEventBatch coalesces tokens
// that arrive within 16ms, idleMs flushes the tail so the last 1-3
// tokens land without waiting for the next interval tick.

function StreamBridge() {
	useSocketEvent(manager, "stream-start", (msg) => {
		useStore.getState().startStream(msg.id);
	});
	useSocketEventBatch(
		manager,
		"stream-delta",
		(msgs) => {
			const grouped = new Map<string, string[]>();
			for (const m of msgs) {
				const list = grouped.get(m.id) ?? [];
				list.push(m.delta);
				grouped.set(m.id, list);
			}
			for (const [id, deltas] of grouped) {
				useStore.getState().appendDeltas(id, deltas);
			}
		},
		{ flushMs: 16, idleMs: 8 },
	);
	useSocketEvent(manager, "artifact", (msg) => {
		useStore.getState().addArtifact(msg.id, {
			id: msg.id,
			kind: msg.kind,
			title: msg.title,
			body: msg.body,
		});
	});
	useSocketEvent(manager, "stream-end", (msg) => {
		useStore.getState().endStream(msg.id);
	});
	return null;
}

// ── Views ───────────────────────────────────────────────────────────

const PRESETS: Array<{ id: TPreset; label: string; hint: string }> = [
	{ id: "summarize", label: "Summarize", hint: "Three sentence digest" },
	{ id: "translate", label: "Translate", hint: "Pass through translator" },
	{ id: "explain", label: "Explain", hint: "Walk through reasoning" },
	{ id: "code", label: "Code", hint: "Returns an artifact" },
];

const PRESET_LABELS: Record<TPreset, string> = {
	summarize: "Summarize",
	translate: "Translate",
	explain: "Explain",
	code: "Code",
};

const HistoryList = memo(function HistoryList() {
	const history = useStore((s) => s.history);
	const artifacts = useStore((s) => s.artifacts);
	return (
		<>
			{history.map((turn) => (
				<div key={turn.id} className="mb-2 text-sm">
					<div>
						<span className="font-semibold text-white/90">{turn.role}:</span>{" "}
						{turn.preset && (
							<span className="mr-1 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/50">
								{PRESET_LABELS[turn.preset]}
							</span>
						)}
						<span className="text-white/70">{turn.text}</span>
					</div>
					{artifacts[turn.id] && <ArtifactCard artifact={artifacts[turn.id]} />}
				</div>
			))}
		</>
	);
});

function StreamingTurn({ id }: { id: string }) {
	const text = useStore((s) => s.streaming[id] ?? "");
	return (
		<div className="mb-2 text-sm">
			<span className="font-semibold text-accent">assistant:</span>{" "}
			<span className="text-white/70">
				{text}
				<span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-accent align-[-2px]" />
			</span>
		</div>
	);
}

function ActiveStreams() {
	const ids = useStore(useShallow((s) => Object.keys(s.streaming)));
	return (
		<>
			{ids.map((id) => (
				<StreamingTurn key={id} id={id} />
			))}
		</>
	);
}

function ArtifactCard({ artifact }: { artifact: TArtifact }) {
	return (
		<div className="mt-2 rounded border border-accent/30 bg-accent/[0.06] p-3">
			<div className="mb-1 flex items-center gap-2">
				<span className="text-[10px] uppercase tracking-wide text-accent/80">
					{artifact.kind}
				</span>
				<span className="text-xs font-semibold text-white/80">
					{artifact.title}
				</span>
			</div>
			<pre className="overflow-x-auto rounded bg-black/40 p-2 text-xs text-white/70 font-mono">
				{artifact.body}
			</pre>
		</div>
	);
}

function EmptyState() {
	const isEmpty = useStore(
		(s) => s.history.length === 0 && Object.keys(s.streaming).length === 0,
	);
	if (!isEmpty) return null;
	return (
		<p className="text-sm text-white/30">
			Pick a preset and ask. Tokens stream in; code preset emits an artifact at
			the end.
		</p>
	);
}

// ── Demo shell ──────────────────────────────────────────────────────

export function AiConversation() {
	const [prompt, setPrompt] = useState("");
	const [preset, setPreset] = useState<TPreset>("summarize");
	const state = useSocketConnectionState(manager);
	const { send } = useSocketSend(manager);

	useEffect(() => {
		manager.connect();
		return () => manager.disconnect();
	}, []);

	function handleAsk() {
		if (!prompt.trim()) return;
		const id = crypto.randomUUID();
		useStore.getState().pushUserTurn(`${id}-user`, prompt.trim(), preset);
		send({ type: "ask", id, prompt: prompt.trim(), preset });
		setPrompt("");
	}

	return (
		<div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
			<StreamBridge />

			<div className="mb-3 flex items-center gap-2">
				<h3 className="text-lg font-semibold text-white">AI Conversation</h3>
				<span className="text-xs text-white/40">{state}</span>
			</div>

			<div className="mb-3 flex flex-wrap gap-1.5">
				{PRESETS.map((p) => (
					<button
						key={p.id}
						type="button"
						onClick={() => setPreset(p.id)}
						className={`rounded border px-2.5 py-1 text-xs transition-colors cursor-pointer ${
							preset === p.id
								? "border-accent/50 bg-accent/15 text-white"
								: "border-white/10 bg-white/[0.02] text-white/60 hover:bg-white/[0.06]"
						}`}
						title={p.hint}
					>
						{p.label}
					</button>
				))}
			</div>

			<div className="mb-3 min-h-[180px] max-h-[360px] overflow-y-auto rounded bg-black/40 p-3">
				<EmptyState />
				<HistoryList />
				<ActiveStreams />
			</div>

			<div className="flex gap-2">
				<input
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && handleAsk()}
					placeholder="Ask something..."
					className="flex-1 rounded border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-accent"
				/>
				<button
					type="button"
					onClick={handleAsk}
					className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover cursor-pointer"
				>
					Ask
				</button>
			</div>
		</div>
	);
}
