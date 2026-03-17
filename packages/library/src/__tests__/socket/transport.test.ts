import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserWebSocketTransport } from "../../transport";

// ── Mock WebSocket ─────────────────────────────────────────────────

class MockWebSocket {
	static instances: MockWebSocket[] = [];
	url: string;
	protocols?: string | string[];
	readyState: number = WebSocket.CONNECTING;
	onopen: ((event: Event) => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	closeCalls: { code?: number; reason?: string }[] = [];
	sentMessages: string[] = [];

	constructor(url: string, protocols?: string | string[]) {
		this.url = url;
		this.protocols = protocols;
		MockWebSocket.instances.push(this);
	}

	close(code?: number, reason?: string) {
		this.closeCalls.push({ code, reason });
		this.readyState = WebSocket.CLOSED;
	}

	send(data: string) {
		this.sentMessages.push(data);
	}

	simulateOpen() {
		this.readyState = WebSocket.OPEN;
		this.onopen?.(new Event("open"));
	}

	simulateClose(code = 1006) {
		this.readyState = WebSocket.CLOSED;
		this.onclose?.(new CloseEvent("close", { code, wasClean: code === 1000 }));
	}

	simulateMessage(data: string) {
		this.onmessage?.(new MessageEvent("message", { data }));
	}

	simulateError() {
		this.onerror?.(new Event("error"));
	}
}

// ── Setup ──────────────────────────────────────────────────────────

beforeEach(() => {
	vi.stubGlobal("WebSocket", MockWebSocket);
	MockWebSocket.instances = [];
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────

describe("BrowserWebSocketTransport", () => {
	it("connect creates a WebSocket with url and protocols", () => {
		const transport = new BrowserWebSocketTransport();
		transport.connect("ws://localhost:8080", ["proto1", "proto2"]);

		expect(MockWebSocket.instances).toHaveLength(1);
		const ws = MockWebSocket.instances[0];
		expect(ws.url).toBe("ws://localhost:8080");
		expect(ws.protocols).toEqual(["proto1", "proto2"]);
	});

	it("forwards onopen from active socket", () => {
		const transport = new BrowserWebSocketTransport();
		const handler = vi.fn();
		transport.onopen = handler;
		transport.connect("ws://localhost");

		MockWebSocket.instances[0].simulateOpen();
		expect(handler).toHaveBeenCalledOnce();
	});

	it("forwards onclose from active socket", () => {
		const transport = new BrowserWebSocketTransport();
		const handler = vi.fn();
		transport.onclose = handler;
		transport.connect("ws://localhost");

		MockWebSocket.instances[0].simulateClose(1000);
		expect(handler).toHaveBeenCalledOnce();
		expect(handler.mock.calls[0][0]).toBeInstanceOf(CloseEvent);
	});

	it("forwards onmessage from active socket", () => {
		const transport = new BrowserWebSocketTransport();
		const handler = vi.fn();
		transport.onmessage = handler;
		transport.connect("ws://localhost");

		MockWebSocket.instances[0].simulateMessage("hello");
		expect(handler).toHaveBeenCalledOnce();
		expect(handler.mock.calls[0][0].data).toBe("hello");
	});

	it("forwards onerror from active socket", () => {
		const transport = new BrowserWebSocketTransport();
		const handler = vi.fn();
		transport.onerror = handler;
		transport.connect("ws://localhost");

		MockWebSocket.instances[0].simulateError();
		expect(handler).toHaveBeenCalledOnce();
	});

	describe("stale socket guard", () => {
		it("ignores onclose from old socket after disconnect", () => {
			const transport = new BrowserWebSocketTransport();
			const handler = vi.fn();
			transport.onclose = handler;
			transport.connect("ws://localhost");

			const ws1 = MockWebSocket.instances[0];
			transport.disconnect();

			ws1.simulateClose();
			expect(handler).not.toHaveBeenCalled();
		});

		it("ignores onclose from old socket after reconnect", () => {
			const transport = new BrowserWebSocketTransport();
			const closeHandler = vi.fn();
			const openHandler = vi.fn();
			transport.onclose = closeHandler;
			transport.onopen = openHandler;
			transport.connect("ws://localhost");

			const ws1 = MockWebSocket.instances[0];
			transport.disconnect();
			transport.connect("ws://localhost");

			const ws2 = MockWebSocket.instances[1];

			ws1.simulateClose();
			expect(closeHandler).not.toHaveBeenCalled();

			ws2.simulateOpen();
			expect(openHandler).toHaveBeenCalledOnce();
		});

		it("ignores onopen from old socket after reconnect", () => {
			const transport = new BrowserWebSocketTransport();
			const handler = vi.fn();
			transport.onopen = handler;
			transport.connect("ws://localhost");

			const ws1 = MockWebSocket.instances[0];
			transport.connect("ws://localhost");
			const ws2 = MockWebSocket.instances[1];

			ws1.simulateOpen();
			expect(handler).not.toHaveBeenCalled();

			ws2.simulateOpen();
			expect(handler).toHaveBeenCalledOnce();
		});

		it("ignores onmessage from old socket after reconnect", () => {
			const transport = new BrowserWebSocketTransport();
			const handler = vi.fn();
			transport.onmessage = handler;
			transport.connect("ws://localhost");

			const ws1 = MockWebSocket.instances[0];
			transport.connect("ws://localhost");

			ws1.simulateMessage("stale");
			expect(handler).not.toHaveBeenCalled();
		});

		it("ignores onerror from old socket after disconnect", () => {
			const transport = new BrowserWebSocketTransport();
			const handler = vi.fn();
			transport.onerror = handler;
			transport.connect("ws://localhost");

			const ws1 = MockWebSocket.instances[0];
			transport.disconnect();

			ws1.simulateError();
			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe("disconnect", () => {
		it("calls close on the underlying socket", () => {
			const transport = new BrowserWebSocketTransport();
			transport.connect("ws://localhost");
			const ws = MockWebSocket.instances[0];

			transport.disconnect(1000, "reason");
			expect(ws.closeCalls).toEqual([{ code: 1000, reason: "reason" }]);
		});

		it("readyState returns CLOSED after disconnect", () => {
			const transport = new BrowserWebSocketTransport();
			transport.connect("ws://localhost");
			transport.disconnect();

			expect(transport.readyState).toBe(WebSocket.CLOSED);
		});

		it("send is no-op after disconnect", () => {
			const transport = new BrowserWebSocketTransport();
			transport.connect("ws://localhost");
			const ws = MockWebSocket.instances[0];

			transport.disconnect();
			transport.send("should not arrive");

			expect(ws.sentMessages).toEqual([]);
		});
	});

	describe("send", () => {
		it("sends data on active socket", () => {
			const transport = new BrowserWebSocketTransport();
			transport.connect("ws://localhost");
			const ws = MockWebSocket.instances[0];
			ws.simulateOpen();

			transport.send("hello");
			expect(ws.sentMessages).toEqual(["hello"]);
		});
	});
});
