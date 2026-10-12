import { defineConfig } from "vitest/config";

export default defineConfig({ test: { environment: "node", include: ["convex/lib/**/*.test.ts"] } });
