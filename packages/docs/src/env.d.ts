/// <reference types="astro/client" />

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
	interface Locals extends Runtime {}
}

// biome-ignore lint/complexity/noBannedTypes: CF Workers env bindings placeholder
type Env = {};

// Cloudflare Workers WebSocket API
declare class WebSocketPair {
	0: WebSocket;
	1: WebSocket;
}
