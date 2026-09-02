import type { BetterWorkDesktopApi } from '@betterwork/agent-protocol';

declare global {
  interface Window {
    betterwork: BetterWorkDesktopApi;
  }
}

export {};
