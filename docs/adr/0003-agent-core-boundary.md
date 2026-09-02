# ADR-0003：Agent Core 与桌面框架解耦

- 状态：Accepted
- 日期：2026-09-02

## 背景

已有桌面项目容易将 Agent、IPC、BrowserWindow、数据库和 UI 事件绑定在一起，导致测试和复用困难。

## 决策

- Agent Core 使用显式输入和 `AsyncIterable<AgentRuntimeEvent>` 输出。
- Agent Core 不导入 Electron、React、SQLite Repository 或具体厂商 SDK。
- Application Layer 负责持久化、IPC、权限和 Artifact 登记。
- Tool Runtime 统一适配 TypeScript、Python、MCP 和桌面工具。

## 结果

Agent Core 可以在测试、CLI 和 Electron 中复用；事件协议将成为需要谨慎维护的稳定边界。

