import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./worker/src/index.mjs",
      miniflare: {
        compatibilityDate: "2026-09-07",
        compatibilityFlags: ["nodejs_compat"],
        bindings: {
          AI_GATEWAY_ID: "context-shunt",
          MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
        },
      },
    }),
  ],
  test: {
    include: ["tests/worker-runtime.vitest.mjs"],
  },
});
