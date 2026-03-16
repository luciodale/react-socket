export interface IStorage {
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
	removeItem(key: string): Promise<void>;
}

export function createLocalStorage(): IStorage {
	return {
		async getItem(key) {
			try {
				return localStorage.getItem(key);
			} catch {
				return null;
			}
		},
		async setItem(key, value) {
			try {
				localStorage.setItem(key, value);
			} catch {
				// Storage full or unavailable
			}
		},
		async removeItem(key) {
			try {
				localStorage.removeItem(key);
			} catch {
				// Storage unavailable
			}
		},
	};
}
