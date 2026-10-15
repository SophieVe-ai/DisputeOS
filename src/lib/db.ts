// Postgres data layer. Production uses a real Postgres (Neon on Vercel) via `DATABASE_URL`;
// local dev, tests and the eval sandbox use PGlite, an embedded Postgres, so the one-command
// demo still needs no network. Callers write `?` placeholders; they are numbered for Postgres.
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

export interface Db {
  all<T>(text: string, params?: unknown[]): Promise<T[]>;
  one<T>(text: string, params?: unknown[]): Promise<T | undefined>;
  /** Runs a statement; resolves to the number of affected rows. */
  run(text: string, params?: unknown[]): Promise<number>;
  /** Runs several statements with no parameters (schema, test resets). */
  exec(text: string): Promise<void>;
  /** Runs `fn` in one transaction. Any `getDb()` call inside `fn` joins it. */
  tx<T>(fn: () => Promise<T>): Promise<T>;
  /** Runs `fn` only if this caller wins a cross-instance lock on `key`; otherwise resolves null. */
  tryLock<T>(key: number, fn: () => Promise<T>): Promise<T | null>;
  close(): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cases (
  ord BIGSERIAL,
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  creditor TEXT NOT NULL,
  debtor TEXT NOT NULL,
  debtor_email TEXT,
  claimed_amount_pence BIGINT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  ord BIGSERIAL,
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  doc_date TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  ord BIGSERIAL,
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
  ord BIGSERIAL,
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  amount_pence BIGINT NOT NULL,
  document_title TEXT NOT NULL,
  document_body TEXT NOT NULL,
  status TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT,
  executed_at TEXT,
  execution_result TEXT,
  turn_id TEXT,
  follow_up_days INTEGER
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
  block_number BIGINT,
  chain_id TEXT,
  contract_address TEXT,
  anchored_at TEXT,
  error TEXT
);

-- Long-running negotiation: every letter sent and every reply received.
CREATE TABLE IF NOT EXISTS correspondence (
  ord BIGSERIAL,
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
  ord BIGSERIAL,
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

-- Agent eval results (the full report; the score is also anchored as an eval.completed entry).
CREATE TABLE IF NOT EXISTS eval_runs (
  ord BIGSERIAL,
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  report_json TEXT,
  ledger_seq INTEGER,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

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
CREATE INDEX IF NOT EXISTS idx_correspondence_run ON correspondence(run_id);
CREATE INDEX IF NOT EXISTS idx_wakeups_due ON run_wakeups(status, due_at);

-- Append-only guard: application code can never rewrite or delete ledger rows.
CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'ledger_entries is append-only'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ledger_no_update ON ledger_entries;
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
DROP TRIGGER IF EXISTS ledger_no_delete ON ledger_entries;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
`;

/** Tables in dependency order (children first), for test resets. */
export const TABLES = ["sessions", "users", "eval_runs", "run_wakeups", "correspondence", "ledger_anchors", "ledger_entries", "proposals", "run_steps", "runs", "documents", "cases"];

/** Numbers `?` placeholders as `$1, $2, …` (none of our SQL uses `?` inside string literals). */
export function numberPlaceholders(text: string): string {
  let n = 0;
  return text.replace(/\?/g, () => `$${++n}`);
}

interface QueryResult {
  rows: unknown[];
  affectedRows: number;
}
type RawQuery = (text: string, params: unknown[]) => Promise<QueryResult>;
type RawExec = (text: string) => Promise<void>;
/** Runs `fn` with query/exec functions bound to one transaction's connection. */
type RawTransaction = <T>(fn: (q: RawQuery, exec: RawExec) => Promise<T>) => Promise<T>;

// Kept on globalThis: Next.js can load this module more than once (instrumentation and route
// bundles), and every copy must share one store, or a query inside a transaction would miss it
// and wait on the transaction's own connection (a deadlock).
const stores = globalThis as unknown as { __disputeosTx?: AsyncLocalStorage<Db>; __disputeosScope?: AsyncLocalStorage<Db> };
const txStorage = (stores.__disputeosTx ??= new AsyncLocalStorage<Db>());
/** A database scoped to an async call tree (the eval sandbox), overriding the global one. */
const scopeStorage = (stores.__disputeosScope ??= new AsyncLocalStorage<Db>());

/** Shared implementation over any driver that can run one parameterised query. */
type TryLock = <T>(key: number, fn: () => Promise<T>) => Promise<T | null>;

/** PGlite lives inside this one process, where callers already coalesce: no cross-instance lock needed. */
const inProcessLock: TryLock = (_key, fn) => fn();

function makeDb(raw: RawQuery, execRaw: RawExec, transaction: RawTransaction, close: () => Promise<void>, tryLock: TryLock = inProcessLock): Db {
  return {
    all: async <T>(text: string, params: unknown[] = []) => (await raw(numberPlaceholders(text), params)).rows as T[],
    one: async <T>(text: string, params: unknown[] = []) => (await raw(numberPlaceholders(text), params)).rows[0] as T | undefined,
    run: async (text, params = []) => (await raw(numberPlaceholders(text), params)).affectedRows,
    exec: execRaw,
    tx: async <T>(fn: () => Promise<T>) => {
      if (txStorage.getStore()) return fn(); // already inside a transaction: join it
      // Both queries and exec run on the transaction's own connection (a second connection would wait on its locks).
      return transaction((q, exec) => txStorage.run(makeDb(q, exec, transaction, async () => undefined, tryLock), fn));
    },
    tryLock,
    close,
  };
}

async function openPglite(dataDir: string): Promise<Db> {
  const { PGlite, types } = await import("@electric-sql/pglite");
  if (dataDir !== "memory://") fs.mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite(dataDir, { parsers: { [types.INT8]: (v: string) => Number(v) } });
  const wrap = (query: (text: string, params: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }>): RawQuery => async (text, params) => {
    const r = await query(text, params);
    return { rows: r.rows, affectedRows: r.affectedRows ?? 0 };
  };
  return makeDb(
    wrap((text, params) => pg.query(text, params)),
    async (text) => {
      await pg.exec(text);
    },
    (fn) =>
      pg.transaction((t) =>
        fn(
          wrap((text, params) => t.query(text, params)),
          async (text) => {
            await t.exec(text);
          },
        ),
      ),
    () => pg.close(),
  );
}

async function openPostgres(url: string): Promise<Db> {
  const pg = (await import("pg")).default;
  pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  return makeDb(
    async (text, params) => {
      const r = await pool.query(text, params);
      return { rows: r.rows, affectedRows: r.rowCount ?? 0 };
    },
    async (text) => {
      await pool.query(text);
    },
    async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(
          async (text, params) => {
            const r = await client.query(text, params);
            return { rows: r.rows, affectedRows: r.rowCount ?? 0 };
          },
          async (text) => {
            await client.query(text);
          },
        );
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    () => pool.end(),
    // A session-level advisory lock on a dedicated connection, held for the duration of `fn`.
    async (key, fn) => {
      const client = await pool.connect();
      try {
        const { rows } = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [key]);
        if (!rows[0]?.locked) return null;
        try {
          return await fn();
        } finally {
          await client.query("SELECT pg_advisory_unlock($1)", [key]);
        }
      } finally {
        client.release();
      }
    },
  );
}

/** Opens a database and applies the (idempotent) schema. `memory://` gives a throwaway PGlite. */
export async function openDb(target: string): Promise<Db> {
  const isPostgres = /^postgres(ql)?:\/\//.test(target);
  const db = isPostgres ? await openPostgres(target) : await openPglite(target === "memory://" ? target : path.resolve(target));
  await db.exec(SCHEMA);
  return db;
}

const g = globalThis as unknown as { __disputeosDb?: Promise<Db> };

/** The current database: the enclosing transaction, else a scoped sandbox, else the app database. */
export async function getDb(): Promise<Db> {
  const scoped = txStorage.getStore() ?? scopeStorage.getStore();
  if (scoped) return scoped;
  g.__disputeosDb ??= openDb(config.databaseUrl ?? config.databasePath).catch((err: unknown) => {
    g.__disputeosDb = undefined; // let the next call retry instead of caching the failure
    throw err;
  });
  return g.__disputeosDb;
}

/** Runs `fn` against `db` instead of the app database (used to isolate eval scenarios). */
export function withDb<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  return scopeStorage.run(db, fn);
}

/** Runs `fn` detached from any enclosing transaction (for fire-and-forget background work). */
export function detached(fn: () => void): void {
  txStorage.exit(fn);
}

/** True inside `withDb` (the eval sandbox), where background anchoring must not run. */
export function inSandbox(): boolean {
  return scopeStorage.getStore() !== undefined;
}

/** Test hook: replace the app database. */
export function setDb(db: Db): void {
  g.__disputeosDb = Promise.resolve(db);
}

/** Runs `fn` in a transaction on the current database. */
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  return (await getDb()).tx(fn);
}

export function nowIso(): string {
  return new Date().toISOString();
}
