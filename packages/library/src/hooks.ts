import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { TConnectionState, TSendParams } from "./types";

// ── useSocketConnectionState ─────────────────────────────────────────

type TConnectionStateSource = {
	subscribeToConnectionState: (listener: () => void) => () => void;
	getConnectionState: () => TConnectionState;
};

export function useSocketConnectionState(
	manager: TConnectionStateSource,
): TConnectionState {
	return useSyncExternalStore(
		(listener) => manager.subscribeToConnectionState(listener),
		() => manager.getConnectionState(),
		() => manager.getConnectionState(),
	);
}

// ── useSocketEvent ───────────────────────────────────────────────────

type TMessageSource<TServerMsg, TKey extends string> = {
	discriminator: TKey;
	addMessageListener: (cb: (msg: TServerMsg) => void) => () => void;
};

export function useSocketEvent<
	TKey extends string,
	TServerMsg extends Record<TKey, string>,
	TValue extends TServerMsg[TKey],
>(
	manager: TMessageSource<TServerMsg, TKey>,
	value: TValue,
	handler: (msg: Extract<TServerMsg, Record<TKey, TValue>>) => void,
): void {
	const handlerRef = useRef(handler);
	handlerRef.current = handler;

	useEffect(() => {
		const key = manager.discriminator;
		return manager.addMessageListener((msg) => {
			if ((msg as Record<TKey, string>)[key] === value) {
				handlerRef.current(msg as Extract<TServerMsg, Record<TKey, TValue>>);
			}
		});
	}, [manager, value]);
}

// ── useSocketEventBatch ──────────────────────────────────────────────
//
// Receive-side backpressure helper. Buffers events matching the given
// discriminator value and flushes the batch to `handler` on a fixed
// interval. Useful for high-frequency streams where calling setState
// per event would tank UI performance.

export function useSocketEventBatch<
	TKey extends string,
	TServerMsg extends Record<TKey, string>,
	TValue extends TServerMsg[TKey],
>(
	manager: TMessageSource<TServerMsg, TKey>,
	value: TValue,
	handler: (msgs: Array<Extract<TServerMsg, Record<TKey, TValue>>>) => void,
	options: { flushMs: number },
): void {
	const handlerRef = useRef(handler);
	handlerRef.current = handler;

	const { flushMs } = options;

	useEffect(() => {
		const key = manager.discriminator;
		const buffer: Array<Extract<TServerMsg, Record<TKey, TValue>>> = [];

		const unsubscribe = manager.addMessageListener((msg) => {
			if ((msg as Record<TKey, string>)[key] === value) {
				buffer.push(msg as Extract<TServerMsg, Record<TKey, TValue>>);
			}
		});

		const timer = setInterval(() => {
			if (buffer.length === 0) return;
			// Snapshot, then clear in place (faster than reassigning to []).
			const batch = buffer.slice();
			buffer.length = 0;
			handlerRef.current(batch);
		}, flushMs);

		return () => {
			unsubscribe();
			clearInterval(timer);
			buffer.length = 0;
		};
	}, [manager, value, flushMs]);
}

// ── useSocketSubscription ────────────────────────────────────────────

type TSubscribable<TClientMsg> = {
	subscribe: (key: string, data?: TClientMsg) => void;
	unsubscribe: (key: string, data?: TClientMsg) => void;
};

export function useSocketSubscription<TClientMsg>(
	manager: TSubscribable<TClientMsg>,
	args: {
		key: string;
		subscribe?: TClientMsg;
		unsubscribe?: TClientMsg;
	},
): void {
	const { key, subscribe, unsubscribe } = args;
	const subscribeRef = useRef(subscribe);
	const unsubscribeRef = useRef(unsubscribe);
	subscribeRef.current = subscribe;
	unsubscribeRef.current = unsubscribe;

	useEffect(() => {
		manager.subscribe(key, subscribeRef.current);
		return () => {
			manager.unsubscribe(key, unsubscribeRef.current);
		};
	}, [manager, key]);
}

// ── useSocketPendingSubscription ─────────────────────────────────────

type TPendingSubscriptionSource = {
	subscribeToPendingSubscriptions: (listener: () => void) => () => void;
	hasPendingSubscription: (key: string) => boolean;
};

export function useSocketPendingSubscription(
	manager: TPendingSubscriptionSource,
	key: string,
): boolean {
	const subscribe = useCallback(
		(listener: () => void) => manager.subscribeToPendingSubscriptions(listener),
		[manager],
	);
	const getSnapshot = useCallback(
		() => manager.hasPendingSubscription(key),
		[manager, key],
	);
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ── useSocketSend ────────────────────────────────────────────────────

type TSendable<TClientMsg> = {
	send: (params: TSendParams<TClientMsg>) => boolean;
};

type TUseSocketSend<TClientMsg> = {
	send: (data: TClientMsg, ackId?: string) => boolean;
};

export function useSocketSend<TClientMsg>(
	manager: TSendable<TClientMsg>,
): TUseSocketSend<TClientMsg> {
	const send = useCallback(
		(data: TClientMsg, ackId?: string) => manager.send({ data, ackId }),
		[manager],
	);
	return { send };
}

// ── useSocketSendIntent ──────────────────────────────────────────────

type TSendIntentSource<TClientMsg> = {
	addSendIntentListener: (
		cb: (params: TSendParams<TClientMsg>) => void,
	) => () => void;
};

export function useSocketSendIntent<TClientMsg>(
	manager: TSendIntentSource<TClientMsg>,
	handler: (params: TSendParams<TClientMsg>) => void,
): void {
	const handlerRef = useRef(handler);
	handlerRef.current = handler;
	useEffect(() => {
		return manager.addSendIntentListener((params) =>
			handlerRef.current(params),
		);
	}, [manager]);
}

// ── useSocketInFlightDrop ────────────────────────────────────────────

type TInFlightDropSource<TClientMsg> = {
	addInFlightDropListener: (
		cb: (messages: { id: string; data: TClientMsg }[]) => void,
	) => () => void;
};

export function useSocketInFlightDrop<TClientMsg>(
	manager: TInFlightDropSource<TClientMsg>,
	handler: (messages: { id: string; data: TClientMsg }[]) => void,
): void {
	const handlerRef = useRef(handler);
	handlerRef.current = handler;
	useEffect(() => {
		return manager.addInFlightDropListener((messages) =>
			handlerRef.current(messages),
		);
	}, [manager]);
}

// ── useSocketReady ───────────────────────────────────────────────────

type TReadySource = {
	addReadyListener: (cb: (restoredKeys: string[]) => void) => () => void;
};

export function useSocketReady(
	manager: TReadySource,
	handler: (restoredKeys: string[]) => void,
): void {
	const handlerRef = useRef(handler);
	handlerRef.current = handler;
	useEffect(() => {
		return manager.addReadyListener((keys) => handlerRef.current(keys));
	}, [manager]);
}

// ── useSocketLastUnsubscribe ─────────────────────────────────────────

type TLastUnsubscribeSource<TClientMsg> = {
	addLastUnsubscribeListener: (
		cb: (key: string, data: TClientMsg | undefined) => void,
	) => () => void;
};

export function useSocketLastUnsubscribe<TClientMsg>(
	manager: TLastUnsubscribeSource<TClientMsg>,
	handler: (key: string, data: TClientMsg | undefined) => void,
): void {
	const handlerRef = useRef(handler);
	handlerRef.current = handler;
	useEffect(() => {
		return manager.addLastUnsubscribeListener((key, data) =>
			handlerRef.current(key, data),
		);
	}, [manager]);
}
