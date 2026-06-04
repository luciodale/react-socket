import { useEffect, useRef } from "react";
import type { TSnapshot } from "./inspector-types";

type TInspectorEventListProps<TClientMsg, TServerMsg> = {
	snapshots: TSnapshot<TClientMsg, TServerMsg>[];
	selectedSnapshotId: number | null;
	onSelect: (id: number) => void;
};

function truncate(str: string, max: number): string {
	return str.length > max ? `${str.slice(0, max)}\u2026` : str;
}

function formatTimeDelta(
	current: number,
	previous: number | undefined,
): string {
	if (previous === undefined) return "+0ms";
	const delta = current - previous;
	if (delta < 1000) return `+${delta}ms`;
	return `+${(delta / 1000).toFixed(1)}s`;
}

function formatEventSummary<TClientMsg, TServerMsg>(
	snapshot: TSnapshot<TClientMsg, TServerMsg>,
): string {
	const e = snapshot.event;
	switch (e.type) {
		case "connection-state-change":
			return `${e.from} \u2192 ${e.to}`;
		case "message-received":
			return truncate(JSON.stringify(e.deserialized), 60);
		case "message-sent":
			return truncate(JSON.stringify(e.deserialized), 60);
		case "send-failed":
			return `${e.reason}: ${truncate(JSON.stringify(e.deserialized), 45)}`;
		case "subscribe":
			return `${e.key} (ref: ${e.refCount})`;
		case "unsubscribe":
			return `${e.key} (ref: ${e.refCount})`;
		case "in-flight-ack":
			return e.ackId;
		case "in-flight-drop":
			return `${e.ids.length} message(s)`;
		case "ack-id-reuse":
			return e.ackId;
		case "pending-subscription-resolved":
			return e.key;
		case "reconnect-scheduled":
			return `attempt ${e.attempt}, ${e.delayMs.toFixed(0)}ms`;
		case "ready":
			return e.restoredKeys.length > 0
				? `restored: ${e.restoredKeys.join(", ")}`
				: "no subscriptions";
		case "deserialize-error":
			return truncate(
				typeof e.raw === "string" ? e.raw : `[binary ${typeof e.raw}]`,
				60,
			);
		case "url-resolve-error":
			return String(e.error);
		case "transport-error":
			return "";
		case "dispose":
			return "";
	}
}

export function InspectorEventList<TClientMsg, TServerMsg>({
	snapshots,
	selectedSnapshotId,
	onSelect,
}: TInspectorEventListProps<TClientMsg, TServerMsg>) {
	const listRef = useRef<HTMLDivElement>(null);
	const isAutoScrolling = useRef(true);

	useEffect(() => {
		if (
			isAutoScrolling.current &&
			selectedSnapshotId === null &&
			listRef.current
		) {
			listRef.current.scrollTop = listRef.current.scrollHeight;
		}
	});

	function handleScroll() {
		if (!listRef.current) return;
		const { scrollTop, scrollHeight, clientHeight } = listRef.current;
		isAutoScrolling.current = scrollHeight - scrollTop - clientHeight < 40;
	}

	return (
		<div ref={listRef} onScroll={handleScroll} className="rsi-event-list">
			{snapshots.map((snapshot, i) => (
				<div
					key={snapshot.id}
					role="option"
					aria-selected={snapshot.id === selectedSnapshotId}
					tabIndex={0}
					className="rsi-event-row"
					data-selected={snapshot.id === selectedSnapshotId}
					onClick={() => onSelect(snapshot.id)}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							onSelect(snapshot.id);
						}
					}}
				>
					<span className="rsi-event-time">
						{formatTimeDelta(
							snapshot.timestamp,
							i > 0 ? snapshots[i - 1].timestamp : undefined,
						)}
					</span>
					<span className="rsi-event-type" data-type={snapshot.event.type}>
						{snapshot.event.type}
					</span>
					<span className="rsi-event-summary">
						{formatEventSummary(snapshot)}
					</span>
				</div>
			))}
		</div>
	);
}
