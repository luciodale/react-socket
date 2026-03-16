import { useCallback, useMemo } from "react";
import { create } from "zustand";
import { createZustandAdapter } from "./adapters/zustand";
import { createSocket } from "./socket/index";

// ── Domain types (user-defined) ─────────────────────────────────────

export type TContentBlock = { type: "text"; text: string };

export type TMessageStatus = "pending" | "sent" | "undelivered";

export type TConversationMessage = {
	id: string;
	sender: string;
	content: TContentBlock[];
	status: TMessageStatus;
	undeliveredAt?: string;
};

export type TNotification = {
	id: string;
	title: string;
	body: string;
	timestamp: string;
};

// ── Store shape (user-defined) ──────────────────────────────────────

type TState = {
	conversations: Record<string, TConversationMessage[]>;
	notifications: Record<string, TNotification[]>;
};

// ── Zustand store + adapter ─────────────────────────────────────────

export const useStore = create<TState>()(() => ({
	conversations: {},
	notifications: {},
}));

const storeAdapter = createZustandAdapter(useStore);

// ── Wire protocol (user-defined) ────────────────────────────────────

type TServerMsg =
	| { action: "subscribe_ack"; type: string; channel: string }
	| { action: "unsubscribe_ack"; type: string; channel: string }
	| {
			action: "message";
			type: "conversation";
			delivery: "event";
			id: string;
			channel: string;
			sender: string;
			content: TContentBlock[];
	  }
	| {
			action: "message";
			type: "conversation";
			delivery: "dump";
			channel: string;
			messages: { id: string; sender: string; content: TContentBlock[] }[];
	  }
	| {
			action: "message";
			type: "conversation";
			delivery: "error";
			channel: string;
			error: string;
			message: string;
			messageId?: string;
	  }
	| {
			action: "message";
			type: "notification";
			delivery: "event";
			id: string;
			channel: string;
			title: string;
			body: string;
			timestamp: string;
	  }
	| {
			action: "message";
			type: "notification";
			delivery: "dump";
			channel: string;
			notifications: TNotification[];
	  }
	| { action: "error"; code: number; message: string; messageId?: string };

type TClientMsg =
	| { action: "subscribe"; type: string; channel: string }
	| { action: "unsubscribe"; type: string; channel: string }
	| {
			action: "message";
			type: "conversation";
			id: string;
			channel: string;
			message: string;
	  };

// ── Socket instance ─────────────────────────────────────────────────

export const socket = createSocket<TServerMsg, TClientMsg, TState>({
	store: storeAdapter,

	subscribe(type, channel) {
		return { action: "subscribe", type, channel };
	},

	unsubscribe(type, channel) {
		return { action: "unsubscribe", type, channel };
	},

	resolveSubscriptionAck(msg) {
		if (msg.action === "subscribe_ack") {
			return { type: msg.type, channel: msg.channel };
		}
		return null;
	},

	getOutboundId(msg) {
		if (msg.action === "message") return msg.id;
		return null;
	},

	resolveInFlight(msg) {
		if (msg.action === "message" && msg.type === "conversation") {
			if (msg.delivery === "event") return { ack: msg.id };
			if (msg.delivery === "error" && msg.messageId) {
				return { drop: msg.messageId };
			}
		}
		if (msg.action === "error" && msg.messageId) {
			return { drop: msg.messageId };
		}
		return null;
	},

	onInFlightDrop(ids, { set }) {
		for (const id of ids) {
			set((s) => {
				for (const [channel, msgs] of Object.entries(s.conversations)) {
					const idx = msgs.findIndex((m) => m.id === id);
					if (idx !== -1) {
						const updated = [...msgs];
						updated[idx] = {
							...updated[idx],
							status: "undelivered",
							undeliveredAt: new Date().toISOString(),
						};
						return {
							conversations: {
								...s.conversations,
								[channel]: updated,
							},
						};
					}
				}
				return s;
			});
		}
	},

	onMessage(msg, { set }) {
		if (msg.action === "message" && msg.type === "conversation") {
			if (msg.delivery === "dump") {
				set((s) => ({
					conversations: {
						...s.conversations,
						[msg.channel]: msg.messages.map((m) => ({
							...m,
							status: "sent" as const,
						})),
					},
				}));
				return;
			}

			if (msg.delivery === "event") {
				set((s) => {
					const existing = s.conversations[msg.channel] ?? [];
					const idx = existing.findIndex((m) => m.id === msg.id);

					if (idx !== -1) {
						const updated = [...existing];
						const { undeliveredAt: _, ...rest } = updated[idx];
						updated[idx] = { ...rest, status: "sent" };
						return {
							conversations: {
								...s.conversations,
								[msg.channel]: updated,
							},
						};
					}

					return {
						conversations: {
							...s.conversations,
							[msg.channel]: [
								...existing,
								{
									id: msg.id,
									sender: msg.sender,
									content: msg.content,
									status: "sent",
								},
							],
						},
					};
				});
				return;
			}

			if (msg.delivery === "error") {
				set((s) => {
					if (!msg.messageId) return s;
					const existing = s.conversations[msg.channel] ?? [];
					const idx = existing.findIndex(
						(m) => m.id === msg.messageId,
					);
					if (idx === -1) return s;

					const updated = [...existing];
					updated[idx] = {
						...updated[idx],
						status: "undelivered",
						undeliveredAt: new Date().toISOString(),
					};
					return {
						conversations: {
							...s.conversations,
							[msg.channel]: updated,
						},
					};
				});
				return;
			}
		}

		if (msg.action === "message" && msg.type === "notification") {
			if (msg.delivery === "dump") {
				set((s) => ({
					notifications: {
						...s.notifications,
						[msg.channel]: msg.notifications,
					},
				}));
				return;
			}

			if (msg.delivery === "event") {
				set((s) => ({
					notifications: {
						...s.notifications,
						[msg.channel]: [
							...(s.notifications[msg.channel] ?? []),
							{
								id: msg.id,
								title: msg.title,
								body: msg.body,
								timestamp: msg.timestamp,
							},
						],
					},
				}));
				return;
			}
		}
	},

	onChannelCleanup(type, channel, { set }) {
		if (type === "conversation") {
			set((s) => {
				const { [channel]: _, ...rest } = s.conversations;
				return { conversations: rest };
			});
		}
		if (type === "notification") {
			set((s) => {
				const { [channel]: _, ...rest } = s.notifications;
				return { notifications: rest };
			});
		}
	},
});

// ── Custom hooks (consumer-level) ───────────────────────────────────

export function useChat(chatId: string) {
	const { data, isSubscribed, connectionState } = socket.useSubscription(
		"conversation",
		chatId,
		useMemo(
			() => (s) => s.conversations[chatId] ?? EMPTY_MESSAGES,
			[chatId],
		),
	);

	const send = socket.useSend();

	const messages = data;

	const undelivered = useMemo(
		() => messages.filter((m) => m.status === "undelivered"),
		[messages],
	);

	const sendMessage = useCallback(
		(text: string) => {
			const id = crypto.randomUUID();

			useStore.setState((s) => ({
				conversations: {
					...s.conversations,
					[chatId]: [
						...(s.conversations[chatId] ?? []),
						{
							id,
							sender: "user",
							content: [{ type: "text" as const, text }],
							status: "pending" as const,
						},
					],
				},
			}));

			const sent = send({
				action: "message",
				type: "conversation",
				id,
				channel: chatId,
				message: text,
			});

			if (!sent) {
				useStore.setState((s) => {
					const existing = s.conversations[chatId] ?? [];
					const idx = existing.findIndex((m) => m.id === id);
					if (idx === -1) return s;
					const updated = [...existing];
					updated[idx] = {
						...updated[idx],
						status: "undelivered",
						undeliveredAt: new Date().toISOString(),
					};
					return {
						conversations: {
							...s.conversations,
							[chatId]: updated,
						},
					};
				});
			}
		},
		[send, chatId],
	);

	const retryUndelivered = useCallback(
		(messageId: string) => {
			const state = useStore.getState();
			const msgs = state.conversations[chatId] ?? [];
			const msg = msgs.find(
				(m) => m.id === messageId && m.status === "undelivered",
			);
			if (!msg) return;

			useStore.setState((s) => {
				const existing = s.conversations[chatId] ?? [];
				const idx = existing.findIndex((m) => m.id === messageId);
				if (idx === -1) return s;
				const updated = [...existing];
				const { undeliveredAt: _, ...rest } = updated[idx];
				updated[idx] = { ...rest, status: "pending" };
				return {
					conversations: {
						...s.conversations,
						[chatId]: updated,
					},
				};
			});

			const sent = send({
				action: "message",
				type: "conversation",
				id: messageId,
				channel: chatId,
				message: msg.content.map((c) => c.text).join(""),
			});

			if (!sent) {
				useStore.setState((s) => {
					const existing = s.conversations[chatId] ?? [];
					const idx = existing.findIndex((m) => m.id === messageId);
					if (idx === -1) return s;
					const updated = [...existing];
					updated[idx] = {
						...updated[idx],
						status: "undelivered",
						undeliveredAt: new Date().toISOString(),
					};
					return {
						conversations: {
							...s.conversations,
							[chatId]: updated,
						},
					};
				});
			}
		},
		[send, chatId],
	);

	const retryAllUndelivered = useCallback(() => {
		for (const msg of undelivered) {
			retryUndelivered(msg.id);
		}
	}, [undelivered, retryUndelivered]);

	const discardUndelivered = useCallback(
		(messageId: string) => {
			useStore.setState((s) => {
				const existing = s.conversations[chatId] ?? [];
				return {
					conversations: {
						...s.conversations,
						[chatId]: existing.filter((m) => m.id !== messageId),
					},
				};
			});
		},
		[chatId],
	);

	const discardAllUndelivered = useCallback(() => {
		useStore.setState((s) => {
			const existing = s.conversations[chatId] ?? [];
			return {
				conversations: {
					...s.conversations,
					[chatId]: existing.filter((m) => m.status !== "undelivered"),
				},
			};
		});
	}, [chatId]);

	return {
		messages,
		sendMessage,
		undelivered,
		retryUndelivered,
		retryAllUndelivered,
		discardUndelivered,
		discardAllUndelivered,
		isSubscribed,
		connectionState,
	};
}

export function useNotifications(channel: string) {
	const { data, isSubscribed, connectionState } = socket.useSubscription(
		"notification",
		channel,
		useMemo(
			() => (s) => s.notifications[channel] ?? EMPTY_NOTIFICATIONS,
			[channel],
		),
	);

	return { notifications: data, isSubscribed, connectionState };
}

const EMPTY_MESSAGES: TConversationMessage[] = [];
const EMPTY_NOTIFICATIONS: TNotification[] = [];
