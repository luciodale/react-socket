import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUndeliveredSync } from "../../socket/undelivered-sync";
import type { TUndeliveredSync } from "../../socket/undelivered-sync";
import { createLocalStorage } from "../../socket/storage";

const STORAGE_KEY = "ws_undelivered_messages";

type TTestMessage = { id: string; text: string };

function makeMsg(id: string): TTestMessage {
	return { id, text: `msg-${id}` };
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

	it("addMessage/getChannelMessages roundtrip", () => {
		sync.addMessage("ch1", makeMsg("a"));
		sync.addMessage("ch1", makeMsg("b"));
		expect(sync.getChannelMessages("ch1")).toEqual([
			makeMsg("a"),
			makeMsg("b"),
		]);
	});

	it("addMessage deduplicates by id", () => {
		sync.addMessage("ch1", makeMsg("a"));
		sync.addMessage("ch1", makeMsg("a"));
		expect(sync.getChannelMessages("ch1")).toHaveLength(1);
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

	it("clearAll removes everything", () => {
		sync.addMessage("ch1", makeMsg("a"));
		sync.addMessage("ch2", makeMsg("b"));
		sync.clearAll();
		expect(sync.getChannelMessages("ch1")).toEqual([]);
		expect(sync.getChannelMessages("ch2")).toEqual([]);
	});

	it("channel isolation", () => {
		sync.addMessage("ch1", makeMsg("x"));
		sync.addMessage("ch2", makeMsg("y"));
		expect(sync.getChannelMessages("ch1")).toEqual([makeMsg("x")]);
		expect(sync.getChannelMessages("ch2")).toEqual([makeMsg("y")]);
	});

	it("setChannelMessages with empty array removes channel", () => {
		sync.addMessage("ch1", makeMsg("a"));
		sync.setChannelMessages("ch1", []);
		expect(sync.getChannelMessages("ch1")).toEqual([]);
	});

	it("init loads persisted data", async () => {
		sync.addMessage("ch1", makeMsg("a"));
		const sync2 = createUndeliveredSync({
			storage: createLocalStorage(),
		});
		await sync2.init();
		expect(sync2.getChannelMessages("ch1")).toEqual([makeMsg("a")]);
	});
});
