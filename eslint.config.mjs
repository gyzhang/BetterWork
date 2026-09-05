import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * 全仓唯一的代码质量规范。任何新增或修改的代码都必须通过本配置，
 * 不允许在单个文件里用 eslint-disable 之外的方式另立标准。
 *
 * 分层：
 * 1. JS 与 TypeScript 官方推荐规则（含类型感知规则）
 * 2. 本项目额外确立的不变量（Promise 必须收口、导出必须有显式类型等）
 * 3. 按运行环境区分 globals：主进程/包为 Node，Renderer 为浏览器
 * 4. React Hooks 规则只作用于 Renderer
 * 5. eslint-config-prettier 收尾，关闭与 Prettier 冲突的排版规则
 */
export default tseslint.config(
  {
    name: 'betterwork/ignores',
    ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/release/**', '**/coverage/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    name: 'betterwork/base',
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ---- 异步与错误处理：不允许任何未收口的 Promise ----
      // ignoreVoid:false 是关键——`void fn()` 会把失败静默吞掉，
      // 必须显式 .catch() 或走统一的错误上报入口。
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksConditionals: true, checksVoidReturn: true },
      ],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'with-single-extends' },
      ],

      // ---- 类型纪律 ----
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowNullish: false, allowBoolean: false },
      ],

      // ---- 命名与一致性 ----
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase'] },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': 'error',
      'no-else-return': ['error', { allowElseIf: false }],
    },
  },

  {
    name: 'betterwork/node-runtime',
    files: [
      'apps/desktop/src/main/**/*.ts',
      'apps/desktop/src/preload/**/*.ts',
      'packages/**/*.ts',
      'scripts/**/*.ts',
      '*.config.ts',
    ],
    languageOptions: { globals: { ...globals.node } },
  },

  {
    name: 'betterwork/renderer',
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // 只启用能捕获真实缺陷的 Hooks 规则。
      // React Compiler 的优化类规则（use-memo、gating、preserve-manual-memoization 等）
      // 以「启用编译器自动记忆化」为前提，本项目未启用编译器，
      // 强行要求手写 useMemo 会引入噪音而非质量，因此显式关闭。
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/static-components': 'error',
      'react-hooks/set-state-in-render': 'error',
      'react-hooks/refs': 'error',
      'react-hooks/purity': 'error',
      'react-hooks/immutability': 'error',
      'react-hooks/globals': 'error',
      'react-hooks/error-boundaries': 'off',
      'react-hooks/use-memo': 'off',
      'react-hooks/void-use-memo': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/incompatible-library': 'off',
      'react-hooks/unsupported-syntax': 'off',
      'react-hooks/config': 'off',
      'react-hooks/gating': 'off',
    },
  },

  {
    name: 'betterwork/tests',
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      // 测试需要构造非法输入来验证边界，放宽这两条
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  {
    // 构建与规范配置文件不在 tsconfig 的 include 范围内，
    // 关闭类型感知规则，只保留基础 JS 检查。
    name: 'betterwork/js-config',
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  prettier,
);
