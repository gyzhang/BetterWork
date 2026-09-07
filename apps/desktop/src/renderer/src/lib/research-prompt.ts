export const buildResearchPrompt = (query: string, sourceCount: number): string =>
  `请基于个人资料库中关于“${query}”的 ${sourceCount} 份相关资料，整理一份 Markdown 研究摘要。请比较不同资料的共识与分歧，列出关键结论，并在每个关键结论后注明对应的来源标题和定位。只使用 knowledge_search 返回的资料摘要，不要尝试用 read_text_file 读取资料库原始路径。`;
