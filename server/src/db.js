// db.js — v2.1
// PURPOSE: SQLite storage for Photo Curator backend.
// v2.1: added getUploadIdsByPickerSession for bulk thumbnail cleanup on
// session clear. All other schema and helpers unchanged from v2.0 Stage 3.

import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '..', 'data', 'photo-curator.db')

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    session_id      TEXT PRIMARY KEY,
    google_email     TEXT,
    refresh_token    TEXT NOT NULL,
    access_token     TEXT,
    access_token_exp INTEGER,
    created_at       INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at       INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS uploads (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id          TEXT NOT NULL,
    picker_session_id   TEXT NOT NULL,
    picker_item_id      TEXT NOT NULL,
    filename             TEXT,
    file_size            INTEGER,
    creation_time         TEXT,
    mime_type            TEXT,
    status               TEXT NOT NULL DEFAULT 'pending',  -- pending|downloading|uploading|done|failed
    our_media_item_id     TEXT,
    swipe_decision        TEXT,                              -- 'good'|'bad'|'skip'|null — set when user swipes
    is_duplicate          INTEGER NOT NULL DEFAULT 0,        -- 1 if dedup-matched an existing upload instead of re-downloading
    duplicate_of_id        INTEGER,                            -- uploads.id this was deduped against, if any
    exif_raw              TEXT,                                -- full parsed EXIF as JSON
    exif_date_taken        TEXT,
    exif_gps_lat            REAL,
    exif_gps_lon            REAL,
    exif_camera_make        TEXT,
    exif_camera_model       TEXT,
    error_message          TEXT,
    retry_count            INTEGER NOT NULL DEFAULT 0,
    created_at             INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at             INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_uploads_picker_session ON uploads(picker_session_id);
  CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status);
  CREATE INDEX IF NOT EXISTS idx_uploads_dedup ON uploads(filename, file_size, creation_time);
  CREATE INDEX IF NOT EXISTS idx_uploads_date_taken ON uploads(exif_date_taken);
`)

export function saveSession(sessionId, { googleEmail, refreshToken, accessToken, accessTokenExp }) {
  db.prepare(`
    INSERT INTO sessions (session_id, google_email, refresh_token, access_token, access_token_exp, updated_at)
    VALUES (@sessionId, @googleEmail, @refreshToken, @accessToken, @accessTokenExp, strftime('%s','now'))
    ON CONFLICT(session_id) DO UPDATE SET
      google_email = excluded.google_email,
      refresh_token = excluded.refresh_token,
      access_token = excluded.access_token,
      access_token_exp = excluded.access_token_exp,
      updated_at = strftime('%s','now')
  `).run({ sessionId, googleEmail: googleEmail || null, refreshToken, accessToken: accessToken || null, accessTokenExp: accessTokenExp || null })
}

export function updateAccessToken(sessionId, accessToken, accessTokenExp) {
  db.prepare(`
    UPDATE sessions SET access_token = ?, access_token_exp = ?, updated_at = strftime('%s','now')
    WHERE session_id = ?
  `).run(accessToken, accessTokenExp, sessionId)
}

export function getSession(sessionId) {
  return db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) || null
}

export function deleteSession(sessionId) {
  db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId)
}

// ── Uploads table (Stage 2) ────────────────────────────────────────────────────

export function createUploadRow({ sessionId, pickerSessionId, pickerItemId, filename, fileSize, creationTime, mimeType }) {
  const result = db.prepare(`
    INSERT INTO uploads (session_id, picker_session_id, picker_item_id, filename, file_size, creation_time, mime_type, status)
    VALUES (@sessionId, @pickerSessionId, @pickerItemId, @filename, @fileSize, @creationTime, @mimeType, 'pending')
  `).run({ sessionId, pickerSessionId, pickerItemId, filename, fileSize, creationTime, mimeType })
  return result.lastInsertRowid
}

export function findDuplicateUpload({ sessionId, filename, fileSize, creationTime }) {
  // Dedup key: filename + file_size + creation_time, scoped to this user's
  // session (so two different Google accounts on the same backend never
  // cross-match). Only matches against rows that completed successfully —
  // a failed or in-progress row isn't a valid dedup target.
  return db.prepare(`
    SELECT * FROM uploads
    WHERE session_id = ? AND filename = ? AND file_size = ? AND creation_time = ?
      AND status = 'done' AND our_media_item_id IS NOT NULL
    ORDER BY id ASC LIMIT 1
  `).get(sessionId, filename, fileSize, creationTime) || null
}

export function updateUploadStatus(id, status, extra = {}) {
  const fields = ['status = @status', "updated_at = strftime('%s','now')"]
  const params = { id, status, ...extra }
  for (const key of Object.keys(extra)) fields.push(`${key} = @${key}`)
  db.prepare(`UPDATE uploads SET ${fields.join(', ')} WHERE id = @id`).run(params)
}

export function incrementRetryCount(id) {
  db.prepare(`UPDATE uploads SET retry_count = retry_count + 1, updated_at = strftime('%s','now') WHERE id = ?`).run(id)
}

export function getUploadRow(id) {
  return db.prepare('SELECT * FROM uploads WHERE id = ?').get(id) || null
}

export function getPendingUploads(limit = 50) {
  return db.prepare(`SELECT * FROM uploads WHERE status = 'pending' ORDER BY id ASC LIMIT ?`).all(limit)
}

export function getUploadsByPickerSession(pickerSessionId) {
  return db.prepare('SELECT * FROM uploads WHERE picker_session_id = ? ORDER BY id ASC').all(pickerSessionId)
}

export function getReadyUploads(pickerSessionId) {
  return db.prepare(`
    SELECT * FROM uploads WHERE picker_session_id = ? AND status = 'done' AND our_media_item_id IS NOT NULL
    ORDER BY id ASC
  `).all(pickerSessionId)
}

export function getUploadStatusCounts(pickerSessionId) {
  const rows = db.prepare(`
    SELECT status, COUNT(*) as count FROM uploads WHERE picker_session_id = ? GROUP BY status
  `).all(pickerSessionId)
  const counts = { pending: 0, downloading: 0, uploading: 0, done: 0, failed: 0 }
  for (const row of rows) counts[row.status] = row.count
  return counts
}

export function getUploadByOurMediaItemId(sessionId, ourMediaItemId) {
  return db.prepare(`
    SELECT * FROM uploads WHERE session_id = ? AND our_media_item_id = ? LIMIT 1
  `).get(sessionId, ourMediaItemId) || null
}

export function setSwipeDecision(id, decision) {
  db.prepare(`
    UPDATE uploads SET swipe_decision = ?, updated_at = strftime('%s','now') WHERE id = ?
  `).run(decision, id)
}

// v2.1: returns all upload IDs for a session — used for bulk thumbnail cleanup
export function getUploadIdsBySession(sessionId) {
  return db.prepare(`SELECT id FROM uploads WHERE session_id = ?`).all(sessionId).map(r => r.id)
}
