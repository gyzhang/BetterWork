# ADR-0002：采用 Artifact-first 产品模型

- 状态：Accepted
- 日期：2026-09-02

## 背景

知识工作者的价值来自研究报告、数据分析、Word 和 PPT 等成果，而不是聊天消息本身。

## 决策

Artifact 是一等领域对象：

- 与 Task、Run、Evidence 建立关系。
- 支持版本、预览、验证和回退。
- 文件修改默认创建新版本。
- Chat 是协作入口，不是成果唯一载体。

## 结果

MVP 会比纯聊天应用多出 ArtifactService 和版本数据模型，但后续 Office、研究和知识回收无需重构核心关系。

