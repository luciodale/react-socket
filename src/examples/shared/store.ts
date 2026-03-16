import { create } from "zustand";
import { createZustandAdapter } from "../../adapters/zustand";
import type { TChatState } from "./types";

export const useChatStore = create<TChatState>()(() => ({
	messages: {},
}));

export const chatStoreAdapter = createZustandAdapter(useChatStore);
