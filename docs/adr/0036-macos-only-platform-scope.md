# ADR-0036：平台范围只有 macOS

- 状态：Accepted（2026-10-02 光哥指令：「当前咱们的项目只关注 macOS，其他操作系统暂不关注，也不用去兼容」）。
- 日期：2026-10-02。
- 依据：[AGENTS.md](../../AGENTS.md) §3 架构硬约束、[交接说明](../11-qoder-handoff.md) 第 3 节验证口径。
- 关系：不改写任何既有 ADR 的结论；它把散在 CI 配置与测试宿主里的**隐含平台假设**显式化，并据此删掉一处死代码、改掉一处门禁配置。

## 背景

`npm run verify` 在本地 macOS 上 175 个文件全绿，而 GitHub Actions 从 2026-10-01 11:51 起连红五次。逐条归因后，四类失败里只有一类是代码问题：

| 红项 | 归因 |
| --- | --- |
| `scripts/ui-render-check.test.ts`（3 项） | Electron 在 Ubuntu runner 上 `FATAL:sandbox` → SIGTRAP。`xvfb-run` 只给显示服务，给不了 userns/AppArmor 允许的沙箱 |
| `scripts/expert-release-preflight.test.ts`（1 项） | 脚本的 macOS 守卫先触发（`--signed-app 只支持在 macOS 上校验 .app 签名`），断言等的是路径检查那条文案 |
| `standards/ui-governance.test.ts`（1 项） | 该文件在 runner 上 8.5s，其中一条 ESLint 门禁用例撞 5s 默认超时 |
| `apps/desktop/src/renderer/src/views/SkillsView.test.tsx`（2 项） | **真实缺陷**：用例之间通过共享的 `window.localStorage` 漏了卡片／列表偏好 |

前三类的共同点是**门禁在测一个我们不需要兼容的平台**。仓库的依赖面从头到尾都是 macOS 单平台：`codesign` 与 `.app` 签名校验、`mac-process-supervisor`、`resources/dependency-locks/ppt-generation-expert-darwin-arm64-cp312.json`。为让 ubuntu runner 变绿而加的开关（`ui-render-runner.ts` 里那条 `process.platform === 'linux'` 追加 `--no-sandbox`）产品里永不执行，只留下一条「CI 上才成立」的路径。

第四类是这次迁移顺带照出来的：`SkillsView.test.tsx` 的绿依赖一个巧合——本机 darwin ＋ jsdom 30 ＋ vitest 4 下 `window.localStorage` 取不到（探针读数 `type: "undefined"`，url 是 `http://localhost:3000/`），读失败兜底成卡片视图，于是前一个用例点过「列表」也漏不到后一个用例。一旦这份 storage 真的存在（ubuntu runner 上就是），第 12、13 号用例立刻红。

## 决策

1. **产品、测试宿主与 CI 门禁一律按 macOS（darwin/arm64）口径**。不再为其他操作系统新增兼容分支、跳过条件或 runner 适配开关；已存在的按死代码处理，发现一处删一处。
2. **门禁 runner 与被支持的平台一致**：`.github/workflows/verify.yml` 改 `runs-on: macos-latest`，并去掉 `xvfb-run --auto-servernum` 前缀——macOS 上 Electron 有自己的显示会话，不需要虚拟显示。
3. **删掉 `scripts/fixtures/ui-render-runner.ts` 里那条 Linux `--no-sandbox` 分支**。它当初就是为了喂 ubuntu runner 写的，注释里也写明了「不改变产品窗口的 sandbox 契约」；现在连测试宿主也不再跑在 Linux 上。
4. **平台专属能力自己的运行期守卫保留**，例如 `expert-release-preflight.mjs` 在非 macOS 上直接失败。那是**产品语义**（签名校验只在 macOS 有意义），不是跨平台兼容——守卫的作用是报错而不是伪造通过，与「为让别的环境变绿而绕路」正好相反。
5. **用例不得依赖「某个全局在 jsdom 里恰好不存在」**。`SkillsView.test.tsx` 改成每个用例装一份全新的内存 storage（与 `App.test.tsx` 在 `beforeEach` 里 `vi.stubGlobal('localStorage', …)` 是同一个口径，不引第二套做法）。这条独立于平台，无论 runner 在哪都成立。

## 实现边界

- 不引入 Windows／Linux 的 CI 档，也不为「以后可能要跨平台」预留抽象——那属路线图外的系统（AGENTS.md §5「不为了以后可能需要提前实现」）。
- 不改 Electron、Node、`jsdom` 的版本策略；`package-lock.json` 里那些 `@esbuild/linux-*`、`@rollup/win32-*` 是 npm 可选依赖的正常产物，不是兼容承诺，不动。
- 不开 `main` 分支保护：门禁红不红是信号，直推 `main` 的工作流不变。要不要把它变成真正阻塞的闸门是另一件事，另拍。

## 后果

- 门禁从「测一个我们不兼容的平台」变成「测我们唯一支持的平台」。前三类红随 runner 迁移消失；**如果 macOS runner 上仍然红，那才是代码问题**，按 GATE-0 的顺序查。
- 公开仓库的 GitHub 托管 macOS runner 不额外计费，所以这条没有成本代价。
- 代价是首次运行要观察两件事：`npm ci` 在 macOS 上编译原生模块（`better-sqlite3`）的耗时，以及 15 分钟 `timeout-minutes` 够不够。首跑读数记回本记录。
- `docs/11-qoder-handoff.md` 里「Linux 使用 `xvfb-run …`」与「macOS 和 Windows 基础打包验证仍未达成」两处表述同轮改掉——留着就是第二份与代码不符的平台口径。

## 验证

- 成对实验（本地 macOS，两发互为对照）：给 `SkillsView.test.tsx` 在模块加载时装一份**跨用例持久**的内存 store，用例立刻精确复现 CI 那两条红（`× switches between card and list view`、`× returns to browse`）；把 `beforeEach` 换成逐用例全新 store，同一条件下 12/12 绿。证明修的正是漏状态这一件事，不是碰运气换环境。
- 探针（一次性文件，跑完即删）：`@vitest-environment jsdom` 下打印 `{ platform: 'darwin', type: 'undefined', url: 'http://localhost:3000/' }`。
- 远端：推送后看 Actions 首跑的耗时与红绿，读数记回上一条。
