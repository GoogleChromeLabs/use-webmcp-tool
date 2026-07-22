/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type WebMCPToolResponse = {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
};

export type ToolAnnotations = {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
};

export type WebMCPOptions<Args, Result> = {
  name: string;
  description: string;
  inputSchema?: object;
  annotations?: ToolAnnotations;
  execute: (args: Args) => Result | Promise<Result>;
  enabled?: boolean;
  formatOutput?: (result: Result, args: Args) => unknown;
  onError?: (error: unknown) => void;
};

export type WebMCPState = {
  supported: boolean;
  registered: boolean;
  error: Error | null;
};

export function useWebMCP<
  Args = Record<string, unknown>,
  Result = unknown
>(options: WebMCPOptions<Args, Result>): WebMCPState;
