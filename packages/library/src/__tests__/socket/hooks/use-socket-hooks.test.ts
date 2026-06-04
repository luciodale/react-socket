import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	useSocketConnectionChange,
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

	it("swaps listeners when value changes — old value stops firing, new value starts", () => {
		const { manager, transport } = createManager();
		const received: string[] = [];

		const { rerender } = renderHook(
			({ value }: { value: "chat" | "subscribe-ack" }) =>
				useSocketEvent(manager, value, (m) => {
					// Tag by the discriminator so we can prove which listener fired.
					received.push(m.type);
				}),
			{ initialProps: { value: "chat" as "chat" | "subscribe-ack" } },
		);

		// Subscribed to "chat": a chat msg fires, an ack does not.
		act(() => {
			transport.simulateMessage(JSON.stringify({ type: "chat", text: "hi" }));
		});
		expect(received).toEqual(["chat"]);

		// Swap the discriminator value mid-flight.
		rerender({ value: "subscribe-ack" });

		// The old "chat" listener must be gone — a second chat msg is ignored
		// (no double-fire from a leaked listener).
		act(() => {
			transport.simulateMessage(JSON.stringify({ type: "chat", text: "bye" }));
		});
		expect(received).toEqual(["chat"]);

		// The new "subscribe-ack" listener is live.
		act(() => {
			transport.simulateMessage(
				JSON.stringify({ type: "subscribe-ack", key: "a" }),
			);
		});
		expect(received).toEqual(["chat", "subscribe-ack"]);
	});

	it("fires exactly once per message under StrictMode double-mount", () => {
		const { manager, transport } = createManager();
		const received: string[] = [];

		renderHook(
			() =>
				useSocketEvent(manager, "chat", (m) => {
					received.push(m.text);
				}),
			{ wrapper: StrictMode },
		);

		act(() => {
			transport.simulateMessage(JSON.stringify({ type: "chat", text: "hi" }));
		});

		// Double-mount must not leak a second listener — one msg, one fire.
		expect(received).toEqual(["hi"]);
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

	it("moves the subscription when key changes — old key drops, new key subscribes", () => {
		const { manager } = createManager();

		const { rerender } = renderHook(
			({ key }: { key: string }) =>
				useSocketSubscription(manager, {
					key,
					subscribe: { type: "sub", key },
				}),
			{ initialProps: { key: "room:1" } },
		);

		expect(manager.getRefCount("room:1")).toBe(1);
		expect(manager.getRefCount("room:2")).toBe(0);

		rerender({ key: "room:2" });

		expect(manager.getRefCount("room:1")).toBe(0);
		expect(manager.getRefCount("room:2")).toBe(1);
	});

	it("holds refCount at exactly 1 under StrictMode double-mount", () => {
		const { manager } = createManager();

		renderHook(
			() =>
				useSocketSubscription(manager, {
					key: "room:1",
					subscribe: { type: "sub", key: "room:1" },
				}),
			{ wrapper: StrictMode },
		);

		// mount → unmount → remount must net to a single ref, not two.
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

	it("re-reads pending state for the new key when the key prop changes", () => {
		const { manager, transport } = createManager();

		// Both keys subscribed while connected — both go pending awaiting ack.
		act(() => {
			manager.subscribe("room:1", { type: "sub", key: "room:1" });
			manager.subscribe("room:2", { type: "sub", key: "room:2" });
		});

		const { result, rerender } = renderHook(
			({ key }: { key: string }) => useSocketPendingSubscription(manager, key),
			{ initialProps: { key: "room:1" } },
		);
		expect(result.current).toBe(true);

		// Resolve only room:1.
		act(() => {
			transport.simulateMessage(
				JSON.stringify({ type: "subscribe-ack", key: "room:1" }),
			);
		});
		expect(result.current).toBe(false);

		// Switching the watched key must re-read the snapshot for room:2,
		// which is still pending.
		rerender({ key: "room:2" });
		expect(result.current).toBe(true);
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

describe("useSocketConnectionChange", () => {
	it("fires on each transition with the new and previous state", () => {
		const transport = new MockTransport();
		const manager = new WebSocketManager<TClientMsg, TServerMsg>({
			url: "ws://test",
			transport,
			serialize: (msg) => JSON.stringify(msg),
			deserialize: (raw) => JSON.parse(raw) as TServerMsg,
			reconnectBaseDelayMs: 10,
			reconnectMaxAttempts: 3,
			reconnectMaxDelayMs: 100,
		});
		const transitions: { state: string; prev: string }[] = [];
		renderHook(() =>
			useSocketConnectionChange(manager, (state, prev) => {
				transitions.push({ state, prev });
			}),
		);

		// no fire on mount — only on transitions
		expect(transitions).toHaveLength(0);

		act(() => {
			manager.connect();
			transport.simulateOpen();
		});
		// dirty close: connected → reconnecting (1006 schedules a reconnect)
		act(() => {
			transport.simulateClose(1006);
		});

		expect(transitions).toEqual([
			{ state: "connecting", prev: "idle" },
			{ state: "connected", prev: "connecting" },
			{ state: "reconnecting", prev: "connected" },
		]);
	});

	it("clears ephemeral UI on drop and leaves it alone across a reconnect cycle", () => {
		const { manager, transport } = createManager();
		let typing: string | null = "BOB";
		const transitions: string[] = [];
		renderHook(() =>
			useSocketConnectionChange(manager, (state, prev) => {
				transitions.push(`${prev} → ${state}`);
				// Clear ephemeral UI on every non-connected transition.
				if (state !== "connected") typing = null;
			}),
		);

		// A handler that fired on mount would have already nulled typing — prove
		// it is still set before the first real transition.
		expect(typing).toBe("BOB");
		expect(transitions).toEqual([]);

		// Drop: connected → reconnecting clears the indicator.
		act(() => {
			transport.simulateClose(1006);
		});
		expect(typing).toBeNull();

		// Someone starts typing again while we are down.
		typing = "ALICE";

		// Reconnect: reconnecting → connected. The connected branch must NOT
		// touch typing — a spurious clear here would null "ALICE".
		act(() => {
			vi.advanceTimersByTime(100);
			transport.simulateOpen();
		});
		expect(typing).toBe("ALICE");

		// Exactly one clear-triggering transition and one connected transition,
		// in order — no mount fire, no duplicate emissions.
		expect(transitions).toEqual([
			"connected → reconnecting",
			"reconnecting → connected",
		]);
	});

	it("uses the latest handler without resubscribing", () => {
		const { manager, transport } = createManager();
		const seenBy: string[] = [];
		const { rerender } = renderHook(
			({ label }: { label: string }) =>
				useSocketConnectionChange(manager, () => {
					seenBy.push(label);
				}),
			{ initialProps: { label: "first" } },
		);

		act(() => {
			transport.simulateClose(1006); // connected → reconnecting
		});
		rerender({ label: "second" });
		act(() => {
			manager.disconnect(); // reconnecting → disconnected
		});

		expect(seenBy).toEqual(["first", "second"]);
	});

	it("stops firing after unmount", () => {
		const { manager, transport } = createManager();
		const transitions: string[] = [];
		const { unmount } = renderHook(() =>
			useSocketConnectionChange(manager, (state) => {
				transitions.push(state);
			}),
		);

		unmount();
		act(() => {
			transport.simulateClose(1006);
		});

		expect(transitions).toHaveLength(0);
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

	it("forwards reason transport-error when the wire write throws", () => {
		class ThrowingTransport extends MockTransport {
			send(): void {
				throw new Error("wire write failed");
			}
		}
		const transport = new ThrowingTransport();
		const manager = new WebSocketManager<TClientMsg, TServerMsg>({
			url: "ws://test",
			transport,
			serialize: (msg) => JSON.stringify(msg),
			deserialize: (raw) => JSON.parse(raw) as TServerMsg,
		});
		const reasons: string[] = [];
		renderHook(() =>
			useSocketSendFailed(manager, ({ reason }) => {
				reasons.push(reason);
			}),
		);

		act(() => {
			manager.connect();
			transport.simulateOpen();
			manager.send({ data: { type: "chat", text: "boom" } });
		});

		expect(reasons).toEqual(["transport-error"]);
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
