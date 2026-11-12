import { join } from 'node:path';
import { openDb, type Db } from './db';
import { seedIfEmpty } from './seed';

// One connection per server process. Kept on globalThis so dev-mode hot reloads reuse it.
const g = globalThis as unknown as { __claimeaseDb?: Db };

export function getDb(): Db {
  if (!g.__claimeaseDb) {
    const file = process.env.CLAIMEASE_DB ?? join(process.cwd(), 'data', 'claimease.db');
    const db = openDb(file);
    seedIfEmpty(db);
    g.__claimeaseDb = db;
  }
  return g.__claimeaseDb;
}
