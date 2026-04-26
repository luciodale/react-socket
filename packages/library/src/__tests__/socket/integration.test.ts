import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { WebSocketManager } from "../../manager";
import { MockTransport } from "../helpers/mock-transport";

// ── Test domain types ──────────────────────────────────────────────

type TContentBlock = { type: "text"; text: string };

type TMessage = {
	id: string;
	sender: string;
	content: TContentBlock[];
	status: "pending" | "sent" | "undelivered";
	undeliveredAt?: string;
};

type TTestState = {
	messages: Record<string, TMessage[]>;
};

type TClientMsg = Record<string, unknown>;

type TServerMsg =
	| { action: "subscribe_ack"; type: string; channel: string }
	| {
			action: "message";
			type: "conversation";
			delivery: "event";
			id: string;
			channel: string;
			sender: string;
			content: TContentBlock[];
	  }
	| {
			action: "message";
			type: "conversation";
			delivery: "dump";
			channel: string;
			messages: { id: string; sender: string; content: TContentBlock[] }[];
	  }
	| {
			action: "message";
			type: "conversation";
			delivery: "error";
			channel: string;
			error: string;
			message: string;
			messageId?: string;
	  };

// ── Helpers ────────────────────────────────────────────────────────

function createTestStore() {
	const useStore = create<TTestState>()(() => ({
		messages: {},
	}));
	return { useStore };
}

function subMsg(type: string, channel: string): TClientMsg {
	return { action: "subscribe", type, channel };
}

function createTestSystem(
	transport: MockTransport,
	useStore: ReturnType<typeof createTestStore>["useStore"],
) {
	const connectionStates: string[] = [];

	const manager = new WebSocketManager<TClientMsg, TServerMsg>({
		url: "ws://test",
		transport,
		serialize: (msg) => JSON.stringify(msg),
		deserialize: (raw) => JSON.parse(raw) as TServerMsg,
		pingIntervalMs: 60_000,
		pongTimeoutMs: 5_000,
		reconnectBaseDelayMs: 10,
		reconnectMaxAttempts: 3,
		reconnectMaxDelayMs: 100,
		getSubscriptionResolvedKey(msg) {
			if (msg.action === "subscribe_ack") {
				return `${msg.type}:${msg.channel}`;
			}
			return undefined;
		},
		getAckId(msg) {
			if (msg.action !== "message" || msg.type !== "conversation") {
				return undefined;
			}
			if (msg.delivery === "event") return msg.id;
			if (msg.delivery === "error") return msg.messageId;
			return undefined;
		},
		onReady() {},
	});

	manager.addConnectionStateListener(() => {
		connectionStates.push(manager.getConnectionState());
	});

	manager.addInFlightDropListener((messages) => {
		for (const { id } of messages) {
			useStore.setState((s) => {
				for (const [channel, msgs] of Object.entries(s.messages)) {
					const idx = msgs.findIndex((m) => m.id === id);
					if (idx !== -1) {
						const updated = [...msgs];
						updated[idx] = {
							...updated[idx],
							status: "undelivered",
							undeliveredAt: new Date().toISOString(),
						};
						return {
							messages: {
								...s.messages,
								[channel]: updated,
							},
						};
					}
				}
				return s;
			});
		}
	});

	manager.addMessageListener((msg) => {
		if (msg.action !== "message" || msg.type !== "conversation") return;

		if (msg.delivery === "dump") {
			useStore.setState((s) => ({
				messages: {
					...s.messages,
					[msg.channel]: msg.messages.map((m) => ({
						...m,
						status: "sent" as const,
					})),
				},
			}));
			return;
		}

		if (msg.delivery === "event") {
			useStore.setState((s) => {
				const existing = s.messages[msg.channel] ?? [];
				const idx = existing.findIndex((m) => m.id === msg.id);

				if (idx !== -1) {
					const updated = [...existing];
					const { undeliveredAt: _, ...rest } = updated[idx];
					updated[idx] = { ...rest, status: "sent" };
					return {
						messages: {
							...s.messages,
							[msg.channel]: updated,
						},
					};
				}

				return {
					messages: {
						...s.messages,
						[msg.channel]: [
							...existing,
							{
								id: msg.id,
								sender: msg.sender,
								content: msg.content,
								status: "sent",
							},
						],
					},
				};
			});
			return;
		}

		if (msg.delivery === "error") {
			useStore.setState((s) => {
				if (!msg.messageId) return s;
				const existing = s.messages[msg.channel] ?? [];
				const idx = existing.findIndex((m) => m.id === msg.messageId);
				if (idx === -1) return s;
				const updated = [...existing];
				updated[idx] = {
					...updated[idx],
					status: "undelivered",
					undeliveredAt: new Date().toISOString(),
				};
				return {
					messages: {
						...s.messages,
						[msg.channel]: updated,
					},
				};
			});
		}
	});

	return { manager, connectionStates };
}

// ── Setup / teardown ───────────────────────────────────────────────

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────

describe("integration: manager + zustand store", () => {
	it("full flow: connect -> subscribe -> dump -> send -> event -> reconnect", () => {
		const transport = new MockTransport();
		const { useStore } = createTestStore();
		const { manager, connectionStates } = createTestSystem(transport, useStore);

		// 1. Connect
		manager.connect();
		expect(connectionStates).toContain("connecting");
		transport.simulateOpen();
		expect(connectionStates).toContain("connected");

		// 2. Subscribe
		manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
		const sentSub = transport.sentMessages.find((m) =>
			m.includes('"subscribe"'),
		);
		expect(sentSub).toBeDefined();

		// 3. Receive dump
		transport.simulateMessage(
			JSON.stringify({
				action: "message",
				type: "conversation",
				delivery: "dump",
				channel: "ch1",
				messages: [
					{
						id: "hist1",
						sender: "bot",
						content: [{ type: "text", text: "Welcome!" }],
					},
				],
			}),
		);
		expect(useStore.getState().messages.ch1).toHaveLength(1);
		expect(useStore.getState().messages.ch1[0].id).toBe("hist1");

		// 4. Send a message
		const data = {
			action: "message",
			type: "conversation",
			id: "msg1",
			channel: "ch1",
			message: "hello",
		};
		manager.send({ data, ackId: "msg1" });
		const sent = transport.sentMessages.find((m) => m.includes('"msg1"'));
		expect(sent).toBeDefined();

		// 5. Receive event (echo of sent message)
		transport.simulateMessage(
			JSON.stringify({
				action: "message",
				type: "conversation",
				delivery: "event",
				id: "msg1",
				channel: "ch1",
				sender: "user",
				content: [{ type: "text", text: "hello" }],
			}),
		);
		expect(useStore.getState().messages.ch1).toHaveLength(2);
		expect(
			useStore.getState().messages.ch1.find((m) => m.id === "msg1")?.status,
		).toBe("sent");

		// 6. Reconnect
		transport.sentMessages = [];
		transport.simulateClose(1006);
		expect(connectionStates).toContain("reconnecting");

		vi.advanceTimersByTime(200);
		transport.simulateOpen();
		expect(connectionStates[connectionStates.length - 1]).toBe("connected");

		const restoredSubs = transport.sentMessages.filter((m) =>
			m.includes('"subscribe"'),
		);
		expect(restoredSubs.length).toBeGreaterThanOrEqual(1);

		manager.dispose();
	});

	it("in-flight messages become undelivered on disconnect", () => {
		const transport = new MockTransport();
		const { useStore } = createTestStore();
		const { manager } = createTestSystem(transport, useStore);

		manager.connect();
		transport.simulateOpen();
		manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));

		// optimistic insert
		useStore.setState((s) => ({
			messages: {
				...s.messages,
				ch1: [
					{
						id: "msg1",
						sender: "user",
						content: [{ type: "text", text: "hello" }],
						status: "pending" as const,
					},
				],
			},
		}));

		manager.send({
			data: {
				action: "message",
				type: "conversation",
				id: "msg1",
				channel: "ch1",
				message: "hello",
			},
			ackId: "msg1",
		});

		// disconnect drops in-flight
		transport.simulateClose(1006);

		const msgs = useStore.getState().messages.ch1;
		expect(msgs[0].status).toBe("undelivered");
		expect(msgs[0].undeliveredAt).toBeDefined();

		// reconnect -- messages stay undelivered (no auto-retry)
		vi.advanceTimersByTime(200);
		transport.simulateOpen();

		expect(useStore.getState().messages.ch1[0].status).toBe("undelivered");

		manager.dispose();
	});

	it("server error marks message as undelivered", () => {
		const transport = new MockTransport();
		const { useStore } = createTestStore();
		const { manager } = createTestSystem(transport, useStore);

		manager.connect();
		transport.simulateOpen();
		manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));

		// optimistic insert
		useStore.setState(() => ({
			messages: {
				ch1: [
					{
						id: "fail-msg",
						sender: "user",
						content: [{ type: "text", text: "403" }],
						status: "pending" as const,
					},
				],
			},
		}));

		manager.send({
			data: {
				action: "message",
				type: "conversation",
				id: "fail-msg",
				channel: "ch1",
				message: "403",
			},
			ackId: "fail-msg",
		});

		// server rejects
		transport.simulateMessage(
			JSON.stringify({
				action: "message",
				type: "conversation",
				delivery: "error",
				channel: "ch1",
				error: "token_expired",
				message: "Token expired",
				messageId: "fail-msg",
			}),
		);

		expect(useStore.getState().messages.ch1[0].status).toBe("undelivered");

		manager.dispose();
	});

	it("retry flow: undelivered -> pending -> send -> event confirms", () => {
		const transport = new MockTransport();
		const { useStore } = createTestStore();
		const { manager } = createTestSystem(transport, useStore);

		manager.connect();
		transport.simulateOpen();
		manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));

		// start with undelivered message
		useStore.setState(() => ({
			messages: {
				ch1: [
					{
						id: "msg-1",
						sender: "user",
						content: [{ type: "text", text: "hello" }],
						status: "undelivered" as const,
						undeliveredAt: "2025-01-01T00:00:00.000Z",
					},
				],
			},
		}));

		// user retries: mark pending
		useStore.setState((s) => {
			const updated = [...s.messages.ch1];
			const { undeliveredAt: _, ...rest } = updated[0];
			updated[0] = { ...rest, status: "pending" };
			return { messages: { ...s.messages, ch1: updated } };
		});

		manager.send({
			data: {
				action: "message",
				type: "conversation",
				id: "msg-1",
				channel: "ch1",
				message: "hello",
			},
			ackId: "msg-1",
		});

		// server echoes
		transport.simulateMessage(
			JSON.stringify({
				action: "message",
				type: "conversation",
				delivery: "event",
				id: "msg-1",
				channel: "ch1",
				sender: "user",
				content: [{ type: "text", text: "hello" }],
			}),
		);

		const msgs = useStore.getState().messages.ch1;
		expect(msgs[0].status).toBe("sent");
		expect(msgs[0].undeliveredAt).toBeUndefined();

		manager.dispose();
	});

	it("multiple channels work independently", () => {
		const transport = new MockTransport();
		const { useStore } = createTestStore();
		const { manager } = createTestSystem(transport, useStore);

		manager.connect();
		transport.simulateOpen();
		manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));
		manager.subscribe("conversation:ch2", subMsg("conversation", "ch2"));

		transport.simulateMessage(
			JSON.stringify({
				action: "message",
				type: "conversation",
				delivery: "dump",
				channel: "ch1",
				messages: [
					{
						id: "a",
						sender: "bot",
						content: [{ type: "text", text: "ch1" }],
					},
				],
			}),
		);

		transport.simulateMessage(
			JSON.stringify({
				action: "message",
				type: "conversation",
				delivery: "dump",
				channel: "ch2",
				messages: [
					{
						id: "b",
						sender: "bot",
						content: [{ type: "text", text: "ch2" }],
					},
					{
						id: "c",
						sender: "user",
						content: [{ type: "text", text: "ch2-2" }],
					},
				],
			}),
		);

		expect(useStore.getState().messages.ch1).toHaveLength(1);
		expect(useStore.getState().messages.ch2).toHaveLength(2);

		// event on ch1 doesn't affect ch2
		transport.simulateMessage(
			JSON.stringify({
				action: "message",
				type: "conversation",
				delivery: "event",
				id: "d",
				channel: "ch1",
				sender: "user",
				content: [{ type: "text", text: "new" }],
			}),
		);

		expect(useStore.getState().messages.ch1).toHaveLength(2);
		expect(useStore.getState().messages.ch2).toHaveLength(2);

		manager.dispose();
	});

	it("dump replaces existing channel messages", () => {
		const transport = new MockTransport();
		const { useStore } = createTestStore();
		const { manager } = createTestSystem(transport, useStore);

		manager.connect();
		transport.simulateOpen();
		manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));

		// first dump
		transport.simulateMessage(
			JSON.stringify({
				action: "message",
				type: "conversation",
				delivery: "dump",
				channel: "ch1",
				messages: [
					{
						id: "old",
						sender: "bot",
						content: [{ type: "text", text: "old" }],
					},
				],
			}),
		);
		expect(useStore.getState().messages.ch1).toHaveLength(1);

		// second dump replaces
		transport.simulateMessage(
			JSON.stringify({
				action: "message",
				type: "conversation",
				delivery: "dump",
				channel: "ch1",
				messages: [
					{
						id: "new1",
						sender: "bot",
						content: [{ type: "text", text: "new1" }],
					},
					{
						id: "new2",
						sender: "user",
						content: [{ type: "text", text: "new2" }],
					},
				],
			}),
		);

		const msgs = useStore.getState().messages.ch1;
		expect(msgs).toHaveLength(2);
		expect(msgs[0].id).toBe("new1");
		expect(msgs[1].id).toBe("new2");

		manager.dispose();
	});

	it("subscription ack resolves pending subscription", () => {
		const transport = new MockTransport();
		const { useStore } = createTestStore();
		const { manager } = createTestSystem(transport, useStore);

		manager.connect();
		transport.simulateOpen();
		manager.subscribe("conversation:ch1", subMsg("conversation", "ch1"));

		expect(manager.hasPendingSubscription("conversation:ch1")).toBe(true);

		transport.simulateMessage(
			JSON.stringify({
				action: "subscribe_ack",
				type: "conversation",
				channel: "ch1",
			}),
		);

		expect(manager.hasPendingSubscription("conversation:ch1")).toBe(false);

		manager.dispose();
	});
});
