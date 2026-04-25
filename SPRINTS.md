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

Status: **complete**.

- [x] `/docs/migrate-from-react-use-websocket` page: API mapping table, before/after side-by-side, ref-counted subscriptions sketch, step-by-step list, gotchas (lastJsonMessage drops, re-render churn, manual auth)
- [x] `/docs/migrate-from-socket-io` page: concept mapping table, before/after, ack callback → delivered event pattern, rooms → subscriptions, step-by-step, what you give up vs gain. Includes a server-side caveat callout
- [x] `/docs/monitoring` page: Sentry breadcrumbs + capture, Datadog logs, sampling, redaction, custom metrics, when to use `onDebug` vs `addDebugListener`
- [x] Sidebar: Monitoring under Guides; new "Migrate" section with both migration pages

Quality gate: astro build prerenders all three new pages (`migrate-from-react-use-websocket`, `migrate-from-socket-io`, `monitoring`); existing pages and demos unaffected.

Open items:
- A `createSentryReporter()` helper export was on the maybe list. Not added — the inline `onDebug` switch in the docs is enough for most users; helper can come later if multiple users ask.

## Dropped from original plan

- SSR / hydration positioning (Phase 5). Dropped per user direction.

## Sprint 5 — Pre-release polish

Status: **complete**.

- [x] Library version bumped to 0.0.5
- [x] Biome ignores generated `.d.mts`, `.mjs`, `dist`, `_pagefind`, `wrangler.jsonc`, build artifacts. `bun run lint` is clean across the repo
- [x] `scripts/check-single-react.sh` asserts exactly one React install (realpath-deduped). Wired as `bun run check:single-react` and into `bun run test`
- [x] Root `dev` script now runs `check:single-react` + `build:lib` before `--filter react-socket-docs dev`, so dual-React and stale dist regressions are caught before the dev server boots
- [x] Demo component renamed `AuthRefresh.tsx` → `FirstMessageAuth.tsx`; URL stays `/demo/auth-refresh`
- [x] Library README rewritten: ten hooks, testing subpath, binary frames, auth, full pointer set
- [x] High-frequency stream demo (`/demo/high-frequency-stream`): server pushes 50 ticks/sec via `subscribe-ticks` / `unsubscribe-ticks`, side-by-side panels show `useSocketEvent` (per-tick render) vs `useSocketEventBatch` (one render per 100ms flush)
- [x] `createSentryReporter` recipe on `/docs/monitoring`: drop-in helper bundling breadcrumbs, sampling, redaction, reconnect-storm alert. Returns unsubscribe.

Quality gates: 201 tests pass, root + docs tsc clean, biome clean across 71 files, astro build prerenders all new pages, single-React guard passes.

## Cross-sprint cleanup remaining

(none open at this point)
