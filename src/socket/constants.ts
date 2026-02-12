export const WS_URL = "ws://localhost:3001/ws";

export const PING_INTERVAL_MS = 30_000;
export const PONG_TIMEOUT_MS = 10_000;

export const RECONNECT_MAX_ATTEMPTS = 5;
export const RECONNECT_BASE_DELAY_MS = 1_000;
export const RECONNECT_MAX_DELAY_MS = 5_000;

export const QUEUE_STORAGE_KEY = "ws_outgoing_queue";
export const QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1_000; // 24 hours

export const FAILED_MESSAGES_STORAGE_KEY = "ws_failed_messages";
