import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUEUE_STORAGE_KEY } from "../../socket/constants";
import {
	dequeue,
	drainQueue,
	enqueue,
	loadQueue,
	pruneStaleMessages,
	removeByChannelAndType,
	saveQueue,
} from "../../socket/queue";
import type { TQueuedMessage } from "../../socket/types";

beforeEach(() => {
	localStorage.clear();
	vi.stubGlobal("crypto", { randomUUID: () => "test-uuid-1" });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("loadQueue", () => {
	it("returns empty array when no data", () => {
		expect(loadQueue()).toEqual([]);
	});

	it("returns empty array on corrupt data", () => {
		localStorage.setItem(QUEUE_STORAGE_KEY, "not-json");
		expect(loadQueue()).toEqual([]);
	});

	it("returns empty array on non-array data", () => {
		localStorage.setItem(QUEUE_STORAGE_KEY, '{"foo":"bar"}');
		expect(loadQueue()).toEqual([]);
	});

	it("returns stored queue", () => {
		const queue: TQueuedMessage[] = [
			{
				id: "1",
				payload: { action: "ping", timestamp: "t" },
				timestamp: Date.now(),
			},
		];
		localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
		expect(loadQueue()).toEqual(queue);
	});
});

describe("saveQueue", () => {
	it("persists queue to localStorage", () => {
		const queue: TQueuedMessage[] = [
			{
				id: "1",
				payload: { action: "ping", timestamp: "t" },
				timestamp: Date.now(),
			},
		];
		saveQueue(queue);
		expect(JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY)!)).toEqual(queue);
	});
});

describe("enqueue", () => {
	it("appends a message and persists", () => {
		const result = enqueue([], { action: "ping", timestamp: "t" });
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe("test-uuid-1");
		expect(result[0].payload).toEqual({ action: "ping", timestamp: "t" });
		expect(loadQueue()).toHaveLength(1);
	});
});

describe("dequeue", () => {
	it("removes message by id", () => {
		const queue: TQueuedMessage[] = [
			{
				id: "a",
				payload: { action: "ping", timestamp: "t" },
				timestamp: Date.now(),
			},
			{
				id: "b",
				payload: { action: "ping", timestamp: "t2" },
				timestamp: Date.now(),
			},
		];
		const result = dequeue(queue, "a");
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe("b");
	});
});

describe("pruneStaleMessages", () => {
	it("removes messages older than maxAge", () => {
		const old: TQueuedMessage = {
			id: "old",
			payload: { action: "ping", timestamp: "t" },
			timestamp: Date.now() - 100_000,
		};
		const fresh: TQueuedMessage = {
			id: "fresh",
			payload: { action: "ping", timestamp: "t" },
			timestamp: Date.now(),
		};
		const result = pruneStaleMessages([old, fresh], 50_000);
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe("fresh");
	});
});

describe("removeByChannelAndType", () => {
	it("removes matching message entries", () => {
		const queue: TQueuedMessage[] = [
			{
				id: "a",
				payload: {
					action: "message",
					type: "conversation",
					id: "m1",
					channel: "ch1",
					message: "hello",
				},
				timestamp: Date.now(),
			},
			{
				id: "b",
				payload: {
					action: "message",
					type: "conversation",
					id: "m2",
					channel: "ch1",
					message: "world",
				},
				timestamp: Date.now(),
			},
		];
		const result = removeByChannelAndType(queue, "ch1", "conversation");
		expect(result).toHaveLength(0);
	});

	it("preserves non-matching entries", () => {
		const queue: TQueuedMessage[] = [
			{
				id: "a",
				payload: {
					action: "message",
					type: "conversation",
					id: "m1",
					channel: "ch1",
					message: "hello",
				},
				timestamp: Date.now(),
			},
			{
				id: "b",
				payload: { action: "ping", timestamp: "t" },
				timestamp: Date.now(),
			},
			{
				id: "c",
				payload: {
					action: "message",
					type: "conversation",
					id: "m2",
					channel: "ch2",
					message: "other",
				},
				timestamp: Date.now(),
			},
		];
		const result = removeByChannelAndType(queue, "ch1", "conversation");
		expect(result).toHaveLength(2);
		expect(result[0].id).toBe("b");
		expect(result[1].id).toBe("c");
	});
});

describe("drainQueue", () => {
	it("sends all messages when sendFn succeeds", () => {
		const queue: TQueuedMessage[] = [
			{
				id: "a",
				payload: { action: "ping", timestamp: "t" },
				timestamp: Date.now(),
			},
			{
				id: "b",
				payload: { action: "ping", timestamp: "t2" },
				timestamp: Date.now(),
			},
		];
		const sent: string[] = [];
		const result = drainQueue(queue, (data) => {
			sent.push(data);
			return true;
		});
		expect(result).toHaveLength(0);
		expect(sent).toHaveLength(2);
	});

	it("stops on first failure", () => {
		const queue: TQueuedMessage[] = [
			{
				id: "a",
				payload: { action: "ping", timestamp: "t" },
				timestamp: Date.now(),
			},
			{
				id: "b",
				payload: { action: "ping", timestamp: "t2" },
				timestamp: Date.now(),
			},
		];
		const result = drainQueue(queue, () => false);
		expect(result).toHaveLength(2);
	});
});
