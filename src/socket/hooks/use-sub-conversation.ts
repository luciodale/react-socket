import { useCallback, useEffect, useMemo } from "react";
import { useWebSocketManager } from "../index";
import {
	selectConnectionState,
	selectConversationMessages,
	selectIsSubscribed,
	useSocketStore,
} from "../store";
import type {
	TClientConversationMessage,
	TConnectionState,
} from "../types";

type TUseSubConversationParams = {
	chatId: string;
};

type TUseSubConversationReturn = {
	messages: TClientConversationMessage[];
	sendMessage: (text: string) => void;
	retryMessage: (messageId: string) => void;
	retryAll: () => void;
	isSubscribed: boolean;
	connectionState: TConnectionState;
};

export function useSubConversation({
	chatId,
}: TUseSubConversationParams): TUseSubConversationReturn {
	const manager = useWebSocketManager();

	const messagesSelector = useMemo(
		() => selectConversationMessages(chatId),
		[chatId],
	);
	const subscribedSelector = useMemo(
		() => selectIsSubscribed("conversation", chatId),
		[chatId],
	);

	const messages = useSocketStore(messagesSelector);
	const isSubscribed = useSocketStore(subscribedSelector);
	const connectionState = useSocketStore(selectConnectionState);

	useEffect(() => {
		const key = `conversation:${chatId}`;
		useSocketStore.getState().incrementRefCount(key);
		manager.subscribe("conversation", chatId);
		return () => {
			manager.unsubscribe("conversation", chatId);
			useSocketStore.getState().decrementRefCount(key);
		};
	}, [manager, chatId]);

	const sendMessage = useCallback(
		(text: string) => {
			const id = crypto.randomUUID();
			const store = useSocketStore.getState();

			// Optimistic insert — message appears immediately
			store.addOptimisticMessage(chatId, {
				id,
				sender: "user",
				content: [{ type: "text", text }],
				status: "pending",
			});

			const sent = manager.send({
				action: "message",
				type: "conversation",
				id,
				channel: chatId,
				message: text,
			});

			if (!sent) {
				store.setMessageStatus(chatId, id, "failed");
			}
		},
		[manager, chatId],
	);

	const retryMessage = useCallback(
		(messageId: string) => {
			const store = useSocketStore.getState();
			const channelMessages = store.conversationMessages[chatId] ?? [];
			const msg = channelMessages.find(
				(m) => m.id === messageId && m.status === "failed",
			);
			if (!msg) return;

			store.setMessageStatus(chatId, messageId, "pending");

			const sent = manager.send({
				action: "message",
				type: "conversation",
				id: messageId,
				channel: chatId,
				message: msg.content.map((c) => c.text).join(""),
			});

			if (!sent) {
				store.setMessageStatus(chatId, messageId, "failed");
			}
		},
		[manager, chatId],
	);

	const retryAll = useCallback(() => {
		const store = useSocketStore.getState();
		const channelMessages = store.conversationMessages[chatId] ?? [];
		const failed = channelMessages.filter((m) => m.status === "failed");

		for (const msg of failed) {
			store.setMessageStatus(chatId, msg.id, "pending");

			const sent = manager.send({
				action: "message",
				type: "conversation",
				id: msg.id,
				channel: chatId,
				message: msg.content.map((c) => c.text).join(""),
			});

			if (!sent) {
				store.setMessageStatus(chatId, msg.id, "failed");
			}
		}
	}, [manager, chatId]);

	return {
		messages,
		sendMessage,
		retryMessage,
		retryAll,
		isSubscribed,
		connectionState,
	};
}
