import type { IWebSocketTransport, TWireData } from "./types";

export class BrowserWebSocketTransport implements IWebSocketTransport {
	private ws: WebSocket | null = null;

	binaryType?: "blob" | "arraybuffer";

	onopen: ((event: Event) => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;

	get readyState(): number {
		return this.ws?.readyState ?? WebSocket.CLOSED;
	}

	connect(url: string, protocols?: string | string[]): void {
		this.ws = new WebSocket(url, protocols);
		const current = this.ws;
		if (this.binaryType) {
			current.binaryType = this.binaryType;
		}
		current.onopen = (e) => {
			if (this.ws !== current) return;
			this.onopen?.(e);
		};
		current.onclose = (e) => {
			if (this.ws !== current) return;
			this.onclose?.(e);
		};
		current.onmessage = (e) => {
			if (this.ws !== current) return;
			this.onmessage?.(e);
		};
		current.onerror = (e) => {
			if (this.ws !== current) return;
			this.onerror?.(e);
		};
	}

	disconnect(code?: number, reason?: string): void {
		const ws = this.ws;
		this.ws = null;
		ws?.close(code, reason);
	}

	send(data: TWireData): void {
		this.ws?.send(data);
	}
}

export function createTransport(): IWebSocketTransport {
	return new BrowserWebSocketTransport();
}
