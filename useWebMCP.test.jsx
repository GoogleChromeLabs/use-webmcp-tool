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
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useWebMCP } from "./useWebMCP.js";

// Minimal fake of the provider side of document.modelContext: registerTool +
// AbortSignal unregistration, mirroring both the explainer and Chrome's
// extension (whose registerTool matches the explainer).
function installFakeModelContext() {
  const tools = new Map();
  const registerTool = vi.fn((tool, options = {}) => {
    tools.set(tool.name, tool);
    if (options.signal) {
      options.signal.addEventListener("abort", () => {
        if (tools.get(tool.name) === tool) tools.delete(tool.name);
      });
    }
  });
  document.modelContext = { registerTool };
  return { tools, registerTool };
}

const baseOptions = {
  name: "add-todo",
  description: "Add a todo",
  inputSchema: { type: "object", properties: { text: { type: "string" } } },
};

afterEach(() => {
  delete document.modelContext;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("registration lifecycle", () => {
  it("registers on mount and unregisters (via abort) on unmount", () => {
    const { tools, registerTool } = installFakeModelContext();
    const { result, unmount } = renderHook(() =>
      useWebMCP({ ...baseOptions, execute: () => "ok" })
    );

    expect(result.current).toEqual({
      supported: true,
      registered: true,
      error: null,
    });
    expect(registerTool).toHaveBeenCalledTimes(1);
    const [tool] = registerTool.mock.calls[0];
    expect(tool.name).toBe("add-todo");
    expect(tool.description).toBe("Add a todo");
    expect(tool.inputSchema).toEqual(baseOptions.inputSchema);

    unmount();
    expect(tools.size).toBe(0);
  });

  it("passes annotations through to registerTool", () => {
    const { registerTool } = installFakeModelContext();
    const annotations = {
      readOnlyHint: true,
      untrustedContentHint: false,
      consequentialHint: false,
    };
    renderHook(() =>
      useWebMCP({ ...baseOptions, annotations, execute: () => "ok" })
    );

    expect(registerTool).toHaveBeenCalledTimes(1);
    const [tool] = registerTool.mock.calls[0];
    expect(tool.annotations).toEqual(annotations);
  });

  it("reports supported: false when document.modelContext is absent", () => {
    const { result } = renderHook(() =>
      useWebMCP({ ...baseOptions, execute: () => "ok" })
    );
    expect(result.current).toEqual({
      supported: false,
      registered: false,
      error: null,
    });
  });

  it("registers exactly one live tool under StrictMode", () => {
    const { tools, registerTool } = installFakeModelContext();
    const { result } = renderHook(
      () => useWebMCP({ ...baseOptions, execute: () => "ok" }),
      { wrapper: React.StrictMode }
    );

    // StrictMode mounts twice; the first registration must have been aborted.
    expect(registerTool).toHaveBeenCalledTimes(2);
    expect(tools.size).toBe(1);
    expect(result.current.registered).toBe(true);
  });

  it("honors the enabled flag, registering only while true", () => {
    const { tools } = installFakeModelContext();
    const { result, rerender } = renderHook(
      ({ enabled }) => useWebMCP({ ...baseOptions, enabled, execute: () => "ok" }),
      { initialProps: { enabled: false } }
    );

    expect(result.current).toEqual({
      supported: true,
      registered: false,
      error: null,
    });
    expect(tools.size).toBe(0);

    rerender({ enabled: true });
    expect(result.current.registered).toBe(true);
    expect(tools.size).toBe(1);

    rerender({ enabled: false });
    expect(result.current.registered).toBe(false);
    expect(tools.size).toBe(0);
  });

  it("detects document.modelContext injected after mount", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useWebMCP({ ...baseOptions, execute: () => "ok" })
    );
    expect(result.current.supported).toBe(false);

    installFakeModelContext();
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current).toEqual({
      supported: true,
      registered: true,
      error: null,
    });
  });

  it("stops probing for a late-injected API after 10 seconds", () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const { result } = renderHook(() =>
      useWebMCP({ ...baseOptions, execute: () => "ok" })
    );

    act(() => {
      vi.advanceTimersByTime(11_000);
    });
    expect(result.current.supported).toBe(false);
    expect(setIntervalSpy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("surfaces a registration error, wrapping non-Error throws", () => {
    document.modelContext = {
      registerTool: () => {
        throw "NotAllowedError-ish string";
      },
    };
    const { result } = renderHook(() =>
      useWebMCP({ ...baseOptions, execute: () => "ok" })
    );

    expect(result.current.supported).toBe(true);
    expect(result.current.registered).toBe(false);
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error.message).toContain("NotAllowedError-ish");
  });
});

describe("re-registration identity", () => {
  it("does not re-register when only the execute closure changes, but calls the latest one", async () => {
    const { tools, registerTool } = installFakeModelContext();
    const { rerender } = renderHook(
      ({ execute }) => useWebMCP({ ...baseOptions, execute }),
      { initialProps: { execute: () => "first" } }
    );

    rerender({ execute: () => "second" });
    expect(registerTool).toHaveBeenCalledTimes(1);

    const response = await tools.get("add-todo").execute({});
    expect(response).toEqual({ content: [{ type: "text", text: "second" }] });
  });

  it("does not re-register for a new inputSchema object with identical content", () => {
    const { registerTool } = installFakeModelContext();
    const schema = () => ({
      type: "object",
      properties: { text: { type: "string" } },
    });
    const { rerender } = renderHook(
      ({ inputSchema }) =>
        useWebMCP({ ...baseOptions, inputSchema, execute: () => "ok" }),
      { initialProps: { inputSchema: schema() } }
    );

    rerender({ inputSchema: schema() });
    expect(registerTool).toHaveBeenCalledTimes(1);
  });

  it("does not re-register for a new annotations object with identical content", () => {
    const { registerTool } = installFakeModelContext();
    const annots = () => ({ readOnlyHint: true });
    const { rerender } = renderHook(
      ({ annotations }) =>
        useWebMCP({ ...baseOptions, annotations, execute: () => "ok" }),
      { initialProps: { annotations: annots() } }
    );

    rerender({ annotations: annots() });
    expect(registerTool).toHaveBeenCalledTimes(1);
  });

  it("re-registers when annotations change", () => {
    const { registerTool } = installFakeModelContext();
    const { rerender } = renderHook(
      ({ annotations }) =>
        useWebMCP({ ...baseOptions, annotations, execute: () => "ok" }),
      { initialProps: { annotations: { readOnlyHint: true } } }
    );

    rerender({ annotations: { readOnlyHint: false } });
    expect(registerTool).toHaveBeenCalledTimes(2);
  });

  it("re-registers when the tool's discoverable identity changes", () => {
    const { tools, registerTool } = installFakeModelContext();
    const { rerender } = renderHook(
      ({ name }) => useWebMCP({ ...baseOptions, name, execute: () => "ok" }),
      { initialProps: { name: "add-todo" } }
    );

    rerender({ name: "add-item" });
    expect(registerTool).toHaveBeenCalledTimes(2);
    expect(tools.has("add-todo")).toBe(false);
    expect(tools.has("add-item")).toBe(true);
  });
});

describe("result normalization", () => {
  async function executeWith(hookOptions, args = {}) {
    const { tools } = installFakeModelContext();
    renderHook(() => useWebMCP({ ...baseOptions, ...hookOptions }));
    return tools.get("add-todo").execute(args);
  }

  it("wraps a returned string in a text content block", async () => {
    const response = await executeWith({ execute: () => "Added!" });
    expect(response).toEqual({ content: [{ type: "text", text: "Added!" }] });
  });

  it("treats undefined/null returns as an empty successful result", async () => {
    expect(await executeWith({ execute: () => { } })).toEqual({ content: [] });
    expect(await executeWith({ execute: () => null })).toEqual({ content: [] });
  });

  it("passes through an already well-formed MCP result untouched", async () => {
    const canonical = { content: [{ type: "text", text: "hi" }], isError: false };
    const response = await executeWith({ execute: () => canonical });
    expect(response).toBe(canonical);
  });

  it("JSON-serializes objects and numbers into a text block", async () => {
    expect(await executeWith({ execute: () => ({ id: 7 }) })).toEqual({
      content: [{ type: "text", text: '{"id":7}' }],
    });
    expect(await executeWith({ execute: () => 42 })).toEqual({
      content: [{ type: "text", text: "42" }],
    });
  });

  it("applies formatOutput before normalization", async () => {
    const response = await executeWith(
      {
        execute: () => ({ id: 7 }),
        formatOutput: (result, args) => `#${result.id} for ${args.who}`,
      },
      { who: "sarah" }
    );
    expect(response).toEqual({
      content: [{ type: "text", text: "#7 for sarah" }],
    });
  });
});

describe("error normalization", () => {
  async function executeWith(hookOptions, args = {}) {
    const { tools } = installFakeModelContext();
    renderHook(() => useWebMCP({ ...baseOptions, ...hookOptions }));
    return tools.get("add-todo").execute(args);
  }

  it("turns a thrown Error into an isError result and calls onError", async () => {
    const onError = vi.fn();
    const boom = new Error("nope");
    const response = await executeWith({
      execute: () => {
        throw boom;
      },
      onError,
    });
    expect(response).toEqual({
      content: [{ type: "text", text: "nope" }],
      isError: true,
    });
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it("marks a thrown non-Error string as isError, not success", async () => {
    const response = await executeWith({
      execute: () => {
        throw "not signed in";
      },
    });
    expect(response).toEqual({
      content: [{ type: "text", text: "not signed in" }],
      isError: true,
    });
  });

  it("marks a thrown plain object as isError with its JSON as text", async () => {
    const response = await executeWith({
      execute: () => {
        throw { code: 403 };
      },
    });
    expect(response).toEqual({
      content: [{ type: "text", text: '{"code":403}' }],
      isError: true,
    });
  });

  it("treats a returned Error like a thrown one: isError and onError", async () => {
    const onError = vi.fn();
    const boom = new Error("returned, not thrown");
    const response = await executeWith({ execute: () => boom, onError });
    expect(response).toEqual({
      content: [{ type: "text", text: "returned, not thrown" }],
      isError: true,
    });
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it("turns a rejected async execute into an isError result", async () => {
    const response = await executeWith({
      execute: async () => Promise.reject(new Error("async nope")),
    });
    expect(response).toEqual({
      content: [{ type: "text", text: "async nope" }],
      isError: true,
    });
  });

  it("reports an unserializable (circular) return as an error, not a crash", async () => {
    const circular = {};
    circular.self = circular;
    const response = await executeWith({ execute: () => circular });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/circular/i);
  });
});

describe("execute options and signal", () => {
  it("forwards args and options (including signal) to execute", async () => {
    const { tools } = installFakeModelContext();
    const executeSpy = vi.fn((args, options) => `done: ${args.text}`);
    renderHook(() => useWebMCP({ ...baseOptions, execute: executeSpy }));

    const controller = new AbortController();
    const response = await tools
      .get("add-todo")
      .execute({ text: "buy milk" }, { signal: controller.signal });

    expect(executeSpy).toHaveBeenCalledWith(
      { text: "buy milk" },
      { signal: controller.signal }
    );
    expect(response).toEqual({
      content: [{ type: "text", text: "done: buy milk" }],
    });
  });

  it("works when execute is called without options", async () => {
    const { tools } = installFakeModelContext();
    const executeSpy = vi.fn((args) => "ok");
    renderHook(() => useWebMCP({ ...baseOptions, execute: executeSpy }));

    const response = await tools.get("add-todo").execute({ text: "buy milk" });
    expect(executeSpy).toHaveBeenCalledWith({ text: "buy milk" }, undefined);
    expect(response).toEqual({
      content: [{ type: "text", text: "ok" }],
    });
  });

  it("allows execute to react to signal abortion", async () => {
    const { tools } = installFakeModelContext();
    const controller = new AbortController();

    const execute = vi.fn(async (args, { signal }) => {
      if (signal.aborted) {
        throw new Error("aborted before start");
      }
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(new Error("aborted during execution"));
        });
      });
    });

    renderHook(() => useWebMCP({ ...baseOptions, execute }));

    const promise = tools
      .get("add-todo")
      .execute({ text: "buy milk" }, { signal: controller.signal });

    controller.abort();
    const response = await promise;

    expect(response).toEqual({
      content: [{ type: "text", text: "aborted during execution" }],
      isError: true,
    });
  });

  it("handles AbortError thrown via signal.throwIfAborted()", async () => {
    const { tools } = installFakeModelContext();
    const onError = vi.fn();
    const controller = new AbortController();
    controller.abort();

    const execute = vi.fn((args, { signal }) => {
      signal.throwIfAborted();
      return "never reached";
    });

    renderHook(() => useWebMCP({ ...baseOptions, execute, onError }));

    const response = await tools
      .get("add-todo")
      .execute({}, { signal: controller.signal });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/aborted/i);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].name).toBe("AbortError");
  });

  it("forwards options to the updated execute closure after re-render", async () => {
    const { tools } = installFakeModelContext();
    const firstExecute = vi.fn(() => "first");
    const secondExecute = vi.fn((args, options) => `second: ${args.text}`);
    const { rerender } = renderHook(
      ({ execute }) => useWebMCP({ ...baseOptions, execute }),
      { initialProps: { execute: firstExecute } }
    );

    rerender({ execute: secondExecute });

    const controller = new AbortController();
    const response = await tools
      .get("add-todo")
      .execute({ text: "buy milk" }, { signal: controller.signal });

    expect(firstExecute).not.toHaveBeenCalled();
    expect(secondExecute).toHaveBeenCalledWith(
      { text: "buy milk" },
      { signal: controller.signal }
    );
    expect(response).toEqual({
      content: [{ type: "text", text: "second: buy milk" }],
    });
  });
});
