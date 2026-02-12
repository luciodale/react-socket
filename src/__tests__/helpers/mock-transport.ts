import type { IWebSocketTransport } from "../../socket/types";

export class MockTransport implements IWebSocketTransport {
	onopen: ((event: Event) => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;

	readyState: number = WebSocket.CLOSED;
	connectCalls: string[] = [];
	sentMessages: string[] = [];
	disconnectCalls: { code?: number; reason?: string }[] = [];

	connect(url: string): void {
		this.connectCalls.push(url);
		this.readyState = WebSocket.CONNECTING;
	}

	disconnect(code?: number, reason?: string): void {
		this.disconnectCalls.push({ code, reason });
		this.readyState = WebSocket.CLOSED;
	}

	send(data: string): void {
		this.sentMessages.push(data);
	}

	// ── Simulation helpers ────────────────────────────────────────────

	simulateOpen(): void {
		this.readyState = WebSocket.OPEN;
		this.onopen?.(new Event("open"));
	}

	simulateClose(code = 1006, reason = ""): void {
		this.readyState = WebSocket.CLOSED;
		const event = new CloseEvent("close", {
			code,
			reason,
			wasClean: code === 1000,
		});
		this.onclose?.(event);
	}

	simulateMessage(data: string): void {
		const event = new MessageEvent("message", { data });
		this.onmessage?.(event);
	}

	simulateError(): void {
		this.onerror?.(new Event("error"));
	}

	reset(): void {
		this.connectCalls = [];
		this.sentMessages = [];
		this.disconnectCalls = [];
		this.readyState = WebSocket.CLOSED;
	}

	lastSentParsed<T>(): T {
		return JSON.parse(this.sentMessages[this.sentMessages.length - 1]) as T;
	}
}
