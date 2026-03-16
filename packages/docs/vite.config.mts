import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
	server: {
		port: 3000,
		open: true,
	},
	resolve: {
		alias: {
			"@luciodale/react-socket": resolve(__dirname, "../library/src"),
		},
	},
});
