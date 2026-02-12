import { create } from "zustand";
import type { TSocketMessageFromClientToServer } from "../socket/types";
import type {
	TInspectorMode,
	TOutgoingMessageEntry,
	TStateSnapshot,
} from "./types";

type TInspectorStore = {
	enabled: boolean;
	panelOpen: boolean;
	mode: TInspectorMode;
	history: TStateSnapshot[];
	outgoingLog: TOutgoingMessageEntry[];
	selectedIndex: number;
	panelHeight: number;
	maxHistory: number;
	// actions
	togglePanel: () => void;
	toggleEnabled: () => void;
	setMode: (mode: TInspectorMode) => void;
	pushSnapshot: (snapshot: TStateSnapshot) => void;
	pushOutgoingMessage: (msg: TSocketMessageFromClientToServer) => void;
	clearOutgoingLog: () => void;
	setSelectedIndex: (index: number) => void;
	setPanelHeight: (height: number) => void;
	clearHistory: () => void;
};

let _nextId = 0;
export function nextSnapshotId(): number {
	return _nextId++;
}

const MIN_PANEL_HEIGHT = 120;
const MAX_PANEL_HEIGHT_RATIO = 0.8;

export { MIN_PANEL_HEIGHT, MAX_PANEL_HEIGHT_RATIO };

export const useInspectorStore = create<TInspectorStore>()((set) => ({
	enabled: true,
	panelOpen: false,
	mode: "live",
	history: [],
	outgoingLog: [],
	selectedIndex: -1,
	panelHeight: Math.round(window.innerHeight * 0.4),
	maxHistory: 500,

	togglePanel() {
		set((s) => ({ panelOpen: !s.panelOpen }));
	},

	toggleEnabled() {
		set((s) => {
			if (s.enabled) {
				return {
					enabled: false,
					history: [],
					outgoingLog: [],
					selectedIndex: -1,
				};
			}
			return { enabled: true };
		});
	},

	pushOutgoingMessage(msg) {
		set((s) => {
			const entry: TOutgoingMessageEntry = {
				id: nextSnapshotId(),
				timestamp: Date.now(),
				message: msg,
			};
			const log =
				s.outgoingLog.length >= s.maxHistory
					? [...s.outgoingLog.slice(1), entry]
					: [...s.outgoingLog, entry];
			return { outgoingLog: log };
		});
	},

	clearOutgoingLog() {
		set({ outgoingLog: [] });
	},

	setMode(mode) {
		set({ mode });
	},

	pushSnapshot(snapshot) {
		set((s) => {
			const history =
				s.history.length >= s.maxHistory
					? [...s.history.slice(1), snapshot]
					: [...s.history, snapshot];
			return { history };
		});
	},

	setSelectedIndex(index) {
		set({ selectedIndex: index });
	},

	setPanelHeight(height) {
		const clamped = Math.max(
			MIN_PANEL_HEIGHT,
			Math.min(height, window.innerHeight * MAX_PANEL_HEIGHT_RATIO),
		);
		set({ panelHeight: clamped });
	},

	clearHistory() {
		set({ history: [], selectedIndex: -1 });
	},
}));
