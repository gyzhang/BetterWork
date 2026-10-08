import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const scriptPath = fileURLToPath(new URL('./classify-pr-changes.mjs', import.meta.url));

function classifyFiles(files: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [scriptPath, '--files'], {
    encoding: 'utf8',
    input: files.join('\0'),
  });
}

describe('PR 验证按差异范围选择', () => {
  it('纯 Markdown 差异只选择文档门禁', () => {
    const result = classifyFiles(['README.md', 'docs/guide.md']);
    expect(result.status, String(result.stderr)).toBe(0);
    expect(result.stdout).toBe('has_code=false\ndocs_only=true\n');
  });

  it('代码与文档混合差异选择代码快门禁', () => {
    const result = classifyFiles(['README.md', 'apps/desktop/src/main.ts']);
    expect(result.status, String(result.stderr)).toBe(0);
    expect(result.stdout).toBe('has_code=true\ndocs_only=false\n');
  });

  it('非 Markdown 文档资产按代码变更保守处理', () => {
    const result = classifyFiles(['docs/architecture.png']);
    expect(result.status, String(result.stderr)).toBe(0);
    expect(result.stdout).toBe('has_code=true\ndocs_only=false\n');
  });

  it('空差异按代码快门禁处理，避免空跑 PR 门禁', () => {
    const result = classifyFiles([]);
    expect(result.status, String(result.stderr)).toBe(0);
    expect(result.stdout).toBe('has_code=true\ndocs_only=false\n');
  });

  it('非法 PR 基点明确失败，不能跳过检查', () => {
    const result = spawnSync(process.execPath, [scriptPath, '--pull-request', 'main', 'HEAD'], {
      encoding: 'utf8',
    });
    expect(result.status, String(result.stderr)).toBe(1);
    expect(result.stderr).toContain('SHA 格式无效');
    expect(result.stdout).toBe('');
  });
});
