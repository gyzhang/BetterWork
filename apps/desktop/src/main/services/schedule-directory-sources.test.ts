import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  type ExpertRevisionDraft,
  SCHEDULE_WORKSPACE_DIRECTORY_DEPTH_MAX,
  SCHEDULE_WORKSPACE_FILE_MAX,
  SCHEDULE_WORKSPACE_SINGLE_FILE_BYTES_MAX,
  SCHEDULE_WORKSPACE_TOTAL_FILE_BYTES_MAX,
  type ScheduleConfigDraft,
} from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from '../persistence';
import { InputSnapshotService } from './input-snapshot-service';
import {
  type ScheduleDirectorySourceError,
  ScheduleDirectorySourcesService,
} from './schedule-directory-sources';

const stores: AppStore[] = [];
const temporaryDirectories: string[] = [];

const temporaryDirectory = (prefix: string): string => {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};

const expertDraft = (): ExpertRevisionDraft => ({
  name: '定时任务文件专家',
  summary: '读取固定的工作空间来源',
  author: '',
  tags: [],
  identity: '你负责分析工作空间中明确列入的材料。',
  principles: ['不把候选路径视为已读取材料'],
  inputRequirements: [],
  deliveryRequirements: ['给出来源明确的分析'],
  skillPreset: [],
  builtinToolPolicy: { mode: 'application-defaults' },
  modelReference: { mode: 'application-default' },
});

const createConfig = (expertId: string, expertRevisionId: string): ScheduleConfigDraft => ({
  name: '月度来源检查',
  expertId,
  expertRevisionId,
  requirements: '检查工作空间中的经营资料。',
  expectedArtifactTypes: ['markdown'],
  timing: { frequency: 'monthly', day: 5, hour: 9, minute: 0, timeZone: 'Asia/Shanghai' },
  periodRule: 'previous-month',
  knowledgeSources: [],
  outputSubdirectory: '定时成果',
});

const createHarness = () => {
  const root = temporaryDirectory('betterwork-schedule-workspace-');
  const userData = temporaryDirectory('betterwork-schedule-user-data-');
  const store = AppStore.open(':memory:');
  stores.push(store);
  const workspace = store.workspaces.create(root, '定时任务合成空间');
  const expert = store.experts.create({ sourceKind: 'user', revision: expertDraft() });
  const config = createConfig(expert.id, expert.revision.id);
  const schedule = store.schedules.create({ workspaceId: workspace.id, config, createdAt: 100 });
  const snapshots = new InputSnapshotService(store, userData, () => 123);
  const service = new ScheduleDirectorySourcesService(store, snapshots);
  return { root, userData, store, workspace, config, schedule, snapshots, service };
};

const fakeSnapshots = (create = vi.fn()): Pick<InputSnapshotService, 'create'> => ({
  create: async (request) => {
    create(request);
    const absolutePath = path.resolve(request.workspaceRoot, request.sourcePath);
    const { size } = lstatSync(absolutePath);
    const contentHash = createHash('sha256').update(request.sourcePath).digest('hex');
    const extension = path.extname(request.sourcePath).slice(1).toLowerCase();
    return {
      reused: false,
      snapshot: {
        id: contentHash.slice(0, 16),
        workspaceId: request.workspaceId,
        sourcePath: request.sourcePath,
        contentHash,
        byteSize: size,
        format: extension,
        fileKey: `input-snapshots/${contentHash}/content`,
        status: 'ready',
        createdAt: 100,
        updatedAt: 100,
      },
    };
  },
});

const createSparseFile = (filePath: string, byteSize: number): void => {
  writeFileSync(filePath, '');
  truncateSync(filePath, byteSize);
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ScheduleDirectorySourcesService', () => {
  it('enumerates stable supported files, excludes metadata/temporary/symlink/special paths, and marks output candidates', async () => {
    const fixture = createHarness();
    writeFileSync(path.join(fixture.root, '经营数据.md'), '# 本月经营数据\n收入保持稳定。');
    writeFileSync(path.join(fixture.root, 'source.zip'), '不支持格式');
    writeFileSync(path.join(fixture.root, '.DS_Store'), 'Finder metadata');
    writeFileSync(path.join(fixture.root, '._摘要.md'), 'AppleDouble metadata');
    writeFileSync(path.join(fixture.root, '~$锁定.docx'), 'Office lock');
    writeFileSync(path.join(fixture.root, '未完成.tmp'), 'temporary');
    mkdirSync(path.join(fixture.root, '.git'), { recursive: true });
    mkdirSync(path.join(fixture.root, 'node_modules'), { recursive: true });
    mkdirSync(path.join(fixture.root, '.betterwork'), { recursive: true });
    writeFileSync(path.join(fixture.root, '.git', 'history.md'), '不枚举 Git');
    mkdirSync(path.join(fixture.root, '资料'), { recursive: true });
    writeFileSync(path.join(fixture.root, '资料', '季度表.xlsx'), 'synthetic xlsx');
    mkdirSync(path.join(fixture.root, '定时成果', '2026'), { recursive: true });
    writeFileSync(path.join(fixture.root, '定时成果', '2026', '上月报告.pdf'), 'synthetic pdf');

    const outsideRoot = temporaryDirectory('betterwork-schedule-outside-');
    const outside = path.join(outsideRoot, '越界.txt');
    writeFileSync(outside, '外部文件不得跟随');
    symlinkSync(outside, path.join(fixture.root, '越界.txt'));
    const fifo = path.join(fixture.root, '特殊设备.txt');
    execFileSync('/usr/bin/mkfifo', [fifo]);

    const collection = await fixture.service.collect({ scheduleId: fixture.schedule.schedule.id });

    expect(collection.items.map((item) => item.displayName)).toEqual([
      path.join('定时成果', '2026', '上月报告.pdf'),
      '经营数据.md',
      path.join('资料', '季度表.xlsx'),
    ]);
    expect(collection.items.map((item) => item.purpose)).toEqual([
      'historical-comparison',
      'other',
      'other',
    ]);
    expect(collection.items.every((item) => item.origin === 'workspace-directory')).toBe(true);
    expect(collection.fileCount).toBe(4);
    expect(collection.excluded).toMatchObject({
      counts: {
        'operating-system-metadata': 2,
        'temporary-file': 2,
        'managed-directory': 3,
        'symbolic-link': 1,
        'special-file': 1,
        'unsupported-format': 1,
      },
      unsupportedFormats: { zip: 1 },
    });
    expect(fixture.store.inputSnapshots.list()).toHaveLength(3);
    expect(
      fixture.store.inputSnapshots
        .list()
        .some(
          (snapshot) =>
            snapshot.sourcePath.includes('越界') || snapshot.sourcePath.includes('特殊设备'),
        ),
    ).toBe(false);
  });

  it('reflects additions, content changes, and deletions on the next preparation without artifact resurrection', async () => {
    const fixture = createHarness();
    const source = path.join(fixture.root, '本期摘要.md');
    writeFileSync(source, '# 本期\n收入 100');
    const first = await fixture.service.collect({ scheduleId: fixture.schedule.schedule.id });
    const firstHash = first.items[0]?.reference.contentHash;

    writeFileSync(source, '# 本期\n收入 120');
    writeFileSync(path.join(fixture.root, '补充.csv'), '月份,收入\n9月,120');
    const second = await fixture.service.collect({ scheduleId: fixture.schedule.schedule.id });
    expect(second.items.map((item) => item.displayName)).toEqual(['本期摘要.md', '补充.csv']);
    expect(
      second.items.find((item) => item.displayName === '本期摘要.md')?.reference.contentHash,
    ).not.toBe(firstHash);

    unlinkSync(source);
    unlinkSync(path.join(fixture.root, '补充.csv'));
    const afterDeletion = await fixture.service.collect({
      scheduleId: fixture.schedule.schedule.id,
    });
    expect(afterDeletion.items).toEqual([]);
    expect(fixture.store.inputSnapshots.list()).toHaveLength(3);
  });

  it('rejects a file-set change during snapshotting and never publishes a partial Schedule source snapshot', async () => {
    const fixture = createHarness();
    writeFileSync(path.join(fixture.root, 'a.md'), '第一份合成材料');
    const changedSource = path.join(fixture.root, 'b.md');
    writeFileSync(changedSource, '准备前版本');
    let mutated = false;
    const snapshots: Pick<InputSnapshotService, 'create'> = {
      create: async (request) => {
        const receipt = await fixture.snapshots.create(request);
        if (!mutated) {
          mutated = true;
          writeFileSync(changedSource, '准备期间新增内容');
        }
        return receipt;
      },
    };
    const service = new ScheduleDirectorySourcesService(fixture.store, snapshots);

    await expect(
      service.collect({ scheduleId: fixture.schedule.schedule.id }),
    ).rejects.toMatchObject({
      code: 'schedule_source_conflict',
    } satisfies Partial<ScheduleDirectorySourceError>);
    expect(
      fixture.store.inputSnapshots.list().every((snapshot) => snapshot.status === 'ready'),
    ).toBe(true);
    expect(
      fixture.store.schedules.get(fixture.schedule.schedule.id)?.schedule.currentConfigVersion,
    ).toBe(1);
  });

  it('honors cancellation without returning a source collection', async () => {
    const fixture = createHarness();
    writeFileSync(path.join(fixture.root, '本期.txt'), '取消时的合成文件');
    const controller = new AbortController();
    const snapshots: Pick<InputSnapshotService, 'create'> = {
      create: async (request) => {
        const receipt = await fixture.snapshots.create(request);
        controller.abort();
        return receipt;
      },
    };
    const service = new ScheduleDirectorySourcesService(fixture.store, snapshots);

    await expect(
      service.collect({ scheduleId: fixture.schedule.schedule.id, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'schedule_cancelled' });
    expect(fixture.store.inputSnapshots.list()).toHaveLength(1);
    expect(
      fixture.store.scheduleOccurrences.listBySchedule({ scheduleId: fixture.schedule.schedule.id })
        .items,
    ).toEqual([]);
  });

  it('accepts exactly the file-count and byte budgets and blocks the first item over each limit', async () => {
    const fixture = createHarness();
    const stub = fakeSnapshots();
    for (let index = 0; index < SCHEDULE_WORKSPACE_FILE_MAX; index += 1) {
      writeFileSync(path.join(fixture.root, `材料-${String(index).padStart(3, '0')}.txt`), '');
    }
    const boundaryService = new ScheduleDirectorySourcesService(fixture.store, stub);
    const atCountLimit = await boundaryService.collect({
      scheduleId: fixture.schedule.schedule.id,
    });
    expect(atCountLimit.fileCount).toBe(SCHEDULE_WORKSPACE_FILE_MAX);
    expect(atCountLimit.items).toHaveLength(SCHEDULE_WORKSPACE_FILE_MAX);

    writeFileSync(path.join(fixture.root, '第 501 项.txt'), '');
    await expect(
      boundaryService.collect({ scheduleId: fixture.schedule.schedule.id }),
    ).rejects.toMatchObject({ code: 'schedule_source_budget_exceeded' });

    const bytesFixture = createHarness();
    for (let index = 0; index < 5; index += 1) {
      createSparseFile(
        path.join(bytesFixture.root, `大文件-${index}.txt`),
        SCHEDULE_WORKSPACE_SINGLE_FILE_BYTES_MAX,
      );
    }
    const bytesService = new ScheduleDirectorySourcesService(bytesFixture.store, fakeSnapshots());
    const atByteLimit = await bytesService.collect({
      scheduleId: bytesFixture.schedule.schedule.id,
    });
    expect(atByteLimit.totalFileBytes).toBe(SCHEDULE_WORKSPACE_TOTAL_FILE_BYTES_MAX);
    expect(atByteLimit.items).toHaveLength(5);

    createSparseFile(
      path.join(bytesFixture.root, '大文件-5.txt'),
      SCHEDULE_WORKSPACE_SINGLE_FILE_BYTES_MAX,
    );
    await expect(
      bytesService.collect({ scheduleId: bytesFixture.schedule.schedule.id }),
    ).rejects.toMatchObject({ code: 'schedule_source_budget_exceeded' });

    const singleFixture = createHarness();
    createSparseFile(
      path.join(singleFixture.root, '单文件超限.txt'),
      SCHEDULE_WORKSPACE_SINGLE_FILE_BYTES_MAX + 1,
    );
    const singleService = new ScheduleDirectorySourcesService(singleFixture.store, fakeSnapshots());
    await expect(
      singleService.collect({ scheduleId: singleFixture.schedule.schedule.id }),
    ).rejects.toMatchObject({ code: 'schedule_source_budget_exceeded' });
  });

  it('allows the configured directory depth and refuses the next level', async () => {
    const fixture = createHarness();
    let directory = fixture.root;
    for (let depth = 0; depth < SCHEDULE_WORKSPACE_DIRECTORY_DEPTH_MAX; depth += 1) {
      directory = path.join(directory, `层-${depth}`);
      mkdirSync(directory);
    }
    writeFileSync(path.join(directory, '深层资料.md'), '深度边界合成材料');
    const service = new ScheduleDirectorySourcesService(fixture.store, fakeSnapshots());
    const atDepthLimit = await service.collect({ scheduleId: fixture.schedule.schedule.id });
    expect(atDepthLimit.items).toHaveLength(1);

    const overLimit = path.join(directory, '第十三层');
    mkdirSync(overLimit);
    writeFileSync(path.join(overLimit, '超深资料.md'), '不得截断后继续');
    await expect(
      service.collect({ scheduleId: fixture.schedule.schedule.id }),
    ).rejects.toMatchObject({
      code: 'schedule_source_budget_exceeded',
    });
  });
});
