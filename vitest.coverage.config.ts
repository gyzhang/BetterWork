import { mergeConfig } from 'vitest/config';

import coveragePolicy from './scripts/coverage-policy.json';
import baseConfig from './vitest.config';

// 配置共用 production 纳入范围；精确例外与理由只登记在 coverage-policy.json。
const exceptions = coveragePolicy.exceptions.map((entry) => entry.path);

export default mergeConfig(baseConfig, {
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'json', 'json-summary'],
      reportOnFailure: true,
      include: [
        'apps/desktop/src/main/**/*.ts',
        'apps/desktop/src/preload/**/*.ts',
        'apps/desktop/src/renderer/src/**/*.{ts,tsx}',
        'packages/*/src/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.bench.test.ts',
        '**/*.d.ts',
        '**/fixtures/**',
        ...exceptions,
      ],
    },
  },
});
