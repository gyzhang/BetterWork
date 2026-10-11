import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { readQoderRuleMetadata } from '../agent-rules';
import {
  importSpecifiers,
  productionPathsUnder,
  read,
  REPO_FILES,
} from '../coding-standard-support';
import { componentCatalogIssues } from '../ui-governance';

/**
 * 提交、推送与 PR 门禁的范围分工（docs/12 §1、§1.1；ADR-0039/0042）。
 *
 * 提交只按暂存范围做快检；PR 上按差异运行代码快门禁或 docs:check；完整 verify 按需/夜间运行，
 * 并以稳定的 PR Gate 作为 main 的必需状态。文档、钩子、工作流与夹具测试必须保持同一关系。
 */
describe('提交与推送门禁纪律', () => {
  const hookFiles = ['.husky/pre-commit', '.husky/pre-push'] as const;

  interface VerifyJob {
    if?: string;
    needs?: string | string[];
    'runs-on': string;
    steps: {
      run?: string;
      env?: Record<string, string>;
      uses?: string;
      with?: Record<string, unknown>;
    }[];
  }

  function readVerifyWorkflow(): {
    on: Record<string, unknown>;
    jobs: Record<string, VerifyJob>;
    concurrency: { group: string };
  } {
    return parse(read('.github/workflows/verify.yml')) as ReturnType<typeof readVerifyWorkflow>;
  }

  it('本地钩子按暂存范围快检并阻止直推 main', () => {
    const scripts = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const pipeline = (scripts.scripts.verify ?? '')
      .split(' && ')
      .map((command) => command.replace(/^npm (?:run )?/u, '').trim())
      .filter((step) => step !== '');
    expect(pipeline).toEqual(['lint', 'format:check', 'typecheck', 'test', 'build', 'ui:check']);
    expect(scripts.scripts['docs:check']).toContain('standards/coding-standard.test.ts');
    for (const file of [
      '.husky/pre-commit',
      '.husky/pre-push',
      'scripts/pre-commit-check.mjs',
      'scripts/pre-push-check.mjs',
      'scripts/pre-commit-check.test.ts',
      'scripts/pre-push.test.ts',
      'scripts/classify-pr-changes.mjs',
      'scripts/classify-pr-changes.test.ts',
    ]) {
      expect(REPO_FILES, `${file} 不存在，本条护栏已空跑`).toContain(file);
    }

    expect(read('.husky/pre-commit')).toContain('scripts/pre-commit-check.mjs');
    expect(read('.husky/pre-push')).toContain('scripts/pre-push-check.mjs');
    const preCommitCheck = read('scripts/pre-commit-check.mjs');
    expect(preCommitCheck).toContain("'--cached', '--check'");
    expect(preCommitCheck).toContain('node_modules/.bin/eslint');
    expect(preCommitCheck).toContain('node_modules/.bin/prettier');
    expect(preCommitCheck).not.toContain("run('npm', ['run', 'typecheck'])");
    expect(preCommitCheck).toContain("run('npm', ['run', 'docs:check'])");
    const prePushCheck = read('scripts/pre-push-check.mjs');
    expect(prePushCheck).toContain("remoteRef === 'refs/heads/main'");
    expect(prePushCheck).toContain("git(['merge-base', 'origin/main', pushedCommit])");
    expect(prePushCheck).toContain("git(['status', '--porcelain'])");
    expect(prePushCheck).toContain("git(['rev-parse', 'HEAD'])");
  });

  it('任务分支隔离并要求并行写任务使用独立 worktree', () => {
    expect(read('AGENTS.md')).toContain('每个任务都在自己的任务分支上工作');
    expect(read('AGENTS.md')).toContain('并行任务各用独立 worktree 和分支');
    expect(read('docs/12-engineering-standards.md')).toContain(
      '并行写任务各用独立 worktree 与分支',
    );
    expect(read('docs/11-qoder-handoff.md')).toContain('并行写任务使用独立 worktree 和分支');
  });

  it('main 只允许通过必需 PR Gate 的 Pull Request 更新', () => {
    const workflow = read('.github/workflows/verify.yml');
    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('PR Gate');
    expect(workflow).toContain('npm run docs:check');
    expect(workflow).not.toMatch(/^ {2}push:/mu);
    expect(read('docs/adr/0039-task-branches-and-protected-main.md')).toContain('PR Gate');
    expect(read('docs/adr/0042-pr-quick-check-and-scheduled-verify.md')).toContain('PR Gate');
    expect(read('docs/adr/0036-macos-only-platform-scope.md')).toContain('由 [ADR-0039]');
  });

  it('钩子不许写成空跑，也不许用管道把失败读成成功', () => {
    // 两种失效形状：① 钩子只剩注释——husky 退出 0，看起来装了其实什么都没跑；
    // ② 命令接管道（`npm run verify | tail`），退出码取最后一个命令，失败被读成成功（docs/12 §1）。
    for (const hookFile of hookFiles) {
      const body = read(hookFile)
        .split('\n')
        .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
      expect(body.length, `${hookFile} 里没有任何要执行的命令，等于没装钩子`).toBeGreaterThan(0);
      const piped = body.filter((line) => line.includes('npm') && line.includes('|'));
      expect(
        piped,
        `${hookFile} 把 npm 的输出接了管道，退出码会被最后一个命令顶掉（docs/12 §1）`,
      ).toEqual([]);
    }
  });

  it('PR 快门禁包含静态约束和相关测试，不等待完整 verify', () => {
    const workflow = readVerifyWorkflow();
    const quick = workflow.jobs.quick;
    expect(quick?.if).toBe(
      "github.event_name == 'pull_request' && needs.classify.outputs.has_code == 'true'",
    );
    expect(quick?.needs).toBe('classify');
    expect(quick?.steps.find((step) => step.uses === 'actions/checkout@v7')?.with).toMatchObject({
      'fetch-depth': 0,
    });
    expect(quick?.steps.flatMap((step) => (step.run ? [step.run] : []))).toEqual([
      'npm ci',
      'npm run lint',
      'npm run format:check',
      'npm run typecheck',
      'npm run docs:check',
      'npx vitest run --project functional --changed="$BASE_SHA" --passWithNoTests',
      'npx vitest run --project heavy --changed="$BASE_SHA" --passWithNoTests',
    ]);
    for (const step of quick?.steps.filter((item) => item.run?.includes('--changed')) ?? []) {
      expect(step.env?.BASE_SHA).toBe('${{ github.event.pull_request.base.sha }}');
    }
    expect(workflow.jobs.classify?.if).toBe("github.event_name == 'pull_request'");
    expect(workflow.jobs.documentation?.if).toBe(
      "github.event_name == 'pull_request' && needs.classify.outputs.docs_only == 'true'",
    );
    expect(
      workflow.jobs.documentation?.steps.flatMap((step) => (step.run ? [step.run] : [])),
    ).toEqual(['npm ci', 'npm run docs:check']);
    expect(workflow.jobs['pr-gate']?.if).toBe("always() && github.event_name == 'pull_request'");
    expect(workflow.jobs['pr-gate']?.needs).toEqual(['classify', 'quick', 'documentation']);
  });

  it('PR Gate 只接受有效分类且对应快检成功，失败或跳过均拒绝合并', () => {
    const gate = readVerifyWorkflow().jobs['pr-gate'];
    const script = gate?.steps.find((step) => step.run)?.run;
    if (!script) throw new Error('PR Gate 缺少实际检查脚本。');
    const successfulCode = {
      CLASSIFY_RESULT: 'success',
      HAS_CODE: 'true',
      DOCS_ONLY: 'false',
      QUICK_RESULT: 'success',
      DOCUMENTATION_RESULT: 'skipped',
    };
    const successfulDocs = {
      ...successfulCode,
      HAS_CODE: 'false',
      DOCS_ONLY: 'true',
      QUICK_RESULT: 'skipped',
      DOCUMENTATION_RESULT: 'success',
    };
    const cases = [
      { env: successfulCode, status: 0 },
      { env: successfulDocs, status: 0 },
      { env: { ...successfulCode, CLASSIFY_RESULT: 'failure' }, status: 1 },
      { env: { ...successfulCode, QUICK_RESULT: 'failure' }, status: 1 },
      { env: { ...successfulCode, QUICK_RESULT: 'cancelled' }, status: 1 },
      { env: { ...successfulCode, QUICK_RESULT: 'skipped' }, status: 1 },
      { env: { ...successfulDocs, DOCUMENTATION_RESULT: 'failure' }, status: 1 },
      { env: { ...successfulDocs, DOCUMENTATION_RESULT: 'cancelled' }, status: 1 },
      { env: { ...successfulDocs, DOCUMENTATION_RESULT: 'skipped' }, status: 1 },
      { env: { ...successfulCode, HAS_CODE: '' }, status: 1 },
      { env: { ...successfulCode, HAS_CODE: 'false' }, status: 1 },
      { env: { ...successfulDocs, HAS_CODE: 'true' }, status: 1 },
    ];
    for (const scenario of cases) {
      const result = spawnSync('bash', ['-c', script], {
        encoding: 'utf8',
        env: { ...process.env, ...scenario.env },
      });
      expect(result.status, JSON.stringify(scenario.env)).toBe(scenario.status);
    }
  });

  it('远端门禁跑在受支持的平台、能手动触发、并且留下绿跑读数', () => {
    // [ADR-0036](../docs/adr/0036-macos-only-platform-scope.md) 定案产品只有 macOS：门禁跑在别的
    // 平台上测的是不兼容的靶子，`ui:check` 还会在 Ubuntu 的 userns 限制下崩成 SIGTRAP。
    // PR 是进入 main 的唯一入口；手动触发与绿跑读数管的是另一件事——审计要回答「这轮比上轮慢了多少」
    // 「这条判据是不是变严了」，而产物只随失败上传时，连着两次绿跑之间什么都没有。
    const workflowFile = '.github/workflows/verify.yml';
    expect(REPO_FILES, '找不到远端门禁定义文件，本条护栏已空跑').toContain(workflowFile);
    const workflow = read(workflowFile);
    const triggers = [...workflow.matchAll(/^ {2}(\w+)[:$]/gmu)].map((match) => match[1] ?? '');
    expect(
      triggers,
      `${workflowFile} 的触发器里没有 workflow_dispatch：不改动代码就制造不出一条运行`,
    ).toContain('workflow_dispatch');
    const config = readVerifyWorkflow();
    expect(Object.keys(config.on).sort()).toEqual([
      'pull_request',
      'schedule',
      'workflow_dispatch',
    ]);
    expect(config.on.pull_request).toEqual({ branches: ['main'] });
    expect(config.on.schedule).toEqual([{ cron: '30 15 * * *' }]);
    expect(config.jobs.quality?.if).toBe(
      "github.event_name == 'workflow_dispatch' || github.event_name == 'schedule'",
    );
    expect(config.jobs.quality?.needs, '完整验证不能依赖只在 PR 运行的分类或快检').toBeUndefined();
    expect(config.concurrency.group).toContain('github.event_name');
    expect(Object.values(config.jobs).every((job) => job['runs-on'].startsWith('macos'))).toBe(
      true,
    );
    expect(workflow, '远端门禁必须跑在 darwin 上（ADR-0036）').toMatch(/runs-on:\s*macos/u);
    expect(workflow, '远端不许把它改成只跑某几步').toContain('npm run verify');
    const qualityJob = workflow.split('  quality:')[1] ?? '';
    expect(
      qualityJob,
      'drift-check 读取 origin/main..HEAD，完整门禁必须取到远端分支与历史',
    ).toMatch(/fetch-depth:\s*0/u);
    expect(workflow, 'main 不得通过 push 事件绕过 PR Gate').not.toMatch(/^ {2}push:/mu);
    expect(workflow, '必须有稳定的 PR Gate 汇总分支验证与文档验证').toContain('name: PR Gate');
    expect(workflow, '纯 Markdown PR 必须只走文档门禁').toContain('npm run docs:check');
    const successUploads = workflow.includes('if: success()')
      ? [...workflow.split(/- name:/u).filter((block) => block.includes('if: success()'))]
      : [];
    expect(
      successUploads.length,
      '没有随成功上传的步骤：绿跑的读数一个字节都没留下',
    ).toBeGreaterThan(0);
    expect(
      successUploads.join('\n'),
      '随成功上传的产物必须包含 ui:check 的 results.json，否则绿跑之间无从比较',
    ).toContain('.ui-render/results.json');
    const artifactUploads = workflow
      .split(/- name:/u)
      .filter((block) => block.includes('uses: actions/upload-artifact@v6'));
    expect(artifactUploads).toHaveLength(2);
    expect(
      artifactUploads.every((block) => block.includes('include-hidden-files: true')),
      'UI 检查产物目录以 .ui-render 开头，上传步骤必须显式包含隐藏文件',
    ).toBe(true);
  });

  it('治理巡检装在工具链里，但不进提交门禁', () => {
    // `npm run drift:check` 管的是护栏看不见的三类漂移：仓库外部的状态（钩子有没有真的装进这个
    // 克隆、本地攒了多少没推的提交）、跨时间的变化（例外登记在长吗、判据被不被引用）、制度有没有
    // 被执行（每个有提交的日子都有工作日志吗）。它刻意**不进** verify：判据里有 `git log`，同一份
    // 代码换台机器结论就不同，塞进提交门禁的随机红下一个被牺牲的永远是门禁本身（docs/12 §1、§9）。
    // 这条护栏钉的是「机制还在不在」——脚本、CLI 测试、读数基线、npm 脚本、文档指认五样缺一样，
    // 巡检就在某次重构里安静地消失了。
    const scripts = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(scripts.scripts['drift:check'], 'npm run drift:check 不见了').toBe(
      'node scripts/drift-check.mjs',
    );
    for (const file of [
      'scripts/drift-check.mjs',
      'scripts/drift-check.test.ts',
      'docs/development/drift-readings.json',
    ])
      expect(REPO_FILES, `${file} 不在仓里，治理巡检链路已断`).toContain(file);
    expect(
      scripts.scripts.verify ?? '',
      '巡检要读 git 状态与本机克隆配置，换台机器结论就不同：不许混进提交门禁（docs/12 §1）',
    ).not.toContain('drift:check');
    expect(
      read('docs/12-engineering-standards.md'),
      'docs/12 §1 必须指认这条巡检命令，否则下一个人不知道该跑它',
    ).toContain('npm run drift:check');
    expect(read('AGENTS.md'), 'AGENTS.md 的任务路由必须能路由到巡检').toContain('drift:check');
  });
});

describe('规则与文档索引', () => {
  it('当前组件台账与真实导出双向一致', () => {
    const sources = productionPathsUnder('apps/desktop/src/renderer/src/components/')
      .filter((file) => file.endsWith('.tsx'))
      .map((file) => ({ file, text: read(file) }));
    expect(componentCatalogIssues(read('docs/10-ui-ux-system.md'), sources)).toEqual([]);
  });

  it('所有现行门禁摘要包含实际 verify 的完整步骤', () => {
    const pipeline = (
      JSON.parse(read('package.json')) as { scripts: { verify: string } }
    ).scripts.verify
      .split(' && ')
      .map((command) => command.replace(/^npm (?:run )?/u, '').trim());
    expect(pipeline).toEqual(['lint', 'format:check', 'typecheck', 'test', 'build', 'ui:check']);
    for (const file of [
      'AGENTS.md',
      'CONTRIBUTING.md',
      'docs/12-engineering-standards.md',
      'docs/11-qoder-handoff.md',
      '.qoder/rules/betterwork-code-style.md',
      '.qoder/rules/betterwork-dev-cycle.md',
    ]) {
      const summaries = [...read(file).matchAll(/lint(?:\s*\+\s*[\w:]+)+/gu)];
      expect(summaries.length, `${file} 缺少可核对的门禁摘要`).toBeGreaterThan(0);
      for (const summary of summaries)
        expect(
          summary[0].split('+').map((item) => item.trim()),
          file,
        ).toEqual(pipeline);
    }
  });

  it('讨论节点复用勾选组与徽标，不恢复旧的自造表面', () => {
    const file = read('apps/desktop/src/renderer/src/components/DiscussionCheckpointPanel.tsx');
    expect(file).toMatch(/<CheckList\b/u);
    expect(file).toMatch(/<Badge\b/u);
    expect(file).not.toMatch(/<input\b|data-status=/u);
    expect(read('apps/desktop/src/renderer/src/styles.css')).not.toMatch(
      /\.discussion-checkpoint-history span|\.discussion-checkpoint-artifacts label/u,
    );
  });
  it('.qoder/rules 下的每个规则文件都登记在场景索引里', () => {
    const index = read('.qoder/rules/betterwork.md');
    const unregistered = REPO_FILES.filter(
      (relative) =>
        relative.startsWith('.qoder/rules/') &&
        relative.endsWith('.md') &&
        relative !== '.qoder/rules/betterwork.md' &&
        !index.includes(path.posix.basename(relative)),
    );
    expect(unregistered, '未登记的规则文件不会被 Qoder 加载，等于不存在').toEqual([]);
  });

  it('规则文件的每条复述都要带出处', () => {
    // `.qoder/rules/` 下的文件是被自动加载的：AI 读到它们的概率远高于人去翻 docs/12，所以最危险
    // 的不是它们啰嗦，而是它们与出处**各说一套**。IPC 收口判据就在这里漂过一次（账本 P3-11：
    // 四处两种措辞，本文件那处直到 2026-09-29 才对齐）。要求每条复述带出处，让「这条出自哪一节」
    // 永远可查——没有出处的复述等于另立标准，漂移时没人能判断哪一份对。
    //
    // 范围在 2026-10-02 从「只管 code-style.md」扩到全部规则文件：当时另外 5 个文件共 29 条
    // 复述没有出处（ipc-artifact 10／dev-cycle 10／knowledge 7／diagnosis 2），逐条核准目标小节
    // 存在之后才补上指针——写错指针比不写更糟，所以扩之前先改文档再扩判据，顺序不能倒。
    // 出处认四种形态：`§N` 小节号、`docs/NN` 文档名、`AGENTS.md`，或一条**指向仓内真实文件**的
    // Markdown 链接——`betterwork.md` 那张场景化索引表的每一行都链接到它所要概括的规则文件本身，
    // 那本身就是指针，不是「无出处另立标准」。
    const pointsIntoRepo = (line: string, file: string): boolean =>
      [...line.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/gu)]
        .map((match) => match[1] ?? '')
        .filter((target) => target !== '' && !/^https?:/u.test(target))
        .some((target) =>
          REPO_FILES.includes(
            path.posix.normalize(path.posix.join(path.posix.dirname(file), target)),
          ),
        );

    const sourceMarker = /§\s*\d|docs\/\d\d|AGENTS\.md/u;
    const ruleFiles = REPO_FILES.filter(
      (relative) => relative.startsWith('.qoder/rules/') && relative.endsWith('.md'),
    );
    expect(ruleFiles.length, '扫不到规则文件，本条护栏已空跑').toBeGreaterThan(0);

    const offenders: string[] = [];
    let checked = 0;
    for (const file of ruleFiles) {
      const lines = read(file).split('\n');
      lines.forEach((line, index) => {
        const isBullet = /^- /u.test(line);
        const isTableRow = /^\| /u.test(line) && !/^\|[-\s|]+\|$/u.test(line);
        // 表格标题行（下一行是 `| --- |` 分隔符）不是复述，跳过。
        const isHeader = isTableRow && /^\|[-\s|]+\|$/u.test(lines[index + 1] ?? '');
        if (!isBullet && !isTableRow) return;
        if (isHeader) return;
        checked += 1;
        if (sourceMarker.test(line) || pointsIntoRepo(line, file)) return;
        offenders.push(`${file}: ${line.slice(0, 56)}`);
      });
    }
    expect(checked, '规则文件里一条复述都没解析到，本条护栏已空跑').toBeGreaterThan(0);
    expect(
      offenders,
      '规则文件的每条复述都要带出处（§N、docs/NN 或 AGENTS.md）；没有出处的复述就是第二份标准（docs/12 §10）',
    ).toEqual([]);
  });

  it('文档点名的护栏必须是一条真实存在的判据', () => {
    // 「这条由护栏 X 钉住」是本仓最强的可追溯声明：读的人据此去找强制点。2026-10-02 我把
    // 「编码规范速查文件的每条复述都要带出处」改名为「规则文件的每条复述都要带出处」，
    // `betterwork-code-style.md` 里那句引用当场变成指着一个不存在的护栏——改名本身是对的，
    // 缺一的是把引用一起带走的那道闸。同一天还查出两处简写引用（少打了标题后半截），
    // 判据存在但名字对不上，下一个人无法确定自己找到的是不是同一条。
    //
    // 只认紧邻书写的那一种形状：`护栏「X」`／`护栏：「X」`／`判据「X」`。2026-10-02 实测过
    // 宽的版本（同一行出现过「护栏」二字就算）会把 300 多处引用文案与术语的「」判成违规——
    // 过宽到没人能修的判据等于没有判据。范围只取会被当现状读取的文档：`docs/logs` 与
    // `docs/reviews` 是当天快照、`docs/adr` 是决策记录，它们记的是写下那天的名字，不能被
    // 后续改名回改（要改的是正文里仍然生效的指针，那部分人负责）。
    const titles = new Set<string>();
    const entry = read('standards/coding-standard.test.ts');
    const topicModules = importSpecifiers(entry)
      .filter((specifier) => specifier.startsWith('./coding-standard/'))
      .map((specifier) => `standards/${specifier.slice(2)}.ts`);
    expect(topicModules.length, '唯一入口没有加载任何主题护栏模块').toBeGreaterThan(0);
    const sources = [entry, ...topicModules.map(read)];
    for (const source of sources) {
      let enclosingDescribe = '';
      for (const line of source.split('\n')) {
        const describeMatch = /^describe\(\s*'([^']+)'/u.exec(line);
        if (describeMatch?.[1]) enclosingDescribe = describeMatch[1];
        const itMatch = /^ {2}it\(\s*'([^']+)'/u.exec(line);
        if (!itMatch?.[1]) continue;
        titles.add(itMatch[1]);
        // 允许 `describe › it` 的完整路径写法：同名判据分散在多个块里时，只有路径能指准。
        if (enclosingDescribe !== '') titles.add(`${enclosingDescribe} › ${itMatch[1]}`);
      }
    }
    expect(titles.size, '解析不出唯一入口加载的任何判据标题，本条护栏已空跑').toBeGreaterThan(0);

    const livingDocs = REPO_FILES.filter(
      (relative) =>
        relative === 'AGENTS.md' ||
        relative === 'README.md' ||
        relative === 'CONTRIBUTING.md' ||
        /^docs\/[^/]+\.md$/u.test(relative) ||
        /^docs\/(?:development|designs)\/[^/]+\.md$/u.test(relative) ||
        relative.startsWith('.qoder/rules/'),
    );
    expect(livingDocs.length, '扫不到现行文档，本条护栏已空跑').toBeGreaterThan(0);

    const reference = /(?:护栏|判据|守卫)[：:]?[「]([^」]{4,90})[」]/gu;
    const offenders: string[] = [];
    let referenced = 0;
    for (const file of livingDocs) {
      for (const line of read(file).split('\n')) {
        for (const match of line.matchAll(reference)) {
          referenced += 1;
          const name = (match[1] ?? '').trim();
          if (titles.has(name)) continue;
          offenders.push(`${file}: 「${name}」`);
        }
      }
    }
    expect(referenced, '现行文档里一处护栏引用都没解析到，本条护栏已空跑').toBeGreaterThan(0);
    expect(
      offenders,
      '文档说「由护栏 X 钉住」时 X 必须是本文件里真实的 it() 标题（可带 `describe › ` 路径）；改判据名要同轮改引用',
    ).toEqual([]);
  });

  it('仓库文本里不得出现替换字符与编码重读产物', () => {
    // 中文长行被编辑工具静默损坏时，最先掉出来的就是这几类字符：U+FFFD 是解码失败的占位符；
    // 「Latin-1 字母紧跟一个间隔符／C1 控制符」是 UTF-8 字节被按 Latin-1 重读的形状——文件头的
    // BOM 被这样读出来就是三个这样的字符，本文件不写它的字面量，否则这条护栏第一个判红自己。
    // 本仓把「改完中文必须回读」写成了常驻铁律，但回读依赖自觉；这条护栏钉住其中最可机判的一类
    // 后果（AGENTS.md 的中文字符编辑纪律）。
    // 判据只认签名，不认「非 ASCII」：`×`、`÷` 与作者名里的 `ü` 在本仓都是正当用法，
    // 按码位一刀切 2026-10-02 实测会误伤 200 多处。扫描面是全部文本文件，只排掉被 Git 忽略的
    // 产品数据 `.betterwork/`。
    const textFile = /\.(?:md|ts|tsx|mts|cts|js|mjs|cjs|json|css|ya?ml|sh|html|svg|txt)$/u;
    const signatures: readonly { readonly label: string; readonly pattern: RegExp }[] = [
      { label: 'U+FFFD 替换字符', pattern: /[\uFFFD]/u },
      {
        label: 'UTF-8 被按 Latin-1 重读',
        pattern: /[\u00C0-\u00FF][\u00A0-\u00BF\u0080-\u009F]/u,
      },
      { label: 'C1 控制字符', pattern: /[\u0080-\u009F]/u },
    ];
    const offenders: string[] = [];
    let scanned = 0;
    for (const file of REPO_FILES) {
      if (!textFile.test(file) || file.startsWith('.betterwork/')) continue;
      scanned += 1;
      const content = read(file);
      for (const { label, pattern } of signatures) {
        const match = pattern.exec(content);
        if (!match) continue;
        const line = content.slice(0, match.index).split('\n').length;
        offenders.push(`${file}:${line} ${label}：${match[0]}`);
      }
    }
    expect(scanned, '一个文本文件都没扫到，本条护栏已空跑').toBeGreaterThan(0);
    expect(
      offenders,
      '这些字符是中文被静默损坏或编码被重读的产物：整段重写该处内容，别继续局部替换（AGENTS.md 中文字符编辑纪律）',
    ).toEqual([]);
  });

  it('规则文件的触发元数据形状正确', () => {
    // 采用 IDE 实际保存的 trigger: glob + glob 字符串；CLI YAML 列表在 IDE 中被判未启用。
    // 匹配样本只证明文件路由，不代替 IDE 的实际识别或会话注入证据。
    const ruleFiles = REPO_FILES.filter(
      (relative) => relative.startsWith('.qoder/rules/') && relative.endsWith('.md'),
    );
    expect(ruleFiles.length, '扫不到规则文件，本条护栏已空跑').toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of ruleFiles) {
      const metadata = readQoderRuleMetadata(read(file));
      for (const issue of metadata.issues) offenders.push(`${file}: ${issue}`);
    }
    expect(offenders, 'Qoder frontmatter 必须按 IDE 可识别格式登记触发模式与匹配范围').toEqual([]);
    const samples: Record<string, readonly string[]> = {
      '.qoder/rules/betterwork-code-style.md': [
        'packages/example.ts',
        'apps/desktop/src/renderer/src/App.tsx',
        'apps/desktop/src/renderer/src/styles.css',
        'scripts/drift-check.mjs',
        'package.json',
      ],
      '.qoder/rules/betterwork-ui.md': [
        'apps/desktop/src/renderer/src/hooks/use-example.ts',
        'apps/desktop/src/renderer/src/views/Example.tsx',
        'apps/desktop/src/renderer/src/styles.css',
      ],
    };
    for (const [file, paths] of Object.entries(samples)) {
      const metadata = readQoderRuleMetadata(read(file));
      for (const sample of paths)
        expect(
          metadata.globs.some((glob) => path.matchesGlob(sample, glob)),
          `${file} → ${sample}`,
        ).toBe(true);
    }
  });

  it('两个智能体入口都指向同一份工程规范', () => {
    const standard = 'docs/12-engineering-standards.md';
    expect(read('AGENTS.md'), 'Codex 入口 AGENTS.md 必须指向唯一规范').toContain(standard);
    expect(
      read('.qoder/rules/betterwork-code-style.md'),
      'Qoder 入口 betterwork-code-style.md 必须指向唯一规范',
    ).toContain(standard);
  });

  it('一级导航标签与 docs/10 §6.1 的称呼表两侧一致', () => {
    // 侧栏有哪几项是**代码**说了算（`PRIMARY_NAV_ITEMS`），页面叫什么、页头写哪句是
    // docs/10 §6.1 那张表说了算。2026-09-30 的漂移不是有人改了代码，是引用方凭印象造了
    // 一个从未存在的页面名（把「技能页」写成「能力页」）——所以两侧都要钉：表里的导航列
    // 必须与代码一致，代码将来改名而文档不跟同样红。
    const appSource = read('apps/desktop/src/renderer/src/App.tsx');
    const declarationStart = appSource.indexOf('PRIMARY_NAV_ITEMS');
    expect(declarationStart, '找不到 PRIMARY_NAV_ITEMS，本条护栏已空跑').toBeGreaterThan(-1);
    const declaration = appSource.slice(
      declarationStart,
      appSource.indexOf('];', declarationStart) === -1
        ? appSource.length
        : appSource.indexOf('];', declarationStart),
    );
    const navLabels = [...declaration.matchAll(/label: '([^']+)'/gu)]
      .map((match) => match[1] ?? '')
      .filter((label) => label !== '');
    expect(navLabels, 'PRIMARY_NAV_ITEMS 里解析不出导航标签，本条护栏已空跑').not.toHaveLength(0);

    const governance = read('docs/10-ui-ux-system.md');
    const sectionStart = governance.indexOf('### 6.1 应用级导航');
    expect(sectionStart, 'docs/10 §6.1 的标题被改名，本条护栏已空跑').toBeGreaterThan(-1);
    const sectionEnd = governance.indexOf('### 6.1.1', sectionStart);
    const section = governance.slice(sectionStart, sectionEnd === -1 ? undefined : sectionEnd);
    const tableNavColumn = [...section.matchAll(/^\| ([^|]+?) \| [^|]+?\|/gmu)]
      .map((match) => match[1]?.trim() ?? '')
      .filter((cell) => cell !== '' && !/^-+$/.test(cell) && cell !== '一级导航');
    for (const label of navLabels) {
      expect(
        tableNavColumn,
        `代码里的导航项「${label}」没有登记进 docs/10 §6.1 的称呼表（docs/10 §6.1）`,
      ).toContain(label);
    }
    expect(
      tableNavColumn.filter((cell) => !navLabels.includes(cell)),
      '称呼表的导航列多出代码里没有的项；设置与帮助是侧栏底部项，不在一级导航里',
    ).toEqual(['设置', '帮助']);
    expect(appSource).toContain('label="帮助"');
  });

  it('退役的页面称呼不得回到会被智能体读取的文本里', () => {
    // 「能力」是模型／技能／MCP／搜索的**总称**，不是任何页面的名字（docs/10 §6.1）。
    // 「能力页」在 2026-09-09 的日志与 2026-09-30 的走查清单里各出现过一次——历史文本里的
    // 错名会被下一次引用捞回来，所以把它钉成绊线。
    //
    // **范围是「会被当成指令读」的文本**：AGENTS.md、`.qoder/**` 下的规则与规格、渲染层源码
    // 与样式。docs/** 不锁——退役这件事本身要在文档里写明，锁住它等于禁止记录；那次改准的
    // 事实记在 docs/logs/2026-09-30.md。`docs/prototype/skills-view/index.html` 也不锁：
    // 它是 2026-09-09 拍板时的评审快照，改它等于改掉当时被批准的那件东西。
    const retiredPageNames = ['能力页'];
    const scanned = REPO_FILES.filter(
      (file) =>
        /^\.qoder\/.*\.md$/.test(file) ||
        file === 'AGENTS.md' ||
        (/^apps\/desktop\/src\/renderer\/.*\.(ts|tsx|css)$/.test(file) &&
          !/^apps\/desktop\/src\/renderer\/.*\.test\.(ts|tsx)$/.test(file)),
    );
    expect(scanned, '一条没扫到文件的绊线等于没写，本条护栏已空跑').not.toHaveLength(0);
    const offenders: string[] = [];
    for (const relative of scanned) {
      const text = read(relative);
      for (const name of retiredPageNames) {
        if (text.includes(name)) offenders.push(`${relative} → ${name}`);
      }
    }
    expect(
      offenders,
      '页面称呼只有一张表：一级导航是 工作／成果／知识／技能／专家，Skill 管理那一页叫技能页（docs/10 §6.1）',
    ).toEqual([]);
  });

  it('规则与规范文档里引用的仓库路径都必须存在', () => {
    // 智能体是按这些指针动手的：规则文件写「实现主体在 X」，指错了就是去开一个不存在的文件，
    // 或按错误的层次改代码。2026-10-02 审计实测两处已过期——`main/run-journal.ts` 随聚合拆分
    // 早已不存在、`main/knowledge-vault.ts` 少了一层 `services/`，而没有任何断言盯着它们。
    const pointerDocs = [
      'AGENTS.md',
      'README.md',
      'CONTRIBUTING.md',
      'docs/10-ui-ux-system.md',
      'docs/11-qoder-handoff.md',
      'docs/12-engineering-standards.md',
      ...REPO_FILES.filter((relative) => /^\.qoder\/rules\/.*\.md$/u.test(relative)),
    ];
    const pathLike =
      /`((?:apps|packages|scripts|standards|docs|resources)\/[A-Za-z0-9_.@/-]*\.(?:ts|tsx|css|mjs|json|md|sh|py))`/gu;
    const missing: string[] = [];
    let checked = 0;
    for (const doc of pointerDocs) {
      for (const match of read(doc).matchAll(pathLike)) {
        const target = match[1] ?? '';
        // 模板占位（`docs/logs/YYYY-MM-DD.md`）与带通配的形状不是指针，不参与存在性判断。
        if (/YYYY|\*|</u.test(target)) continue;
        checked += 1;
        if (!REPO_FILES.includes(target)) missing.push(`${doc} → ${target}`);
      }
    }
    expect(checked, '一条仓库路径指针都没解析出来，本条护栏已空跑').toBeGreaterThan(0);
    expect(
      missing,
      '这些路径在仓库里不存在或已搬家：改准指针，别让下一个会话照着它去开一个空文件',
    ).toEqual([]);
  });

  it('交接与规则文档不得宣称台账组件尚未落地', () => {
    // 台账与真实导出的双向一致由上一条管；这一条管的是**另一个会被当现状读的地方**。
    // 2026-10-02 实测 `docs/11:149` 写着「Tooltip、Skeleton、Switch 未落地」，而 `Switch.tsx`
    // 与 `Tooltip.tsx` 都存在、都在台账里——照这句话干活的智能体会自造第二颗开关，
    // 而基座护栏只认得台账里那一颗。
    const ledger = read('docs/10-ui-ux-system.md');
    const ledgerStart = ledger.indexOf('#### 10.1.2 当前组件台账');
    expect(ledgerStart, '找不到 docs/10 §10.1.2 的组件台账，本条护栏已空跑').toBeGreaterThan(-1);
    const ledgerSection = ledger.slice(
      ledgerStart,
      ledger.indexOf('#### 10.1.3', ledgerStart) === -1
        ? ledger.length
        : ledger.indexOf('#### 10.1.3', ledgerStart),
    );
    const exported = [
      ...[...ledgerSection.matchAll(/^\| `([A-Z][A-Za-z]+)`(?:、`[A-Z][A-Za-z]+`)?\s*\|/gmu)].map(
        (match) => match[1] ?? '',
      ),
    ].filter((name) => name !== '');
    expect(exported.length, '台账解析不出任何组件，本条护栏已空跑').toBeGreaterThan(0);

    const statusDocs = [
      'AGENTS.md',
      'docs/11-qoder-handoff.md',
      ...REPO_FILES.filter((relative) => /^\.qoder\/rules\/.*\.md$/u.test(relative)),
    ];
    const notShipped = /未落地|尚未落地|还没有落地|未实现|尚未实现|没有实现/u;
    const offenders: string[] = [];
    for (const doc of statusDocs) {
      for (const line of read(doc).split('\n')) {
        if (!notShipped.test(line)) continue;
        // 只在「说它没有」的那个分句里找组件名：`，。；：！？（）` 算分隔符，`、` 不算——
        // 「Tooltip、Skeleton、Switch 未落地」整串是一份被否定的清单。这样既拦得住反向陈述，
        // 也不会把「Skeleton 未落地；Tooltip 在台账里」这种改正句一起判成违规。
        const denied = line
          .split(/[，。；：！？（）]/u)
          .filter((clause) => notShipped.test(clause));
        for (const name of exported) {
          const named = denied.filter((clause) => new RegExp(`\\b${name}\\b`, 'u').test(clause));
          if (named.length === 0) continue;
          offenders.push(
            `${doc}：${name} 就在 §10.1 台账里，这一句却说它没落地——「${(named[0] ?? '').trim().slice(0, 48)}」`,
          );
        }
      }
    }
    expect(
      offenders,
      '组件是否落地只有 docs/10 §10.1 台账与代码两个读点，别在交接或规则文档里另说一套（docs/10 §10.1）',
    ).toEqual([]);
  });

  it('规模计数必须带日期或写明以当次为准', () => {
    // 测试文件数、用例数、护栏条数这类「体系规模」的数字最容易被引用，也最先过期：
    // 2026-10-02 实测同一个数在四处并存（README 20 文件／131 例、docs/12 §9 170／1,605、
    // docs/11 §3 181／1,720、当次 verify 181／1,745）。本条不要求每处都算对——只要求每一处
    // 要么带「截至哪一天」，要么写「以当次为准」，让读的人能判断它是不是现状（docs/12 §1）。
    const scaleDocs = [
      'AGENTS.md',
      'README.md',
      'CONTRIBUTING.md',
      'docs/10-ui-ux-system.md',
      'docs/11-qoder-handoff.md',
      'docs/12-engineering-standards.md',
      ...REPO_FILES.filter((relative) => /^\.qoder\/rules\/.*\.md$/u.test(relative)),
    ];
    const scaleCount =
      /\d[\d,]*\s*(?:测试文件|个测试|项测试|测试用例|条规范护栏|条护栏|条断言|组渲染检查|渲染检查)/u;
    const dated = /20\d\d-\d\d-\d\d|截至|实测|当次/u;
    const offenders: string[] = [];
    let checked = 0;
    for (const doc of scaleDocs) {
      // 按句切，不按行：整行放行会让一句里顺带出现的日期替另一句背书——2026-10-02 变异验证时
      // 把 README 那套过期数字塞回带日期的同一行，护栏就读不到了，正是这个形状。
      for (const sentence of read(doc).split(/[。！？；\n]/u)) {
        if (!scaleCount.test(sentence)) continue;
        checked += 1;
        if (dated.test(sentence)) continue;
        offenders.push(`${doc}: ${sentence.trim().slice(0, 60)}`);
      }
    }
    expect(checked, '一条规模计数都没扫到，本条护栏已空跑').toBeGreaterThan(0);
    expect(
      offenders,
      '这些规模数字既没有日期也没写「以当次为准」，会被下一个会话当成现状引用（docs/12 §1）',
    ).toEqual([]);
  });
});
