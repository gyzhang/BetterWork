import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];
const generatorPath = fileURLToPath(
  new URL('./generate-skill-dependency-lock.mjs', import.meta.url),
);

const temporaryDirectory = (): string => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-skill-lock-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const pipPackage = (name: string, version: string, wheel: string, hash: string) => ({
  metadata: { name, version, license: 'MIT' },
  download_info: {
    url: `https://files.pythonhosted.org/packages/${wheel}`,
    archive_info: { hashes: { sha256: hash } },
  },
});

describe('generate-skill-dependency-lock', () => {
  it('converts a pip install report into a sorted target-specific package lock', () => {
    const directory = temporaryDirectory();
    const reportPath = path.join(directory, 'report.json');
    const outputPath = path.join(directory, 'runtime', 'lock.json');
    writeFileSync(
      reportPath,
      JSON.stringify({
        install: [
          pipPackage('Zeta_Pkg', '2.0', 'zeta_pkg-2.0-py3-none-any.whl', 'a'.repeat(64)),
          pipPackage('alpha-pkg', '1.1', 'alpha_pkg-1.1-py3-none-any.whl', 'b'.repeat(64)),
        ],
      }),
    );

    const result = spawnSync(
      process.execPath,
      [
        generatorPath,
        '--report',
        reportPath,
        '--output',
        outputPath,
        '--import-probes',
        'alpha_pkg, zeta_pkg,alpha_pkg',
      ],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(0);

    const lock = JSON.parse(readFileSync(outputPath, 'utf8')) as {
      platform: { os: string; arch: string; abi: string };
      pythonRequirement: string;
      packages: Array<{ name: string; source: string; sha256: string; url: string }>;
      importProbes: string[];
    };
    expect(lock.platform).toEqual({ os: 'darwin', arch: 'arm64', abi: 'cp312' });
    expect(lock.pythonRequirement).toBe('3.12');
    expect(lock.packages.map((item) => item.name)).toEqual(['alpha-pkg', 'Zeta_Pkg']);
    expect(lock.packages[0]).toMatchObject({
      source: 'approved-index',
      sha256: 'b'.repeat(64),
      url: 'https://files.pythonhosted.org/packages/alpha_pkg-1.1-py3-none-any.whl',
    });
    expect(lock.importProbes).toEqual(['alpha_pkg', 'zeta_pkg']);
  });

  it('refuses source archives', () => {
    const directory = temporaryDirectory();
    const reportPath = path.join(directory, 'report.json');
    const outputPath = path.join(directory, 'lock.json');
    writeFileSync(
      reportPath,
      JSON.stringify({
        install: [pipPackage('source-only', '1.0', 'source-only-1.0.tar.gz', 'c'.repeat(64))],
      }),
    );
    const result = spawnSync(
      process.execPath,
      [
        generatorPath,
        '--report',
        reportPath,
        '--output',
        outputPath,
        '--import-probes',
        'source_only',
      ],
      { encoding: 'utf8' },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('only reviewed wheels');
    expect(() => readFileSync(outputPath)).toThrow();
  });

  it('requires an HTTPS artifact URL without credentials', () => {
    const directory = temporaryDirectory();
    const reportPath = path.join(directory, 'report.json');
    const outputPath = path.join(directory, 'lock.json');
    const unsafePackage = pipPackage(
      'unsafe-source',
      '1.0',
      'unsafe_source-1.0-py3-none-any.whl',
      'd'.repeat(64),
    );
    unsafePackage.download_info.url = unsafePackage.download_info.url.replace('https:', 'http:');
    writeFileSync(reportPath, JSON.stringify({ install: [unsafePackage] }));

    const result = spawnSync(
      process.execPath,
      [
        generatorPath,
        '--report',
        reportPath,
        '--output',
        outputPath,
        '--import-probes',
        'unsafe_source',
      ],
      { encoding: 'utf8' },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('HTTPS artifact URL');
    expect(() => readFileSync(outputPath)).toThrow();
  });
});
