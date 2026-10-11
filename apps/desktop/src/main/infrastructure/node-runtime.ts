import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * 随包独立 Node.js 运行时的路径解析（ADR-0047）。
 *
 * 与 Python 的 `bundledPythonRoot` 对称：打包态在 `Resources/node-runtime`，开发态在
 * `build/node-runtime`。制品由 [scripts/prepare-node-runtime-assets.mjs](../../../../scripts/prepare-node-runtime-assets.mjs)
 * 在构建期下载、SHA-256 校验后解压落地。
 *
 * 缺失一律返回 `undefined`，由调用方回退到 Electron 内嵌 Node（开发/测试态没有跑准备脚本时的合法
 * 退路）；绝不伪造路径，也绝不静默使用未经校验的内容。打包态是否真的随包由验收清单核对。
 */

/** 随包 `node` 可执行文件；不存在则 undefined。 */
export const managedNodeBin = (nodeRuntimeRoot: string): string | undefined => {
  const bin = path.join(nodeRuntimeRoot, 'bin', 'node');
  return existsSync(bin) ? bin : undefined;
};

/**
 * 把用户命令 `node`/`npm`/`npx`（不含路径分隔符的裸命令）解析到随包运行时的绝对路径。
 * 其余命令、含路径分隔符的显式命令一律返回 undefined，由调用方原样使用（尊重用户显式指定）。
 */
export const managedNodeTool = (nodeRuntimeRoot: string, command: string): string | undefined => {
  if (command !== 'node' && command !== 'npm' && command !== 'npx') return undefined;
  const bin = path.join(nodeRuntimeRoot, 'bin', command);
  return existsSync(bin) ? bin : undefined;
};
