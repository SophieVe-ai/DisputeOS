import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config";

type DB = Database.Database;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  creditor TEXT NOT NULL,
  debtor TEXT NOT NULL,
  debtor_email TEXT,
  claimed_amount_pence INTEGER NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  doc_date TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  step_index INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS run_steps (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  agent TEXT NOT NULL,
  status TEXT NOT NULL,
  engine TEXT,
  output_json TEXT,
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
  PRIMARY KEY (run_id, step_index)
);

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  amount_pence INTEGER NOT NULL,
  document_title TEXT NOT NULL,
  document_body TEXT NOT NULL,
  status TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT,
  executed_at TEXT,
  execution_result TEXT
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  seq INTEGER PRIMARY KEY,
  case_id TEXT,
  run_id TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  entry_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

-- Anchoring status lives in a separate table so the ledger rows themselves stay append-only.
CREATE TABLE IF NOT EXISTS ledger_anchors (
  seq INTEGER PRIMARY KEY REFERENCES ledger_entries(seq),
  status TEXT NOT NULL,
  tx_hash TEXT,
  block_number INTEGER,
  chain_id TEXT,
  contract_address TEXT,
  anchored_at TEXT,
  error TEXT
);

-- Long-running negotiation: every letter sent and every reply received.
CREATE TABLE IF NOT EXISTS correspondence (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  proposal_id TEXT,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Durable wake-ups for the Negotiation agent: a reply arrived, or a deadline is due.
CREATE TABLE IF NOT EXISTS run_wakeups (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message_id TEXT,
  reason TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until TEXT,
  engine TEXT,
  output_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_correspondence_case ON correspondence(case_id);
CREATE INDEX IF NOT EXISTS idx_wakeups_due ON run_wakeups(status, due_at);

-- User accounts. Business accounts must name their business; emails are stored lower-cased.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('business', 'other')),
  business_name TEXT,
  created_at TEXT NOT NULL,
  CHECK (account_type = 'other' OR business_name IS NOT NULL)
);

-- Signed-in sessions. Only a hash of the cookie token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_case ON ledger_entries(case_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

-- Append-only guard: application code can never rewrite or delete ledger rows.
CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only'); END;
`;

/** Bump when SCHEMA or ADDED_COLUMNS change, so a hot-reloaded dev server upgrades its cached handle. */
const SCHEMA_VERSION = 2;

const globalForDb = globalThis as unknown as { __disputeosDb?: DB; __disputeosSchema?: number };

/** Columns added after the first release; added in place so existing databases keep working. */
const ADDED_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: "proposals", column: "turn_id", ddl: "turn_id TEXT" },
  { table: "proposals", column: "follow_up_days", ddl: "follow_up_days INTEGER" },
];

function migrate(db: DB): void {
  for (const { table, column, ddl } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function applySchema(db: DB): void {
  db.exec(SCHEMA);
  migrate(db);
}

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  applySchema(db);
  return db;
}

export function getDb(): DB {
  if (!globalForDb.__disputeosDb) {
    globalForDb.__disputeosDb = openDb(config.databasePath);
    globalForDb.__disputeosSchema = SCHEMA_VERSION;
  }
  if (globalForDb.__disputeosSchema !== SCHEMA_VERSION) {
    applySchema(globalForDb.__disputeosDb); // idempotent: CREATE IF NOT EXISTS + guarded ALTERs
    globalForDb.__disputeosSchema = SCHEMA_VERSION;
  }
  return globalForDb.__disputeosDb;
}

/** Test hook: swap in an isolated (usually in-memory) database. */
export function setDb(db: DB): void {
  globalForDb.__disputeosDb = db;
  globalForDb.__disputeosSchema = SCHEMA_VERSION;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export type { DB };
