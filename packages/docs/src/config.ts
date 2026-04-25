import type { SiteConfig } from "@luciodale/docs-ui-kit/types/config";

export const siteConfig: SiteConfig = {
	title: "react-socket",
	description:
		"A TypeScript-first WebSocket manager for React. Handles the socket plumbing you don't want to build: reconnection, deduped subscriptions, in-flight tracking, and keep-alive. Your protocol, your state management, your rules.",
	siteUrl: "https://koolcodez.com/projects/react-socket",
	logoSrc: "/logo.svg",
	logoAlt: "react-socket logo",
	ogImage: "/og-image.png",
	installCommand: "npm install @luciodale/react-socket",
	githubUrl: "https://github.com/luciodale/react-socket",
	author: "Lucio D'Alessandro",
	socialLinks: {
		github: "https://github.com/luciodale",
		linkedin: "https://www.linkedin.com/in/luciodale",
	},
	navLinks: [
		{ href: "/docs/getting-started", label: "Docs" },
		{ href: "/demo/fire-and-forget", label: "Examples" },
	],
	sidebarSections: [
		{
			title: "Getting Started",
			links: [
				{ href: "/docs/getting-started", label: "Introduction" },
				{ href: "/docs/configuration", label: "Configuration" },
				{ href: "/docs/api", label: "API Reference" },
			],
		},
		{
			title: "Guides",
			links: [
				{ href: "/docs/patterns", label: "Patterns" },
				{ href: "/docs/subscriptions", label: "Subscriptions" },
				{ href: "/docs/optimistic-updates", label: "Sending Messages" },
				{ href: "/docs/reconnection", label: "Reconnection" },
				{ href: "/docs/auth", label: "Authentication" },
				{ href: "/docs/error-handling", label: "Error handling" },
				{ href: "/docs/testing", label: "Testing" },
				{ href: "/docs/binary", label: "Binary frames" },
				{ href: "/docs/backpressure", label: "Backpressure" },
				{ href: "/docs/monitoring", label: "Monitoring" },
				{ href: "/docs/undelivered-sync", label: "Undelivered Sync" },
			],
		},
		{
			title: "Examples",
			links: [
				{ href: "/demo/in-component-echo", label: "In-Component Echo" },
				{ href: "/demo/fire-and-forget", label: "Fire and Forget" },
				{ href: "/demo/chat-room", label: "Chat Room" },
				{ href: "/demo/llm-streaming", label: "LLM Streaming" },
				{ href: "/demo/undelivered-sync", label: "Undelivered Sync" },
				{ href: "/demo/auth-refresh", label: "First-message auth" },
				{ href: "/demo/multi-connection", label: "Multiple connections" },
				{ href: "/demo/high-frequency-stream", label: "High-frequency stream" },
				{ href: "/demo/inspector", label: "Inspector" },
			],
		},
		{
			title: "Comparison",
			links: [
				{
					href: "/docs/vs-react-use-websocket",
					label: "vs react-use-websocket",
				},
				{ href: "/docs/vs-socket-io", label: "vs Socket.IO" },
			],
		},
		{
			title: "Migrate",
			links: [
				{
					href: "/docs/migrate-from-react-use-websocket",
					label: "from react-use-websocket",
				},
				{
					href: "/docs/migrate-from-socket-io",
					label: "from socket.io-client",
				},
			],
		},
	],
	copyright: "Lucio D'Alessandro",
	parentSite: {
		href: "https://koolcodez.com/projects",
		label: "koolcodez",
		logoSrc: "/projects/react-socket/kool-codez-illustration.svg",
	},
};
