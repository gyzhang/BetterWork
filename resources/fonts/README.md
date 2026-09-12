# 幻灯片预览字体资源

`SourceHanSansSC-Regular.otf` 是**渲染中文幻灯片预览的必需运行时资源**，不是可选字体。缺失时 `createPptxRenderer` 直接抛中文错误、预览不可用——宁可失败可见，也不输出一屏空框。

## 为什么必须随包分发

`pptx-glimpse` 用 `opentype.js` 解析字体，而 `opentype.js` 只认 CFF/TrueType 轮廓的**单个 OTF/TTF 文件**。macOS 自带的苹方、Hiragino Sans GB 等中文字体打包成 `*.ttc`（字体集合）并带 AAT 表头，`opentype.js` 打不开，因此系统里「有中文」不等于渲染器「能用中文」。必须由应用自带一份可解析的 OTF。

## 字体映射的实际作用（不要高估它）

国内生成的 PPTX 里写死的字体名是「微软雅黑」「黑体」「宋体」等，这些字体在目标机器上通常不存在。`apps/desktop/src/main/infrastructure/pptx-renderer.ts` 的 `CHINESE_FONT_MAPPING` 把它们全部映射到本文件提供的 `Source Han Sans SC`。

需要按当前配置如实理解它的地位：

- **今天它不是防空框的那一道。** 渲染器已限制为只加载本目录这一份字体（`onlyFontDirs`，见 [ADR-0013](../../docs/adr/0013-slide-preview-rendering.md)），依赖内部有「解析不到就用第一个已加载字体兜底」的路径，所以带映射与不带映射的输出**字节完全相同**（两页均实测一致）。
- **它曾经是。** 在还没禁用系统字体扫描之前，「黑体」会命中一个能解析但没有中文字形的系统字体，中文整片变空框；补上映射条目后恢复正常。这个失败模式是实测出来的，只是它的前提条件（扫描系统字体）已经被去掉了。
- **它仍然是必需的。** 一旦本目录加入第二种字重或字族（例如再随包一份宋体），兜底结果就取决于加载顺序而不是字体名，映射是把「请求的字体名」钉到「确定的字体」的唯一手段。同时它让解析路径不再依赖兜底分支的实现细节。

结论：映射表按字体名精确命中，是**面向多字体配置的确定性保证**，不是当前单字体配置下的救命稻草。声称它能单独防空框是不准确的，反过来据此删掉它同样是错的。

## 资源信息

| 项 | 值 |
| --- | --- |
| 文件 | `SourceHanSansSC-Regular.otf`（16,529,832 字节） |
| SHA-256 | `f1d8611151880c6c336aabeac4640ef434fa13cbfbf1ffe82d0a71b2a5637256` |
| 字体名 | Source Han Sans Simplified Chinese（Regular 字重，单一字重够用） |
| 版权 | 内嵌 `Copyright 2014-2025 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.` |
| 许可 | SIL Open Font License 1.1，允许随作品再分发 |
| 上游 | github.com/adobe-fonts/source-han-sans |

## 打包路径

`apps/desktop/electron-builder.yml` 的 `extraResources` 把本目录复制到安装包的 `Resources/fonts`；主进程按 `app.isPackaged` 在 `process.resourcesPath/fonts` 与仓库内 `resources/fonts` 之间切换（见 `apps/desktop/src/main/index.ts`）。

## 约束

- 只放 Regular 一种字重：预览要的是版式辨识，不是排印还原，多字重会成倍放大安装包。
- 只放 `.otf` / `.ttf`：`electron-builder.yml` 的 filter 已限定，其他格式 `opentype.js` 用不了。
- 新增字体必须同时补 `CHINESE_FONT_MAPPING`，并在补完之后重新目视核对中文页面——多字体下的兜底顺序问题不会报错，只会安静地选错字形。
