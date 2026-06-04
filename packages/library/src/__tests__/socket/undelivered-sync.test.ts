import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IStorage } from "../../storage";
import { createLocalStorage } from "../../storage";
import type { TUndeliveredSync } from "../../undelivered-sync";
import { createUndeliveredSync } from "../../undelivered-sync";

const STORAGE_KEY = "ws_undelivered_messages";

type TTestMessage = { id: string; text: string };

function makeMsg(id: string): TTestMessage {
	return { id, text: `msg-${id}` };
}

function readPersisted(): Record<string, TTestMessage[]> | null {
	const raw = localStorage.getItem(STORAGE_KEY);
	return raw === null
		? null
		: (JSON.parse(raw) as Record<string, TTestMessage[]>);
}

// persist() writes through an async storage adapter; let the resulting
// promise (and its .catch) settle before reading the raw storage value.
async function flushPersist(): Promise<void> {
	await Promise.resolve();
}

let sync: TUndeliveredSync<TTestMessage>;

beforeEach(async () => {
	localStorage.clear();
	sync = createUndeliveredSync<TTestMessage>({ storage: createLocalStorage() });
	await sync.init();
});

afterEach(() => localStorage.clear());

describe("undelivered-sync", () => {
	it("returns empty array for unknown channel", () => {
		expect(sync.getChannelMessages("ch1")).toEqual([]);
	});

	it("init handles corrupt JSON gracefully", async () => {
		localStorage.setItem(STORAGE_KEY, "not-json{{{");
		const s = createUndeliveredSync({ storage: createLocalStorage() });
		await s.init();
		expect(s.getChannelMessages("ch1")).toEqual([]);
	});

	it("init handles non-object JSON gracefully", async () => {
		localStorage.setItem(STORAGE_KEY, "[1,2,3]");
		const s = createUndeliveredSync({ storage: createLocalStorage() });
		await s.init();
		expect(s.getChannelMessages("ch1")).toEqual([]);
	});

	it("init drops non-array channel values, keeps valid channels, reports the drop", async () => {
		// Well-formed JSON, corrupt channel value (schema drift / key collision).
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ ch1: 42, ch2: [makeMsg("b")] }),
		);
		const errors: unknown[] = [];
		const s = createUndeliveredSync<TTestMessage>({
			storage: createLocalStorage(),
			onPersistError: (e) => errors.push(e),
		});
		await s.init();

		// Corrupt channel hydrates as empty — never returned as-is.
		expect(s.getChannelMessages("ch1")).toEqual([]);
		// Healthy channel survives.
		expect(s.getChannelMessages("ch2")).toEqual([makeMsg("b")]);
		// The drop is surfaced, not silent.
		expect(errors).toHaveLength(1);
	});

	it("addMessage works on a channel that hydrated corrupt", async () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ ch1: 42 }));
		const s = createUndeliveredSync<TTestMessage>({
			storage: createLocalStorage(),
		});
		await s.init();

		// Pre-fix this threw: `existing.some is not a function`.
		expect(() => s.addMessage("ch1", makeMsg("a"))).not.toThrow();
		expect(s.getChannelMessages("ch1")).toEqual([makeMsg("a")]);

		// The repaired channel persists cleanly over the corrupt value.
		await flushPersist();
		expect(readPersisted()).toEqual({ ch1: [makeMsg("a")] });
	});

	it("addMessage/getChannelMessages roundtrip", () => {
		sync.addMessage("ch1", makeMsg("a"));
		sync.addMessage("ch1", makeMsg("b"));
		expect(sync.getChannelMessages("ch1")).toEqual([
			makeMsg("a"),
			makeMsg("b"),
		]);
	});

	it("addMessage persists the channel map to storage", async () => {
		sync.addMessage("ch1", makeMsg("a"));
		sync.addMessage("ch1", makeMsg("b"));
		sync.addMessage("ch2", makeMsg("c"));
		await flushPersist();

		expect(readPersisted()).toEqual({
			ch1: [makeMsg("a"), makeMsg("b")],
			ch2: [makeMsg("c")],
		});
	});

	it("removeMessage drops the message from persisted storage", async () => {
		sync.addMessage("ch1", makeMsg("a"));
		sync.addMessage("ch1", makeMsg("b"));
		await flushPersist();

		sync.removeMessage("ch1", "a");
		await flushPersist();

		const persisted = readPersisted();
		expect(persisted).toEqual({ ch1: [makeMsg("b")] });
		// The removed id is gone from the durable copy, not just the cache.
		expect(persisted?.ch1.some((m) => m.id === "a")).toBe(false);
	});

	it("addMessage deduplicates by id (first write wins)", () => {
		const first = { id: "a", text: "original" };
		const second = { id: "a", text: "replacement" };
		sync.addMessage("ch1", first);
		sync.addMessage("ch1", second);

		const stored = sync.getChannelMessages("ch1");
		expect(stored).toHaveLength(1);
		// The earlier object is kept; the colliding write is dropped.
		expect(stored[0]).toEqual(first);
		expect(stored[0].text).toBe("original");
	});

	it("addMessage keeps messages with distinct ids", () => {
		sync.addMessage("ch1", makeMsg("a"));
		sync.addMessage("ch1", { id: "a", text: "dupe" });
		sync.addMessage("ch1", makeMsg("b"));

		// Only the id collision is deduped; the distinct id survives.
		expect(sync.getChannelMessages("ch1")).toEqual([
			makeMsg("a"),
			makeMsg("b"),
		]);
	});

	it("removeMessage removes by id", () => {
		sync.addMessage("ch1", makeMsg("a"));
		sync.addMessage("ch1", makeMsg("b"));
		sync.removeMessage("ch1", "a");
		expect(sync.getChannelMessages("ch1")).toEqual([makeMsg("b")]);
	});

	it("removeMessage cleans up empty channel", () => {
		sync.addMessage("ch1", makeMsg("a"));
		sync.removeMessage("ch1", "a");
		expect(sync.getChannelMessages("ch1")).toEqual([]);
	});

	it("clearChannel removes only target channel", () => {
		sync.addMessage("ch1", makeMsg("a"));
		sync.addMessage("ch2", makeMsg("b"));
		sync.clearChannel("ch1");
		expect(sync.getChannelMessages("ch1")).toEqual([]);
		expect(sync.getChannelMessages("ch2")).toEqual([makeMsg("b")]);
	});

	it("clearAll removes everything", async () => {
		sync.addMessage("ch1", makeMsg("a"));
		sync.addMessage("ch2", makeMsg("b"));
		await flushPersist();
		expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

		sync.clearAll();
		await flushPersist();

		expect(sync.getChannelMessages("ch1")).toEqual([]);
		expect(sync.getChannelMessages("ch2")).toEqual([]);
		// clearAll must removeItem, not just blank the in-memory cache.
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it("setChannelMessages with empty array removes channel", () => {
		sync.addMessage("ch1", makeMsg("a"));
		sync.setChannelMessages("ch1", []);
		expect(sync.getChannelMessages("ch1")).toEqual([]);
	});

	it("setChannelMessages with a non-empty array replaces and persists content", async () => {
		sync.addMessage("ch1", makeMsg("a"));
		await flushPersist();

		sync.setChannelMessages("ch1", [makeMsg("b"), makeMsg("c")]);
		await flushPersist();

		expect(sync.getChannelMessages("ch1")).toEqual([
			makeMsg("b"),
			makeMsg("c"),
		]);
		expect(readPersisted()).toEqual({ ch1: [makeMsg("b"), makeMsg("c")] });
	});

	it("init loads persisted data", async () => {
		sync.addMessage("ch1", makeMsg("a"));
		const sync2 = createUndeliveredSync({
			storage: createLocalStorage(),
		});
		await sync2.init();
		expect(sync2.getChannelMessages("ch1")).toEqual([makeMsg("a")]);
	});

	describe("onPersistError surfaces write failures", () => {
		function failingSetStorage(): IStorage {
			return {
				async getItem() {
					return null;
				},
				async setItem() {
					throw new Error("quota exceeded");
				},
				async removeItem() {},
			};
		}

		it("reports setItem failures from removeMessage", async () => {
			const errors: unknown[] = [];
			const s = createUndeliveredSync<TTestMessage>({
				storage: failingSetStorage(),
				onPersistError: (error) => errors.push(error),
			});
			await s.init();

			// addMessage's persist also fails — clear that first error out.
			s.addMessage("ch1", makeMsg("a"));
			await Promise.resolve();
			errors.length = 0;

			s.removeMessage("ch1", "a");
			await Promise.resolve();

			expect(errors).toHaveLength(1);
			expect((errors[0] as Error).message).toBe("quota exceeded");
		});

		it("reports setItem failures from setChannelMessages", async () => {
			const errors: unknown[] = [];
			const s = createUndeliveredSync<TTestMessage>({
				storage: failingSetStorage(),
				onPersistError: (error) => errors.push(error),
			});
			await s.init();

			s.setChannelMessages("ch1", [makeMsg("a")]);
			await Promise.resolve();

			expect(errors).toHaveLength(1);
			expect((errors[0] as Error).message).toBe("quota exceeded");
			// In-memory queue still reflects the write despite the failure.
			expect(s.getChannelMessages("ch1")).toEqual([makeMsg("a")]);
		});
	});
});
