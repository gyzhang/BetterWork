# A00–A06：Skill 管理与配置

每项共同遵守 [执行手册](README.md) 和 [共享契约](contracts.md)。本组不运行用户 Python 脚本、不安装 Python 包、不生成公司 PPT。

## A00 基线与实施决策固定

- 前置：无。此任务只写文档。
- 必读：AGENTS、docs/12、ADR-0008/0009/0010/0011、执行器设计、本组任务。
- 工作：核对任务手册所列文件是否存在；读取 git 状态；列出已接受产品规则和 D1–D6 的实施状态。结合用户本次授权确认可以落地的选择；没有授权的 Proposed 选择列为明确待决，不自行 Accepted。确定新增 Python/native helper 如何纳入根规范和验证，记录平台/工具链可用性。
- 允许改动：docs/development 的基线/决策记录、相关 Proposed ADR、当日日志；不碰业务代码。
- 交付：新增 `docs/development/implementation-decisions.md`，逐项记录 D1–D6 和授权来源，以及 A01 是否可以开始。无需重复研究已明确内容。
- 验收：所有设计阻塞都有具体编号/影响任务；平台缺失不被写成通过；文档链接和 git diff --check 通过。
- 停止条件：用户选择不同安全/执行模式时先修设计，不沿用冲突任务卡。

## A01 共享协议与配置状态

- 前置：A00 明确可实施范围。
- 必读：协议 index.ts/index.test.ts、docs/02、docs/03、docs/12 §4/7、contracts §1/2。
- 目标：定义 Skill 列表/详情、修订、runtime profile 草稿、信任状态、blockedReasons 与管理请求/返回 Schema。
- 允许改动：packages/agent-protocol；契约文档及日志。此时不注册未实现 handler。
- 实施顺序：先列管理动作输入输出 → 定义 Zod → 推导类型/判别联合 → 写合法和非法边界测试。来源/真实路径/信任指纹不由客户端随意指定。导入以 Main 文件选择返回结果，不接收任意机器路径请求。
- 必测：未知/多余字段按规定拒绝；未信任+启用+缺依赖可表达；trusted 不等于 ready；未规范 semver 的版本原样保留；没有可执行命令的 Skill 可保存。
- 验收：现有 StartRun/Markdown API 无回退；协议测试和完整 verify 通过。
- 不做：新增 Run 状态、修改 Agent Core、实现脚本执行。

## A02 Skill/Profile/Trust 仓储与迁移

- 前置：A01。
- 必读：docs/12 §6/9，db/app-schema、migrate、persistence/index 与现有仓储测试。
- 目标：在应用库保存 Skill、不可变修订、profile 修订、用户启停/撤销偏好和授权记录。
- 允许改动：app-schema 新迁移、migrate.test、skill-repository 及测试、AppStore 装配。不得修改历史迁移。
- 实施顺序：确定本次必要表与外键 → 追加新迁移 → Repository 行映射 → 更新 AppStore → 用内存/临时 SQLite 验证。依赖实体尚未落地时以配置草稿/指纹未齐表达，不提前建立伪环境。
- 必测：新库/历史库升级/幂等重开/失败回滚；新版本不覆盖旧内容；同名不同 id；撤销偏好重启后保留；关联冲突拒绝；同事务外键完整性。
- 验收：不需要 UI 即可保存再读取；测试用真实数据库关系；verify 通过。
- 不做：依赖下载、文件导入、全库重构。

## A03 目录导入、定位与导出

- 前置：A02。
- 必读：执行器设计 §3/5，docs/09，contracts §3，docs/12。
- 目标：目录 Skill 原包复制为受管修订；开发/安装/用户根有统一定位器；支持目录导出。
- 允许改动：skill-service、资源文件 helper、对应测试；必要依赖仅为 frontmatter/受限 YAML 解析（沿用根配置），不调用进程。
- 实施顺序：注入源/目标根、hash/复制函数 → 解析 frontmatter → 枚举/限额/边界 → staging 复制复核 → 文件落盘/DB 登记 → 导出所选修订。导出不含 grant/密钥/本机绑定。
- 必测：嵌套 scripts/references/assets 完整保留；未知字段；中文/空格；同名导入；损坏 YAML；绝对/.. 路径、符号链接、特殊文件；复制或 DB 失败；未产生可见半安装；源目录 hash 不变。
- 验收：用临时合成 Skill 往返内容 hash；用户样本仅在授权本地操作中复制到测试用户目录，原目录不变，不放入 Git。
- 不做：ZIP、脚本探测执行、pip、模板解析。

## A04 内置来源、信任与用户副本

- 前置：A03。
- 必读：ADR-0011、产品定义 §5.1/5.2、执行器设计 §5.1/7、contracts §2。
- 目标：内置发布清单验证、内置默认信任、用户信任/撤销、启停、复制并编辑。
- 允许改动：skill-service、trust 纯策略 helper、仓储必要方法、resources/skills 中通用文字示例与发布清单；禁止公司样本资源。
- 实施顺序：核验来源/内容 → 派生状态 → 授权内容与依赖指纹 → 用户 override → 复制新 user ID → 升级保留 override。撤销发出可注入的运行取消请求接口，暂没有执行实例时返回空清理；A15 接真实执行服务。
- 必测：伪造 builtin/trusted 拒绝；用户项初始未信任；未信任不能试运行；代码/依赖/profile 变化失效；元数据展示名变化规则一致；更新不恢复 revoked/disabled；副本不继承 grant；撤销接口收到正确 skillId，不影响其他对象。
- 验收：完整状态真值表测试；不存在只保存 trusted=true 的绕过路径。
- 不做：为未来脚本加假成功执行结果。

## A05 管理 IPC 与 Preload

- 前置：A04。
- 必读：共享协议、ADR-0003、docs/12 §7/8、register-ipc 测试、preload。
- 目标：把已实现的管理能力接入 typed API，Main 负责目录选择/资源定位。
- 允许改动：register-ipc、preload、main/index 依赖装配、对应测试及协议必要修正。
- 必测：非法输入/输出；取消目录选择不导入；有效 import/save/list/detail/trust/revoke/enable/disable/copy/export；Renderer 伪造指纹或来源拒绝；失败可回报而不是吞掉异常。
- 验收：IPC 替身完成临时 Skill 导入→授权→停用→重开读取→导出；验证资源未修改且 API 不泄露凭据。
- 不做：执行 IPC、任意文件访问 IPC、重复创建 ipcMain.handle 注册点。

## A06 管理界面与 A1 验收

- 前置：A05。
- 必读：docs/10 §6.1.1/8/9，docs/12 §8，现有 views/hooks/layout/ConfirmationDialog。
- 目标：能力入口显示 Skill 列表与详情/编辑，支持导入、用户副本、启停、信任、导出和删除；运行配置先保存草稿。
- 允许改动：SkillsView、use-skills、技能组件、view-types、App 导航、icons 和语义 Token 样式；不大规模重构 App。
- 必测：独立显示来源/信任/启用/环境；未实现执行时禁用试运行并说明；撤销确认与错误可见；异步旧详情不覆盖新选择；内置编辑创建副本；键盘和空状态可用。
- 手工验收：导入合成 Skill、修改副本、授权/停用、重启后状态保留；浅/深/系统模式、窄屏不遮挡主要操作。
- 验收：组件测试、IPC 旅程、verify；任务板 A01–A05 有证据。A1 只认定管理闭环完成，不声称脚本已支持。
- 不做：伪造环境 ready、PPT 成果、专家 UI。
