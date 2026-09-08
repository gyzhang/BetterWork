# 依赖验证记录

- 建立：2026-09-09（任务 A10）
- 用途：记录基础 Python 候选、真实校验值、本机探测结果与已验证/未验证边界。
- 纪律：**hash 与版本一律逐字取自上游发布物或本机实测，不凭空填写**；未验证的项目明确标为待验证，不用「应该可以」代替证据。

## 1. 受管 Python 发行候选

- 上游项目：[astral-sh/python-build-standalone](https://github.com/astral-sh/python-build-standalone)（提供可再分发的 CPython 构建）
- 选定版本：**CPython 3.12.14**，上游 release **20260901**，制品形态 `install_only.tar.gz`
- 选择理由：样本 `ppt-generation-expert` 的工具链（python-pptx / lxml / Pillow 等）在 3.12 上有完整 wheel 覆盖；3.13 仍有部分包缺 wheel，3.9（本机系统 Python）过旧。最终可用性由 A11 的真实包锁与 import/CLI 探测确认，本记录不预先宣称通过。
- 校验值来源：上游 release 资产 `SHA256SUMS`（2026-09-09 取得，逐字抄录）

| 目标平台 | 文件名 | SHA-256 |
| --- | --- | --- |
| macOS arm64 | `cpython-3.12.14+20260901-aarch64-apple-darwin-install_only.tar.gz` | `3ee3ee547cedfeb7c2b16b2b7156039f7b470bb8f857e226fd3d2eb11db83c76` |
| macOS x64 | `cpython-3.12.14+20260901-x86_64-apple-darwin-install_only.tar.gz` | `2e31b23f3f1319f707d0e620b48847a0046577541d357276821f9f1b5492e0ba` |
| Windows x64 | `cpython-3.12.14+20260901-x86_64-pc-windows-msvc-install_only.tar.gz` | `e90c1b6419da3bd812dd73bb3de40287a21abf153438147639ec5e20375ea93f` |

下载基址：`https://github.com/astral-sh/python-build-standalone/releases/download/20260901/<文件名>`

- 许可：PSF-2.0；上游 `install_only` 制品另捆绑若干第三方组件（OpenSSL、zlib、libffi 等），各自许可以上游发行说明为准。随包分发前的许可清单整理属于 A20。
- 代码落点：`apps/desktop/src/main/infrastructure/python-distribution.ts`（目录常量）＋ `services/skill-dependency-service.ts` 的下载→校验→解压流程。校验值不符一律拒绝使用并清掉半成品目录，不回退到「先跑起来再说」。
- 状态：**机制已实现并有离线测试；制品本身未随包分发，也未在本机完整下载解压验证**（A20 负责打包与冷环境准备）。Windows 条目仅登记，A09 blocked，本机无法验收。

## 2. 本机解释器探测（2026-09-09 实测）

探测脚本只读身份，不安装、不执行 Skill 内容：版本 / `platform.machine()` / `platform.system()` / `venv` / `ensurepip`。

| 路径 | 版本 | 架构 | venv | ensurepip | 备注 |
| --- | --- | --- | --- | --- | --- |
| `/usr/bin/python3` | 3.9.6 | arm64 | 是 | 是 | 系统自带，版本过旧，不作为候选 |
| `/opt/miniconda3/bin/python3` | 3.13.11 | arm64 | 是 | 是 | `python3` 在 PATH 中的实际解析结果 |
| `/opt/homebrew/bin/python3.12` | 3.12.13 | arm64 | 是 | 是 | 版本满足候选要求 |
| `/Users/kevin/.local/bin/python3.12` | 3.12.13 | arm64 | 是 | 是 | 与上一条同源 |

- 本机解释器只作为**高级选项**的基础：服务始终用它创建算台专属 venv，pip 只由 venv 内解释器执行，绝不写入其全局 site-packages，也不复用 Conda 随时变化的包集合。
- 本机解释器的身份指纹是「解析后的真实路径 + 自报版本 + 平台」，不是二进制 hash：它不是算台管理的不可变制品，因此环境漂移由健康检查（import 探测失败即 `invalid`）兜住，而不是假装指纹能锁定内容。

## 3. 真实 venv 验收（A10）

- 时间：2026-09-09
- 平台：macOS arm64，Node v26，解释器 `/opt/miniconda3/bin/python3`（3.13.11，测试运行时自动发现）
- 位置：`os.tmpdir()` 下的临时 userData 目录，测试结束即删除
- 过程：`prepareEnvironment({kind:'local'})` → 真实 `python -m venv` 建在最终目录（无 `--system-site-packages`）→ 空包锁跳过 pip → 真实 import 探测 `json / sys / venv / zipfile`
- 结果：作业 `succeeded`，环境 `ready`，`verifyEnvironment` 复跑探测仍为 `ready`
- 隔离证据：向该 venv 的 `purelib` 写入 `betterwork_probe_marker.py` 后，venv 解释器可导入并打印标记，基础解释器导入失败（退出码非 0），证明全局环境未被修改
- 离线证据：该用例注入的下载器一旦被调用即抛错，全程未触网

## 4. 包锁与 wheelhouse 状态

- 锁格式已在协议固定：`dependencyLockSchema`（精确版本 + 每个 wheel 的 sha256 + 来源枚举 + `importProbes`）；来源只允许随包 `wheelhouse` 或显式批准的 `https` 索引，索引地址不得内嵌凭据。
- 安装命令固定为 `python -m pip install --no-index --find-links <wheelhouse> --only-binary=:all: --require-hashes --no-cache-dir -r <lock>`；需要联网的包先由下载器取回并逐个校验 sha256，凭据不进入 pip 参数、作业记录或日志。
- **当前仓库没有 wheelhouse，也没有真实包锁**：`resources/` 下不存在 wheel 制品，样本所需的精确版本组合由 A11 实测产生。A10 的所有安装路径均由离线替身验证，未安装过任何真实第三方包。
- 明确不做：读取并直接执行 Skill 里的 pip 命令、默认安装 ppt-master 全量 requirements、运行时自更新依赖。

## 5. 待验证清单

| 项目 | 归属 | 现状 |
| --- | --- | --- |
| 受管制品真实下载、校验、解压后建 venv | A20 | 未做，仅有离线替身与校验失败路径测试 |
| 样本真实包锁（python-pptx / lxml / PyYAML / Pillow / XlsxWriter 及导出闭包） | A11 | 未产生，不预填版本与 hash |
| wheelhouse 制品与许可清单随包分发 | A20 | 未做 |
| Windows 平台环境与解释器 | A09/A21 | blocked，本机无 Windows 环境 |
| 环境准备 UI（选择解释器、查看缺项、进度与取消） | A12 | 未接线，服务尚未被 `main/index.ts` 装配 |
