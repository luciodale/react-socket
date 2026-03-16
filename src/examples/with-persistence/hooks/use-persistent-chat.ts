import { useCallback, useEffect, useMemo } from "react";
import { chatSocket } from "../../shared/socket";
import { useChatStore } from "../../shared/store";
import type { TChatMessage } from "../../shared/types";
import { useUndeliveredStore } from "../undelivered-store";

const EMPTY_MESSAGES: TChatMessage[] = [];

// ── Hook ─────────────────────────────────────────────────────────────

export function usePersistentChat(chatId: string) {
	const persistedUndelivered = useUndeliveredStore(
		(s) => s.channels[chatId] ?? EMPTY_MESSAGES,
	);
	const { addMessage, removeMessage, setChannelMessages, clearChannel } =
		useUndeliveredStore();

	// Hydrate persisted undelivered messages into the socket store on mount
	useEffect(() => {
		if (persistedUndelivered.length === 0) return;

		useChatStore.setState((s) => {
			const existing = s.messages[chatId] ?? [];
			const existingIds = new Set(existing.map((m) => m.id));
			const toHydrate = persistedUndelivered.filter(
				(m) => !existingIds.has(m.id),
			);
			if (toHydrate.length === 0) return s;

			return {
				messages: {
					...s.messages,
					[chatId]: [...toHydrate, ...existing],
				},
			};
		});
	}, [chatId, persistedUndelivered]);

	const { data: messages, isSubscribed, connectionState } =
		chatSocket.useSubscription(
			"conversation",
			chatId,
			useMemo(
				() => (s) => s.messages[chatId] ?? EMPTY_MESSAGES,
				[chatId],
			),
		);

	const send = chatSocket.useSend();

	const undelivered = useMemo(
		() => messages.filter((m) => m.status === "undelivered"),
		[messages],
	);

	// Sync undelivered messages to the zustand persist store
	useEffect(() => {
		setChannelMessages(chatId, undelivered);
	}, [chatId, undelivered, setChannelMessages]);

	const sendMessage = useCallback(
		(text: string) => {
			const id = crypto.randomUUID();
			const newMessage: TChatMessage = {
				id,
				sender: "user",
				content: [{ type: "text", text }],
				status: "pending",
			};

			useChatStore.setState((s) => ({
				messages: {
					...s.messages,
					[chatId]: [...(s.messages[chatId] ?? []), newMessage],
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
				const undeliveredMessage: TChatMessage = {
					...newMessage,
					status: "undelivered",
					undeliveredAt: new Date().toISOString(),
				};

				useChatStore.setState((s) => {
					const existing = s.messages[chatId] ?? [];
					const idx = existing.findIndex((m) => m.id === id);
					if (idx === -1) return s;
					const updated = [...existing];
					updated[idx] = undeliveredMessage;
					return {
						messages: { ...s.messages, [chatId]: updated },
					};
				});

				addMessage(chatId, undeliveredMessage);
			}
		},
		[send, chatId, addMessage],
	);

	const retryUndelivered = useCallback(
		(messageId: string) => {
			const state = useChatStore.getState();
			const msg = (state.messages[chatId] ?? []).find(
				(m) => m.id === messageId && m.status === "undelivered",
			);
			if (!msg) return;

			useChatStore.setState((s) => {
				const existing = s.messages[chatId] ?? [];
				const idx = existing.findIndex((m) => m.id === messageId);
				if (idx === -1) return s;
				const updated = [...existing];
				const { undeliveredAt: _, ...rest } = updated[idx];
				updated[idx] = { ...rest, status: "pending" };
				return {
					messages: { ...s.messages, [chatId]: updated },
				};
			});

			removeMessage(chatId, messageId);

			const sent = send({
				action: "message",
				type: "conversation",
				id: messageId,
				channel: chatId,
				message: msg.content.map((c) => c.text).join(""),
			});

			if (!sent) {
				const undeliveredMessage: TChatMessage = {
					...msg,
					status: "undelivered",
					undeliveredAt: new Date().toISOString(),
				};

				useChatStore.setState((s) => {
					const existing = s.messages[chatId] ?? [];
					const idx = existing.findIndex((m) => m.id === messageId);
					if (idx === -1) return s;
					const updated = [...existing];
					updated[idx] = undeliveredMessage;
					return {
						messages: { ...s.messages, [chatId]: updated },
					};
				});

				addMessage(chatId, undeliveredMessage);
			}
		},
		[send, chatId, addMessage, removeMessage],
	);

	const retryAllUndelivered = useCallback(() => {
		for (const msg of undelivered) {
			retryUndelivered(msg.id);
		}
	}, [undelivered, retryUndelivered]);

	const discardUndelivered = useCallback(
		(messageId: string) => {
			useChatStore.setState((s) => {
				const existing = s.messages[chatId] ?? [];
				return {
					messages: {
						...s.messages,
						[chatId]: existing.filter((m) => m.id !== messageId),
					},
				};
			});
			removeMessage(chatId, messageId);
		},
		[chatId, removeMessage],
	);

	const discardAllUndelivered = useCallback(() => {
		useChatStore.setState((s) => {
			const existing = s.messages[chatId] ?? [];
			return {
				messages: {
					...s.messages,
					[chatId]: existing.filter(
						(m) => m.status !== "undelivered",
					),
				},
			};
		});
		clearChannel(chatId);
	}, [chatId, clearChannel]);

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
