<div align="center">
  <img src="https://raw.githubusercontent.com/luciodale/react-socket/main/packages/docs/public/logo-accent.svg" alt="react-socket logo" width="120" height="120" />
  <h1>react-socket</h1>
  <p>A TypeScript-first WebSocket manager for React that handles the socket plumbing you don't want to build.</p>

  [Documentation](https://koolcodez.com/projects/react-socket) &nbsp;&middot;&nbsp; [NPM](https://www.npmjs.com/package/@luciodale/react-socket) &nbsp;&middot;&nbsp; [GitHub](https://github.com/luciodale/react-socket)

</div>

## Install

```bash
npm install @luciodale/react-socket
```

## Quick Start

The minimum to get a typed WebSocket connection with automatic reconnection.

```tsx
// app.tsx
import { WebSocketManager, useConnectionState } from "@luciodale/react-socket"

type ClientMsg = { type: "echo"; text: string }
type ServerMsg = { type: "echo_reply"; text: string }

const manager = new WebSocketManager<ClientMsg, ServerMsg>({
  url: "wss://your-server.com/ws",
  serialize: (msg) => JSON.stringify(msg),
  deserialize: (raw) => JSON.parse(raw),
  onMessageReceived: (msg) => {
    console.log("received:", msg)
  },
})

manager.connect()

function App() {
  const state = useConnectionState(manager)

  return (
    <div>
      <p>Connection: {state}</p>
      <button
        onClick={() =>
          manager.send({ data: { type: "echo", text: "hello" } })
        }
      >
        Send
      </button>
    </div>
  )
}
```

Change a field in `ClientMsg` or `ServerMsg` and TypeScript tells you every place that needs updating. The generic types flow through `serialize`, `deserialize`, `onMessageReceived`, and `send` with zero casts.

## Features

- **Automatic reconnection** &mdash; exponential backoff with jitter, configurable max attempts and delays. Subscriptions restore themselves on reconnect without extra code.
- **Ref-counted subscriptions** &mdash; multiple components can subscribe to the same channel. The manager tracks reference counts internally and only sends the subscribe/unsubscribe message when the first component mounts or the last one unmounts.
- **In-flight tracking** &mdash; tag outgoing messages with an `ackId`. The manager holds them until the server acknowledges or the connection drops, then notifies you of unacknowledged messages so nothing gets silently lost.
- **Keep-alive (ping/pong)** &mdash; configurable ping interval and pong timeout. If the server goes silent, the manager detects it and triggers reconnection before your users notice.
- **Undelivered sync** &mdash; optional persistent storage for messages that failed to send. Survives page reloads via localStorage (or any custom `IStorage` implementation).
- **Pluggable transport** &mdash; the default uses the browser `WebSocket` API, but you can swap in any transport that implements `IWebSocketTransport`. Useful for testing or non-browser environments.
- **Full TypeScript generics** &mdash; `WebSocketManager<TClientMsg, TServerMsg>` propagates your message types across the entire API surface. Discriminated unions, generics, compile-time safety.
- **DevTools inspector** &mdash; a drop-in `InspectorPanel` component that visualizes connection state, message flow, subscription ref counts, and in-flight messages in real time.

## Subscriptions

Multiple components subscribing to the same key share a single server subscription. The manager deduplicates automatically.

```tsx
// chat-room.tsx
function useChatRoom(roomId: string) {
  useEffect(() => {
    manager.subscribe(`room:${roomId}`, {
      type: "join_room",
      roomId,
    })
    return () => {
      manager.unsubscribe(`room:${roomId}`, {
        type: "leave_room",
        roomId,
      })
    }
  }, [roomId])
}
```

If three components call `subscribe("room:lobby")`, the join message is sent once. When all three unmount, the leave message is sent once.

## In-Flight Tracking

Tag a message with `ackId` and the manager holds it until you confirm delivery or the connection drops.

```tsx
// send-with-ack.tsx
const id = crypto.randomUUID()

manager.send({
  data: { type: "place_order", item: "espresso" },
  ackId: id,
})

// When the server confirms:
manager.ackInFlight(id)

// If the connection drops before ack, onInFlightDrop fires
// with the list of unacknowledged messages.
```

## Inspector

A built-in devtools panel for debugging WebSocket traffic. Ships as a separate export so it tree-shakes out of production builds.

```tsx
// debug.tsx
import { InspectorPanel } from "@luciodale/react-socket/inspector"

function DevTools() {
  return <InspectorPanel manager={manager} />
}
```

## Docs

Full documentation, configuration reference, and live examples at [koolcodez.com/projects/react-socket](https://koolcodez.com/projects/react-socket).

## License

MIT
