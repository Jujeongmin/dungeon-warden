import { defineConfig } from "vitest/config";

// The simulation and its helpers are pure TypeScript with no DOM, so the
// default node environment is all they need. Tests live outside src/ so the
// production build never sees them.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
