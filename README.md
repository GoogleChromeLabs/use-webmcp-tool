# Use-Webmcp-Tool

A hook that registers a [WebMCP](https://github.com/webmachinelearning/webmcp) tool with the browser and ties its lifecycle to a React component.

> This is maintained by Chrome, and will be updated with any spec changes. The spec is `🧪` experimental, so the hook feature-detects and degrades to a no-op everywhere the API is absent.

**Status / accuracy note (2026-06-05):** Built against the current WebMCP spec, which exposes the imperative API on **`document.modelContext`** (`registerTool` + an `AbortSignal` for unregistration).

---

## Install

```bash
npm install use-webmcp-tool
```

Requires React 18+ as a peer dependency. Ships as ESM with TypeScript types included — no runtime dependencies.

---

## What it does

WebMCP lets a page expose JavaScript functions as "tools" that an AI agent (browser-built-in, iframe-hosted, or extension) can discover and call. The site author can expose functionality, and the agent uses this instead of scraping the DOM, a11y tree, or using screenshots.

The raw imperative API looks like this:

```js
const controller = new AbortController();

document.modelContext.registerTool({
  name: "add-todo",
  description: "Add a new item to the user's active todo list",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The text content of the todo item" },
    },
    required: ["text"],
  },
  async execute({ text }) {
    await addTodoItemToCollection(text);
    return { content: [{ type: "text", text: `Added todo item: "${text}" successfully.` }] };
  },
}, { signal: controller.signal });

// Unregister later:
controller.abort();
```

`useWebMCP` wraps that imperative, lifecycle-bound API in the declarative, lifecycle-managed model React developers already use for everything else:

```jsx
import { useWebMCP } from "use-webmcp-tool";

function TodoTools({ addTodo }) {
  const { supported, registered } = useWebMCP({
    name: "add-todo",
    description: "Add a new item to the user's active todo list",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text content of the todo item" },
      },
      required: ["text"],
    },
    async execute({ text }) {
      addTodo(text);
      return `Added todo item: "${text}" successfully.`;
    },
  });

  if (!supported) return null;
  return <p>{registered ? "🤖 Agent tools ready" : "…"}</p>;
}
```

The tool is registered when the component mounts and **unregistered automatically when it unmounts**. This is designed so that the set of tools an agent sees stays in lockstep with what is actually on screen.

---

## API

```ts
const { supported, registered, error } = useWebMCP({
  name,           // string — tool identifier (required)
  description,    // string — natural-language description for the agent (required)
  inputSchema,    // JSON Schema object describing args (optional)
  annotations,    // WebMCP.ToolAnnotations object with readOnlyHint/untrustedContentHint/consequentialHint (optional)
  execute,        // (args, { signal }) => result | Promise<result> (required)
  enabled = true, // boolean — register only while true
  pending = false, // boolean — while true, tell the browser the tools aren't ready yet
  formatOutput,   // (result, args) => any — optional shaper before MCP normalization
  onError,        // (error) => void — optional side-effect when execute throws
});
```

**Returns**

| field        | type             | meaning                                                              |
| ------------ | ---------------- | -------------------------------------------------------------------- |
| `supported`  | `boolean`        | `document.modelContext` exists in this environment.                  |
| `registered` | `boolean`        | The tool is currently registered with the browser.                   |
| `error`      | `Error \| null`  | Registration error, e.g. `NotAllowedError` from a `tools` permissions policy. |

**`execute` parameters & return values**:

`execute` receives `(args, { signal })`, where `signal` is an [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) provided by the browser/agent to handle cancellation if the call is aborted or timed out.

Return values are normalized:

- a **string** → `{ content: [{ type: "text", text }] }`
- **`undefined`/`null`** (no return) → `{ content: [] }` (success, no payload)
- a value that is **already** `{ content: [...] }` → passed through untouched
- a **thrown value** — Error or not (`throw "not signed in"`, `throw { code: 403 }` both count) → `{ content: [{ type: "text", text }], isError: true }`, after `onError`. A failure must never read as success to the agent.
- a **returned `Error`** → treated exactly like a throw: `onError` fires, then an `isError` result
- a throw or rejection **after `signal` aborts** → rethrown as is, without `onError`: a cancelled call is not a tool error
- anything else (object/array/number) → JSON-serialized into a text block

**Tool readiness (`pending`)**:

Where the browser supports `document.modelContext.waitForToolsUntil()`, the hook uses it to tell the browser when the page's tools aren't ready yet, so the agent doesn't act on an incomplete set:

- each registration counts as "not ready" until `registerTool()` settles (automatic)
- while `pending` is `true`, the hook keeps tools "not ready", e.g. while the page is still loading. Releases when `pending` turns `false` or the component unmounts. The browser also gives up waiting after its own timeout.

```jsx
const { isLoading } = useCatalog();
useWebMCP({
  name: "search-products",
  description: "Search the product catalog",
  pending: isLoading,
  execute: ({ query }) => searchProducts(query),
});
```

Where `waitForToolsUntil` isn't available, this does nothing. Its exceptions are ignored, since readiness is only a hint.

---

## Tests

[`useWebMCP.test.jsx`](./useWebMCP.test.jsx) (vitest + jsdom + `@testing-library/react`, 42 tests) covers the registration lifecycle (mount/unmount, StrictMode, `enabled`, late injection, registration errors), re-registration identity (execute changes don't churn, content-equal schemas don't churn, name changes do), tool readiness (`waitForToolsUntil` for registrations and `pending`, feature detection, ignored exceptions), options and cancellation signals (`execute(args, { signal })`), and the full result/error normalization matrix including thrown non-Errors and returned `Error`s.

Run with `npm install && npm test`.