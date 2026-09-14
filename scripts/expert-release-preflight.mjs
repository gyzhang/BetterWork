import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = (message) => {
  throw new Error(message);
};

const readJson = async (filePath) => {
  const content = await readFile(filePath, 'utf8');
  try {
    return JSON.parse(content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(`${path.relative(repositoryRoot, filePath)} is not valid JSON: ${reason}`);
  }
};

const isIgnored = (name) =>
  name === '.DS_Store' || name === 'Thumbs.db' || name === 'desktop.ini' || name.startsWith('._');

const assertChildPath = (root, child, label) => {
  const relative = path.relative(root, child);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(`${label} escapes resource root: ${child}`);
  }
};

const collectFiles = async (root, directory = root) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (isIgnored(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(root, absolutePath)));
      continue;
    }
    if (!entry.isFile())
      fail(`unsupported resource entry: ${path.relative(repositoryRoot, absolutePath)}`);
    files.push(absolutePath);
  }
  return files;
};

const hashSkill = async (root, label) => {
  const files = (await collectFiles(root)).sort((left, right) => left.localeCompare(right));
  if (!files.some((file) => path.relative(root, file) === 'SKILL.md')) {
    fail(`missing SKILL.md: ${label}`);
  }
  const hash = createHash('sha256');
  for (const file of files) {
    const relativePath = path.relative(root, file);
    hash
      .update(relativePath)
      .update('\0')
      .update(await readFile(file));
  }
  return hash.digest('hex');
};

const verifyResourceSet = async (resourceRoot, label) => {
  const skillManifestPath = path.join(resourceRoot, 'skills', 'release-manifest.json');
  const expertManifestPath = path.join(resourceRoot, 'experts', 'release-manifest.json');
  const [skillManifest, expertManifest] = await Promise.all([
    readJson(skillManifestPath),
    readJson(expertManifestPath),
  ]);
  if (skillManifest.formatVersion !== 1) fail('unsupported Skill release manifest format');
  if (expertManifest.formatVersion !== 1) fail('unsupported Expert release manifest format');
  if (!Array.isArray(skillManifest.skills) || skillManifest.skills.length === 0) {
    fail('Skill release manifest has no entries');
  }
  if (!Array.isArray(expertManifest.experts) || expertManifest.experts.length === 0) {
    fail('Expert release manifest has no entries');
  }

  const skillIds = new Set();
  for (const entry of skillManifest.skills) {
    if (typeof entry.skillId !== 'string' || skillIds.has(entry.skillId)) {
      fail(`invalid or duplicate Skill id: ${String(entry.skillId)}`);
    }
    skillIds.add(entry.skillId);
    if (typeof entry.resourceName !== 'string' || entry.resourceName.length === 0) {
      fail(`Skill ${entry.skillId} has no resourceName`);
    }
    const skillRoot = path.resolve(resourceRoot, 'skills', entry.resourceName);
    assertChildPath(path.resolve(resourceRoot, 'skills'), skillRoot, `Skill ${entry.skillId}`);
    const resourceInfo = await stat(skillRoot).catch(() => undefined);
    if (!resourceInfo?.isDirectory())
      fail(`missing Skill resource in ${label}: ${entry.resourceName}`);
    const contentHash = await hashSkill(skillRoot, `${label}/${entry.resourceName}`);
    if (contentHash !== entry.contentHash) {
      fail(
        `Skill ${entry.skillId} contentHash mismatch: expected ${entry.contentHash}, got ${contentHash}`,
      );
    }
  }

  const expertIds = new Set();
  for (const expert of expertManifest.experts) {
    if (typeof expert.expertId !== 'string' || expertIds.has(expert.expertId)) {
      fail(`invalid or duplicate Expert id: ${String(expert.expertId)}`);
    }
    expertIds.add(expert.expertId);
    if (!Array.isArray(expert.skillPreset)) fail(`Expert ${expert.expertId} has no skillPreset`);
    for (const preset of expert.skillPreset) {
      if (!skillIds.has(preset.skillId)) {
        fail(`Expert ${expert.expertId} references missing Skill ${preset.skillId}`);
      }
    }
  }
  await verifyNoDevelopmentPathLeak(resourceRoot, label);
  return {
    experts: expertManifest.experts.length,
    skills: skillManifest.skills.length,
  };
};

const verifyNoDevelopmentPathLeak = async (resourceRoot, label) => {
  const markers = [repositoryRoot, process.env.HOME, process.env.USERPROFILE].filter(
    (marker) => typeof marker === 'string' && marker.length > 0,
  );
  if (markers.length === 0) return;
  for (const directoryName of ['skills', 'experts', 'dependency-locks']) {
    const directory = path.join(resourceRoot, directoryName);
    const info = await stat(directory).catch(() => undefined);
    if (!info?.isDirectory()) continue;
    for (const file of await collectFiles(resourceRoot, directory)) {
      const content = await readFile(file);
      const marker = markers.find((candidate) => content.includes(Buffer.from(candidate)));
      if (marker) {
        fail(
          `${label} contains a development path in ${path.relative(resourceRoot, file)}: ${marker}`,
        );
      }
    }
  }
};

const verifyBuilderResources = async () => {
  const builderPath = path.join(repositoryRoot, 'apps', 'desktop', 'electron-builder.yml');
  const builder = await readFile(builderPath, 'utf8');
  for (const resource of ['skills', 'experts', 'dependency-locks']) {
    if (!builder.includes(`to: ${resource}`))
      fail(`electron-builder.yml does not copy ${resource}`);
  }
};

const main = async () => {
  const packagedRootArgumentIndex = process.argv.indexOf('--packaged-root');
  const packagedRootArgument =
    packagedRootArgumentIndex >= 0 ? process.argv[packagedRootArgumentIndex + 1] : undefined;
  if (packagedRootArgumentIndex >= 0 && !packagedRootArgument) {
    fail('--packaged-root requires a Resources directory');
  }
  const counts = await verifyResourceSet(
    path.join(repositoryRoot, 'resources'),
    'repository resources',
  );
  await verifyBuilderResources();
  let packagedMessage = '';
  if (packagedRootArgument) {
    const packagedRoot = path.resolve(process.cwd(), packagedRootArgument);
    await verifyResourceSet(packagedRoot, 'packaged Resources');
    packagedMessage = ` Packaged Resources verified at ${packagedRoot}.`;
  }
  process.stdout.write(
    `Expert release preflight passed: ${counts.experts} expert(s), ${counts.skills} Skill(s), builder resources verified.${packagedMessage}`,
  );
};

main().catch((error) => {
  process.stderr.write(
    `Expert release preflight failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
