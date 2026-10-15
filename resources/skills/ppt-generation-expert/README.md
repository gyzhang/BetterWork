# ppt-generation-expert

> 公司模板 PPT 生成技能：AI 对话生成整册可交付 .pptx——SVG 驱动、原生可编辑形状、零位图、三道机械质量闸门；长文档/书稿浓缩成 40 页以上大册走派工流水线。

面向 BetterWork 的公司模板 Skill 包，使用开源 [ppt-master](https://github.com/hugohe3/ppt-master)（已校验基线 v6.6.0），当前注册模板：**中电金信**。

## 1. 核心能力

| 能力 | 说明 |
|---|---|
| BetterWork 流水线 | `project-init → 写 SVG → svg-export（三闸门与 final 质检）→ template-merge → pptx-validate` |
| 三道机械闸门 | `verify_palette`（配色越板即拒）→ `verify_layout`（L1–L5 版式缺陷拦截）→ `verify_geometry`（数据几何一致性），任一不过导出器拒跑 |
| 长文档 → 大册派工 | 源不在当前上下文、成片 ≥40 页时改走五阶段：并行抽 `_digest/` 章节摘要（数字逐条带口径/时点/来源/证据级别）→ 主代理独占 `_plan.md` 派工单（兼 `pages.json` 唯一来源）→ 分批写页（每批 8–14 页 + 标杆原型页）→ 批次闸门隔离 → 全册汇总与备注注入；实测 27.7 万字符书稿 → 79 页成片。规程见 `references/long-doc-deck.md`，入口判据见 `references/long-doc-deck.md §1` |
| 图表骨架三域 | 值驱动 `chart/` 33 · 行列定位 `table/` 6 · 拓扑驱动 `diagram/` 8（组织/流程/网络/时间轴/里程碑/路线图/排期/金字塔），本 skill 自持 8 个关系/结构图骨架 |
| 图标库 | 12027 枚五库图标（含 simple-icons 3675 枚真实品牌 mark），`<use data-icon>` 契约取用 |
| 原生编辑能力 | 导出页面为 PowerPoint 原生形状，SVG 超链接可转为原生链接。原生图表/表格/图片注入脚本属于离线维护路线；当前 BetterWork manifest 未声明这些命令，除非 Run 明确绑定相应能力，否则不能承诺调用 |
| 叙事风格包 | 5 套：经营复盘 / MBB 咨询 / 制度规程 / 通用决策 / 融资路演 |
| 图片证据 | 白名单注入：维护「可插入图片/」信任图片池，AI 主动扫描选图并自写 embed_images.json |

## 2. 导入与运行

- 在 BetterWork 的技能页导入本包目录、ZIP，或可访问的 HTTPS ZIP 地址。包内 betterwork.skill.json 声明 Skill 自身的依赖锁、受管 CPython 兼容版本、命令契约和 PPT Master 工具链需求。
- BetterWork 管理 CPython 并按锁准备 Skill 专属依赖环境；普通用户不需要安装 Python、运行 pip 或选择解释器路径。信任、依赖授权和环境准备仍是各自独立的状态。
- 本 Skill 需要 PPT Master 6.6.0。当前包声明版本和 commit，但尚未内置可自动下载的精简工具链制品；使用者需要在 Skill 详情中登记获准的 PPT Master 目录快照并选中它。登记的是本机受管快照，不会把作者机器上的绝对路径写入包。
- Skill 命令只能通过 BetterWork 当前 Run 提供的执行入口调用。输入材料需由用户选择；模板等 Skill 包资源通过 Skill 绑定读取。
- `svg-export` 每次都会使用新的 attempt 目录；只依据本次调用返回的诊断、报告和产物路径处理失败或继续合并。若缺省 `spec_lock.md` 的 `scaffold-lock` 明确失败，按 `references/workflows/spec-lock-fallback.md §1` 处理，不要原样重试；完整运行步骤见 `references/workflows/standard-deck.md §3`。

## 3. 作者自检

以下命令供包作者在开发机验证，不是普通用户的安装步骤。


- **端到端自检** `tests/selftest_e2e.py`：十套件 **118 项**断言，覆盖 mainline 全链路、骨架声明即存在、几何/版式/配色校验器、批次闸门隔离、原生表格与超链接穿 merge、骨架换色收敛、文档写作纪律。
- **一致性审计** `scripts/audit_consistency.py`：8 检查族（版本/资产计数/自检/分支/定制/依赖/引用），文档↔磁盘↔上游任何漂移即非 0 退出。
- **批次闸门隔离** `scripts/gatecheck.py`：三道闸门都是 `svg_output/` **全目录扫描**，并行派工时会把别人未完成的页判成你的错。该脚本为每批建私有目录（只拷 `spec_lock.md` + 本批页），退出码 0 = 本批全过。`--batch` **必填**（漏传即 exit 2 拒跑，不给默认值是为了避开同批目录互相清页），并行各批须用不同名字；隔离行为本身已由 `palette` 套件的五断言回归锁定。

```bash
# 回归自检
env -u PYTHONPATH python3 tests/selftest_e2e.py --suite all
# 一致性审计
env -u PYTHONPATH python3 scripts/audit_consistency.py
# 单批闸门隔离（大册派工中每批收尾跑一次；--batch 必填且各批不同名）
env -u PYTHONPATH python3 scripts/gatecheck.py <project_dir> --pages 'p15_*' 'p16_*' --batch <批次名>
```

## 4. 文档地图（按需加载）

| 层 | 文档 | 管什么 |
|---|---|---|
| L0 硬事实 | templates/中电金信.md · 项目 spec_lock.md | 色板、字号档位、布局坐标、可用版式清单 |
| L1 入口 | SKILL.md | 适用范围、工作流主线、硬约束和精确资源路由 |
| L2 工作流 | references/workflows/standard-deck.md · references/workflows/svg-authoring-and-quality-gates.md · references/workflows/delivery.md | 按规划、SVG、交付阶段分别加载 |
| L2 运维 | references/workflows/maintenance.md · references/workflows/troubleshooting.md · references/workflows/svg-to-png.md | 仅维护、排障或明确的图片旁路任务加载 |
| L2 专项 | references/svg-native-guide.md · references/charts-library.md · references/charts-atlas.md · references/diagrams-library.md · references/long-doc-deck.md | SVG 语法、图形选型和长文档派工 |
| L3 风格包 | references/styles-playbook.md · references/styles/duty-manual.md · references/styles/mbb-consulting.md · references/styles/operating-review.md | 先选风格，再只加载对应的完整风格包 |
| 维护纪律 | references/doc-writing-discipline.md | 修改文档前先读事实源和变更约束 |

## 5. 上游同步

上游依赖是普通 clone（origin 直连源仓库），**不 fork、不打本地补丁**，仓库脏了随时删除重 clone——自持资产全部在本 skill 内。

同步口诀：**`git pull` → 跑自检 → 跑审计**，全绿才继续交付。

## 6. 交付纪律

- 所有办公 PPT 一律使用公司模板，页标题由版式占位符承载（SVG 内不画页标题）。
- 图表数据真实可查、值与几何一致；经不起追问的主张删除而非弱化。
- 大册派工额外一条：页面上每个数字都要能在原文里检索到，章节摘要标了「未在原文出现」的一律不上片。
- 商业片配色红线：禁黑色大块与大面积红，渐变/阴影/光晕只走主题蓝族与中性灰。
- 交付前双轨目检：源 SVG 渲染看中文与文案，合并后 PPTX 渲染看几何。

## 7. 许可

MIT（见 LICENSE）。本副本经作者授权随 BetterWork 分发；原仓库早期的私有仓库与禁止公开转发提示已过期，不适用于 BetterWork 随包版本。
