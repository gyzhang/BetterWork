import { describe, expect, it } from 'vitest';

import {
  cssPaths,
  declarationsOf,
  locate,
  pathsUnder,
  read,
  REPO_FILES,
  SOURCE_ROOTS,
} from '../coding-standard-support';

describe('反馈通道纪律', () => {
  it('内联反馈块的配色只能由 tone 档位提供', () => {
    // docs/10 §11.5.1 只有三个落点，`InlineError` 是第二落点的唯一出口，档位是 danger／warning。
    // 知识页曾把「来源检查完成（9/9）」写成常驻内联块：与消息中心重复，而且没有任何清除
    // 路径——只有下一次动作会覆盖它。基础类一旦自己长出颜色，谁写一句就得到第二条成功通道。
    const styles = cssPaths().find((relative) => relative.endsWith('styles.css')) ?? '';
    // 选择器组按逗号拆开逐个判，否则 `.a, .inline-error { … }` 整组漏网。
    const partsOf = (selector: string): string[] =>
      selector
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    const bareOf = (selector: string): boolean =>
      partsOf(selector).some(
        (part) => /^\.inline-error(?![\w-])/.test(part) && !/\[data-tone=/.test(part),
      );
    const colorOffenders = declarationsOf(styles)
      .filter(({ selector }) => bareOf(selector))
      .filter(({ property }) => property === 'color' || property.startsWith('background'))
      .map((declaration) => locate(declaration, styles));
    expect(
      colorOffenders,
      '色与底只能由 `.inline-error[data-tone=…]` 提供，写在基础类上等于开出第二个成功通道',
    ).toEqual([]);

    const tones = [
      ...new Set(
        declarationsOf(styles)
          .map(({ selector }) => /\.inline-error\[data-tone='([^']+)'\]/u.exec(selector)?.[1])
          .filter((tone): tone is string => tone !== undefined),
      ),
    ].sort();
    expect(tones, '内联反馈只有 danger／warning 两档（docs/10 §11.5.1）').toEqual([
      'danger',
      'warning',
    ]);
  });

  it('InlineError 基座不得自带上下缝', () => {
    // 上下缝由承载它的位置拥有：技能页与专家页给 `margin: 12px 32px`（页头带之下、
    // 滚动区之外），知识页与设置页给 `12px 0`。基座自己再叠一道，就会在已有 gap 的
    // 容器里读成双缝（docs/10 §9.8）。
    const styles = cssPaths().find((relative) => relative.endsWith('styles.css')) ?? '';
    const offenders = declarationsOf(styles)
      .filter(({ selector }) =>
        selector
          .split(',')
          .map((part) => part.trim())
          .some((part) => /^\.inline-error(?![\w-])(\s*\[[^\]]*\])?$/u.test(part)),
      )
      .filter(({ property }) => property.startsWith('margin'))
      .map((declaration) => locate(declaration, styles));
    expect(offenders, '`.inline-error` 裸类不得声明 margin，缝归容器').toEqual([]);
  });

  it('已废弃的反馈表面不得复活', () => {
    // `.action-error-banner` 是 §11.5.1 三个落点之外的第四个表面：全局单槽被 25 个调用点
    // 共用、后一个覆盖前一个、要等到切换工作空间才清空，还常与内联提示重复播报同一句话——
    // 用户关掉一处后读到的是「这个提示关不掉」。
    // `.page-toast-host` 与 `.toast-host` 在同一坐标各自 `position: fixed`，后渲染的整列
    // 盖住先渲染的，页面的短时确认会被全局通知压掉；两者已合并为 `#toast-stack` 一列。
    // 后七个是同一个「带底色的内联错误条」的七套几何，已收成 `InlineError` 一处
    // （docs/10 §10.1 台账）。`.memory-projection` 是 2026-09-28 补漏抓到的第八个：
    // 它自带 `--warning-soft` 底、`10px 12px` 内距，还在壳里手排「图标＋文字＋按钮」，
    // 说的是「记忆已保存但投影没跟上」——一句动作结果，按 §11.5.1 归本基座。
    // `.action-note` 曾在这一条外被划给状态轴，那是误判：它唯一的调用点写的是保存成果的
    // 成功／失败，属反馈；两档现已按 §11.5.1 拆开，三条规则一并删除（见 §11.5.2）。
    const retiredSurfaces = [
      'action-error-banner',
      'page-toast-host',
      'toast-host',
      'inline-message',
      'field-error',
      'memory-warnings',
      'knowledge-issues',
      'artifact-action-error',
      'memory-editor-problems',
      'memory-projection',
    ];
    const offenders: string[] = [];
    for (const relative of pathsUnder('apps/desktop/src/renderer/')) {
      if (!/\.(tsx|css)$/.test(relative) || /\.test\.tsx$/.test(relative)) continue;
      const source = read(relative);
      for (const name of retiredSurfaces) {
        // 只看「有没有把它当类名用」：注释里提到这些名字记录的正是「为什么删」，
        // 而 CSS 侧由 selector 判定，不会被散文误伤。
        const usedAsClass = new RegExp(`className[^\\n]*\\b${name}\\b`, 'u').test(source);
        const styled = declarationsOf(relative).some(({ selector }) =>
          selector.includes(`.${name}`),
        );
        if (usedAsClass || styled) offenders.push(`${relative} → .${name}`);
      }
    }
    expect(offenders, '这些表面已并入三个合法落点，不得复活（docs/10 §11.5.1）').toEqual([]);
  });

  it('右下角那一列浮层只有一个容器', () => {
    const styles = cssPaths().find((relative) => relative.endsWith('styles.css')) ?? '';
    const users = [
      ...new Set(
        declarationsOf(styles)
          .filter(({ property, value }) => property === 'z-index' && value.includes('--z-toast'))
          .map(({ selector }) => selector),
      ),
    ];
    expect(
      users,
      '只有 `.toast-stack` 使用 `--z-toast`：再一处 fixed 容器就会在同一坐标盖住另一处（docs/10 §11.5.1）',
    ).toEqual(['.toast-stack']);
  });

  it('内联错误必须走 InlineError 基座', () => {
    // 基座之外留着 `role="alert"`，就是还有一处自己决定底色、字号与关闭路径的错误条。
    // 旧表面全部迁完之后，这条从「只降不升的存量清单」升级为绝对断言：
    // 只有第二落点（`InlineError`）与整页错误态（`EmptyState` 的 `ErrorPage`）可以自写它。
    const exempt: readonly string[] = [
      'apps/desktop/src/renderer/src/components/InlineError.tsx',
      'apps/desktop/src/renderer/src/components/EmptyState.tsx',
    ];
    const offenders = pathsUnder('apps/desktop/src/renderer/')
      .filter((relative) => /\.tsx$/.test(relative) && !/\.test\.tsx$/.test(relative))
      .filter((relative) => read(relative).includes('role="alert"'))
      .filter((relative) => !exempt.includes(relative));
    expect(
      offenders,
      '新增内联错误请用 InlineError；整页错误态才是 EmptyState 里那个 role="alert"（docs/10 §10.1、§11.5.1）',
    ).toEqual([]);

    // 白名单自己也要回对现状：列进去却不再自写 `role="alert"` 的是死条目，留着它只会让
    // 下一个绕过基座的人以为「再加一行是这里的规矩」。
    const staleExemptions = exempt.filter((relative) => !read(relative).includes('role="alert"'));
    expect(staleExemptions, '豁免清单里有文件已经不再自写 role="alert"，把它删掉').toEqual([]);
  });

  it('短时浮层的自消计时不依赖 onDismiss 的标识', () => {
    // `TransientToast` 承诺「4s／6s 后自己消失」。把 `onDismiss` 列进依赖数组就兑现不了这个
    // 承诺：调用点写的是内联箭头（`onDismiss={() => setNote('')}`），宿主每次重渲染都换一个
    // 函数标识，于是每次重渲染都把计时清零——运行中浮层可能永远不消失。这是 2026-09-28
    // 核实的真缺陷，修法在基座（回调经 ref 转发）而不在调用点：包五个 `useCallback`
    // 拦不住下一个页面。这条锁依赖数组的字面形状，同时兼作锚点——effect 被改写即红。
    const relative = 'apps/desktop/src/renderer/src/components/TransientToast.tsx';
    const source = read(relative);
    const effect = /const timer = window\.setTimeout\([\s\S]*?\},\s*\[([^\]]*)\]\);/u.exec(source);
    expect(
      effect,
      `${relative} 里那枚「一条浮层一枚自消计时器」的 effect 换了形状，请同步本条护栏`,
    ).not.toBeNull();
    const dependencies = (effect?.[1] ?? '')
      .split(',')
      .map((dependency) => dependency.trim())
      .filter((dependency) => dependency.length > 0);
    expect(
      dependencies,
      '自消计时只能由「换了哪一句、换了哪一档」重启；`onDismiss` 走 ref 转发，不进依赖（docs/10 §11.5.1）',
    ).not.toContain('onDismiss');
    expect(
      /useRef[^\n]*\(onDismiss\)/u.test(source),
      '回调必须由 ref 转发，否则最新那一个 `onDismiss` 不会被调用',
    ).toBe(true);
  });
});

describe('状态呈现纪律', () => {
  // docs/10 §11.5.2：状态轴说「这个对象现在是什么」，反馈轴（§11.5.1）说「你刚做的那一下
  // 怎么样了」。两轴各只有一个出口，否则同一句「现在如此」会散成八个类名、各写一遍语义字色。
  const retiredStatusSurfaces = [
    'success-copy',
    'skill-blocked-reasons',
    'expert-card-status',
    'memory-duplicate-hint',
    'memory-dependencies',
    'memory-policy-hint',
    'memory-pending-governance',
    'appearance-note',
    'action-note',
    'context-hint',
    'context-phase',
  ];

  it('已废弃的自造状态说明表面不得复活', () => {
    // `.memory-pending-governance` 与 `.appearance-note` 借的是反馈表面的壳（`padding: 10px 12px`
    // ＋ soft 底色），讲的却是一句常驻状态，读起来像「刚刚出事了」；`.success-copy` 的绿字
    // 靠 `!important` 才盖得住容器的 `> p` 规则。三者都已并入 `StatusNote`。
    //
    // `.context-hint`／`.context-note`／`.context-phase` 是同一件事的上下文面板版：三个类只差
    // 字色（muted／secondary／secondary），21 处调用里混着空态、对象状态与读法说明。2026-09-29
    // 逐句分类后前两个类退役——**空态归 `EmptyNotice`、对象状态归 `StatusNote`**，只剩
    // `.context-note` 承载「该怎么读这一段」的说明（3 处），因为说明不属于这两条轴。
    // 所以本条清单里既有并入 `StatusNote` 的类，也有并入 `EmptyNotice` 的类。
    const offenders: string[] = [];
    for (const relative of pathsUnder('apps/desktop/src/renderer/')) {
      if (!/\.(tsx|css)$/.test(relative) || /\.test\.tsx$/.test(relative)) continue;
      const source = read(relative);
      for (const name of retiredStatusSurfaces) {
        const usedAsClass = new RegExp(`className[^\\n]*\\b${name}\\b`, 'u').test(source);
        const styled = declarationsOf(relative).some(({ selector }) =>
          selector
            .split(',')
            .map((part) => part.trim())
            .some((part) => new RegExp(`\\.${name}(?![\\w-])`, 'u').test(part)),
        );
        if (usedAsClass || styled) offenders.push(`${relative} → .${name}`);
      }
    }
    expect(
      offenders,
      '一句只读说明不得自造类：空态归 EmptyNotice、对象状态归 StatusNote（docs/10 §10.1、§11.5.2）',
    ).toEqual([]);
  });

  it('通用字色 utility 不得复活', () => {
    // `.danger`／`.danger-text` 是「谁都能拿来给一句文字上红色」的裸工具类：
    // 它们绕开 tone 档位，让状态色重新散回页面。ADR-0031 收口按钮时删掉了用法，
    // 规则本身留到本轮才清掉，源码里已零引用——留着就是下一条内联成功通道的入口。
    const styles = cssPaths().find((relative) => relative.endsWith('styles.css')) ?? '';
    const offenders = declarationsOf(styles)
      .filter(({ selector }) =>
        selector
          .split(',')
          .map((part) => part.trim())
          .some((part) => /^\.danger(-text)?(?![\w-])/u.test(part)),
      )
      .map((declaration) => locate(declaration, styles));
    expect(
      offenders,
      '语义状态色只能由四个出口或登记清单给，不给「裸色类」留第二条路（docs/10 §11.5.2）',
    ).toEqual([]);
  });

  it('StatusNote 基座不长出表面，档位只有四档', () => {
    const styles = cssPaths().find((relative) => relative.endsWith('styles.css')) ?? '';
    // 「裸类」只指不带 tone 属性的那一条——配色本来就归 `[data-tone]` 档位给。
    const isBare = (selector: string): boolean =>
      selector
        .split(',')
        .map((part) => part.trim())
        .some((part) => /^\.status-note(?![\w-])$/u.test(part));
    const isToneSlot = (selector: string): boolean =>
      selector
        .split(',')
        .map((part) => part.trim())
        .some((part) => /^\.status-note(?![\w-])\s*\[[^\]]*\]$/u.test(part));
    // 有底、有内距、自带上下缝，它就变成第二个 `InlineError`——而 §11.5.1 明确禁止
    // 常驻内联块长出一个成功态。
    const surfaceOffenders = declarationsOf(styles)
      .filter(({ selector }) => isBare(selector))
      .filter(({ property }) =>
        ['color', 'background', 'padding', 'margin'].some((head) => property.startsWith(head)),
      )
      .map((declaration) => locate(declaration, styles));
    expect(
      surfaceOffenders,
      '`.status-note` 裸类不出底色与上下缝：配色归 tone 档位，缝归容器（docs/10 §9.8、§11.5.2）',
    ).toEqual([]);

    const tones = [
      ...new Set(
        declarationsOf(styles)
          .filter(({ selector }) => isToneSlot(selector))
          .map(({ selector }) => /data-tone='([^']+)'/u.exec(selector)?.[1])
          .filter((tone) => tone !== undefined),
      ),
    ].sort();
    expect(
      tones,
      '档位是 neutral／success／warning／danger 四档；`--info` 属通知等级词汇，不补第五档',
    ).toEqual(['danger', 'neutral', 'success', 'warning']);
  });

  it('语义状态色只能由四个出口给，其余逐条登记理由', () => {
    // 「一句状态说明」此前有八个类名各写一遍 `color: var(--warning)`，同一种「要注意」
    // 在不同页面有不同的红。这条把剩下的每一处都点名：不是基座档位，就得给出不复用的理由。
    const styles = cssPaths().find((relative) => relative.endsWith('styles.css')) ?? '';
    const colored = declarationsOf(styles).filter(
      ({ property, value }) =>
        property === 'color' && /^var\(--(?:success|warning|danger)\)$/u.test(value),
    );
    const exits: readonly (readonly [RegExp, string])[] = [
      [/^\.badge\[data-tone='\w+'\]$/u, 'Badge 的 tone 档位（§10.1）'],
      [/^\.inline-error\[data-tone='\w+'\]$/u, 'InlineError 的 tone 档位（§11.5.1）'],
      [/^\.status-note\[data-tone='\w+'\]$/u, 'StatusNote 的 tone 档位（§11.5.2）'],
      [/^\.btn\[data-variant='\w+'\]\[data-tone='\w+'\]$/u, 'Button 的 tone 档位（ADR-0031）'],
      [/^\.popover-menu-item\.danger$/u, '菜单里的破坏性动作项，由 PopoverMenu 基座出档'],
      [/^\.binding-chip\[data-tone='danger'\]$/u, 'BindingChip 的 tone 档位'],
    ];
    const exceptions: Record<string, string> = {
      '.suggestion-facts .warn': '建议卡事实行里的一段要注意文字，随事实折行不独立成行',
      '.error-page-icon': '整页错误态的图标色，不给文字',
      '.dependency-warning':
        'Field 的 hint 是 <span>，块级基座放进去是非法 HTML，只能是一段带色文字（§11.5.2）',
      '.memory-source-available':
        'meta 行里的来源状态词，由 memory-source-${availability} 模板组合',
      '.memory-source-unavailable': '同上',
      '.memory-source-review-required': '同上',
      '.memory-policy-pinned': '优先带入的策略徽片，有意不冒充状态结论',
      '.memory-conflict.conflict-unresolved > strong': '冲突条的领域强调，讲的是这一对的裁决状态',
      '.memory-editor small.over': '字数超限的计数提示，住在进场内右端',
      '.level-success': '通知等级色块（aria-hidden 的图标容器），不是状态说明',
      '.level-error': '同上',
      '.level-warning': '同上',
      '.tool-failure-count': '工作过程条里的失败计数',
      '.tool-pill.failed .tool-pill-status': '工具条的状态文字，由状态类组合',
      '.tool-pill.completed .tool-pill-status': '同上',
    };
    const offenders: string[] = [];
    const hitExceptions = new Set<string>();
    for (const declaration of colored) {
      for (const part of declaration.selector
        .split(',')
        .map((raw) => raw.trim())
        .filter((raw) => raw.length > 0)) {
        if (exits.some(([pattern]) => pattern.test(part))) continue;
        const reason = exceptions[part];
        if (reason === undefined) {
          offenders.push(locate(declaration, styles));
          continue;
        }
        hitExceptions.add(part);
      }
    }
    expect(
      offenders,
      '未登记的语义状态字色：新增一行状态说明请用 StatusNote，别的形态先补 docs/10 §11.5.2（清单见本条）',
    ).toEqual([]);

    // 清单自核：登记过的选择器已经不在样式表里，说明这条护栏已经空跑，删掉死条目而不是留着。
    const stale = Object.keys(exceptions).filter(
      (part) =>
        !hitExceptions.has(part) &&
        !colored.some(({ selector }) =>
          selector
            .split(',')
            .map((raw) => raw.trim())
            .includes(part),
        ),
    );
    expect(stale, '登记清单里有选择器已经不存在，把它从清单删掉').toEqual([]);
  });
});

describe('计时基准车道纪律', () => {
  const timingTests = pathsUnder(...SOURCE_ROOTS).filter(
    (relative) => /\.test\.tsx?$/.test(relative) && !relative.endsWith('.bench.test.ts'),
  );

  it('墙钟计时断言只允许住在 *.bench.test.ts', () => {
    // 并发跑 137 个文件时，p95 会漂到 1.5–5 倍：这类断言留在 `npm test` 里
    // 等于给每次提交加随机红，而红了的门禁很快就会被绕过。
    // 判据取 `performance.now()`——本仓只有「测耗时」用它，`Date.now()` 大量用于
    // 数据夹具（updatedAt/revision 时间戳），拿它当信号会淹成假阳性。
    const offenders = timingTests.filter((relative) => read(relative).includes('performance.now'));
    expect(offenders, '计时基准要挪进 `npm run bench` 的串行车道（docs/12 §9）').toEqual([]);
  });

  it('三条车道的配置与脚本各就各位，且 verify 不含基准', () => {
    const config = read('vitest.config.ts');
    expect(config).toContain("name: 'functional'");
    expect(config).toContain("name: 'heavy'");
    expect(config).toContain("name: 'bench'");
    expect(config).toContain("'**/*.bench.test.ts'");
    expect(config).toContain('fileParallelism: false');

    const scripts = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    // `test` 必须是两次独立调用：漏掉后半，heavy 档的文件会同时被 functional 的 exclude
    // 排掉、又没有任何车道跑它——静默消失且门禁全绿。
    expect(scripts.scripts['test']).toContain('--project functional');
    expect(scripts.scripts['test']).toContain('--project heavy');
    expect(scripts.scripts.bench).toContain('--project bench');
    expect(scripts.scripts.verify ?? '').not.toContain('bench');
  });

  it('heavy 档清单里的每个文件都真实存在', () => {
    // 清单自核：路径写错或文件改名后，该文件既被 functional 的 exclude 排掉、又匹配不上
    // heavy 的 include，于是**一个用例都不跑而门禁全绿**。这是 include／exclude 分档
    // 最贵的失效方式，所以要有一条正向断言盯着清单本身。
    const config = read('vitest.config.ts');
    const block = /const HEAVY_TEST_FILES = \[([\s\S]*?)\];/u.exec(config);
    expect(block, 'vitest.config.ts 里找不到 HEAVY_TEST_FILES 清单').not.toBeNull();
    const listed = [...(block?.[1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1])
      .filter((relative): relative is string => relative !== undefined);
    expect(listed.length, 'heavy 档清单为空，等于这条车道不存在').toBeGreaterThan(0);
    const missing = listed.filter((relative) => !REPO_FILES.includes(relative));
    expect(missing, 'heavy 档清单里有文件已不存在，把它删掉或改准路径').toEqual([]);
  });

  it('基准车道里确实有用例，不给自己留空挡', () => {
    const benchFiles = pathsUnder(...SOURCE_ROOTS).filter((relative) =>
      relative.endsWith('.bench.test.ts'),
    );
    expect(benchFiles.length, '至少要有一条串行车道基准').toBeGreaterThan(0);
    for (const benchFile of benchFiles) {
      expect(read(benchFile), '基准用例必须打印样本值，否则红了无法判断是回归还是抢核').toContain(
        'console.warn',
      );
    }
  });
});
