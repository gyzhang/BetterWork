import type Database from 'better-sqlite3';

import { appMigrations, detectLegacyAppDatabase, reconcileLegacyAppDatabase } from './app-schema';
import {
  detectLegacyKnowledgeDatabase,
  knowledgeMigrations,
  reconcileLegacyKnowledgeDatabase,
} from './knowledge-schema';
import { openDatabase } from './migrate';

/** 历史库对账后达到的 schema 版本；两个库的 v1 都是「迁移制度之前」的形状。 */
const LEGACY_BASELINE = 1;

export function openAppDatabase(filePath: string): Database.Database {
  return openDatabase(filePath, {
    migrations: appMigrations,
    detectLegacy: detectLegacyAppDatabase,
    reconcileLegacy: reconcileLegacyAppDatabase,
    legacyBaseline: LEGACY_BASELINE,
  });
}

export function openKnowledgeDatabase(filePath: string): Database.Database {
  return openDatabase(filePath, {
    migrations: knowledgeMigrations,
    detectLegacy: detectLegacyKnowledgeDatabase,
    reconcileLegacy: reconcileLegacyKnowledgeDatabase,
    legacyBaseline: LEGACY_BASELINE,
  });
}

export { readSchemaVersion } from './migrate';
export { appMigrations, knowledgeMigrations };
