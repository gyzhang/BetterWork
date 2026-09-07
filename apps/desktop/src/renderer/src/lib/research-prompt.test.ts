import { describe, expect, it } from 'vitest';

import { buildResearchPrompt } from './research-prompt';

describe('buildResearchPrompt', () => {
  it('明确研究主题、资料数量和交叉验证要求', () => {
    expect(buildResearchPrompt('上下文预算', 3)).toContain(
      '基于个人资料库中关于“上下文预算”的 3 份相关资料',
    );
    expect(buildResearchPrompt('上下文预算', 3)).toContain('比较不同资料的共识与分歧');
    expect(buildResearchPrompt('上下文预算', 3)).toContain('来源标题和定位');
  });

  it('明确禁止越过知识库边界读取原始路径', () => {
    expect(buildResearchPrompt('上下文预算', 1)).toContain(
      '不要尝试用 read_text_file 读取资料库原始路径',
    );
  });
});
