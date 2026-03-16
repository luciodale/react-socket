import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { createZustandAdapter } from "../../../adapters/zustand";
import { createSocket } from "../../../socket";
import { MockTransport } from "../../helpers/mock-transport";

// ── Types ────────────────────────────────────────────────────────────

type TMessage = { id: string; text: string };

type TState = {
	conversations: Record<string, TMessage[]>;
};

const EMPTY: TMessage[] = [];

type TServerMsg =
	| {
			action: "message";
			type: "conversation";
			channel: string;
			id: string;
			text: string;
	  }
	| {
			action: "subscribed";
			type: string;
			channel: string;
	  };

type TClientMsg =
	| { action: "subscribe"; type: string; channel: string }
	| { action: "unsubscribe"; type: string; channel: string }
	| { action: "send"; channel: string; text: string };

// ── Helpers ──────────────────────────────────────────────────────────

function setup() {
	const useStore = create<TState>()(() => ({
		conversations: {},
	}));

	const adapter = createZustandAdapter(useStore);

	const socket = createSocket<TServerMsg, TClientMsg, TState>({
		store: adapter,
		subscribe: (type, channel) => ({ action: "subscribe", type, channel }),
		unsubscribe: (type, channel) => ({
			action: "unsubscribe",
			type,
			channel,
		}),
		resolveSubscriptionAck: (msg) => {
			if (msg.action === "subscribed") {
				return { type: msg.type, channel: msg.channel };
			}
			return null;
		},
		onMessage(msg, api) {
			if (msg.action === "message" && msg.type === "conversation") {
				api.set((s) => ({
					conversations: {
						...s.conversations,
						[msg.channel]: [
							...(s.conversations[msg.channel] ?? []),
							{ id: msg.id, text: msg.text },
						],
					},
				}));
			}
		},
		onChannelCleanup(type, channel, api) {
			if (type === "conversation") {
				api.set((s) => {
					const { [channel]: _, ...rest } = s.conversations;
					return { conversations: rest };
				});
			}
		},
	});

	const transport = new MockTransport();

	function wrapper({ children }: { children: ReactNode }) {
		return createElement(socket.Provider, {
			url: "ws://test",
			transport,
			children,
		});
	}

	return { socket, transport, wrapper, useStore };
}

// ── Lifecycle ────────────────────────────────────────────────────────

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────

describe("useSubscription – conversation", () => {
	it("subscribes on mount and cleans up on unmount", () => {
		const { socket, transport, wrapper } = setup();

		const { unmount } = renderHook(
			() =>
				socket.useSubscription(
					"conversation",
					"ch1",
					(s) => s.conversations["ch1"] ?? EMPTY,
				),
			{ wrapper },
		);

		act(() => {
			transport.simulateOpen();
		});

		const subs = transport.sentMessages.filter(
			(m) => m.includes('"subscribe"') && m.includes('"conversation"'),
		);
		expect(subs.length).toBeGreaterThanOrEqual(1);

		unmount();

		expect(transport.disconnectCalls.length).toBeGreaterThanOrEqual(1);
	});

	it("returns messages from store after server message", () => {
		const { socket, transport, wrapper } = setup();

		const { result } = renderHook(
			() =>
				socket.useSubscription(
					"conversation",
					"ch1",
					(s) => s.conversations["ch1"] ?? EMPTY,
				),
			{ wrapper },
		);

		act(() => {
			transport.simulateOpen();
		});

		act(() => {
			transport.simulateMessage(
				JSON.stringify({
					action: "message",
					type: "conversation",
					channel: "ch1",
					id: "1",
					text: "hello",
				} satisfies TServerMsg),
			);
		});

		expect(result.current.data).toHaveLength(1);
		expect(result.current.data[0].text).toBe("hello");
	});

	it("switches channels on channel change", () => {
		const { socket, transport, wrapper } = setup();

		const { rerender } = renderHook(
			({ channel }: { channel: string }) =>
				socket.useSubscription(
					"conversation",
					channel,
					(s) => s.conversations[channel] ?? EMPTY,
				),
			{ wrapper, initialProps: { channel: "ch1" } },
		);

		act(() => {
			transport.simulateOpen();
		});
		transport.sentMessages = [];

		rerender({ channel: "ch2" });

		const unsubs = transport.sentMessages.filter(
			(m) => m.includes('"unsubscribe"') && m.includes("ch1"),
		);
		const subs = transport.sentMessages.filter(
			(m) => m.includes('"subscribe"') && m.includes("ch2"),
		);
		expect(unsubs.length).toBeGreaterThanOrEqual(1);
		expect(subs.length).toBeGreaterThanOrEqual(1);
	});

	it("cleans up store state on unmount via onChannelCleanup", () => {
		const { socket, transport, wrapper, useStore } = setup();

		const { unmount } = renderHook(
			() =>
				socket.useSubscription(
					"conversation",
					"ch1",
					(s) => s.conversations["ch1"] ?? EMPTY,
				),
			{ wrapper },
		);

		act(() => {
			transport.simulateOpen();
		});

		act(() => {
			transport.simulateMessage(
				JSON.stringify({
					action: "message",
					type: "conversation",
					channel: "ch1",
					id: "1",
					text: "hello",
				} satisfies TServerMsg),
			);
		});

		expect(useStore.getState().conversations["ch1"]).toHaveLength(1);

		unmount();

		expect(useStore.getState().conversations["ch1"]).toBeUndefined();
	});

	it("accumulates multiple messages in the same channel", () => {
		const { socket, transport, wrapper } = setup();

		const { result } = renderHook(
			() =>
				socket.useSubscription(
					"conversation",
					"ch1",
					(s) => s.conversations["ch1"] ?? EMPTY,
				),
			{ wrapper },
		);

		act(() => {
			transport.simulateOpen();
		});

		act(() => {
			transport.simulateMessage(
				JSON.stringify({
					action: "message",
					type: "conversation",
					channel: "ch1",
					id: "1",
					text: "first",
				} satisfies TServerMsg),
			);
		});

		act(() => {
			transport.simulateMessage(
				JSON.stringify({
					action: "message",
					type: "conversation",
					channel: "ch1",
					id: "2",
					text: "second",
				} satisfies TServerMsg),
			);
		});

		expect(result.current.data).toHaveLength(2);
		expect(result.current.data[0].text).toBe("first");
		expect(result.current.data[1].text).toBe("second");
	});
});
