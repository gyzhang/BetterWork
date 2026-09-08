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

## 4. 样本包锁（A11 实测产生）

- 锁文件：[`resources/dependency-locks/ppt-generation-expert-darwin-arm64-cp312.json`](../../resources/dependency-locks/ppt-generation-expert-darwin-arm64-cp312.json)（描述文件，**不含任何 wheel 二进制**）
- 目标平台：darwin / arm64 / cp312，`pythonRequirement: 3.12`
- 闭包确定方式：在临时 venv 里用 `/opt/homebrew/bin/python3.12`（3.12.13）真实解析 `python-pptx lxml PyYAML Pillow XlsxWriter skia-pathops uharfbuzz`，`pip freeze` 得到 8 个精确版本；再用 `pip download` 取回 wheel，本地 `shasum -a 256` 与 PyPI JSON API 的 `digests.sha256` **逐个比对一致**后才写入锁。
- 明确不装：ppt-master 全量 requirements 里的 edge-tts、PyMuPDF、mammoth、markdownify、ebooklib、nbconvert、openpyxl、numpy、requests、beautifulsoup4、curl_cffi、google-genai、flask（语音、图片生成、Web 编辑器、格式转换等与样本无关能力）。
- `importProbes`：`pptx / lxml / yaml / PIL / xlsxwriter / pathops / uharfbuzz`——缺一项都不能 ready。

| 包 | 版本 | wheel | SHA-256（前 16 位） | 许可 |
| --- | --- | --- | --- | --- |
| lxml | 6.1.3 | `lxml-6.1.3-cp312-cp312-macosx_10_13_universal2.whl` | `0c0710ac085a157b` | BSD-3-Clause |
| pillow | 12.3.0 | `pillow-12.3.0-cp312-cp312-macosx_11_0_arm64.whl` | `ffd0c5368496f41b` | MIT-CMU |
| python-pptx | 1.0.2 | `python_pptx-1.0.2-py3-none-any.whl` | `160838e0b8565a8b` | MIT |
| PyYAML | 6.0.3 | `pyyaml-6.0.3-cp312-cp312-macosx_11_0_arm64.whl` | `fc09d0aa354569bc` | MIT |
| skia-pathops | 0.9.2 | `skia_pathops-0.9.2-cp310-abi3-macosx_10_9_universal2.whl` | `c7a925b919c050df` | BSD License（PyPI 分类） |
| typing_extensions | 4.16.0 | `typing_extensions-4.16.0-py3-none-any.whl` | `481caa481374e813` | PSF-2.0 |
| uharfbuzz | 0.56.1 | `uharfbuzz-0.56.1-cp310-abi3-macosx_10_9_universal2.whl` | `d2fcfafe2eac8497` | Apache License 2.0（PyPI 字段） |
| xlsxwriter | 3.2.9 | `xlsxwriter-3.2.9-py3-none-any.whl` | `9a5db42bc5dff014` | BSD License（PyPI 分类） |

完整 64 位校验值与精确制品地址在锁文件里；`source` 为 `approved-index`，随包 wheelhouse 落地（A20）后同一份锁可离线安装，无需改动。

## 5. 工具链快照与真实端到端验证（A11，2026-09-09）

在临时 userData 目录中跑完整链路，全部为真实文件、真实网络下载、真实子进程，结束后目录删除：

| 环节 | 结果 |
| --- | --- |
| 快照来源 | `/Users/kevin/Dev4AI/ppt-master`，`include: ['skills/ppt-master']` |
| 版本身份 | commit `82dd5cccec652cbcff342cbdabce85a1ae7af1e5`，状态 `dirty`（源目录确有未提交修改与未跟踪公司 deck） |
| 快照内容 | 12,981 个文件 / 80,179,334 字节，manifestHash `3d29d8e9dcdc1f0d09021b9294f3ed8f4c3166cc90c919314960bcd4efe9aadf`，耗时 2.2 秒 |
| 排除项 | `.git`（791 MB）、`projects`（12 MB，历史项目含用户私有资料）、`__pycache__` × 12、各层 `.DS_Store`；全部逐条记录理由 |
| 快照核验 | `valid=true`，逐文件重算 sha256，12,981 个全部相符，`missing=[]`、`mismatched=[]` |
| 环境准备 | 31.1 秒：下载 8 个 wheel（逐个校验 sha256）→ `--no-index --require-hashes` 安装 → import 探测 → `ready` |
| 环境键 | `5841de0ad34360765979a3c3f7a5bd60c528f66c7b1d226164c9914063a818ed`；包锁 hash `d2ae53b527788441c2fb7d2ffd9d652dda9e52a682c1d2da964d5b96c7cae7eb` |
| 基础解释器 | `/opt/homebrew/bin/python3.12` 解析为 `/opt/homebrew/Cellar/python@3.12/3.12.13_2/Frameworks/Python.framework/Versions/3.12/bin/python3.12`（3.12.13） |
| import 探测 | exit 0，输出 `3.12.13 1.0.2 12.3.0 6.1.3`（Python / python-pptx / Pillow / lxml） |
| 工具链 CLI | `project_manager.py`、`svg_quality_checker.py`、`svg_to_pptx.py`、`icon_sync.py` 的 `--help` 全部 exit 0，`PPTM_HOME` 指向**快照根**而非开发仓库 |
| 样本脚本 | `svg_native_export.py`、`merge_into_template.py`、`validate_pptx.py` 由 venv 解释器加载全部 exit 0 |

真实跑出来的缺陷（已修）：`createNodeFileSystem().writeFile` 不建父目录，复制快照到尚未存在的子目录时 ENOENT；内存替身会自动建父目录，因此离线测试全绿也发现不了。修复落在实现侧（写前 `mkdir(dirname, recursive)`），不是放宽断言。

**私有内容边界**：快照里包含用户本地的公司 deck 资产（`skills/ppt-master/templates/decks/中电金信`、`中国电信`、`中汽研` 等）与公司模板。快照只存在于用户数据目录，**绝不进入 Git、内置资源或任何公共制品**；A20 打包时必须显式排除，A21 验收要核对包内没有这些内容。

## 6. 待验证清单

| 项目 | 归属 | 现状 |
| --- | --- | --- |
| 样本真实包锁（python-pptx / lxml / PyYAML / Pillow / XlsxWriter / skia-pathops / uharfbuzz 闭包） | A11 | **已产生并实测**，见第 4、5 节 |
| 工具链快照 + 真实环境准备 + CLI 探测（macOS arm64） | A11 | **已完成**，见第 5 节 |
| 受管 Python 制品真实下载、校验、解压后建 venv | A20 | 未做，仅有离线替身与校验失败路径测试 |
| wheelhouse 制品与许可清单随包分发 | A20 | 未做；锁已带逐包许可字段可直接汇总 |
| Windows 平台环境与解释器 | A09/A21 | blocked，本机无 Windows 环境 |
| 环境准备 UI（选择解释器、查看缺项、进度与取消） | A12 | 服务尚未被 `main/index.ts` 装配 |
