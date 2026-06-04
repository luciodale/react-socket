import type { IStorage } from "./storage";

type TUndeliveredSyncConfig = {
	storage: IStorage;
	storageKey?: string;
	/**
	 * Called when a storage read/write fails. Without it the in-memory
	 * queue silently stops being durable.
	 */
	onPersistError?: (error: unknown) => void;
};

const EMPTY: never[] = [];

export function createUndeliveredSync<T extends { id: string }>(
	config: TUndeliveredSyncConfig,
) {
	const {
		storage,
		storageKey = "ws_undelivered_messages",
		onPersistError,
	} = config;
	let cache: Record<string, T[]> = {};
	let initialized = false;
	const listeners = new Set<() => void>();

	function persist(): void {
		storage.setItem(storageKey, JSON.stringify(cache)).catch((error) => {
			onPersistError?.(error);
		});
	}

	function notify(): void {
		for (const listener of listeners) listener();
	}

	async function init(): Promise<void> {
		try {
			const raw = await storage.getItem(storageKey);
			if (raw) {
				const parsed: unknown = JSON.parse(raw);
				if (
					typeof parsed === "object" &&
					parsed !== null &&
					!Array.isArray(parsed)
				) {
					// Validate per channel, not just the container: well-formed
					// JSON with a non-array channel value (schema drift, key
					// collision) must not poison the cache — getChannelMessages
					// would return it as-is and addMessage would crash on it.
					const entries = Object.entries(parsed as Record<string, unknown>);
					const valid = entries.filter(([, value]) => Array.isArray(value));
					if (valid.length !== entries.length) {
						onPersistError?.(
							new Error(
								"undelivered-sync: dropped non-array channel values during hydration",
							),
						);
					}
					cache = Object.fromEntries(valid) as Record<string, T[]>;
				}
			}
		} catch (error) {
			// Corrupted or unavailable — start empty.
			onPersistError?.(error);
		}
		initialized = true;
		notify();
	}

	return {
		init,

		isInitialized(): boolean {
			return initialized;
		},

		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},

		getChannelMessages(channel: string): T[] {
			return cache[channel] ?? EMPTY;
		},

		addMessage(channel: string, msg: T): void {
			const existing = cache[channel] ?? [];
			if (existing.some((m) => m.id === msg.id)) return;
			cache[channel] = [...existing, msg];
			persist();
			notify();
		},

		removeMessage(channel: string, messageId: string): void {
			const existing = cache[channel] ?? [];
			const filtered = existing.filter((m) => m.id !== messageId);
			if (filtered.length === 0) {
				delete cache[channel];
			} else {
				cache[channel] = filtered;
			}
			persist();
			notify();
		},

		setChannelMessages(channel: string, messages: T[]): void {
			if (messages.length === 0) {
				delete cache[channel];
			} else {
				cache[channel] = messages;
			}
			persist();
			notify();
		},

		clearChannel(channel: string): void {
			delete cache[channel];
			persist();
			notify();
		},

		clearAll(): void {
			cache = {};
			storage.removeItem(storageKey).catch((error) => {
				onPersistError?.(error);
			});
			notify();
		},
	};
}

export type TUndeliveredSync<T extends { id: string }> = ReturnType<
	typeof createUndeliveredSync<T>
>;
