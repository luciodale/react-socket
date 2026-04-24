# react-socket sprints

Living plan to close the gaps surfaced in the original consumer-perspective audit. Tick boxes as we land work.

## Sprint 1 — Auth + error handling

Status: **complete**.

- [x] Widen `url` to `string | (() => string | Promise<string>)` in manager + types
- [x] Add `url-resolve-error` debug event + inspector coverage
- [x] 8 new manager tests (sync, async, refresh, scheduled-reconnect refresh, sync/async rejection, dispose abort, attempt supersession)
- [x] Auth docs page at `/docs/auth` (intro + first-message + server challenge + URL options + subprotocol + security notes)
- [x] Error handling docs page at `/docs/error-handling`
- [x] AuthRefresh demo replaced with first-message auth (no token in URL, onReady sends auth, mid-session re-auth without reconnect)
- [x] FireAndForget demo extended with offline send UX
- [x] Dev WS server + CF Workers endpoint extended with `auth`, `auth-required`, `auth-expired`, `auth-ok`, `unauthorized`, `simulate-session-expiry`, `hello`, `invalidate-token`
- [x] Sidebar updated (Auth, Error handling, First-message auth)
- [x] Frontmatter convention for code samples (works around astro/esbuild parser bug with `<T, T>` + `\${...}`)
- [x] Astro vite `resolve.dedupe` for `react`, `react-dom` (workaround for the workspace dual-React issue)

Quality gates: 176 tests pass, root + docs tsc clean, biome clean on touched files, astro build prerenders all pages.

Open items rolled forward:
- Should we add a CI guard that asserts exactly one `react` resolves in the workspace? (option B from the dual-React thread)
- Should the URL-token auth doc sections be removed now that the demo is first-message only, or kept as secondary?

## Sprint 2 — Testing utilities + multi-manager

Status: **complete**.

- [x] Public `./testing` subpath: `MockTransport`, `createMockTransport`, types `TConnectCall` / `TDisconnectCall`
- [x] vite lib config + `package.json` exports updated; library rebuild produces `dist/react-socket-testing.es.js`
- [x] Internal tests re-routed through the public testing surface (re-export in helpers/)
- [x] 12 new tests in `__tests__/testing/mock-transport.test.ts` covering connect/send/disconnect capture, simulate open/close/message/error, reset semantics, lastSentParsed
- [x] `/docs/testing` page (basic flow, reconnect, ack flow, hook tests with RTL, Vitest setup, full method reference)
- [x] `MultiConnection` demo: two managers, two WS connections, shared `AuthContext`, chat panel + notifications panel
- [x] Server: notifications channel via `subscribe-notifications` / `unsubscribe-notifications` + periodic push every 4s, mirrored in dev-ws.ts and CF Workers ws.ts
- [x] `/demo/multi-connection` page (managers, shared auth, per-connection subscriptions, when NOT to use two managers)
- [x] Sidebar updated (Testing under Guides; Multiple connections under Examples)

Quality gates: 188 tests pass (up from 176), root + docs tsc clean, biome clean on touched files, astro build prerenders all pages including the new ones.

Open items rolled forward:
- Should the multi-connection demo also include a "Sign out" button to demonstrate per-manager disconnect/reconnect explicitly?
- Should the testing docs include a section on testing the React Inspector? (probably not, low value)

## Sprint 3 — Binary frames + backpressure

Status: **complete**.

- [x] Binary frames: in scope (decided)
- [x] `WebSocketManager` parameterized by `TWire extends TWireData` and `TIncoming extends TIncomingData`, defaulting to `string`. Fully backward compatible.
- [x] `IWebSocketTransport.send` widened to accept the WebSocket-acceptable union; `binaryType?: "blob" | "arraybuffer"` field added and plumbed into `BrowserWebSocketTransport`
- [x] `MockTransport` updated to capture binary payloads via `sentMessages: TWireData[]`; `lastSentParsed` throws on binary so users assert directly on the buffer
- [x] Inspector summary handles binary `deserialize-error.raw` without coercing to string
- [x] 5 new tests covering ArrayBuffer round-trip, binaryType plumbing, mixed string + binary, deserialize-error with binary raw
- [x] `useSocketEventBatch(manager, value, handler, { flushMs })` hook. flushMs required (no default). Buffers matching events, snapshots and clears in place each interval, drops pending on unmount.
- [x] 7 new tests covering flush behavior, empty buffer skip, multiple batches, ordering, discriminator narrowing, unmount cleanup, latest handler closure
- [x] `/docs/binary` page with ArrayBuffer, Blob, mixed, and MessagePack examples
- [x] `/docs/backpressure` page with usage, picking flushMs, ordering guarantees, what it does NOT do, when to skip
- [x] API page lists the new hook with a snippet
- [x] Configuration page adds `binaryType` row and points to Testing
- [x] Sidebar updated with Binary frames and Backpressure under Guides

Quality gates: 200 tests pass (up from 188), root + docs tsc clean, biome clean on touched files, library rebuilt to publish the new exports, astro build prerenders all new pages.

Open items rolled forward:
- Optional Sprint 6 work: a live demo of high-frequency batching to make the perf win obvious. Not required.
- Document the wire-type generic pattern in the introductory pages so newcomers see it immediately, or keep it hidden until users hit the binary docs?

## Sprint 4 — Migrations + production debug

Status: **not started**.

Goals:
1. Make adoption from existing libraries low friction.
2. Give consumers a recipe for shipping debug events to monitoring.

Tasks:
- [ ] Migration guide: `react-use-websocket` → `react-socket` (mapping table + worked example)
- [ ] Migration guide: `socket.io-client` → `react-socket` (rooms → subscriptions, events → discriminated unions, ack → in-flight tracking)
- [ ] Production debug export recipe (Sentry / Datadog) using the existing `onDebug` callback
- [ ] Optional: a small `createSentryReporter()` example in the patterns page

## Dropped from original plan

- SSR / hydration positioning (Phase 5). Dropped per user direction.

## Cross-sprint cleanup

Tracked here so we do not lose the items between sprints:

- [ ] Pre-existing biome lint noise in generated `.mjs` / `.d.mts` files: add a biome ignore or fix the source files that emit them
- [ ] Decide whether to rename component file `AuthRefresh.tsx` → `FirstMessageAuth.tsx` for clarity (URL stays `/demo/auth-refresh`)
- [ ] Consider adding `predev` script in docs that runs `bun run build:lib` so the dist stays in sync with library source during dev
