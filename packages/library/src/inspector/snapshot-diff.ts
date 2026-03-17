import type { TManagerState } from "./inspector-types";

export type TScalarDiff = {
	field: string;
	from: unknown;
	to: unknown;
};

export type TMapDiffEntry<V> = {
	key: string;
	change: "added" | "removed" | "changed";
	from?: V;
	to?: V;
};

export type TMapDiff<V> = {
	entries: TMapDiffEntry<V>[];
};

export type TSetDiffEntry = {
	key: string;
	change: "added" | "removed";
};

export type TSetDiff = {
	entries: TSetDiffEntry[];
};

export type TSnapshotDiff<TClientMsg> = {
	scalars: TScalarDiff[];
	subscriptionRefCounts: TMapDiff<number>;
	subscriptionData: TMapDiff<TClientMsg | undefined>;
	inFlightMessages: TMapDiff<TClientMsg>;
	pendingSubscriptions: TSetDiff;
	protocols: { from: readonly string[]; to: readonly string[] } | null;
};

function diffMaps<V>(
	a: ReadonlyMap<string, V>,
	b: ReadonlyMap<string, V>,
): TMapDiff<V> {
	const entries: TMapDiffEntry<V>[] = [];
	for (const [key, val] of b) {
		if (!a.has(key)) {
			entries.push({ key, change: "added", to: val });
		} else if (a.get(key) !== val) {
			entries.push({ key, change: "changed", from: a.get(key), to: val });
		}
	}
	for (const [key, val] of a) {
		if (!b.has(key)) {
			entries.push({ key, change: "removed", from: val });
		}
	}
	return { entries };
}

function diffSets(a: ReadonlySet<string>, b: ReadonlySet<string>): TSetDiff {
	const entries: TSetDiffEntry[] = [];
	for (const key of b) {
		if (!a.has(key)) entries.push({ key, change: "added" });
	}
	for (const key of a) {
		if (!b.has(key)) entries.push({ key, change: "removed" });
	}
	return { entries };
}

export function computeSnapshotDiff<TClientMsg>(
	prev: TManagerState<TClientMsg>,
	next: TManagerState<TClientMsg>,
): TSnapshotDiff<TClientMsg> {
	const scalars: TScalarDiff[] = [];

	if (prev.connectionState !== next.connectionState) {
		scalars.push({
			field: "connectionState",
			from: prev.connectionState,
			to: next.connectionState,
		});
	}
	if (prev.reconnectAttempt !== next.reconnectAttempt) {
		scalars.push({
			field: "reconnectAttempt",
			from: prev.reconnectAttempt,
			to: next.reconnectAttempt,
		});
	}
	if (prev.disposed !== next.disposed) {
		scalars.push({
			field: "disposed",
			from: prev.disposed,
			to: next.disposed,
		});
	}
	if (prev.intentionalClose !== next.intentionalClose) {
		scalars.push({
			field: "intentionalClose",
			from: prev.intentionalClose,
			to: next.intentionalClose,
		});
	}

	const protocolsChanged =
		prev.protocols.length !== next.protocols.length ||
		prev.protocols.some((p, i) => p !== next.protocols[i]);

	return {
		scalars,
		subscriptionRefCounts: diffMaps(
			prev.subscriptionRefCounts,
			next.subscriptionRefCounts,
		),
		subscriptionData: diffMaps(prev.subscriptionData, next.subscriptionData),
		inFlightMessages: diffMaps(prev.inFlightMessages, next.inFlightMessages),
		pendingSubscriptions: diffSets(
			prev.pendingSubscriptions,
			next.pendingSubscriptions,
		),
		protocols: protocolsChanged
			? { from: prev.protocols, to: next.protocols }
			: null,
	};
}
