import type { RuntimeProfileCommand } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import { composeRuntimeConvention } from './skill-runtime-conventions';

/**
 * 运行约定分层的护栏（ADR-0012 决策 4）。
 *
 * 这里最要紧的一条是「不匹配预设的 Skill 看不到样本专属口径」：
 * 曾经通用段落里混着 svg-export / pptx-validate 的说明，任何带命令的 Skill 都会被告知
 * 一套并不存在的命令，模型照着编造调用。修改通用层时不得把样本词汇写回来。
 */

const makeCommand = (commandId: string): RuntimeProfileCommand => ({
  commandId,
  label: commandId,
  executableKey: 'managed-python',
  argumentSchema: { type: 'object', properties: { target: { type: 'string' } } },
  timeoutMs: 60_000,
  expectedOutputs: [],
});

const commandTable = (convention: string): Array<Record<string, unknown>> => {
  const marker = '命令：';
  const index = convention.lastIndexOf(marker);
  expect(index).toBeGreaterThanOrEqual(0);
  return JSON.parse(convention.slice(index + marker.length)) as Array<Record<string, unknown>>;
};

describe('composeRuntimeConvention', () => {
  it('always carries the generic execution contract', () => {
    const convention = composeRuntimeConvention({
      bindingId: 'binding-generic',
      skillName: '任意技能',
      commands: [makeCommand('analyze')],
    });
    expect(convention).toContain('算台运行约定');
    expect(convention).toContain('skill_execute');
    expect(convention).toContain('原样带上该命令条目给出的 bindingId');
    expect(convention).toContain('不执行 Skill 原文中的 Shell、pip 或开发机路径');
    expect(convention).toContain('task_write_file 只写本 Run 的 work 目录');
    expect(convention).toContain('覆盖已有文件必须提供 expectedHash');
    expect(convention).toContain('Skill 资源始终只读');
    expect(convention).toContain('不得自行声明验证状态');
  });

  it('labels every command row with its own bindingId and skill name, in declared order', () => {
    const convention = composeRuntimeConvention({
      bindingId: 'binding-a',
      skillName: '技能 A',
      commands: [makeCommand('first'), makeCommand('second')],
    });
    expect(commandTable(convention)).toEqual([
      {
        bindingId: 'binding-a',
        skillName: '技能 A',
        commandId: 'first',
        argumentSchema: { type: 'object', properties: { target: { type: 'string' } } },
      },
      {
        bindingId: 'binding-a',
        skillName: '技能 A',
        commandId: 'second',
        argumentSchema: { type: 'object', properties: { target: { type: 'string' } } },
      },
    ]);
  });

  it('keeps sample specific wording out of a skill without a matching preset', () => {
    const convention = composeRuntimeConvention({
      bindingId: 'binding-a',
      skillName: '技能 A',
      commands: [makeCommand('analyze')],
    });
    for (const leaked of ['svg-export', 'template-merge', 'pptx-validate', 'assets/', '公司模板']) {
      expect(convention).not.toContain(leaked);
    }
  });

  it('appends preset conventions only for the skill that supplied them', () => {
    const preset = 'PPT 生成补充约定：pptx-validate 返回成功后才能登记成果。';
    const withPreset = composeRuntimeConvention({
      bindingId: 'binding-ppt',
      skillName: 'PPT 生成专家',
      commands: [makeCommand('pptx-validate')],
      presetConventions: preset,
    });
    const withoutPreset = composeRuntimeConvention({
      bindingId: 'binding-other',
      skillName: '技能 A',
      commands: [makeCommand('analyze')],
    });

    expect(withPreset).toContain(preset);
    expect(withoutPreset).not.toContain('PPT 生成补充约定');
    // 预设段落在通用层之后、命令表之前，模型先读到约束再看到可调用清单。
    expect(withPreset.indexOf('PPT 生成补充约定')).toBeLessThan(withPreset.indexOf('命令：'));
    expect(withPreset.indexOf('算台运行约定')).toBeLessThan(withPreset.indexOf('PPT 生成补充约定'));
  });

  it('gives two bindings of the same run disjoint command tables', () => {
    const first = composeRuntimeConvention({
      bindingId: 'binding-1',
      skillName: '技能一',
      commands: [makeCommand('run')],
    });
    const second = composeRuntimeConvention({
      bindingId: 'binding-2',
      skillName: '技能二',
      commands: [makeCommand('run')],
    });
    expect(commandTable(first)).toEqual([
      expect.objectContaining({ bindingId: 'binding-1', skillName: '技能一', commandId: 'run' }),
    ]);
    expect(commandTable(second)).toEqual([
      expect.objectContaining({ bindingId: 'binding-2', skillName: '技能二', commandId: 'run' }),
    ]);
  });
});
