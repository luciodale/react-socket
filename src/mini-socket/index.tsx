import type { ReactNode } from "react";
import { createContext, createElement, useContext, useEffect, useRef } from "react";
import { MiniSocketManager } from "./manager";
import { useMiniSocketStore } from "./store";
import type { TMiniSocketConfig } from "./types";

// ── Context ─────────────────────────────────────────────────────────

const MiniSocketManagerContext = createContext<MiniSocketManager | null>(null);

export function useMiniSocketManager(): MiniSocketManager {
	const manager = useContext(MiniSocketManagerContext);
	if (!manager) {
		throw new Error(
			"useMiniSocketManager must be used within <MiniSocketProvider>",
		);
	}
	return manager;
}

// ── Provider ────────────────────────────────────────────────────────

type TMiniSocketProviderProps = {
	url: string;
	token?: string;
	config?: Partial<TMiniSocketConfig>;
	children: ReactNode;
};

export function MiniSocketProvider({
	url,
	token,
	config,
	children,
}: TMiniSocketProviderProps) {
	const store = useMiniSocketStore;

	const managerRef = useRef<MiniSocketManager | null>(null);
	if (!managerRef.current) {
		managerRef.current = new MiniSocketManager({
			url,
			token,
			...config,
			onMessage: (msg) => {
				store.getState().handleNotification(msg);
				config?.onMessage?.(msg);
			},
			onConnectionStateChange: (state) => {
				store.getState().setConnectionState(state);
				config?.onConnectionStateChange?.(state);
			},
			onError: (error) => {
				store.getState().setLastError({
					code: error.code,
					message: error.message,
				});
				config?.onError?.(error);
			},
		});
	}

	useEffect(() => {
		const manager = managerRef.current;
		if (!manager) return;
		manager.connect();
		return () => {
			manager.dispose();
		};
	}, []);

	return createElement(
		MiniSocketManagerContext.Provider,
		{ value: managerRef.current },
		children,
	);
}

// ── Barrel exports ──────────────────────────────────────────────────

export { MiniSocketManager } from "./manager";
export { useNotifications } from "./hooks/use-notifications";
export {
	selectMiniSocketConnectionState,
	selectMiniSocketLastError,
	selectNotifications,
	useMiniSocketStore,
} from "./store";
export type { TMiniSocketConfig, TNotification } from "./types";
