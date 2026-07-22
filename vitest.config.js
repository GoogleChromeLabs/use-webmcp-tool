/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the “License”);
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an “AS IS” BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
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
