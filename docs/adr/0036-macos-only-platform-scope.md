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
- **`main` 不设分支保护**（2026-10-02 光哥定案：这是单人项目，`main` 就是他的工作分支，没有也不需要他人协作）：门禁的红当信号看，不靠 GitHub 拦推送。真正拦人的是提交前那次 `npm run verify`，不是远端闸门；本记录不留「要不要变成阻塞闸门」这个悬空问题。

## 后果

- 门禁从「测一个我们不兼容的平台」变成「测我们唯一支持的平台」。前三类红随 runner 迁移消失；**如果 macOS runner 上仍然红，那才是代码问题**，按 GATE-0 的顺序查。
- 公开仓库的 GitHub 托管 macOS runner 不额外计费，所以这条没有成本代价。
- 代价是首次运行要观察两件事：`npm ci` 在 macOS 上编译原生模块（`better-sqlite3`）的耗时，以及 15 分钟 `timeout-minutes` 够不够。首跑读数记回本记录。
- `docs/11-qoder-handoff.md` 里「Linux 使用 `xvfb-run …`」与「macOS 和 Windows 基础打包验证仍未达成」两处表述同轮改掉——留着就是第二份与代码不符的平台口径。

## 验证

- 成对实验（本地 macOS，两发互为对照）：给 `SkillsView.test.tsx` 在模块加载时装一份**跨用例持久**的内存 store，用例立刻精确复现 CI 那两条红（`× switches between card and list view`、`× returns to browse`）；把 `beforeEach` 换成逐用例全新 store，同一条件下 12/12 绿。证明修的正是漏状态这一件事，不是碰运气换环境。
- 探针（一次性文件，跑完即删）：`@vitest-environment jsdom` 下打印 `{ platform: 'darwin', type: 'undefined', url: 'http://localhost:3000/' }`。
- 远端首跑读数见下一节。

## 首跑读数（2026-10-02，run #242 / `4477f93`）

`Set up job 1s · checkout 4s · setup-node 1s · npm ci 27s · npm run verify 207s`，整 job 4m6s。`better-sqlite3` 在 macOS 上装得很顺，15 分钟预算余量充足（ubuntu 上 verify 那一步 126s，macOS 慢到 207s，仍不到预算一半）。

上一轮那四类红按预期收敛：`expert-release-preflight` 与 `SkillsView` 转绿，`ui-render-check` 不再崩在 sandbox。剩下的三条红性质不同：

| 红项 | 定性 |
| --- | --- |
| `standards/ui-governance.test.ts > role/button + tabIndex + click 不能冒充原生按钮` | `Test timed out in 5000ms`——撞默认超时，不是断言失败 |
| `scripts/ui-render-check.test.ts > 真实控件几何退化必须使 CLI 失败，不能把 Electron 提前退出读成成功` | 同上 |
| `scripts/ui-render-check.test.ts > 模态有布局和焦点但没有绘制时，截图不能作为有效证据` | 它等的 `截图绘制状态不一致：模态` 没等到，因为**更早就**红在 `宽表滚动区焦点环未完整落在盒内`（jade-light-760） |

前两条属 [工程规范 §9](../12-engineering-standards.md) 说的「慢夹具 ≠ 计时基准」，随后单独一拍处理：两条各按该判据放宽到 20 秒（实测值与口径登在 §9），并证过预算真的接在用例上——把常量临时压到 1ms 时四条全部红成 `Test timed out in 1ms`，所以抬预算是把门禁变可信，不是把红挪个地方。第三条本地 16 组全绿、runner 红，而那条断言原先只报一句标签不报读数，三个条件（环没画／画在盒外／程序化 focus 没继承到 `:focus-visible`）分不清是哪个，所以这里不猜根因，同轮只补可观测性：

- 断言把 `focusVisible`／`outline`／`offset` 三项读数一起塞进错误消息，随 `stdio: 'inherit'` 落进 runner 日志；本地读数 `{"focusVisible":true,"outline":"2px","offset":"-3px"}`，红一次即可定性。
- `UI_RENDER_OUTPUT_DIR` 把产物从一次性临时目录请进工作区（CLI 严格只收三个 `--probe-*` 参数，所以走 env 而不加新 flag），workflow 在 `failure()` 时把 `.ui-render/screenshots` 与读数文件传成 artifact 留 14 天。`permissions` 一旦写了键，未点名的作用域就是 `none`，上传要显式 `actions: write`。
- 读数原本只在 16 组全绿时由 `results.json` 落地，而产物只在红的时候上传，两头正好错开。改为每组 `finally` 另存 `results.partial.json`；`results.json` 仍是「矩阵跑完」的完成证据（`ui-render-check.mjs` 只在退出码 0 时读它），这层语义没动。

变异验证据（本地临时给该行条件加 `innerWidth < 1000`，让 1380 宽的那组先红）：退出码 1，日志给出 `宽表滚动区焦点环未完整落在盒内：{"focusVisible":true,"outline":"2px","offset":"-3px"}`，`.ui-render/` 里留下 3 张截图与含已通过组整份读数的 `results.partial.json`，且 `results.json` 不存在。还原后 16 组全绿、32 张截图、两份读数文件齐。一处诚实的限制：CI 现在红的是 `jade-light-760`，它是矩阵第 1 组，所以那次产物里 `results.partial.json` 只能是空数组，定性仍要靠错误消息里的那三个读数——partial 的作用在「往后几组才红」的场景。

## 二跑读数（2026-10-02，run #244 / `2f96308`）

超时那一类清零（`Test timed out` 2 条 → 0 条），红只剩焦点环一条，仍落在矩阵第 1 组 `jade-light-760`。上一节补的四个读数把方向纠正了过来：

```text
{"focusVisible":true,"focused":true,"outline":"3px","offset":"0px","style":"solid","ring":"#4d8a78","ringOffset":"-3px"}
```

- **「规则没吃到」被证伪**：`outline-style` 已是作者写的 `solid`，两个 token 在该元素上都取到了值。12:37 那节里「`3px`＋`0px` 正好是初始值，所以规则没命中」只对了前半——初始值这一半对，「没命中」这一半错。
- **`transition` 被证伪**：`.markdown-table` 不在 `styles.css` 任何 `transition` 的选择器列表里，全仓没有一条 transition 涉及 `outline`；`prefers-reduced-motion` 那段只压 `transition-duration`，不改 `transition-property`。
- **IACVT（`var()` 取不到值）被证伪**：那条路径会把 `outline-style` 一并退回 `none`，与 `solid` 不符，且 `ring`／`ringOffset` 实测有值。
- **系统对比度／forced-colors 被证伪**：CDP 模拟 `prefers-contrast: more` 与 `forced-colors: active`，本地几何仍读 `2px/-3px`。
- 剩下的形状是「伪类已生效、几何还没跟上」。同一段里那条按钮焦点断言读的是**上一次 `executeJavaScript`** 里 Tab 过的元素，跨了一个 task，它在 runner 上一直绿；只有紧跟 `focus()` 的那一次读红。方向是读取时机，不是 CSS。
- 于是把断言改成逐帧读到稳定再判（`settledRing()`）：每帧重读，连续两次一致才认，上限 8 帧。红字一次给全「稳定读数 · 首帧读数 · 帧数 · 环境」，`outline-color` 也补进读数——它把「简写整体生效」与「只有 `outline-style` 生效」分得很干净。
- 变异验证（本地临时加一条 `.markdown-table:focus-visible { outline-offset: 0px }`）：退出码 1，红字给出 `稳定读数 {"outline":"2px","offset":"0px","style":"solid","color":"rgb(77, 138, 120)"…} · 首帧同值 · 帧数 1`——等待没把稳定的错几何读成绿。还原后本地 16 组全绿、每组帧数 1。
- **未结**：时序假设只有在 runner 上才算验证，本地绿替代不了。若仍红，`帧数` 说明是否一直在收敛中，`color` 说明是否其实走的 IACVT，环境四项读数说明是否被系统设置改了渲染路径。
