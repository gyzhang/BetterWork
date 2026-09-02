# ADR-0004：采用混合记忆架构

- 状态：Accepted
- 日期：2026-09-02

## 背景

纯 Markdown 记忆透明、可编辑，但不适合冲突、来源、状态和大规模检索；纯数据库记忆不利于用户理解和手工维护。

## 决策

记忆采用三层体系：

1. 渐进加载的 Markdown Core Memory Files。
2. SQLite Structured Memory Records。
3. 可重建的 FTS/Vector Retrieval Index。

用户明确记忆可直接确认；Agent 建议和后台反思默认产生 candidate。知识库与记忆保持独立。

## 结果

需要设计文件和结构化记录的同步/投影规则，但同时获得透明性、可治理性和检索能力。完整同步机制将在记忆 Phase 实现，早期先固定接口和目录约定。

