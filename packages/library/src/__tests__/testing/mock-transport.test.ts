import { describe, expect, it } from "vitest";
import {
	createMockTransport,
	MockTransport,
} from "../../testing/mock-transport";

describe("createMockTransport", () => {
	it("returns an instance of MockTransport", () => {
		const transport = createMockTransport();
		expect(transport).toBeInstanceOf(MockTransport);
	});
});

describe("MockTransport", () => {
	it("captures connect calls with url and protocols", () => {
		const transport = new MockTransport();
		transport.connect("ws://test", ["v1"]);
		expect(transport.connectCalls).toEqual([
			{ url: "ws://test", protocols: ["v1"] },
		]);
		expect(transport.readyState).toBe(WebSocket.CONNECTING);
	});

	it("captures sent messages", () => {
		const transport = new MockTransport();
		transport.send("hello");
		transport.send("world");
		expect(transport.sentMessages).toEqual(["hello", "world"]);
	});

	it("captures disconnect calls and resets ready state", () => {
		const transport = new MockTransport();
		transport.connect("ws://test");
		transport.disconnect(4000, "force reconnect");
		expect(transport.disconnectCalls).toEqual([
			{ code: 4000, reason: "force reconnect" },
		]);
		expect(transport.readyState).toBe(WebSocket.CLOSED);
	});

	it("simulateOpen flips readyState and fires onopen", () => {
		const transport = new MockTransport();
		let fired = false;
		transport.onopen = () => {
			fired = true;
		};
		transport.connect("ws://test");
		transport.simulateOpen();
		expect(transport.readyState).toBe(WebSocket.OPEN);
		expect(fired).toBe(true);
	});

	it("simulateOpen is a no-op unless a connect is pending", () => {
		const transport = new MockTransport();
		let fired = 0;
		transport.onopen = () => {
			fired += 1;
		};
		// Never connected — a closed socket cannot open.
		transport.simulateOpen();
		expect(fired).toBe(0);
		expect(transport.readyState).toBe(WebSocket.CLOSED);

		// Already open — cannot open twice.
		transport.connect("ws://test");
		transport.simulateOpen();
		transport.simulateOpen();
		expect(fired).toBe(1);
	});

	it("simulateClose defaults to abnormal close (1006)", () => {
		const transport = new MockTransport();
		let received: CloseEvent | null = null;
		transport.onclose = (event) => {
			received = event;
		};
		transport.connect("ws://test");
		transport.simulateOpen();
		transport.simulateClose();
		expect(received).not.toBeNull();
		expect((received as unknown as CloseEvent).code).toBe(1006);
		expect((received as unknown as CloseEvent).wasClean).toBe(false);
	});

	it("simulateClose with 1000 marks the close as clean", () => {
		const transport = new MockTransport();
		let received: CloseEvent | null = null;
		transport.onclose = (event) => {
			received = event;
		};
		// Closing from CONNECTING is legal (connection failure).
		transport.connect("ws://test");
		transport.simulateClose(1000, "normal");
		expect((received as unknown as CloseEvent).code).toBe(1000);
		expect((received as unknown as CloseEvent).wasClean).toBe(true);
		expect((received as unknown as CloseEvent).reason).toBe("normal");
	});

	it("simulateClose is a no-op on an already-closed socket", () => {
		const transport = new MockTransport();
		let closes = 0;
		transport.onclose = () => {
			closes += 1;
		};
		transport.simulateClose();
		expect(closes).toBe(0);

		transport.connect("ws://test");
		transport.simulateOpen();
		transport.simulateClose();
		transport.simulateClose();
		expect(closes).toBe(1);
	});

	it("simulateMessage delivers a MessageEvent to onmessage", () => {
		const transport = new MockTransport();
		const received: string[] = [];
		transport.onmessage = (event) => {
			received.push(event.data as string);
		};
		transport.connect("ws://test");
		transport.simulateOpen();
		transport.simulateMessage(JSON.stringify({ type: "hello" }));
		expect(received).toEqual([`{"type":"hello"}`]);
	});

	it("simulateMessage is a no-op unless the socket is open", () => {
		const transport = new MockTransport();
		const received: string[] = [];
		transport.onmessage = (event) => {
			received.push(event.data as string);
		};
		// Never opened.
		transport.simulateMessage("frame");
		// Connecting, not yet open.
		transport.connect("ws://test");
		transport.simulateMessage("frame");
		// Closed.
		transport.simulateOpen();
		transport.simulateClose();
		transport.simulateMessage("frame");
		expect(received).toEqual([]);
	});

	it("simulateError fires onerror while the socket is live", () => {
		const transport = new MockTransport();
		let fired = 0;
		transport.onerror = () => {
			fired += 1;
		};
		// Errors can fire during CONNECTING (connection refused) and OPEN.
		transport.connect("ws://test");
		transport.simulateError();
		transport.simulateOpen();
		transport.simulateError();
		expect(fired).toBe(2);

		// Never after close.
		transport.simulateClose();
		transport.simulateError();
		expect(fired).toBe(2);
	});

	it("reset wipes captured calls but keeps listeners", () => {
		const transport = new MockTransport();
		let openFired = 0;
		transport.onopen = () => {
			openFired += 1;
		};

		transport.connect("ws://test");
		transport.send("payload");
		transport.disconnect();

		transport.reset();
		expect(transport.connectCalls).toEqual([]);
		expect(transport.sentMessages).toEqual([]);
		expect(transport.disconnectCalls).toEqual([]);
		expect(transport.readyState).toBe(WebSocket.CLOSED);

		// Listener still attached and fires on the next legal open.
		transport.connect("ws://test");
		transport.simulateOpen();
		expect(openFired).toBe(1);
	});
});
