import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  importSpecifiers,
  pathsUnder,
  productionPathsUnder,
  read,
  REPO_FILES,
  REPO_ROOT,
  SOURCE_ROOTS,
  sourcePathsUnder,
} from '../coding-standard-support';

/**
 * 「零豁免」的扫描面比 `SOURCE_ROOTS` 宽：除生产源码外还包括本目录与根级配置（docs/12 §10）。
 *
 * 之所以能扩，是因为判据从「字符串包含」换成了「指令形状」：`eslint.config.mjs` 与本文件的注释里
 * 都要讲到这些词汇（「源码禁止 eslint-disable 等单点豁免」），用包含匹配就会把讲规则的那份文件
 * 判成违规，于是 2026-10-02 之前的扫描根只能退回 apps/packages/scripts——那等于让零豁免规则
 * 对护栏自己和 ESLint 配置本身不设防，而 docs/12 §10 的字面是「源码里不接受单点豁免」。
 */
const EXEMPTION_SCAN_ROOTS = [...SOURCE_ROOTS, 'standards/'] as const;

const EXEMPTION_SCAN_ROOT_FILES = ['eslint.config.mjs', 'vitest.config.ts'] as const;

/** 只接受 px 与 rem，其余单位无法判定是否低于 12px 下限。 */
describe('唯一规范源', () => {
  it('ESLint 与 Prettier 各只有一份根级配置', () => {
    const lintConfigs = REPO_FILES.filter((relative) =>
      /(^|\/)(eslint\.config\.[cm]?js|\.eslintrc(\..*)?)$/.test(relative),
    );
    expect(lintConfigs, 'ESLint 配置被复制成了多份').toEqual(['eslint.config.mjs']);

    const formatConfigs = REPO_FILES.filter((relative) =>
      /(^|\/)(\.prettierrc(\..*)?|prettier\.config\.[cm]?js)$/.test(relative),
    );
    expect(formatConfigs, 'Prettier 配置被复制成了多份').toEqual(['.prettierrc.json']);
  });

  it('任何 package.json 都不内嵌 lint/format 配置', () => {
    const offenders = REPO_FILES.filter((relative) => relative.endsWith('package.json')).filter(
      (relative) => {
        const manifest = JSON.parse(read(relative)) as Record<string, unknown>;
        return ['eslintConfig', 'eslintIgnore', 'prettier'].some((key) => key in manifest);
      },
    );
    expect(offenders, '这些 package.json 内嵌了会覆盖根配置的第二套标准').toEqual([]);
  });

  it('tsconfig 只有一份且四项严格开关全开', () => {
    const tsconfigs = REPO_FILES.filter((relative) => /(^|\/)tsconfig.*\.json$/.test(relative));
    expect(tsconfigs, '出现了会各自放宽严格度的第二份 tsconfig').toEqual(['tsconfig.json']);

    const { compilerOptions } = JSON.parse(read('tsconfig.json')) as {
      compilerOptions?: Record<string, unknown>;
    };
    for (const flag of [
      'strict',
      'noUncheckedIndexedAccess',
      'exactOptionalPropertyTypes',
      'useUnknownInCatchVariables',
    ]) {
      expect(compilerOptions?.[flag], `${flag} 必须开启（docs/12 §4）`).toBe(true);
    }
  });

  it('源码里没有任何规则豁免注释', () => {
    // 判据取「指令形状」：注释符紧跟指令词才算豁免指令。讲规则的那句注释
    // （`eslint.config.mjs:40`「源码禁止 eslint-disable 等单点豁免」、本文件上面的说明）
    // 因此不会被误判，而真正的就地豁免一律拦下（docs/12 §10）。
    const directiveShapes = [
      {
        pattern: /(?:\/\/|\/\*)\s*eslint-(?:disable|enable)(?:-next-line|-line)?\b/u,
        label: 'eslint-disable／eslint-enable',
      },
      { pattern: /(?:\/\/|\/\*)\s*prettier-ignore\b/u, label: 'prettier-ignore' },
      { pattern: /(?:\/\/|\/\*)\s*@ts-(?:nocheck|ignore|expect-error)\b/u, label: '@ts-* 豁免' },
    ];
    const scanned = [
      ...pathsUnder(...EXEMPTION_SCAN_ROOTS),
      ...REPO_FILES.filter((relative) =>
        (EXEMPTION_SCAN_ROOT_FILES as readonly string[]).includes(relative),
      ),
    ].filter((relative) => /\.(ts|tsx|mts|cts|js|mjs|cjs|css)$/u.test(relative));
    expect(scanned.length, '零豁免的扫描面为空，本条护栏已空跑').toBeGreaterThan(0);
    // 扫描面必须真的包含护栏自己与两份根配置——把根扩宽正是本条的意义，别让它在下次改动里悄悄缩回去。
    for (const required of [
      'standards/coding-standard.test.ts',
      'eslint.config.mjs',
      'vitest.config.ts',
    ]) {
      expect(scanned, `${required} 必须在零豁免的扫描面上`).toContain(required);
    }

    const offenders: string[] = [];
    for (const relative of scanned) {
      const text = read(relative);
      for (const { pattern, label } of directiveShapes) {
        if (pattern.test(text)) offenders.push(`${relative} 含有 ${label}`);
      }
    }
    expect(
      offenders,
      '例外必须写进 eslint.config.mjs 或本文件的白名单并注明理由，不允许散落在源码里（docs/12 §10）',
    ).toEqual([]);
  });
});

describe('架构边界', () => {
  it('packages 不依赖 apps，Agent Core 不依赖宿主运行时', () => {
    const forbiddenInAgentCore = new Set(['electron', 'react', 'react-dom', 'better-sqlite3']);
    const offenders: string[] = [];
    for (const relative of productionPathsUnder('packages/')) {
      for (const specifier of importSpecifiers(read(relative))) {
        if (specifier.includes('apps/') || specifier === '@betterwork/desktop') {
          offenders.push(`${relative} -> ${specifier}`);
        }
        if (relative.startsWith('packages/agent-core/') && forbiddenInAgentCore.has(specifier)) {
          offenders.push(`${relative} -> ${specifier}`);
        }
      }
    }
    expect(offenders, '依赖方向被反转（AGENTS.md §3）').toEqual([]);
  });

  it('Renderer 不直接触达 Node、Electron 或数据库', () => {
    const forbiddenInRenderer = new Set(['electron', 'better-sqlite3']);
    const offenders: string[] = [];
    for (const relative of sourcePathsUnder('apps/desktop/src/renderer/')) {
      for (const specifier of importSpecifiers(read(relative))) {
        if (specifier.startsWith('node:') || forbiddenInRenderer.has(specifier)) {
          offenders.push(`${relative} -> ${specifier}`);
        }
      }
    }
    expect(offenders, 'Renderer 只能经 preload 的类型化 API 访问主进程能力').toEqual([]);
  });

  it('协议内联的图片数据在 Renderer CSP 里被放行', () => {
    const protocol = read('packages/agent-protocol/src/index.ts');
    const html = read('apps/desktop/src/renderer/index.html');
    // CSP 没声明 img-src 时按 default-src 'self' 处理，data: URL 会被静默拦下：
    // 图片只剩 alt 文本，lint/typecheck/单测全绿，只有真机打开界面才看得见（ADR-0013 决策 3）。
    expect(
      protocol.includes("startsWith('data:image/')"),
      '协议已不再输出 data URL，请同步收紧 CSP 的 img-src 并更新 ADR-0013',
    ).toBe(true);
    const imgSrc = /img-src\s+([^";]+)/.exec(html)?.[1];
    expect(
      imgSrc,
      'CSP 必须显式声明 img-src：default-src 不含 data:，内联预览图会打不开',
    ).toBeDefined();
    expect(imgSrc ?? '', '幻灯片预览走 data URL，img-src 必须包含 data:').toContain('data:');
  });

  it('协议导出的阈值常量都有真实消费者', () => {
    const protocolPath = 'packages/agent-protocol/src/index.ts';
    const protocol = read(protocolPath);
    const declared = [...protocol.matchAll(/^export const ([A-Z][A-Z0-9_]*)\s*=/gm)].map(
      (match) => match[1] ?? '',
    );
    expect(declared.length).toBeGreaterThan(0);
    const consumerText = productionPathsUnder('apps/', 'packages/')
      .filter((relative) => relative !== protocolPath)
      .map((relative) => read(relative))
      .join('\n');
    const orphans = declared.filter((name) => {
      const reference = new RegExp(`\\b${name}\\b`, 'gu');
      // 同文件里被 Schema 或别的常量引用就算消费；只剩导出行是自己，等于常量与实现各说一套。
      if ([...protocol.matchAll(reference)].length > 1) return false;
      return [...consumerText.matchAll(reference)].length === 0;
    });
    expect(
      orphans,
      '无人消费的协议常量：改常量不会改行为，真相源变成了消费处那个字面量（docs/12 §7）',
    ).toEqual([]);
  });

  it('视图与组件不直接调用 IPC', () => {
    const offenders = pathsUnder(
      'apps/desktop/src/renderer/src/views/',
      'apps/desktop/src/renderer/src/components/',
    ).filter(
      (relative) => /\.(tsx|ts)$/.test(relative) && read(relative).includes('window.betterwork'),
    );
    expect(offenders, 'IPC 调用必须收在 hooks/ 里，视图只拿包装好的动作（docs/12 §8）').toEqual([]);
  });

  it('ipcMain.handle 只在 ipc/register-ipc.ts 出现', () => {
    const allowed = new Set([
      'apps/desktop/src/main/ipc/register-ipc.ts',
      'apps/desktop/src/main/ipc/register-ipc.test.ts',
    ]);
    const offenders = sourcePathsUnder(...SOURCE_ROOTS).filter(
      (relative) => !allowed.has(relative) && read(relative).includes('ipcMain.handle'),
    );
    expect(offenders, 'channel 注册必须全部经过三个注册 helper 的边界校验（docs/12 §7）').toEqual(
      [],
    );
  });

  it('取消词汇只在 agent-core/errors.ts 定义', () => {
    const allowed = 'packages/agent-core/src/errors.ts';
    const offenders = sourcePathsUnder(...SOURCE_ROOTS).filter(
      (relative) => relative !== allowed && read(relative).includes("'AbortError'"),
    );
    expect(
      offenders,
      '写错取消错误的名字会让取消被当成失败上报，只允许 abortError()/isAbortError()（docs/12 §5）',
    ).toEqual([]);
  });

  it('仓库工作区内没有密钥文件与数据库文件', () => {
    expect(
      execFileSync('git', ['ls-files', '--', '.codeartsdoer'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim(),
      'CodeArts 本地缓存不得被 Git 跟踪',
    ).toBe('');
    const offenders = REPO_FILES.filter((relative) => {
      if (relative.endsWith('.env.example')) return false;
      return /(^|\/)\.env(\.[^/]*)?$/.test(relative) || /\.(db|sqlite|sqlite3)$/.test(relative);
    });
    expect(offenders, '这些文件属于本机运行产物或凭据，不得进入仓库（AGENTS.md §7）').toEqual([]);
  });

  it('明文凭据列只允许由所属仓储的 save 与迁移清空写入', () => {
    const allowed = new Set([
      'apps/desktop/src/main/persistence/model-repository.ts',
      'apps/desktop/src/main/persistence/search-engine-repository.ts',
    ]);
    const offenders = productionPathsUnder(...SOURCE_ROOTS).filter(
      (relative) => !allowed.has(relative) && /api_key *(?==)/.test(read(relative)),
    );
    expect(
      offenders,
      'api_key 只能由所属仓储的 save 写入或由迁移清空；多一个写入方就是多一个泄露口（CF11 发现一）',
    ).toEqual([]);
  });

  it('任何 SQL 都不得用 excluded 覆写凭据列', () => {
    const offenders = sourcePathsUnder(...SOURCE_ROOTS).filter((relative) =>
      /excluded\.api_key/.test(read(relative)),
    );
    expect(
      offenders,
      'UPSERT 的 DO UPDATE 覆写 api_key，会把从 credentials 解出的密钥写回明文列，一律禁止',
    ).toEqual([]);
  });

  it('Renderer 里空体的 catch 必须写明降级理由', () => {
    // 「收口」的不变量是**失败必须到达一个真实存在的呈现出口**，不是「必须字面调用某个
    // helper」（docs/12 §5 的 Renderer 小节）。ESLint 的 no-floating-promises＋ignoreVoid:false
    // 挡得住 `void someIpcCall()`，但挡不住 `.catch(() => undefined)`——它「处理」了 promise，
    // 只是把失败扔了。空体 catch 因此只有一种合法形态：**降级，并把理由写在 catch 体里**。
    // 只扫 Renderer：主进程那一批 `.catch(() => undefined)` 挂在 close()/cancel()/rm() 上，
    // 讲的是「尽力释放资源」，与「失败要不要让用户看见」不是同一条不变量。
    const offenders: string[] = [];
    for (const relative of productionPathsUnder('apps/desktop/src/renderer/src/')) {
      // 先抹掉块注释再扫，否则「文档里举例说明哪种写法违规」会被当成违规本身——
      // `lib/async-action.ts` 的 JSDoc 正好写了 `catch {}` 与 `.catch(() => undefined)` 两个反例。
      // 抹的时候保留换行，行号才对得上；`//` 注释留着，降级理由正是靠它认。
      const source = read(relative).replace(/\/\*[\s\S]*?\*\//gu, (block) =>
        block.replace(/[^\n]/gu, ' '),
      );
      const lineOf = (index: number): number => source.slice(0, index).split('\n').length;

      // 形态一：`} catch {` ／ `} catch (error) {`，体内只有注释或什么都没有。
      // 收尾用 `\s*` 而不是 `[ \t]*`：`catch {\n}` 这种跨行空体同样算空，
      // 写成 `[ \t]*` 会漏掉它——这一处是变异验证时发现的（删掉理由注释后护栏仍然绿）。
      for (const match of source.matchAll(
        /catch(?:\s*\([^)]*\))?\s*\{((?:[ \t]*\/\/[^\n]*\n)*)\s*\}/gu,
      )) {
        if ((match[1] ?? '').trim() === '')
          offenders.push(`${relative}:${lineOf(match.index)} 空 catch 体`);
      }

      // 形态二：`.catch(() => undefined)` ／ `.catch(() => {})`，理由写在本行或上一行。
      const lines = source.split('\n');
      for (const match of source.matchAll(/\.catch\(\(\)\s*=>\s*(?:undefined|\{\s*\})\s*\)/gu)) {
        const line = lineOf(match.index);
        const hasReason =
          (lines[line - 1] ?? '').includes('//') || (lines[line - 2] ?? '').includes('//');
        if (!hasReason) offenders.push(`${relative}:${line} .catch(() => …) 没有降级理由`);
      }
    }
    expect(
      offenders,
      '失败被扔掉而不说明为什么可以扔，等于把「不处理」伪装成「已处理」（docs/12 §5 的 Renderer 小节）',
    ).toEqual([]);
  });

  it('hooks 里先置 true 的 busy 标志必须在失败路径也能清除', () => {
    // 「只记录」那一类处置成立的前提，是这句话在调用链上已有别的承载，或者用户根本不需要
    // 知道它失败了。两者都不满足时，最常见的破口不是丢一句错误，而是**界面停在转圈上**：
    // `setLoading(true)` 之后只在 `.then` 里 `setLoading(false)`，一次 IPC 失败就让
    // 「正在加载…」永远转下去，没有内容、没有报错、没有重试。
    // 2026-09-30 实测这同一条缺陷在 5 处（use-skills ×2、use-experts、use-mcp-connections、
    // use-skill-dependencies 各 1），本轮修完后把它钉成护栏。
    //
    // 只管 `trackAction`：`reportAction` 的 `onError` 是调用方写的回调，静态判不出它有没有清
    // busy——那一半由 hook 的行为测试守（见 use-skills.test.ts 等）。
    const offenders: string[] = [];
    for (const relative of productionPathsUnder('apps/desktop/src/renderer/src/hooks/')) {
      const source = read(relative).replace(/\/\*[\s\S]*?\*\//gu, (block) =>
        block.replace(/[^\n]/gu, ' '),
      );
      const lines = source.split('\n');
      lines.forEach((line, index) => {
        if (!line.includes('trackAction(')) return;
        // 调用前三行内把某个 busy 标志置 true —— 这是「这次调用要让界面进入等待态」的信号。
        const before = lines.slice(Math.max(0, index - 3), index).join('\n');
        if (!/set\w*(Loading|Busy|Preparing|Saving)\(true\)/u.test(before)) return;
        // 取 trackAction( 到配对的 ) 之间的整段参数链。
        let depth = 0;
        let chain = '';
        for (let k = index; k < Math.min(index + 45, lines.length); k += 1) {
          chain += `${lines[k] ?? ''}\n`;
          for (const char of lines[k] ?? '') {
            if (char === '(') depth += 1;
            else if (char === ')') depth -= 1;
          }
          if (depth <= 0 && k > index) break;
        }
        // 失败路径能清除的四种写法：链上 .catch／.finally，或经 settle*Call 把拒绝转成结果对象。
        if (!/\.catch\(|\.finally\(|settle\w*Call\(/u.test(chain)) {
          offenders.push(`${relative}:${index + 1} busy 只在成功路径清除`);
        }
      });
    }
    expect(
      offenders,
      '失败时 loading/busy 必须停下，且那句错误要到达一个呈现出口——否则用户只能看着转圈（docs/12 §5 的 Renderer 小节）',
    ).toEqual([]);
  });
});
