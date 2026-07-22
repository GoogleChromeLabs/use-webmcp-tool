export type WebMCPToolResponse = {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
};

export type WebMCPOptions<Args, Result> = {
  name: string;
  description: string;
  inputSchema?: object;
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
