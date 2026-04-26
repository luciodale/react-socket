import { defineConfig } from "vitest/config";
export default defineConfig({
    test: {
        include: ["packages/library/src/**/*.test.ts"],
        environment: "jsdom",
        globals: true,
    },
});
