import { create } from "zustand";
import type { TConnectionState } from "../socket/types";
import type { TNotification } from "./types";

export type TMiniSocketStore = {
	connectionState: TConnectionState;
	notifications: TNotification[];
	lastError: { code?: number; message: string } | null;
	// actions
	handleNotification: (notification: TNotification) => void;
	setConnectionState: (state: TConnectionState) => void;
	setLastError: (error: { code?: number; message: string } | null) => void;
	clearNotifications: () => void;
};

export const useMiniSocketStore = create<TMiniSocketStore>()((set) => ({
	connectionState: "disconnected",
	notifications: [],
	lastError: null,

	handleNotification(notification) {
		set((s) => ({
			notifications: [...s.notifications, notification],
		}));
	},

	setConnectionState(state) {
		set({ connectionState: state });
	},

	setLastError(error) {
		set({ lastError: error });
	},

	clearNotifications() {
		set({ notifications: [] });
	},
}));

// ── Selectors ───────────────────────────────────────────────────────

export function selectMiniSocketConnectionState(
	state: TMiniSocketStore,
): TConnectionState {
	return state.connectionState;
}

export function selectNotifications(
	state: TMiniSocketStore,
): TNotification[] {
	return state.notifications;
}

export function selectMiniSocketLastError(
	state: TMiniSocketStore,
): TMiniSocketStore["lastError"] {
	return state.lastError;
}
