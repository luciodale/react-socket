import {
	useSocketConnectionState,
	useSocketEvent,
	WebSocketManager,
} from "@luciodale/react-socket";
import { useEffect, useMemo, useRef, useState } from "react";
import { getWsUrl } from "../../lib/ws-url";

// ── Protocol ────────────────────────────────────────────────────────

type TClientMsg =
	| { type: "auth"; token: string }
	| { type: "simulate-session-expiry" };

type TServerMsg =
	| { type: "auth-required" }
	| { type: "auth-ok"; userId: string }
	| { type: "auth-expired" }
	| { type: "unauthorized"; reason: string };

// ── Fake token store ────────────────────────────────────────────────
//
// Stands in for your real auth store. `mintToken` returns a fresh
// access token each time, `mintBadToken` gives one the server rejects.

let tokenCounter = 1;
function mintToken(): string {
	return `access-${tokenCounter++}`;
}
function mintBadToken(): string {
	return `bad-${tokenCounter++}`;
}

// ── Component ───────────────────────────────────────────────────────

type TLogEntry = { id: string; text: string };

export function FirstMessageAuth() {
	const tokenRef = useRef<string>("");
	const logIdRef = useRef<number>(0);
	const [currentToken, setCurrentToken] = useState<string>("");
	const [authed, setAuthed] = useState<boolean>(false);
	const [userId, setUserId] = useState<string | null>(null);
	const [log, setLog] = useState<TLogEntry[]>([]);

	function appendLog(text: string) {
		logIdRef.current += 1;
		const id = String(logIdRef.current);
		setLog((prev) => [{ id, text }, ...prev].slice(0, 10));
	}

	const manager = useMemo(() => {
		let mgr: WebSocketManager<TClientMsg, TServerMsg>;
		mgr = new WebSocketManager<TClientMsg, TServerMsg>({
			url: getWsUrl(),
			serialize: (msg) => JSON.stringify(msg),
			deserialize: (raw) => JSON.parse(raw) as TServerMsg,

			// Fires after every (re)connect + subscription replay.
			// Right seam for a first-message auth frame.
			onReady() {
				const token = tokenRef.current;
				if (!token) return;
				mgr.send({ data: { type: "auth", token } });
			},
		});
		return mgr;
	}, []);

	useEffect(() => {
		tokenRef.current = mintToken();
		setCurrentToken(tokenRef.current);
		manager.connect();
		return () => manager.disconnect();
	}, [manager]);

	useSocketEvent(manager, "auth-required", () => {
		appendLog("server: auth-required");
		// onReady normally handles this on initial connect.
		// Re-sending here covers servers that challenge mid-session.
		const token = tokenRef.current;
		if (token) {
			appendLog(`client: auth ${token}`);
			manager.send({ data: { type: "auth", token } });
		}
	});

	useSocketEvent(manager, "auth-ok", (msg) => {
		appendLog(`server: auth-ok user=${msg.userId}`);
		setAuthed(true);
		setUserId(msg.userId);
	});

	useSocketEvent(manager, "auth-expired", () => {
		appendLog("server: auth-expired");
		setAuthed(false);
		const next = mintToken();
		tokenRef.current = next;
		setCurrentToken(next);
		appendLog(`client: auth ${next}`);
		manager.send({ data: { type: "auth", token: next } });
	});

	useSocketEvent(manager, "unauthorized", (msg) => {
		appendLog(`server: unauthorized (${msg.reason})`);
		setAuthed(false);
		setUserId(null);
	});

	const state = useSocketConnectionState(manager);

	function handleSimulateExpiry() {
		appendLog("client: simulate-session-expiry");
		manager.send({ data: { type: "simulate-session-expiry" } });
	}

	function handleBadToken() {
		const next = mintBadToken();
		tokenRef.current = next;
		setCurrentToken(next);
		appendLog(`client: auth ${next}`);
		manager.send({ data: { type: "auth", token: next } });
	}

	function handleFreshToken() {
		const next = mintToken();
		tokenRef.current = next;
		setCurrentToken(next);
		appendLog(`client: auth ${next}`);
		manager.send({ data: { type: "auth", token: next } });
	}

	return (
		<div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
			<div className="mb-3 flex items-center gap-2">
				<h3 className="text-lg font-semibold text-white">First-message auth</h3>
				<span className="text-xs text-white/40">{state}</span>
			</div>

			<div className="mb-4 grid grid-cols-3 gap-3">
				<div className="rounded border border-white/10 bg-black/40 p-3">
					<div className="text-xs text-white/40">Authed</div>
					<div
						className={`text-sm font-mono ${
							authed ? "text-emerald-400" : "text-rose-400"
						}`}
					>
						{authed ? "yes" : "no"}
					</div>
				</div>
				<div className="rounded border border-white/10 bg-black/40 p-3">
					<div className="text-xs text-white/40">User</div>
					<div className="text-sm font-mono text-white">{userId ?? "—"}</div>
				</div>
				<div className="rounded border border-white/10 bg-black/40 p-3">
					<div className="text-xs text-white/40">Token</div>
					<div className="text-sm font-mono text-white">
						{currentToken || "—"}
					</div>
				</div>
			</div>

			<div className="mb-4 flex flex-wrap gap-2">
				<button
					type="button"
					onClick={handleSimulateExpiry}
					className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover cursor-pointer"
				>
					Simulate session expiry
				</button>
				<button
					type="button"
					onClick={handleFreshToken}
					className="rounded border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 cursor-pointer"
				>
					Sign in with fresh token
				</button>
				<button
					type="button"
					onClick={handleBadToken}
					className="rounded border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-300 hover:bg-rose-500/20 cursor-pointer"
				>
					Try bad token
				</button>
			</div>

			<div className="rounded bg-black/40 p-3">
				<div className="mb-2 text-xs text-white/40">Log</div>
				{log.length === 0 ? (
					<p className="text-sm text-white/30">Waiting for the first event…</p>
				) : (
					<ul className="space-y-1">
						{log.map((entry) => (
							<li key={entry.id} className="text-sm font-mono text-white/70">
								{entry.text}
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
