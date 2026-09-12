# ADR-0013：幻灯片预览的进程内渲染与本地补丁分发

- 状态：Accepted
- 日期：2026-09-12
- 背景：阶段 A 交付的 PPTX 成果只能在详情页看到文件信息与「打开」，用户无法在工作台内预览版面。原始计划（`docs/07-mvp-and-roadmap.md` 第一步）写的是「python-pptx 读取 + Pillow 生成预览图」，实现过程中曾临时改用 LibreOffice headless 截图，用户测试时出现窗口反复弹出，明确要求回到「简单预览」并参考已有项目的现成实现。
- 关系：落实 ADR-0002（Artifact-first，成果是一等界面对象）与 ADR-0009（脚本型 PPT Skill 基线）的产物可读要求；不改变 ADR-0005 的成果与版本存储契约；依赖 ADR-0003 的进程边界——渲染发生在 Application/Infrastructure 层，Renderer 只接收类型化结果。

## 决策

1. **PPTX 页面预览由主进程内的纯 JS 渲染器 `pptx-glimpse` 完成**，不引入 LibreOffice、PowerPoint、Keynote 或任何外部应用、常驻服务、HTTP 服务。渲染器以 `PptxRenderer` 接口注入 `FileArtifactService`，测试用假实现替换。
2. **渲染结果是派生缓存，不是成果**：落在 `userData/artifact-files/<versionId>/thumbnails/slide-<n>.png`，文件名即页号，可随时整目录删除并由下一次请求完整重建；不参与成果真实性校验，不进入导出与版本谱系。写入失败清掉半成品目录，宁可重来，不留缺页缓存。
3. **跨 IPC 内联图片数据，不传本机路径**：`artifactThumbnailSchema` 输出 `dataUrl`（`data:image/…`）。Renderer 不得接触文件系统（ADR-0003），且开发模式页面源是 `http://localhost`，`file://` 子资源会被拦下。**这条决定要求 CSP 显式放行 `img-src … data:`**：`index.html` 的 CSP 原本只写了 `default-src 'self'` 而没有 `img-src`，按规范会回退到 `default-src`，而 `'self'` 不含 `data:`——后果是预览图全部加载失败、界面只剩 alt 文本，而 lint、typecheck、单测与构建全部通过。该契约由 `standards/coding-standard.test.ts` 的结构护栏守住（协议输出 `data:image/` 时 CSP 必须声明含 `data:` 的 `img-src`），因为它在单元层不可测。
4. **中文字体随包分发并显式映射**：应用自带 `resources/fonts/SourceHanSansSC-Regular.otf`，并把微软雅黑／黑体／宋体／楷体／仿宋／等线等常见字体名统一映射到它。macOS 自带中文字体是 `*.ttc` 集合加 AAT 表头，`opentype.js` 解析不了。映射不改变当前输出（只随包一份字体时，未命中名字会兜底到已加载的第一份字体，带与不带映射的 PNG **字节完全相同**，已实测）；保留它是因为一旦随包第二种字族，兜底结果就取决于加载顺序而不是字体名。不得把它当作防空框的手段而删去，也不得在文档里声称它今天单独在防空框。见 [字体资源说明](../../resources/fonts/README.md)。
5. **渲染只认随包字体目录，不扫描系统字体**（本地补丁新增 `onlyFontDirs` 选项，默认 `false` 保持上游语义）。上游默认会递归扫描 `/System/Library/Fonts` 等三个目录并**逐个解析全部字体**：本机实测 263 个文件 / 300MB，冷渲染 3746ms、渲染后常驻堆 2485MB（RSS 3.1GB），而默认堆上限 4192MB——这在 Electron 主进程里是一次真正的 OOM 风险，且耗时与内存完全取决于用户装了什么字体。限制后同一渲染 303ms / 236MB（约 12 倍与 10 倍改善），输出字节与限制前一致（已目视核对中文与版面）。代价是拉丁字体名（Arial 等）不再命中真字体，退回思源黑体的拉丁字形——预览要的是版式辨识，不是排印还原。
6. **三方依赖的必要修改用 `patch-package` 管理**：补丁随仓库提交在 `patches/`（15 个 hunk，同时打在 `dist/index.js`、`dist/index.cjs` 与 `dist/index.d.ts`），由根 `package.json` 的 `postinstall` 应用；被修改的依赖 pin 到确切版本，使「补丁失配」在装包时立即失败而不是静默降级。补丁承担两类修复：中日韩字体名与字体子表登记，以及上述 `onlyFontDirs`。上游发布包含对应能力的版本后应删除补丁。
7. **懒生成、可解释失败**：预览只在用户打开该版本时生成，命中缓存直接返回；渲染器抛错、渲染出零页、成果文件已被清理，都返回带中文说明的 `error`，界面回落到「可通过『打开』用系统应用查看」，不静默显示空白。

## 为什么不是原计划的 python-pptx + Pillow

`python-pptx` 是**结构化读写库，没有渲染引擎**。它能给出形状树、文本、颜色与坐标，但把一页 PPT 真正画成位图需要自己实现 PowerPoint 的版式求解：占位符继承、母版与主题级联、autofit 缩放、艺术字、SmartArt、图表。这不是「提取页面信息 + Pillow 拼图」的量级，做出来的也不是用户认得出的预览。

因此保留原计划的**产品目标**（详情页缩略图 + 点击放大 + 仍可用系统应用编辑），替换其**技术手段**。这也意味着 ADR-0009 的 Python 运行时不是本功能的依赖——预览是纯 Node 路径，不占用 Skill 的执行环境。

## 被否决的替代方案

- **LibreOffice headless 转 PNG**：能出像素级结果，但要用户装一个几百 MB 的办公套件，首次转换秒级到十几秒，进程冷启动在 macOS 上会抢焦点。实际事故里它在用户机器上反复拉起窗口，把一次前端缺陷放大成「电脑在发疯」。外部进程也是本机唯一无法用假实现覆盖的依赖，测试门禁覆盖不到。
- **Renderer 侧解析 PPTX（jszip + 自建解析）**：把 Office 格式复杂度推给浏览器端，违背 ADR-0003 的进程边界，且需重写一整套版式求解。
- **在线预览服务 / Office Online**：把用户成果上传第三方，直接违反本地优先与文件只读原则。
- **对「打开」后的系统应用截屏**：需要屏幕录制授权，且脱离任务上下文。

## 已知代价与后续触发条件

- 冷渲染 303ms、热渲染（同一字体集已缓存）约 25ms，跑在 Electron 主进程上。**当前接受**：预览懒加载、按版本触发、结果落盘后不再重算，且有明确 loading 态；300ms 量级不需要 `worker_threads`。若未来放开系统字体扫描或支持超大 deck，内存与耗时按决策 5 的实测口径重新评估，届时迁 worker 属于新的技术选择，需另行记录。
- 渲染器的字体集缓存在模块级变量里，键包含 `fontDirs` 与 `fontMapping`；因此传给 `convertPptxToPng` 的映射表必须是同一个常量对象，否则每次渲染都会重新解析字体。`createPptxRenderer` 用的是模块常量 `CHINESE_FONT_MAPPING`，不得改成每次调用现构造。
- 同一版本的并发首次请求会各自渲染一次，结果幂等、最坏是重复计算，不做进程内去重锁。
- `patch-package` 是安装期脚本，与 npm 的 `allowScripts` 门禁共存；新增依赖若带安装脚本仍需显式放行。
- 打包路径（`electron-builder.yml` 的 `extraResources` 字体项）在真实 `npm run dist` 产物上尚未验证；monorepo 依赖提升下的 `node_modules` 收集是既有的未验证项，不因本次改动引入。

## 验收要求

- 中文 PPTX 在 light/dark 与全部色系下预览文字完整、无空框；应用主题不改变幻灯片自身配色（文档画布用 `--artifact-canvas`）。
- 删除 `thumbnails/` 目录后再次打开同一版本可完整重建；重建期间不重复渲染已有缓存。
- 未安装 LibreOffice、未配置 Python 运行时的机器上，预览功能可用。
- `npm ci` 后补丁自动生效；改动被补丁的文件或升级该依赖而不更新补丁时，装包阶段即失败。
- 渲染失败、零页、文件被清理三类错误在界面上各有明确文案，且「打开」按钮始终可用。
