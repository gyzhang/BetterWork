# ADR-0018：Office 输入解析边界与依赖

- 状态：Accepted（E50，2026-09-14）
- 前置：[ADR-0014](0014-expert-context-and-material-binding.md)、[ADR-0009](0009-script-skill-baseline.md)。

## 决策

1. **PPTX** 首轮使用应用内 OOXML 读取：`JSZip 3.10.1` 解压，`fast-xml-parser 5.11.1` 解析 XML。按演示文稿关系解析 `ppt/slides/slideN.xml` 和对应 notes，输出 1-based 页号、文本段、表格行列和备注定位。图片、图表、SmartArt、动画、主题视觉不猜成数据；预览渲染器不作为解析器。
2. **XLSX** 使用 `ExcelJS 4.4.0` 读取内存缓冲区。输出 Sheet、A1 范围、原始单元格值、公式及文件内缓存结果；ExcelJS 不计算公式，缺少缓存结果的公式明确标记 `formula-without-cached-result`。宏、外部链接、连接器和刷新动作不执行。首轮不接受旧式二进制 XLS。
3. **CSV** 使用受限的 UTF-8/UTF-8 BOM 读取器，支持带引号字段、逗号、换行和中文；无法严格解码时返回 `unsupported-encoding`，不猜测本地编码。输出行/列定位，空值与文本保持可区分。
4. 输入快照解析消费 E21 的受管只读 `InputSnapshot`，成果复用消费 FileArtifactService 保存的精确 PPTX `ArtifactVersion`；两者都不读取用户原始路径。解析结果是临时 Run 输入，不登记为 Artifact。工具/服务 API 返回 `sourceKind`、对应快照或成果身份、`material`、`format`、稳定 `locator`、结构化内容和限制/警告。
5. 安全上限：压缩包输入 50 MiB、解压后总条目 200 MiB、单 XML/CSV 文本 20 MiB、PPTX 最多 500 页、XLSX 最多 200 个 Sheet；超限、损坏、加密或路径越界均为可解释失败。解析循环检查 AbortSignal，取消后不发布成功结果。

## 依赖与分发

上述三项依赖均为 MIT；随桌面应用打包，不依赖 Microsoft Office、LibreOffice 或外部 Python。`exceljs` 仅作为读取器，公式计算和刷新不在产品边界内。许可证与版本锁在 `apps/desktop/package.json` / `package-lock.json`，升级需重新跑合成样本和门禁。

## 已落地 API 形状（E51）

```ts
type ReadOfficeMaterialInput = {
  sourceKind: 'workspace-input-snapshot' | 'artifact-version';
  snapshotId?: string;
  artifactId?: string;
  versionId?: string;
  locator?: string;
};

type ReadOfficeMaterialOutput = {
  sourceKind: ReadOfficeMaterialInput['sourceKind'];
  material: MaterialReference;
  format: 'pptx' | 'xlsx' | 'csv';
  sections: Array<{
    locator: string; // slide:1, slide:1/table:1, sheet:经营数据!A1:B8, rows:2-4
    kind: 'text' | 'table' | 'notes' | 'cells';
    content: unknown;
  }>;
  warnings: Array<'formula-without-cached-result' | 'truncated' | 'unsupported-feature'>;
  contentHash: string;
};
```

`read_office_material` 只返回材料范围内的数据；跨快照、未选择材料和不支持的成果类型由 Main 的 TaskContext 范围校验拒绝。Evidence/RunMaterialRead 使用同一 `locator` 和内容哈希记录实际读取。

## 探测证据

`scripts/office-input-probe.mjs` 用合成 PPTX（文本、表格、备注）、XLSX（Sheet、公式与缓存值）和带 BOM 的中文 CSV 运行三条候选路径，验证输出和版本选择。它不读取用户文件，也不触网。
