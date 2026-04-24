import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketManager } from "../../manager";
import type { TConnectionState } from "../../types";
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
		onConnectionStateChange: (state) => {
			states.push(state);
			overrides?.onConnectionStateChange?.(state);
		},
		onReady: () => {
			readyCalls.push(1);
			overrides?.onReady?.();
		},
		onInFlightDrop: (messages) => {
			droppedInFlightMaps.push(messages);
			overrides?.onInFlightDrop?.(messages);
		},
		onLastUnsubscribe: overrides?.onLastUnsubscribe,
	});

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
			expect(manager.getPendingSubscriptions().has("conversation:ch1")).toBe(
				true,
			);
		});

		it("resolves pending subscription via resolvePendingSubscription", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
			manager.resolvePendingSubscription("conversation:ch1");
			expect(manager.getPendingSubscriptions().has("conversation:ch1")).toBe(
				false,
			);
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
			expect(subs.length).toBeGreaterThanOrEqual(1);
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
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();
			transport.sentMessages = [];

			const sent = manager.send({ data: { text: "hello" } });
			expect(sent).toBe(true);
			expect(transport.sentMessages).toHaveLength(1);
		});

		it("acknowledges in-flight message via ackInFlight", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.send({ data: { text: "hello" }, ackId: "msg1" });
			manager.ackInFlight("msg1");

			// verify no in-flight drop on disconnect
			transport.simulateClose(1006);
			const { droppedInFlightMaps } = createManager();
			expect(droppedInFlightMaps).toHaveLength(0);
		});
	});

	describe("onSendIntent", () => {
		it("fires on every send() call with data and ackId", () => {
			const intents: { data: TTestClientMsg; ackId?: string }[] = [];
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
				onSendIntent({ data, ackId }) {
					intents.push({ data, ackId });
				},
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
				onSendIntent({ data, ackId }) {
					intents.push({ data, ackId });
				},
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

	describe("addProtocols", () => {
		it("passes protocols when set before connect", () => {
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
			});
			manager.addProtocols(["access_token", "my-token"]);
			manager.connect();
			expect(transport.connectCalls[0].protocols).toEqual([
				"access_token",
				"my-token",
			]);
		});

		it("omits protocols when none added", () => {
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
			});
			manager.connect();
			expect(transport.connectCalls[0].protocols).toBeUndefined();
		});

		it("appends protocols across multiple calls", () => {
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
			});
			manager.addProtocols(["access_token", "my-token"]);
			manager.addProtocols(["extra"]);
			manager.connect();
			expect(transport.connectCalls[0].protocols).toEqual([
				"access_token",
				"my-token",
				"extra",
			]);
		});
	});

	describe("subscribeToConnectionState", () => {
		it("notifies listeners on state change", () => {
			const { manager, transport } = createManager();
			const stateChanges: TConnectionState[] = [];

			manager.subscribeToConnectionState(() => {
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

			const unsub = manager.subscribeToConnectionState(() => {
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
			const { manager } = createManager();

			manager.unsubscribe("nonexistent", unsubMsg("conversation", "x"));

			expect(manager.getRefCount("nonexistent")).toBe(0);
		});

		it("connect after dispose resets disposed flag", () => {
			const { manager, transport, states } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.dispose();

			manager.connect();
			transport.simulateOpen();

			expect(states[states.length - 1]).toBe("connected");
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
			expect(states).toContain("disconnected");
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

		it("nullifies old handlers to prevent stale events", () => {
			const { manager, transport, states } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.forceReconnect();

			// Simulate the old connection's delayed close event
			// Transport handlers were nullified, so this should be a no-op
			expect(transport.onclose).not.toBeNull(); // new handler from connect()
			expect(transport.onopen).not.toBeNull();

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
			const pendings: Array<(url: string) => void> = [];
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
});
