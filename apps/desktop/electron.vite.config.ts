import { fileURLToPath } from 'node:url';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('../..', import.meta.url));
const aliases = {
  '@betterwork/agent-protocol': `${root}/packages/agent-protocol/src/index.ts`,
  '@betterwork/agent-core': `${root}/packages/agent-core/src/index.ts`,
  '@betterwork/tool-runtime': `${root}/packages/tool-runtime/src/index.ts`,
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: Object.keys(aliases) })],
    resolve: { alias: aliases },
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
