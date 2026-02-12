import { FAILED_MESSAGES_STORAGE_KEY } from "./constants";
import type { TClientConversationMessage } from "./types";

type TFailedMessagesRecord = Record<string, TClientConversationMessage[]>;

export function loadAllFailedMessages(): TFailedMessagesRecord {
	try {
		const raw = localStorage.getItem(FAILED_MESSAGES_STORAGE_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
			return {};
		return parsed as TFailedMessagesRecord;
	} catch {
		return {};
	}
}

export function getChannelFailedMessages(
	channel: string,
): TClientConversationMessage[] {
	const all = loadAllFailedMessages();
	return all[channel] ?? [];
}

export function setChannelFailedMessages(
	channel: string,
	messages: TClientConversationMessage[],
): void {
	try {
		const all = loadAllFailedMessages();
		if (messages.length === 0) {
			delete all[channel];
		} else {
			all[channel] = messages;
		}
		localStorage.setItem(
			FAILED_MESSAGES_STORAGE_KEY,
			JSON.stringify(all),
		);
	} catch {
		// Storage full or unavailable — silently drop
	}
}

export function clearChannelFailedMessages(channel: string): void {
	try {
		const all = loadAllFailedMessages();
		delete all[channel];
		localStorage.setItem(
			FAILED_MESSAGES_STORAGE_KEY,
			JSON.stringify(all),
		);
	} catch {
		// silently drop
	}
}

export function clearAllFailedMessages(): void {
	try {
		localStorage.removeItem(FAILED_MESSAGES_STORAGE_KEY);
	} catch {
		// silently drop
	}
}
