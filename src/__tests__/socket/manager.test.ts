import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketManager } from "../../socket/manager";
import type { TConnectionState } from "../../socket/types";
import { MockTransport } from "../helpers/mock-transport";

function serializeSub(type: string, channel: string): string {
	return JSON.stringify({ action: "subscribe", type, channel });
}

function serializeUnsub(type: string, channel: string): string {
	return JSON.stringify({ action: "unsubscribe", type, channel });
}

function createManager(overrides?: {
	transport?: MockTransport;
	onRawMessage?: (parsed: unknown) => void;
	onConnectionStateChange?: (state: TConnectionState) => void;
	onReady?: () => void;
	onInFlightDrop?: (ids: string[]) => void;
	pingIntervalMs?: number;
	pongTimeoutMs?: number;
	reconnectBaseDelayMs?: number;
	reconnectMaxAttempts?: number;
}) {
	const transport = overrides?.transport ?? new MockTransport();
	const states: TConnectionState[] = [];
	const rawMessages: unknown[] = [];
	const readyCalls: number[] = [];
	const droppedInFlightIds: string[][] = [];

	const manager = new WebSocketManager({
		url: "ws://test",
		transport,
		pingIntervalMs: overrides?.pingIntervalMs ?? 60_000,
		pongTimeoutMs: overrides?.pongTimeoutMs ?? 5_000,
		reconnectBaseDelayMs: overrides?.reconnectBaseDelayMs ?? 10,
		reconnectMaxAttempts: overrides?.reconnectMaxAttempts ?? 3,
		reconnectMaxDelayMs: 100,
		serializeSubscribe: serializeSub,
		serializeUnsubscribe: serializeUnsub,
		onRawMessage: (parsed) => {
			rawMessages.push(parsed);
			overrides?.onRawMessage?.(parsed);
		},
		onConnectionStateChange: (state) => {
			states.push(state);
			overrides?.onConnectionStateChange?.(state);
		},
		onReady: () => {
			readyCalls.push(1);
			overrides?.onReady?.();
		},
		onInFlightDrop: (ids) => {
			droppedInFlightIds.push([...ids]);
			overrides?.onInFlightDrop?.(ids);
		},
	});

	return {
		manager,
		transport,
		states,
		rawMessages,
		readyCalls,
		droppedInFlightIds,
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

			manager.subscribe("conversation", "ch1");
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

			manager.subscribe("conversation", "ch1");
			manager.subscribe("conversation", "ch1");
			const subs = transport.sentMessages.filter((m) =>
				m.includes('"subscribe"'),
			);
			expect(subs).toHaveLength(1);
		});

		it("unsubscribe only at ref count 0", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.subscribe("conversation", "ch1");
			manager.subscribe("conversation", "ch1");
			transport.sentMessages = [];

			manager.unsubscribe("conversation", "ch1");
			const unsubs = transport.sentMessages.filter((m) =>
				m.includes('"unsubscribe"'),
			);
			expect(unsubs).toHaveLength(0);

			manager.unsubscribe("conversation", "ch1");
			const unsubs2 = transport.sentMessages.filter((m) =>
				m.includes('"unsubscribe"'),
			);
			expect(unsubs2).toHaveLength(1);
		});

		it("adds subscription to pending on subscribe", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.subscribe("conversation", "ch1");
			expect(manager.getPendingSubscriptions().has("conversation:ch1")).toBe(
				true,
			);
		});

		it("resolves pending subscription via resolvePendingSubscription", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.subscribe("conversation", "ch1");
			manager.resolvePendingSubscription("conversation", "ch1");
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
			manager.subscribe("conversation", "ch1");
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
		it("sends ping at interval", () => {
			const { manager, transport } = createManager({
				pingIntervalMs: 100,
			});
			manager.connect();
			transport.simulateOpen();
			transport.sentMessages = [];

			vi.advanceTimersByTime(100);
			const pings = transport.sentMessages.filter((m) =>
				m.includes('"ping"'),
			);
			expect(pings).toHaveLength(1);
		});

		it("disconnects on pong timeout", () => {
			const { manager, transport } = createManager({
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
			const sent = manager.send("msg1", JSON.stringify({ text: "hi" }));
			expect(sent).toBe(false);
		});

		it("sends when connected", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();
			transport.sentMessages = [];

			const data = JSON.stringify({ text: "hello" });
			const sent = manager.send("msg1", data);
			expect(sent).toBe(true);
			expect(transport.sentMessages).toHaveLength(1);
			expect(transport.sentMessages[0]).toBe(data);
		});

		it("sends with null id (fire-and-forget)", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();
			transport.sentMessages = [];

			const data = JSON.stringify({ text: "hello" });
			const sent = manager.send(null, data);
			expect(sent).toBe(true);
			expect(transport.sentMessages).toHaveLength(1);
		});

		it("acknowledges in-flight message via ackInFlight", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.send("msg1", JSON.stringify({ text: "hello" }));
			manager.ackInFlight("msg1");

			// verify no in-flight drop on disconnect
			transport.simulateClose(1006);
			const { droppedInFlightIds } = createManager();
			expect(droppedInFlightIds).toHaveLength(0);
		});
	});

	describe("onRawMessage", () => {
		it("passes parsed JSON to onRawMessage callback", () => {
			const { manager, transport, rawMessages } = createManager();
			manager.connect();
			transport.simulateOpen();

			transport.simulateMessage(
				JSON.stringify({ type: "chat", text: "hello" }),
			);
			expect(rawMessages).toHaveLength(1);
			expect(rawMessages[0]).toEqual({ type: "chat", text: "hello" });
		});

		it("ignores pong messages (not forwarded to onRawMessage)", () => {
			const { manager, transport, rawMessages } = createManager();
			manager.connect();
			transport.simulateOpen();

			transport.simulateMessage(
				JSON.stringify({ action: "pong", timestamp: "t" }),
			);
			expect(rawMessages).toHaveLength(0);
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
		it("fires with in-flight message ids on disconnect", () => {
			const { manager, transport, droppedInFlightIds } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.send("msg1", JSON.stringify({ text: "hello" }));
			transport.simulateClose(1006);

			expect(droppedInFlightIds).toHaveLength(1);
			expect(droppedInFlightIds[0]).toContain("msg1");
		});

		it("does not fire when no in-flight messages", () => {
			const { manager, transport, droppedInFlightIds } = createManager();
			manager.connect();
			transport.simulateOpen();
			transport.simulateClose(1006);
			expect(droppedInFlightIds).toHaveLength(0);
		});

		it("does not fire for acked messages", () => {
			const { manager, transport, droppedInFlightIds } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.send("msg1", JSON.stringify({ text: "hello" }));
			manager.ackInFlight("msg1");

			transport.simulateClose(1006);
			expect(droppedInFlightIds).toHaveLength(0);
		});

		it("null-id sends are not tracked as in-flight", () => {
			const { manager, transport, droppedInFlightIds } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.send(null, JSON.stringify({ text: "hello" }));
			transport.simulateClose(1006);
			expect(droppedInFlightIds).toHaveLength(0);
		});
	});

	describe("dispose", () => {
		it("cleans up everything", () => {
			const { manager, transport, states } = createManager();
			manager.connect();
			transport.simulateOpen();
			manager.subscribe("conversation", "ch1");

			manager.dispose();
			expect(states[states.length - 1]).toBe("disconnected");
			expect(manager.getRefCount("conversation", "ch1")).toBe(0);
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

	describe("token", () => {
		it("passes token as protocols", () => {
			const transport = new MockTransport();
			const manager = new WebSocketManager({
				url: "ws://test",
				transport,
				token: "my-token",
			});
			manager.connect();
			expect(transport.connectCalls[0].protocols).toEqual([
				"access_token",
				"my-token",
			]);
		});

		it("omits protocols when no token", () => {
			const transport = new MockTransport();
			const manager = new WebSocketManager({
				url: "ws://test",
				transport,
			});
			manager.connect();
			expect(transport.connectCalls[0].protocols).toBeUndefined();
		});
	});
});
