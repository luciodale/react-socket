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
			entry: {
				"react-socket": "packages/library/src/index.ts",
				"react-socket-inspector": "packages/library/src/inspector/index.ts",
			},
			formats: ["es"],
			fileName: (_format, entryName) => `${entryName}.es.js`,
		},
		rollupOptions: {
			external: ["react", "react-dom", "react/jsx-runtime"],
			output: {
				globals: {
					react: "React",
					"react-dom": "ReactDOM",
				},
			},
		},
	},
});
