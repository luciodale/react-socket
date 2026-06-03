import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketManager } from "../../manager";
import type { IStorage } from "../../storage";
import { createUndeliveredSync } from "../../undelivered-sync";
import { MockTransport } from "../helpers/mock-transport";

// Regression tests: reverting the corresponding fix makes each test fail.

type TTestClientMsg = Record<string, unknown>;
type TTestServerMsg = { type: string } & Record<string, unknown>;

const testSerialization = {
	serialize: (msg: TTestClientMsg) => JSON.stringify(msg),
	deserialize: (raw: string) => JSON.parse(raw) as TTestServerMsg,
};

function createManager(overrides?: {
	transport?: MockTransport;
	url?: string | (() => string | Promise<string>);
	ping?: () => TTestClientMsg;
	isPong?: (msg: TTestServerMsg) => boolean;
	pingIntervalMs?: number;
	pongTimeoutMs?: number;
	pauseHeartbeatWhenHidden?: boolean;
	reconnectBaseDelayMs?: number;
	reconnectMaxAttempts?: number;
}) {
	const transport = overrides?.transport ?? new MockTransport();
	const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
		...testSerialization,
		url: overrides?.url ?? "ws://test",
		transport,
		pingIntervalMs: overrides?.pingIntervalMs ?? 60_000,
		pongTimeoutMs: overrides?.pongTimeoutMs ?? 5_000,
		pauseHeartbeatWhenHidden: overrides?.pauseHeartbeatWhenHidden,
		reconnectBaseDelayMs: overrides?.reconnectBaseDelayMs ?? 10,
		reconnectMaxAttempts: overrides?.reconnectMaxAttempts ?? 10,
		reconnectMaxDelayMs: 100,
		ping: overrides?.ping,
		isPong: overrides?.isPong,
	});
	return { manager, transport };
}

function setDocumentHidden(hidden: boolean): void {
	Object.defineProperty(document, "hidden", {
		configurable: true,
		get: () => hidden,
	});
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	setDocumentHidden(false);
});

describe("regression: online event during a pending reconnect", () => {
	it("does not stack reconnect timers — exactly one connect fires", () => {
		const { manager, transport } = createManager();
		manager.connect();
		transport.simulateOpen();
		expect(transport.connectCalls).toHaveLength(1);

		// Abnormal drop schedules reconnect timer T1.
		transport.simulateClose(1006);
		expect(manager.getConnectionState()).toBe("reconnecting");

		// Pre-fix: online scheduled a second timer while T1 stayed live.
		window.dispatchEvent(new Event("online"));
		vi.advanceTimersByTime(10_000);

		expect(transport.connectCalls).toHaveLength(2);
	});

	it("repeated online events still produce a single connect", () => {
		const { manager, transport } = createManager();
		manager.connect();
		transport.simulateOpen();
		transport.simulateClose(1006);

		window.dispatchEvent(new Event("online"));
		window.dispatchEvent(new Event("online"));
		window.dispatchEvent(new Event("online"));
		vi.advanceTimersByTime(10_000);

		// 1 initial + 1 reconnect, regardless of how many online events fired.
		expect(transport.connectCalls).toHaveLength(2);
	});
});

describe("regression: reconnect completing while the tab is hidden", () => {
	it("does not re-arm the heartbeat until the tab is visible again", () => {
		const pings: number[] = [];
		const { manager, transport } = createManager({
			ping: () => {
				pings.push(1);
				return { type: "ping" };
			},
			isPong: (msg) => msg.type === "pong",
			pingIntervalMs: 1_000,
			pongTimeoutMs: 500,
		});
		manager.connect();
		transport.simulateOpen();

		// Hide the tab — visibilitychange pauses the heartbeat.
		setDocumentHidden(true);
		document.dispatchEvent(new Event("visibilitychange"));

		// Socket drops and reconnects while still hidden.
		transport.simulateClose(1006);
		vi.advanceTimersByTime(200);
		transport.simulateOpen();

		// Pre-fix: handleOpen armed the interval despite the hidden tab.
		vi.advanceTimersByTime(5_000);
		expect(pings).toHaveLength(0);

		// Tab visible again: one immediate validation ping.
		setDocumentHidden(false);
		document.dispatchEvent(new Event("visibilitychange"));
		expect(pings).toHaveLength(1);
	});

	it("arms the heartbeat on hidden reconnect when pauseHeartbeatWhenHidden is false", () => {
		const pings: number[] = [];
		const { manager, transport } = createManager({
			ping: () => {
				pings.push(1);
				return { type: "ping" };
			},
			isPong: (msg) => msg.type === "pong",
			pingIntervalMs: 1_000,
			pongTimeoutMs: 60_000,
			pauseHeartbeatWhenHidden: false,
		});
		manager.connect();
		setDocumentHidden(true);
		transport.simulateOpen();

		vi.advanceTimersByTime(1_000);
		expect(pings).toHaveLength(1);
	});
});

describe("regression: offline during an in-flight dynamic url resolve", () => {
	it("supersedes the resolve so no zombie socket connects", async () => {
		let resolveUrl: ((url: string) => void) | null = null;
		const { manager, transport } = createManager({
			url: () =>
				new Promise<string>((resolve) => {
					resolveUrl = resolve;
				}),
		});

		manager.connect();
		expect(transport.connectCalls).toHaveLength(0);

		// Browser goes offline while the resolver is still pending.
		window.dispatchEvent(new Event("offline"));
		expect(manager.getConnectionState()).toBe("reconnecting");

		// Pre-fix: the late-settling resolver connected a zombie socket.
		resolveUrl?.("ws://late");
		await vi.advanceTimersByTimeAsync(0);

		expect(transport.connectCalls).toHaveLength(0);
	});
});

describe("regression: outstanding ping/pong cycles never stack", () => {
	it("keeps a single pong deadline when pongTimeoutMs >= pingIntervalMs", () => {
		const { manager, transport } = createManager({
			ping: () => ({ type: "ping" }),
			isPong: (msg) => msg.type === "pong",
			pingIntervalMs: 1_000,
			pongTimeoutMs: 3_000,
		});
		manager.connect();
		transport.simulateOpen();
		transport.disconnectCalls = [];

		// No pongs ever arrive: the first cycle owns the only deadline
		// (fires t=4000). Pre-fix every ping stacked a live pong timer.
		vi.advanceTimersByTime(4_000);

		const pongTimeouts = transport.disconnectCalls.filter(
			(c) => c.reason === "pong timeout",
		);
		expect(pongTimeouts).toHaveLength(1);
	});

	it("resumes pinging after a pong resolves the outstanding cycle", () => {
		let pingCount = 0;
		const { manager, transport } = createManager({
			ping: () => {
				pingCount += 1;
				return { type: "ping" };
			},
			isPong: (msg) => msg.type === "pong",
			pingIntervalMs: 1_000,
			pongTimeoutMs: 3_000,
		});
		manager.connect();
		transport.simulateOpen();

		// t=1000: ping 1 fires. t=2000/3000: skipped (cycle outstanding).
		vi.advanceTimersByTime(2_500);
		expect(pingCount).toBe(1);

		// Pong resolves the cycle; the next interval tick pings again.
		transport.simulateMessage(JSON.stringify({ type: "pong" }));
		vi.advanceTimersByTime(1_000);
		expect(pingCount).toBe(2);
	});
});

describe("regression: storage failures surface through onPersistError", () => {
	function failingStorage(failOn: {
		get?: boolean;
		set?: boolean;
		remove?: boolean;
	}): IStorage {
		return {
			async getItem() {
				if (failOn.get) throw new Error("get failed");
				return null;
			},
			async setItem() {
				if (failOn.set) throw new Error("quota exceeded");
			},
			async removeItem() {
				if (failOn.remove) throw new Error("remove failed");
			},
		};
	}

	it("reports setItem failures from addMessage", async () => {
		const errors: unknown[] = [];
		const sync = createUndeliveredSync<{ id: string }>({
			storage: failingStorage({ set: true }),
			onPersistError: (error) => errors.push(error),
		});
		await sync.init();

		sync.addMessage("chat", { id: "m1" });
		await vi.advanceTimersByTimeAsync(0);

		expect(errors).toHaveLength(1);
		expect((errors[0] as Error).message).toBe("quota exceeded");
		// In-memory queue still works despite the durability failure.
		expect(sync.getChannelMessages("chat")).toEqual([{ id: "m1" }]);
	});

	it("reports getItem failures from init and starts empty", async () => {
		const errors: unknown[] = [];
		const sync = createUndeliveredSync<{ id: string }>({
			storage: failingStorage({ get: true }),
			onPersistError: (error) => errors.push(error),
		});
		await sync.init();

		expect(errors).toHaveLength(1);
		expect(sync.isInitialized()).toBe(true);
		expect(sync.getChannelMessages("chat")).toEqual([]);
	});

	it("reports removeItem failures from clearAll", async () => {
		const errors: unknown[] = [];
		const sync = createUndeliveredSync<{ id: string }>({
			storage: failingStorage({ remove: true }),
			onPersistError: (error) => errors.push(error),
		});
		await sync.init();

		sync.clearAll();
		await vi.advanceTimersByTimeAsync(0);

		expect(errors).toHaveLength(1);
	});
});

describe("regression: pong timeout must not strand a zombie 'connected' state", () => {
	// The transport swallows manager-initiated closes, so pre-fix the pong
	// timeout left the manager "connected" on a dead socket forever.
	it("tears down and reconnects after a pong timeout", () => {
		const dropped: { id: string }[][] = [];
		const { manager, transport } = createManager({
			ping: () => ({ type: "ping" }),
			isPong: (msg) => msg.type === "pong",
			pingIntervalMs: 1_000,
			pongTimeoutMs: 500,
		});
		manager.addInFlightDropListener((messages) => {
			dropped.push(messages);
		});
		manager.connect();
		transport.simulateOpen();
		manager.send({ data: { text: "unacked" }, ackId: "m1" });

		// Ping at t=1000; no pong; deadline at t=1500.
		vi.advanceTimersByTime(1_500);

		expect(manager.getConnectionState()).toBe("reconnecting");
		expect(dropped).toEqual([[{ id: "m1", data: { text: "unacked" } }]]);
		const pongTimeout = transport.disconnectCalls.find(
			(c) => c.reason === "pong timeout",
		);
		expect(pongTimeout?.code).toBe(4000);

		// The scheduled reconnect fires a fresh connect attempt.
		const before = transport.connectCalls.length;
		vi.advanceTimersByTime(2_000);
		expect(transport.connectCalls.length).toBe(before + 1);
	});
});
