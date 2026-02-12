import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [tailwindcss(), react()],
	test: {
		environment: "jsdom",
		globals: true,
	},
});
