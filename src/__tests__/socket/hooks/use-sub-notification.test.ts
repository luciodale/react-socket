import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { createZustandAdapter } from "../../../adapters/zustand";
import { createSocket } from "../../../socket";
import { MockTransport } from "../../helpers/mock-transport";

// ── Types ────────────────────────────────────────────────────────────

type TNotification = { id: string; title: string; body: string };

type TState = {
	notifications: Record<string, TNotification[]>;
};

const EMPTY: TNotification[] = [];

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

type TClientMsg =
	| { action: "subscribe"; type: string; channel: string }
	| { action: "unsubscribe"; type: string; channel: string };

// ── Helpers ──────────────────────────────────────────────────────────

function setup() {
	const useStore = create<TState>()(() => ({
		notifications: {},
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
			if (msg.action === "message" && msg.type === "notification") {
				api.set((s) => ({
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
		onChannelCleanup(type, channel, api) {
			if (type === "notification") {
				api.set((s) => {
					const { [channel]: _, ...rest } = s.notifications;
					return { notifications: rest };
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

describe("useSubscription – notification", () => {
	it("subscribes on mount and cleans up on unmount", () => {
		const { socket, transport, wrapper } = setup();

		const { unmount } = renderHook(
			() =>
				socket.useSubscription(
					"notification",
					"alerts",
					(s) => s.notifications["alerts"] ?? EMPTY,
				),
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

	it("returns notifications from store after server message", () => {
		const { socket, transport, wrapper } = setup();

		const { result } = renderHook(
			() =>
				socket.useSubscription(
					"notification",
					"alerts",
					(s) => s.notifications["alerts"] ?? EMPTY,
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
					type: "notification",
					channel: "alerts",
					id: "n1",
					title: "Deploy",
					body: "v1.0 is live",
				} satisfies TServerMsg),
			);
		});

		expect(result.current.data).toHaveLength(1);
		expect(result.current.data[0].title).toBe("Deploy");
		expect(result.current.data[0].body).toBe("v1.0 is live");
	});

	it("switches channels on channel change", () => {
		const { socket, transport, wrapper } = setup();

		const { rerender } = renderHook(
			({ channel }: { channel: string }) =>
				socket.useSubscription(
					"notification",
					channel,
					(s) => s.notifications[channel] ?? EMPTY,
				),
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

	it("cleans up store state on unmount via onChannelCleanup", () => {
		const { socket, transport, wrapper, useStore } = setup();

		const { unmount } = renderHook(
			() =>
				socket.useSubscription(
					"notification",
					"alerts",
					(s) => s.notifications["alerts"] ?? EMPTY,
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
					type: "notification",
					channel: "alerts",
					id: "n1",
					title: "Deploy",
					body: "v1.0 is live",
				} satisfies TServerMsg),
			);
		});

		expect(useStore.getState().notifications["alerts"]).toHaveLength(1);

		unmount();

		expect(useStore.getState().notifications["alerts"]).toBeUndefined();
	});

	it("isolates notifications across channels", () => {
		const { socket, transport, wrapper } = setup();

		const { result: alertsResult } = renderHook(
			() =>
				socket.useSubscription(
					"notification",
					"alerts",
					(s) => s.notifications["alerts"] ?? EMPTY,
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

		expect(alertsResult.current.data).toHaveLength(1);
		expect(alertsResult.current.data[0].title).toBe("Alert");
	});
});
