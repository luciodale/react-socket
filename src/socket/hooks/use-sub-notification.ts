import { useEffect, useMemo } from "react";
import { useWebSocketManager } from "../index";
import {
	selectConnectionState,
	selectIsSubscribed,
	selectNotificationMessages,
	useSocketStore,
} from "../store";
import type { TConnectionState, TStoredNotification } from "../types";

type TUseSubNotificationParams = {
	channel: string;
};

type TUseSubNotificationReturn = {
	notifications: TStoredNotification[];
	isSubscribed: boolean;
	connectionState: TConnectionState;
};

export function useSubNotification({
	channel,
}: TUseSubNotificationParams): TUseSubNotificationReturn {
	const manager = useWebSocketManager();

	const notificationsSelector = useMemo(
		() => selectNotificationMessages(channel),
		[channel],
	);
	const subscribedSelector = useMemo(
		() => selectIsSubscribed("notification", channel),
		[channel],
	);

	const notifications = useSocketStore(notificationsSelector);
	const isSubscribed = useSocketStore(subscribedSelector);
	const connectionState = useSocketStore(selectConnectionState);

	useEffect(() => {
		const key = `notification:${channel}`;
		useSocketStore.getState().incrementRefCount(key);
		manager.subscribe("notification", channel);
		return () => {
			manager.unsubscribe("notification", channel);
			useSocketStore.getState().decrementRefCount(key);
		};
	}, [manager, channel]);

	return {
		notifications,
		isSubscribed,
		connectionState,
	};
}
