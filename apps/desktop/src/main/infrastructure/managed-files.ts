import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export const hashBytes = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/** Walk existing ancestors as well as the leaf; realpath(leaf) alone misses new files. */
export function managedPath(root: string, relativePath: string, createParents = false): string {
  if (path.isAbsolute(relativePath)) throw new Error('Managed file path must be relative');
  const canonicalRoot = realpathSync(root);
  const target = path.resolve(canonicalRoot, relativePath);
  const relative = path.relative(canonicalRoot, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error('Managed file path escapes its root');
  }
  const parts = relative.split(path.sep);
  let current = canonicalRoot;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let info;
    try {
      info = lstatSync(current);
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      if (index < parts.length - 1 && createParents) mkdirSync(current);
      continue;
    }
    if (info.isSymbolicLink()) throw new Error('Managed file path contains a symbolic link');
    if (index < parts.length - 1 && !info.isDirectory()) {
      throw new Error('Managed file parent is not a directory');
    }
  }
  return target;
}

export function readManagedFile(root: string, relativePath: string): Buffer {
  const target = managedPath(root, relativePath);
  const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1)
      throw new Error('Output must be a regular unlinked file');
    if (info.size > 100 * 1024 * 1024) throw new Error('Output exceeds 100 MB');
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** No await between validation and commit; replacement does not follow hard links. */
export function writeManagedText(
  root: string,
  relativePath: string,
  content: string,
  expectedHash?: string,
): { relativePath: string; bytesWritten: number; contentHash: string; created: boolean } {
  const target = managedPath(root, relativePath, true);
  const created = !existsSync(target);
  if (!created) {
    const existing = readManagedFile(root, relativePath);
    if (!expectedHash || hashBytes(existing) !== expectedHash) {
      throw new Error('File has changed or expectedHash is missing; re-read before overwriting');
    }
  } else if (expectedHash) {
    throw new Error('File no longer exists; expectedHash cannot be matched');
  }
  const bytes = Buffer.from(content, 'utf8');
  const temporary = path.join(path.dirname(target), `.betterwork-${randomUUID()}`);
  try {
    writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    managedPath(root, relativePath);
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
  return { relativePath, bytesWritten: bytes.length, contentHash: hashBytes(bytes), created };
}
