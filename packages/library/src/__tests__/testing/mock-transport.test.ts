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
		transport.simulateOpen();
		expect(transport.readyState).toBe(WebSocket.OPEN);
		expect(fired).toBe(true);
	});

	it("simulateClose defaults to abnormal close (1006)", () => {
		const transport = new MockTransport();
		let received: CloseEvent | null = null;
		transport.onclose = (event) => {
			received = event;
		};
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
		transport.simulateClose(1000, "normal");
		expect((received as unknown as CloseEvent).code).toBe(1000);
		expect((received as unknown as CloseEvent).wasClean).toBe(true);
		expect((received as unknown as CloseEvent).reason).toBe("normal");
	});

	it("simulateMessage delivers a MessageEvent to onmessage", () => {
		const transport = new MockTransport();
		const received: string[] = [];
		transport.onmessage = (event) => {
			received.push(event.data as string);
		};
		transport.simulateMessage(JSON.stringify({ type: "hello" }));
		expect(received).toEqual([`{"type":"hello"}`]);
	});

	it("simulateError fires onerror", () => {
		const transport = new MockTransport();
		let fired = false;
		transport.onerror = () => {
			fired = true;
		};
		transport.simulateError();
		expect(fired).toBe(true);
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
		transport.simulateOpen();

		transport.reset();
		expect(transport.connectCalls).toEqual([]);
		expect(transport.sentMessages).toEqual([]);
		expect(transport.disconnectCalls).toEqual([]);
		expect(transport.readyState).toBe(WebSocket.CLOSED);

		// Listener still attached
		transport.simulateOpen();
		expect(openFired).toBe(2);
	});
});
