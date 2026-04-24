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

	/** Drive the transport into the OPEN state and fire `onopen`. */
	simulateOpen(): void {
		this.readyState = WebSocket.OPEN;
		this.onopen?.(new Event("open"));
	}

	/**
	 * Close the connection. Defaults to code 1006 (abnormal close) so the
	 * manager treats it as a drop and schedules a reconnect. Pass 1000 to
	 * simulate a clean close.
	 */
	simulateClose(code: number = 1006, reason: string = ""): void {
		this.readyState = WebSocket.CLOSED;
		const event = new CloseEvent("close", {
			code,
			reason,
			wasClean: code === 1000,
		});
		this.onclose?.(event);
	}

	/** Deliver a server message frame to the manager. */
	simulateMessage(data: string): void {
		const event = new MessageEvent("message", { data });
		this.onmessage?.(event);
	}

	simulateError(): void {
		this.onerror?.(new Event("error"));
	}

	/** Wipe captured calls and messages. Listeners stay attached. */
	reset(): void {
		this.connectCalls = [];
		this.sentMessages = [];
		this.disconnectCalls = [];
		this.readyState = WebSocket.CLOSED;
	}

	/**
	 * Convenience: parse and return the last `send()` payload as the given
	 * generic type. Throws if nothing has been sent or the payload is not a
	 * string (binary frames cannot be JSON-parsed; assert against
	 * `sentMessages` directly in that case).
	 */
	lastSentParsed<T>(): T {
		const last = this.sentMessages[this.sentMessages.length - 1];
		if (last === undefined) {
			throw new Error("MockTransport: no messages have been sent");
		}
		if (typeof last !== "string") {
			throw new Error(
				"MockTransport: lastSentParsed requires a string payload; got binary",
			);
		}
		return JSON.parse(last) as T;
	}
}

/** Factory for `MockTransport`. Equivalent to `new MockTransport()`. */
export function createMockTransport(): MockTransport {
	return new MockTransport();
}
