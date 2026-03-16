import type { IStorage } from "./storage";

type TUndeliveredSyncConfig = {
	storage: IStorage;
	storageKey?: string;
};

export function createUndeliveredSync<T extends { id: string }>(
	config: TUndeliveredSyncConfig,
) {
	const { storage, storageKey = "ws_undelivered_messages" } = config;
	let cache: Record<string, T[]> = {};
	let initialized = false;

	function persist(): void {
		storage.setItem(storageKey, JSON.stringify(cache)).catch(() => {});
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
					cache = parsed as Record<string, T[]>;
				}
			}
		} catch {
			// Corrupted or unavailable — start empty
		}
		initialized = true;
	}

	return {
		init,

		isInitialized(): boolean {
			return initialized;
		},

		getChannelMessages(channel: string): T[] {
			return cache[channel] ?? [];
		},

		addMessage(channel: string, msg: T): void {
			const existing = cache[channel] ?? [];
			if (existing.some((m) => m.id === msg.id)) return;
			cache[channel] = [...existing, msg];
			persist();
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
		},

		setChannelMessages(channel: string, messages: T[]): void {
			if (messages.length === 0) {
				delete cache[channel];
			} else {
				cache[channel] = messages;
			}
			persist();
		},

		clearChannel(channel: string): void {
			delete cache[channel];
			persist();
		},

		clearAll(): void {
			cache = {};
			storage.removeItem(storageKey).catch(() => {});
		},
	};
}

export type TUndeliveredSync<T extends { id: string }> = ReturnType<
	typeof createUndeliveredSync<T>
>;
