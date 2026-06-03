import type { IWebSocketTransport, TWireData } from "../types";

export type TConnectCall = {
	url: string;
	protocols?: string | string[];
};

export type TDisconnectCall = {
	code?: number;
	reason?: string;
};

/**
 * In-memory WebSocket transport for tests. Implements `IWebSocketTransport`
 * so it can be passed to `WebSocketManager` in place of the real browser
 * transport.
 *
 * ```ts
 * const transport = new MockTransport();
 * const manager = new WebSocketManager({
 *   url: "ws://test",
 *   serialize: (m) => JSON.stringify(m),
 *   deserialize: (r) => JSON.parse(r),
 *   transport,
 * });
 *
 * manager.connect();
 * transport.simulateOpen();
 * transport.simulateMessage(JSON.stringify({ type: "hello" }));
 * expect(transport.sentMessages).toContain(...);
 * ```
 */
export class MockTransport implements IWebSocketTransport {
	onopen: ((event: Event) => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;

	binaryType?: "blob" | "arraybuffer";

	readyState: number = WebSocket.CLOSED;

	/** Every `connect(url, protocols?)` call captured in order. */
	connectCalls: TConnectCall[] = [];

	/**
	 * Every payload passed to `send(data)` in order. Type widens to the full
	 * WebSocket-acceptable union when the manager runs in binary mode.
	 */
	sentMessages: TWireData[] = [];

	/** Every `disconnect(code?, reason?)` call captured in order. */
	disconnectCalls: TDisconnectCall[] = [];

	connect(url: string, protocols?: string | string[]): void {
		this.connectCalls.push({ url, protocols });
		this.readyState = WebSocket.CONNECTING;
	}

	disconnect(code?: number, reason?: string): void {
		this.disconnectCalls.push({ code, reason });
		this.readyState = WebSocket.CLOSED;
	}

	send(data: TWireData): void {
		this.sentMessages.push(data);
	}

	// ── Simulation helpers ────────────────────────────────────────────
	//
	// Each helper enforces the real socket state machine so tests cannot
	// exercise event sequences impossible in production.

	/** Drive the transport into the OPEN state and fire `onopen`. No-op unless CONNECTING. */
	simulateOpen(): void {
		if (this.readyState !== WebSocket.CONNECTING) return;
		this.readyState = WebSocket.OPEN;
		this.onopen?.(new Event("open"));
	}

	/**
	 * Close the connection. Defaults to code 1006 (abnormal close) so the
	 * manager treats it as a drop and schedules a reconnect. Pass 1000 to
	 * simulate a clean close. No-op when already CLOSED.
	 */
	simulateClose(code: number = 1006, reason: string = ""): void {
		if (this.readyState === WebSocket.CLOSED) return;
		this.readyState = WebSocket.CLOSED;
		const event = new CloseEvent("close", {
			code,
			reason,
			wasClean: code === 1000,
		});
		this.onclose?.(event);
	}

	/** Deliver a server message frame to the manager. No-op unless OPEN. */
	simulateMessage(data: string): void {
		if (this.readyState !== WebSocket.OPEN) return;
		const event = new MessageEvent("message", { data });
		this.onmessage?.(event);
	}

	/** Fire `onerror`. No-op when CLOSED. */
	simulateError(): void {
		if (this.readyState === WebSocket.CLOSED) return;
		this.onerror?.(new Event("error"));
	}

	/** Wipe captured calls and messages. Listeners stay attached. */
	reset(): void {
		this.connectCalls = [];
		this.sentMessages = [];
		this.disconnectCalls = [];
		this.readyState = WebSocket.CLOSED;
	}
}

/** Factory for `MockTransport`. Equivalent to `new MockTransport()`. */
export function createMockTransport(): MockTransport {
	return new MockTransport();
}
