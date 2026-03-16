# react-socket

WebSocket client for React. Persistent connections, ref-counted subscriptions, optimistic messaging, user-controlled retry for undelivered messages. Each concern is a composable layer — use what you need.

## Setup

### Minimal (no persistence)

Messages that fail to send are marked `"undelivered"` in memory only. Lost on refresh.

```tsx
import { WebSocketProvider } from "./socket";

function App() {
  return (
    <WebSocketProvider url="ws://localhost:3001/ws" token={authToken}>
      <Chat />
    </WebSocketProvider>
  );
}
```

### With persistence (localStorage)

Undelivered messages survive page refreshes and reappear after a dump.

```tsx
import { WebSocketProvider, createLocalStorage } from "./socket";

const storage = createLocalStorage();

function App() {
  return (
    <WebSocketProvider url="ws://localhost:3001/ws" token={authToken} storage={storage}>
      <Chat />
    </WebSocketProvider>
  );
}
```

### With a custom storage backend (Capacitor, IndexedDB, etc.)

Implement `IStorage` — three async methods — and pass it in.

```tsx
import { Preferences } from "@capacitor/preferences";
import type { IStorage } from "./socket";

const capacitorStorage: IStorage = {
  async getItem(key) {
    const { value } = await Preferences.get({ key });
    return value;
  },
  async setItem(key, value) {
    await Preferences.set({ key, value });
  },
  async removeItem(key) {
    await Preferences.remove({ key });
  },
};

function App() {
  return (
    <WebSocketProvider url="ws://..." token={authToken} storage={capacitorStorage}>
      <Chat />
    </WebSocketProvider>
  );
}
```

### Overriding defaults

Reconnect timing, ping interval, and other manager settings are configurable via `config`:

```tsx
<WebSocketProvider
  url="ws://..."
  token={authToken}
  storage={createLocalStorage()}
  config={{
    pingIntervalMs: 15_000,
    pongTimeoutMs: 5_000,
    reconnectMaxAttempts: 10,
    reconnectBaseDelayMs: 500,
    reconnectMaxDelayMs: 30_000,
    onMessage: (msg) => console.log("raw message", msg),
    onConnectionStateChange: (state) => console.log("state", state),
    onError: (err) => console.error("socket error", err),
  }}
  onConnectionError={(error) => {
    // connection-level errors (max reconnects, unsubscribed channel, etc.)
    console.error("connection error", error);
  }}
>
```

## Hooks

### `useSubConversation({ chatId })`

Subscribe to a conversation channel. Ref-counted — multiple components can subscribe to the same channel, only one wire subscription is created.

```tsx
function Chat({ chatId }: { chatId: string }) {
  const {
    messages,              // TClientConversationMessage[] — all messages (pending/sent/undelivered)
    sendMessage,           // (text: string) => void — optimistic insert + send
    undelivered,           // TClientConversationMessage[] — convenience: messages with status "undelivered"
    retryUndelivered,      // (messageId: string) => void — retry one undelivered message
    retryAllUndelivered,   // () => void — retry all undelivered in channel
    discardUndelivered,    // (messageId: string) => void — remove one undelivered from messages
    discardAllUndelivered, // () => void — remove all undelivered from messages
    isSubscribed,          // boolean — true after subscribe_ack
    connectionState,       // "disconnected" | "connecting" | "connected" | "reconnecting"
  } = useSubConversation({ chatId });

  return (
    <div>
      {messages.map((msg) => (
        <div key={msg.id}>
          <span>{msg.content.map((c) => c.text).join("")}</span>
          <span>{msg.status}</span>
        </div>
      ))}

      {undelivered.length > 0 && (
        <div>
          <p>{undelivered.length} undelivered</p>
          {undelivered.map((msg) => (
            <div key={msg.id}>
              <span>{msg.content.map((c) => c.text).join("")}</span>
              <button onClick={() => retryUndelivered(msg.id)}>Retry</button>
              <button onClick={() => discardUndelivered(msg.id)}>Discard</button>
            </div>
          ))}
          <button onClick={retryAllUndelivered}>Retry All</button>
          <button onClick={discardAllUndelivered}>Discard All</button>
        </div>
      )}

      <button onClick={() => sendMessage("hello")}>Send</button>
    </div>
  );
}
```

#### Message status lifecycle

```
                 echo received → "sent"
"pending" ──────
                 send failure  → "undelivered"
                 server error  → "undelivered"
                                    │
                      retryUndelivered(messageId)
                                    ▼
                                "pending" (re-sent)
                                    │
                      discardUndelivered(messageId)
                                    ▼
                              removed from messages
```

No auto-retry. No auto-drain on reconnect. The user always decides what happens to undelivered messages.

### `useSubNotification({ channel })`

Subscribe to a notification channel. Read-only — no send or retry.

```tsx
function Alerts({ channel }: { channel: string }) {
  const {
    notifications,   // TStoredNotification[] — reactive
    isSubscribed,    // boolean
    connectionState, // TConnectionState
  } = useSubNotification({ channel });

  return (
    <ul>
      {notifications.map((n) => (
        <li key={n.id}>{n.title}: {n.body}</li>
      ))}
    </ul>
  );
}
```

### `useConnectionStatus()`

Derived connection state for banners/toasts. Hidden until first disconnection. Auto-hides 3s after reconnecting.

```tsx
function StatusBanner() {
  const status = useConnectionStatus();

  if (!status.visible) return null;

  return <div className={status.state}>{status.message}</div>;
}
```

Or use the built-in animated banner:

```tsx
import { ConnectionStatus } from "./socket";

function App() {
  return (
    <>
      <ConnectionStatus />
      <Chat />
    </>
  );
}
```

### `useSocketStore`

Direct Zustand store access for advanced use cases:

```tsx
import { useSocketStore, selectConnectionState } from "./socket";

function CustomComponent() {
  const connectionState = useSocketStore(selectConnectionState);
  // ...
}
```

Available selectors: `selectConversationMessages(channel)`, `selectNotificationMessages(channel)`, `selectIsSubscribed(type, channel)`, `selectConnectionState`, `selectHasDisconnected`.

## Architecture

### Layers

```
┌──────────────────────────────────────────────────┐
│                React Hooks                        │
│  useSubConversation · useSubNotification         │
│  useConnectionStatus                              │
├──────────────────────────────────────────────────┤
│                Zustand Store                      │
│  pure reactive state — no side effects            │
├──────────────────────────────────────────────────┤
│         UndeliveredSync (opt-in)                  │
│  persists undelivered messages across refresh     │
├──────────────────────────────────────────────────┤
│             IStorage (pluggable)                  │
│  localStorage · Capacitor Preferences · custom    │
├──────────────────────────────────────────────────┤
│              WebSocketManager                     │
│  connection lifecycle · ping/pong · subscriptions │
│  in-flight tracking · raw send/receive            │
├──────────────────────────────────────────────────┤
│             IWebSocketTransport                   │
│  BrowserWebSocketTransport · MockTransport        │
└──────────────────────────────────────────────────┘
```

Each layer composes on top of the one below. The provider wires them together.

### File map

```
socket/
  types.ts              Type system (messages, config, transport)
  constants.ts          Timeouts, URLs, storage keys
  storage.ts            IStorage interface + createLocalStorage()
  transport.ts          BrowserWebSocketTransport (native WS wrapper)
  manager.ts            WebSocketManager — connection, subscriptions, in-flight
  undelivered-sync.ts   createUndeliveredSync() — persistence for undelivered messages
  store.ts              Zustand store + selectors
  index.ts              WebSocketProvider, context, barrel exports
  hooks/
    use-sub-conversation.ts   Subscribe + send + retry/discard undelivered
    use-sub-notification.ts   Subscribe (read-only)
    use-connection-status.ts  Derived status for UI
    connection-status.tsx     Animated status bar component
```

### Connection lifecycle

```
disconnected ──► connecting ──► connected
      ▲                              │
      │                         (abnormal close)
      │                              ▼
      └──────── reconnecting ◄───────┘
                (max attempts → disconnected)
```

1. `connect()` → state = `connecting`
2. Transport fires `onopen` → state = `connected`, restore subscriptions, fire `onReady`
3. Abnormal close → state = `reconnecting`, exponential backoff
4. `disconnect()` / `dispose()` → state = `disconnected`, no reconnect

Reconnect: `baseDelay * 2^attempt + jitter(0–1000ms)`, capped at `reconnectMaxDelayMs`. Browser `online` event resets the counter.

### Subscription model

Ref-counted. Multiple components subscribe to the same `type:channel` — only one wire message is sent on the 0→1 transition, one unsubscribe on the 1→0 transition. Store clears channel messages when refcount hits 0.

### Message flow

**Client → Server:**

```
sendMessage("hello")
  ├─ Generate UUID
  ├─ Optimistic insert into store (status: "pending")
  ├─ manager.send(msg)
  │    ├─ Connected + subscribed → rawSend → track in-flight
  │    ├─ Not connected → return false
  │    └─ Not subscribed → fire error(4001), return false
  ├─ send returned false?
  │    └─ Mark "undelivered" (user decides when to retry)
  └─ Message visible in UI immediately
```

**Server → Client:**

```
Server sends JSON frame
  ├─ pong              → clear pong timeout
  ├─ subscribe_ack     → remove from pending subscriptions
  ├─ conversation event
  │    ├─ ID matches optimistic → status = "sent"
  │    └─ New message → append with status "sent"
  ├─ conversation dump
  │    → Replace channel with dump messages (status "sent")
  │    → Append persisted undelivered messages (deduplicated)
  ├─ conversation error
  │    → Mark message "undelivered", persist to undelivered-sync
  └─ protocol error
       → Mark original message "undelivered" via onInFlightDrop
```

### Error handling

| Error type | Where it surfaces | User handles it via |
|---|---|---|
| Message delivery (offline, server rejection) | `undelivered` array on the hook | `retryUndelivered()` / `discardUndelivered()` |
| Connection (max reconnects, protocol) | `onConnectionError` callback on provider | User-provided callback |

No global `lastError`. Each error surfaces where the user has context to act on it.

### Manager callbacks

The provider wires these when composing the layers:

| Callback | When | Provider action |
|---|---|---|
| `onMessage` | Server message received | Route to store |
| `onConnectionStateChange` | State transition | Update store |
| `onError` | Protocol/subscription error | Fire `onConnectionError` for connection-level errors |
| `onReady` | Connected + subscriptions restored | Forward to user config |
| `onInFlightDrop` | Disconnect or protocol error | Mark messages "undelivered" in store |

### Ping / Pong

Client sends `{ action: "ping", timestamp }` every `pingIntervalMs` (default 30s). If no `pong` within `pongTimeoutMs` (default 10s), force disconnect (code 4000) and reconnect.

### Error codes

| Code | Source | Meaning |
|---|---|---|
| 1000 | Transport | Normal close (no reconnect) |
| 4000 | Client | Pong timeout |
| 4001 | Client | Send to unsubscribed channel |
| 4002 | Client | Max reconnect attempts reached |

## Writing a custom storage adapter

Any object implementing `IStorage` works. The interface is async to support native storage APIs.

```typescript
interface IStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
```

The undelivered-sync module calls `init()` on mount, which reads from storage once. After that, all reads come from an in-memory cache. Writes are fire-and-forget (async, non-blocking).

### Built-in: localStorage

```typescript
import { createLocalStorage } from "./socket";
const storage = createLocalStorage();
```

### Example: Capacitor Preferences

```typescript
import { Preferences } from "@capacitor/preferences";
import type { IStorage } from "./socket";

const capacitorStorage: IStorage = {
  async getItem(key) {
    const { value } = await Preferences.get({ key });
    return value;
  },
  async setItem(key, value) {
    await Preferences.set({ key, value });
  },
  async removeItem(key) {
    await Preferences.remove({ key });
  },
};
```

### Example: IndexedDB (via idb-keyval)

```typescript
import { get, set, del } from "idb-keyval";
import type { IStorage } from "./socket";

const idbStorage: IStorage = {
  async getItem(key) {
    return (await get(key)) ?? null;
  },
  async setItem(key, value) {
    await set(key, value);
  },
  async removeItem(key) {
    await del(key);
  },
};
```

### Example: In-memory (testing, ephemeral sessions)

```typescript
import type { IStorage } from "./socket";

function createMemoryStorage(): IStorage {
  const store = new Map<string, string>();
  return {
    async getItem(key) { return store.get(key) ?? null; },
    async setItem(key, value) { store.set(key, value); },
    async removeItem(key) { store.delete(key); },
  };
}
```

## Using the modules standalone

The composable modules can be used outside of the React provider for advanced scenarios (e.g. in a service worker, in tests, or with a different UI framework).

### Undelivered sync

```typescript
import { createUndeliveredSync, createLocalStorage } from "./socket";

const sync = createUndeliveredSync({
  storage: createLocalStorage(),
  storageKey: "my_undelivered",  // default: "ws_undelivered_messages"
});

await sync.init();
sync.addMessage("ch1", undeliveredMsg);
sync.getChannelMessages("ch1");
sync.removeMessage("ch1", "msg-id");
sync.clearChannel("ch1");
sync.clearAll();
```

## Wire protocol

### Client → Server

| Action | Shape |
|---|---|
| `ping` | `{ action: "ping", timestamp }` |
| `subscribe` | `{ action: "subscribe", type, channel }` |
| `unsubscribe` | `{ action: "unsubscribe", type, channel }` |
| `message` | `{ action: "message", type: "conversation", id, channel, message }` |

### Server → Client

| Action | Shape |
|---|---|
| `pong` | `{ action: "pong", timestamp }` |
| `subscribe_ack` | `{ action: "subscribe_ack", type, channel }` |
| `unsubscribe_ack` | `{ action: "unsubscribe_ack", type, channel }` |
| Conversation event | `{ action: "message", type: "conversation", delivery: "event", id, channel, sender, content }` |
| Conversation dump | `{ action: "message", type: "conversation", delivery: "dump", channel, messages }` |
| Conversation error | `{ action: "message", type: "conversation", delivery: "error", channel, error, message, messageId? }` |
| Notification event | `{ action: "message", type: "notification", delivery: "event", id, channel, title, body, timestamp }` |
| Notification dump | `{ action: "message", type: "notification", delivery: "dump", channel, notifications }` |
| Protocol error | `{ action: "error", code, message, channel?, messageId? }` |
