export const PING_INTERVAL_MS = 30_000;
export const PONG_TIMEOUT_MS = 10_000;

// Reconnection: bounded by default so `"disconnected"` stays reachable as
// a terminal state. Roughly 3 minutes of total retry time with the
// default base/cap (1s base, exp backoff capped at 30s). For long-lived
// apps that should keep retrying forever (and let the user surface a
// stale-connection banner instead of a permanent disconnect), pass
// `reconnectMaxAttempts: Number.POSITIVE_INFINITY` opt-in.
export const RECONNECT_MAX_ATTEMPTS = 10;
export const RECONNECT_BASE_DELAY_MS = 1_000;
export const RECONNECT_MAX_DELAY_MS = 30_000;
