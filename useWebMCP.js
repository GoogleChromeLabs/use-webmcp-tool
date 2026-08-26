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

import * as React from "react";

// Stringify for error reporting without ever throwing itself
// (JSON.stringify throws on circular references and BigInt).
function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// Normalizes whatever `execute` returns into an MCP tool result so callers can
// return a plain string/object and still hand the agent a valid response.
function toToolResponse(value) {
  // Already a well-formed MCP tool result — pass it through untouched.
  if (value && typeof value === "object" && Array.isArray(value.content)) {
    return value;
  }

  // `execute` returned nothing — report a successful, empty result.
  if (value === undefined || value === null) {
    return { content: [] };
  }

  // Strings map directly to a single text block.
  if (typeof value === "string") {
    return { content: [{ type: "text", text: value }] };
  }

  // Anything else (objects, arrays, numbers) is serialized to JSON text.
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

// Every failure becomes an explicit `isError` result, whatever was thrown —
// a thrown string or plain object must not read as success to the agent.
function toErrorResponse(error) {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : safeStringify(error);
  return { content: [{ type: "text", text }], isError: true };
}

export function useWebMCP(options) {
  return useWebMCPTools([options]);
}

export function useWebMCPTools(tools) {
  const [state, setState] = React.useState({
    supported: false,
    registered: false,
    error: null,
  });

  // Keep the latest tool callbacks in a ref so changing closures (which capture
  // props/state) do not force tools to unregister and re-register every render.
  const toolsRef = React.useRef(tools);

  React.useEffect(() => {
    toolsRef.current = tools;
  });

  // Only the parts an agent discovers should trigger re-registration. Schemas
  // and annotations are serialized so inline object literals don't churn every
  // render. (Key-order sensitive: `{a, b}` vs `{b, a}` re-registers even though
  // the objects are semantically identical — pass stable literals.)
  const registrationKey = JSON.stringify(
    tools.map(
      ({ name, description, inputSchema, annotations, enabled = true }) => ({
        name,
        description,
        inputSchema,
        annotations,
        enabled,
      })
    )
  );

  // `document.modelContext` is typically injected by a browser extension,
  // whose content script may run after this component mounts. Bumped when a
  // late injection is detected so the registration effect re-runs.
  const [detectTick, redetect] = React.useReducer((n) => n + 1, 0);

  React.useEffect(() => {
    const supported =
      typeof document !== "undefined" && Boolean(document.modelContext);

    if (!supported) {
      setState({ supported: false, registered: false, error: null });

      // Re-check briefly for a late-injected API instead of reporting
      // `supported: false` forever. Gives up after 10 seconds.
      if (typeof document === "undefined") return;
      let attempts = 0;
      const timer = setInterval(() => {
        if (document.modelContext) {
          clearInterval(timer);
          redetect();
        } else if (++attempts >= 20) {
          clearInterval(timer);
        }
      }, 500);
      return () => clearInterval(timer);
    }

    const enabledTools = toolsRef.current.filter(
      ({ enabled = true }) => enabled
    );

    if (enabledTools.length === 0) {
      setState({ supported: true, registered: false, error: null });
      return;
    }

    const controller = new AbortController();

    try {
      const names = new Set();

      for (const tool of enabledTools) {
        const { name, description, inputSchema, annotations } = tool;

        if (names.has(name)) {
          throw new Error(`Duplicate WebMCP tool name: ${name}`);
        }
        names.add(name);

        document.modelContext.registerTool(
          {
            name,
            description,
            inputSchema,
            annotations,
            async execute(args) {
              // Look up the latest callbacks by name without changing the
              // tool's registration identity.
              const currentTool =
                toolsRef.current.find((candidate) => candidate.name === name) ??
                tool;

              try {
                const result = await currentTool.execute(args);
                const format = currentTool.formatOutput;
                const shaped = format ? format(result, args) : result;
                // A returned Error gets the same treatment as a thrown one:
                // `onError`, then an `isError` result.
                if (shaped instanceof Error) throw shaped;
                return toToolResponse(shaped);
              } catch (error) {
                if (currentTool.onError) {
                  currentTool.onError(error);
                }
                return toErrorResponse(error);
              }
            },
          },
          { signal: controller.signal }
        );
      }

      setState({ supported: true, registered: true, error: null });
    } catch (error) {
      // Registration is atomic from the hook's perspective. If any tool fails,
      // remove the tools that were already registered in this batch.
      controller.abort();
      // e.g. NotAllowedError when the `tools` permissions policy is disabled.
      setState({
        supported: true,
        registered: false,
        error: error instanceof Error ? error : new Error(safeStringify(error)),
      });
    }

    // Aborting the signal is how WebMCP unregisters a tool, so this runs on
    // unmount and before every batch re-registration.
    return () => {
      controller.abort();
    };
    // `registrationKey` captures discoverable metadata and `enabled` state by
    // content; callback fields are read through `toolsRef` by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registrationKey, detectTick]);

  return state;
}
