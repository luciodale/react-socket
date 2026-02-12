import type { IWebSocketTransport } from "./types";

export class BrowserWebSocketTransport implements IWebSocketTransport {
	private ws: WebSocket | null = null;

	onopen: ((event: Event) => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;

	get readyState(): number {
		return this.ws?.readyState ?? WebSocket.CLOSED;
	}

	connect(url: string, protocols?: string | string[]): void {
		this.ws = new WebSocket(url, protocols);
		this.ws.onopen = (e) => this.onopen?.(e);
		this.ws.onclose = (e) => this.onclose?.(e);
		this.ws.onmessage = (e) => this.onmessage?.(e);
		this.ws.onerror = (e) => this.onerror?.(e);
	}

	disconnect(code?: number, reason?: string): void {
		this.ws?.close(code, reason);
		this.ws = null;
	}

	send(data: string): void {
		this.ws?.send(data);
	}
}

export function createTransport(): IWebSocketTransport {
	return new BrowserWebSocketTransport();
}
