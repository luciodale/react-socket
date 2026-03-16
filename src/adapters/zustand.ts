import type { StoreApi, UseBoundStore } from "zustand";
import type { TStoreAdapter } from "../socket/types";

export function createZustandAdapter<TState>(
	useStore: UseBoundStore<StoreApi<TState>>,
): TStoreAdapter<TState> {
	return {
		get: () => useStore.getState(),
		set: (fn) => useStore.setState(fn),
		useSelector: (selector) => useStore(selector),
	};
}
