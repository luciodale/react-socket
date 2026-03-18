import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketManager } from "../../manager";
import type { TDebugEvent } from "../../types";
import { MockTransport } from "../helpers/mock-transport";

// ── Test types ──────────────────────────────────────────────────────

type TTestClientMsg = Record<string, unknown>;
type TTestServerMsg = Record<string, unknown>;

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
	onDebug?: (event: TDebugEvent<TTestClientMsg, TTestServerMsg>) => void;
	ping?: TTestClientMsg;
	isPong?: (msg: TTestServerMsg) => boolean;
	pingIntervalMs?: number;
	pongTimeoutMs?: number;
	reconnectBaseDelayMs?: number;
	reconnectMaxAttempts?: number;
}) {
	const transport = overrides?.transport ?? new MockTransport();
	const events: TDebugEvent<TTestClientMsg, TTestServerMsg>[] = [];

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
		onMessageReceived: overrides?.onMessageReceived,
		onDebug: (event) => {
			events.push(event);
			overrides?.onDebug?.(event);
		},
	});

	return { manager, transport, events };
}

function eventsOfType<
	T extends TDebugEvent<TTestClientMsg, TTestServerMsg>["type"],
>(
	events: TDebugEvent<TTestClientMsg, TTestServerMsg>[],
	type: T,
): Extract<TDebugEvent<TTestClientMsg, TTestServerMsg>, { type: T }>[] {
	return events.filter(
		(
			e,
		): e is Extract<TDebugEvent<TTestClientMsg, TTestServerMsg>, { type: T }> =>
			e.type === type,
	);
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("WebSocketManager debug events", () => {
	describe("addDebugListener", () => {
		it("returns an unsubscribe function", () => {
			const { manager } = createManager();
			const received: TDebugEvent<TTestClientMsg, TTestServerMsg>[] = [];
			const unsub = manager.addDebugListener((e) => received.push(e));

			manager.connect();
			expect(received.length).toBeGreaterThan(0);

			const countBefore = received.length;
			unsub();

			// further state changes should not reach this listener
			manager.disconnect();
			expect(received.length).toBe(countBefore);
		});

		it("supports multiple listeners simultaneously", () => {
			const { manager } = createManager();
			const a: TDebugEvent<TTestClientMsg, TTestServerMsg>[] = [];
			const b: TDebugEvent<TTestClientMsg, TTestServerMsg>[] = [];

			manager.addDebugListener((e) => a.push(e));
			manager.addDebugListener((e) => b.push(e));

			manager.connect();
			expect(a.length).toBeGreaterThan(0);
			expect(a.length).toBe(b.length);
		});
	});

	describe("onDebug config callback", () => {
		it("delivers debug events via the config callback", () => {
			const configEvents: TDebugEvent<TTestClientMsg, TTestServerMsg>[] = [];
			const { manager } = createManager({
				onDebug: (e) => configEvents.push(e),
			});

			manager.connect();
			expect(configEvents.length).toBeGreaterThan(0);
			expect(configEvents[0].type).toBe("connection-state-change");
		});
	});

	describe("connection-state-change events", () => {
		it("emits correct from/to on connect", () => {
			const { manager, transport, events } = createManager();
			manager.connect();
			transport.simulateOpen();

			const stateEvents = eventsOfType(events, "connection-state-change");
			expect(stateEvents).toHaveLength(2);
			expect(stateEvents[0]).toMatchObject({
				from: "disconnected",
				to: "connecting",
			});
			expect(stateEvents[1]).toMatchObject({
				from: "connecting",
				to: "connected",
			});
		});

		it("emits correct from/to on disconnect", () => {
			const { manager, transport, events } = createManager();
			manager.connect();
			transport.simulateOpen();
			manager.disconnect();

			const stateEvents = eventsOfType(events, "connection-state-change");
			expect(stateEvents[stateEvents.length - 1]).toMatchObject({
				from: "connected",
				to: "disconnected",
			});
		});

		it("emits reconnecting state on abnormal close", () => {
			const { manager, transport, events } = createManager();
			manager.connect();
			transport.simulateOpen();
			transport.simulateClose(1006);

			const stateEvents = eventsOfType(events, "connection-state-change");
			const last = stateEvents[stateEvents.length - 1];
			expect(last).toMatchObject({ from: "connected", to: "reconnecting" });
		});
	});

	describe("message-received events", () => {
		it("emits with raw, deserialized, isPong: false for normal messages", () => {
			const { manager, transport, events } = createManager();
			manager.connect();
			transport.simulateOpen();

			const rawStr = JSON.stringify({ type: "chat", text: "hello" });
			transport.simulateMessage(rawStr);

			const msgEvents = eventsOfType(events, "message-received");
			expect(msgEvents).toHaveLength(1);
			expect(msgEvents[0].raw).toBe(rawStr);
			expect(msgEvents[0].deserialized).toEqual({
				type: "chat",
				text: "hello",
			});
			expect(msgEvents[0].isPong).toBe(false);
		});
	});

	describe("pong as message-received", () => {
		it("emits message-received with isPong: true for pong messages", () => {
			const { manager, transport, events } = createManager({
				isPong: (msg) => msg.action === "pong",
			});
			manager.connect();
			transport.simulateOpen();

			const rawStr = JSON.stringify({ action: "pong", ts: 1 });
			transport.simulateMessage(rawStr);

			const msgEvents = eventsOfType(events, "message-received");
			expect(msgEvents).toHaveLength(1);
			expect(msgEvents[0].isPong).toBe(true);
			expect(msgEvents[0].raw).toBe(rawStr);
			expect(msgEvents[0].deserialized).toEqual({ action: "pong", ts: 1 });
		});
	});

	describe("deserialize-error events", () => {
		it("emits when deserialization fails", () => {
			const { manager, transport, events } = createManager();
			manager.connect();
			transport.simulateOpen();

			transport.simulateMessage("not valid json{{{");

			const errEvents = eventsOfType(events, "deserialize-error");
			expect(errEvents).toHaveLength(1);
			expect(errEvents[0].raw).toBe("not valid json{{{");
			expect(errEvents[0].error).toBeDefined();
		});
	});

	describe("message-sent events", () => {
		it("emits with ackId, raw, deserialized when send succeeds", () => {
			const { manager, transport, events } = createManager();
			manager.connect();
			transport.simulateOpen();

			const msg = { text: "hello" };
			manager.send({ data: msg, ackId: "msg1" });

			const sentEvents = eventsOfType(events, "message-sent");
			expect(sentEvents).toHaveLength(1);
			expect(sentEvents[0].ackId).toBe("msg1");
			expect(sentEvents[0].raw).toBe(JSON.stringify(msg));
			expect(sentEvents[0].deserialized).toEqual(msg);
		});

		it("emits with null ackId for fire-and-forget", () => {
			const { manager, transport, events } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.send({ data: { text: "fire" } });

			const sentEvents = eventsOfType(events, "message-sent");
			expect(sentEvents).toHaveLength(1);
			expect(sentEvents[0].ackId).toBeUndefined();
		});

		it("does NOT emit when not connected", () => {
			const { manager, events } = createManager();
			manager.send({ data: { text: "hi" }, ackId: "msg1" });

			const sentEvents = eventsOfType(events, "message-sent");
			expect(sentEvents).toHaveLength(0);
		});
	});

	describe("subscribe/unsubscribe events", () => {
		it("emits subscribe with key, refCount, raw, deserialized", () => {
			const { manager, transport, events } = createManager();
			manager.connect();
			transport.simulateOpen();

			const data = subMsg("conversation", "ch1");
			manager.subscribe("conversation:ch1", data);

			const subEvents = eventsOfType(events, "subscribe");
			expect(subEvents).toHaveLength(1);
			expect(subEvents[0].key).toBe("conversation:ch1");
			expect(subEvents[0].refCount).toBe(1);
			expect(subEvents[0].raw).toBe(JSON.stringify(data));
			expect(subEvents[0].deserialized).toEqual(data);
		});

		it("emits subscribe with incrementing refCount", () => {
			const { manager, transport, events } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));

			const subEvents = eventsOfType(events, "subscribe");
			expect(subEvents).toHaveLength(2);
			expect(subEvents[0].refCount).toBe(1);
			expect(subEvents[1].refCount).toBe(2);
		});

		it("emits subscribe without raw/deserialized when no data", () => {
			const { manager, transport, events } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.subscribe("conversation:ch1");

			const subEvents = eventsOfType(events, "subscribe");
			expect(subEvents).toHaveLength(1);
			expect(subEvents[0]).not.toHaveProperty("raw");
			expect(subEvents[0]).not.toHaveProperty("deserialized");
		});

		it("emits unsubscribe with correct refCount and raw/deserialized", () => {
			const { manager, transport, events } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));

			const unsubData = unsubMsg("conversation", "ch1");
			manager.unsubscribe("conversation:ch1", unsubData);

			const unsubEvents = eventsOfType(events, "unsubscribe");
			expect(unsubEvents).toHaveLength(1);
			expect(unsubEvents[0].key).toBe("conversation:ch1");
			expect(unsubEvents[0].refCount).toBe(1);
			expect(unsubEvents[0].raw).toBe(JSON.stringify(unsubData));
			expect(unsubEvents[0].deserialized).toEqual(unsubData);
		});

		it("emits unsubscribe with refCount 0 on last unsubscribe", () => {
			const { manager, transport, events } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
			manager.unsubscribe("conversation:ch1", unsubMsg("conversation", "ch1"));

			const unsubEvents = eventsOfType(events, "unsubscribe");
			expect(unsubEvents).toHaveLength(1);
			expect(unsubEvents[0].refCount).toBe(0);
		});
	});

	describe("in-flight-ack events", () => {
		it("emits on ackInFlight", () => {
			const { manager, transport, events } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.send({ data: { text: "hello" }, ackId: "msg1" });
			manager.ackInFlight("msg1");

			const ackEvents = eventsOfType(events, "in-flight-ack");
			expect(ackEvents).toHaveLength(1);
			expect(ackEvents[0].ackId).toBe("msg1");
		});
	});

	describe("in-flight-drop events", () => {
		it("emits on close with pending in-flight messages", () => {
			const { manager, transport, events } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.send({ data: { text: "hello" }, ackId: "msg1" });
			manager.send({ data: { text: "world" }, ackId: "msg2" });
			transport.simulateClose(1006);

			const dropEvents = eventsOfType(events, "in-flight-drop");
			expect(dropEvents).toHaveLength(1);
			expect(dropEvents[0].ids).toContain("msg1");
			expect(dropEvents[0].ids).toContain("msg2");
		});

		it("does not emit when no in-flight messages", () => {
			const { manager, transport, events } = createManager();
			manager.connect();
			transport.simulateOpen();
			transport.simulateClose(1006);

			const dropEvents = eventsOfType(events, "in-flight-drop");
			expect(dropEvents).toHaveLength(0);
		});
	});

	describe("pending-subscription-resolved events", () => {
		it("emits on resolvePendingSubscription", () => {
			const { manager, transport, events } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
			manager.resolvePendingSubscription("conversation:ch1");

			const resolved = eventsOfType(events, "pending-subscription-resolved");
			expect(resolved).toHaveLength(1);
			expect(resolved[0].key).toBe("conversation:ch1");
		});
	});

	describe("reconnect-scheduled events", () => {
		it("emits with attempt and delayMs", () => {
			const { manager, transport, events } = createManager();
			manager.connect();
			transport.simulateOpen();
			transport.simulateClose(1006);

			const reconnectEvents = eventsOfType(events, "reconnect-scheduled");
			expect(reconnectEvents).toHaveLength(1);
			expect(reconnectEvents[0].attempt).toBe(1);
			expect(typeof reconnectEvents[0].delayMs).toBe("number");
			expect(reconnectEvents[0].delayMs).toBeGreaterThanOrEqual(0);
		});
	});

	describe("ready events", () => {
		it("emits on handleOpen with restoredKeys", () => {
			const { manager, transport, events } = createManager();
			manager.connect();
			transport.simulateOpen();

			const readyEvents = eventsOfType(events, "ready");
			expect(readyEvents).toHaveLength(1);
			expect(readyEvents[0].restoredKeys).toEqual([]);
		});

		it("includes restored subscription keys on reconnect", () => {
			const { manager, transport, events } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
			manager.subscribe("conversation:ch2", subMsg("conversation", "ch2"));

			transport.simulateClose(1006);
			vi.advanceTimersByTime(200);
			transport.simulateOpen();

			const readyEvents = eventsOfType(events, "ready");
			expect(readyEvents).toHaveLength(2);
			expect(readyEvents[1].restoredKeys).toContain("conversation:ch1");
			expect(readyEvents[1].restoredKeys).toContain("conversation:ch2");
		});
	});

	describe("ping as message-sent", () => {
		it("emits message-sent when ping interval fires", () => {
			const pingMsg = { action: "ping", timestamp: "now" } as TTestClientMsg;
			const { manager, transport, events } = createManager({
				ping: pingMsg,
				isPong: (msg) => msg.action === "pong",
				pingIntervalMs: 100,
			});
			manager.connect();
			transport.simulateOpen();

			vi.advanceTimersByTime(100);

			const sentEvents = eventsOfType(events, "message-sent");
			expect(sentEvents).toHaveLength(1);
			expect(sentEvents[0].raw).toBe(JSON.stringify(pingMsg));
			expect(sentEvents[0].deserialized).toEqual(pingMsg);
			expect(sentEvents[0].ackId).toBeUndefined();
		});
	});

	describe("dispose events", () => {
		it("emits on dispose()", () => {
			const { manager, transport, events } = createManager();
			manager.connect();
			transport.simulateOpen();
			manager.dispose();

			const disposeEvents = eventsOfType(events, "dispose");
			expect(disposeEvents).toHaveLength(1);
		});
	});

	describe("monotonic ids", () => {
		it("event ids are always increasing", () => {
			const { manager, transport, events } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
			manager.send({ data: { text: "hello" }, ackId: "msg1" });
			manager.ackInFlight("msg1");
			manager.unsubscribe("conversation:ch1", unsubMsg("conversation", "ch1"));
			manager.disconnect();

			expect(events.length).toBeGreaterThan(2);

			for (let i = 1; i < events.length; i++) {
				expect(events[i].id).toBeGreaterThan(events[i - 1].id);
			}
		});

		it("event ids start at 1", () => {
			const { manager, events } = createManager();
			manager.connect();

			expect(events[0].id).toBe(1);
		});
	});

	describe("no-op when no listeners", () => {
		it("does not break when no debug listeners are attached", () => {
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
				pingIntervalMs: 60_000,
				pongTimeoutMs: 5_000,
				reconnectBaseDelayMs: 10,
				reconnectMaxAttempts: 3,
				reconnectMaxDelayMs: 100,
			});

			// run through a full lifecycle with zero listeners and no onDebug
			manager.connect();
			transport.simulateOpen();
			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
			manager.send({ data: { text: "hello" }, ackId: "msg1" });
			manager.ackInFlight("msg1");
			transport.simulateMessage(JSON.stringify({ type: "chat", text: "hi" }));
			transport.simulateMessage("bad json{{{");
			manager.resolvePendingSubscription("conversation:ch1");
			manager.unsubscribe("conversation:ch1", unsubMsg("conversation", "ch1"));
			manager.dispose();

			// if we get here without throwing, the test passes
			expect(manager.isDisposed()).toBe(true);
		});

		it("starts emitting when listener is added later", () => {
			const transport = new MockTransport();
			const manager = new WebSocketManager<TTestClientMsg, TTestServerMsg>({
				...testSerialization,
				url: "ws://test",
				transport,
				pingIntervalMs: 60_000,
				pongTimeoutMs: 5_000,
				reconnectBaseDelayMs: 10,
				reconnectMaxAttempts: 3,
				reconnectMaxDelayMs: 100,
			});

			manager.connect();
			transport.simulateOpen();

			// attach listener after connection established
			const events: TDebugEvent<TTestClientMsg, TTestServerMsg>[] = [];
			manager.addDebugListener((e) => events.push(e));

			manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));

			const subEvents = events.filter((e) => e.type === "subscribe");
			expect(subEvents).toHaveLength(1);
		});
	});
});
