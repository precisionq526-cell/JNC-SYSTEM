import 'server-only'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'

interface Statement { get(...values: unknown[]): Record<string, unknown> | undefined; all(...values: unknown[]): Record<string, unknown>[]; run(...values: unknown[]): { changes: number | bigint } }
interface LocalDatabase { exec(sql: string): void; prepare(sql: string): Statement }
const state = globalThis as typeof globalThis & { sopDatabase?: LocalDatabase }
export function runtimePath() { return process.env.KIOSK_RUNTIME_PATH || path.join(process.env.KIOSK_LOCAL_PATH || 'C:\\KioskFiles', '.runtime') }
export function localDatabase() {
  if (state.sopDatabase) return state.sopDatabase
  const folder = runtimePath(); fs.mkdirSync(folder, { recursive: true })
  const db = new DatabaseSync(path.join(folder, 'sop.sqlite'))
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS quotes(id TEXT PRIMARY KEY,payload TEXT NOT NULL,expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS local_orders(id TEXT PRIMARY KEY,payload TEXT NOT NULL,cloud_updated_at TEXT,pending INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,synced_at TEXT,error TEXT);`)
  state.sopDatabase = db; return db
}
export function cacheValue(key: string, value: unknown) {
  localDatabase().prepare('INSERT INTO kv VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(key, JSON.stringify(value), new Date().toISOString())
}
export function cachedValue<T>(key: string): { value: T; updatedAt: string } | null {
  const row = localDatabase().prepare('SELECT value,updated_at FROM kv WHERE key=?').get(key)
  return row ? { value: JSON.parse(String(row.value)), updatedAt: String(row.updated_at) } : null
}
export function localSecret() {
  const db = localDatabase(), existing = cachedValue<string>('local-signing-key')
  if (existing) return existing.value
  db.prepare('INSERT OR IGNORE INTO kv VALUES(?,?,?)').run('local-signing-key', JSON.stringify(randomBytes(32).toString('base64url')), new Date().toISOString())
  return cachedValue<string>('local-signing-key')!.value
}
