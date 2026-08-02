import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketManager } from "../../manager";
import type {
	TBeforeConnectContext,
	TConnectionState,
	TDebugEvent,
} from "../../types";
import { MockTransport } from "../helpers/mock-transport";

// ── Test types ──────────────────────────────────────────────────────

type TTestClientMsg = Record<string, unknown>;
type TTestServerMsg = { type: string } & Record<string, unknown>;

const testSerialization = {
	serialize: (msg: TTestClientMsg) => JSON.stringify(msg),
	deserialize: (raw: string) => JSON.parse(raw) as TTestServerMsg,
};

// ── Helpers ─────────────────────────────────────────────────────────

function subMsg(type: string, channel: string): TTestClientMsg {
	return { action: "subscribe", type, channel };
}

function unsubMsg(type: string, channel: string): TTestClientMsg {
	return { action: "unsubscribe", type, channel };
}

function createManager(overrides?: {
	transport?: MockTransport;
	onMessageReceived?: (msg: TTestServerMsg) => void;
	onConnectionStateChange?: (state: TConnectionState) => void;
	onReady?: () => void;
	onInFlightDrop?: (messages: { id: string; data: TTestClientMsg }[]) => void;
	onLastUnsubscribe?: (key: string, data: TTestClientMsg | undefined) => void;
	ping?: () => TTestClientMsg;
	isPong?: (msg: TTestServerMsg) => boolean;
	pingIntervalMs?: number;
	pongTimeoutMs?: number;
	reconnectBaseDelayMs?: number;
	reconnectMaxAttempts?: number;
}) {
	const transport = overrides?.transport ?? new MockTransport();
	const states: TConnectionState[] = [];
	const rawMessages: TTestServerMsg[] = [];
	const readyCalls: number[] = [];
	const droppedInFlightMaps: { id: string; data: TTestClientMsg }[][] = [];

	const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
		...testSerialization,
		url: "ws://test",
		transport,
		pingIntervalMs: overrides?.pingIntervalMs ?? 60_000,
		pongTimeoutMs: overrides?.pongTimeoutMs ?? 5_000,
		reconnectBaseDelayMs: overrides?.reconnectBaseDelayMs ?? 10,
		reconnectMaxAttempts: overrides?.reconnectMaxAttempts ?? 3,
		reconnectMaxDelayMs: 100,
		ping: overrides?.ping,
		isPong: overrides?.isPong,
		onReady: () => {
			readyCalls.push(1);
			overrides?.onReady?.();
		},
	});

	manager.addConnectionStateListener(() => {
		const state = manager.getConnectionState();
		states.push(state);
		overrides?.onConnectionStateChange?.(state);
	});
	manager.addInFlightDropListener((messages) => {
		droppedInFlightMaps.push(messages);
		overrides?.onInFlightDrop?.(messages);
	});
	if (overrides?.onLastUnsubscribe) {
		manager.addLastUnsubscribeListener(overrides.onLastUnsubscribe);
	}

	manager.addMessageListener((msg) => {
		rawMessages.push(msg);
		overrides?.onMessageReceived?.(msg);
	});

	return {
		manager,
		transport,
		states,
		rawMessages,
		readyCalls,
		droppedInFlightMaps,
	};
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("WebSocketManager", () => {
	describe("connection", () => {
		it("transitions to connecting then connected on open", () => {
			const { manager, transport, states } = createManager();
			manager.connect();
			expect(states).toEqual(["connecting"]);
			transport.simulateOpen();
			expect(states).toEqual(["connecting", "connected"]);
		});

		it("does not connect twice", () => {
			const { manager, transport } = createManager();
			manager.connect();
			manager.connect();
			expect(transport.connectCalls).toHaveLength(1);
		});
	});

	describe("disconnect", () => {
		it("intentional disconnect sets disconnected", () => {
			const { manager, transport, states } = createManager();
			manager.connect();
			transport.simulateOpen();
			manager.disconnect();
			expect(states[states.length - 1]).toBe("disconnected");
		});

		it("clean close (1000) does not reconnect", () => {
			const { manager, transport, states } = createManager();
			manager.connect();
			transport.simulateOpen();
			transport.simulateClose(1000);
			expect(states[states.length - 1]).toBe("disconnected");
		});
	});

	describe("subscriptions", () => {
		it("first subscription sends server message", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();
			transport.sentMessages = [];

			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
			expect(transport.sentMessages).toHaveLength(1);
			const msg = JSON.parse(transport.sentMessages[0]);
			expect(msg).toEqual({
				action: "subscribe",
				type: "conversation",
				channel: "ch1",
			});
		});

		it("duplicate subscription does not send again", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();
			transport.sentMessages = [];

			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
			const subs = transport.sentMessages.filter((m) =>
				m.includes('"subscribe"'),
			);
			expect(subs).toHaveLength(1);
		});

		it("unsubscribe only at ref count 0", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
			transport.sentMessages = [];

			manager.unsubscribe("conversation:ch1", unsubMsg("conversation", "ch1"));
			const unsubs = transport.sentMessages.filter((m) =>
				m.includes('"unsubscribe"'),
			);
			expect(unsubs).toHaveLength(0);

			manager.unsubscribe("conversation:ch1", unsubMsg("conversation", "ch1"));
			const unsubs2 = transport.sentMessages.filter((m) =>
				m.includes('"unsubscribe"'),
			);
			expect(unsubs2).toHaveLength(1);
		});

		it("adds subscription to pending on subscribe", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
			expect(manager.hasPendingSubscription("conversation:ch1")).toBe(true);
		});

		it("resolves pending subscription via resolvePendingSubscription", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
			manager.resolvePendingSubscription("conversation:ch1");
			expect(manager.hasPendingSubscription("conversation:ch1")).toBe(false);
		});

		it("sends the unsubscribe frame on last unsubscribe while connected", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();
			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
			transport.sentMessages = [];

			manager.unsubscribe("conversation:ch1", unsubMsg("conversation", "ch1"));

			expect(transport.sentMessages).toHaveLength(1);
			expect(JSON.parse(transport.sentMessages[0])).toEqual({
				action: "unsubscribe",
				type: "conversation",
				channel: "ch1",
			});
		});

		it("does not send the unsubscribe frame when disconnected (control)", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();
			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));

			// Tear the socket down before the final unsubscribe — the frame must
			// not be written while not connected.
			manager.disconnect();
			transport.sentMessages = [];

			manager.unsubscribe("conversation:ch1", unsubMsg("conversation", "ch1"));

			expect(transport.sentMessages).toHaveLength(0);
		});

		it("replays the first subscribe payload after reconnect (first-payload-wins)", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();

			// Two subscribers for the same key with different payloads. The first
			// payload is the one stored for replay; the second only bumps the ref.
			manager.subscribe("conversation:ch1", {
				action: "subscribe",
				type: "conversation",
				channel: "ch1",
				payload: "A",
			});
			manager.subscribe("conversation:ch1", {
				action: "subscribe",
				type: "conversation",
				channel: "ch1",
				payload: "B",
			});
			transport.sentMessages = [];

			manager.forceReconnect();
			transport.simulateOpen();

			const subs = transport.sentMessages.filter((m) =>
				m.includes('"subscribe"'),
			);
			expect(subs).toHaveLength(1);
			expect(JSON.parse(subs[0])).toEqual({
				action: "subscribe",
				type: "conversation",
				channel: "ch1",
				payload: "A",
			});
		});

		it("subscribing before open replays exactly once on open", () => {
			const { manager, transport } = createManager();
			// Connect but do NOT open — the socket is still connecting.
			manager.connect();

			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
			// Nothing is on the wire and nothing is marked pending while down.
			expect(transport.sentMessages).toHaveLength(0);
			expect(manager.hasPendingSubscription("conversation:ch1")).toBe(false);

			transport.simulateOpen();

			const subs = transport.sentMessages.filter((m) =>
				m.includes('"subscribe"'),
			);
			expect(subs).toHaveLength(1);
			expect(JSON.parse(subs[0])).toEqual({
				action: "subscribe",
				type: "conversation",
				channel: "ch1",
			});
			expect(manager.hasPendingSubscription("conversation:ch1")).toBe(true);
		});

		it("unsubscribing a still-pending subscription clears the pending state", () => {
			let pendingNotifications = 0;
			const { manager, transport } = createManager();
			manager.addPendingSubscriptionListener(() => {
				pendingNotifications++;
			});
			manager.connect();
			transport.simulateOpen();

			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
			expect(manager.hasPendingSubscription("conversation:ch1")).toBe(true);

			pendingNotifications = 0;
			// Drop the only subscriber while the subscription is still unresolved.
			manager.unsubscribe("conversation:ch1");

			expect(
				manager.getSnapshot().pendingSubscriptions.has("conversation:ch1"),
			).toBe(false);
			// Clearing the pending entry must notify the pending-subscription
			// listeners so dependent UI flips out of its loading state.
			expect(pendingNotifications).toBe(1);
		});
	});

	describe("reconnection", () => {
		it("reconnects with backoff on abnormal close", () => {
			const { manager, transport, states } = createManager();
			manager.connect();
			transport.simulateOpen();
			transport.simulateClose(1006);

			expect(states[states.length - 1]).toBe("reconnecting");

			vi.advanceTimersByTime(200);
			expect(transport.connectCalls.length).toBeGreaterThan(1);
		});

		it("restores subscriptions after reconnect", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();
			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
			transport.sentMessages = [];

			transport.simulateClose(1006);
			vi.advanceTimersByTime(200);
			transport.simulateOpen();

			const subs = transport.sentMessages.filter((m) =>
				m.includes('"subscribe"'),
			);
			expect(subs).toHaveLength(1);
			// The replayed frame must carry the original subscribe payload, not
			// just any subscribe-shaped message.
			expect(JSON.parse(subs[0])).toEqual({
				action: "subscribe",
				type: "conversation",
				channel: "ch1",
			});
		});

		it("gives up after max attempts and transitions to disconnected", () => {
			const { manager, transport, states } = createManager({
				reconnectMaxAttempts: 2,
			});
			manager.connect();
			transport.simulateOpen();
			transport.simulateClose(1006);

			for (let i = 0; i < 3; i++) {
				vi.advanceTimersByTime(10_000);
				if (transport.connectCalls.length > 1) {
					transport.simulateClose(1006);
				}
			}

			expect(states[states.length - 1]).toBe("disconnected");
		});

		it("retries indefinitely when reconnectMaxAttempts is set to Infinity", () => {
			const transport = new MockTransport();
			const states: TConnectionState[] = [];
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
				reconnectBaseDelayMs: 10,
				reconnectMaxDelayMs: 50,
				reconnectMaxAttempts: Number.POSITIVE_INFINITY,
			});
			manager.addConnectionStateListener(() => {
				states.push(manager.getConnectionState());
			});

			manager.connect();
			transport.simulateOpen();

			// Repeatedly drop the connection — never transitions to
			// "disconnected" because retries are unbounded.
			for (let i = 0; i < 50; i += 1) {
				transport.simulateClose(1006);
				vi.advanceTimersByTime(60);
				if (transport.connectCalls.length > i + 1) {
					transport.simulateOpen();
				}
			}

			// Unbounded retries must keep cycling the live states — never the
			// terminal "disconnected", never back to the initial "idle".
			expect(["connecting", "reconnecting", "connected"]).toContain(
				states[states.length - 1],
			);
			expect(transport.connectCalls.length).toBeGreaterThan(10);
		});
	});

	describe("ping/pong", () => {
		const pingConfig = {
			ping: () => ({ action: "ping", timestamp: "now" }) as TTestClientMsg,
			isPong: (msg: TTestServerMsg) => msg.action === "pong",
		};

		it("sends ping at interval", () => {
			const { manager, transport } = createManager({
				...pingConfig,
				pingIntervalMs: 100,
			});
			manager.connect();
			transport.simulateOpen();
			transport.sentMessages = [];

			vi.advanceTimersByTime(100);
			const pings = transport.sentMessages.filter((m) => m.includes('"ping"'));
			expect(pings).toHaveLength(1);
		});

		it("does not send ping when ping is not provided", () => {
			const { manager, transport } = createManager({
				pingIntervalMs: 100,
			});
			manager.connect();
			transport.simulateOpen();
			transport.sentMessages = [];

			vi.advanceTimersByTime(200);
			expect(transport.sentMessages).toHaveLength(0);
		});

		it("disconnects on pong timeout", () => {
			const { manager, transport } = createManager({
				...pingConfig,
				pingIntervalMs: 100,
				pongTimeoutMs: 50,
			});
			manager.connect();
			transport.simulateOpen();

			vi.advanceTimersByTime(100);
			vi.advanceTimersByTime(50);
			expect(transport.disconnectCalls.length).toBeGreaterThanOrEqual(1);
			const lastDisconnect =
				transport.disconnectCalls[transport.disconnectCalls.length - 1];
			expect(lastDisconnect.code).toBe(4000);
		});

		it("clears pong timeout on pong received", () => {
			const { manager, transport } = createManager({
				...pingConfig,
				pingIntervalMs: 100,
				pongTimeoutMs: 50,
			});
			manager.connect();
			transport.simulateOpen();

			vi.advanceTimersByTime(100);
			transport.simulateMessage(
				JSON.stringify({ action: "pong", timestamp: "t" }),
			);
			vi.advanceTimersByTime(50);
			expect(transport.disconnectCalls).toHaveLength(0);
		});
	});

	describe("pauseHeartbeatWhenHidden", () => {
		const pingConfig = {
			ping: () => ({ action: "ping" }) as TTestClientMsg,
			isPong: (msg: TTestServerMsg) => msg.action === "pong",
		};

		function setHidden(hidden: boolean): void {
			Object.defineProperty(document, "hidden", {
				configurable: true,
				get: () => hidden,
			});
			Object.defineProperty(document, "visibilityState", {
				configurable: true,
				get: () => (hidden ? "hidden" : "visible"),
			});
			document.dispatchEvent(new Event("visibilitychange"));
		}

		afterEach(() => {
			setHidden(false);
		});

		it("pauses by default when option is omitted", () => {
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
				pingIntervalMs: 100,
				pongTimeoutMs: 50,
				...pingConfig,
			});
			manager.connect();
			transport.simulateOpen();
			transport.sentMessages = [];

			setHidden(true);
			vi.advanceTimersByTime(500);

			const pings = transport.sentMessages.filter((m) => m.includes('"ping"'));
			expect(pings).toHaveLength(0);
		});

		it("keeps pinging while hidden when explicitly disabled", () => {
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
				pingIntervalMs: 100,
				pongTimeoutMs: 50,
				pauseHeartbeatWhenHidden: false,
				...pingConfig,
			});
			manager.connect();
			transport.simulateOpen();
			transport.sentMessages = [];

			setHidden(true);
			vi.advanceTimersByTime(100);

			const pings = transport.sentMessages.filter((m) => m.includes('"ping"'));
			expect(pings.length).toBeGreaterThanOrEqual(1);
		});

		it("pauses ping while hidden and resumes when visible", () => {
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
				pingIntervalMs: 100,
				pongTimeoutMs: 50,
				pauseHeartbeatWhenHidden: true,
				...pingConfig,
			});
			manager.connect();
			transport.simulateOpen();
			transport.sentMessages = [];

			setHidden(true);
			vi.advanceTimersByTime(500);
			let pings = transport.sentMessages.filter((m) => m.includes('"ping"'));
			expect(pings).toHaveLength(0);

			setHidden(false);
			vi.advanceTimersByTime(100);
			pings = transport.sentMessages.filter((m) => m.includes('"ping"'));
			expect(pings.length).toBeGreaterThanOrEqual(1);
		});

		it("does not fire pong timeout while hidden", () => {
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
				pingIntervalMs: 100,
				pongTimeoutMs: 50,
				pauseHeartbeatWhenHidden: true,
				...pingConfig,
			});
			manager.connect();
			transport.simulateOpen();

			// Trigger a ping so a pong timer is armed.
			vi.advanceTimersByTime(100);
			expect(transport.disconnectCalls).toHaveLength(0);

			// Hide before the pong timeout fires.
			setHidden(true);
			vi.advanceTimersByTime(10_000);

			expect(transport.disconnectCalls).toHaveLength(0);
		});

		it("fires an immediate ping on visibility resume to validate the socket", () => {
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
				pingIntervalMs: 30_000,
				pongTimeoutMs: 50,
				pauseHeartbeatWhenHidden: true,
				...pingConfig,
			});
			manager.connect();
			transport.simulateOpen();

			setHidden(true);
			transport.sentMessages = [];

			// Resume visibility — a ping should fire synchronously, well
			// before the next pingIntervalMs would elapse.
			setHidden(false);

			const pings = transport.sentMessages.filter((m) => m.includes('"ping"'));
			expect(pings).toHaveLength(1);
		});

		it("triggers reconnect when the immediate ping on resume gets no pong (zombie socket)", () => {
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
				pingIntervalMs: 30_000,
				pongTimeoutMs: 50,
				pauseHeartbeatWhenHidden: true,
				...pingConfig,
			});
			manager.connect();
			transport.simulateOpen();

			setHidden(true);
			setHidden(false);

			// Pong never arrives — pong timeout fires and the manager
			// disconnects with code 4000, which schedules a reconnect.
			vi.advanceTimersByTime(50);
			const last =
				transport.disconnectCalls[transport.disconnectCalls.length - 1];
			expect(last?.code).toBe(4000);
			expect(last?.reason).toBe("pong timeout");
		});
	});

	describe("send", () => {
		it("returns false when not connected", () => {
			const { manager } = createManager();
			const sent = manager.send({ data: { text: "hi" }, ackId: "msg1" });
			expect(sent).toBe(false);
		});

		it("sends when connected", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();
			transport.sentMessages = [];

			const msg = { text: "hello" };
			const sent = manager.send({ data: msg, ackId: "msg1" });
			expect(sent).toBe(true);
			expect(transport.sentMessages).toHaveLength(1);
			expect(JSON.parse(transport.sentMessages[0])).toEqual(msg);
		});

		it("sends with null id (fire-and-forget)", () => {
			const { manager, transport, droppedInFlightMaps } = createManager();
			manager.connect();
			transport.simulateOpen();
			transport.sentMessages = [];

			const sent = manager.send({ data: { text: "hello" } });
			expect(sent).toBe(true);
			expect(transport.sentMessages).toHaveLength(1);

			// A null-id send is fire-and-forget: it must not be tracked in flight,
			// so a subsequent drop on disconnect fires no inFlightDrop listener.
			transport.simulateClose(1006);
			expect(droppedInFlightMaps).toHaveLength(0);
		});

		it("acknowledges in-flight message via ackInFlight", () => {
			const { manager, transport, droppedInFlightMaps } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.send({ data: { text: "hello" }, ackId: "msg1" });
			manager.ackInFlight("msg1");

			// verify no in-flight drop on disconnect
			transport.simulateClose(1006);
			expect(droppedInFlightMaps).toHaveLength(0);
		});

		it("drops an unacked in-flight message on disconnect (control for the ack test)", () => {
			const { manager, transport, droppedInFlightMaps } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.send({ data: { text: "hello" }, ackId: "msg1" });
			transport.simulateClose(1006);

			expect(droppedInFlightMaps).toHaveLength(1);
			expect(droppedInFlightMaps[0]).toEqual([
				{ id: "msg1", data: { text: "hello" } },
			]);
		});

		it("emits an ack-id-reuse debug event when an ackId is reused while in flight", () => {
			const { manager, transport } = createManager();
			const reuses: string[] = [];
			manager.addDebugListener((event) => {
				if (event.type === "ack-id-reuse") reuses.push(event.ackId);
			});
			manager.connect();
			transport.simulateOpen();

			manager.send({ data: { text: "a" }, ackId: "msg1" });
			expect(reuses).toEqual([]);

			manager.send({ data: { text: "b" }, ackId: "msg1" });
			expect(reuses).toEqual(["msg1"]);

			// After the ack clears the entry, the id is free to reuse.
			manager.ackInFlight("msg1");
			manager.send({ data: { text: "c" }, ackId: "msg1" });
			expect(reuses).toEqual(["msg1"]);
		});
	});

	describe("send intent listener", () => {
		it("fires on every send() call with data and ackId", () => {
			const intents: { data: TTestClientMsg; ackId?: string }[] = [];
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
			});
			manager.addSendIntentListener(({ data, ackId }) => {
				intents.push({ data, ackId });
			});
			manager.connect();
			transport.simulateOpen();

			manager.send({ data: { action: "message" }, ackId: "msg-1" });
			manager.send({ data: { action: "ping" } });

			expect(intents).toHaveLength(2);
			expect(intents[0]).toEqual({
				data: { action: "message" },
				ackId: "msg-1",
			});
			expect(intents[1]).toEqual({
				data: { action: "ping" },
				ackId: undefined,
			});
		});

		it("fires even when not connected (send returns false)", () => {
			const intents: { data: TTestClientMsg; ackId?: string }[] = [];
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
			});
			manager.addSendIntentListener(({ data, ackId }) => {
				intents.push({ data, ackId });
			});
			// Not connected — send() will return false
			const result = manager.send({
				data: { action: "message" },
				ackId: "msg-1",
			});

			expect(result).toBe(false);
			expect(intents).toHaveLength(1);
			expect(intents[0]).toEqual({
				data: { action: "message" },
				ackId: "msg-1",
			});
		});
	});

	describe("idle initial state", () => {
		it("starts as idle before connect() is ever called", () => {
			const { manager } = createManager();
			expect(manager.getConnectionState()).toBe("idle");
		});

		it("exits idle only via connect(): idle -> connecting", () => {
			const { manager, states } = createManager();
			manager.connect();
			expect(states[0]).toBe("connecting");
			expect(manager.getConnectionState()).toBe("connecting");
		});

		it("disconnect() on an idle manager stays idle and emits no transition", () => {
			const { manager, states } = createManager();
			manager.disconnect();
			expect(manager.getConnectionState()).toBe("idle");
			expect(states).toHaveLength(0);
		});

		it("never returns to idle: disconnect() after connect lands on disconnected", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();
			manager.disconnect();
			expect(manager.getConnectionState()).toBe("disconnected");
		});

		it("forceReconnect() also exits idle: idle -> connecting -> connected", () => {
			const { manager, transport, states } = createManager();
			manager.forceReconnect();
			transport.simulateOpen();
			expect(states).toEqual(["connecting", "connected"]);
			expect(transport.connectCalls).toHaveLength(1);
		});

		it("dispose() on an idle manager stays idle, emits no transition, and is terminal", () => {
			const { manager, states } = createManager();
			manager.dispose();
			expect(manager.getConnectionState()).toBe("idle");
			expect(states).toHaveLength(0);
			expect(manager.getSnapshot().disposed).toBe(true);
			expect(() => manager.connect()).toThrow(/disposed/);
		});
	});

	describe("send failed listener", () => {
		it("fires with reason not-connected when sending while down", () => {
			const failures: {
				data: TTestClientMsg;
				ackId?: string;
				reason: string;
			}[] = [];
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
			});
			manager.addSendFailedListener(({ data, ackId, reason }) => {
				failures.push({ data, ackId, reason });
			});

			const result = manager.send({
				data: { action: "message" },
				ackId: "msg-1",
			});

			expect(result).toBe(false);
			expect(failures).toHaveLength(1);
			expect(failures[0]).toEqual({
				data: { action: "message" },
				ackId: "msg-1",
				reason: "not-connected",
			});
		});

		it("fires after the send intent listener for the same send", () => {
			const order: string[] = [];
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
			});
			manager.addSendIntentListener(() => order.push("intent"));
			manager.addSendFailedListener(() => order.push("failed"));

			manager.send({ data: { action: "message" } });

			expect(order).toEqual(["intent", "failed"]);
		});

		it("fires with reason transport-error when the wire write throws", () => {
			class ThrowingTransport extends MockTransport {
				send(): void {
					throw new Error("wire write failed");
				}
			}
			const failures: { data: TTestClientMsg; reason: string }[] = [];
			const transport = new ThrowingTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
			});
			manager.addSendFailedListener(({ data, reason }) => {
				failures.push({ data, reason });
			});
			manager.connect();
			transport.simulateOpen();

			const result = manager.send({ data: { action: "message" } });

			expect(result).toBe(false);
			expect(failures).toHaveLength(1);
			expect(failures[0]).toEqual({
				data: { action: "message" },
				reason: "transport-error",
			});
		});

		it("fires with reason serialize-error when serialize throws, without sending", () => {
			const failures: {
				data: TTestClientMsg;
				ackId?: string;
				reason: string;
			}[] = [];
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				url: "ws://test",
				transport,
				serialize: () => {
					throw new Error("circular structure");
				},
				deserialize: testSerialization.deserialize,
			});
			manager.addSendFailedListener(({ data, ackId, reason }) => {
				failures.push({ data, ackId, reason });
			});
			manager.connect();
			transport.simulateOpen();
			transport.sentMessages = [];

			const result = manager.send({
				data: { action: "message" },
				ackId: "msg-1",
			});

			expect(result).toBe(false);
			expect(transport.sentMessages).toHaveLength(0);
			expect(failures).toHaveLength(1);
			expect(failures[0]).toEqual({
				data: { action: "message" },
				ackId: "msg-1",
				reason: "serialize-error",
			});
		});

		it("does not track transport-error sends with an ackId as in-flight", () => {
			class ThrowingTransport extends MockTransport {
				send(): void {
					throw new Error("wire write failed");
				}
			}
			const transport = new ThrowingTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
			});
			const dropped: { id: string; data: TTestClientMsg }[][] = [];
			manager.addInFlightDropListener((messages) => dropped.push(messages));
			manager.connect();
			transport.simulateOpen();

			manager.send({ data: { action: "message" }, ackId: "msg-1" });
			transport.simulateClose();

			expect(dropped).toHaveLength(0);
		});

		it("does not fire when the send succeeds", () => {
			const failures: unknown[] = [];
			const { manager, transport } = createManager();
			manager.addSendFailedListener((params) => failures.push(params));
			manager.connect();
			transport.simulateOpen();

			const result = manager.send({ data: { action: "message" } });

			expect(result).toBe(true);
			expect(failures).toHaveLength(0);
		});

		it("does not track failed sends as in-flight", () => {
			const { manager, transport } = createManager();
			const dropped: { id: string; data: TTestClientMsg }[][] = [];
			manager.addInFlightDropListener((messages) => dropped.push(messages));

			// Offline send with an ackId — must not enter in-flight tracking.
			manager.send({ data: { action: "message" }, ackId: "msg-1" });

			manager.connect();
			transport.simulateOpen();
			transport.simulateClose();

			expect(dropped).toHaveLength(0);
		});

		it("returns an unsubscribe function that stops notifications", () => {
			const failures: unknown[] = [];
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
			});
			const unsubscribe = manager.addSendFailedListener((params) =>
				failures.push(params),
			);

			manager.send({ data: { action: "one" } });
			unsubscribe();
			manager.send({ data: { action: "two" } });

			expect(failures).toHaveLength(1);
		});
	});

	describe("onMessageReceived", () => {
		it("passes deserialized message to onMessageReceived callback", () => {
			const { manager, transport, rawMessages } = createManager();
			manager.connect();
			transport.simulateOpen();

			transport.simulateMessage(
				JSON.stringify({ type: "chat", text: "hello" }),
			);
			expect(rawMessages).toHaveLength(1);
			expect(rawMessages[0]).toEqual({ type: "chat", text: "hello" });
		});

		it("ignores pong messages when isPong is defined", () => {
			const { manager, transport, rawMessages } = createManager({
				isPong: (msg) => msg.action === "pong",
			});
			manager.connect();
			transport.simulateOpen();

			transport.simulateMessage(
				JSON.stringify({ action: "pong", timestamp: "t" }),
			);
			expect(rawMessages).toHaveLength(0);
		});

		it("forwards pong-like messages when isPong is not defined", () => {
			const { manager, transport, rawMessages } = createManager();
			manager.connect();
			transport.simulateOpen();

			transport.simulateMessage(
				JSON.stringify({ action: "pong", timestamp: "t" }),
			);
			expect(rawMessages).toHaveLength(1);
		});

		it("ignores invalid JSON", () => {
			const { manager, transport, rawMessages } = createManager();
			manager.connect();
			transport.simulateOpen();

			transport.simulateMessage("not json{{{");
			expect(rawMessages).toHaveLength(0);
		});
	});

	describe("custom discriminator", () => {
		it("dispatches keyed listeners by the configured discriminator field", () => {
			type TKindMsg = { kind: string } & Record<string, unknown>;
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TKindMsg, "kind">({
				serialize: (msg: TTestClientMsg) => JSON.stringify(msg),
				deserialize: (raw: string) => JSON.parse(raw) as TKindMsg,
				url: "ws://test",
				transport,
				discriminator: "kind",
			});
			const aMessages: TKindMsg[] = [];
			manager.addEventListener("a", (msg) => aMessages.push(msg));
			manager.connect();
			transport.simulateOpen();

			transport.simulateMessage(JSON.stringify({ kind: "a", n: 1 }));
			expect(aMessages).toHaveLength(1);
			expect(aMessages[0]).toEqual({ kind: "a", n: 1 });

			// A message whose discriminator value does not match the listener
			// key must not reach it.
			transport.simulateMessage(JSON.stringify({ kind: "b", n: 2 }));
			expect(aMessages).toHaveLength(1);
		});
	});

	describe("onReady", () => {
		it("fires after connect", () => {
			const { manager, transport, readyCalls } = createManager();
			manager.connect();
			transport.simulateOpen();
			expect(readyCalls).toHaveLength(1);
		});

		it("fires on reconnect", () => {
			const { manager, transport, readyCalls } = createManager();
			manager.connect();
			transport.simulateOpen();
			transport.simulateClose(1006);
			vi.advanceTimersByTime(200);
			transport.simulateOpen();
			expect(readyCalls).toHaveLength(2);
		});
	});

	describe("onInFlightDrop", () => {
		it("fires with in-flight messages map on disconnect", () => {
			const { manager, transport, droppedInFlightMaps } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.send({ data: { text: "hello" }, ackId: "msg1" });
			transport.simulateClose(1006);

			expect(droppedInFlightMaps).toHaveLength(1);
			expect(droppedInFlightMaps[0]).toEqual([
				{ id: "msg1", data: { text: "hello" } },
			]);
		});

		it("does not fire when no in-flight messages", () => {
			const { manager, transport, droppedInFlightMaps } = createManager();
			manager.connect();
			transport.simulateOpen();
			transport.simulateClose(1006);
			expect(droppedInFlightMaps).toHaveLength(0);
		});

		it("does not fire for acked messages", () => {
			const { manager, transport, droppedInFlightMaps } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.send({ data: { text: "hello" }, ackId: "msg1" });
			manager.ackInFlight("msg1");

			transport.simulateClose(1006);
			expect(droppedInFlightMaps).toHaveLength(0);
		});

		it("null-id sends are not tracked as in-flight", () => {
			const { manager, transport, droppedInFlightMaps } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.send({ data: { text: "hello" } });
			transport.simulateClose(1006);
			expect(droppedInFlightMaps).toHaveLength(0);
		});
	});

	describe("dispose", () => {
		it("cleans up everything", () => {
			const { manager, transport, states } = createManager();
			manager.connect();
			transport.simulateOpen();
			manager.subscribe("conversation:ch1");

			manager.dispose();
			expect(states[states.length - 1]).toBe("disconnected");
			expect(manager.getRefCount("conversation:ch1")).toBe(0);
		});

		it("does not reconnect after dispose", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();
			manager.dispose();

			const callsBefore = transport.connectCalls.length;
			vi.advanceTimersByTime(10_000);
			expect(transport.connectCalls.length).toBe(callsBefore);
		});
	});

	describe("setProtocols", () => {
		it("passes protocols when set before connect", () => {
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
			});
			manager.setProtocols(["access_token", "my-token"]);
			manager.connect();
			expect(transport.connectCalls[0].protocols).toEqual([
				"access_token",
				"my-token",
			]);
		});

		it("omits protocols when none set", () => {
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
			});
			manager.connect();
			expect(transport.connectCalls[0].protocols).toBeUndefined();
		});

		it("replaces previous protocols on each call", () => {
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
			});
			manager.setProtocols(["access_token", "my-token"]);
			manager.setProtocols(["replacement"]);
			manager.connect();
			expect(transport.connectCalls[0].protocols).toEqual(["replacement"]);
		});

		it("clears protocols when called with an empty array", () => {
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
			});
			manager.setProtocols(["initial"]);
			manager.setProtocols([]);
			manager.connect();
			expect(transport.connectCalls[0].protocols).toBeUndefined();
		});
	});

	describe("addConnectionStateListener", () => {
		it("notifies listeners on state change", () => {
			const { manager, transport } = createManager();
			const stateChanges: TConnectionState[] = [];

			manager.addConnectionStateListener(() => {
				stateChanges.push(manager.getConnectionState());
			});

			manager.connect();
			expect(stateChanges).toContain("connecting");

			transport.simulateOpen();
			expect(stateChanges).toContain("connected");
		});

		it("returns unsubscribe function", () => {
			const { manager, transport } = createManager();
			let callCount = 0;

			const unsub = manager.addConnectionStateListener(() => {
				callCount++;
			});

			manager.connect();
			expect(callCount).toBe(1);

			unsub();
			transport.simulateOpen();
			expect(callCount).toBe(1);
		});
	});

	describe("onLastUnsubscribe", () => {
		it("fires when ref count hits 0", () => {
			const lastUnsubKeys: string[] = [];
			const { manager, transport } = createManager({
				onLastUnsubscribe: (key) => lastUnsubKeys.push(key),
			});
			manager.connect();
			transport.simulateOpen();

			manager.subscribe("conversation:ch1");
			manager.unsubscribe("conversation:ch1");

			expect(lastUnsubKeys).toEqual(["conversation:ch1"]);
		});

		it("does not fire when ref count is still > 0", () => {
			const lastUnsubKeys: string[] = [];
			const { manager, transport } = createManager({
				onLastUnsubscribe: (key) => lastUnsubKeys.push(key),
			});
			manager.connect();
			transport.simulateOpen();

			manager.subscribe("conversation:ch1");
			manager.subscribe("conversation:ch1");
			manager.unsubscribe("conversation:ch1");

			expect(lastUnsubKeys).toHaveLength(0);
		});
	});

	describe("online/offline handlers", () => {
		it("offline tears down socket and sets reconnecting", () => {
			const { manager, transport, states } = createManager();
			manager.connect();
			transport.simulateOpen();

			window.dispatchEvent(new Event("offline"));

			expect(states[states.length - 1]).toBe("reconnecting");
			expect(transport.disconnectCalls.length).toBeGreaterThan(0);
		});

		it("online reconnects after offline", () => {
			const { manager, transport, states } = createManager({
				reconnectBaseDelayMs: 10,
			});
			manager.connect();
			transport.simulateOpen();

			window.dispatchEvent(new Event("offline"));
			expect(states[states.length - 1]).toBe("reconnecting");

			const callsBefore = transport.connectCalls.length;

			window.dispatchEvent(new Event("online"));
			vi.advanceTimersByTime(10_000);

			expect(transport.connectCalls.length).toBeGreaterThan(callsBefore);
		});

		it("online does not reconnect after intentional disconnect", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.disconnect();
			const callsBefore = transport.connectCalls.length;

			window.dispatchEvent(new Event("online"));
			vi.advanceTimersByTime(200);

			expect(transport.connectCalls.length).toBe(callsBefore);
		});

		it("online is a no-op while already connected", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();
			expect(manager.getConnectionState()).toBe("connected");

			const callsBefore = transport.connectCalls.length;
			window.dispatchEvent(new Event("online"));
			// Advance past the max backoff window — a stray reconnect would have
			// fired by now.
			vi.advanceTimersByTime(200);

			expect(transport.connectCalls).toHaveLength(callsBefore);
			expect(manager.getConnectionState()).toBe("connected");
		});

		it("online is a no-op while still connecting", () => {
			const { manager, transport } = createManager();
			manager.connect();
			expect(manager.getConnectionState()).toBe("connecting");

			const callsBefore = transport.connectCalls.length;
			window.dispatchEvent(new Event("online"));
			vi.advanceTimersByTime(200);

			expect(transport.connectCalls).toHaveLength(callsBefore);
			expect(manager.getConnectionState()).toBe("connecting");
		});

		it("offline detaches the live close handler so a stale drop is inert", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();

			// Capture the live close handler installed on the socket.
			const liveOnclose = transport.onclose;
			expect(liveOnclose).not.toBeNull();

			window.dispatchEvent(new Event("offline"));
			expect(manager.getConnectionState()).toBe("reconnecting");

			// handleOffline detaches all transport handlers and closes the
			// socket. A stale drop arriving through the transport surface (the
			// only path the real transport exposes — guarded by the live socket
			// ref) must therefore be inert: onclose is nulled and the socket is
			// already CLOSED, so simulateClose does nothing.
			expect(transport.onclose).toBeNull();
			const callsBefore = transport.connectCalls.length;
			transport.simulateClose(1006);

			// handleOffline arms no reconnect timer (it waits for `online`), so the
			// stale close must not schedule one and the state stays reconnecting.
			vi.advanceTimersByTime(200);
			expect(transport.connectCalls.length).toBe(callsBefore);
			expect(manager.getConnectionState()).toBe("reconnecting");
		});
	});

	describe("edge cases", () => {
		it("subscribe without data does not send", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();
			transport.sentMessages = [];

			manager.subscribe("key");

			expect(transport.sentMessages).toHaveLength(0);
		});

		it("unsubscribe when not subscribed is no-op", () => {
			const lastUnsubKeys: string[] = [];
			const { manager, transport } = createManager({
				onLastUnsubscribe: (key) => lastUnsubKeys.push(key),
			});
			manager.connect();
			transport.simulateOpen();
			transport.sentMessages = [];

			manager.unsubscribe("nonexistent", unsubMsg("conversation", "x"));

			expect(manager.getRefCount("nonexistent")).toBe(0);
			// A ref count that never went above 0 means no wire frame and no
			// last-unsubscribe notification.
			expect(transport.sentMessages).toHaveLength(0);
			expect(lastUnsubKeys).toHaveLength(0);
		});

		it("throws when connect is called after dispose", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.dispose();

			expect(() => manager.connect()).toThrow(/disposed/);
		});

		it("connect is idempotent when already connecting", () => {
			const { manager, transport } = createManager();
			manager.connect();
			manager.connect();

			expect(transport.connectCalls).toHaveLength(1);
		});

		it("connect is idempotent when already connected", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.connect();

			expect(transport.connectCalls).toHaveLength(1);
		});
	});

	describe("forceReconnect", () => {
		it("disconnects and reconnects when connected", () => {
			const { manager, transport, states } = createManager();
			manager.connect();
			transport.simulateOpen();
			states.length = 0;

			manager.forceReconnect();

			expect(transport.disconnectCalls).toHaveLength(1);
			expect(transport.disconnectCalls[0].code).toBe(4000);
			expect(transport.disconnectCalls[0].reason).toBe("force reconnect");
			expect(transport.connectCalls).toHaveLength(2);
			// Coalesced transition: connected -> connecting (no "disconnected" blip).
			expect(states).not.toContain("disconnected");
			expect(states).toContain("connecting");

			transport.simulateOpen();
			expect(states[states.length - 1]).toBe("connected");
		});

		it("restores subscriptions after reconnect", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
			manager.subscribe("conversation:ch2", subMsg("conversation", "ch2"));
			transport.sentMessages = [];

			manager.forceReconnect();
			transport.simulateOpen();

			expect(transport.sentMessages).toHaveLength(2);
			// Both subscriptions must replay with their original payloads.
			const restored = transport.sentMessages.map((m) => JSON.parse(m));
			expect(restored).toContainEqual({
				action: "subscribe",
				type: "conversation",
				channel: "ch1",
			});
			expect(restored).toContainEqual({
				action: "subscribe",
				type: "conversation",
				channel: "ch2",
			});
		});

		it("drops in-flight messages", () => {
			const { manager, transport, droppedInFlightMaps } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.send({ data: { action: "msg1" }, ackId: "id-1" });
			manager.send({ data: { action: "msg2" }, ackId: "id-2" });

			manager.forceReconnect();

			expect(droppedInFlightMaps).toHaveLength(1);
			const ids = droppedInFlightMaps[0].map((m) => m.id);
			expect(ids).toContain("id-1");
			expect(ids).toContain("id-2");
		});

		it("is a no-op when disposed", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();
			manager.dispose();
			transport.disconnectCalls = [];

			manager.forceReconnect();

			expect(transport.disconnectCalls).toHaveLength(0);
		});

		it("works when already disconnected", () => {
			const { manager, transport, states } = createManager();
			manager.connect();
			transport.simulateOpen();
			transport.simulateClose(1006);
			states.length = 0;
			transport.disconnectCalls = [];

			vi.runAllTimers();

			manager.forceReconnect();

			expect(states).toContain("connecting");
			transport.simulateOpen();
			expect(states[states.length - 1]).toBe("connected");
		});

		it("resets reconnect attempt counter", () => {
			const { manager, transport, states } = createManager({
				reconnectMaxAttempts: 5,
			});
			manager.connect();
			transport.simulateOpen();

			// Simulate a few failed reconnects
			transport.simulateClose(1006);
			vi.advanceTimersByTime(50);
			transport.simulateClose(1006);
			vi.advanceTimersByTime(100);
			transport.simulateClose(1006);

			// forceReconnect should start fresh
			manager.forceReconnect();
			transport.simulateOpen();
			expect(states[states.length - 1]).toBe("connected");

			// Should be able to reconnect again after failure (attempt counter was reset)
			transport.simulateClose(1006);
			expect(states[states.length - 1]).toBe("reconnecting");
		});

		it("revives a manager that exhausted its reconnect attempts", () => {
			const { manager, transport, states } = createManager({
				reconnectBaseDelayMs: 10,
				reconnectMaxAttempts: 2,
			});
			manager.connect();
			transport.simulateOpen();

			// Drop the connection and fail every scheduled reconnect until the
			// attempt budget is exhausted and the manager gives up.
			transport.simulateClose(1006);
			for (
				let i = 0;
				i < 8 && manager.getConnectionState() !== "disconnected";
				i++
			) {
				const callsBefore = transport.connectCalls.length;
				vi.advanceTimersByTime(200);
				if (transport.connectCalls.length > callsBefore) {
					transport.simulateClose(1006);
				}
			}
			expect(manager.getConnectionState()).toBe("disconnected");

			// forceReconnect must reset the exhausted counter and start a fresh
			// connect — proving the reset is what brings a dead manager back.
			const callsBefore = transport.connectCalls.length;
			states.length = 0;
			manager.forceReconnect();

			expect(manager.getConnectionState()).toBe("connecting");
			expect(states).toContain("connecting");
			expect(transport.connectCalls.length).toBe(callsBefore + 1);
			// The counter reset happens at forceReconnect time, before the socket
			// opens — so even a drop BEFORE handleOpen (which would otherwise reset
			// it) must schedule a reconnect rather than jump straight back to the
			// exhausted "disconnected" state.
			expect(manager.getSnapshot().reconnectAttempt).toBe(0);
			transport.simulateClose(1006);
			expect(manager.getConnectionState()).toBe("reconnecting");

			// And the revived connection still opens cleanly on the next attempt.
			vi.advanceTimersByTime(200);
			transport.simulateOpen();
			expect(manager.getConnectionState()).toBe("connected");
		});

		it("nullifies old handlers to prevent stale events", () => {
			const { manager, transport, states } = createManager();
			manager.connect();
			transport.simulateOpen();

			// Capture the live handler refs BEFORE forceReconnect so we can prove
			// they were swapped out, not reused.
			const oldOnclose = transport.onclose;
			const oldOnopen = transport.onopen;
			const oldOnmessage = transport.onmessage;
			const oldOnerror = transport.onerror;
			expect(oldOnclose).not.toBeNull();
			expect(oldOnopen).not.toBeNull();
			expect(oldOnmessage).not.toBeNull();
			expect(oldOnerror).not.toBeNull();

			manager.forceReconnect();

			// forceReconnect tears down the old socket (handlers nullified during
			// teardown) and reinstalls a fresh set for the new connection. The new
			// handlers must be distinct references, proving the swap happened — a
			// stale socket holding the old refs can no longer route into the
			// manager's current connection.
			expect(transport.onclose).not.toBeNull();
			expect(transport.onopen).not.toBeNull();
			expect(transport.onmessage).not.toBeNull();
			expect(transport.onerror).not.toBeNull();
			expect(transport.onclose).not.toBe(oldOnclose);
			expect(transport.onopen).not.toBe(oldOnopen);
			expect(transport.onmessage).not.toBe(oldOnmessage);
			expect(transport.onerror).not.toBe(oldOnerror);

			// The new connection should work normally
			transport.simulateOpen();
			expect(states[states.length - 1]).toBe("connected");
		});
	});

	describe("dynamic url", () => {
		it("calls url function on connect and passes resolved url to transport", async () => {
			const transport = new MockTransport();
			const urlFn = vi.fn(() => "ws://test?token=abc");
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: urlFn,
				transport,
			});

			manager.connect();
			await vi.waitFor(() => {
				expect(transport.connectCalls).toHaveLength(1);
			});
			expect(urlFn).toHaveBeenCalledTimes(1);
			expect(transport.connectCalls[0].url).toBe("ws://test?token=abc");
		});

		it("awaits async url function before connecting", async () => {
			const transport = new MockTransport();
			let resolve!: (url: string) => void;
			const pending = new Promise<string>((r) => {
				resolve = r;
			});
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: () => pending,
				transport,
			});

			manager.connect();
			expect(transport.connectCalls).toHaveLength(0);

			resolve("ws://test?token=xyz");
			await vi.waitFor(() => {
				expect(transport.connectCalls).toHaveLength(1);
			});
			expect(transport.connectCalls[0].url).toBe("ws://test?token=xyz");
		});

		it("calls url function again on every reconnect (token refresh)", async () => {
			const transport = new MockTransport();
			let token = "t1";
			const urlFn = vi.fn(() => `ws://test?token=${token}`);
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: urlFn,
				transport,
				reconnectBaseDelayMs: 10,
				reconnectMaxDelayMs: 100,
				reconnectMaxAttempts: 3,
			});

			manager.connect();
			await vi.waitFor(() => {
				expect(transport.connectCalls).toHaveLength(1);
			});
			expect(transport.connectCalls[0].url).toBe("ws://test?token=t1");

			token = "t2";
			manager.forceReconnect();
			await vi.waitFor(() => {
				expect(transport.connectCalls).toHaveLength(2);
			});
			expect(urlFn).toHaveBeenCalledTimes(2);
			expect(transport.connectCalls[1].url).toBe("ws://test?token=t2");
		});

		it("calls url function on scheduled reconnect after drop", async () => {
			const transport = new MockTransport();
			let token = "t1";
			const urlFn = vi.fn(() => `ws://test?token=${token}`);
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: urlFn,
				transport,
				reconnectBaseDelayMs: 10,
				reconnectMaxDelayMs: 100,
				reconnectMaxAttempts: 3,
			});

			manager.connect();
			await vi.waitFor(() => {
				expect(transport.connectCalls).toHaveLength(1);
			});
			transport.simulateOpen();

			token = "t2";
			transport.simulateClose(1006);
			await vi.advanceTimersByTimeAsync(200);

			expect(urlFn).toHaveBeenCalledTimes(2);
			expect(transport.connectCalls[1].url).toBe("ws://test?token=t2");
		});

		it("emits url-resolve-error and schedules reconnect on sync throw", async () => {
			const transport = new MockTransport();
			const debugEvents: string[] = [];
			let shouldFail = true;
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: () => {
					if (shouldFail) throw new Error("token refresh failed");
					return "ws://test";
				},
				transport,
				reconnectBaseDelayMs: 10,
				reconnectMaxDelayMs: 100,
				reconnectMaxAttempts: 3,
				onDebug: (e) => debugEvents.push(e.type),
			});

			manager.connect();
			await vi.waitFor(() => {
				expect(debugEvents).toContain("url-resolve-error");
			});
			expect(transport.connectCalls).toHaveLength(0);

			shouldFail = false;
			await vi.advanceTimersByTimeAsync(200);
			expect(transport.connectCalls).toHaveLength(1);
		});

		it("emits url-resolve-error and schedules reconnect on async rejection", async () => {
			const transport = new MockTransport();
			const debugEvents: string[] = [];
			let shouldFail = true;
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: async () => {
					if (shouldFail) throw new Error("token refresh failed");
					return "ws://test";
				},
				transport,
				reconnectBaseDelayMs: 10,
				reconnectMaxDelayMs: 100,
				reconnectMaxAttempts: 3,
				onDebug: (e) => debugEvents.push(e.type),
			});

			manager.connect();
			await vi.waitFor(() => {
				expect(debugEvents).toContain("url-resolve-error");
			});
			expect(transport.connectCalls).toHaveLength(0);

			shouldFail = false;
			await vi.advanceTimersByTimeAsync(200);
			expect(transport.connectCalls).toHaveLength(1);
		});

		it("aborts pending url resolution when disposed", async () => {
			const transport = new MockTransport();
			let resolve!: (url: string) => void;
			const pending = new Promise<string>((r) => {
				resolve = r;
			});
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: () => pending,
				transport,
			});

			manager.connect();
			manager.dispose();

			resolve("ws://test?token=late");
			await vi.advanceTimersByTimeAsync(50);
			expect(transport.connectCalls).toHaveLength(0);
		});

		it("supersedes stale url resolution on forceReconnect", async () => {
			const transport = new MockTransport();
			// Each entry resolves its captured url; the calls take no args.
			const pendings: Array<() => void> = [];
			const urls: string[] = ["ws://test?token=stale", "ws://test?token=fresh"];
			let callIndex = 0;
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: () =>
					new Promise<string>((r) => {
						const expected = urls[callIndex++];
						pendings.push(() => r(expected));
					}),
				transport,
			});

			manager.connect();
			manager.forceReconnect();

			// Resolve the first (stale) url first; it should be ignored
			pendings[0]();
			await vi.advanceTimersByTimeAsync(10);
			expect(transport.connectCalls).toHaveLength(0);

			// Resolve the second (fresh) url; it should be used
			pendings[1]();
			await vi.waitFor(() => {
				expect(transport.connectCalls).toHaveLength(1);
			});
			expect(transport.connectCalls[0].url).toBe("ws://test?token=fresh");
		});
	});

	describe("beforeConnect", () => {
		it("awaits beforeConnect before opening the socket on the first connect", async () => {
			const transport = new MockTransport();
			let release!: () => void;
			const gate = new Promise<void>((r) => {
				release = r;
			});
			const beforeConnect = vi.fn(() => gate);
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
				beforeConnect,
			});

			manager.connect();
			// Gated: state is already "connecting" but no socket has opened.
			expect(beforeConnect).toHaveBeenCalledTimes(1);
			expect(beforeConnect).toHaveBeenCalledWith({
				attempt: 0,
				trigger: "connect",
			});
			expect(transport.connectCalls).toHaveLength(0);
			expect(manager.getConnectionState()).toBe("connecting");

			release();
			await vi.waitFor(() => {
				expect(transport.connectCalls).toHaveLength(1);
			});
		});

		it("runs beforeConnect on a scheduled reconnect with trigger 'reconnect'", async () => {
			const transport = new MockTransport();
			const calls: TBeforeConnectContext[] = [];
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
				reconnectBaseDelayMs: 10,
				reconnectMaxDelayMs: 100,
				reconnectMaxAttempts: 3,
				beforeConnect: (ctx) => {
					calls.push(ctx);
				},
			});

			manager.connect();
			await vi.waitFor(() => expect(transport.connectCalls).toHaveLength(1));
			transport.simulateOpen();

			transport.simulateClose(1006);
			await vi.advanceTimersByTimeAsync(200);

			expect(calls[0]).toEqual({ attempt: 0, trigger: "connect" });
			expect(calls.some((c) => c.trigger === "reconnect")).toBe(true);
			expect(transport.connectCalls.length).toBeGreaterThanOrEqual(2);
		});

		it("runs beforeConnect with trigger 'forceReconnect' on forceReconnect()", async () => {
			const transport = new MockTransport();
			const calls: TBeforeConnectContext[] = [];
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
				beforeConnect: (ctx) => {
					calls.push(ctx);
				},
			});

			manager.connect();
			await vi.waitFor(() => expect(transport.connectCalls).toHaveLength(1));
			transport.simulateOpen();

			manager.forceReconnect();
			await vi.waitFor(() => expect(transport.connectCalls).toHaveLength(2));

			expect(calls).toEqual([
				{ attempt: 0, trigger: "connect" },
				{ attempt: 0, trigger: "forceReconnect" },
			]);
		});

		it("aborts to disconnected and emits before-connect-error when beforeConnect throws", async () => {
			const transport = new MockTransport();
			const debugEvents: string[] = [];
			const states: TConnectionState[] = [];
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
				beforeConnect: () => {
					throw new Error("prep failed");
				},
				onDebug: (e) => debugEvents.push(e.type),
			});
			manager.addConnectionStateListener(() =>
				states.push(manager.getConnectionState()),
			);

			manager.connect();
			await vi.waitFor(() => {
				expect(manager.getConnectionState()).toBe("disconnected");
			});
			expect(transport.connectCalls).toHaveLength(0);
			expect(debugEvents).toContain("before-connect-error");
			expect(states).toEqual(["connecting", "disconnected"]);
		});

		it("runs beforeConnect before resolving a dynamic url", async () => {
			const transport = new MockTransport();
			const order: string[] = [];
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: () => {
					order.push("url");
					return "ws://test?token=1";
				},
				transport,
				beforeConnect: () => {
					order.push("beforeConnect");
				},
			});

			manager.connect();
			await vi.waitFor(() => expect(transport.connectCalls).toHaveLength(1));
			expect(order).toEqual(["beforeConnect", "url"]);
		});

		it("does not open the socket if disconnect() lands during the beforeConnect await", async () => {
			const transport = new MockTransport();
			let release!: () => void;
			const gate = new Promise<void>((r) => {
				release = r;
			});
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
				beforeConnect: () => gate,
			});

			manager.connect();
			manager.disconnect();
			release();
			await vi.advanceTimersByTimeAsync(10);
			expect(transport.connectCalls).toHaveLength(0);
		});
	});

	describe("window listener attachment", () => {
		it("does not double-attach when connect() is called from reconnecting state", () => {
			if (typeof window === "undefined") return;
			const { manager, transport } = createManager({
				reconnectBaseDelayMs: 10,
				reconnectMaxAttempts: 3,
			});
			const addSpy = vi.spyOn(window, "addEventListener");
			const removeSpy = vi.spyOn(window, "removeEventListener");

			manager.connect();
			transport.simulateOpen();
			const initialAdds = addSpy.mock.calls.filter(
				(c) => c[0] === "online" || c[0] === "offline",
			).length;
			expect(initialAdds).toBe(2);

			// Force the manager into "reconnecting"
			transport.simulateClose(1006);

			// Calling connect() again from reconnecting must not add another pair
			manager.connect();
			const totalAdds = addSpy.mock.calls.filter(
				(c) => c[0] === "online" || c[0] === "offline",
			).length;
			expect(totalAdds).toBe(2);

			manager.disconnect();
			const totalRemoves = removeSpy.mock.calls.filter(
				(c) => c[0] === "online" || c[0] === "offline",
			).length;
			expect(totalRemoves).toBe(2);

			addSpy.mockRestore();
			removeSpy.mockRestore();
		});
	});

	describe("transport-error debug event", () => {
		it("emits transport-error when the transport fires onerror", () => {
			const debugEvents: TDebugEvent<TTestClientMsg, TTestServerMsg>[] = [];
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
				onDebug: (e) => debugEvents.push(e),
			});

			manager.connect();
			transport.simulateOpen();
			transport.simulateError();

			const errorEvents = debugEvents.filter(
				(e) => e.type === "transport-error",
			);
			expect(errorEvents).toHaveLength(1);
			// transport-error carries no extra payload beyond the envelope
			// (type + monotonic id + timestamp) — assert the full shape.
			const event = errorEvents[0];
			expect(event.type).toBe("transport-error");
			expect(typeof event.id).toBe("number");
			expect(typeof event.timestamp).toBe("number");
			expect(Object.keys(event).sort()).toEqual(["id", "timestamp", "type"]);
		});
	});
});
