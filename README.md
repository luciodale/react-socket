<div align="center">
  <img src="https://raw.githubusercontent.com/luciodale/react-socket/main/packages/docs/public/logo-accent.svg" alt="react-socket logo" width="120" height="120" />
  <h1>react-socket</h1>
  <p>A TypeScript-first WebSocket manager for React. One hook per concern, zero imperative glue.</p>

  [Documentation](https://koolcodez.com/projects/react-socket) &nbsp;&middot;&nbsp; [NPM](https://www.npmjs.com/package/@luciodale/react-socket) &nbsp;&middot;&nbsp; [GitHub](https://github.com/luciodale/react-socket)

  [![npm version](https://img.shields.io/npm/v/@luciodale/react-socket.svg)](https://www.npmjs.com/package/@luciodale/react-socket)
  [![npm downloads](https://img.shields.io/npm/dm/@luciodale/react-socket.svg)](https://www.npmjs.com/package/@luciodale/react-socket)
  [![bundle size](https://img.shields.io/bundlephobia/minzip/@luciodale/react-socket)](https://bundlephobia.com/package/@luciodale/react-socket)
  [![license](https://img.shields.io/npm/l/@luciodale/react-socket.svg)](./LICENSE)

</div>

## Why react-socket

Coming from `react-use-websocket` or a raw `useEffect(() => new WebSocket(...))`, these are the things you stop writing by hand:

- **Typed message schemas.** Client and server union types flow through `send`, every hook, every callback. Discriminated unions narrow automatically by a configurable key.
- **One primitive per concern.** Ten hooks, each with a distinct job. No message switch, no pub/sub layer, no `.on` / `.remove` anywhere in user code.
- **Ref counted subscriptions.** Five components can subscribe to the same channel. One subscribe message hits the server. The unsubscribe fires on the last unmount.
- **Lifecycle in the library.** Ack matching and subscription resolution are declared once as extractors. You never call `ackInFlight` or `resolvePendingSubscription`.
- **Offline message queue.** Sends made while disconnected can persist to storage and flush on reconnect.
- **Reconnection with backoff.** Exponential backoff with jitter, subscriptions restore themselves.
- **DevTools inspector.** A drop in component that shows traffic, subscription ref counts, and in-flight state in real time.

Built for streaming LLM clients, realtime trading UIs, chat, presence, and agentic workflows.

> Full comparisons:
> [vs react-use-websocket](https://koolcodez.com/projects/react-socket/docs/vs-react-use-websocket) (thin hook camp)
> ·
> [vs Socket.IO](https://koolcodez.com/projects/react-socket/docs/vs-socket-io) (same tier, different trade offs)

## Requirements

- React 16.8+ (hooks).
- TypeScript 4.7+ recommended for full generic inference.
- Modern evergreen browsers. Tested on Chrome 90+, Firefox 88+, Safari 14+, Edge 90+.

## Install

```bash
npm install @luciodale/react-socket
```

## Quick start

One manager at module level. One hook to react to incoming events. One hook to send.

```tsx
import { useEffect, useState } from "react"
import {
  WebSocketManager,
  useSocketEvent,
  useSocketSend,
} from "@luciodale/react-socket"

type TClientMsg = { type: "echo"; text: string }
type TServerMsg = { type: "echo"; text: string }

const manager = new WebSocketManager<TClientMsg, TServerMsg>({
  url: "wss://your-server.com/ws",
  serialize: (msg) => JSON.stringify(msg),
  deserialize: (raw) => JSON.parse(raw),
})

export function Echo() {
  const [response, setResponse] = useState<string | null>(null)
  const { send } = useSocketSend(manager)

  useSocketEvent(manager, "echo", (msg) => setResponse(msg.text))

  useEffect(() => {
    manager.connect()
    return () => manager.disconnect()
  }, [])

  return (
    <>
      <button onClick={() => send({ type: "echo", text: "hello" })}>
        send
      </button>
      {response && <p>server said: {response}</p>}
    </>
  )
}
```

Change a field in `TClientMsg` or `TServerMsg` and TypeScript lists every call site that needs updating. `useSocketEvent` narrows the message via `Extract<TServerMsg, { type: "echo" }>` automatically.

## The ten hooks

```ts
// React to an incoming message of a given type
useSocketEvent(manager, "notification", (msg) => { /* msg narrowed */ })

// Same as useSocketEvent, but buffers and flushes every flushMs (high-frequency streams)
useSocketEventBatch(manager, "tick", (msgs) => { /* ... */ }, { flushMs: 100 })

// Subscribe to a server-side stream, ref counted, auto cleanup
useSocketSubscription(manager, {
  key: roomId,
  subscribe: { type: "subscribe", channel: roomId },
  unsubscribe: { type: "unsubscribe", channel: roomId },
})

// True while a subscribe is in flight — drives "joining..." UI
const joining = useSocketPendingSubscription(manager, roomId)

// Typed positional send fn
const { send } = useSocketSend(manager)

// Fires on every send(), even offline — drives optimistic UI
useSocketSendIntent(manager, ({ data, ackId }) => { /* ... */ })

// Fires when in-flight messages are dropped on disconnect
useSocketInFlightDrop(manager, (messages) => { /* ... */ })

// Fires after every (re)connect, with the list of restored subscription keys
useSocketReady(manager, (restoredKeys) => { /* ... */ })

// Fires when the last subscriber for a key unmounts
useSocketLastUnsubscribe(manager, (key, data) => { /* ... */ })

// Observable connection state
const state = useSocketConnectionState(manager)
```

Autocomplete `useSocket` in your editor — that is the entire surface.

## Acknowledged sends

Tag a message with an ack id, wire the extractor once, the library clears in-flight tracking automatically when the server confirms.

```ts
const manager = new WebSocketManager<TClientMsg, TServerMsg>({
  url: "wss://...",
  serialize: JSON.stringify,
  deserialize: (raw) => JSON.parse(raw),

  // library auto-clears the matching in-flight entry when this returns an id
  getAckId: (msg) => (msg.type === "delivered" ? msg.ackId : undefined),
})
```

```ts
const { send } = useSocketSend(manager)

function onSend(text: string) {
  const id = crypto.randomUUID()
  send({ type: "message", id, text }, id) // 2nd arg: ackId
}
```

## Subscriptions

Multiple components with the same key share a single server subscription. The manager dedupes automatically.

```tsx
function ChatRoom({ roomId }: { roomId: string }) {
  useSocketSubscription(manager, {
    key: roomId,
    subscribe: { type: "subscribe", channel: roomId },
    unsubscribe: { type: "unsubscribe", channel: roomId },
  })

  const joining = useSocketPendingSubscription(manager, roomId)
  return joining ? <span>joining...</span> : <Room id={roomId} />
}
```

If three components mount `ChatRoom` with the same `roomId`, the subscribe message is sent once. When all three unmount, the unsubscribe fires once. Reconnect replays the subscription transparently.

## Inspector

A built-in devtools panel for debugging WebSocket traffic. Separate export so it tree-shakes out of production builds.

```tsx
import { InspectorPanel } from "@luciodale/react-socket/inspector"

function DevTools() {
  return <InspectorPanel manager={manager} />
}
```

## Docs

Full documentation, patterns catalog, configuration reference, and live examples at [koolcodez.com/projects/react-socket](https://koolcodez.com/projects/react-socket).

## License

MIT
