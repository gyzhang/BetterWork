import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const desktop = fileURLToPath(new URL('.', import.meta.url));
const aliases = {
  '@betterwork/agent-protocol': `${root}/packages/agent-protocol/src/index.ts`,
  '@betterwork/agent-core': `${root}/packages/agent-core/src/index.ts`,
  '@betterwork/tool-runtime': `${root}/packages/tool-runtime/src/index.ts`,
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: Object.keys(aliases) })],
    resolve: { alias: aliases },
    build: {
      rollupOptions: {
        // skill-guardian 由主进程以子进程方式启动（ELECTRON_RUN_AS_NODE），
        // 必须单独产出一个可执行脚本，不能被打包进 index.js。
        input: {
          index: `${desktop}src/main/index.ts`,
          'skill-guardian': `${desktop}src/main/infrastructure/skill-guardian.ts`,
        },
        output: { entryFileNames: '[name].js' },
      },
    },
  },
  preload: {
    resolve: { alias: aliases },
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: ['electron'],
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
      },
    },
  },
  renderer: {
    resolve: { alias: aliases },
    plugins: [react()],
  },
});
