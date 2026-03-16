import { useCallback, useMemo } from "react";
import { chatSocket } from "../../shared/socket";
import { useChatStore } from "../../shared/store";
import type { TChatMessage } from "../../shared/types";

const EMPTY_MESSAGES: TChatMessage[] = [];

export function useBasicChat(chatId: string) {
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

	const sendMessage = useCallback(
		(text: string) => {
			const id = crypto.randomUUID();

			useChatStore.setState((s) => ({
				messages: {
					...s.messages,
					[chatId]: [
						...(s.messages[chatId] ?? []),
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
				useChatStore.setState((s) => {
					const existing = s.messages[chatId] ?? [];
					const idx = existing.findIndex((m) => m.id === id);
					if (idx === -1) return s;
					const updated = [...existing];
					updated[idx] = {
						...updated[idx],
						status: "undelivered",
						undeliveredAt: new Date().toISOString(),
					};
					return {
						messages: { ...s.messages, [chatId]: updated },
					};
				});
			}
		},
		[send, chatId],
	);

	return { messages, sendMessage, isSubscribed, connectionState };
}
