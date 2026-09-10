import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Db = DatabaseSyncType;

// Resolve the builtin at runtime so bundlers/test runners that do not yet
// recognise `node:sqlite` as a Node builtin leave it alone.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

const here = dirname(fileURLToPath(import.meta.url));

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  const schema = readFileSync(join(here, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrate(db);
  return db;
}

/** Row helper: node:sqlite returns null-prototype objects; normalise to plain objects. */
export function row<T>(r: unknown): T | undefined {
  if (r === undefined || r === null) return undefined;
  return { ...(r as Record<string, unknown>) } as T;
}
export function rows<T>(rs: unknown[]): T[] {
  return rs.map((r) => ({ ...(r as Record<string, unknown>) }) as T);
}

/** Additive migrations for databases created by earlier versions. */
function migrate(db: DatabaseSyncType) {
  const cols = new Set((db.prepare('PRAGMA table_info(requests)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('source')) db.exec("ALTER TABLE requests ADD COLUMN source TEXT NOT NULL DEFAULT 'app'");
  if (!cols.has('created_by')) db.exec('ALTER TABLE requests ADD COLUMN created_by TEXT');
}
