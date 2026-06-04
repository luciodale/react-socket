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

	it("discards a buffered event when the value changes and binds the new listener", () => {
		const { manager, transport } = createManager();
		const ticks: number[] = [];
		const others: string[] = [];

		const { rerender } = renderHook(
			({ value }: { value: "tick" | "other" }) =>
				useSocketEventBatch(
					manager,
					value,
					(msgs) => {
						for (const m of msgs) {
							if (m.type === "tick") ticks.push(m.n);
							else others.push(m.text);
						}
					},
					{ flushMs: 50 },
				),
			{ initialProps: { value: "tick" } },
		);

		// Buffer a tick event but do NOT advance — it stays unflushed.
		pushTick(transport, 7);

		// Switch the value before the interval fires. The effect re-runs:
		// old listener + its buffer are torn down, a fresh listener for the
		// new value is bound.
		rerender({ value: "other" });

		// Advancing past flushMs must NOT surface the orphaned tick event.
		vi.advanceTimersByTime(50);
		expect(ticks).toEqual([]);
		expect(others).toEqual([]);

		// The new listener is live: an event for the new value is delivered.
		transport.simulateMessage(JSON.stringify({ type: "other", text: "z" }));
		vi.advanceTimersByTime(50);
		expect(others).toEqual(["z"]);
		// The dead tick listener never fires again.
		expect(ticks).toEqual([]);
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
			// Each push lands 10ms apart, so over 60ms the 30ms interval fires
			// exactly twice (t=30 and t=60), partitioning the stream cleanly.
			for (let i = 0; i < 6; i += 1) {
				pushTick(transport, i);
				vi.advanceTimersByTime(10);
			}

			// Interval owns the cadence: two flushes, the first three then the
			// last three. The idle timer never gets a 50ms gap to fire.
			expect(batches).toEqual([
				[0, 1, 2],
				[3, 4, 5],
			]);
		});
	});
});
