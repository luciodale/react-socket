import {
	useSocketConnectionState,
	useSocketEvent,
	useSocketSend,
	WebSocketManager,
} from "@luciodale/react-socket";
import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { getWsUrl } from "../../lib/ws-url";

// ── Protocol ────────────────────────────────────────────────────────

type TClientMsg =
	| { type: "auth"; token: string }
	| { type: "echo"; text: string }
	| { type: "subscribe-notifications" }
	| { type: "unsubscribe-notifications" };

type TServerMsg =
	| { type: "auth-required" }
	| { type: "auth-ok"; userId: string }
	| { type: "auth-expired" }
	| { type: "unauthorized"; reason: string }
	| { type: "echo"; text: string }
	| { type: "notification"; id: string; title: string; body: string };

// ── Shared token ─────────────────────────────────────────────────────
//
// Both managers read the latest access token from this single source of
// truth. Mutating it before forceReconnect lets either connection refresh
// its credentials without affecting the other.

let tokenCounter = 1;
function mintToken(): string {
	return `multi-${tokenCounter++}`;
}

// ── Auth context shared across both managers ───────────────────────

type TAuthState = {
	authed: boolean;
	userId: string | null;
	chatAuthed: boolean;
	notifAuthed: boolean;
};

const AuthContext = createContext<TAuthState>({
	authed: false,
	userId: null,
	chatAuthed: false,
	notifAuthed: false,
});

function useAuth(): TAuthState {
	return useContext(AuthContext);
}

// ── Component ───────────────────────────────────────────────────────

export function MultiConnection() {
	const tokenRef = useRef<string>("");

	// Two separate managers, two separate WebSocket connections.
	const managerChat = useMemo(() => {
		let mgr: WebSocketManager<TClientMsg, TServerMsg>;
		mgr = new WebSocketManager<TClientMsg, TServerMsg>({
			url: getWsUrl(),
			serialize: (msg) => JSON.stringify(msg),
			deserialize: (raw) => JSON.parse(raw) as TServerMsg,
			onReady() {
				if (tokenRef.current) {
					mgr.send({ data: { type: "auth", token: tokenRef.current } });
				}
			},
		});
		return mgr;
	}, []);

	const managerNotif = useMemo(() => {
		let mgr: WebSocketManager<TClientMsg, TServerMsg>;
		mgr = new WebSocketManager<TClientMsg, TServerMsg>({
			url: getWsUrl(),
			serialize: (msg) => JSON.stringify(msg),
			deserialize: (raw) => JSON.parse(raw) as TServerMsg,
			onReady() {
				if (tokenRef.current) {
					mgr.send({ data: { type: "auth", token: tokenRef.current } });
				}
			},
		});
		return mgr;
	}, []);

	const [chatAuthed, setChatAuthed] = useState(false);
	const [notifAuthed, setNotifAuthed] = useState(false);
	const [userId, setUserId] = useState<string | null>(null);

	useEffect(() => {
		tokenRef.current = mintToken();
		managerChat.connect();
		managerNotif.connect();
		return () => {
			managerChat.disconnect();
			managerNotif.disconnect();
		};
	}, [managerChat, managerNotif]);

	// Track auth-ok per manager. The shared `authed` flag becomes true only
	// once both have confirmed.
	useSocketEvent(managerChat, "auth-ok", (msg) => {
		setChatAuthed(true);
		setUserId(msg.userId);
	});
	useSocketEvent(managerChat, "unauthorized", () => {
		setChatAuthed(false);
		setUserId(null);
	});

	useSocketEvent(managerNotif, "auth-ok", () => {
		setNotifAuthed(true);
	});
	useSocketEvent(managerNotif, "unauthorized", () => {
		setNotifAuthed(false);
	});

	const authed = chatAuthed && notifAuthed;

	const value = useMemo<TAuthState>(
		() => ({ authed, userId, chatAuthed, notifAuthed }),
		[authed, userId, chatAuthed, notifAuthed],
	);

	// Subscribe to notifications once the notif manager is authed.
	useEffect(() => {
		if (!notifAuthed) return;
		managerNotif.send({ data: { type: "subscribe-notifications" } });
		return () => {
			managerNotif.send({ data: { type: "unsubscribe-notifications" } });
		};
	}, [managerNotif, notifAuthed]);

	return (
		<AuthContext.Provider value={value}>
			<div className="flex flex-col gap-4">
				<StatusBar managerChat={managerChat} managerNotif={managerNotif} />
				<div className="grid gap-4 md:grid-cols-2">
					<ChatPanel manager={managerChat} />
					<NotificationsPanel manager={managerNotif} />
				</div>
			</div>
		</AuthContext.Provider>
	);
}

// ── Status bar ──────────────────────────────────────────────────────

function StatusBar({
	managerChat,
	managerNotif,
}: {
	managerChat: WebSocketManager<TClientMsg, TServerMsg>;
	managerNotif: WebSocketManager<TClientMsg, TServerMsg>;
}) {
	const { authed, userId, chatAuthed, notifAuthed } = useAuth();
	const chatState = useSocketConnectionState(managerChat);
	const notifState = useSocketConnectionState(managerNotif);

	return (
		<div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
			<div className="grid gap-3 md:grid-cols-4">
				<Cell
					label="Authed"
					value={authed ? "yes" : "no"}
					tone={authed ? "ok" : "warn"}
				/>
				<Cell label="User" value={userId ?? "—"} />
				<Cell
					label="Chat"
					value={`${chatState} · ${chatAuthed ? "auth ok" : "no auth"}`}
				/>
				<Cell
					label="Notifications"
					value={`${notifState} · ${notifAuthed ? "auth ok" : "no auth"}`}
				/>
			</div>
		</div>
	);
}

function Cell({
	label,
	value,
	tone,
}: {
	label: string;
	value: string;
	tone?: "ok" | "warn";
}) {
	const valueClass =
		tone === "ok"
			? "text-emerald-400"
			: tone === "warn"
				? "text-rose-400"
				: "text-white";
	return (
		<div className="rounded border border-white/10 bg-black/40 p-2">
			<div className="text-xs text-white/40">{label}</div>
			<div className={`text-sm font-mono ${valueClass}`}>{value}</div>
		</div>
	);
}

// ── Chat panel ──────────────────────────────────────────────────────

type TChatEntry = { id: string; from: "you" | "server"; text: string };

function ChatPanel({
	manager,
}: {
	manager: WebSocketManager<TClientMsg, TServerMsg>;
}) {
	const { authed } = useAuth();
	const [input, setInput] = useState("");
	const [log, setLog] = useState<TChatEntry[]>([]);
	const idRef = useRef(0);
	const { send } = useSocketSend(manager);

	useSocketEvent(manager, "echo", (msg) => {
		idRef.current += 1;
		const entry: TChatEntry = {
			id: String(idRef.current),
			from: "server",
			text: msg.text,
		};
		setLog((prev) => [...prev, entry].slice(-8));
	});

	function handleSend() {
		const text = input.trim();
		if (!text || !authed) return;
		idRef.current += 1;
		const entry: TChatEntry = {
			id: String(idRef.current),
			from: "you",
			text,
		};
		setLog((prev) => [...prev, entry].slice(-8));
		send({ type: "echo", text });
		setInput("");
	}

	return (
		<div className="flex flex-col rounded-lg border border-white/10 bg-white/[0.02] p-4">
			<h4 className="mb-2 text-sm font-semibold text-white">Chat connection</h4>
			<p className="mb-3 text-xs text-white/40">
				Echoes whatever you send. Disabled until both connections are authed.
			</p>
			<div className="mb-3 min-h-[120px] flex-1 overflow-y-auto rounded bg-black/40 p-3">
				{log.length === 0 ? (
					<p className="text-sm text-white/30">No echoes yet.</p>
				) : (
					log.map((entry) => (
						<div key={entry.id} className="mb-1 text-sm text-white/70">
							<span className="font-semibold text-white/90">{entry.from}:</span>{" "}
							{entry.text}
						</div>
					))
				)}
			</div>
			<div className="flex gap-2">
				<input
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && handleSend()}
					placeholder={authed ? "Type something..." : "Waiting for auth..."}
					disabled={!authed}
					className="flex-1 rounded border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-accent disabled:opacity-50"
				/>
				<button
					type="button"
					onClick={handleSend}
					disabled={!authed}
					className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
				>
					Send
				</button>
			</div>
		</div>
	);
}

// ── Notifications panel ─────────────────────────────────────────────

type TNotification = { id: string; title: string; body: string };

function NotificationsPanel({
	manager,
}: {
	manager: WebSocketManager<TClientMsg, TServerMsg>;
}) {
	const { authed } = useAuth();
	const [items, setItems] = useState<TNotification[]>([]);

	useSocketEvent(manager, "notification", (msg) => {
		setItems((prev) =>
			[{ id: msg.id, title: msg.title, body: msg.body }, ...prev].slice(0, 6),
		);
	});

	return (
		<div className="flex flex-col rounded-lg border border-white/10 bg-white/[0.02] p-4">
			<h4 className="mb-2 text-sm font-semibold text-white">
				Notifications connection
			</h4>
			<p className="mb-3 text-xs text-white/40">
				Server pushes a notification every 4s once authed and subscribed.
			</p>
			<div className="min-h-[120px] flex-1 overflow-y-auto rounded bg-black/40 p-3">
				{!authed && (
					<p className="text-sm text-white/30">Waiting for auth...</p>
				)}
				{authed && items.length === 0 && (
					<p className="text-sm text-white/30">
						Subscribed. Waiting for the first push…
					</p>
				)}
				{items.map((n) => (
					<div
						key={n.id}
						className="mb-2 rounded border border-white/5 bg-white/[0.02] p-2"
					>
						<div className="text-sm font-semibold text-white/90">{n.title}</div>
						<div className="text-xs text-white/60">{n.body}</div>
					</div>
				))}
			</div>
		</div>
	);
}
