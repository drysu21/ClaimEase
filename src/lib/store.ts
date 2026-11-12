import { openDb, type Db } from './db';

// One client per server process. Kept on globalThis so dev-mode hot reloads reuse it.
const g = globalThis as unknown as { __claimeaseDb?: Db };

export function getDb(): Db {
  return (g.__claimeaseDb ??= openDb());
}
