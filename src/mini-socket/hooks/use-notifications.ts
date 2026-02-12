import {
	selectMiniSocketConnectionState,
	selectNotifications,
	useMiniSocketStore,
} from "../store";

export function useNotifications() {
	const notifications = useMiniSocketStore(selectNotifications);
	const connectionState = useMiniSocketStore(selectMiniSocketConnectionState);
	return { notifications, connectionState };
}
