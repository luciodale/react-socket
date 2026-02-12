import type {
	TClientConversationMessage,
	TConnectionState,
	TStoredNotification,
} from "../socket/types";

// ── Data-only subset of TSocketStore (no actions) ───────────────────

export type TSocketStoreState = {
	connectionState: TConnectionState;
	hasConnected: boolean;
	conversationMessages: Record<string, TClientConversationMessage[]>;
	notificationMessages: Record<string, TStoredNotification[]>;
	subscriptionRefCounts: Record<string, number>;
	pendingQueueLength: number;
	lastError: {
		code?: number;
		message: string;
		channel?: string;
		error?: string;
		messageId?: string;
	} | null;
};

// ── History snapshot ────────────────────────────────────────────────

export type TStateSnapshot = {
	id: number;
	timestamp: number;
	actionName: string;
	state: TSocketStoreState;
};

// ── Diff entry ──────────────────────────────────────────────────────

export type TDiffEntry = {
	path: string;
	type: "added" | "removed" | "changed";
	oldValue?: unknown;
	newValue?: unknown;
};

// ── Inspector mode ──────────────────────────────────────────────────

export type TInspectorMode = "live" | "timemachine";
