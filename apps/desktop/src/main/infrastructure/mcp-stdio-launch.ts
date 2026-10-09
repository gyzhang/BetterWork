export interface McpStdioLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly runAsNode?: boolean;
}
