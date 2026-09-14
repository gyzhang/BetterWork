# 材料、快照与运行来源契约（E20）

- 状态：契约已定案；E21–E25 已实现基础修订、快照、草稿持久化、运行时材料范围、读取/成果来源关系和选择/复用界面。
- 日期：2026-09-14。
- 依据：[专家与任务材料设计 v0.2](../designs/experts-and-task-materials.md)、[ADR-0014](../adr/0014-expert-context-and-material-binding.md)、[知识库与记忆](../04-knowledge-and-memory.md)、[成果版本与证据](../adr/0005-artifact-version-evidence.md)。
- 范围：只定稿材料的身份、候选与授权边界、版本快照、恢复、读取足迹和成果输入关系。E20 不创建未来表，不宣称 E2 的读取隔离已经接入现有工具。

## 1. 不变量

材料有三个不同事实，必须分别保存：

1. **候选**：当前 Workspace 中可以在选择器看到的来源。
2. **选择**：用户明确放入 TaskContextRevision 的来源、用途和版本。
3. **读取**：某个 Run 实际从选定版本读取的定位、片段或文件。

候选不授予读取权；选择不代表已经读取；读取也不代表被成果采用。成果来源关系是第四个事实，只有产生成果的 Run 明确登记后才建立。

材料中的文字是用户资料，不能修改 Expert、扩大 Tool/MCP 授权、改变 Workspace 范围或覆盖系统规则。`规则口径` 是材料用途，不是系统指令。

## 2. 材料身份与用途

### 2.1 判别联合

TaskContextRevision 中的材料项使用稳定来源身份和内容修订，不使用裸路径、标题或“当前版本”查询：

```ts
type MaterialPurpose =
  | 'rule'
  | 'current-input'
  | 'historical-comparison'
  | 'structure-reference'
  | 'template'
  | 'background';

type MaterialReference =
  | {
      kind: 'knowledge-revision';
      knowledgeDocumentId: string;
      knowledgeRevisionId: string;
      contentHash: string;
      sourcePath: string;
      originWorkspaceId?: string;
    }
  | {
      kind: 'artifact-version';
      artifactId: string;
      artifactVersionId: string;
      contentHash: string;
      originWorkspaceId: string;
    }
  | {
      kind: 'workspace-input-snapshot';
      snapshotId: string;
      workspaceId: string;
      contentHash: string;
      format: string;
      fileKey: string;
    };

interface TaskMaterialSelection {
  reference: MaterialReference;
  purpose: MaterialPurpose;
  note?: string;
  addedFrom: 'workspace-candidate' | 'global-search' | 'expert-reference' | 'user-input';
}
```

`knowledge-revision` 的 `knowledgeRevisionId` 必须指向不可变的提取内容；`contentHash` 是内容寻址校验。当前 `knowledge_documents` 仍以一行保存最新内容，E21 要把刷新变成可回看的修订，不能把现有 `updated_at` 当作历史版本号。

`artifact-version` 直接引用 ADR-0005 的 `artifact_versions.id`。不得通过 `artifacts.current_version_id` 追随最新成果；文件成果的实际字节由 `artifact_files.file_key` 解析，并以登记的 `file_hash` 校验。

`workspace-input-snapshot` 是由用户工作空间文件复制得到的受管只读输入。`fileKey` 只能是受管输入根目录下的相对键；原始路径只用于显示和重新选择，不作为运行时读取句柄。

同一来源在一份 TaskContextRevision 中只能出现一次。需要多个用途时保留一个材料项，修改主用途并在 `note` 中说明其他用途；重复引用返回 `material_reference_duplicate`，不静默生成两个授权项。

### 2.2 Workspace 候选与任务授权

Workspace 候选关联只负责选择器的发现和筛选，建议表达为：

```ts
interface WorkspaceMaterialCandidate {
  workspaceId: string;
  reference: MaterialReference;
  label: string;
  available: boolean;
  reason?: string;
}
```

候选来源可以是工作空间已登记的知识、成果版本或当前目录中用户选定的文件。目录本身不是无限范围授权；选择目录必须先枚举具体文件，新增文件不会进入已有 Task。

常用参考只有在全局适用或与当前 Workspace 匹配时才能进入草稿，并且必须作为可移除的显式 `TaskMaterialSelection` 保存。Expert 配置不能把候选列表变成隐式授权。

跨 Workspace 的规则如下：

- `workspace-input-snapshot` 必须属于当前 Task 的 Workspace；用另一个 Workspace 的路径或快照 ID 直接提交一律拒绝。
- Knowledge 和 Artifact 可以通过“我的全部知识/成果”的显式选择入口跨 Workspace 引用；引用必须携带 `originWorkspaceId`（Knowledge 若没有归属则明确标为全局），在界面显示来源。ExpertRevision 中保存的 ArtifactVersion 常用参考只在其来源 Workspace 适用；召唤到其他 Workspace 时不自动带入，仍需通过任务的显式全局来源选择。路径字符串或旧历史消息不能自动跨空间带入。
- 任意材料 ID 先在 Main 解析归属、生命周期和内容修订，再写入 TaskContextRevision；Renderer 传来的 ID 不是权限证明。

## 3. 版本、快照与 Run

### 3.1 运行快照

发送边界把 TaskContextRevision 解析成不可变的 `RunContextSnapshot`。它至少固定：

```ts
interface RunContextSnapshot {
  id: string;
  runId: string;
  taskId: string;
  workspaceId: string;
  taskContextRevisionId?: string;
  expertId?: string;
  expertRevisionId?: string;
  modelReference?: ExpertModelReference;
  builtinToolPolicy?: BuiltinToolPolicy;
  mcpToolBindings?: McpToolBinding[];
  contextSegmentId: string;
  materials: TaskMaterialSelection[];
  createdAt: number;
}
```

专家 Run 同时固定 `expertId` 与 `expertRevisionId`；通用助手 Run 省略这两个字段。存在 TaskContextRevision 的 Run 还固定当次解析出的 `modelReference`、`builtinToolPolicy` 和 `mcpToolBindings`；没有上下文的旧通用 Run 省略这些字段。快照保存后，Run 只能访问其中的具体内容修订和输入快照；运行期间不重新查询“当前知识”“最新成果”或 Task 的可变草稿来扩大范围。Expert、Skill、模型和内置工具的固定配置仍遵循 E10/E12 的解析与实时撤销规则。

运行准备必须在创建可执行 Run 前完成：校验归属、修订状态、快照文件、哈希和能力；任一步失败都不留下半个可执行 Run。材料准备可以取消，取消不创建 RunContextSnapshot 的可用状态。

### 3.2 本地输入快照状态

快照的持久化状态固定为：

```ts
type InputSnapshotStatus = 'preparing' | 'ready' | 'failed' | 'cancelled';
```

只有 `ready` 能成为材料引用。准备流程是“登记 preparing → 写入临时文件 → 校验稳定哈希与大小 → 原子改名 → 事务标记 ready”；不能先把原始路径写进可执行 Run 再异步复制。

文件在复制期间被外部修改时，必须重新读取并比较稳定哈希；无法取得一致内容就返回 `input_snapshot_source_changed`，由用户重新选择。文件消失、不可读、超过格式/大小限制、符号链接越界、目录、设备或其他特殊文件分别返回可解释错误，不能静默跳过。

快照就绪后原始文件可以被移动或删除，Run 仍读取受管快照；原始路径只保留来源说明。快照损坏或哈希不一致时阻止运行并显示重新选择/移除入口。

同一相对路径可以因源文件变化产生多个不同快照；`read_text_file` 只有路径参数，遇到本次材料清单中同路径的多个快照时必须明确报错，不能静默覆盖或猜测版本。需要区分版本时应只保留一个文本快照，或使用带快照 ID 的 Office 材料读取入口。

### 3.3 崩溃恢复与文件回收

应用库是快照状态、材料引用、Run 和成果关系的真相源；文件系统只保存内容寻址或版本键控的资产。启动恢复遵循以下规则：

| 情形 | 恢复动作 |
| --- | --- |
| `preparing` 记录和临时文件仍在 | 标记 `cancelled` 或清理记录，删除临时文件 |
| `ready` 记录但最终文件缺失/哈希不符 | 标记不可用并阻止引用；不得静默换源 |
| 最终文件存在但没有任何数据库引用 | 仅清理受管根目录中可识别的孤儿资产，并记录结果 |
| `ready` 文件被 Task、Run 或 ArtifactInputRelation 引用 | 保留，不因原文件删除或普通缓存清理而回收 |
| 进程在改名与事务之间退出 | 由下次启动按数据库状态重试或清理，不能把半文件当 ready |

相同内容可以按哈希复用物理文件，但每个 Workspace/Task 的授权关系仍需单独登记。物理文件的回收条件是没有任何历史 Run、TaskContextRevision、ArtifactInputRelation 或未完成恢复记录引用它；“当前列表中看不到”不是回收条件。

## 4. 两个 SQLite 库与文件资产

| 存储 | 真相 | 不能承担的职责 |
| --- | --- | --- |
| `userData/betterwork.db` | Workspace、Task、Run、TaskContextRevision、RunContextSnapshot、材料选择/读取关系、Artifact 与 `artifact_files` | 不能直接替代知识全文索引 |
| `userData/vaults/<id>/vault.sqlite` | Knowledge 文档的提取内容、块、Locator、FTS 索引及 E21 的不可变内容修订 | 不能保存 Task 授权或作为跨库事务的一半 |
| 受管输入目录 | 输入快照字节和哈希对应的只读文件 | 不能单独证明来源、归属或已被选择 |
| `userData/artifact-files/<versionId>/` | ArtifactVersion 的文件成果字节、缩略图等可重建缓存 | 不能绕过 `artifact_versions`/`artifact_files` 登记 |

两个 SQLite 库没有跨库事务。运行启动先在知识库读取并校验具体 revision，再在应用库事务中登记快照引用和 Run；中途失败必须让应用库保持“未启动”，而不是用另一库的最新内容补齐。知识索引损坏可重建，但历史 Run 的 `contentHash` 不得因此改写。

Knowledge 原始文件仍引用用户路径；已登记的提取修订在原件暂时不可访问时可以继续被历史 Run 读取。若某修订只剩路径、没有可读取的提取内容，则预检失败并要求重新导入。被历史材料引用的 Knowledge 修订和 ArtifactVersion 采用保留/归档语义，不能因 UI 删除操作级联抹掉可解释来源。

## 5. 读取足迹与成果输入

### 5.1 读取足迹

```ts
interface RunMaterialRead {
  id: string;
  runId: string;
  material: MaterialReference;
  operation: 'preview' | 'search' | 'read' | 'parse';
  locator?: string;
  contentHash: string;
  excerptHash?: string;
  capturedAt: number;
}
```

`search` 只记录检索返回的摘要和候选定位；模型真正请求正文、页、段落、Sheet/Range、Slide 或文件字节时另记 `read`/`parse` 足迹。重复读取可以去重，但不能丢失不同 Locator。网页是 E40 的 Run 内发现来源，不反向加入私有材料清单。

Run 取消或失败后，已完成且已持久化的读取足迹可以保留；取消之后到来的迟到 Tool 结果不得登记读取或成果输入。旧 Run 的 Evidence 不自动成为新 Run 的读取事实。

### 5.2 成果输入关系

```ts
interface ArtifactInputRelation {
  outputVersionId: string;
  input: MaterialReference | { kind: 'evidence'; evidenceId: string };
  relation: 'data' | 'rule' | 'comparison' | 'structure' | 'template' | 'background';
  createdAt: number;
}
```

新 `ArtifactVersion` 只登记本 Run 已读取且被生成过程明确采用的输入。选中但未读的材料不能伪装为成果来源；读过但只用于背景的资料不能自动声称支撑每个结论；有 Evidence 也不能反推正文被采用。人工编辑版本遵循 ADR-0005 的来源继承语义，不伪装成新的 assistant Run。

## 6. 所有读取入口的范围校验

材料隔离必须落在 Application/Tool Runtime 的实际入口，提示词不能作为边界：

1. **候选查询**：按当前 Workspace 和显式全局来源筛选，只返回可解析的具体来源；不把目录或整个 Vault 作为授权。
2. **TaskContextRevision 保存**：验证来源存在、归属/跨空间选择、生命周期、内容修订、快照状态、用途和重复项。
3. **发送预检**：再次校验 CAS、源哈希、快照 `ready`、成果版本存在、Knowledge revision 可读和所有材料仍在允许范围。
4. **`read_text_file`**：保留真实 Workspace 路径、符号链接和常规文件校验，并要求路径解析到本 Run 已选的 `workspace-input-snapshot`（或 Run 自己创建的受管工作文件句柄）；不能仅凭 `workspacePath` 读取目录中的任意新文件。
5. **`knowledge_search`**：接受 Run 的允许 Knowledge revision 集合，只在集合内检索并返回对应 `knowledgeRevisionId`/`contentHash`；不能继续调用无过滤的全 Vault 搜索。
6. **Artifact 读取/预览**：按精确 `artifactVersionId` 和 `contentHash` 读取，不能解析 `current_version_id`；归档但仍被历史引用的版本可以读取，缺失则失败。
7. **Skill/Python/外部工具桥接**：使用已解析的 Run 工作目录、输入快照和 binding；工具输出写入成果前仍检查 Run 状态和授权关系。
8. **Evidence/Artifact 登记**：只能关联当前 Run 的读取足迹和真实输出；不能用旧 Task Evidence、路径或标题补造来源。

E23 已让 `read_text_file`、`knowledge_search` 和 Markdown `read_artifact` 满足第 4、5 条；RunContextSnapshot 仓储还会校验 Run、Task、Workspace 与 TaskContextRevision 的归属关系，避免单列外键存在但组合关系错误。E24 进一步把完成的搜索/读取写入 RunMaterialRead；有 TaskContext 的 Run 只能登记快照中选定且哈希一致的材料，旧通用 Run 保留无上下文兼容路径；成果输入关系限制到同一 Run 已读取的精确材料。脚本按本机用户权限运行，输入快照和路径策略是应用层约束，不是 OS 进程沙箱，不能宣称可以阻止受信任脚本主动读取本机其他文件。

## 7. 失败与历史语义

| 情形 | 语义与用户可见结果 |
| --- | --- |
| 源文件在选择后变化 | `input_snapshot_source_changed`；保留草稿，要求重新快照/选择，不使用旧摘要配新字节 |
| 源文件缺失或不可读 | 未形成 ready 快照则阻止依赖该材料的 Run；提供重新选择/移除，仍可继续澄清对话 |
| 重复引用 | `material_reference_duplicate`；定位已有项，用户修改用途或备注 |
| 未经显式入口的跨 Workspace ID/路径 | `material_workspace_mismatch`；不依赖 Renderer 传入的归属字段 |
| 快照准备取消 | 临时文件清理，草稿保留，未产生可用 Run 快照 |
| 已归档但仍被历史引用 | 历史精确版本继续可读；新选择需要显式确认且不能自动换成新版本 |
| 旧 Task 继续 | 已有材料修订逐项重验；没有上下文修订的旧 Task 按通用助手、空材料解释，不从 prompt/路径/Evidence 推断 |
| 缩小材料/记忆范围 | 创建新的 `contextSegmentId`；后续 Run 不重放旧段助手回复，只带用户确认的目标与明确保留的成果，旧 UI 历史仍可回看 |
| 运行期间源内容变化 | 已启动 Run 只读固定快照；不热换、不追随最新，取消后按唯一终态收口 |

E20 的契约完成后，E21 已实现知识修订、输入快照和恢复，E22 已实现选择候选、来源校验与草稿持久化，E23 已完成上下文收缩和工具入口过滤，E24 已完成读取足迹与成果输入关系（仓储同时校验成果版本属于产生它的 Run），E25 已把这些事实呈现在 Composer、资料面板和成果复用界面。E25 的候选 IPC 同时接受已有 Task 或当前 Workspace，确保新任务在首条消息前也能添加材料。
