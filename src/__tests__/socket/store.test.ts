import { beforeEach, describe, expect, it } from "vitest";
import { create } from "zustand";
import { createZustandAdapter } from "../../adapters/zustand";
import { WebSocketManager } from "../../socket/manager";
import type { TStoreAdapter } from "../../socket/types";
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
	const adapter = createZustandAdapter(useStore);
	return { useStore, adapter };
}

function onMessage(
	msg: TServerMsg,
	api: { set: (fn: (s: TTestState) => Partial<TTestState>) => void },
) {
	if (msg.action !== "message" || msg.type !== "conversation") return;

	if (msg.delivery === "dump") {
		api.set((s) => ({
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
		api.set((s) => {
			const existing = s.messages[msg.channel] ?? [];
			const idx = existing.findIndex((m) => m.id === msg.id);

			if (idx !== -1) {
				const updated = [...existing];
				const { undeliveredAt: _, ...rest } = updated[idx];
				updated[idx] = { ...rest, status: "sent" };
				return { messages: { ...s.messages, [msg.channel]: updated } };
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
		api.set((s) => {
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
			return { messages: { ...s.messages, [msg.channel]: updated } };
		});
	}
}

function onInFlightDrop(
	ids: string[],
	api: {
		set: (fn: (s: TTestState) => Partial<TTestState>) => void;
		get: () => TTestState;
	},
) {
	for (const id of ids) {
		api.set((s) => {
			for (const [channel, msgs] of Object.entries(s.messages)) {
				const idx = msgs.findIndex((m) => m.id === id);
				if (idx !== -1) {
					const updated = [...msgs];
					updated[idx] = {
						...updated[idx],
						status: "undelivered",
						undeliveredAt: new Date().toISOString(),
					};
					return { messages: { ...s.messages, [channel]: updated } };
				}
			}
			return s;
		});
	}
}

function onChannelCleanup(
	type: string,
	channel: string,
	api: { set: (fn: (s: TTestState) => Partial<TTestState>) => void },
) {
	if (type === "conversation") {
		api.set((s) => {
			const { [channel]: _, ...rest } = s.messages;
			return { messages: rest };
		});
	}
}

function createConnectedManager(adapter: TStoreAdapter<TTestState>) {
	const transport = new MockTransport();
	const storeApi = {
		set: (fn: (s: TTestState) => Partial<TTestState>) => adapter.set(fn),
		get: () => adapter.get(),
	};

	const manager = new WebSocketManager({
		url: "ws://test",
		transport,
		pingIntervalMs: 60_000,
		pongTimeoutMs: 5_000,
		reconnectBaseDelayMs: 10,
		reconnectMaxAttempts: 3,
		reconnectMaxDelayMs: 100,
		serializeSubscribe: (type, channel) =>
			JSON.stringify({ action: "subscribe", type, channel }),
		serializeUnsubscribe: (type, channel) =>
			JSON.stringify({ action: "unsubscribe", type, channel }),
		onRawMessage(parsed) {
			const msg = parsed as TServerMsg;
			onMessage(msg, storeApi);
		},
		onInFlightDrop(ids) {
			onInFlightDrop(ids, storeApi);
		},
	});

	manager.connect();
	transport.simulateOpen();

	return { manager, transport };
}

// ── Tests ──────────────────────────────────────────────────────────

let useStore: ReturnType<typeof createTestStore>["useStore"];
let adapter: ReturnType<typeof createTestStore>["adapter"];

beforeEach(() => {
	const t = createTestStore();
	useStore = t.useStore;
	adapter = t.adapter;
});

describe("store via onMessage callback", () => {
	describe("event delivery", () => {
		it("appends event to channel", () => {
			const { transport } = createConnectedManager(adapter);

			transport.simulateMessage(
				JSON.stringify({
					action: "message",
					type: "conversation",
					delivery: "event",
					id: "1",
					channel: "ch1",
					sender: "user",
					content: [{ type: "text", text: "hi" }],
				}),
			);

			const msgs = useStore.getState().messages.ch1;
			expect(msgs).toHaveLength(1);
			expect(msgs[0].id).toBe("1");
			expect(msgs[0].status).toBe("sent");
		});

		it("appends to existing messages", () => {
			const { transport } = createConnectedManager(adapter);

			transport.simulateMessage(
				JSON.stringify({
					action: "message",
					type: "conversation",
					delivery: "event",
					id: "1",
					channel: "ch1",
					sender: "user",
					content: [{ type: "text", text: "hi" }],
				}),
			);
			transport.simulateMessage(
				JSON.stringify({
					action: "message",
					type: "conversation",
					delivery: "event",
					id: "2",
					channel: "ch1",
					sender: "bot",
					content: [{ type: "text", text: "hello" }],
				}),
			);

			expect(useStore.getState().messages.ch1).toHaveLength(2);
		});

		it("transitions pending message to sent on echo", () => {
			useStore.setState({
				messages: {
					ch1: [
						{
							id: "opt-1",
							sender: "user",
							content: [{ type: "text", text: "retry" }],
							status: "pending",
						},
					],
				},
			});

			const { transport } = createConnectedManager(adapter);

			transport.simulateMessage(
				JSON.stringify({
					action: "message",
					type: "conversation",
					delivery: "event",
					id: "opt-1",
					channel: "ch1",
					sender: "user",
					content: [{ type: "text", text: "retry" }],
				}),
			);

			const msgs = useStore.getState().messages.ch1;
			expect(msgs).toHaveLength(1);
			expect(msgs[0]).toMatchObject({ id: "opt-1", status: "sent" });
		});
	});

	describe("dump delivery", () => {
		it("replaces channel messages with dump", () => {
			const { transport } = createConnectedManager(adapter);

			// seed existing
			transport.simulateMessage(
				JSON.stringify({
					action: "message",
					type: "conversation",
					delivery: "event",
					id: "old",
					channel: "ch1",
					sender: "user",
					content: [{ type: "text", text: "old" }],
				}),
			);

			// dump replaces
			transport.simulateMessage(
				JSON.stringify({
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
				}),
			);

			const msgs = useStore.getState().messages.ch1;
			expect(msgs).toHaveLength(1);
			expect(msgs[0].id).toBe("new1");
			expect(msgs[0].status).toBe("sent");
		});
	});

	describe("error delivery", () => {
		it("marks message undelivered", () => {
			useStore.setState({
				messages: {
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

			const { transport } = createConnectedManager(adapter);

			transport.simulateMessage(
				JSON.stringify({
					action: "message",
					type: "conversation",
					delivery: "error",
					channel: "ch1",
					error: "token_expired",
					message: "Token expired",
					messageId: "msg-1",
				}),
			);

			const msgs = useStore.getState().messages.ch1;
			expect(msgs[0].status).toBe("undelivered");
			expect(msgs[0].undeliveredAt).toBeDefined();
		});

		it("error without messageId is a no-op", () => {
			useStore.setState({
				messages: {
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

			const { transport } = createConnectedManager(adapter);

			transport.simulateMessage(
				JSON.stringify({
					action: "message",
					type: "conversation",
					delivery: "error",
					channel: "ch1",
					error: "general_error",
					message: "something broke",
				}),
			);

			expect(useStore.getState().messages.ch1[0].status).toBe("pending");
		});
	});

	describe("channel isolation", () => {
		it("messages from different channels do not interfere", () => {
			const { transport } = createConnectedManager(adapter);

			transport.simulateMessage(
				JSON.stringify({
					action: "message",
					type: "conversation",
					delivery: "event",
					id: "1",
					channel: "ch1",
					sender: "user",
					content: [{ type: "text", text: "ch1 msg" }],
				}),
			);

			transport.simulateMessage(
				JSON.stringify({
					action: "message",
					type: "conversation",
					delivery: "event",
					id: "2",
					channel: "ch2",
					sender: "user",
					content: [{ type: "text", text: "ch2 msg" }],
				}),
			);

			expect(useStore.getState().messages.ch1).toHaveLength(1);
			expect(useStore.getState().messages.ch2).toHaveLength(1);
		});
	});

	describe("non-message actions are ignored", () => {
		it("subscribe_ack does not mutate store", () => {
			const { transport } = createConnectedManager(adapter);

			transport.simulateMessage(
				JSON.stringify({
					action: "subscribe_ack",
					type: "conversation",
					channel: "ch1",
				}),
			);

			expect(useStore.getState().messages).toEqual({});
		});
	});
});

describe("onInFlightDrop callback", () => {
	it("marks in-flight messages as undelivered on disconnect", () => {
		useStore.setState({
			messages: {
				ch1: [
					{
						id: "msg1",
						sender: "user",
						content: [{ type: "text", text: "hello" }],
						status: "pending",
					},
				],
			},
		});

		const { manager, transport } = createConnectedManager(adapter);
		manager.subscribe("conversation", "ch1");

		manager.send("msg1", JSON.stringify({
			action: "message",
			type: "conversation",
			id: "msg1",
			channel: "ch1",
			message: "hello",
		}));

		transport.simulateClose(1006);

		const msgs = useStore.getState().messages.ch1;
		expect(msgs[0].status).toBe("undelivered");
		expect(msgs[0].undeliveredAt).toBeDefined();

		manager.dispose();
	});

	it("does not fire when no in-flight messages exist", () => {
		const { manager, transport } = createConnectedManager(adapter);

		transport.simulateClose(1006);

		expect(useStore.getState().messages).toEqual({});

		manager.dispose();
	});
});

describe("onChannelCleanup callback", () => {
	it("clears channel messages", () => {
		useStore.setState({
			messages: {
				ch1: [
					{
						id: "1",
						sender: "user",
						content: [{ type: "text", text: "hi" }],
						status: "sent",
					},
				],
				ch2: [
					{
						id: "2",
						sender: "bot",
						content: [{ type: "text", text: "hey" }],
						status: "sent",
					},
				],
			},
		});

		const storeApi = {
			set: (fn: (s: TTestState) => Partial<TTestState>) =>
				adapter.set(fn),
			get: () => adapter.get(),
		};

		onChannelCleanup("conversation", "ch1", storeApi);

		const state = useStore.getState();
		expect(state.messages.ch1).toBeUndefined();
		expect(state.messages.ch2).toHaveLength(1);
	});

	it("is a no-op for non-conversation types", () => {
		useStore.setState({
			messages: {
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

		const storeApi = {
			set: (fn: (s: TTestState) => Partial<TTestState>) =>
				adapter.set(fn),
			get: () => adapter.get(),
		};

		onChannelCleanup("notification", "ch1", storeApi);

		expect(useStore.getState().messages.ch1).toHaveLength(1);
	});
});
