import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TChatMessage } from "../shared/types";

type TUndeliveredState = {
	channels: Record<string, TChatMessage[]>;
	addMessage: (channel: string, msg: TChatMessage) => void;
	removeMessage: (channel: string, messageId: string) => void;
	setChannelMessages: (channel: string, messages: TChatMessage[]) => void;
	clearChannel: (channel: string) => void;
	clearAll: () => void;
};

export const useUndeliveredStore = create<TUndeliveredState>()(
	persist(
		(set) => ({
			channels: {},

			addMessage(channel, msg) {
				set((s) => {
					const existing = s.channels[channel] ?? [];
					if (existing.some((m) => m.id === msg.id)) return s;
					return {
						channels: {
							...s.channels,
							[channel]: [...existing, msg],
						},
					};
				});
			},

			removeMessage(channel, messageId) {
				set((s) => {
					const existing = s.channels[channel] ?? [];
					const filtered = existing.filter(
						(m) => m.id !== messageId,
					);
					const { [channel]: _, ...rest } = s.channels;
					return {
						channels:
							filtered.length > 0
								? { ...rest, [channel]: filtered }
								: rest,
					};
				});
			},

			setChannelMessages(channel, messages) {
				set((s) => {
					if (messages.length === 0) {
						const { [channel]: _, ...rest } = s.channels;
						return { channels: rest };
					}
					return {
						channels: { ...s.channels, [channel]: messages },
					};
				});
			},

			clearChannel(channel) {
				set((s) => {
					const { [channel]: _, ...rest } = s.channels;
					return { channels: rest };
				});
			},

			clearAll() {
				set({ channels: {} });
			},
		}),
		{ name: "chat-undelivered" },
	),
);
