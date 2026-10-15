# 1. spec_lock.md 自动生成失败时的兜底

仅当 `svg-export` 的返回诊断明确指出 `scaffold-lock` 失败，且本次项目目录确实没有 `spec_lock.md` 时使用。先确认失败来自锁脚手架，而不是 SVG 质检问题；已经存在的锁不得覆盖。

把下方完整内容写入本次 `project-init` 返回的项目目录下的 `spec_lock.md`。先按真实任务填写 `audience`、`objective` 和 `core_message`，并按汇报语言设置有效的 BCP-47 `primary_language`；不要保留方括号占位符。中电金信标准配色块与字体值保持原样。确认文件写入成功后，再重新调用 `svg-export`。

```markdown
<!-- ppt-master-schema: spec-lock/v1 -->
# Execution Lock

## canvas
- viewBox: 0 0 1280 720
- format: PPT 16:9

## communication
- primary_language: zh-Hans
- audience: [按本任务填写真实听众]
- objective: [按本任务填写汇报目的]
- core_message: [按本任务填写最重要结论]
- consumption_mode: balanced

## mode
- mode: quick

## visual_style
- visual_style: 中电金信公司模板 · 商务蓝 · 清晰易读

## colors
- bg: #FFFFFF
- primary: #1B4593
- accent: #266DE7
- secondary_accent: #048AE3
- border: #00D3E4
- text_secondary: #778495
- navy: #0C2864
- risk: #DF203C
- panel: #E4E6EA

## typography
- font_family: Microsoft YaHei
- title_family: Microsoft YaHei
- body_family: Microsoft YaHei
- body: 14
- title: 22
```

如果再次失败，保留本次 `svg-export` 的完整 stdout/stderr 和返回的诊断信息，按新错误定位；不要继续重复生成锁或盲目重试。
