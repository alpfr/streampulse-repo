import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = join(DATA_DIR, "streampulse.db");

let db = null;

export async function initDB() {
  db = new Database(DB_PATH);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS weekly_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT, service TEXT NOT NULL, date TEXT NOT NULL, month TEXT NOT NULL,
      platforms TEXT DEFAULT '{}', total INTEGER DEFAULT 0, UNIQUE(service, date)
    );
    CREATE TABLE IF NOT EXISTS special_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, dates_label TEXT NOT NULL, UNIQUE(name, dates_label)
    );
    CREATE TABLE IF NOT EXISTS special_event_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL REFERENCES special_events(id) ON DELETE CASCADE,
      date TEXT NOT NULL, platforms TEXT DEFAULT '{}', total INTEGER DEFAULT 0, UNIQUE(event_id, date)
    );
    CREATE TABLE IF NOT EXISTS upload_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      mode TEXT NOT NULL, rows_added INTEGER DEFAULT 0, rows_updated INTEGER DEFAULT 0, rows_total INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS ai_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT, generated_at TEXT NOT NULL DEFAULT (datetime('now')),
      trigger_type TEXT NOT NULL DEFAULT 'upload', summary TEXT NOT NULL, highlights TEXT,
      alerts TEXT, raw_prompt_tokens INTEGER DEFAULT 0, raw_completion_tokens INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_weekly_service ON weekly_data(service);
    CREATE INDEX IF NOT EXISTS idx_weekly_date ON weekly_data(date);
  `);

  return db;
}

export function getConfig(key) {
  const row = db.prepare("SELECT value FROM config WHERE key=?").get(key);
  return row ? JSON.parse(row.value) : null;
}

export function setConfig(key, value) {
  db.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=?").run(key, JSON.stringify(value), JSON.stringify(value));
}

const COLS = "service, date, month, platforms, total";
function rowVals(r) {
  return [r.service, r.date, r.month || r.date.slice(0, 7), JSON.stringify(r.platforms || {}), r.total || 0];
}
function updateVals(r) {
  return [r.month || r.date.slice(0, 7), JSON.stringify(r.platforms || {}), r.total || 0];
}

export function upsertWeeklyBatch(rows) {
  let added = 0, updated = 0;

  const checkStmt = db.prepare("SELECT id FROM weekly_data WHERE service=? AND date=?");
  const upsertStmt = db.prepare(`
    INSERT INTO weekly_data (${COLS}) VALUES (?,?,?,?,?)
    ON CONFLICT(service,date) DO UPDATE SET month=?,platforms=?,total=?
  `);

  const transaction = db.transaction((rowsToInsert) => {
    for (const row of rowsToInsert) {
      const existing = checkStmt.get(row.service, row.date);
      upsertStmt.run([...rowVals(row), ...updateVals(row)]);
      if (existing) updated++; else added++;
    }
  });

  transaction(rows);
  return { added, updated };
}

export function replaceAllWeekly(rows) {
  const deleteStmt = db.prepare("DELETE FROM weekly_data");
  const insertStmt = db.prepare(`INSERT INTO weekly_data (${COLS}) VALUES (?,?,?,?,?)`);

  const transaction = db.transaction((rowsToInsert) => {
    deleteStmt.run();
    for (const row of rowsToInsert) {
      insertStmt.run(rowVals(row));
    }
  });

  transaction(rows);
  return { added: rows.length, updated: 0 };
}

export function getWeeklyData() {
  const rows = db.prepare("SELECT * FROM weekly_data ORDER BY service, date ASC").all();
  const grouped = {};
  for (const r of rows) {
    r.platforms = JSON.parse(r.platforms || "{}");
    if (!grouped[r.service]) grouped[r.service] = [];
    grouped[r.service].push(r);
  }
  return grouped;
}

export function getWeeklyByService(svc) {
  const rows = db.prepare("SELECT * FROM weekly_data WHERE service=? ORDER BY date ASC").all(svc);
  return rows.map(r => ({ ...r, platforms: JSON.parse(r.platforms || "{}") }));
}

export function upsertSpecialEvent(ev) {
  db.prepare(`INSERT INTO special_events (name,dates_label) VALUES (?,?) ON CONFLICT(name,dates_label) DO UPDATE SET name=name`).run(ev.name, ev.dates);
  const row = db.prepare("SELECT id FROM special_events WHERE name=? AND dates_label=?").get(ev.name, ev.dates);
  const eid = row.id;

  const insertStmt = db.prepare(`
    INSERT INTO special_event_data (event_id,date,platforms,total)
    VALUES (?,?,?,?) ON CONFLICT(event_id,date) DO UPDATE SET
    platforms=?,total=?
  `);

  const transaction = db.transaction((eventData) => {
    for (const d of eventData) {
      const pJson = JSON.stringify(d.platforms || {});
      const vals = [eid, d.date, pJson, d.total || 0];
      const uvals = [pJson, d.total || 0];
      insertStmt.run([...vals, ...uvals]);
    }
  });

  transaction(ev.data);
}

export function replaceAllEvents(events) {
  const deleteData = db.prepare("DELETE FROM special_event_data");
  const deleteEvents = db.prepare("DELETE FROM special_events");

  const transaction = db.transaction((evs) => {
    deleteData.run();
    deleteEvents.run();
    for (const ev of evs) upsertSpecialEvent(ev);
  });

  transaction(events);
}

export function getSpecialEvents() {
  const events = db.prepare("SELECT * FROM special_events ORDER BY id ASC").all();
  const dataStmt = db.prepare("SELECT * FROM special_event_data WHERE event_id=? ORDER BY date ASC");

  return events.map(ev => ({
    id: ev.id, name: ev.name, dates: ev.dates_label,
    data: dataStmt.all(ev.id).map(d => ({ ...d, platforms: JSON.parse(d.platforms || "{}") })),
  }));
}

export function logUpload(info) {
  db.prepare("INSERT INTO upload_history (filename,mode,rows_added,rows_updated,rows_total) VALUES (?,?,?,?,?)")
    .run(info.filename, info.mode, info.rows_added, info.rows_updated, info.rows_total);
}

export function getUploadHistory() {
  return db.prepare("SELECT * FROM upload_history ORDER BY uploaded_at DESC LIMIT 20").all();
}

export function getStats() {
  return {
    weeklyRows: db.prepare("SELECT COUNT(*) as c FROM weekly_data").get()?.c || 0,
    specialEvents: db.prepare("SELECT COUNT(*) as c FROM special_events").get()?.c || 0,
  };
}

export function deleteServiceData(svc) {
  db.prepare("DELETE FROM weekly_data WHERE service=?").run(svc);
}

/* ── AI Insights ───────────────────────────────────────────────────── */
export function saveInsight({ trigger_type, summary, highlights, alerts, prompt_tokens, completion_tokens }) {
  db.prepare(`INSERT INTO ai_insights (trigger_type, summary, highlights, alerts, raw_prompt_tokens, raw_completion_tokens)
    VALUES (?,?,?,?,?,?)`).run(trigger_type || "upload", summary, highlights || "[]", alerts || "[]", prompt_tokens || 0, completion_tokens || 0);
}

export function getLatestInsight() {
  return db.prepare("SELECT * FROM ai_insights ORDER BY generated_at DESC LIMIT 1").get();
}

export function getInsightHistory(limit = 10) {
  return db.prepare("SELECT id, generated_at, trigger_type, summary FROM ai_insights ORDER BY generated_at DESC LIMIT ?").all(limit);
}
