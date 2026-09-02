# ADR-0001：采用全新项目设计

- 状态：Accepted
- 日期：2026-09-02

## 背景

LobsterAI 在桌面交互和产品 UI 上具有参考价值，但与 OpenClaw 在会话、配置、插件、IM、任务和打包方面深度耦合。clawbible-desktop 具有可复用的 Agent、工具、知识和 Office 工程经验，但也包含已有产品的 IPC、数据库和业务历史。

## 决策

BetterWork 作为全新项目建设：

- 借鉴 LobsterAI 的信息架构、交互模式和视觉设计。
- 借鉴 clawbible-desktop 的 Agent Loop、工具、安全、知识和 Office 实践。
- 不 Fork 后删除 OpenClaw。
- 不合并两个 Electron 主进程和数据库。
- 重新定义适合知识工作台的领域模型、协议和模块边界。

## 结果

前期需要重新搭建基础设施，但能够避免大量历史清理和双状态源问题，项目也更适合作为教学参考。

