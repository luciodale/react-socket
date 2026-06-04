import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketManager } from "../../manager";
import { MockTransport } from "../../testing/mock-transport";

// ── Helpers ─────────────────────────────────────────────────────────

type TBinaryClient = { type: "ping" } | { type: "payload"; size: number };
type TBinaryServer = { type: "pong" } | { type: "payload"; size: number };

function encodeMsg(msg: TBinaryClient | TBinaryServer): ArrayBuffer {
	const json = JSON.stringify(msg);
	const bytes = new TextEncoder().encode(json);
	// Return a fresh ArrayBuffer (not the underlying SharedArrayBuffer)
	const ab = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(ab).set(bytes);
	return ab;
}

function decodeMsg<T>(raw: ArrayBuffer): T {
	const text = new TextDecoder().decode(new Uint8Array(raw));
	return JSON.parse(text) as T;
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("binary wire data", () => {
	it("sends ArrayBuffer payloads through the transport", () => {
		const transport = new MockTransport<ArrayBuffer>();
		const manager = new WebSocketManager<
			TBinaryClient,
			TBinaryServer,
			"type",
			ArrayBuffer,
			ArrayBuffer
		>({
			url: "ws://test",
			transport,
			binaryType: "arraybuffer",
			serialize: (msg) => encodeMsg(msg),
			deserialize: (raw) => decodeMsg<TBinaryServer>(raw),
		});

		manager.connect();
		transport.simulateOpen();

		manager.send({ data: { type: "payload", size: 1024 } });

		expect(transport.sentMessages).toHaveLength(1);
		const sent = transport.sentMessages[0];
		expect(sent).toBeInstanceOf(ArrayBuffer);
		expect(decodeMsg(sent)).toEqual({
			type: "payload",
			size: 1024,
		});
	});

	it("plumbs binaryType into the transport instance", () => {
		const transport = new MockTransport<ArrayBuffer>();
		new WebSocketManager<
			TBinaryClient,
			TBinaryServer,
			"type",
			ArrayBuffer,
			ArrayBuffer
		>({
			url: "ws://test",
			transport,
			binaryType: "arraybuffer",
			serialize: (msg) => encodeMsg(msg),
			deserialize: (raw) => decodeMsg<TBinaryServer>(raw),
		});

		expect(transport.binaryType).toBe("arraybuffer");
	});

	it("delivers ArrayBuffer messages to listeners", () => {
		const transport = new MockTransport<ArrayBuffer>();
		const received: TBinaryServer[] = [];

		const manager = new WebSocketManager<
			TBinaryClient,
			TBinaryServer,
			"type",
			ArrayBuffer,
			ArrayBuffer
		>({
			url: "ws://test",
			transport,
			binaryType: "arraybuffer",
			serialize: (msg) => encodeMsg(msg),
			deserialize: (raw) => decodeMsg<TBinaryServer>(raw),
		});

		manager.addMessageListener((msg) => received.push(msg));
		manager.connect();
		transport.simulateOpen();

		// Simulate a binary frame coming in
		const event = new MessageEvent("message", {
			data: encodeMsg({ type: "payload", size: 4096 }),
		});
		transport.onmessage?.(event);

		expect(received).toEqual([{ type: "payload", size: 4096 }]);
	});

	it("supports mixed string + binary wire types via the union", () => {
		const transport = new MockTransport<string | ArrayBuffer>();
		type TMixedClient = { type: "text"; text: string } | { type: "blob" };
		type TMixedServer = { type: "text"; text: string };

		const manager = new WebSocketManager<
			TMixedClient,
			TMixedServer,
			"type",
			string | ArrayBuffer,
			string | ArrayBuffer
		>({
			url: "ws://test",
			transport,
			binaryType: "arraybuffer",
			serialize: (msg) =>
				msg.type === "blob" ? new ArrayBuffer(8) : JSON.stringify(msg),
			deserialize: (raw) =>
				typeof raw === "string"
					? (JSON.parse(raw) as TMixedServer)
					: { type: "text", text: "[binary]" },
		});

		manager.connect();
		transport.simulateOpen();

		manager.send({ data: { type: "text", text: "hello" } });
		manager.send({ data: { type: "blob" } });

		expect(transport.sentMessages).toHaveLength(2);
		const textWire = transport.sentMessages[0];
		expect(typeof textWire).toBe("string");
		expect(JSON.parse(textWire as string)).toEqual({
			type: "text",
			text: "hello",
		});
		expect(transport.sentMessages[1]).toBeInstanceOf(ArrayBuffer);
	});

	it("emits deserialize-error with binary raw payload", () => {
		const transport = new MockTransport<ArrayBuffer>();
		const errors: { raw: ArrayBuffer | string; error: unknown }[] = [];

		const manager = new WebSocketManager<
			TBinaryClient,
			TBinaryServer,
			"type",
			ArrayBuffer,
			ArrayBuffer
		>({
			url: "ws://test",
			transport,
			binaryType: "arraybuffer",
			serialize: (msg) => encodeMsg(msg),
			deserialize: (_raw) => {
				throw new Error("decode failed");
			},
			onDebug(event) {
				if (event.type === "deserialize-error") {
					errors.push({ raw: event.raw as ArrayBuffer, error: event.error });
				}
			},
		});

		manager.connect();
		transport.simulateOpen();

		const event = new MessageEvent("message", {
			data: new ArrayBuffer(4),
		});
		transport.onmessage?.(event);

		expect(errors).toHaveLength(1);
		expect(errors[0].raw).toBeInstanceOf(ArrayBuffer);
	});
});
