// Scope: this file covers manager→store WIRING patterns only — that the
// WebSocketManager parses wire frames and fans them out (in order) to a
// listener that drives a real external store, and that the inFlightDrop
// listener is invoked (or not) by the manager lifecycle. The reducer that
// maps frames onto store shape (delivery branches, channel keying, undelivered
// transitions, cleanup) is APP code and is intentionally NOT pinned here;
// per-listener manager behavior (deserialize, pong filtering, drop contents)
// lives in manager.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";
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
	  };

// ── Helpers ────────────────────────────────────────────────────────

function createTestStore() {
	const useStore = create<TTestState>()(() => ({
		messages: {},
	}));
	return { useStore };
}

// Minimal app-side reducer: appends an event frame to its channel. This is the
// consumer code the wiring drives — only the event branch is exercised here.
function onMessage(
	msg: TServerMsg,
	useStore: ReturnType<typeof createTestStore>["useStore"],
) {
	if (msg.action !== "message" || msg.type !== "conversation") return;
	if (msg.delivery !== "event") return;

	useStore.setState((s) => {
		const existing = s.messages[msg.channel] ?? [];
		return {
			messages: {
				...s.messages,
				[msg.channel]: [
					...existing,
					{
						id: msg.id,
						sender: msg.sender,
						content: msg.content,
						status: "sent" as const,
					},
				],
			},
		};
	});
}

function createConnectedManager(
	useStore: ReturnType<typeof createTestStore>["useStore"],
) {
	const transport = new MockTransport();

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
	});

	manager.addMessageListener((msg) => {
		onMessage(msg, useStore);
	});

	manager.connect();
	transport.simulateOpen();

	return { manager, transport };
}

// ── Tests ──────────────────────────────────────────────────────────

let useStore: ReturnType<typeof createTestStore>["useStore"];

beforeEach(() => {
	const t = createTestStore();
	useStore = t.useStore;
});

describe("store via addMessageListener", () => {
	it("delivers a parsed frame to the listener-backed store", () => {
		const { transport } = createConnectedManager(useStore);

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

		// The manager deserialized the wire frame and handed the typed object
		// to the listener, which landed it in the store with full content.
		const msgs = useStore.getState().messages.ch1;
		expect(msgs).toHaveLength(1);
		expect(msgs[0]).toEqual({
			id: "1",
			sender: "user",
			content: [{ type: "text", text: "hi" }],
			status: "sent",
		});
	});

	it("delivers multiple frames to the store in emit order", () => {
		const { transport } = createConnectedManager(useStore);

		transport.simulateMessage(
			JSON.stringify({
				action: "message",
				type: "conversation",
				delivery: "event",
				id: "1",
				channel: "ch1",
				sender: "user",
				content: [{ type: "text", text: "first" }],
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
				content: [{ type: "text", text: "second" }],
			}),
		);

		// Library guarantee: frames reach the listener in the order they
		// arrived on the wire. Assert the store reflects that exact order with
		// content, not just a count.
		const msgs = useStore.getState().messages.ch1;
		expect(msgs.map((m) => m.id)).toEqual(["1", "2"]);
		expect(msgs.map((m) => m.content[0].text)).toEqual(["first", "second"]);
	});

	it("fans the same frame out to every registered message listener", () => {
		const { manager, transport } = createConnectedManager(useStore);
		const second = vi.fn();
		manager.addMessageListener(second);

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

		// Both the store-backed listener and an additional listener receive the
		// identical deserialized object.
		expect(useStore.getState().messages.ch1).toHaveLength(1);
		expect(second).toHaveBeenCalledTimes(1);
		expect(second).toHaveBeenCalledWith({
			action: "message",
			type: "conversation",
			delivery: "event",
			id: "1",
			channel: "ch1",
			sender: "user",
			content: [{ type: "text", text: "hi" }],
		});
	});
});

describe("onInFlightDrop wiring", () => {
	it("does not invoke the drop listener when nothing is in flight", () => {
		const { manager, transport } = createConnectedManager(useStore);
		const onDrop = vi.fn();
		manager.addInFlightDropListener(onDrop);

		transport.simulateClose(1006);

		// Pin the manager behavior directly via the listener spy rather than
		// inferring it from an empty store: no in-flight messages → the drop
		// listener is never called.
		expect(onDrop).not.toHaveBeenCalled();

		manager.dispose();
	});
});
