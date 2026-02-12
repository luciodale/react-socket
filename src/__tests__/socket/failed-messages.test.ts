import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FAILED_MESSAGES_STORAGE_KEY } from "../../socket/constants";
import {
	clearAllFailedMessages,
	clearChannelFailedMessages,
	getChannelFailedMessages,
	loadAllFailedMessages,
	setChannelFailedMessages,
} from "../../socket/failed-messages";
import type { TClientConversationMessage } from "../../socket/types";

function makeMsg(id: string): TClientConversationMessage {
	return {
		id,
		sender: "user",
		content: [{ type: "text", text: `msg-${id}` }],
		status: "failed",
	};
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("failed-messages localStorage API", () => {
	it("loadAllFailedMessages returns empty record when nothing stored", () => {
		expect(loadAllFailedMessages()).toEqual({});
	});

	it("loadAllFailedMessages handles corrupt JSON gracefully", () => {
		localStorage.setItem(FAILED_MESSAGES_STORAGE_KEY, "not-json{{{");
		expect(loadAllFailedMessages()).toEqual({});
	});

	it("loadAllFailedMessages handles non-object JSON gracefully", () => {
		localStorage.setItem(FAILED_MESSAGES_STORAGE_KEY, "[1,2,3]");
		expect(loadAllFailedMessages()).toEqual({});
	});

	it("set/get channel roundtrip", () => {
		const msgs = [makeMsg("a"), makeMsg("b")];
		setChannelFailedMessages("ch1", msgs);

		const result = getChannelFailedMessages("ch1");
		expect(result).toEqual(msgs);
	});

	it("clearChannelFailedMessages removes only target channel", () => {
		setChannelFailedMessages("ch1", [makeMsg("a")]);
		setChannelFailedMessages("ch2", [makeMsg("b")]);

		clearChannelFailedMessages("ch1");

		expect(getChannelFailedMessages("ch1")).toEqual([]);
		expect(getChannelFailedMessages("ch2")).toEqual([makeMsg("b")]);
	});

	it("clearAllFailedMessages nukes everything", () => {
		setChannelFailedMessages("ch1", [makeMsg("a")]);
		setChannelFailedMessages("ch2", [makeMsg("b")]);

		clearAllFailedMessages();

		expect(loadAllFailedMessages()).toEqual({});
	});

	it("channel isolation — channels don't interfere", () => {
		setChannelFailedMessages("ch1", [makeMsg("x")]);
		setChannelFailedMessages("ch2", [makeMsg("y")]);

		expect(getChannelFailedMessages("ch1")).toEqual([makeMsg("x")]);
		expect(getChannelFailedMessages("ch2")).toEqual([makeMsg("y")]);
	});

	it("setChannelFailedMessages with empty array removes channel", () => {
		setChannelFailedMessages("ch1", [makeMsg("a")]);
		setChannelFailedMessages("ch1", []);

		const all = loadAllFailedMessages();
		expect(all.ch1).toBeUndefined();
	});
});
