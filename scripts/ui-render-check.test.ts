import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const script = fileURLToPath(new URL('./ui-render-check.mjs', import.meta.url));

it('真实控件几何退化必须使 CLI 失败，不能把 Electron 提前退出读成成功', () => {
  const result = spawnSync(process.execPath, [script, '--probe-control-height'], {
    encoding: 'utf8',
  });
  expect(result.status).toBe(1);
  // 断言确实进入真实布局检查，进程/显示服务启动失败不算有效的反向验证。
  expect(result.stderr).toContain('md 输入/选择/按钮不等高');
  expect(result.stdout).not.toContain('UI 真实渲染检查通过');
});
