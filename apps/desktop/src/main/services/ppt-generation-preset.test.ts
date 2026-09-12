import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { __internal, pptGenerationAdapterFactory } from './ppt-generation-preset';
import type { AdapterContext, AwaitedExecutionSnapshot } from './skill-adapter';

const { parseValidateIssues, interpretValidateOutput } = __internal;

const SKILL_SCRIPTS_ROOT = '/tmp/test-skill';
const PYTHON_PATH = '/usr/bin/python3';
const WORK_DIR = '/tmp/test-work';

const makeContext = (overrides?: Partial<AdapterContext>): AdapterContext => ({
  skillScriptsRoot: SKILL_SCRIPTS_ROOT,
  managedPythonPath: PYTHON_PATH,
  runWorkDir: WORK_DIR,
  ...overrides,
});

const makeSnapshot = (overrides?: Partial<AwaitedExecutionSnapshot>): AwaitedExecutionSnapshot => ({
  executionId: 'exec-1',
  status: 'succeeded',
  stdout: '',
  stderr: '',
  ...overrides,
});

describe('parseValidateIssues', () => {
  it('returns empty array when no issues present', () => {
    expect(parseValidateIssues('all good\nno problems here')).toEqual([]);
  });

  it('extracts issues marked with !! prefix', () => {
    const stdout =
      'checking file...\n!! Missing relationship in [Content_Types].xml\n!! Invalid slide layout reference\nDone.';
    expect(parseValidateIssues(stdout)).toEqual([
      'Missing relationship in [Content_Types].xml',
      'Invalid slide layout reference',
    ]);
  });

  it('handles empty stdout', () => {
    expect(parseValidateIssues('')).toEqual([]);
  });

  it('trims whitespace around issue markers', () => {
    expect(parseValidateIssues('  !!  some issue  ')).toEqual(['some issue']);
  });
});

describe('interpretValidateOutput', () => {
  it('returns succeeded when exit=0 and no issues', () => {
    const result = interpretValidateOutput(
      makeSnapshot({
        status: 'succeeded',
        stdout: '== deck.pptx  (parts=20, slides=2)\n   OK: 未发现触发修复的结构问题',
      }),
    );
    expect(result.status).toBe('succeeded');
    expect(result.executionId).toBe('exec-1');
  });

  it('returns failed when exit=0 but issues are present', () => {
    const stdout = '!! Missing relationship\n!! Invalid reference';
    const result = interpretValidateOutput(makeSnapshot({ status: 'succeeded', stdout }));
    expect(result.status).toBe('failed');
    expect(result.message).toContain('2');
  });

  it('returns failed when status is not succeeded even without issues', () => {
    const result = interpretValidateOutput(makeSnapshot({ status: 'failed', stdout: '' }));
    expect(result.status).toBe('failed');
    expect(result.message).toContain('failed');
  });

  it('includes structured issues JSON in stdout when issues found', () => {
    const stdout = '!! Issue one\n!! Issue two';
    const result = interpretValidateOutput(makeSnapshot({ status: 'succeeded', stdout }));
    expect(result.stdout).toContain('"issues"');
    expect(result.stdout).toContain('Issue one');
    expect(result.stdout).toContain('Issue two');
  });

  it('includes stderr when present', () => {
    const result = interpretValidateOutput(
      makeSnapshot({ status: 'failed', stderr: 'some error output' }),
    );
    expect(result.stderr).toBe('some error output');
  });

  it('omits stderr field when empty', () => {
    const result = interpretValidateOutput(makeSnapshot({ status: 'failed', stderr: '' }));
    expect(result.stderr).toBeUndefined();
  });
});

describe('PptGenerationAdapter', () => {
  const KNOWN_HASH = 'sha256-abc123';
  const adapter = pptGenerationAdapterFactory.create([KNOWN_HASH]);

  describe('isCompatible', () => {
    it('matches known content hash', () => {
      expect(adapter.isCompatible(KNOWN_HASH)).toBe(true);
    });

    it('does not match unknown content hash', () => {
      expect(adapter.isCompatible('unknown-hash')).toBe(false);
    });

    it('does not match when created with empty hashes', () => {
      const emptyAdapter = pptGenerationAdapterFactory.create([]);
      expect(emptyAdapter.isCompatible(KNOWN_HASH)).toBe(false);
    });
  });

  describe('resolveCommand', () => {
    it('returns undefined for unsupported commandId', () => {
      expect(adapter.resolveCommand('nonexistent', {}, makeContext())).toBeUndefined();
    });

    it('resolves project-init with PPTM_HOME', () => {
      const pptmHome = '/opt/toolchain';
      const resolved = adapter.resolveCommand(
        'project-init',
        { project_name: 'test-project' },
        makeContext({ pptmHome }),
      );
      expect(resolved).toBeDefined();
      expect(resolved?.executable).toBe(PYTHON_PATH);
      expect(resolved?.argv).toContain('init');
      expect(resolved?.argv).toContain('test-project');
      expect(resolved?.argv).toContain('--dir');
      expect(resolved?.argv).toContain(WORK_DIR);
      expect(resolved?.env.PPTM_HOME).toBe(pptmHome);
      expect(resolved?.cwd).toBe(WORK_DIR);
    });

    it('project-init throws without PPTM_HOME or snapshot', () => {
      expect(() =>
        adapter.resolveCommand('project-init', { project_name: 'test' }, makeContext()),
      ).toThrow('PPTM_HOME');
    });

    it('resolves icon-sync with project_dir', () => {
      const pptmHome = '/opt/toolchain';
      const resolved = adapter.resolveCommand(
        'icon-sync',
        { project_dir: 'my-project', icons: ['icon-a', 'icon-b'] },
        makeContext({ pptmHome }),
      );
      expect(resolved).toBeDefined();
      expect(resolved?.argv).toContain(path.resolve(WORK_DIR, 'my-project'));
      expect(resolved?.argv).toContain('icon-a');
      expect(resolved?.argv).toContain('icon-b');
    });

    it('resolves svg-export using skill scripts root', () => {
      const pptmHome = '/opt/toolchain';
      const resolved = adapter.resolveCommand(
        'svg-export',
        { project_dir: 'proj' },
        makeContext({ pptmHome }),
      );
      expect(resolved).toBeDefined();
      expect(resolved?.argv[0]).toContain(
        path.join(SKILL_SCRIPTS_ROOT, 'scripts', 'svg_native_export.py'),
      );
    });

    it('resolves template-merge with all paths', () => {
      const resolved = adapter.resolveCommand(
        'template-merge',
        {
          source_pptx: 'source.pptx',
          template_path: 'template.pptx',
          final_output: 'output.pptx',
          config_path: 'config.json',
        },
        makeContext(),
      );
      expect(resolved).toBeDefined();
      expect(resolved?.argv).toContain(path.resolve(WORK_DIR, 'source.pptx'));
      expect(resolved?.argv).toContain(path.resolve(WORK_DIR, 'template.pptx'));
      expect(resolved?.argv).toContain(path.resolve(WORK_DIR, 'output.pptx'));
      expect(resolved?.argv).toContain(path.resolve(WORK_DIR, 'config.json'));
    });

    it('resolves pptx-validate with pptx_path', () => {
      const resolved = adapter.resolveCommand(
        'pptx-validate',
        { pptx_path: 'output.pptx' },
        makeContext(),
      );
      expect(resolved).toBeDefined();
      expect(resolved?.argv).toContain(path.resolve(WORK_DIR, 'output.pptx'));
      expect(resolved?.argv[0]).toContain(
        path.join(SKILL_SCRIPTS_ROOT, 'scripts', 'validate_pptx.py'),
      );
    });

    it('resolves relative paths against workDir', () => {
      const resolved = adapter.resolveCommand(
        'pptx-validate',
        { pptx_path: 'subdir/output.pptx' },
        makeContext(),
      );
      expect(resolved?.argv[1]).toBe(path.resolve(WORK_DIR, 'subdir/output.pptx'));
    });

    it('preserves absolute paths as-is', () => {
      const absPath = path.join(WORK_DIR, 'output.pptx');
      const resolved = adapter.resolveCommand(
        'pptx-validate',
        { pptx_path: absPath },
        makeContext(),
      );
      expect(resolved?.argv[1]).toBe(absPath);
    });

    it('env does not include PPTM_HOME when no toolchain snapshot', () => {
      const resolved = adapter.resolveCommand(
        'pptx-validate',
        { pptx_path: 'out.pptx' },
        makeContext(),
      );
      expect(resolved?.env.PPTM_HOME).toBeUndefined();
    });

    it('env includes PPTM_HOME when toolchain snapshot is available', () => {
      const resolved = adapter.resolveCommand(
        'pptx-validate',
        { pptx_path: 'out.pptx' },
        makeContext({ toolchainSnapshotRoot: '/snapshot/root' }),
      );
      expect(resolved?.env.PPTM_HOME).toBe('/snapshot/root');
    });

    it('env uses managed python path and sanitized variables', () => {
      const resolved = adapter.resolveCommand(
        'pptx-validate',
        { pptx_path: 'out.pptx' },
        makeContext(),
      );
      expect(resolved?.env.PYTHONHOME).toBe('');
      expect(resolved?.env.PYTHONPATH).toBe('');
      expect(resolved?.env.PYTHONDONTWRITEBYTECODE).toBe('1');
    });
  });

  describe('interpretOutput', () => {
    it('returns undefined for non-validate commands', () => {
      expect(adapter.interpretOutput?.('project-init', makeSnapshot())).toBeUndefined();
    });

    it('interprets validate output with issues as failed', () => {
      const result = adapter.interpretOutput?.(
        'pptx-validate',
        makeSnapshot({
          status: 'succeeded',
          stdout: '!! Bad relationship',
        }),
      );
      expect(result?.status).toBe('failed');
    });

    it('interprets clean validate output as succeeded', () => {
      const result = adapter.interpretOutput?.(
        'pptx-validate',
        makeSnapshot({
          status: 'succeeded',
          stdout: '== deck.pptx  (parts=20, slides=2)\n   OK: 未发现触发修复的结构问题',
        }),
      );
      expect(result?.status).toBe('succeeded');
    });
  });

  describe('runtimeConventions', () => {
    it('returns undefined when none of the preset commands are present', () => {
      expect(adapter.runtimeConventions?.(new Set(['analyze']))).toBeUndefined();
    });

    it('mentions only the commands actually declared by the binding', () => {
      const onlyValidate = adapter.runtimeConventions?.(new Set(['pptx-validate']));
      expect(onlyValidate).toContain('pptx-validate');
      expect(onlyValidate).not.toContain('svg-export');
      expect(onlyValidate).not.toContain('template-merge');
    });

    it('describes the attempt separation only when both export and merge are bound', () => {
      const both = adapter.runtimeConventions?.(new Set(['svg-export', 'template-merge']));
      expect(both).toContain('svg-export');
      expect(both).toContain('template-merge');
      expect(both).toContain('attempt');
      // 只有 svg-export 时没有任何预设口径——attempt 合并规则要求两个命令都在。
      expect(adapter.runtimeConventions?.(new Set(['svg-export']))).toBeUndefined();
    });

    it('keeps the artifact registration gate tied to pptx-validate', () => {
      const withValidate = adapter.runtimeConventions?.(
        new Set(['svg-export', 'template-merge', 'pptx-validate']),
      );
      expect(withValidate).toContain('artifact_register_file');
      expect(withValidate).toContain('pptx-validate');
    });
  });
});

it.each(['', 'OK', 'invalid JSON', '{"issues":["broken"]}', '== deck.pptx  (parts=20, slides=2)'])(
  'rejects incomplete report: %s',
  (stdout) => {
    expect(interpretValidateOutput(makeSnapshot({ stdout })).status).toBe('failed');
  },
);
