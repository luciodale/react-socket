import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import {
	clearChannelFailedMessages,
	getChannelFailedMessages,
	setChannelFailedMessages,
} from "./failed-messages";
import type {
	TClientConversationMessage,
	TConnectionState,
	TConversationErrorType,
	TMessageStatus,
	TSocketError,
	TSocketMessageFromServerToClient,
	TStoredNotification,
} from "./types";

// ── Action ref (read by inspector) ──────────────────────────────────

export const _actionRef = { current: "unknown" };

// ── Store shape ─────────────────────────────────────────────────────

export type TSocketStore = {
	connectionState: TConnectionState;
	hasConnected: boolean;
	hasDisconnected: boolean;
	conversationMessages: Record<string, TClientConversationMessage[]>;
	notificationMessages: Record<string, TStoredNotification[]>;
	subscriptionRefCounts: Record<string, number>;
	pendingQueueLength: number;
	lastError: {
		code?: number;
		message: string;
		channel?: string;
		error?: TConversationErrorType;
		messageId?: string;
	} | null;
	// actions
	handleServerMessage: (msg: TSocketMessageFromServerToClient) => void;
	addOptimisticMessage: (
		channel: string,
		msg: TClientConversationMessage,
	) => void;
	setMessageStatus: (
		channel: string,
		messageId: string,
		status: TMessageStatus,
	) => void;
	setConnectionState: (state: TConnectionState) => void;
	incrementRefCount: (key: string) => void;
	decrementRefCount: (key: string) => void;
	setPendingQueueLength: (length: number) => void;
	setLastError: (error: TSocketError | null) => void;
};

const EMPTY_MESSAGES: TClientConversationMessage[] = [];
const EMPTY_NOTIFICATIONS: TStoredNotification[] = [];

export const useSocketStore = create<TSocketStore>()(
	subscribeWithSelector((set) => ({
		connectionState: "disconnected",
		hasConnected: false,
		hasDisconnected: false,
		conversationMessages: {},
		notificationMessages: {},
		subscriptionRefCounts: {},
		pendingQueueLength: 0,
		lastError: null,

		handleServerMessage(msg) {
			if (msg.action === "message" && msg.type === "conversation") {
				if (msg.delivery === "dump") {
					_actionRef.current = "serverMessage/conversation-dump";
					set((s) => {
						const dumpIds = new Set(msg.messages.map((m) => m.id));
						const failed = getChannelFailedMessages(msg.channel);
						const stillFailed = failed.filter(
							(m) => !dumpIds.has(m.id),
						);
						setChannelFailedMessages(msg.channel, stillFailed);
						return {
							conversationMessages: {
								...s.conversationMessages,
								[msg.channel]: [
									...msg.messages.map((m) => ({
										...m,
										status: "sent" as const,
									})),
									...stillFailed,
								],
							},
						};
					});
					return;
				}

				if (msg.delivery === "event") {
					_actionRef.current = "serverMessage/conversation-event";
					set((s) => {
						const existing = s.conversationMessages[msg.channel] ?? [];
						const idx = existing.findIndex((m) => m.id === msg.id);

						let updated: TClientConversationMessage[];

						// Optimistic message exists → confirm it
						if (idx !== -1) {
							updated = [...existing];
							updated[idx] = { ...updated[idx], status: "sent" };

							// Only clear failed messages when our own message is acknowledged
							clearChannelFailedMessages(msg.channel);
							updated = updated.filter(
								(m) => m.status !== "failed",
							);
						} else {
							// New message from server (other user / bot)
							const entry: TClientConversationMessage = {
								id: msg.id,
								sender: msg.sender,
								content: msg.content,
								status: "sent",
							};
							updated = [...existing, entry];
						}

						return {
							conversationMessages: {
								...s.conversationMessages,
								[msg.channel]: updated,
							},
						};
					});
					return;
				}

				if (msg.delivery === "error") {
					_actionRef.current = "serverMessage/conversation-error";
					set((s) => {
						const result: Partial<TSocketStore> = {
							lastError: {
								error: msg.error,
								message: msg.message,
								channel: msg.channel,
								messageId: msg.messageId,
							},
						};

						// Mark the failed message
						if (msg.messageId) {
							const existing =
								s.conversationMessages[msg.channel] ?? [];
							const idx = existing.findIndex(
								(m) => m.id === msg.messageId,
							);
							if (idx !== -1) {
								const updated = [...existing];
								updated[idx] = { ...updated[idx], status: "failed" };
								result.conversationMessages = {
									...s.conversationMessages,
									[msg.channel]: updated,
								};

								// Persist to localStorage
								const persisted = getChannelFailedMessages(msg.channel);
								const alreadyStored = persisted.some(
									(m) => m.id === msg.messageId,
								);
								if (!alreadyStored) {
									setChannelFailedMessages(msg.channel, [
										...persisted,
										updated[idx],
									]);
								}
							}
						}

						return result;
					});
					return;
				}
			}

			if (msg.action === "message" && msg.type === "notification") {
				if (msg.delivery === "dump") {
					_actionRef.current = "serverMessage/notification-dump";
					set((s) => ({
						notificationMessages: {
							...s.notificationMessages,
							[msg.channel]: msg.notifications,
						},
					}));
					return;
				}

				if (msg.delivery === "event") {
					_actionRef.current = "serverMessage/notification-event";
					const entry: TStoredNotification = {
						id: msg.id,
						title: msg.title,
						body: msg.body,
						timestamp: msg.timestamp,
					};
					set((s) => ({
						notificationMessages: {
							...s.notificationMessages,
							[msg.channel]: [
								...(s.notificationMessages[msg.channel] ?? []),
								entry,
							],
						},
					}));
					return;
				}
			}

			if (msg.action === "error") {
				_actionRef.current = "serverMessage/protocol-error";
				set({
					lastError: {
						code: msg.code,
						message: msg.message,
						channel: msg.channel,
						messageId: msg.messageId,
					},
				});
			}
		},

		addOptimisticMessage(channel, msg) {
			_actionRef.current = "addOptimisticMessage";
			set((s) => {
				const existing = s.conversationMessages[channel] ?? [];
				return {
					conversationMessages: {
						...s.conversationMessages,
						[channel]: [...existing, msg],
					},
				};
			});
		},

		setMessageStatus(channel, messageId, status) {
			_actionRef.current = "setMessageStatus";
			set((s) => {
				const existing = s.conversationMessages[channel] ?? [];
				const idx = existing.findIndex((m) => m.id === messageId);
				if (idx === -1) return s;

				const oldStatus = existing[idx].status;
				const updated = [...existing];
				updated[idx] = { ...updated[idx], status };

				// Transitioning away from "failed" → remove from localStorage
				if (oldStatus === "failed" && status !== "failed") {
					const persisted = getChannelFailedMessages(channel);
					setChannelFailedMessages(
						channel,
						persisted.filter((m) => m.id !== messageId),
					);
				}

				return {
					conversationMessages: {
						...s.conversationMessages,
						[channel]: updated,
					},
				};
			});
		},

		setConnectionState(state) {
			_actionRef.current = "setConnectionState";
			set((s) => ({
				connectionState: state,
				hasConnected: s.hasConnected || state === "connected",
				hasDisconnected:
					s.hasDisconnected ||
					state === "disconnected" ||
					state === "reconnecting",
			}));
		},

		incrementRefCount(key) {
			_actionRef.current = "incrementRefCount";
			set((s) => {
				const current = s.subscriptionRefCounts[key] ?? 0;
				return {
					subscriptionRefCounts: {
						...s.subscriptionRefCounts,
						[key]: current + 1,
					},
				};
			});
		},

		decrementRefCount(key) {
			_actionRef.current = "decrementRefCount";
			set((s) => {
				const current = s.subscriptionRefCounts[key] ?? 0;
				if (current <= 1) {
					const { [key]: _, ...rest } = s.subscriptionRefCounts;
					const colonIdx = key.indexOf(":");
					const type = key.slice(0, colonIdx);
					const channel = key.slice(colonIdx + 1);
					const result: Partial<TSocketStore> = {
						subscriptionRefCounts: rest,
					};
					if (type === "conversation") {
						const { [channel]: __, ...remaining } =
							s.conversationMessages;
						result.conversationMessages = remaining;
					} else if (type === "notification") {
						const { [channel]: __, ...remaining } =
							s.notificationMessages;
						result.notificationMessages = remaining;
					}
					return result;
				}
				return {
					subscriptionRefCounts: {
						...s.subscriptionRefCounts,
						[key]: current - 1,
					},
				};
			});
		},

		setPendingQueueLength(length) {
			_actionRef.current = "setPendingQueueLength";
			set({ pendingQueueLength: length });
		},

		setLastError(error) {
			_actionRef.current = "setLastError";
			set((s) => ({
				lastError: error
					? {
							code: error.code,
							message: error.message,
							channel: error.channel,
							messageId: error.messageId,
						}
					: null,
				hasDisconnected: s.hasDisconnected || error !== null,
			}));
		},
	})),
);

// ── Selectors ───────────────────────────────────────────────────────

export function selectConversationMessages(
	channel: string,
): (state: TSocketStore) => TClientConversationMessage[] {
	return (state) => state.conversationMessages[channel] ?? EMPTY_MESSAGES;
}

export function selectNotificationMessages(
	channel: string,
): (state: TSocketStore) => TStoredNotification[] {
	return (state) => state.notificationMessages[channel] ?? EMPTY_NOTIFICATIONS;
}

export function selectConnectionState(state: TSocketStore): TConnectionState {
	return state.connectionState;
}

export function selectIsSubscribed(
	type: string,
	channel: string,
): (state: TSocketStore) => boolean {
	const key = `${type}:${channel}`;
	return (state) => (state.subscriptionRefCounts[key] ?? 0) > 0;
}

export function selectHasDisconnected(state: TSocketStore): boolean {
	return state.hasDisconnected;
}

export function selectLastError(
	state: TSocketStore,
): TSocketStore["lastError"] {
	return state.lastError;
}
