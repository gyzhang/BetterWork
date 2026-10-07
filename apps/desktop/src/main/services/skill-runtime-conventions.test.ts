import type { RuntimeProfileCommand } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import { composeRuntimeConvention } from './skill-runtime-conventions';

/** The generic runtime section stays separate from package-declared command instructions. */

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
    expect(convention).toContain('只能按命令输出契约报告已声明的验证状态');
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

  it('keeps package-specific wording out unless the package declares it on a command', () => {
    const convention = composeRuntimeConvention({
      bindingId: 'binding-a',
      skillName: '技能 A',
      commands: [makeCommand('analyze')],
    });
    for (const leaked of ['svg-export', 'template-merge', 'pptx-validate', 'assets/', '公司模板']) {
      expect(convention).not.toContain(leaked);
    }
  });

  it('injects the runtime instructions declared by each package command', () => {
    const packageInstruction = 'Use the output id returned by this validation command.';
    const outputSource = {
      kind: 'generated' as const,
      relativePath: '.attempts/{executionId}/deck.pptx',
    };
    const withInstruction = composeRuntimeConvention({
      bindingId: 'binding-ppt',
      skillName: 'PPT 生成专家',
      commands: [
        {
          ...makeCommand('validate'),
          execution: {
            entrypoint: {
              scope: 'skill',
              runtime: 'managed-python',
              path: 'scripts/validate.py',
            },
            pathArguments: [],
            argv: [],
            outputs: [
              {
                outputId: 'deck',
                source: outputSource,
                extension: 'pptx',
                mimeType:
                  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                validation: {
                  structure: 'passed',
                  visual: 'not-checked',
                  manualEdit: 'not-checked',
                },
              },
            ],
          },
          runtimeInstruction: packageInstruction,
        },
      ],
    });
    const withoutInstruction = composeRuntimeConvention({
      bindingId: 'binding-other',
      skillName: '技能 A',
      commands: [makeCommand('analyze')],
    });

    expect(withInstruction).toContain(packageInstruction);
    expect(withoutInstruction).not.toContain(packageInstruction);
    expect(commandTable(withInstruction)[0]).toMatchObject({
      runtimeInstruction: packageInstruction,
      outputs: [{ pathKey: 'deck', source: outputSource }],
    });
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
