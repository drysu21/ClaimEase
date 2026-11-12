import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = DatabaseSync;
type Param = string | number | null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS employees (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  grade       TEXT NOT NULL CHECK (grade IN ('L1','L2','L3','L4')),
  department  TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee','finance'))
);

CREATE TABLE IF NOT EXISTS policy_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT NOT NULL,
  grade       TEXT NOT NULL CHECK (grade IN ('L1','L2','L3','L4')),
  city_tier   TEXT NOT NULL DEFAULT 'any' CHECK (city_tier IN ('any','metro','other')),
  max_amount  INTEGER NOT NULL CHECK (max_amount > 0),
  unit        TEXT NOT NULL DEFAULT 'per_claim' CHECK (unit IN ('per_claim','per_night')),
  notes       TEXT,
  UNIQUE (category, grade, city_tier)
);

CREATE TABLE IF NOT EXISTS claims (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   TEXT NOT NULL REFERENCES employees(id),
  category      TEXT NOT NULL,
  description   TEXT NOT NULL,
  amount        REAL NOT NULL CHECK (amount > 0),
  units         INTEGER NOT NULL DEFAULT 1 CHECK (units >= 1),
  city          TEXT,
  expense_date  TEXT NOT NULL,
  submitted_at  TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending','flagged','approved','rejected')),
  flag_reason   TEXT,
  policy_limit  INTEGER,
  reviewed_by   TEXT REFERENCES employees(id),
  reviewed_at   TEXT,
  review_note   TEXT
);

CREATE INDEX IF NOT EXISTS idx_claims_employee ON claims (employee_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_claims_status   ON claims (status);
`;

/** Opens (and creates, if needed) a database. Pass ':memory:' for tests. */
export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

// Small typed wrappers: node:sqlite returns loosely typed rows.
export function all<T>(db: Db, sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}
export function one<T>(db: Db, sql: string, ...params: Param[]): T | null {
  return (db.prepare(sql).get(...params) as unknown as T | undefined) ?? null;
}
export function run(db: Db, sql: string, ...params: Param[]) {
  return db.prepare(sql).run(...params);
}
