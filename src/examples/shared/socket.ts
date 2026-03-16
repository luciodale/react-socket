import { createSocket } from "../../socket";
import { chatStoreAdapter } from "./store";
import type { TChatState, TClientMessage, TServerMessage } from "./types";

export const chatSocket = createSocket<
	TServerMessage,
	TClientMessage,
	TChatState
>({
	store: chatStoreAdapter,

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
				for (const [channel, msgs] of Object.entries(s.messages)) {
					const idx = msgs.findIndex((m) => m.id === id);
					if (idx !== -1) {
						const updated = [...msgs];
						updated[idx] = {
							...updated[idx],
							status: "undelivered",
							undeliveredAt: new Date().toISOString(),
						};
						return { messages: { ...s.messages, [channel]: updated } };
					}
				}
				return s;
			});
		}
	},

	onMessage(msg, { set }) {
		if (msg.action !== "message" || msg.type !== "conversation") return;

		if (msg.delivery === "dump") {
			set((s) => ({
				messages: {
					...s.messages,
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
				const existing = s.messages[msg.channel] ?? [];
				const idx = existing.findIndex((m) => m.id === msg.id);

				if (idx !== -1) {
					const updated = [...existing];
					const { undeliveredAt: _, ...rest } = updated[idx];
					updated[idx] = { ...rest, status: "sent" };
					return { messages: { ...s.messages, [msg.channel]: updated } };
				}

				return {
					messages: {
						...s.messages,
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
				const existing = s.messages[msg.channel] ?? [];
				const idx = existing.findIndex((m) => m.id === msg.messageId);
				if (idx === -1) return s;
				const updated = [...existing];
				updated[idx] = {
					...updated[idx],
					status: "undelivered",
					undeliveredAt: new Date().toISOString(),
				};
				return { messages: { ...s.messages, [msg.channel]: updated } };
			});
		}
	},

	onChannelCleanup(type, channel, { set }) {
		if (type === "conversation") {
			set((s) => {
				const { [channel]: _, ...rest } = s.messages;
				return { messages: rest };
			});
		}
	},
});
