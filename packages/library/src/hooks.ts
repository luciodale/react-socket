import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { TConnectionState, TSendParams } from "./types";

// ── useSocketConnectionState ─────────────────────────────────────────

type TConnectionStateSource = {
	addConnectionStateListener: (listener: () => void) => () => void;
	getConnectionState: () => TConnectionState;
};

export function useSocketConnectionState(
	manager: TConnectionStateSource,
): TConnectionState {
	return useSyncExternalStore(
		(listener) => manager.addConnectionStateListener(listener),
		() => manager.getConnectionState(),
		() => manager.getConnectionState(),
	);
}

// ── useSocketEvent ───────────────────────────────────────────────────

// `discriminator` is exposed so TS can infer `TKey` from the manager
// argument. Without it, `TKey` has no inference site and falls back to
// `string`, which collapses `Record<TKey, string>` into a constraint that
// rejects any `TServerMsg` with non-string fields — and `Extract` then
// resolves handlers to `never`. Custom event sources used as test mocks
// must set `discriminator` accordingly.
type TKeyedEventSource<TServerMsg, TKey extends string = "type"> = {
	readonly discriminator: TKey;
	addEventListener: (
		value: string,
		cb: (msg: TServerMsg) => void,
	) => () => void;
};

export function useSocketEvent<
	TKey extends string,
	TServerMsg extends Record<TKey, string>,
	TValue extends TServerMsg[TKey],
>(
	manager: TKeyedEventSource<TServerMsg, TKey>,
	value: TValue,
	handler: (msg: Extract<TServerMsg, Record<TKey, TValue>>) => void,
): void {
	const handlerRef = useRef(handler);
	handlerRef.current = handler;

	useEffect(() => {
		return manager.addEventListener(value, (msg) => {
			handlerRef.current(msg as Extract<TServerMsg, Record<TKey, TValue>>);
		});
	}, [manager, value]);
}

// ── useSocketEventBatch ──────────────────────────────────────────────

/**
 * Receive-side backpressure helper. Buffers events matching `value` and
 * flushes the batch to `handler` on a fixed `flushMs` interval. Use for
 * high-frequency streams (LLM tokens, presence cursors, telemetry) where
 * a setState per event would tank UI performance.
 *
 * **`idleMs` (optional)**: when set, also flushes after `idleMs` of
 * silence on the channel. This avoids the trailing-latency artifact
 * where the last 1–3 events of a stream sit in the buffer waiting for
 * the next interval tick. Typical use: `flushMs: 16, idleMs: 8` for an
 * LLM token stream so the final tokens render without a visible stall.
 *
 * **Do not use `idleMs` for pure throttling.** Every matching event
 * resets the idle timer, so any gap longer than `idleMs` triggers an
 * early flush — including a trickle of 2 events followed by silence,
 * which will flush at `idleMs` rather than wait for `flushMs`. `idleMs`
 * is an *opt-in to extra responsiveness on burst tails*, not extra
 * batching. If your goal is "render at most every X ms regardless of
 * activity," omit `idleMs` and rely on `flushMs` alone.
 */
export function useSocketEventBatch<
	TKey extends string,
	TServerMsg extends Record<TKey, string>,
	TValue extends TServerMsg[TKey],
>(
	manager: TKeyedEventSource<TServerMsg, TKey>,
	value: TValue,
	handler: (msgs: Array<Extract<TServerMsg, Record<TKey, TValue>>>) => void,
	options: { flushMs: number; idleMs?: number },
): void {
	const handlerRef = useRef(handler);
	handlerRef.current = handler;

	const { flushMs, idleMs } = options;

	useEffect(() => {
		const buffer: Array<Extract<TServerMsg, Record<TKey, TValue>>> = [];
		let idleTimer: ReturnType<typeof setTimeout> | null = null;

		const flush = () => {
			if (idleTimer) {
				clearTimeout(idleTimer);
				idleTimer = null;
			}
			if (buffer.length === 0) return;
			// Snapshot, then clear in place (faster than reassigning to []).
			const batch = buffer.slice();
			buffer.length = 0;
			handlerRef.current(batch);
		};

		const unsubscribe = manager.addEventListener(value, (msg) => {
			buffer.push(msg as Extract<TServerMsg, Record<TKey, TValue>>);
			if (idleMs !== undefined) {
				if (idleTimer) clearTimeout(idleTimer);
				idleTimer = setTimeout(flush, idleMs);
			}
		});

		const timer = setInterval(flush, flushMs);

		return () => {
			unsubscribe();
			clearInterval(timer);
			if (idleTimer) clearTimeout(idleTimer);
			buffer.length = 0;
		};
	}, [manager, value, flushMs, idleMs]);
}

// ── useSocketSubscription ────────────────────────────────────────────

type TSubscribable<TClientMsg> = {
	subscribe: (key: string, data?: TClientMsg) => void;
	unsubscribe: (key: string, data?: TClientMsg) => void;
};

/**
 * Declarative ref-counted subscription. The first mount for a given `key`
 * triggers a single `subscribe` wire send; later mounts increment a
 * counter without re-sending. Unmount decrements. The wire `unsubscribe`
 * fires only when the count reaches zero.
 *
 * **Recommended: wrap this hook once per resource and call the wrapper
 * everywhere.** Centralising the `key` + `subscribe` + `unsubscribe`
 * derivation in a single custom hook (e.g. `useSpaceSubscription`) makes
 * it impossible for two call sites to drift apart on params. Combined
 * with first-payload-wins semantics (see below), this turns a whole
 * class of bugs into a non-issue.
 *
 * **Gating with `enabled`**: pass `enabled: false` to opt out entirely
 * (no wire send, no ref-count touch). Flipping `false → true` subscribes;
 * `true → false` unsubscribes. Mirrors React Query's `enabled` semantics.
 *
 * **Payload timing.** The `subscribe` payload is read once, when the
 * effect runs (mount, key change, or `enabled` flip), and stored for
 * replay on reconnect. Changing it between renders without changing
 * `key`/`enabled` does NOT re-send. The `unsubscribe` payload is read at
 * unmount time (latest ref), so updates between mount and unmount are
 * picked up. To push a new subscribe payload, change `key` or toggle
 * `enabled`.
 *
 * **First-payload wins.** When multiple components subscribe to the same
 * `key`, only the first payload is sent on the wire and stored for replay
 * on reconnect. Later subscribers only bump the ref count. Combining
 * `enabled: false → true` with an existing subscription on the same key
 * means the late joiner's payload never reaches the wire. Wrap in a
 * custom hook so two call sites cannot drift apart. If your protocol
 * needs each joiner to identify itself, send a separate `useSocketSend`
 * message instead of relying on the subscribe payload.
 *
 * **Subscribe with no payload** is supported (bookkeeping-only ref count,
 * no wire send). `useSocketPendingSubscription` will not flip to `true`
 * for those keys since there is nothing to ack.
 *
 * @example
 * ```tsx
 * // Centralised wrapper — every consumer uses this, never the raw hook.
 * export function useSpaceSubscription(spaceId: string | null) {
 *   useSocketSubscription(manager, {
 *     key: spaceId ?? "",
 *     enabled: spaceId !== null,
 *     subscribe: spaceId ? { type: "join", spaceId } : undefined,
 *     unsubscribe: spaceId ? { type: "leave", spaceId } : undefined,
 *   });
 * }
 * ```
 */
export function useSocketSubscription<TClientMsg>(
	manager: TSubscribable<TClientMsg>,
	args: {
		key: string;
		subscribe?: TClientMsg;
		unsubscribe?: TClientMsg;
		enabled?: boolean;
	},
): void {
	const { key, subscribe, unsubscribe, enabled = true } = args;
	const subscribeRef = useRef(subscribe);
	const unsubscribeRef = useRef(unsubscribe);
	subscribeRef.current = subscribe;
	unsubscribeRef.current = unsubscribe;

	useEffect(() => {
		if (!enabled) return;
		manager.subscribe(key, subscribeRef.current);
		return () => {
			manager.unsubscribe(key, unsubscribeRef.current);
		};
	}, [manager, key, enabled]);
}

// ── useSocketPendingSubscription ─────────────────────────────────────

type TPendingSubscriptionSource = {
	addPendingSubscriptionListener: (listener: () => void) => () => void;
	hasPendingSubscription: (key: string) => boolean;
};

export function useSocketPendingSubscription(
	manager: TPendingSubscriptionSource,
	key: string,
): boolean {
	const subscribe = useCallback(
		(listener: () => void) => manager.addPendingSubscriptionListener(listener),
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

/**
 * Observe every outgoing send the moment `manager.send(...)` is called,
 * regardless of whether the socket actually delivers it. Fires before
 * the wire write, so it sees offline sends too. Use this to drive
 * optimistic UI: append the message to local state immediately, then
 * pair with `useSocketInFlightDrop` to roll back if the send is dropped
 * by a disconnect before being acked.
 *
 * @example
 * ```tsx
 * useSocketSendIntent(manager, ({ data, ackId }) => {
 *   if (data.type === "chat") {
 *     addOptimisticMessage({ ...data, ackId, status: "pending" });
 *   }
 * });
 * ```
 */
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

/**
 * Fires when in-flight messages (those sent with an `ackId`) are dropped
 * because the socket closed before the server acked them. Use this to
 * roll back optimistic UI added in `useSocketSendIntent`, or to enqueue
 * the messages for resend via `createUndeliveredSync`.
 *
 * @example
 * ```tsx
 * useSocketInFlightDrop(manager, (dropped) => {
 *   for (const { id, data } of dropped) {
 *     markMessageFailed(id);
 *     undeliveredSync.enqueue(data);
 *   }
 * });
 * ```
 */
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

/**
 * Fires every time the socket transitions to `connected` AND existing
 * subscriptions have been replayed to the server. Receives the list of
 * resubscribed keys. Also fires on the very first connect, with
 * `restoredKeys = []`. Use this to flush queued offline sends or to
 * refetch state that may have drifted during the disconnect.
 *
 * @example
 * ```tsx
 * useSocketReady(manager, (restoredKeys) => {
 *   for (const msg of undeliveredSync.drain()) manager.send({ data: msg });
 *   if (restoredKeys.length > 0) refetchSpaceStateForKeys(restoredKeys);
 * });
 * ```
 */
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
		cb: (key: string, subscribePayload: TClientMsg | undefined) => void,
	) => () => void;
};

/**
 * Fires when the subscription ref count for `key` drops to zero — the
 * last subscriber left and the wire `unsubscribe` was sent. Use it to
 * clear cached server state for the key, or to fire app-level cleanup
 * tied to "no one is watching this channel anymore."
 *
 * The second arg is the **original `subscribe` payload** that was stored
 * when the first subscriber for this key joined (first-payload wins),
 * not the unsubscribe payload. Useful for cache eviction code that needs
 * to recover the join context.
 *
 * **Strict Mode**: React 18+ Strict Mode double-mounts components in
 * dev, causing a transient mount→unmount→remount cycle that fires this
 * listener spuriously. Keep handlers idempotent — write to state, do
 * not perform irreversible side effects (e.g. POST cleanup, decrement
 * external counters). Production behavior is unaffected.
 *
 * @example
 * ```tsx
 * useSocketLastUnsubscribe(manager, (key) => {
 *   queryClient.removeQueries({ queryKey: ["space", key] });
 * });
 * ```
 */
export function useSocketLastUnsubscribe<TClientMsg>(
	manager: TLastUnsubscribeSource<TClientMsg>,
	handler: (key: string, subscribePayload: TClientMsg | undefined) => void,
): void {
	const handlerRef = useRef(handler);
	handlerRef.current = handler;
	useEffect(() => {
		return manager.addLastUnsubscribeListener((key, payload) =>
			handlerRef.current(key, payload),
		);
	}, [manager]);
}
