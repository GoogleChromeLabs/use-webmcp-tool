/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The demo imports the hook the way sandbox users would; point that at the
    // local source so the demo is testable here.
    alias: {
      "@uidotdev/usehooks": new URL("./useWebMCP.js", import.meta.url).pathname,
    },
  },
  test: {
    environment: "jsdom",
    // Testing-library's automatic DOM cleanup between tests hooks into a
    // global afterEach.
    globals: true,
  },
  esbuild: {
    jsx: "automatic",
  },
});
