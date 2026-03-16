import { useSyncExternalStore } from "react";
import type { TConnectionState } from "./types";

type TInternalState = {
	connectionState: TConnectionState;
	hasConnected: boolean;
	hasDisconnected: boolean;
	_refCounts: Record<string, number>;
};

export function createInternalStore() {
	let state: TInternalState = {
		connectionState: "disconnected",
		hasConnected: false,
		hasDisconnected: false,
		_refCounts: {},
	};

	const listeners = new Set<() => void>();

	function notify() {
		for (const listener of listeners) {
			listener();
		}
	}

	function get() {
		return state;
	}

	function set(fn: (s: TInternalState) => Partial<TInternalState>) {
		state = { ...state, ...fn(state) };
		notify();
	}

	function subscribe(listener: () => void) {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	}

	function useSelector<T>(selector: (s: TInternalState) => T): T {
		return useSyncExternalStore(
			subscribe,
			() => selector(state),
			() => selector(state),
		);
	}

	return { get, set, subscribe, useSelector };
}
