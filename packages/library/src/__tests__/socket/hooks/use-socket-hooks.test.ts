import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	useSocketEvent,
	useSocketInFlightDrop,
	useSocketLastUnsubscribe,
	useSocketPendingSubscription,
	useSocketReady,
	useSocketSend,
	useSocketSendFailed,
	useSocketSendIntent,
	useSocketSubscription,
} from "../../../hooks";
import { WebSocketManager } from "../../../manager";
import { MockTransport } from "../../helpers/mock-transport";

type TClientMsg = { type: "sub"; key: string } | { type: "chat"; text: string };

type TServerMsg =
	| { type: "subscribe-ack"; key: string }
	| { type: "chat"; text: string };

function createManager() {
	const transport = new MockTransport();
	const manager = new WebSocketManager<TClientMsg, TServerMsg>({
		url: "ws://test",
		transport,
		serialize: (msg) => JSON.stringify(msg),
		deserialize: (raw) => JSON.parse(raw) as TServerMsg,
		reconnectBaseDelayMs: 10,
		reconnectMaxAttempts: 3,
		reconnectMaxDelayMs: 100,
		getSubscriptionResolvedKey: (m) =>
			m.type === "subscribe-ack" ? m.key : undefined,
	});
	manager.connect();
	transport.simulateOpen();
	return { manager, transport };
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("useSocketEvent", () => {
	it("only fires handler for matching discriminator value and narrows the msg", () => {
		const { manager, transport } = createManager();
		const received: { text: string }[] = [];

		renderHook(() =>
			useSocketEvent(manager, "chat", (m) => {
				received.push({ text: m.text });
			}),
		);

		act(() => {
			transport.simulateMessage(JSON.stringify({ type: "chat", text: "hi" }));
			transport.simulateMessage(
				JSON.stringify({ type: "subscribe-ack", key: "a" }),
			);
		});

		expect(received).toEqual([{ text: "hi" }]);
	});

	it("uses the latest handler without resubscribing", () => {
		const { manager, transport } = createManager();
		const snapshots: number[] = [];
		let handler = (_m: { type: "chat"; text: string }) => {
			snapshots.push(1);
		};
		const { rerender } = renderHook(() =>
			useSocketEvent(manager, "chat", handler),
		);

		act(() => {
			transport.simulateMessage(JSON.stringify({ type: "chat", text: "a" }));
		});

		handler = () => {
			snapshots.push(2);
		};
		rerender();

		act(() => {
			transport.simulateMessage(JSON.stringify({ type: "chat", text: "b" }));
		});

		expect(snapshots).toEqual([1, 2]);
	});
});

describe("useSocketSubscription", () => {
	it("subscribes on mount and unsubscribes on unmount", () => {
		const { manager } = createManager();
		const { unmount } = renderHook(() =>
			useSocketSubscription(manager, {
				key: "room:1",
				subscribe: { type: "sub", key: "room:1" },
			}),
		);

		expect(manager.getRefCount("room:1")).toBe(1);
		unmount();
		expect(manager.getRefCount("room:1")).toBe(0);
	});

	it("does not resubscribe when inline payloads change identity between renders", () => {
		const { manager } = createManager();
		const lastUnsubCalls: string[] = [];
		manager.addLastUnsubscribeListener((key) => lastUnsubCalls.push(key));

		const { rerender } = renderHook(() =>
			// new objects every render — identity changes but key is stable
			useSocketSubscription(manager, {
				key: "room:1",
				subscribe: { type: "sub", key: "room:1" },
				unsubscribe: { type: "sub", key: "room:1" },
			}),
		);

		expect(manager.getRefCount("room:1")).toBe(1);

		rerender();
		rerender();
		rerender();

		// stable: one subscribe, still ref 1, never fired a last-unsubscribe
		expect(manager.getRefCount("room:1")).toBe(1);
		expect(lastUnsubCalls).toHaveLength(0);
	});

	it("does not subscribe when enabled is false", () => {
		const { manager } = createManager();
		renderHook(() =>
			useSocketSubscription(manager, {
				key: "room:1",
				subscribe: { type: "sub", key: "room:1" },
				enabled: false,
			}),
		);
		expect(manager.getRefCount("room:1")).toBe(0);
	});

	it("subscribes when enabled flips false -> true and unsubscribes on true -> false", () => {
		const { manager } = createManager();

		const { rerender } = renderHook(
			({ enabled }: { enabled: boolean }) =>
				useSocketSubscription(manager, {
					key: "room:1",
					subscribe: { type: "sub", key: "room:1" },
					enabled,
				}),
			{ initialProps: { enabled: false } },
		);

		expect(manager.getRefCount("room:1")).toBe(0);

		rerender({ enabled: true });
		expect(manager.getRefCount("room:1")).toBe(1);

		rerender({ enabled: false });
		expect(manager.getRefCount("room:1")).toBe(0);

		rerender({ enabled: true });
		expect(manager.getRefCount("room:1")).toBe(1);
	});

	it("defaults enabled to true when not provided", () => {
		const { manager } = createManager();
		renderHook(() =>
			useSocketSubscription(manager, {
				key: "room:1",
				subscribe: { type: "sub", key: "room:1" },
			}),
		);
		expect(manager.getRefCount("room:1")).toBe(1);
	});
});

describe("useSocketPendingSubscription", () => {
	it("reports pending -> resolved via extractor", () => {
		const { manager, transport } = createManager();
		const { result } = renderHook(() =>
			useSocketPendingSubscription(manager, "room:1"),
		);

		expect(result.current).toBe(false);

		act(() => {
			manager.subscribe("room:1", { type: "sub", key: "room:1" });
		});
		expect(result.current).toBe(true);

		act(() => {
			transport.simulateMessage(
				JSON.stringify({ type: "subscribe-ack", key: "room:1" }),
			);
		});
		expect(result.current).toBe(false);
	});
});

describe("useSocketSend", () => {
	it("returns a typed send fn bound to the manager", () => {
		const { manager, transport } = createManager();
		const { result } = renderHook(() => useSocketSend(manager));

		act(() => {
			const ok = result.current.send({ type: "chat", text: "hey" }, "msg-1");
			expect(ok).toBe(true);
		});

		const sent = transport.sentMessages.find((m) => m.includes('"hey"'));
		expect(sent).toBeDefined();
	});
});

describe("useSocketSendIntent", () => {
	it("fires on every send, even when offline", () => {
		const transport = new MockTransport();
		const manager = new WebSocketManager<TClientMsg, TServerMsg>({
			url: "ws://test",
			transport,
			serialize: (msg) => JSON.stringify(msg),
			deserialize: (raw) => JSON.parse(raw) as TServerMsg,
		});
		const received: TClientMsg[] = [];
		renderHook(() =>
			useSocketSendIntent(manager, (params) => {
				received.push(params.data);
			}),
		);

		// offline send
		act(() => {
			manager.send({ data: { type: "chat", text: "offline" } });
		});
		// online send
		act(() => {
			manager.connect();
			transport.simulateOpen();
			manager.send({ data: { type: "chat", text: "online" } });
		});

		expect(received).toEqual([
			{ type: "chat", text: "offline" },
			{ type: "chat", text: "online" },
		]);
	});
});

describe("useSocketSendFailed", () => {
	it("fires for offline sends with reason not-connected, not for delivered ones", () => {
		const transport = new MockTransport();
		const manager = new WebSocketManager<TClientMsg, TServerMsg>({
			url: "ws://test",
			transport,
			serialize: (msg) => JSON.stringify(msg),
			deserialize: (raw) => JSON.parse(raw) as TServerMsg,
		});
		const failures: { data: TClientMsg; ackId?: string; reason: string }[] = [];
		renderHook(() =>
			useSocketSendFailed(manager, ({ data, ackId, reason }) => {
				failures.push({ data, ackId, reason });
			}),
		);

		// offline send — fails
		act(() => {
			manager.send({ data: { type: "chat", text: "offline" }, ackId: "m1" });
		});
		// online send — succeeds, must not fire
		act(() => {
			manager.connect();
			transport.simulateOpen();
			manager.send({ data: { type: "chat", text: "online" } });
		});

		expect(failures).toEqual([
			{
				data: { type: "chat", text: "offline" },
				ackId: "m1",
				reason: "not-connected",
			},
		]);
	});

	it("stops firing after unmount", () => {
		const transport = new MockTransport();
		const manager = new WebSocketManager<TClientMsg, TServerMsg>({
			url: "ws://test",
			transport,
			serialize: (msg) => JSON.stringify(msg),
			deserialize: (raw) => JSON.parse(raw) as TServerMsg,
		});
		const failures: TClientMsg[] = [];
		const { unmount } = renderHook(() =>
			useSocketSendFailed(manager, ({ data }) => {
				failures.push(data);
			}),
		);

		act(() => {
			manager.send({ data: { type: "chat", text: "one" } });
		});
		unmount();
		act(() => {
			manager.send({ data: { type: "chat", text: "two" } });
		});

		expect(failures).toEqual([{ type: "chat", text: "one" }]);
	});

	it("uses the latest handler without resubscribing", () => {
		const transport = new MockTransport();
		const manager = new WebSocketManager<TClientMsg, TServerMsg>({
			url: "ws://test",
			transport,
			serialize: (msg) => JSON.stringify(msg),
			deserialize: (raw) => JSON.parse(raw) as TServerMsg,
		});
		const seenBy: string[] = [];
		const { rerender } = renderHook(
			({ label }: { label: string }) =>
				useSocketSendFailed(manager, () => {
					seenBy.push(label);
				}),
			{ initialProps: { label: "first" } },
		);

		act(() => {
			manager.send({ data: { type: "chat", text: "a" } });
		});
		rerender({ label: "second" });
		act(() => {
			manager.send({ data: { type: "chat", text: "b" } });
		});

		expect(seenBy).toEqual(["first", "second"]);
	});
});

describe("useSocketInFlightDrop", () => {
	it("fires with dropped messages on disconnect", () => {
		const { manager, transport } = createManager();
		const dropped: { id: string; data: TClientMsg }[][] = [];

		renderHook(() =>
			useSocketInFlightDrop(manager, (messages) => {
				dropped.push(messages);
			}),
		);

		act(() => {
			manager.send({ data: { type: "chat", text: "hi" }, ackId: "m1" });
			transport.simulateClose(1006);
		});

		expect(dropped).toHaveLength(1);
		expect(dropped[0]).toEqual([
			{ id: "m1", data: { type: "chat", text: "hi" } },
		]);
	});
});

describe("useSocketReady", () => {
	it("fires after connect with restored keys", () => {
		const transport = new MockTransport();
		const manager = new WebSocketManager<TClientMsg, TServerMsg>({
			url: "ws://test",
			transport,
			serialize: (msg) => JSON.stringify(msg),
			deserialize: (raw) => JSON.parse(raw) as TServerMsg,
			getSubscriptionResolvedKey: (m) =>
				m.type === "subscribe-ack" ? m.key : undefined,
		});
		const keysSeen: string[][] = [];
		renderHook(() =>
			useSocketReady(manager, (keys) => {
				keysSeen.push([...keys]);
			}),
		);

		act(() => {
			manager.connect();
			transport.simulateOpen();
		});
		expect(keysSeen).toEqual([[]]);

		act(() => {
			manager.subscribe("room:1", { type: "sub", key: "room:1" });
			transport.simulateClose(1006);
		});
		// 2001ms covers base 1000ms + max 1000ms jitter so the reconnect
		// timer has fired before simulateOpen.
		act(() => {
			vi.advanceTimersByTime(2001);
			transport.simulateOpen();
		});
		expect(keysSeen[keysSeen.length - 1]).toEqual(["room:1"]);
	});
});

describe("useSocketLastUnsubscribe", () => {
	it("fires when the last subscriber for a key leaves", () => {
		const { manager } = createManager();
		const seen: { key: string; data: TClientMsg | undefined }[] = [];

		renderHook(() =>
			useSocketLastUnsubscribe(manager, (key, data) => {
				seen.push({ key, data });
			}),
		);

		const sub: TClientMsg = { type: "sub", key: "room:1" };
		act(() => {
			manager.subscribe("room:1", sub);
			manager.subscribe("room:1", sub);
			manager.unsubscribe("room:1");
			expect(seen).toHaveLength(0);
			manager.unsubscribe("room:1");
		});

		expect(seen).toEqual([{ key: "room:1", data: sub }]);
	});
});
