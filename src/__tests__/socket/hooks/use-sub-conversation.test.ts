import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSubConversation } from "../../../socket/hooks/use-sub-conversation";
import { WebSocketProvider } from "../../../socket/index";
import { useSocketStore } from "../../../socket/store";
import type { TConversationEventFromServer } from "../../../socket/types";
import { MockTransport } from "../../helpers/mock-transport";

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

function createWrapper(transport: MockTransport) {
	return function Wrapper({ children }: { children: ReactNode }) {
		return createElement(WebSocketProvider, {
			url: "ws://test",
			config: { transport },
			children,
		});
	};
}

beforeEach(() => {
	resetStore();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("useSubConversation", () => {
	it("subscribes on mount and cleans up on unmount", () => {
		const transport = new MockTransport();
		const wrapper = createWrapper(transport);

		const { unmount } = renderHook(
			() => useSubConversation({ chatId: "ch1" }),
			{ wrapper },
		);

		act(() => {
			transport.simulateOpen();
		});

		const subs = transport.sentMessages.filter((m) =>
			m.includes('"subscribe"'),
		);
		expect(subs.length).toBeGreaterThanOrEqual(1);

		unmount();

		// Provider dispose() disconnects the transport on full unmount
		expect(transport.disconnectCalls.length).toBeGreaterThanOrEqual(1);
	});

	it("returns messages from store", () => {
		const transport = new MockTransport();
		const wrapper = createWrapper(transport);

		const { result } = renderHook(() => useSubConversation({ chatId: "ch1" }), {
			wrapper,
		});

		act(() => {
			transport.simulateOpen();
		});

		// Simulate a server message
		act(() => {
			useSocketStore.getState().handleServerMessage({
				action: "message",
				type: "conversation",
				delivery: "event",
				id: "1",
				channel: "ch1",
				sender: "bot",
				content: [{ type: "text", text: "hello" }],
			} satisfies TConversationEventFromServer);
		});

		expect(result.current.messages).toHaveLength(1);
		expect(result.current.messages[0].content[0].text).toBe("hello");
	});

	it("switches channels on chatId change", () => {
		const transport = new MockTransport();
		const wrapper = createWrapper(transport);

		const { rerender } = renderHook(
			(props: { chatId: string }) =>
				useSubConversation({ chatId: props.chatId }),
			{ wrapper, initialProps: { chatId: "ch1" } },
		);

		act(() => {
			transport.simulateOpen();
		});
		transport.sentMessages = [];

		rerender({ chatId: "ch2" });

		const unsubs = transport.sentMessages.filter(
			(m) => m.includes('"unsubscribe"') && m.includes("ch1"),
		);
		const subs = transport.sentMessages.filter(
			(m) => m.includes('"subscribe"') && m.includes("ch2"),
		);
		expect(unsubs.length).toBeGreaterThanOrEqual(1);
		expect(subs.length).toBeGreaterThanOrEqual(1);
	});

	it("stable sendMessage reference across renders", () => {
		const transport = new MockTransport();
		const wrapper = createWrapper(transport);

		const { result, rerender } = renderHook(
			() => useSubConversation({ chatId: "ch1" }),
			{ wrapper },
		);

		const first = result.current.sendMessage;
		rerender();
		expect(result.current.sendMessage).toBe(first);
	});
});
