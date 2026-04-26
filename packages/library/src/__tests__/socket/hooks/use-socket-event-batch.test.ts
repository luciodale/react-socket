import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSocketEventBatch } from "../../../hooks";
import { WebSocketManager } from "../../../manager";
import { MockTransport } from "../../helpers/mock-transport";

type TClientMsg = { type: "noop" };

type TServerMsg = { type: "tick"; n: number } | { type: "other"; text: string };

function createManager() {
	const transport = new MockTransport();
	const manager = new WebSocketManager<TClientMsg, TServerMsg>({
		url: "ws://test",
		transport,
		serialize: (msg) => JSON.stringify(msg),
		deserialize: (raw) => JSON.parse(raw) as TServerMsg,
	});
	manager.connect();
	transport.simulateOpen();
	return { manager, transport };
}

function pushTick(transport: MockTransport, n: number) {
	transport.simulateMessage(JSON.stringify({ type: "tick", n }));
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("useSocketEventBatch", () => {
	it("flushes buffered events to handler on the interval", () => {
		const { manager, transport } = createManager();
		const batches: Array<Array<{ type: "tick"; n: number }>> = [];

		renderHook(() =>
			useSocketEventBatch(manager, "tick", (msgs) => batches.push(msgs), {
				flushMs: 50,
			}),
		);

		pushTick(transport, 1);
		pushTick(transport, 2);
		pushTick(transport, 3);

		// Before the interval fires, no flush yet.
		expect(batches).toEqual([]);

		vi.advanceTimersByTime(50);

		expect(batches).toEqual([
			[
				{ type: "tick", n: 1 },
				{ type: "tick", n: 2 },
				{ type: "tick", n: 3 },
			],
		]);
	});

	it("does not invoke handler when the buffer is empty", () => {
		const { manager } = createManager();
		const handler = vi.fn();

		renderHook(() =>
			useSocketEventBatch(manager, "tick", handler, { flushMs: 30 }),
		);

		vi.advanceTimersByTime(120);
		expect(handler).not.toHaveBeenCalled();
	});

	it("emits multiple batches as events keep arriving", () => {
		const { manager, transport } = createManager();
		const batches: number[][] = [];

		renderHook(() =>
			useSocketEventBatch(
				manager,
				"tick",
				(msgs) => batches.push(msgs.map((m) => m.n)),
				{ flushMs: 20 },
			),
		);

		pushTick(transport, 1);
		pushTick(transport, 2);
		vi.advanceTimersByTime(20);

		pushTick(transport, 3);
		vi.advanceTimersByTime(20);

		pushTick(transport, 4);
		pushTick(transport, 5);
		vi.advanceTimersByTime(20);

		expect(batches).toEqual([[1, 2], [3], [4, 5]]);
	});

	it("preserves event order within a batch", () => {
		const { manager, transport } = createManager();
		const seen: number[] = [];

		renderHook(() =>
			useSocketEventBatch(
				manager,
				"tick",
				(msgs) => {
					for (const m of msgs) seen.push(m.n);
				},
				{ flushMs: 30 },
			),
		);

		for (let i = 0; i < 10; i += 1) pushTick(transport, i);
		vi.advanceTimersByTime(30);

		expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});

	it("ignores events with a different discriminator value", () => {
		const { manager, transport } = createManager();
		const batches: Array<Array<{ type: "tick"; n: number }>> = [];

		renderHook(() =>
			useSocketEventBatch(manager, "tick", (msgs) => batches.push(msgs), {
				flushMs: 25,
			}),
		);

		pushTick(transport, 1);
		transport.simulateMessage(JSON.stringify({ type: "other", text: "x" }));
		pushTick(transport, 2);

		vi.advanceTimersByTime(25);

		expect(batches).toEqual([
			[
				{ type: "tick", n: 1 },
				{ type: "tick", n: 2 },
			],
		]);
	});

	it("stops flushing after unmount and discards pending events", () => {
		const { manager, transport } = createManager();
		const handler = vi.fn();

		const { unmount } = renderHook(() =>
			useSocketEventBatch(manager, "tick", handler, { flushMs: 40 }),
		);

		pushTick(transport, 1);
		unmount();

		vi.advanceTimersByTime(200);
		expect(handler).not.toHaveBeenCalled();

		// New events after unmount should also be ignored.
		pushTick(transport, 2);
		vi.advanceTimersByTime(200);
		expect(handler).not.toHaveBeenCalled();
	});

	it("uses the latest handler closure without re-binding", () => {
		const { manager, transport } = createManager();
		let captured = "first";

		const { rerender } = renderHook(
			({ tag }: { tag: string }) =>
				useSocketEventBatch(
					manager,
					"tick",
					() => {
						captured = tag;
					},
					{ flushMs: 20 },
				),
			{ initialProps: { tag: "first" } },
		);

		rerender({ tag: "second" });

		pushTick(transport, 1);
		vi.advanceTimersByTime(20);

		expect(captured).toBe("second");
	});

	describe("idleMs", () => {
		it("flushes after idle silence shorter than flushMs", () => {
			const { manager, transport } = createManager();
			const batches: number[][] = [];

			renderHook(() =>
				useSocketEventBatch(
					manager,
					"tick",
					(msgs) => batches.push(msgs.map((m) => m.n)),
					{ flushMs: 100, idleMs: 10 },
				),
			);

			pushTick(transport, 1);
			pushTick(transport, 2);

			// Idle window elapses well before the interval would have fired.
			vi.advanceTimersByTime(10);
			expect(batches).toEqual([[1, 2]]);
		});

		it("resets the idle timer on each new event so bursts coalesce", () => {
			const { manager, transport } = createManager();
			const batches: number[][] = [];

			renderHook(() =>
				useSocketEventBatch(
					manager,
					"tick",
					(msgs) => batches.push(msgs.map((m) => m.n)),
					{ flushMs: 200, idleMs: 20 },
				),
			);

			pushTick(transport, 1);
			vi.advanceTimersByTime(15);
			pushTick(transport, 2);
			vi.advanceTimersByTime(15);
			pushTick(transport, 3);

			// No flush yet — each event reset the idle timer.
			expect(batches).toEqual([]);

			vi.advanceTimersByTime(20);
			expect(batches).toEqual([[1, 2, 3]]);
		});

		it("interval flush still fires when stream stays busy under idleMs", () => {
			const { manager, transport } = createManager();
			const batches: number[][] = [];

			renderHook(() =>
				useSocketEventBatch(
					manager,
					"tick",
					(msgs) => batches.push(msgs.map((m) => m.n)),
					{ flushMs: 30, idleMs: 50 },
				),
			);

			// Push events faster than idleMs so the idle timer never fires.
			for (let i = 0; i < 6; i += 1) {
				pushTick(transport, i);
				vi.advanceTimersByTime(10);
			}

			// Interval (30ms) flushed at least once during that 60ms window.
			expect(batches.length).toBeGreaterThanOrEqual(1);
		});
	});
});
