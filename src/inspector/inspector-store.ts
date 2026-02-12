import { create } from "zustand";
import type { TInspectorMode, TStateSnapshot } from "./types";

type TInspectorStore = {
	enabled: boolean;
	panelOpen: boolean;
	mode: TInspectorMode;
	history: TStateSnapshot[];
	selectedIndex: number;
	panelHeight: number;
	maxHistory: number;
	// actions
	togglePanel: () => void;
	toggleEnabled: () => void;
	setMode: (mode: TInspectorMode) => void;
	pushSnapshot: (snapshot: TStateSnapshot) => void;
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
	selectedIndex: -1,
	panelHeight: Math.round(window.innerHeight * 0.4),
	maxHistory: 500,

	togglePanel() {
		set((s) => ({ panelOpen: !s.panelOpen }));
	},

	toggleEnabled() {
		set((s) => {
			if (s.enabled) {
				return { enabled: false, history: [], selectedIndex: -1 };
			}
			return { enabled: true };
		});
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
