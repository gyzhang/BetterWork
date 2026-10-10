# ADR-0047：随包分发独立 Node.js 运行时

- 状态：Accepted（2026-10-10；用户审核通过）。决策 1–4、8–11（运行时随包、MCP 接入、打包配置与 Python 脚本改名）已落地；决策 5–7（Node Skill 执行链、node_modules 落点、信任指纹）暂无现存 Node Skill 消费者，另立 [CF44](../development/tasks-capability-foundation.md) 承载，待首个真实 Node Skill 出现再按实际契约开工，本轮未落地。
- 延续：[ADR-0045](0045-bundled-runtimes-for-local-mcp.md) 的随包运行时机制与离线准备契约、[ADR-0036](0036-macos-only-platform-scope.md) 的 macOS arm64 产品范围、[ADR-0009](0009-script-skill-baseline.md) 的脚本型 Skill 执行基线、[ADR-0011](0011-skill-trust-and-local-distribution.md) 的信任与分发规则。
- 影响范围：内置 Node stdio MCP 的启动方式、用户自定义 stdio MCP 的运行时解析、未来 Node-based Skill 的执行入口与依赖落点、electron-builder 打包配置与构建脚本，以及随包 Python 构建脚本的命名对齐（`prepare-mcp-runtime-assets` → `prepare-python-runtime-assets`，纯改名不改机制）。

## 工作场景

本决策覆盖以下具体工作场景：

1. **内置 Node stdio MCP 稳定运行**：filesystem、memory、sequential-thinking 三个内置 MCP server 不再依赖 Electron 内嵌 Node（`process.execPath` + `ELECTRON_RUN_AS_NODE=1`），改用版本锁定的独立 Node 二进制。Electron 升级不连带改变 MCP 可用的 Node 版本。
2. **用户自定义 stdio MCP 开箱即用**：用户在设置中添加 stdio MCP 连接时，若声明 `command: "node"` 或 `command: "npx"`，应用自动解析到随包 Node 运行时，不要求用户另外安装 Node.js/npm。
3. **Node-based Skill 执行**：Skill 的 `betterwork.skill.json` 声明 `runtime: "managed-node"` 后，应用用随包 Node 执行入口脚本，并将 `node`/`npm`/`npx` 注入子进程 PATH。Skill 内脚本可正常调用 npm 生态工具。
4. **Skill 依赖隔离**：每个 Node Skill 自带 `node_modules/`（Node 天然按目录隔离），不需要 venv 等价物。内置 Skill 的 `node_modules/` 随 `resources/skills/` 打进安装包；用户导入 Skill 首次运行 `npm ci --offline` 装进自己的可写目录。
5. **未来社区生态兼容**：npm 上发布的 MCP server 和 Skill 包（标准 Node.js 项目）能在 BetterWork 内直接运行，不需要用户配置外部运行时。

## 背景

ADR-0045 解决了"内置 MCP 不依赖用户安装 Node/Python"的问题，但采用的方案是复用 Electron 内嵌 Node（`process.execPath` + `ELECTRON_RUN_AS_NODE=1`）。这有三个局限：

1. **版本耦合**：Electron 44.5.1 内嵌 Node 24.18.1；升级 Electron 会连带改变 Node 版本，可能影响 MCP server 或 Skill 的兼容性。
2. **不对外暴露**：`ELECTRON_RUN_AS_NODE` 只对 Main 主动 spawn 的受管子进程生效。用户自定义 stdio MCP 声明 `command: "node"` 时找不到可执行文件；Skill 脚本内调 `npx some-tool` 也会失败。
3. **Electron Node 不是标准 Node**：缺少完整的 npm/npx 生态支持，某些 native addon 在 Electron 变体下行为不同。

同时，`electron-builder.yml` 未显式声明 `electronFuses: { runAsNode: true }`，依赖 Electron 出厂默认。若上游改变默认值或安全策略收紧，现有内置 MCP 会静默失败。

Python 侧已有完整的随包机制（CPython 3.12.14 制品 + SHA-256 校验 + 离线 venv 准备），Node 侧应对称补齐。

此外，随包 Python 的构建脚本 `scripts/prepare-mcp-runtime-assets.mjs` 是个 misnomer：它准备的 CPython base 经 `index.ts` 的 `bundledPythonRoot` 被**所有** Python Skill（含 PPT Skill）共享，并非 MCP 专属；名字只反映 ADR-0045 立项时随包 CPython 的唯一消费者（fetch MCP）。引入 Node 侧构建脚本时一并把命名 convention 对齐，避免"mcp-runtime-assets 里装着全体 Python Skill 共享 base"这种持续误导。

## 决策

1. **随包分发独立 Node.js 24.x 二进制**（darwin-arm64），包含 `node`、`npm`、`npx`。制品来源为 nodejs.org 官方发布归档，版本与 SHA-256 锁定在仓库内的 JSON 清单中，构建期下载并校验，与 CPython 制品走同一套机制。
2. **落地位置**：安装包内 `Contents/Resources/node-runtime/`（含 `bin/node`、`bin/npm`、`bin/npx`、`lib/node_modules/npm/`）。开发态位于 `resources/node-runtime/`。
3. **MCP 侧改用 managed Node**：`builtin-mcp-runtime-service.ts` 对 Node-based 内置 MCP 使用 `<node-runtime>/bin/node` 替代 `process.execPath`；不再需要 `ELECTRON_RUN_AS_NODE` 和 `runAsNode` 标记。guardian 机制不变，只是 executable 换为真 Node。
4. **用户自定义 stdio MCP 的运行时解析**：当用户配置的 `command` 为 `node`、`npm` 或 `npx`（不含路径分隔符）时，应用自动解析到 `<node-runtime>/bin/<command>`。含路径分隔符的命令原样使用（尊重用户显式指定）。
5. **Skill schema 扩展**：`agent-protocol` 的 entrypoint 联合类型新增 `runtime: "managed-node"`（与现有 `"managed-python"` 对称）。执行时：
   - 用 `<node-runtime>/bin/node` 运行入口脚本；
   - 将 `<node-runtime>/bin` 注入子进程 PATH（脚本内 `child_process.execSync('npx ...')` 可用）；
   - Skill 自带 `node_modules/` 提供依赖（Node 标准模块解析自动找到）。
6. **node_modules 落点（不需要 "node venv"）**：Node 的模块解析是从脚本所在目录逐级向上找 `node_modules/`，因此依赖必须落在 Skill 目录内，不能像 Python venv 那样放到独立的 `userData/environments/`。按 Skill 来源区分落点：
   - **内置 Node Skill**：构建期 `npm ci` 装好，`node_modules/` 随 `resources/skills/<skill>/` 打进安装包，位于只读的 `Contents/Resources/skills/<skill>/node_modules/`，运行时就地读取，无准备步骤（状态直接 ready）。
   - **导入 Node Skill**：Skill 落在可写的 `userData/skills/<skill>/`（`index.ts` 的 `userRoot`），首次运行 `npm ci --offline`（从 Skill 自带 npm cache，或经用户允许联网）把 `node_modules/` 装进 Skill 自己的目录 `userData/skills/<skill>/node_modules/`。
   - **不另设 `node-environments/`**：强行对称 Python 的独立环境目录会逼出 `NODE_PATH` 或 symlink 这类逆 Node 生态的 hack。落点虽与 Python 不对称，但**准备生命周期（preparing → ready/failed、可取消、有进度）、信任指纹、离线安装语义与 Python venv 完全对称**——架构哲学一致，机制尊重各自生态。
7. **信任指纹**：Node Skill 的依赖指纹 = `hash(package-lock.json + toolchain snapshots)`，与 Python Skill 的 `hash(dependency-lock + snapshots)` 对称。lock 文件变化 → 指纹变 → 需重新授权。
8. **补充 electronFuses 声明**：`electron-builder.yml` 显式写入 `electronFuses: { runAsNode: true }`。即使内置 MCP 已改用独立 Node，Knowledge worker 和 guardian 仍通过 Electron 内嵌 Node 运行；显式声明防止上游默认变化导致静默失败。
9. **Node 构建脚本**：新增 `scripts/prepare-node-runtime-assets.mjs`，从 `https://nodejs.org/dist/v<version>/node-v<version>-darwin-arm64.tar.gz` 下载，SHA-256 校验后解压到 `build/node-runtime/`（仅保留 `bin/` 和 `lib/node_modules/npm/`，strip 掉 `include/`、`share/`）。`dist:mac` 脚本在 electron-builder 前调用。
10. **平台范围**：当前仅 darwin-arm64（与 ADR-0036 一致）。其他平台不纳入本决策。
11. **随包 Python 构建脚本改名对齐**：把 `scripts/prepare-mcp-runtime-assets.mjs` 重命名为 `scripts/prepare-python-runtime-assets.mjs`，产物目录 `mcp-runtime-assets` → `python-runtime-assets`，安装包内路径 `Contents/Resources/mcp-runtime-assets` → `Contents/Resources/python-runtime-assets`。牵连 `apps/desktop/package.json` 的 script 名、`electron-builder.yml` 的 extraResources from/to、`index.ts` 的 `mcpRuntimeAssetsRoot` 变量、`builtin-mcp-runtime-service.ts` 引用及相关测试与 ADR-0045 文字。**这是纯命名整理，Python 的 venv/wheel/lock 机制、CPython base 与 fetch wheelhouse 的内容和 SHA-256 一字不动。**

## 取舍

| 选项 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **独立 Node 二进制（本决策）** | 版本独立锁定；标准 Node 生态完全兼容；Electron 升级不影响 Skill/MCP；用户自定义 MCP 开箱即用 | DMG +~48 MB | ✅ 采用 |
| Electron 内嵌 Node + shell launcher | 零体积增量 | 版本跟 Electron 绑定；native addon 兼容性风险；无 npm/npx；Skill 生态受限 | ❌ 否决 |
| 要求用户自装 Node | 零 effort | 违背"开箱即用"产品目标（ADR-0045 已确立） | ❌ 否决 |

| 选项 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **Node 24.x（本决策）** | Active LTS → 2026-10-20 转 Maintenance，EOL 2028-04（18 个月）；与 Electron 44 内嵌版本同 major；dsh 生产验证 | 即将转 Maintenance | ✅ 采用 |
| Node 22.x | 更成熟 | Maintenance LTS，EOL 2027-04（仅 6 个月），产品还没迭代几轮就 EOL | ❌ 否决 |
| Node 26.x | 最新，EOL 2029-04 | 2026-05 才发布，刚进 LTS，npm 生态兼容性未充分验证 | ❌ 否决（待 27 稳定后评估升级） |

| 选项 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **带 npm/npx（本决策）** | 用户导入 Skill 可 `npm ci`；MCP 可走 `npx`；完整生态 | +~30 MB（npm 含在官方 tar.gz 内） | ✅ 采用 |
| 只带 node 二进制 | 省 ~30 MB | Skill 必须自带完整 node_modules；用户导入 Skill 无法安装依赖；`npx` 不可用 | ❌ 否决 |

| 选项 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **node_modules 落在 Skill 目录内（本决策）** | 顺应 Node 目录约定，模块解析天然 work；内置随包只读、导入写 `userData/skills/<skill>/` | 与 Python 的独立 `environments/` 目录落点不对称 | ✅ 采用 |
| 独立 `userData/node-environments/<key>/` | 与 Python venv 落点表面对称 | 逆 Node 生态，需 `NODE_PATH`/symlink hack；内置 Skill 只读装不进 | ❌ 否决 |

**DMG 体积影响**：Node 24.x darwin-arm64 官方 tar.gz 约 48 MB（压缩），strip 后解压约 130 MB。electron-builder 压缩进 DMG 后增量约 48 MB。当前 DMG 213 MB → 预计 ~260 MB。用户明确不介意此增量。

## 兼容与验收

### 兼容性

- 现有三个内置 Node stdio MCP（filesystem/memory/sequential-thinking）行为不变，仅启动方式从 Electron 换为独立 Node。
- 现有 Python Skill（PPT 等）不受影响。
- 现有 fetch MCP（Python-based）不受影响。
- 随包 Python 构建脚本与目录改名（`mcp-runtime-assets` → `python-runtime-assets`）是纯命名整理：CPython base、fetch wheelhouse、PPT wheelhouse 的内容、SHA-256 与 venv 准备流程均不变，仅构建脚本名、产物目录名、安装包内路径及相关代码引用同步更新。
- 用户已保存的自定义 stdio MCP 连接：若 command 为 `node`/`npm`/`npx`，升级后自动解析到 managed Node（行为改善，不破坏）。含完整路径的命令不受影响。
- `agent-protocol` schema 变更：entrypoint runtime 联合类型新增 `"managed-node"` 成员。现有 `"managed-python"` 不变。协议版本按需递增。
- ADR-0045 的 `ELECTRON_RUN_AS_NODE` 机制保留用于 Knowledge worker 和 guardian（它们不需要 npm 生态），但内置 MCP 不再走此路径。

### 验收清单

- [ ] 构建期：`prepare-node-runtime-assets.mjs` 下载 + SHA-256 校验通过；strip 后产物含 `bin/node`、`bin/npm`、`bin/npx`、`lib/node_modules/npm/`。
- [ ] 打包：`Contents/Resources/node-runtime/bin/node --version` 输出锁定版本。
- [ ] 内置 MCP：空 PATH（`PATH=/usr/bin:/bin`）下三个 Node stdio MCP 握手成功，tools/list 返回正确数量。
- [ ] 用户自定义 MCP：`command: "node"` 的 stdio 连接能启动（不需要系统 Node）。
- [ ] Node Skill：声明 `runtime: "managed-node"` 的 Skill 端到端执行通过。
- [ ] npm/npx 可用：Skill 脚本内 `npx --version` 返回正确版本。
- [ ] 内置 Node Skill：node_modules 随包在 `Contents/Resources/skills/<skill>/node_modules/`，只读就地运行，无需准备步骤。
- [ ] 导入 Node Skill：`npm ci --offline` 把 node_modules 装进 `userData/skills/<skill>/node_modules/`，模块解析正常；准备失败/取消有明确状态，不残留半成品。
- [ ] 信任指纹：`package-lock.json` 变化 → 指纹变 → 需重新授权。
- [ ] electronFuses：`electron-builder.yml` 含 `electronFuses: { runAsNode: true }`。
- [ ] Python 脚本改名：`prepare-python-runtime-assets.mjs` 就位，`package.json`/`electron-builder.yml`/`index.ts`/`builtin-mcp-runtime-service.ts` 及测试引用全部更新；`Contents/Resources/python-runtime-assets/` 含 CPython + fetch wheelhouse + manifest，SHA-256 逐项相符；Python venv 准备流程行为不变（回归通过）。
- [ ] DMG 体积：增量在 40-60 MB 范围内。
- [ ] 签名 + 公证：Developer ID 签名通过，Gatekeeper 安装正常。
- [ ] 干净用户目录：首次安装、首次运行 MCP 和 Skill 均离线完成。
- [ ] 现有回归：Python Skill、fetch MCP、Knowledge worker、guardian 行为不变。
