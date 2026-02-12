// ── Subscription types (extensible) ─────────────────────────────────

export type TSubscriptionType = "conversation" | "notification";

// ── Ping / Pong ─────────────────────────────────────────────────────

export type TSocketPing = {
	action: "ping";
	timestamp: string;
};

export type TSocketPong = {
	action: "pong";
	timestamp: string;
};

// ── Subscribe / Unsubscribe ─────────────────────────────────────────

export type TSubscribe<T extends TSubscriptionType = TSubscriptionType> = {
	action: "subscribe";
	type: T;
	channel: string;
};

export type TUnsubscribe<T extends TSubscriptionType = TSubscriptionType> = {
	action: "unsubscribe";
	type: T;
	channel: string;
};

export type TSubscribeAck<T extends TSubscriptionType = TSubscriptionType> = {
	action: "subscribe_ack";
	type: T;
	channel: string;
};

export type TUnsubscribeAck<T extends TSubscriptionType = TSubscriptionType> = {
	action: "unsubscribe_ack";
	type: T;
	channel: string;
};

// ── Conversation messages ───────────────────────────────────────────

export type TConversationContentBlock = {
	type: "text";
	text: string;
};

export type TConversationFromClientToServer = {
	action: "message";
	type: "conversation";
	id: string;
	channel: string;
	message: string;
};

export type TConversationEventFromServer = {
	action: "message";
	type: "conversation";
	delivery: "event";
	id: string;
	channel: string;
	sender: string;
	content: TConversationContentBlock[];
};

export type TConversationDumpFromServer = {
	action: "message";
	type: "conversation";
	delivery: "dump";
	channel: string;
	messages: TStoredConversationMessage[];
};

export type TConversationErrorType = "token_expired" | "general_error";

export type TConversationErrorFromServer = {
	action: "message";
	type: "conversation";
	delivery: "error";
	channel: string;
	error: TConversationErrorType;
	message: string;
	messageId?: string;
};

export type TConversationFromServerToClient =
	| TConversationEventFromServer
	| TConversationDumpFromServer
	| TConversationErrorFromServer;

// ── Notification messages ────────────────────────────────────────────

export type TStoredNotification = {
	id: string;
	title: string;
	body: string;
	timestamp: string;
};

export type TNotificationEventFromServer = {
	action: "message";
	type: "notification";
	delivery: "event";
	id: string;
	channel: string;
	title: string;
	body: string;
	timestamp: string;
};

export type TNotificationDumpFromServer = {
	action: "message";
	type: "notification";
	delivery: "dump";
	channel: string;
	notifications: TStoredNotification[];
};

export type TNotificationFromServerToClient =
	| TNotificationEventFromServer
	| TNotificationDumpFromServer;

// ── Stored message shape (used by dump + store) ─────────────────────

export type TStoredConversationMessage = {
	id: string;
	sender: string;
	content: TConversationContentBlock[];
};

// ── Client-side message with delivery status ────────────────────────

export type TMessageStatus = "pending" | "sent" | "failed";

export type TClientConversationMessage = TStoredConversationMessage & {
	status: TMessageStatus;
};

// ── Error envelope ──────────────────────────────────────────────────

export type TSocketError = {
	action: "error";
	code: number;
	message: string;
	channel?: string;
	type?: TSubscriptionType;
	messageId?: string;
};

// ── Union types ─────────────────────────────────────────────────────

export type TSocketMessageFromClientToServer =
	| TSocketPing
	| TSubscribe
	| TUnsubscribe
	| TConversationFromClientToServer;

export type TSocketMessageFromServerToClient =
	| TSocketPong
	| TSubscribeAck
	| TUnsubscribeAck
	| TConversationFromServerToClient
	| TNotificationFromServerToClient
	| TSocketError;

// ── Connection state ────────────────────────────────────────────────

export type TConnectionState =
	| "disconnected"
	| "connecting"
	| "connected"
	| "reconnecting";

// ── Transport interface ─────────────────────────────────────────────

export interface IWebSocketTransport {
	connect(url: string, protocols?: string | string[]): void;
	disconnect(code?: number, reason?: string): void;
	send(data: string): void;
	readonly readyState: number;
	onopen: ((event: Event) => void) | null;
	onclose: ((event: CloseEvent) => void) | null;
	onmessage: ((event: MessageEvent) => void) | null;
	onerror: ((event: Event) => void) | null;
}

// ── Manager config ──────────────────────────────────────────────────

export type TWebSocketManagerConfig = {
	url: string;
	token?: string;
	transport?: IWebSocketTransport;
	pingIntervalMs?: number;
	pongTimeoutMs?: number;
	reconnectMaxAttempts?: number;
	reconnectBaseDelayMs?: number;
	reconnectMaxDelayMs?: number;
	onMessage?: (msg: TSocketMessageFromServerToClient) => void;
	onConnectionStateChange?: (state: TConnectionState) => void;
	onError?: (error: TSocketError) => void;
};

// ── Queue types ─────────────────────────────────────────────────────

export type TQueuedMessage = {
	id: string;
	payload: TSocketMessageFromClientToServer;
	timestamp: number;
};
