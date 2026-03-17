import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionState } from "../../../hooks";
import { WebSocketManager } from "../../../manager";
import { MockTransport } from "../../helpers/mock-transport";

function createTestManager() {
	const transport = new MockTransport();
	const manager = new WebSocketManager<
		Record<string, unknown>,
		Record<string, unknown>
	>({
		url: "ws://test",
		transport,
		serialize: (msg) => JSON.stringify(msg),
		deserialize: (raw) => JSON.parse(raw) as Record<string, unknown>,
	});
	return { manager, transport };
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("useConnectionState", () => {
	it("returns current connection state and updates reactively", () => {
		const { manager, transport } = createTestManager();

		const { result } = renderHook(() => useConnectionState(manager));
		expect(result.current).toBe("disconnected");

		act(() => {
			manager.connect();
		});
		expect(result.current).toBe("connecting");

		act(() => {
			transport.simulateOpen();
		});
		expect(result.current).toBe("connected");

		act(() => {
			manager.disconnect();
		});
		expect(result.current).toBe("disconnected");
	});
});
