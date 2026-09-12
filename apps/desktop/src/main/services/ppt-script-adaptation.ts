import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { hashBytes, managedPath, readManagedFile } from '../infrastructure/managed-files';
import type { ResolvedCommand } from './skill-adapter';

const patches: Record<string, { hash: string; before: string; after: string }> = {
  'svg-export': {
    hash: 'b030b073e27c19524e14a7a9b71b40faeb8f35999e72b4239097e1917140ddd3',
    before: "'primary_language': 'zh-CN'",
    after: "'primary_language': 'zh-Hans'",
  },
  'template-merge': {
    hash: 'c4a874cabefb16c85006fc2d3b082c4f37b2e1848d624b517241eb3cda03b817',
    before: 'r1.font.size = Pt(title_size)',
    after: 'r1.font.size = None  # Inherit the actual template layout title size.',
  },
};

/** Exact, versioned changes; unknown source contracts must be reviewed again. */
export function patchPptScript(commandId: string, source: string): string {
  const patch = patches[commandId];
  if (!patch) throw new Error('Unsupported PPT script adaptation');
  if (source.split(patch.before).length !== 2)
    throw new Error('PPT script adaptation contract changed');
  return source.replace(patch.before, patch.after);
}

/** Original resources stay immutable. Each execution gets a traceable local script copy. */
export function adaptPptCommand(
  commandId: string,
  command: ResolvedCommand,
  skillRoot: string,
): ResolvedCommand {
  const patch = patches[commandId];
  if (!patch) return command;
  const script = command.argv[0];
  if (!script) throw new Error('Missing PPT script');
  const source = readManagedFile(skillRoot, path.relative(skillRoot, script));
  if (hashBytes(source) !== patch.hash) throw new Error('PPT script source hash changed');
  const adapted = patchPptScript(commandId, source.toString('utf8'));
  const relative = `.adaptations/${randomUUID()}/${path.basename(script)}`;
  const target = managedPath(command.cwd, relative, true);
  writeFileSync(target, adapted, { flag: 'wx', mode: 0o400 });
  writeFileSync(
    `${target}.json`,
    JSON.stringify({
      version: 1,
      commandId,
      sourceHash: patch.hash,
      adaptedHash: hashBytes(Buffer.from(adapted)),
      before: patch.before,
      after: patch.after,
    }),
    { flag: 'wx', mode: 0o400 },
  );
  return { ...command, argv: [target, ...command.argv.slice(1)] };
}
