import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketManager } from "../../socket/manager";
import type {
	TConnectionState,
	TSocketError,
	TSocketMessageFromServerToClient,
} from "../../socket/types";
import { MockTransport } from "../helpers/mock-transport";

function createManager(overrides?: {
	transport?: MockTransport;
	onMessage?: (msg: TSocketMessageFromServerToClient) => void;
	onConnectionStateChange?: (state: TConnectionState) => void;
	onError?: (error: TSocketError) => void;
	pingIntervalMs?: number;
	pongTimeoutMs?: number;
	reconnectBaseDelayMs?: number;
	reconnectMaxAttempts?: number;
}) {
	const transport = overrides?.transport ?? new MockTransport();
	const states: TConnectionState[] = [];
	const messages: TSocketMessageFromServerToClient[] = [];
	const errors: TSocketError[] = [];

	const manager = new WebSocketManager({
		url: "ws://test",
		transport,
		pingIntervalMs: overrides?.pingIntervalMs ?? 60_000,
		pongTimeoutMs: overrides?.pongTimeoutMs ?? 5_000,
		reconnectBaseDelayMs: overrides?.reconnectBaseDelayMs ?? 10,
		reconnectMaxAttempts: overrides?.reconnectMaxAttempts ?? 3,
		reconnectMaxDelayMs: 100,
		onMessage: (msg) => {
			messages.push(msg);
			overrides?.onMessage?.(msg);
		},
		onConnectionStateChange: (state) => {
			states.push(state);
			overrides?.onConnectionStateChange?.(state);
		},
		onError: (err) => {
			errors.push(err);
			overrides?.onError?.(err);
		},
	});

	return { manager, transport, states, messages, errors };
}

beforeEach(() => {
	localStorage.clear();
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
			// Only 1 subscribe message should be sent
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
			// ref count is still 1, should not send unsubscribe
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

		it("fires error after max attempts", () => {
			const { manager, transport, errors } = createManager({
				reconnectMaxAttempts: 2,
			});
			manager.connect();
			transport.simulateOpen();
			transport.simulateClose(1006);

			// Exhaust all attempts
			for (let i = 0; i < 3; i++) {
				vi.advanceTimersByTime(10_000);
				if (transport.connectCalls.length > 1) {
					transport.simulateClose(1006);
				}
			}

			const maxError = errors.find((e) => e.code === 4002);
			expect(maxError).toBeDefined();
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
			const pings = transport.sentMessages.filter((m) => m.includes('"ping"'));
			expect(pings).toHaveLength(1);
		});

		it("disconnects on pong timeout", () => {
			const { manager, transport } = createManager({
				pingIntervalMs: 100,
				pongTimeoutMs: 50,
			});
			manager.connect();
			transport.simulateOpen();

			vi.advanceTimersByTime(100); // ping sent
			vi.advanceTimersByTime(50); // pong timeout
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

			vi.advanceTimersByTime(100); // ping sent
			transport.simulateMessage(
				JSON.stringify({ action: "pong", timestamp: "t" }),
			);
			vi.advanceTimersByTime(50); // would have timed out
			// Should not have disconnected
			expect(transport.disconnectCalls).toHaveLength(0);
		});
	});

	describe("send validation", () => {
		it("queues message when not connected", () => {
			const { manager, transport } = createManager();
			manager.send({
				action: "message",
				type: "conversation",
				id: "1",
				channel: "ch1",
				message: "hi",
			});
			expect(transport.sentMessages).toHaveLength(0);
			expect(manager.getQueueLength()).toBe(1);
		});

		it("errors when sending to unsubscribed channel", () => {
			const { manager, transport, errors } = createManager();
			manager.connect();
			transport.simulateOpen();

			manager.send({
				action: "message",
				type: "conversation",
				id: "1",
				channel: "ch1",
				message: "hi",
			});
			expect(errors).toHaveLength(1);
			expect(errors[0].code).toBe(4001);
		});

		it("sends when connected and subscribed", () => {
			const { manager, transport } = createManager();
			manager.connect();
			transport.simulateOpen();
			manager.subscribe("conversation", "ch1");
			transport.sentMessages = [];

			manager.send({
				action: "message",
				type: "conversation",
				id: "1",
				channel: "ch1",
				message: "hello",
			});
			expect(transport.sentMessages).toHaveLength(1);
		});
	});

	describe("queue drain", () => {
		it("drains queue after reconnect", () => {
			const { manager, transport } = createManager();
			// Queue a message while disconnected
			manager.send({
				action: "ping",
				timestamp: "t",
			});
			expect(manager.getQueueLength()).toBe(1);

			manager.connect();
			transport.simulateOpen();
			// Queue should have been drained
			expect(manager.getQueueLength()).toBe(0);
			const pings = transport.sentMessages.filter((m) => m.includes('"ping"'));
			expect(pings).toHaveLength(1);
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
	});
});
