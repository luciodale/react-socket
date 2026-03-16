import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { useConnectionState, useSubscription } from "../../../hooks";
import { WebSocketManager } from "../../../manager";
import { MockTransport } from "../../helpers/mock-transport";

// ── Types ────────────────────────────────────────────────────────────

type TNotification = { id: string; title: string; body: string };

type TState = {
	notifications: Record<string, TNotification[]>;
};

type TServerMsg =
	| {
			action: "message";
			type: "notification";
			channel: string;
			id: string;
			title: string;
			body: string;
	  }
	| {
			action: "subscribed";
			type: string;
			channel: string;
	  };

// ── Helpers ──────────────────────────────────────────────────────────

function setup() {
	const useStore = create<TState>()(() => ({
		notifications: {},
	}));

	const transport = new MockTransport();
	const manager = new WebSocketManager({
		url: "ws://test",
		transport,
		onMessage(parsed) {
			const msg = parsed as TServerMsg;

			if (msg.action === "subscribed") {
				manager.resolvePendingSubscription(`${msg.type}:${msg.channel}`);
				return;
			}

			if (msg.action === "message" && msg.type === "notification") {
				useStore.setState((s) => ({
					notifications: {
						...s.notifications,
						[msg.channel]: [
							...(s.notifications[msg.channel] ?? []),
							{ id: msg.id, title: msg.title, body: msg.body },
						],
					},
				}));
			}
		},
	});

	return { manager, transport, useStore };
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

describe("useSubscription – notification", () => {
	it("subscribes on mount and unsubscribes on unmount", () => {
		const { manager, transport } = setup();
		manager.connect();
		transport.simulateOpen();

		const subData = JSON.stringify({
			action: "subscribe",
			type: "notification",
			channel: "alerts",
		});

		const { unmount } = renderHook(() =>
			useSubscription(manager, "notification:alerts", subData),
		);

		expect(manager.getRefCount("notification:alerts")).toBe(1);
		expect(transport.sentMessages).toContain(subData);

		unmount();
		expect(manager.getRefCount("notification:alerts")).toBe(0);
	});

	it("receives messages via onMessage into store", () => {
		const { manager, transport, useStore } = setup();
		manager.connect();
		transport.simulateOpen();

		renderHook(() =>
			useSubscription(
				manager,
				"notification:alerts",
				JSON.stringify({
					action: "subscribe",
					type: "notification",
					channel: "alerts",
				}),
			),
		);

		act(() => {
			transport.simulateMessage(
				JSON.stringify({
					action: "message",
					type: "notification",
					channel: "alerts",
					id: "n1",
					title: "Deploy",
					body: "v1.0 is live",
				} satisfies TServerMsg),
			);
		});

		const notifications = useStore.getState().notifications.alerts;
		expect(notifications).toHaveLength(1);
		expect(notifications[0].title).toBe("Deploy");
		expect(notifications[0].body).toBe("v1.0 is live");
	});

	it("switches channels on channel change", () => {
		const { manager, transport } = setup();
		manager.connect();
		transport.simulateOpen();

		const { rerender } = renderHook(
			({ channel }: { channel: string }) =>
				useSubscription(
					manager,
					`notification:${channel}`,
					JSON.stringify({
						action: "subscribe",
						type: "notification",
						channel,
					}),
				),
			{ initialProps: { channel: "alerts" } },
		);

		expect(manager.getRefCount("notification:alerts")).toBe(1);
		transport.sentMessages = [];

		rerender({ channel: "updates" });

		expect(manager.getRefCount("notification:alerts")).toBe(0);
		expect(manager.getRefCount("notification:updates")).toBe(1);
	});

	it("isolates notifications across channels", () => {
		const { manager, transport, useStore } = setup();
		manager.connect();
		transport.simulateOpen();

		renderHook(() =>
			useSubscription(
				manager,
				"notification:alerts",
				JSON.stringify({
					action: "subscribe",
					type: "notification",
					channel: "alerts",
				}),
			),
		);

		act(() => {
			transport.simulateMessage(
				JSON.stringify({
					action: "message",
					type: "notification",
					channel: "alerts",
					id: "n1",
					title: "Alert",
					body: "something broke",
				} satisfies TServerMsg),
			);
		});

		act(() => {
			transport.simulateMessage(
				JSON.stringify({
					action: "message",
					type: "notification",
					channel: "updates",
					id: "n2",
					title: "Update",
					body: "new version",
				} satisfies TServerMsg),
			);
		});

		expect(useStore.getState().notifications.alerts).toHaveLength(1);
		expect(useStore.getState().notifications.alerts[0].title).toBe("Alert");
		// updates channel also received (onMessage doesn't filter by subscription)
		expect(useStore.getState().notifications.updates).toHaveLength(1);
	});
});

describe("useConnectionState – with notifications", () => {
	it("tracks connection state reactively", () => {
		const { manager, transport } = setup();

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
	});
});
