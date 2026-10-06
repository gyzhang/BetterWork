import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { hashBytes, managedPath, readManagedFile } from '../infrastructure/managed-files';
import type { ResolvedCommand } from './skill-adapter';

interface ScriptReplacement {
  before: string;
  after: string;
}

interface ScriptPatch {
  hash: string;
  replacements: readonly ScriptReplacement[];
}

const patches: Record<string, readonly ScriptPatch[]> = {
  'svg-export': [
    {
      hash: 'b030b073e27c19524e14a7a9b71b40faeb8f35999e72b4239097e1917140ddd3',
      replacements: [
        { before: "'primary_language': 'zh-CN'", after: "'primary_language': 'zh-Hans'" },
      ],
    },
    {
      hash: '25126cef8959fded594191cc12269700796c0a6012c65b30ff2b56e6b787199d',
      replacements: [
        {
          before: 'r = subprocess.run([sys.executable, exporter, project], capture_output=True,',
          after:
            "r = subprocess.run([sys.executable, exporter, project, '-o', os.path.join(project, 'exports', 'betterwork-output.pptx')], capture_output=True,",
        },
      ],
    },
  ],
  'template-merge': [
    {
      hash: 'c4a874cabefb16c85006fc2d3b082c4f37b2e1848d624b517241eb3cda03b817',
      replacements: [
        {
          before: 'r1.font.size = Pt(title_size)',
          after: 'r1.font.size = None  # Inherit the actual template layout title size.',
        },
      ],
    },
    {
      hash: 'ff30446f73a61ba8bba2d5dac4feafe58fc9f58bc0f4b40b7ca25b12c70bde97',
      replacements: [
        {
          before: 'r1.font.size = Pt(title_size)',
          after: 'r1.font.size = None  # Inherit the actual template layout title size.',
        },
      ],
    },
  ],
};

const matchingPatch = (commandId: string, source: string): ScriptPatch | undefined =>
  patches[commandId]?.find((patch) =>
    patch.replacements.every(({ before }) => source.split(before).length === 2),
  );

const applyPatch = (patch: ScriptPatch, source: string): string => {
  let adapted = source;
  for (const replacement of patch.replacements) {
    if (adapted.split(replacement.before).length !== 2)
      throw new Error('PPT script adaptation contract changed');
    adapted = adapted.replace(replacement.before, replacement.after);
  }
  return adapted;
};

const SVG_VERIFIER_SCRIPTS = ['verify_palette.py', 'verify_layout.py', 'verify_geometry.py'];

/** Keep the exporter's mandatory sibling quality gates beside its immutable attempt copy. */
export function materializeSvgVerificationScripts(
  skillRoot: string,
  workDir: string,
  adaptationDirectory: string,
): string {
  const relativeScriptsDirectory = path.join(adaptationDirectory, 'scripts');
  for (const name of SVG_VERIFIER_SCRIPTS) {
    const source = readManagedFile(skillRoot, path.join('scripts', name));
    const relativeTarget = path.join(relativeScriptsDirectory, name);
    const target = managedPath(workDir, relativeTarget, true);
    writeFileSync(target, source, { flag: 'wx', mode: 0o400 });
  }
  return managedPath(workDir, relativeScriptsDirectory);
}

/** Exact, versioned changes; unknown source contracts must be reviewed again. */
export function patchPptScript(commandId: string, source: string): string {
  if (!patches[commandId]) throw new Error('Unsupported PPT script adaptation');
  const patch = matchingPatch(commandId, source);
  if (!patch) throw new Error('PPT script adaptation contract changed');
  return applyPatch(patch, source);
}

/** Original resources stay immutable. Each execution gets a traceable local script copy. */
export function adaptPptCommand(
  commandId: string,
  command: ResolvedCommand,
  skillRoot: string,
): ResolvedCommand {
  const candidates = patches[commandId];
  if (!candidates) return command;
  const script = command.argv[0];
  if (!script) throw new Error('Missing PPT script');
  const source = readManagedFile(skillRoot, path.relative(skillRoot, script));
  const sourceText = source.toString('utf8');
  const patch = candidates.find((candidate) => candidate.hash === hashBytes(source));
  if (!patch) throw new Error('PPT script source hash changed');
  const adapted = applyPatch(patch, sourceText);
  const adaptationDirectory = `.adaptations/${randomUUID()}`;
  const relative =
    commandId === 'svg-export'
      ? path.join(adaptationDirectory, 'scripts', path.basename(script))
      : path.join(adaptationDirectory, path.basename(script));
  const target = managedPath(command.cwd, relative, true);
  if (commandId === 'svg-export') {
    materializeSvgVerificationScripts(skillRoot, command.cwd, adaptationDirectory);
  }
  writeFileSync(target, adapted, { flag: 'wx', mode: 0o400 });
  writeFileSync(
    `${target}.json`,
    JSON.stringify({
      version: 1,
      commandId,
      sourceHash: patch.hash,
      adaptedHash: hashBytes(Buffer.from(adapted)),
      replacements: patch.replacements,
    }),
    { flag: 'wx', mode: 0o400 },
  );
  return { ...command, argv: [target, ...command.argv.slice(1)] };
}
