import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSubNotification } from "../../../socket/hooks/use-sub-notification";
import { WebSocketProvider } from "../../../socket/index";
import { useSocketStore } from "../../../socket/store";
import type { TNotificationEventFromServer } from "../../../socket/types";
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

describe("useSubNotification", () => {
	it("subscribes on mount and cleans up on unmount", () => {
		const transport = new MockTransport();
		const wrapper = createWrapper(transport);

		const { unmount } = renderHook(
			() => useSubNotification({ channel: "alerts" }),
			{ wrapper },
		);

		act(() => {
			transport.simulateOpen();
		});

		const subs = transport.sentMessages.filter(
			(m) => m.includes('"subscribe"') && m.includes('"notification"'),
		);
		expect(subs.length).toBeGreaterThanOrEqual(1);

		unmount();

		expect(transport.disconnectCalls.length).toBeGreaterThanOrEqual(1);
	});

	it("returns notifications from store", () => {
		const transport = new MockTransport();
		const wrapper = createWrapper(transport);

		const { result } = renderHook(
			() => useSubNotification({ channel: "alerts" }),
			{ wrapper },
		);

		act(() => {
			transport.simulateOpen();
		});

		act(() => {
			useSocketStore.getState().handleServerMessage({
				action: "message",
				type: "notification",
				delivery: "event",
				id: "n1",
				channel: "alerts",
				title: "Deploy",
				body: "v1.0 is live",
				timestamp: "2025-01-01T00:00:00.000Z",
			} satisfies TNotificationEventFromServer);
		});

		expect(result.current.notifications).toHaveLength(1);
		expect(result.current.notifications[0].title).toBe("Deploy");
	});

	it("switches channels on channel change", () => {
		const transport = new MockTransport();
		const wrapper = createWrapper(transport);

		const { rerender } = renderHook(
			(props: { channel: string }) =>
				useSubNotification({ channel: props.channel }),
			{ wrapper, initialProps: { channel: "alerts" } },
		);

		act(() => {
			transport.simulateOpen();
		});
		transport.sentMessages = [];

		rerender({ channel: "updates" });

		const unsubs = transport.sentMessages.filter(
			(m) => m.includes('"unsubscribe"') && m.includes("alerts"),
		);
		const subs = transport.sentMessages.filter(
			(m) => m.includes('"subscribe"') && m.includes("updates"),
		);
		expect(unsubs.length).toBeGreaterThanOrEqual(1);
		expect(subs.length).toBeGreaterThanOrEqual(1);
	});
});
