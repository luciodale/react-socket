import { QUEUE_STORAGE_KEY } from "./constants";
import type { TQueuedMessage, TSocketMessageFromClientToServer } from "./types";

export function loadQueue(): TQueuedMessage[] {
	try {
		const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed as TQueuedMessage[];
	} catch {
		return [];
	}
}

export function saveQueue(queue: TQueuedMessage[]): void {
	try {
		localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
	} catch {
		// Storage full or unavailable — silently drop
	}
}

export function enqueue(
	queue: TQueuedMessage[],
	payload: TSocketMessageFromClientToServer,
): TQueuedMessage[] {
	const entry: TQueuedMessage = {
		id: crypto.randomUUID(),
		payload,
		timestamp: Date.now(),
	};
	const next = [...queue, entry];
	saveQueue(next);
	return next;
}

export function dequeue(queue: TQueuedMessage[], id: string): TQueuedMessage[] {
	const next = queue.filter((m) => m.id !== id);
	saveQueue(next);
	return next;
}

export function pruneStaleMessages(
	queue: TQueuedMessage[],
	maxAgeMs: number,
): TQueuedMessage[] {
	const cutoff = Date.now() - maxAgeMs;
	const next = queue.filter((m) => m.timestamp > cutoff);
	saveQueue(next);
	return next;
}

export function removeByChannelAndType(
	queue: TQueuedMessage[],
	channel: string,
	type: string,
): TQueuedMessage[] {
	const next = queue.filter(
		(m) =>
			!(
				m.payload.action === "message" &&
				m.payload.channel === channel &&
				m.payload.type === type
			),
	);
	saveQueue(next);
	return next;
}

export function drainQueue(
	queue: TQueuedMessage[],
	sendFn: (data: string) => boolean,
): TQueuedMessage[] {
	let remaining = [...queue];
	for (const entry of queue) {
		const success = sendFn(JSON.stringify(entry.payload));
		if (!success) break;
		remaining = remaining.filter((m) => m.id !== entry.id);
	}
	saveQueue(remaining);
	return remaining;
}
