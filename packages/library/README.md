# @luciodale/react-socket

Lightweight WebSocket manager for React with automatic reconnection, ref-counted subscriptions, in-flight message tracking, and a built-in dev inspector.

## Install

```bash
npm install @luciodale/react-socket
```

## Quick start

```tsx
import { WebSocketManager, useConnectionState } from "@luciodale/react-socket";

type ClientMsg = { action: string; channel?: string; text?: string };
type ServerMsg = { type: string; data: unknown };

const manager = new WebSocketManager<ClientMsg, ServerMsg>({
  url: "wss://api.example.com/ws",
  serialize: (msg) => JSON.stringify(msg),
  deserialize: (raw) => JSON.parse(raw),
  onMessageReceived: (msg) => console.log("Received:", msg),
});

manager.connect();

function ConnectionStatus() {
  const state = useConnectionState(manager);
  return <span>{state}</span>; // "disconnected" | "connecting" | "connected" | "reconnecting"
}
```

## Configuration

```tsx
const manager = new WebSocketManager<ClientMsg, ServerMsg>({
  // Required
  url: "wss://example.com/ws",
  serialize: (msg) => JSON.stringify(msg),
  deserialize: (raw) => JSON.parse(raw),

  // Ping / pong (keep-alive)
  ping: () => ({ action: "ping" }),       // function returning the ping message
  isPong: (msg) => msg.type === "pong",   // detect pong responses
  pingIntervalMs: 30_000,                 // default: 30s
  pongTimeoutMs: 10_000,                  // default: 10s — disconnects if no pong

  // Reconnection (exponential backoff with jitter)
  reconnectMaxAttempts: 5,                // default: 5
  reconnectBaseDelayMs: 1_000,            // default: 1s
  reconnectMaxDelayMs: 5_000,             // default: 5s

  // Custom transport (for testing or non-browser environments)
  transport: myCustomTransport,

  // Callbacks
  onMessageReceived: (msg) => {},                // server → client
  onSendIntent: ({ data, ackId, meta }) => {},    // fires on every send() — for optimistic updates
  onConnectionStateChange: (state) => {},
  onReady: () => {},                             // fires after connect + subscription restore
  onInFlightDrop: (messages) => {},              // { id, data }[] — unacked messages lost on disconnect
  onLastUnsubscribe: (key, data) => {},          // key + subscription data when last ref removed
  onDebug: (event) => {},                        // all internal events (for logging)
});
```

## Manager API

### Connection lifecycle

```tsx
manager.connect();          // open the WebSocket connection
manager.disconnect();       // intentional close (code 1000, no reconnect)
manager.forceReconnect();   // tear down and immediately reconnect (see Mobile apps below)
manager.dispose();          // disconnect + clear all subscriptions and state
```

### Subscriptions

Subscriptions are ref-counted. Multiple components can subscribe to the same key; the server message is sent only on the first subscribe and last unsubscribe.

```tsx
// Subscribe — sends data to the server on first ref
manager.subscribe("conversation:room1", { action: "subscribe", channel: "room1" });

// Unsubscribe — sends data to the server when ref count reaches 0
manager.unsubscribe("conversation:room1", { action: "unsubscribe", channel: "room1" });

// Check ref count
manager.getRefCount("conversation:room1"); // number
```

On reconnection, all active subscriptions are automatically re-sent to the server.

### Sending messages

```tsx
// Fire-and-forget
manager.send({ data: { action: "typing", channel: "room1" } });

// With in-flight tracking
manager.send({ data: { action: "chat", text: "hello" }, ackId: "msg-123" });

// With meta — passed through to onSendIntent, never sent on the wire
manager.send({
  data: { action: "chat", text: "hello" },
  ackId: "msg-123",
  meta: { sentAt: Date.now() },
});

// Acknowledge delivery (removes from in-flight map)
manager.ackInFlight("msg-123");
```

| Field | Purpose |
|-------|---------|
| `data` | The message — serialized and sent on the wire |
| `ackId` | Optional. Tracks the message as in-flight until `ackInFlight(ackId)` is called |
| `meta` | Optional. Passed to `onSendIntent` for optimistic updates. Never serialized |

If the connection drops while messages are in-flight, `onInFlightDrop` fires with an array of `{ id, data }` objects containing both the ack ID and the original message data.

### Optimistic updates with `onSendIntent`

`onSendIntent` fires at the top of every `send()` call — **before** the connection check. This makes it the right place for optimistic UI updates:

```tsx
const manager = new WebSocketManager({
  // ...
  onSendIntent({ data, ackId, meta }) {
    if (data.action !== "message" || !ackId) return;
    store.addMessage({ id: ackId, sender: "you", text: data.text });
  },
  onMessageReceived(msg) {
    if (msg.action !== "message") return;
    manager.ackInFlight(msg.id);
    store.addMessageIfNew(msg);
  },
});

// Call site is just one line — all state logic lives in the callbacks
manager.send({ data: { action: "message", id, channel, text }, ackId: id });
```

### Pending subscriptions

When a subscription message is sent to the server, you can mark it as "pending" until the server confirms:

```tsx
// After subscribe, the key is in pending set
manager.resolvePendingSubscription("conversation:room1");
```

### Reading state

```tsx
manager.getConnectionState();       // "disconnected" | "connecting" | "connected" | "reconnecting"
manager.getSubscriptionRefCounts(); // ReadonlyMap<string, number>
manager.getSubscriptionData();      // ReadonlyMap<string, ClientMsg | undefined>
manager.getPendingSubscriptions();  // ReadonlySet<string>
manager.getInFlightMessages();      // ReadonlyMap<string, ClientMsg>
manager.getReconnectAttempt();      // number
manager.getProtocols();             // readonly string[]
manager.isDisposed();               // boolean
manager.isIntentionalClose();       // boolean
```

## React hook

### `useConnectionState`

Reactively tracks the manager's connection state using `useSyncExternalStore`.

```tsx
import { useConnectionState } from "@luciodale/react-socket";

function MyComponent() {
  const state = useConnectionState(manager);

  if (state === "connected") return <span>Online</span>;
  if (state === "reconnecting") return <span>Reconnecting...</span>;
  return <span>Offline</span>;
}
```

## Mobile apps (Capacitor / React Native)

On mobile platforms the OS can kill the WebSocket while the app is in the background without firing a `close` event. The built-in `online`/`offline` listeners and ping/pong timeouts help, but may not trigger immediately on resume.

Use `forceReconnect()` to guarantee a fresh connection when the app returns to the foreground:

```tsx
import { App } from "@capacitor/app";

App.addListener("appStateChange", ({ isActive }) => {
  if (isActive) {
    manager.forceReconnect();
  }
});
```

`forceReconnect()`:
- Clears all timers (ping, pong, reconnect)
- Drops in-flight messages (fires `onInFlightDrop`)
- Tears down the old connection (detaches handlers to prevent stale events)
- Resets the reconnect attempt counter
- Immediately calls `connect()` to start a fresh connection
- Subscriptions are automatically restored once reconnected
- No-op if the manager is disposed

## Undelivered message sync

For offline-capable apps, `createUndeliveredSync` provides a storage-backed queue for messages that haven't been acknowledged by the server.

```tsx
import { createUndeliveredSync, createLocalStorage } from "@luciodale/react-socket";

type ChatMsg = { id: string; text: string };

const sync = createUndeliveredSync<ChatMsg>({
  storage: createLocalStorage(),
  storageKey: "undelivered", // default: "ws_undelivered_messages"
});

await sync.init(); // load from storage

// Queue a message
sync.addMessage("room1", { id: "msg-1", text: "hello" });

// On server ack
sync.removeMessage("room1", "msg-1");

// Read pending messages for a channel
sync.getChannelMessages("room1"); // ChatMsg[]

// Bulk operations
sync.setChannelMessages("room1", messages);
sync.clearChannel("room1");
sync.clearAll();
```

### Reactive reads with `useSyncExternalStore`

The sync queue supports subscriptions, so you can read from it reactively without polling:

```tsx
import { useSyncExternalStore, useMemo } from "react";

function useUndelivered(channel: string) {
  const undelivered = useSyncExternalStore(
    sync.subscribe,
    () => sync.getChannelMessages(channel),
  );

  const undeliveredIds = useMemo(
    () => new Set(undelivered.map((m) => m.id)),
    [undelivered],
  );

  return { undelivered, undeliveredIds };
}
```

### Custom storage

You can implement `IStorage` for any async key-value store (AsyncStorage, IndexedDB, etc.):

```tsx
const storage: IStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};
```

## Inspector

A floating dev panel for observing WebSocket activity in real time. Styles are injected automatically — no CSS import needed.

```tsx
import { InspectorPanel } from "@luciodale/react-socket/inspector";

function App() {
  return (
    <>
      <MyApp />
      {process.env.NODE_ENV === "development" && (
        <InspectorPanel manager={manager} />
      )}
    </>
  );
}
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `manager` | `WebSocketManager` | required | The manager instance to observe |
| `maxSnapshots` | `number` | `500` | Max events kept in the circular buffer |
| `defaultPosition` | `"top-left" \| "top-right" \| "bottom-left" \| "bottom-right"` | `"bottom-right"` | Initial position of the bubble |

### Features

- **Floating bubble** — shows connection status, drag to reposition, click to open
- **Event timeline** — scrollable list of all WebSocket events with timestamps
- **State view** — connection status, subscription table, in-flight messages
- **Diff view** — state changes between consecutive events
- **Filter dropdown** — filter events by type with checkboxes
- **History browsing** — click any event to freeze the view at that point; live updates continue in the background without interfering
- **Resizable** — drag the corner handle to resize the panel, drag the divider to resize the sidebar
- **Persistent layout** — bubble position, panel position, panel size, and sidebar width are saved to localStorage

## Custom transport

By default, the manager uses the browser's native `WebSocket`. You can provide a custom transport for testing or non-browser environments:

```tsx
import type { IWebSocketTransport } from "@luciodale/react-socket";

class MyTransport implements IWebSocketTransport {
  readyState = WebSocket.CLOSED;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  connect(url: string, protocols?: string | string[]) { /* ... */ }
  disconnect(code?: number, reason?: string) { /* ... */ }
  send(data: string) { /* ... */ }
}
```

## Debug events

Subscribe to all internal events for logging or custom tooling:

```tsx
manager.addDebugListener((event) => {
  console.log(`[${event.type}]`, event);
});
```

Event types:

| Type | Description |
|------|-------------|
| `connection-state-change` | Connection state transition (`from` / `to`) |
| `message-received` | Incoming message (includes `isPong` flag) |
| `message-sent` | Outgoing message (includes pings) |
| `subscribe` | Subscription created (key + ref count) |
| `unsubscribe` | Subscription removed (key + ref count) |
| `in-flight-ack` | In-flight message acknowledged |
| `in-flight-drop` | Unacknowledged messages dropped on disconnect |
| `pending-subscription-resolved` | Server confirmed a subscription |
| `reconnect-scheduled` | Reconnection queued (attempt + delay) |
| `ready` | Connection opened and subscriptions restored |
| `deserialize-error` | Failed to deserialize an incoming message |
| `dispose` | Manager disposed |

## License

MIT
