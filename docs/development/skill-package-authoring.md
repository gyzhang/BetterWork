# BetterWork Skill 包作者指南

本指南定义 Skill 发布包的开发目录、运行元数据、依赖锁与 wheelhouse 维护方式。Skill 作者负责声明需求并验证组合；BetterWork 负责读取声明、准备公共 CPython、安装隔离依赖和呈现本 Skill 的配置项。导入不会运行 Skill 代码，也不会把扫描线索自动升级为可执行命令或信任授权。

## 1. 两类目录

仓库根目录的 `skills/` 是开发者本机的打包工作区，已加入 Git 忽略规则，不参与提交或产品构建。产品内置 Skill 的发布源仍是 `resources/skills/<skill-id>/`；`electron-builder.yml` 会把它们作为只读资源打入安装包。用户或客户从技能分发服务下载的 ZIP 则独立托管，包内资源在导入后存入 BetterWork 用户数据目录。

开发包建议采用以下布局：

```text
<skill-package>/
├── SKILL.md
├── betterwork.skill.json
├── scripts/
├── references/
├── assets/
└── runtime/
    ├── requirements.in
    ├── locks/
    │   └── <lock-id>-darwin-arm64-cp312.json
    └── wheelhouse/
        └── <reviewed-wheel-files>.whl
```

`runtime/` 属于该 Skill 包。不得把这个包的锁或 wheelhouse 登记成 BetterWork 全局依赖清单；不同 Skill 可以使用相同 wheel，但各自的锁仍描述各自经过验证的完整依赖闭包。相同的受管 CPython 制品、目标平台和完整锁 hash 可以复用已准备环境。

## 2. 运行元数据

`betterwork.skill.json` 使用 `formatVersion: 2`，其中 `runtimeProfile` 是经过 Zod 校验的 `RuntimeProfileDraft`。推荐只包含该包实际需要的字段：

- `pythonRequirement`：兼容版本范围；解释器本体仍由 BetterWork 的「设置 → 运行组件」提供。
- `dependencyBundle`：Skill 包内锁的稳定 ID、相对 `lockPath`，以及可选的相对 `wheelhousePath`。
- `toolchainRequirements`：零项或多项外部工具链声明；每项含稳定 ID、显示名、环境变量、版本提示，可用完整 Git commit 锁定源版本。
- `commands` 与 `outputContract`：审核过的命令、参数、超时、产物和报告约定。仅当 BetterWork 有对应适配实现并完成样例验证后才声明可执行命令。

清单中的 `skillId` 是发布者稳定的包 ID。BetterWork 为本机 Skill 另外分配自己的数据库 ID，并把包 ID 保存在修订上；导出、复制与再次导入会保留包 ID。包 ID 不是信任凭据，也不会覆盖本机 Skill 主键。目前重复导入相同包仍会新建本地 Skill，按包 ID 发现并升级已有安装尚未实现。

路径必须是包内 POSIX 相对路径，不能包含绝对路径、`..` 或反斜杠。不要把作者机器上的 Python、`PPTM_HOME` 或工具链目录写进元数据。`expectedCommit` 是源版本校验值，不是本机路径，也不等于 BetterWork 已自动下载该工具链。

元数据声明不自动获得信任。用户导入的 Skill 仍按独立信任流程处理；依赖可准备与代码获准执行是两项状态。

## 3. 依赖锁从哪里来

依赖锁由作者的**显式依赖集合和目标环境解析结果**产生，不能从任意 Python 文本扫描出可靠的完整锁。扫描只能提示作者去审查 `import`、`requirements`、`pip install` 和环境变量等线索。

1. 在目标 macOS arm64 上使用 BetterWork 管理的 CPython 3.12.14；从脚本和依赖声明中选择本 Skill 真实需要的直接依赖，记录在 `runtime/requirements.in`。不要照搬整个外部工具链的 requirements。
2. 在一次性隔离环境中生成 pip 安装报告。`--ignore-installed` 确保报告包含完整闭包；`--only-binary=:all:` 拒绝需要用户机编译的源码分发包：

   ```sh
   <受管 CPython 3.12.14>/bin/python3 -m pip install \
     --dry-run --ignore-installed --only-binary=:all: \
     --report /tmp/skill-pip-report.json \
     -r skills/<skill-id>/runtime/requirements.in
   ```

3. 用仓库脚本将报告变成 BetterWork 锁格式：

   ```sh
   node scripts/generate-skill-dependency-lock.mjs \
     --report /tmp/skill-pip-report.json \
     --output skills/<skill-id>/runtime/locks/<lock-id>-darwin-arm64-cp312.json \
     --import-probes pptx,lxml,yaml,PIL,xlsxwriter
   ```

   该脚本只接受 HTTPS wheel、pip 报告中的 SHA-256 和 macOS arm64 / CPython 3.12 目标；源码包、无 hash、重复包和不安全地址会失败。`importProbes` 是准备环境时实际要导入的 Python 模块名，不是 Python 包分发名。

4. 需要把 wheel 随 Skill 一起分发时，追加 `--wheelhouse skills/<skill-id>/runtime/wheelhouse`。脚本按锁中的精确 URL 下载每个 wheel 并核对 SHA-256。若不带 wheelhouse，BetterWork 首次准备环境时按锁中的 URL 下载缺失 wheel，并在安装前再次校验 hash；下载源不可达时，作者可随包提供 wheelhouse 或改用可访问的审核制品地址。
5. Review 完整版本闭包、平台 wheel tag、来源 URL、SHA-256、许可证和模块探针。在干净 venv 中准备环境并运行各 import probe，再执行已登记的最小命令与输出校验。验证通过后，`betterwork.skill.json` 的锁 ID/路径、锁 JSON 与可选 wheelhouse 必须作为同一发布版本一起封装。

锁 JSON 中的每个 `packages` 项是一份精确分发包（name、version、wheel、SHA-256、来源和可选许可证）；`importProbes` 另列必须能导入的模块。比如 `python-pptx` 分发包对应 `pptx` 模块，名字不要求相同；传递依赖也占一个 package 项，但不一定增加 probe。

## 4. CPython、锁、wheel 与工具链的关系

三者是不同资源：

| 资源 | 归属 | 是否必须先有受管 CPython | 缺失时的处理 |
| --- | --- | --- | --- |
| CPython 制品 | BetterWork 应用 | — | 由应用下载、校验、修复，并在「运行组件」显示 |
| Skill 锁 JSON | Skill 包 | 否；它是静态元数据 | 包内应有；导入时校验格式与路径 |
| Wheel 文件 | Skill wheelhouse 或审核制品 URL | 否；下载不依赖 Python | wheelhouse 缺件时按精确 URL 下载并校验 SHA-256 |
| Skill venv | BetterWork 用户数据 | **是** | 以受管 CPython 和完整锁新建或修复；不修改系统 Python |
| 外部工具链快照 | Toolchain 声明及 BetterWork 用户数据 | 否 | 由 Skill 详情按声明呈现绑定/登记入口；运行前校验快照 |

准备环境时，BetterWork 用 CPython 制品身份、目标平台和锁 hash 计算环境键。锁不依赖解释器已安装才可存在或导入，但没有兼容解释器就不能创建、验证或运行对应 venv。用户数据里的 wheel 缓存丢失时，后续准备会从 wheelhouse 或锁内 URL 恢复；锁无有效下载来源且包内 wheel 也缺失时会明确失败。

工具链的本机来源路径保存在本机快照记录，不进入 Skill ZIP。当前目录登记流程会复制内容为不可变快照，并对声明的 `expectedCommit` 做来源版本匹配。要做到产品分发后完全自动准备可下载工具链，包还需要受签名/哈希保护的工具链制品声明和后台下载/解包生命周期；现有 `toolchainRequirements` 只负责识别需求和显示配置项，不能被描述成已经会自动下载工具链。

## 5. 目录、ZIP 与 URL 分发

- 本地开发和验收可直接导入 Skill 目录。
- 给客户分发时，将 `SKILL.md`、`betterwork.skill.json`、脚本/资源、包内锁及选择随包提供的 wheels 一起制成 ZIP。不要把 `skills/` 工作区目录本身当作 BetterWork 安装包资源。
- BetterWork 支持从 HTTPS ZIP 地址导入；URL 必须无内嵌账号密码，重定向保持 HTTPS。当前导入入口下载 ZIP 内容（上限 50 MiB），不是任意网页或远程目录浏览器。
- 内置 Skill 发布时，将审核后的目录放进 `resources/skills/<skill-id>/`，并更新产品 release manifest 的内容、profile、依赖和授权指纹。安装包构建会携带该目录；本机 `skills/` 不会进入分发物。
- 公开或 ToB 技能服务可以托管同一 ZIP，BetterWork 读取包内声明后准备受管解释器和依赖。私有模板及公司专属外部目录应单独分发或保留为本机受管资源，不能因包里写了一个路径就自动读取作者机器文件。

## 6. `ppt-expert-skill` 样例状态

本机 `skills/ppt-generation-expert/` 是基于 `/Users/kevin/Downloads/ppt-expert-skill` 的忽略目录打包样本；源下载目录没有被修改。样例包把锁和 8 个 wheel 放在自身 `runtime/` 下，元数据声明 Python 3.12、锁 bundle 与 `PPTM_HOME` 工具链的版本/commit，不包含 `ppt-master` 的作者绝对路径。`requirements.in` 记录锁候选的直接依赖根。

这 8 个锁项来自当前产品的 PPT 依赖基线拷贝：7 项与锁中列出的目标模块相对应，另有传递依赖 `typing_extensions`。这不是导入扫描数出来的。忽略目录样例的 `betterwork.skill.json` 现在声明 5 个审核入口：`project-init`、`icon-sync`、`svg-export`、`template-merge`、`pptx-validate`；BetterWork 按该包的精确内容 hash 选择对应执行适配器。不要把其他 Skill 扫描到的线索直接复制成命令入口。

内容 hash 覆盖 Skill 包的全部文件；拆分或修改 Markdown 也会改变 hash。发布新版本前要复核运行元数据、命令契约和相关脚本，再把新 hash 登记到 `ppt-generation-preset.ts` 的精确兼容列表，并保留仍需支持的旧 hash。不能只按相同 `skillId` 放宽匹配。

2026-10-06 在隔离目录中以受管 CPython 3.12.14 创建 venv，从样例 wheelhouse 离线安装锁定的 8 个 wheel，7 个必需模块导入探针全部通过；再使用声明的 PPT Master 6.6.0 commit 验证了项目初始化、图标同步、SVG 三项质检和导出、公司模板合并、最终 PPTX 结构校验。SVG 质检和结构校验通过，导出报告为 `quality_gate=passed`（上游另有 1 个 warning）。这证明代表性命令链在该版本组合中可执行；还没有通过 BetterWork Electron 界面完成导入、授权、快照绑定和 Run 的完整人工验收。当前锁最初从产品基线复制，正式发布前仍应按本包的 `requirements.in` 在目标环境重新生成并 Review 完整闭包及许可证。

该 Skill 对 `ppt-master` 的外部依赖已由元数据显式声明；扫描器也会从真实 `os.environ`/shell 变量使用和明确配置语句提取线索，不再把内部的 `SKILL_DIR`、`DIAGRAMS_DIR`、`STYLES_DIR` 常量误报成用户目录。导入后 UI 会按 `PPTM_HOME` 声明展示工具链配置。当前样例尚未把 `ppt-master` 制作为包内或服务端固定下载制品，所以登记这一项仍要求选取本机来源目录并校验版本；它还不符合「导入后所有资源自动准备」的最终目标。

样例源 README 将 `ppt-expert-skill` 标为私有仓库并注明不得公开转发，因此它只能用于获准的内部验证和客户定向分发，不能放入公开 Skill 市场。当前本机 `ppt-master` 工作目录约 973 MB，其中 `skills/ppt-master` 子树约 129 MB；BetterWork 的 Skill 包导入上限为 50 MiB。不能把这个工作目录原样塞进 Skill 包，也不能把作者机器路径当作可下载来源。正式分发前必须由发布者筛选运行必需文件，生成经许可审查和 SHA-256 固定的精简工具链制品，并放在目标客户可访问的受控分发端点；随后还需实现受限大小、校验、解包、快照登记和准备进度的自动链路。

正式发布前仍需完成：从该样例自己的依赖声明重新生成并 Review 完整锁；在 BetterWork Electron 中人工走完导入、信任/依赖授权、工具链快照绑定与 Run；确定受控分发的 `ppt-master` 工具链制品体积、来源 hash、许可证及自动安装方式；最后再把已审查版本纳入产品内置资源或客户 ZIP/HTTPS 分发。
