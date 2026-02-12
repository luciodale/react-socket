import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	getChannelFailedMessages,
	setChannelFailedMessages,
} from "../../socket/failed-messages";
import {
	selectConversationMessages,
	selectIsSubscribed,
	selectNotificationMessages,
	useSocketStore,
} from "../../socket/store";
import type {
	TConversationDumpFromServer,
	TConversationErrorFromServer,
	TConversationEventFromServer,
	TNotificationDumpFromServer,
	TNotificationEventFromServer,
} from "../../socket/types";

function resetStore() {
	localStorage.clear();
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

beforeEach(resetStore);
afterEach(resetStore);

describe("store", () => {
	describe("handleServerMessage — event delivery", () => {
		it("appends event to channel", () => {
			const { handleServerMessage } = useSocketStore.getState();
			const event: TConversationEventFromServer = {
				action: "message",
				type: "conversation",
				delivery: "event",
				id: "1",
				channel: "ch1",
				sender: "user",
				content: [{ type: "text", text: "hi" }],
			};
			handleServerMessage(event);

			const messages = selectConversationMessages("ch1")(
				useSocketStore.getState(),
			);
			expect(messages).toHaveLength(1);
			expect(messages[0].id).toBe("1");
		});

		it("appends to existing messages", () => {
			const { handleServerMessage } = useSocketStore.getState();
			const event1: TConversationEventFromServer = {
				action: "message",
				type: "conversation",
				delivery: "event",
				id: "1",
				channel: "ch1",
				sender: "user",
				content: [{ type: "text", text: "hi" }],
			};
			const event2: TConversationEventFromServer = {
				action: "message",
				type: "conversation",
				delivery: "event",
				id: "2",
				channel: "ch1",
				sender: "bot",
				content: [{ type: "text", text: "hello" }],
			};
			handleServerMessage(event1);
			handleServerMessage(event2);

			const messages = selectConversationMessages("ch1")(
				useSocketStore.getState(),
			);
			expect(messages).toHaveLength(2);
		});
	});

	describe("handleServerMessage — dump delivery", () => {
		it("replaces channel messages with dump", () => {
			const { handleServerMessage } = useSocketStore.getState();

			// Add an event first
			handleServerMessage({
				action: "message",
				type: "conversation",
				delivery: "event",
				id: "old",
				channel: "ch1",
				sender: "user",
				content: [{ type: "text", text: "old" }],
			} satisfies TConversationEventFromServer);

			// Now dump replaces
			const dump: TConversationDumpFromServer = {
				action: "message",
				type: "conversation",
				delivery: "dump",
				channel: "ch1",
				messages: [
					{
						id: "new1",
						sender: "user",
						content: [{ type: "text", text: "fresh" }],
					},
				],
			};
			handleServerMessage(dump);

			const messages = selectConversationMessages("ch1")(
				useSocketStore.getState(),
			);
			expect(messages).toHaveLength(1);
			expect(messages[0].id).toBe("new1");
		});
	});

	describe("handleServerMessage — dump + failed messages from localStorage", () => {
		it("keeps failed messages from localStorage, drops pending", () => {
			// Seed failed message in localStorage
			setChannelFailedMessages("ch1", [
				{
					id: "failed-1",
					sender: "user",
					content: [{ type: "text", text: "oops" }],
					status: "failed",
				},
			]);

			// Seed pending in-memory (should be dropped on dump)
			useSocketStore.setState({
				conversationMessages: {
					ch1: [
						{
							id: "pending-1",
							sender: "user",
							content: [{ type: "text", text: "sending" }],
							status: "pending",
						},
					],
				},
			});

			const { handleServerMessage } = useSocketStore.getState();
			handleServerMessage({
				action: "message",
				type: "conversation",
				delivery: "dump",
				channel: "ch1",
				messages: [
					{
						id: "server-1",
						sender: "bot",
						content: [{ type: "text", text: "hello" }],
					},
				],
			} satisfies TConversationDumpFromServer);

			const messages = selectConversationMessages("ch1")(
				useSocketStore.getState(),
			);
			expect(messages).toHaveLength(2);
			expect(messages[0]).toMatchObject({ id: "server-1", status: "sent" });
			expect(messages[1]).toMatchObject({
				id: "failed-1",
				status: "failed",
			});
		});

		it("deduplicates — failed msg confirmed in dump is dropped", () => {
			// Failed message in localStorage that also appears in the dump
			setChannelFailedMessages("ch1", [
				{
					id: "msg-1",
					sender: "user",
					content: [{ type: "text", text: "hi" }],
					status: "failed",
				},
			]);

			const { handleServerMessage } = useSocketStore.getState();
			handleServerMessage({
				action: "message",
				type: "conversation",
				delivery: "dump",
				channel: "ch1",
				messages: [
					{
						id: "msg-1",
						sender: "user",
						content: [{ type: "text", text: "hi" }],
					},
				],
			} satisfies TConversationDumpFromServer);

			const messages = selectConversationMessages("ch1")(
				useSocketStore.getState(),
			);
			expect(messages).toHaveLength(1);
			expect(messages[0]).toMatchObject({ id: "msg-1", status: "sent" });
			// localStorage should also be cleared of the deduped message
			expect(getChannelFailedMessages("ch1")).toEqual([]);
		});

		it("dump loads failed messages from localStorage and appends at end", () => {
			setChannelFailedMessages("ch1", [
				{
					id: "fail-a",
					sender: "user",
					content: [{ type: "text", text: "err" }],
					status: "failed",
				},
			]);

			const { handleServerMessage } = useSocketStore.getState();
			handleServerMessage({
				action: "message",
				type: "conversation",
				delivery: "dump",
				channel: "ch1",
				messages: [
					{
						id: "s1",
						sender: "bot",
						content: [{ type: "text", text: "hi" }],
					},
					{
						id: "s2",
						sender: "user",
						content: [{ type: "text", text: "hey" }],
					},
				],
			} satisfies TConversationDumpFromServer);

			const messages = selectConversationMessages("ch1")(
				useSocketStore.getState(),
			);
			expect(messages).toHaveLength(3);
			expect(messages[0].id).toBe("s1");
			expect(messages[1].id).toBe("s2");
			expect(messages[2]).toMatchObject({ id: "fail-a", status: "failed" });
		});
	});

	describe("channel isolation", () => {
		it("messages from different channels don't interfere", () => {
			const { handleServerMessage } = useSocketStore.getState();
			handleServerMessage({
				action: "message",
				type: "conversation",
				delivery: "event",
				id: "1",
				channel: "ch1",
				sender: "user",
				content: [{ type: "text", text: "ch1 msg" }],
			} satisfies TConversationEventFromServer);

			handleServerMessage({
				action: "message",
				type: "conversation",
				delivery: "event",
				id: "2",
				channel: "ch2",
				sender: "user",
				content: [{ type: "text", text: "ch2 msg" }],
			} satisfies TConversationEventFromServer);

			expect(
				selectConversationMessages("ch1")(useSocketStore.getState()),
			).toHaveLength(1);
			expect(
				selectConversationMessages("ch2")(useSocketStore.getState()),
			).toHaveLength(1);
		});
	});

	describe("ref count lifecycle", () => {
		it("increments and decrements", () => {
			const store = useSocketStore.getState();
			store.incrementRefCount("conversation:ch1");
			store.incrementRefCount("conversation:ch1");
			expect(
				selectIsSubscribed("conversation", "ch1")(useSocketStore.getState()),
			).toBe(true);

			store.decrementRefCount("conversation:ch1");
			expect(
				selectIsSubscribed("conversation", "ch1")(useSocketStore.getState()),
			).toBe(true);

			store.decrementRefCount("conversation:ch1");
			expect(
				selectIsSubscribed("conversation", "ch1")(useSocketStore.getState()),
			).toBe(false);
		});
	});

	describe("error handling", () => {
		it("stores error from server", () => {
			const { handleServerMessage } = useSocketStore.getState();
			handleServerMessage({
				action: "error",
				code: 500,
				message: "internal error",
				channel: "ch1",
			});
			expect(useSocketStore.getState().lastError).toEqual({
				code: 500,
				message: "internal error",
				channel: "ch1",
			});
		});

		it("error delivery persists failed message to localStorage", () => {
			// Seed an optimistic pending message
			useSocketStore.setState({
				conversationMessages: {
					ch1: [
						{
							id: "msg-1",
							sender: "user",
							content: [{ type: "text", text: "hello" }],
							status: "pending",
						},
					],
				},
			});

			const { handleServerMessage } = useSocketStore.getState();
			handleServerMessage({
				action: "message",
				type: "conversation",
				delivery: "error",
				channel: "ch1",
				error: "token_expired",
				message: "Token expired",
				messageId: "msg-1",
			} satisfies TConversationErrorFromServer);

			// In-memory status is "failed"
			const messages = selectConversationMessages("ch1")(
				useSocketStore.getState(),
			);
			expect(messages[0].status).toBe("failed");

			// localStorage has the failed message
			const persisted = getChannelFailedMessages("ch1");
			expect(persisted).toHaveLength(1);
			expect(persisted[0]).toMatchObject({ id: "msg-1", status: "failed" });
		});
	});

	describe("handleServerMessage — event clears failed messages", () => {
		it("clears failed messages when an optimistic message is acknowledged", () => {
			// Seed failed in localStorage
			setChannelFailedMessages("ch1", [
				{
					id: "fail-1",
					sender: "user",
					content: [{ type: "text", text: "oops" }],
					status: "failed",
				},
			]);

			// Seed in-memory: one failed + one optimistic pending
			useSocketStore.setState({
				conversationMessages: {
					ch1: [
						{
							id: "fail-1",
							sender: "user",
							content: [{ type: "text", text: "oops" }],
							status: "failed",
						},
						{
							id: "opt-1",
							sender: "user",
							content: [{ type: "text", text: "retry" }],
							status: "pending",
						},
					],
				},
			});

			const { handleServerMessage } = useSocketStore.getState();
			// Server acknowledges the optimistic message
			handleServerMessage({
				action: "message",
				type: "conversation",
				delivery: "event",
				id: "opt-1",
				channel: "ch1",
				sender: "user",
				content: [{ type: "text", text: "retry" }],
			} satisfies TConversationEventFromServer);

			const messages = selectConversationMessages("ch1")(
				useSocketStore.getState(),
			);
			expect(messages).toHaveLength(1);
			expect(messages[0]).toMatchObject({ id: "opt-1", status: "sent" });

			// localStorage also cleared
			expect(getChannelFailedMessages("ch1")).toEqual([]);
		});

		it("does NOT clear failed messages on incoming message from another user", () => {
			// Seed failed in localStorage
			setChannelFailedMessages("ch1", [
				{
					id: "fail-1",
					sender: "user",
					content: [{ type: "text", text: "oops" }],
					status: "failed",
				},
			]);

			// Seed in-memory
			useSocketStore.setState({
				conversationMessages: {
					ch1: [
						{
							id: "fail-1",
							sender: "user",
							content: [{ type: "text", text: "oops" }],
							status: "failed",
						},
						{
							id: "ok-1",
							sender: "user",
							content: [{ type: "text", text: "good" }],
							status: "sent",
						},
					],
				},
			});

			const { handleServerMessage } = useSocketStore.getState();
			// Incoming message from bot — no optimistic match
			handleServerMessage({
				action: "message",
				type: "conversation",
				delivery: "event",
				id: "new-1",
				channel: "ch1",
				sender: "bot",
				content: [{ type: "text", text: "reply" }],
			} satisfies TConversationEventFromServer);

			const messages = selectConversationMessages("ch1")(
				useSocketStore.getState(),
			);
			expect(messages).toHaveLength(3);
			expect(messages.find((m) => m.id === "fail-1")?.status).toBe(
				"failed",
			);

			// localStorage still has the failed message
			expect(getChannelFailedMessages("ch1")).toHaveLength(1);
		});

		it("preserves non-failed messages on event", () => {
			useSocketStore.setState({
				conversationMessages: {
					ch1: [
						{
							id: "pending-1",
							sender: "user",
							content: [{ type: "text", text: "sending" }],
							status: "pending",
						},
					],
				},
			});

			const { handleServerMessage } = useSocketStore.getState();
			handleServerMessage({
				action: "message",
				type: "conversation",
				delivery: "event",
				id: "new-1",
				channel: "ch1",
				sender: "bot",
				content: [{ type: "text", text: "reply" }],
			} satisfies TConversationEventFromServer);

			const messages = selectConversationMessages("ch1")(
				useSocketStore.getState(),
			);
			expect(messages).toHaveLength(2);
			expect(messages[0].id).toBe("pending-1");
		});
	});

	describe("setMessageStatus — localStorage cleanup", () => {
		it("removes from failed localStorage when transitioning to pending", () => {
			// Seed failed in localStorage
			setChannelFailedMessages("ch1", [
				{
					id: "msg-1",
					sender: "user",
					content: [{ type: "text", text: "err" }],
					status: "failed",
				},
			]);

			// Seed failed in-memory
			useSocketStore.setState({
				conversationMessages: {
					ch1: [
						{
							id: "msg-1",
							sender: "user",
							content: [{ type: "text", text: "err" }],
							status: "failed",
						},
					],
				},
			});

			useSocketStore.getState().setMessageStatus("ch1", "msg-1", "pending");

			const messages = selectConversationMessages("ch1")(
				useSocketStore.getState(),
			);
			expect(messages[0].status).toBe("pending");
			expect(getChannelFailedMessages("ch1")).toEqual([]);
		});
	});

	describe("decrementRefCount — clears messages", () => {
		it("clears conversationMessages when refcount drops to 0", () => {
			useSocketStore.setState({
				subscriptionRefCounts: { "conversation:ch1": 1 },
				conversationMessages: {
					ch1: [
						{
							id: "1",
							sender: "user",
							content: [{ type: "text", text: "hi" }],
							status: "sent",
						},
					],
				},
			});

			useSocketStore.getState().decrementRefCount("conversation:ch1");

			const state = useSocketStore.getState();
			expect(state.subscriptionRefCounts).toEqual({});
			expect(state.conversationMessages.ch1).toBeUndefined();
		});

		it("preserves messages when refcount > 0", () => {
			useSocketStore.setState({
				subscriptionRefCounts: { "conversation:ch1": 2 },
				conversationMessages: {
					ch1: [
						{
							id: "1",
							sender: "user",
							content: [{ type: "text", text: "hi" }],
							status: "sent",
						},
					],
				},
			});

			useSocketStore.getState().decrementRefCount("conversation:ch1");

			const state = useSocketStore.getState();
			expect(state.subscriptionRefCounts["conversation:ch1"]).toBe(1);
			expect(state.conversationMessages.ch1).toHaveLength(1);
		});
	});

	describe("selectConversationMessages", () => {
		it("returns stable empty array for unknown channel", () => {
			const selector = selectConversationMessages("unknown");
			const a = selector(useSocketStore.getState());
			const b = selector(useSocketStore.getState());
			expect(a).toBe(b); // referential equality
			expect(a).toEqual([]);
		});
	});

	describe("handleServerMessage — notification event", () => {
		it("appends notification event to channel", () => {
			const { handleServerMessage } = useSocketStore.getState();
			const event: TNotificationEventFromServer = {
				action: "message",
				type: "notification",
				delivery: "event",
				id: "n1",
				channel: "alerts",
				title: "Deploy",
				body: "v1.0 is live",
				timestamp: "2025-01-01T00:00:00.000Z",
			};
			handleServerMessage(event);

			const notifications = selectNotificationMessages("alerts")(
				useSocketStore.getState(),
			);
			expect(notifications).toHaveLength(1);
			expect(notifications[0]).toEqual({
				id: "n1",
				title: "Deploy",
				body: "v1.0 is live",
				timestamp: "2025-01-01T00:00:00.000Z",
			});
		});

		it("appends to existing notifications", () => {
			const { handleServerMessage } = useSocketStore.getState();
			handleServerMessage({
				action: "message",
				type: "notification",
				delivery: "event",
				id: "n1",
				channel: "alerts",
				title: "First",
				body: "body1",
				timestamp: "2025-01-01T00:00:00.000Z",
			} satisfies TNotificationEventFromServer);
			handleServerMessage({
				action: "message",
				type: "notification",
				delivery: "event",
				id: "n2",
				channel: "alerts",
				title: "Second",
				body: "body2",
				timestamp: "2025-01-01T00:00:01.000Z",
			} satisfies TNotificationEventFromServer);

			const notifications = selectNotificationMessages("alerts")(
				useSocketStore.getState(),
			);
			expect(notifications).toHaveLength(2);
		});
	});

	describe("handleServerMessage — notification dump", () => {
		it("replaces channel notifications with dump", () => {
			const { handleServerMessage } = useSocketStore.getState();
			handleServerMessage({
				action: "message",
				type: "notification",
				delivery: "event",
				id: "old",
				channel: "alerts",
				title: "Old",
				body: "old body",
				timestamp: "2025-01-01T00:00:00.000Z",
			} satisfies TNotificationEventFromServer);

			handleServerMessage({
				action: "message",
				type: "notification",
				delivery: "dump",
				channel: "alerts",
				notifications: [
					{
						id: "new1",
						title: "Fresh",
						body: "fresh body",
						timestamp: "2025-01-01T00:01:00.000Z",
					},
				],
			} satisfies TNotificationDumpFromServer);

			const notifications = selectNotificationMessages("alerts")(
				useSocketStore.getState(),
			);
			expect(notifications).toHaveLength(1);
			expect(notifications[0].id).toBe("new1");
		});
	});

	describe("decrementRefCount — type isolation", () => {
		it("clears notificationMessages when notification refcount drops to 0", () => {
			useSocketStore.setState({
				subscriptionRefCounts: { "notification:alerts": 1 },
				notificationMessages: {
					alerts: [
						{
							id: "n1",
							title: "T",
							body: "B",
							timestamp: "2025-01-01T00:00:00.000Z",
						},
					],
				},
			});

			useSocketStore.getState().decrementRefCount("notification:alerts");

			const state = useSocketStore.getState();
			expect(state.subscriptionRefCounts).toEqual({});
			expect(state.notificationMessages.alerts).toBeUndefined();
		});

		it("does not touch conversationMessages when notification refcount drops", () => {
			useSocketStore.setState({
				subscriptionRefCounts: { "notification:ch1": 1 },
				conversationMessages: {
					ch1: [
						{
							id: "1",
							sender: "user",
							content: [{ type: "text", text: "hi" }],
							status: "sent",
						},
					],
				},
				notificationMessages: {
					ch1: [
						{
							id: "n1",
							title: "T",
							body: "B",
							timestamp: "2025-01-01T00:00:00.000Z",
						},
					],
				},
			});

			useSocketStore.getState().decrementRefCount("notification:ch1");

			const state = useSocketStore.getState();
			expect(state.conversationMessages.ch1).toHaveLength(1);
			expect(state.notificationMessages.ch1).toBeUndefined();
		});

		it("does not touch notificationMessages when conversation refcount drops", () => {
			useSocketStore.setState({
				subscriptionRefCounts: { "conversation:ch1": 1 },
				conversationMessages: {
					ch1: [
						{
							id: "1",
							sender: "user",
							content: [{ type: "text", text: "hi" }],
							status: "sent",
						},
					],
				},
				notificationMessages: {
					ch1: [
						{
							id: "n1",
							title: "T",
							body: "B",
							timestamp: "2025-01-01T00:00:00.000Z",
						},
					],
				},
			});

			useSocketStore.getState().decrementRefCount("conversation:ch1");

			const state = useSocketStore.getState();
			expect(state.conversationMessages.ch1).toBeUndefined();
			expect(state.notificationMessages.ch1).toHaveLength(1);
		});
	});

	describe("selectNotificationMessages", () => {
		it("returns stable empty array for unknown channel", () => {
			const selector = selectNotificationMessages("unknown");
			const a = selector(useSocketStore.getState());
			const b = selector(useSocketStore.getState());
			expect(a).toBe(b);
			expect(a).toEqual([]);
		});
	});
});
