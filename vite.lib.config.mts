import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
	plugins: [
		react(),
		dts({
			entryRoot: "packages/library/src",
			include: ["packages/library/src/**/*"],
			exclude: [
				"packages/library/src/**/*.test.ts",
				"packages/library/src/**/*.test.tsx",
				"packages/library/src/__tests__/**",
			],
			tsconfigPath: "packages/library/tsconfig.json",
		}),
	],
	build: {
		outDir: "packages/library/dist",
		emptyOutDir: true,
		lib: {
			name: "LucioDaleReactSocket",
			entry: resolve(__dirname, "packages/library/src/index.ts"),
			formats: ["es", "umd"],
			fileName: (format) => `react-socket.${format}.js`,
		},
		rollupOptions: {
			external: ["react", "react-dom"],
			output: {
				globals: {
					react: "React",
					"react-dom": "ReactDOM",
				},
			},
		},
	},
});
