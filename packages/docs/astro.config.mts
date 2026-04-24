import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

const isBuild = process.argv.includes("build");

export default defineConfig({
	site: "https://koolcodez.com",
	base: "/projects/react-socket",
	output: "server",
	adapter: cloudflare({
		imageService: "passthrough",
		prerenderEnvironment: "node",
	}),
	integrations: [react(), sitemap()],
	vite: {
		plugins: [tailwindcss()],
		resolve: {
			// Force a single React copy across the docs app and the workspace
			// library. Without this, hooks fail with "Invalid hook call" because
			// the library bundle resolves `react` from packages/library/node_modules
			// while the docs app uses packages/docs/node_modules.
			dedupe: ["react", "react-dom"],
			...(isBuild
				? { alias: { "react-dom/server": "react-dom/server.edge" } }
				: {}),
		},
	},
});
