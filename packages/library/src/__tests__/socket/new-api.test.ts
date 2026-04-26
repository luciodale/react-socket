import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketManager } from "../../manager";
import { MockTransport } from "../helpers/mock-transport";

type TClientMsg = { type: "send" } | { type: "ping" };

type TServerMsg =
	| { type: "pong" }
	| { type: "subscribe-ack"; key: string }
	| { type: "delivered"; ackId: string }
	| { type: "event"; payload: string };

function createManager(
	overrides?: Partial<{
		getAckId: (msg: TServerMsg) => string | undefined;
		getSubscriptionResolvedKey: (msg: TServerMsg) => string | undefined;
	}>,
) {
	const transport = new MockTransport();
	const manager = new WebSocketManager<TClientMsg, TServerMsg>({
		url: "ws://test",
		transport,
		serialize: (msg) => JSON.stringify(msg),
		deserialize: (raw) => JSON.parse(raw) as TServerMsg,
		reconnectBaseDelayMs: 10,
		reconnectMaxAttempts: 3,
		reconnectMaxDelayMs: 100,
		...overrides,
	});
	return { manager, transport };
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("addMessageListener fanout", () => {
	it("invokes every listener with parsed message", () => {
		const { manager, transport } = createManager();
		const a: TServerMsg[] = [];
		const b: TServerMsg[] = [];
		manager.addMessageListener((m) => a.push(m));
		manager.addMessageListener((m) => b.push(m));

		manager.connect();
		transport.simulateOpen();
		transport.simulateMessage(JSON.stringify({ type: "event", payload: "hi" }));

		expect(a).toEqual([{ type: "event", payload: "hi" }]);
		expect(b).toEqual([{ type: "event", payload: "hi" }]);
	});

	it("unsubscribes cleanly", () => {
		const { manager, transport } = createManager();
		const received: TServerMsg[] = [];
		const unsub = manager.addMessageListener((m) => received.push(m));

		manager.connect();
		transport.simulateOpen();
		transport.simulateMessage(JSON.stringify({ type: "event", payload: "1" }));
		unsub();
		transport.simulateMessage(JSON.stringify({ type: "event", payload: "2" }));

		expect(received).toHaveLength(1);
	});
});

describe("auto ack via getAckId", () => {
	it("ack clears in-flight when extractor returns id", () => {
		const { manager, transport } = createManager({
			getAckId: (m) => (m.type === "delivered" ? m.ackId : undefined),
		});
		manager.connect();
		transport.simulateOpen();

		manager.send({ data: { type: "send" }, ackId: "x" });
		expect(manager.getSnapshot().inFlightMessages.size).toBe(1);

		transport.simulateMessage(
			JSON.stringify({ type: "delivered", ackId: "x" }),
		);
		expect(manager.getSnapshot().inFlightMessages.size).toBe(0);
	});

	it("no auto-ack when extractor returns undefined", () => {
		const { manager, transport } = createManager({
			getAckId: () => undefined,
		});
		manager.connect();
		transport.simulateOpen();
		manager.send({ data: { type: "send" }, ackId: "x" });

		transport.simulateMessage(
			JSON.stringify({ type: "delivered", ackId: "x" }),
		);
		expect(manager.getSnapshot().inFlightMessages.size).toBe(1);
	});
});

describe("auto resolve via getSubscriptionResolvedKey", () => {
	it("resolves pending subscription when extractor returns key", () => {
		const { manager, transport } = createManager({
			getSubscriptionResolvedKey: (m) =>
				m.type === "subscribe-ack" ? m.key : undefined,
		});
		manager.connect();
		transport.simulateOpen();

		manager.subscribe("room:1", { type: "send" });
		expect(manager.hasPendingSubscription("room:1")).toBe(true);

		transport.simulateMessage(
			JSON.stringify({ type: "subscribe-ack", key: "room:1" }),
		);
		expect(manager.hasPendingSubscription("room:1")).toBe(false);
	});
});

describe("pending subscription observability", () => {
	it("addPendingSubscriptionListener fires on add and resolve", () => {
		const { manager, transport } = createManager({
			getSubscriptionResolvedKey: (m) =>
				m.type === "subscribe-ack" ? m.key : undefined,
		});
		const snapshots: boolean[] = [];
		manager.addPendingSubscriptionListener(() => {
			snapshots.push(manager.hasPendingSubscription("room:1"));
		});

		manager.connect();
		transport.simulateOpen();
		manager.subscribe("room:1", { type: "send" });

		transport.simulateMessage(
			JSON.stringify({ type: "subscribe-ack", key: "room:1" }),
		);

		expect(snapshots).toContain(true);
		expect(snapshots).toContain(false);
	});
});

describe("discriminator default", () => {
	it("exposes the configured discriminator key", () => {
		const { manager } = createManager();
		expect(manager.discriminator).toBe("type");
	});

	it("overrides to a custom discriminator when configured", () => {
		type TMsg = { kind: "a" } | { kind: "b" };
		const transport = new MockTransport();
		const m = new WebSocketManager<{ kind: "x" }, TMsg, "kind">({
			url: "ws://test",
			transport,
			discriminator: "kind",
			serialize: (msg) => JSON.stringify(msg),
			deserialize: (raw) => JSON.parse(raw) as TMsg,
		});
		expect(m.discriminator).toBe("kind");
	});
});
