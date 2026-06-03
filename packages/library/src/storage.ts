export interface IStorage {
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
	removeItem(key: string): Promise<void>;
}

/**
 * `localStorage` adapter for `IStorage`. Failures propagate as rejections
 * so consumers can surface them (see `onPersistError`).
 */
export function createLocalStorage(): IStorage {
	return {
		async getItem(key) {
			return localStorage.getItem(key);
		},
		async setItem(key, value) {
			localStorage.setItem(key, value);
		},
		async removeItem(key) {
			localStorage.removeItem(key);
		},
	};
}
