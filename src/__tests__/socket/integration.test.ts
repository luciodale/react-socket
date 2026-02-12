import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getChannelFailedMessages,
	setChannelFailedMessages,
} from "../../socket/failed-messages";
import { WebSocketManager } from "../../socket/manager";
import { useSocketStore } from "../../socket/store";
import type { TSocketMessageFromServerToClient } from "../../socket/types";
import { MockTransport } from "../helpers/mock-transport";

function resetStore() {
	useSocketStore.setState({
		connectionState: "disconnected",
		hasConnected: false,
		conversationMessages: {},
		notificationMessages: {},
		subscriptionRefCounts: {},
		pendingQueueLength: 0,
		lastError: null,
	});
}

beforeEach(() => {
	resetStore();
	localStorage.clear();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("integration: manager + store", () => {
	it("full flow: connect → subscribe → dump → send → event → reconnect", () => {
		const transport = new MockTransport();
		const store = useSocketStore;

		const manager = new WebSocketManager({
			url: "ws://test",
			transport,
			pingIntervalMs: 60_000,
			pongTimeoutMs: 5_000,
			reconnectBaseDelayMs: 10,
			reconnectMaxAttempts: 3,
			reconnectMaxDelayMs: 100,
			onMessage: (msg) => store.getState().handleServerMessage(msg),
			onConnectionStateChange: (state) =>
				store.getState().setConnectionState(state),
			onError: (err) => store.getState().setLastError(err),
		});

		// 1. Connect
		manager.connect();
		expect(store.getState().connectionState).toBe("connecting");
		transport.simulateOpen();
		expect(store.getState().connectionState).toBe("connected");

		// 2. Subscribe
		manager.subscribe("conversation", "ch1");
		store.getState().incrementRefCount("conversation:ch1");
		const subMsg = transport.sentMessages.find((m) =>
			m.includes('"subscribe"'),
		);
		expect(subMsg).toBeDefined();

		// 3. Receive dump
		const dump: TSocketMessageFromServerToClient = {
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
		};
		transport.simulateMessage(JSON.stringify(dump));
		expect(store.getState().conversationMessages.ch1).toHaveLength(1);
		expect(store.getState().conversationMessages.ch1[0].id).toBe("hist1");

		// 4. Send a message
		manager.send({
			action: "message",
			type: "conversation",
			id: "msg1",
			channel: "ch1",
			message: "hello",
		});
		const sent = transport.sentMessages.find((m) => m.includes('"msg1"'));
		expect(sent).toBeDefined();

		// 5. Receive event
		const event: TSocketMessageFromServerToClient = {
			action: "message",
			type: "conversation",
			delivery: "event",
			id: "msg1",
			channel: "ch1",
			sender: "user",
			content: [{ type: "text", text: "hello" }],
		};
		transport.simulateMessage(JSON.stringify(event));
		expect(store.getState().conversationMessages.ch1).toHaveLength(2);

		// 6. Reconnect
		transport.sentMessages = [];
		transport.simulateClose(1006);
		expect(store.getState().connectionState).toBe("reconnecting");

		vi.advanceTimersByTime(200);
		transport.simulateOpen();
		expect(store.getState().connectionState).toBe("connected");

		// Subscriptions restored
		const restoredSubs = transport.sentMessages.filter((m) =>
			m.includes('"subscribe"'),
		);
		expect(restoredSubs.length).toBeGreaterThanOrEqual(1);

		// Cleanup
		manager.dispose();
	});

	it("failed message lifecycle: persist → refresh → reappear after dump → dismiss on success", () => {
		const transport = new MockTransport();
		const store = useSocketStore;

		function createManager() {
			return new WebSocketManager({
				url: "ws://test",
				transport,
				pingIntervalMs: 60_000,
				pongTimeoutMs: 5_000,
				reconnectBaseDelayMs: 10,
				reconnectMaxAttempts: 3,
				reconnectMaxDelayMs: 100,
				onMessage: (msg) => store.getState().handleServerMessage(msg),
				onConnectionStateChange: (state) =>
					store.getState().setConnectionState(state),
				onError: (err) => store.getState().setLastError(err),
			});
		}

		// --- Session 1: connect, send, get error ---
		const manager1 = createManager();
		manager1.connect();
		transport.simulateOpen();

		// Subscribe + dump
		manager1.subscribe("conversation", "ch1");
		store.getState().incrementRefCount("conversation:ch1");
		transport.simulateMessage(
			JSON.stringify({
				action: "message",
				type: "conversation",
				delivery: "dump",
				channel: "ch1",
				messages: [],
			} satisfies TSocketMessageFromServerToClient),
		);

		// Send optimistic message
		store.getState().addOptimisticMessage("ch1", {
			id: "fail-msg",
			sender: "user",
			content: [{ type: "text", text: "403" }],
			status: "pending",
		});

		// Server rejects with error
		transport.simulateMessage(
			JSON.stringify({
				action: "message",
				type: "conversation",
				delivery: "error",
				channel: "ch1",
				error: "token_expired",
				message: "Token expired",
				messageId: "fail-msg",
			} satisfies TSocketMessageFromServerToClient),
		);

		// Verify failed in-memory and in localStorage
		expect(store.getState().conversationMessages.ch1[0].status).toBe(
			"failed",
		);
		const persisted = getChannelFailedMessages("ch1");
		expect(persisted).toHaveLength(1);
		expect(persisted[0].id).toBe("fail-msg");

		manager1.dispose();

		// --- Session 2: simulate refresh ---
		resetStore(); // clears in-memory, localStorage persists

		const transport2 = new MockTransport();
		const manager2 = new WebSocketManager({
			url: "ws://test",
			transport: transport2,
			pingIntervalMs: 60_000,
			pongTimeoutMs: 5_000,
			reconnectBaseDelayMs: 10,
			reconnectMaxAttempts: 3,
			reconnectMaxDelayMs: 100,
			onMessage: (msg) => store.getState().handleServerMessage(msg),
			onConnectionStateChange: (state) =>
				store.getState().setConnectionState(state),
			onError: (err) => store.getState().setLastError(err),
		});

		manager2.connect();
		transport2.simulateOpen();

		manager2.subscribe("conversation", "ch1");
		store.getState().incrementRefCount("conversation:ch1");

		// Dump arrives (server history, no failed msg)
		transport2.simulateMessage(
			JSON.stringify({
				action: "message",
				type: "conversation",
				delivery: "dump",
				channel: "ch1",
				messages: [
					{
						id: "server-1",
						sender: "bot",
						content: [{ type: "text", text: "Welcome back" }],
					},
				],
			} satisfies TSocketMessageFromServerToClient),
		);

		// Failed message reappears from localStorage after dump
		const msgs = store.getState().conversationMessages.ch1;
		expect(msgs).toHaveLength(2);
		expect(msgs[0]).toMatchObject({ id: "server-1", status: "sent" });
		expect(msgs[1]).toMatchObject({ id: "fail-msg", status: "failed" });

		// --- Retry: optimistic message + server ack dismisses failed ---
		store.getState().addOptimisticMessage("ch1", {
			id: "success-msg",
			sender: "user",
			content: [{ type: "text", text: "retry worked" }],
			status: "pending",
		});

		transport2.simulateMessage(
			JSON.stringify({
				action: "message",
				type: "conversation",
				delivery: "event",
				id: "success-msg",
				channel: "ch1",
				sender: "user",
				content: [{ type: "text", text: "retry worked" }],
			} satisfies TSocketMessageFromServerToClient),
		);

		const afterSuccess = store.getState().conversationMessages.ch1;
		expect(afterSuccess.find((m) => m.id === "fail-msg")).toBeUndefined();
		expect(getChannelFailedMessages("ch1")).toEqual([]);

		manager2.dispose();
	});
});
