import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, lstatSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { managedPath, readManagedFile } from '../infrastructure/managed-files';

/** Each export sees a fresh project, so old exports/validation cannot satisfy this attempt. */
export function preparePptAttempt(
  commandId: string,
  args: Record<string, unknown>,
  workDir: string,
  skillRoot: string,
): Record<string, unknown> {
  const resolve = (key: string, root = workDir): string => {
    const value = args[key];
    if (typeof value !== 'string') throw new Error(`Missing path argument: ${key}`);
    return managedPath(root, path.isAbsolute(value) ? path.relative(root, value) : value);
  };
  if (commandId === 'svg-export') {
    const project = resolve('project_dir');
    const target = managedPath(workDir, `.attempts/${randomUUID()}/project`, true);
    cpSync(project, target, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter(source) {
        if (lstatSync(source).isSymbolicLink()) throw new Error('Project contains a symbolic link');
        const relative = path.relative(project, source);
        return !relative
          .split(path.sep)
          .some((segment) => ['exports', 'validation', '.outputs', '.attempts'].includes(segment));
      },
    });
    return { ...args, project_dir: target };
  }
  if (commandId === 'template-merge') {
    resolve('source_pptx');
    resolve('config_path');
    const requestedOutput = resolve('final_output');
    if (existsSync(requestedOutput))
      throw new Error('Output already exists; choose a new output name');
    const templateRoot =
      typeof args['template_path'] === 'string' && args['template_path'].startsWith('assets/')
        ? skillRoot
        : workDir;
    const template = resolve('template_path', templateRoot);
    const bytes = readManagedFile(templateRoot, path.relative(templateRoot, template));
    const attempt = `.attempts/${randomUUID()}`;
    const templateCopy = managedPath(workDir, `${attempt}/template.pptx`, true);
    writeFileSync(templateCopy, bytes, { flag: 'wx', mode: 0o400 });
    const output = managedPath(workDir, `${attempt}/result.pptx`);
    return { ...args, template_path: templateCopy, final_output: output };
  }
  if (commandId === 'pptx-validate') resolve('pptx_path');
  if (commandId === 'icon-sync') resolve('project_dir');
  return args;
}
