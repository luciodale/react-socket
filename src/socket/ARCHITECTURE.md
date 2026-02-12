# Socket Architecture

## Overview

WebSocket abstraction for React providing:

- Persistent connections with automatic reconnection
- Ref-counted subscriptions (many components, one wire subscription)
- Outgoing message queue persisted to localStorage
- Failed message recovery persisted to localStorage
- In-flight tracking with auto re-queue on disconnect
- Zustand store for reactive UI via selectors

## File Map

```
socket/
  types.ts              Type system (messages, config, transport)
  constants.ts          Timeouts, URLs, queue config
  transport.ts          BrowserWebSocketTransport (native WS wrapper)
  manager.ts            WebSocketManager — connection, subscriptions, queue, in-flight
  queue.ts              localStorage-backed outgoing message queue
  failed-messages.ts    localStorage-backed failed message persistence
  store.ts              Zustand store + selectors
  index.ts              WebSocketProvider, context, barrel exports
  hooks/
    use-sub-conversation.ts   Subscribe to conversation channel
    use-sub-notification.ts   Subscribe to notification channel
    use-connection-status.ts  Derived connection status for UI
    connection-status.tsx     Animated status bar component
```

## Connection Lifecycle

### State Machine

```
disconnected ──► connecting ──► connected
      ▲                              │
      │                              │ (abnormal close)
      │                              ▼
      └───────────── reconnecting ◄──┘
                     (max attempts → disconnected)
```

### Connect Flow

1. `connect()` → state = `connecting`
2. Transport fires `onopen` → `handleOpen()`
3. `handleOpen`: state = `connected`, reset reconnect counter, start ping, restore subscriptions, drain queue

### Disconnect / Dispose

- **Intentional** (`disconnect()`): code 1000, state = `disconnected`, no reconnect
- **Abnormal**: `handleClose` → `scheduleReconnect`
- **Dispose**: intentional close + clear all maps/sets/listeners

### Reconnection

- Exponential backoff: `baseDelay * 2^attempt + jitter(0–1000ms)`, capped at 30s
- Max 10 attempts
- Browser `online` → reset counter, reconnect immediately
- Browser `offline` → state = `reconnecting`, timers cleared

## Subscription Model

### Ref Counting

Multiple components can subscribe to the same `type:channel`. Tracked in two places:

1. **Manager** (`subscriptionRefCounts: Map`) — controls wire subscribe/unsubscribe. Only sends on 0→1 and 1→0 transitions.
2. **Store** (`subscriptionRefCounts: Record`) — mirrors count for UI. On decrement to 0, clears channel messages from memory.

### Pending Subscriptions

After sending `subscribe`, the key enters `pendingSubscriptions: Set`. Removed on `subscribe_ack`. Prevents duplicate subscribes during reconnection.

### Wire Protocol

```
Client → Server:  { action: "subscribe",     type, channel }
Server → Client:  { action: "subscribe_ack",  type, channel }
Server → Client:  { action: "message", type, delivery: "dump", channel, messages: [...] }
```

## Message Flow

### Client → Server (Optimistic)

```
sendMessage("hello")
  ├─ Generate UUID
  ├─ Insert into store with status: "pending"
  ├─ manager.send(...)
  │     ├─ Not connected?    → enqueue to localStorage
  │     ├─ Not subscribed?   → fire onError(4001)
  │     ├─ rawSend succeeds? → add to inFlightMessages
  │     └─ rawSend throws?   → enqueue to localStorage
  └─ Message visible in UI immediately
```

### Server → Client

```
Server sends JSON frame
  ├─ pong              → clear pong timeout
  ├─ subscribe_ack     → remove from pendingSubscriptions
  ├─ message (conversation/notification, event)
  │     ├─ ID matches optimistic? → status = "sent", clear failed messages from localStorage
  │     └─ New message?           → append with status "sent"
  │     └─ Remove from inFlightMessages
  ├─ message (conversation, dump)
  │     → Replace channel messages (status "sent")
  │     → Append failed messages from localStorage (deduplicated)
  ├─ message (conversation, error)
  │     ├─ Mark message as "failed" in store
  │     ├─ Persist to failed-messages localStorage
  │     ├─ Remove from inFlightMessages (NO re-queue)
  │     └─ Set lastError
  └─ error (protocol)
        → Re-queue from inFlightMessages
        → Set lastError
```

## Message Status Tracking

```
                  ┌─── echo received ──→ "sent"
"pending" ───────┤
                  └─── server error ───→ "failed"
                                            │
                                  retryMessage() / retryAll()
                                            ▼
                                        "pending" (re-sent)
```

### Two Failure Categories

| Category | Re-queue? | Who retries? |
|---|---|---|
| **Infrastructure** (disconnect, transport error) | Auto-requeue to localStorage queue | Manager on reconnect |
| **Business** (server rejects: `token_expired`, `general_error`) | NO — persisted to failed-messages localStorage | App via `retryMessage()` / `retryAll()` |

## Failed Message Persistence

`failed-messages.ts` provides localStorage storage (`ws_failed_messages`) separate from the outgoing queue.

| Function | Description |
|---|---|
| `loadAllFailedMessages()` | Read `Record<channel, message[]>` |
| `getChannelFailedMessages(channel)` | Get single channel's failed list |
| `setChannelFailedMessages(channel, msgs)` | Set channel's list (deletes key if empty) |
| `clearChannelFailedMessages(channel)` | Delete channel entry |
| `clearAllFailedMessages()` | Clear everything |

**Lifecycle:**
1. Server error with `messageId` → store marks "failed" + persists to localStorage
2. On reconnect dump → failed messages appended to channel (deduplicated by ID)
3. Cleared when: user's new message succeeds (echo received) OR failed message retried successfully

## In-Flight Message Tracking

1. **Send** — `rawSend` succeeds → store in `inFlightMessages: Map<id, msg>`
2. **Ack** — Server echoes same `id` → remove from in-flight, status = `"sent"`
3. **Business Error** — `delivery: "error"` with `messageId` → remove (NO re-queue), status = `"failed"`
4. **Protocol Error** — `action: "error"` with `messageId` → remove, re-queue to localStorage
5. **Disconnect** — `requeueInFlightMessages()` moves ALL in-flight to queue

## Queue System

localStorage under key `ws_outgoing_queue`. Array of `{ id, payload, timestamp }`.

| Function | Description |
|---|---|
| `loadQueue()` | Read from localStorage |
| `saveQueue(queue)` | Write to localStorage |
| `enqueue(queue, payload)` | Append with UUID + timestamp |
| `dequeue(queue, id)` | Remove by ID |
| `pruneStaleMessages(queue, maxAgeMs)` | Filter messages older than 24h |
| `removeByChannelAndType(queue, channel, type)` | Purge matching messages |
| `drainQueue(queue, sendFn)` | Send each in order; stop on first failure |

## Store

### Shape

```typescript
{
  connectionState: TConnectionState
  hasConnected: boolean
  conversationMessages: Record<string, TClientConversationMessage[]>
  notificationMessages: Record<string, TStoredNotification[]>
  subscriptionRefCounts: Record<string, number>
  pendingQueueLength: number
  lastError: { code?; message; channel?; error?; messageId? } | null
}
```

### Key Behaviors

- **Conversation dump**: replace channel, append failed messages from localStorage (deduplicated)
- **Conversation event**: match by ID → update to "sent" + clear failed localStorage; else append new
- **Conversation error**: mark "failed" + persist to failed-messages localStorage
- **Notification dump/event**: similar routing, no retry logic
- **`decrementRefCount`**: clears channel messages when count hits 0

### Selectors

All return stable references (module-level empty arrays for unknown channels).

- `selectConversationMessages(channel)` → `TClientConversationMessage[]`
- `selectNotificationMessages(channel)` → `TStoredNotification[]`
- `selectIsSubscribed(type, channel)` → `boolean`
- `selectConnectionState` / `selectLastError` → direct selectors

## Hooks

### `useSubConversation({ chatId })`

**Returns:** `{ messages, sendMessage, retryMessage, retryAll, isSubscribed, connectionState }`

- Mount: increment ref count, `manager.subscribe("conversation", chatId)`
- Unmount: unsubscribe, decrement ref count
- `sendMessage(text)`: UUID → optimistic insert → `manager.send`
- `retryMessage(id)`: reset to "pending", re-send same ID
- `retryAll()`: retry all "failed" in channel

### `useSubNotification({ channel })`

**Returns:** `{ notifications, isSubscribed, connectionState }`

- Same lifecycle as conversation (subscribe/unsubscribe on mount/unmount)
- Read-only — no send or retry

### `useConnectionStatus()`

**Returns:** `{ visible, state?, message? }`

- Hidden until first connection (`hasConnected`)
- Auto-hides 3s after reconnecting to "connected"

## Transport

```typescript
interface IWebSocketTransport {
  connect(url: string): void
  disconnect(code?: number, reason?: string): void
  send(data: string): void
  readonly readyState: number
  onopen / onclose / onmessage / onerror callbacks
}
```

- **Production**: `BrowserWebSocketTransport` (native WebSocket wrapper)
- **Tests**: `MockTransport` (in-memory, synchronous)

## Provider

`WebSocketProvider` creates a single `WebSocketManager` via `useRef` and wires callbacks:

```
manager.onMessage         → store.handleServerMessage + config.onMessage
manager.onConnectionState → store.setConnectionState  + config.onConnectionStateChange
manager.onError           → store.setLastError        + config.onError
```

Mount: `manager.connect()`. Unmount: `manager.dispose()`.

## Ping / Pong

- Client sends `{ action: "ping", timestamp }` every 30s
- Pong timeout: 10s → force disconnect (code 4000) → reconnect
- Pong received → clear timeout

## Error Codes

| Code | Source | Meaning |
|---|---|---|
| 1000 | Transport | Normal close (no reconnect) |
| 4000 | Client | Pong timeout |
| 4001 | Client | Send to unsubscribed channel |
| 4002 | Client | Max reconnect attempts |

## Data Flow

```
┌─────────────────────────────────────────────────┐
│               React Components                   │
│  useSubConversation · useSubNotification         │
│  useConnectionStatus                             │
└──────────────────┬──────────────────────────────┘
                   │ selectors
                   ▼
┌─────────────────────────────────────────────────┐
│              Zustand Store                        │
│  connectionState · conversationMessages          │
│  notificationMessages · refCounts                │
│  pendingQueueLen · lastError · hasConnected       │
└──────────────────┬──────────────────────────────┘
                   │ callbacks
                   ▼
┌─────────────────────────────────────────────────┐
│         WebSocketManager (singleton)              │
│  subscriptionRefCounts · pendingSubscriptions     │
│  inFlightMessages · queue · timers               │
└──────────────────┬──────────────────────────────┘
                   │ transport
                   ▼
┌─────────────────────────────────────────────────┐
│          IWebSocketTransport                      │
│    BrowserWebSocketTransport | MockTransport      │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
              Server / MSW

Persistence:
  localStorage ← queue.ts (ws_outgoing_queue)
  localStorage ← failed-messages.ts (ws_failed_messages)
```
