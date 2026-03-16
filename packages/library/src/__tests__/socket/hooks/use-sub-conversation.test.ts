import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionState, useSend, useSubscription } from "../../../hooks";
import { WebSocketManager } from "../../../manager";
import { MockTransport } from "../../helpers/mock-transport";

function createTestManager() {
	const transport = new MockTransport();
	const manager = new WebSocketManager({
		url: "ws://test",
		transport,
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

describe("useSubscription", () => {
	it("subscribes on mount and unsubscribes on unmount", () => {
		const { manager, transport } = createTestManager();
		manager.connect();
		transport.simulateOpen();

		const subData = JSON.stringify({
			action: "subscribe",
			type: "conversation",
			channel: "ch1",
		});

		const { unmount } = renderHook(() =>
			useSubscription(manager, "conversation:ch1", subData),
		);

		expect(manager.getRefCount("conversation:ch1")).toBe(1);
		expect(transport.sentMessages).toContain(subData);

		unmount();
		expect(manager.getRefCount("conversation:ch1")).toBe(0);
	});

	it("switches subscriptions on key change", () => {
		const { manager, transport } = createTestManager();
		manager.connect();
		transport.simulateOpen();

		const { rerender } = renderHook(
			({ key, data }: { key: string; data: string }) =>
				useSubscription(manager, key, data),
			{
				initialProps: {
					key: "conversation:ch1",
					data: JSON.stringify({
						action: "subscribe",
						type: "conversation",
						channel: "ch1",
					}),
				},
			},
		);

		expect(manager.getRefCount("conversation:ch1")).toBe(1);

		rerender({
			key: "conversation:ch2",
			data: JSON.stringify({
				action: "subscribe",
				type: "conversation",
				channel: "ch2",
			}),
		});

		expect(manager.getRefCount("conversation:ch1")).toBe(0);
		expect(manager.getRefCount("conversation:ch2")).toBe(1);
	});

	it("subscribes without data", () => {
		const { manager, transport } = createTestManager();
		manager.connect();
		transport.simulateOpen();
		transport.sentMessages = [];

		renderHook(() => useSubscription(manager, "conversation:ch1"));

		expect(manager.getRefCount("conversation:ch1")).toBe(1);
		// no message sent when data is undefined
		expect(transport.sentMessages).toHaveLength(0);
	});
});

describe("useConnectionState", () => {
	it("returns current connection state and updates reactively", () => {
		const { manager, transport } = createTestManager();

		const { result } = renderHook(() => useConnectionState(manager));
		expect(result.current).toBe("disconnected");

		act(() => {
			manager.connect();
		});
		expect(result.current).toBe("connecting");

		act(() => {
			transport.simulateOpen();
		});
		expect(result.current).toBe("connected");

		act(() => {
			manager.disconnect();
		});
		expect(result.current).toBe("disconnected");
	});
});

describe("useSend", () => {
	it("returns a stable send function that delegates to manager", () => {
		const { manager, transport } = createTestManager();
		manager.connect();
		transport.simulateOpen();
		transport.sentMessages = [];

		const { result } = renderHook(() => useSend(manager));

		const data = JSON.stringify({ text: "hello" });
		const sent = result.current("msg1", data);
		expect(sent).toBe(true);
		expect(transport.sentMessages).toContain(data);
	});

	it("returns false when not connected", () => {
		const { manager } = createTestManager();

		const { result } = renderHook(() => useSend(manager));

		const sent = result.current("msg1", JSON.stringify({ text: "hello" }));
		expect(sent).toBe(false);
	});
});
