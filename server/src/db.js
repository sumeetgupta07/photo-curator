// db.js — v2.4
// PURPOSE: SQLite storage for Photo Curator backend.
// v2.4: added deleted_at + last_verified_at columns and helpers for the
//   deleted-photo detection feature (verifier.js).
// v2.3: added getAlbumSummaries() — returns Good/Bad/Duplicates album
//   metadata (count + cover uploadId) for the album drawer.

import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '..', 'data', 'photo-curator.db')

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

// 1. Core tables initialization
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    session_id       TEXT PRIMARY KEY,
    google_email     TEXT,
    refresh_token    TEXT NOT NULL,
    access_token     TEXT,
    access_token_exp INTEGER,
    created_at       INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at       INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS uploads (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id        TEXT NOT NULL,
    picker_session_id TEXT NOT NULL,
    picker_item_id    TEXT NOT NULL,
    filename          TEXT,
    file_size         INTEGER,
    creation_time     TEXT,
    mime_type         TEXT,
    status            TEXT NOT NULL DEFAULT 'pending',
    our_media_item_id TEXT,
    swipe_decision    TEXT,
    is_duplicate      INTEGER NOT NULL DEFAULT 0,
    duplicate_of_id   INTEGER,
    dhash             TEXT,
    exif_raw          TEXT,
    exif_date_taken   TEXT,
    exif_gps_lat      REAL,
    exif_gps_lon      REAL,
    exif_camera_make  TEXT,
    exif_camera_model TEXT,
    error_message     TEXT,
    retry_count       INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at        INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  
  CREATE TABLE IF NOT EXISTS user_albums (
    google_email TEXT,
    album_title  TEXT,
    album_id     TEXT,
    PRIMARY KEY (google_email, album_title)
  );
`)

// 2. Safe migrations for existing DBs (Ensures new columns exist)
const existingCols = db.prepare('PRAGMA table_info(uploads)').all().map(r => r.name)
const migrations = [
  ['swipe_decision',    'ALTER TABLE uploads ADD COLUMN swipe_decision TEXT'],
  ['our_media_item_id', 'ALTER TABLE uploads ADD COLUMN our_media_item_id TEXT'],
  ['is_duplicate',      'ALTER TABLE uploads ADD COLUMN is_duplicate INTEGER NOT NULL DEFAULT 0'],
  ['duplicate_of_id',   'ALTER TABLE uploads ADD COLUMN duplicate_of_id INTEGER'],
  ['dhash',             'ALTER TABLE uploads ADD COLUMN dhash TEXT'],
  ['exif_raw',          'ALTER TABLE uploads ADD COLUMN exif_raw TEXT'],
  ['exif_date_taken',   'ALTER TABLE uploads ADD COLUMN exif_date_taken TEXT'],
  ['exif_gps_lat',      'ALTER TABLE uploads ADD COLUMN exif_gps_lat REAL'],
  ['exif_gps_lon',      'ALTER TABLE uploads ADD COLUMN exif_gps_lon REAL'],
  ['exif_camera_make',  'ALTER TABLE uploads ADD COLUMN exif_camera_make TEXT'],
  ['exif_camera_model', 'ALTER TABLE uploads ADD COLUMN exif_camera_model TEXT'],
  ['error_message',     'ALTER TABLE uploads ADD COLUMN error_message TEXT'],
  ['retry_count',       'ALTER TABLE uploads ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0'],
  ['google_email', 'ALTER TABLE uploads ADD COLUMN google_email TEXT'],
  ['deleted_at',        'ALTER TABLE uploads ADD COLUMN deleted_at INTEGER'],
  ['last_verified_at',  'ALTER TABLE uploads ADD COLUMN last_verified_at INTEGER'],
]
for (const [col, sql] of migrations) {
  if (!existingCols.includes(col)) {
    try { db.exec(sql) } catch (e) { console.warn('[db] migration skipped:', e.message) }
  }
}

// 3. Create indexes ONLY AFTER tables are migrated
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_uploads_picker_session ON uploads(picker_session_id);
  CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status);
  CREATE INDEX IF NOT EXISTS idx_uploads_dedup ON uploads(filename, file_size, creation_time);
  CREATE INDEX IF NOT EXISTS idx_uploads_dhash ON uploads(dhash);
  CREATE INDEX IF NOT EXISTS idx_uploads_date_taken ON uploads(exif_date_taken);
  CREATE INDEX IF NOT EXISTS idx_uploads_decision ON uploads(swipe_decision);
  CREATE INDEX IF NOT EXISTS idx_uploads_deleted ON uploads(deleted_at);
  CREATE INDEX IF NOT EXISTS idx_uploads_verified ON uploads(last_verified_at);
`)

// ── Sessions ──────────────────────────────────────────────────────────────────

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
  db.prepare(`UPDATE sessions SET access_token = ?, access_token_exp = ?, updated_at = strftime('%s','now') WHERE session_id = ?`)
    .run(accessToken, accessTokenExp, sessionId)
}

export function getSession(sessionId) {
  return db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) || null
}

export function deleteSession(sessionId) {
  db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId)
}

// ── Uploads ───────────────────────────────────────────────────────────────────



export function findDuplicateUpload({ sessionId, filename, fileSize, creationTime }) {
  return db.prepare(`
    SELECT * FROM uploads
    WHERE session_id = ? AND filename = ? AND file_size = ? AND creation_time = ?
      AND status = 'done' AND our_media_item_id IS NOT NULL
    ORDER BY id ASC LIMIT 1
  `).get(sessionId, filename, fileSize, creationTime) || null
}

export function findDuplicateByHash(sessionId, dhash) {
  if (!dhash) return null
  return db.prepare(`
    SELECT * FROM uploads
    WHERE session_id = ? AND dhash = ? AND status = 'done' AND our_media_item_id IS NOT NULL
    ORDER BY id ASC LIMIT 1
  `).get(sessionId, dhash) || null
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

export function getReadyUploads(pickerSessionId) {
  return db.prepare(`
    SELECT * FROM uploads
    WHERE picker_session_id = ? AND status = 'done' AND our_media_item_id IS NOT NULL AND is_duplicate = 0
    ORDER BY id ASC
  `).all(pickerSessionId)
}

export function getUploadStatusCounts(pickerSessionId) {
  const rows = db.prepare(`SELECT status, COUNT(*) as count FROM uploads WHERE picker_session_id = ? GROUP BY status`).all(pickerSessionId)
  const counts = { pending: 0, downloading: 0, uploading: 0, done: 0, failed: 0 }
  for (const row of rows) counts[row.status] = row.count
  return counts
}

export function getUploadByOurMediaItemId(sessionId, ourMediaItemId) {
  return db.prepare(`SELECT * FROM uploads WHERE session_id = ? AND our_media_item_id = ? LIMIT 1`)
    .get(sessionId, ourMediaItemId) || null
}

export function setSwipeDecision(id, decision) {
  db.prepare(`UPDATE uploads SET swipe_decision = ?, updated_at = strftime('%s','now') WHERE id = ?`).run(decision, id)
}

export function getUploadIdsBySession(sessionId) {
  return db.prepare(`SELECT id FROM uploads WHERE session_id = ?`).all(sessionId).map(r => r.id)
}

// v2.3: album summaries for the album drawer
// Returns Good / Bad / Duplicates with count and cover (first uploadId)
export function getAlbumSummaries(sessionId) {
  const ALBUM_DECISIONS = [
    { key: 'good',      label: 'Good',       decision: 'good' },
    { key: 'bad',       label: 'Bad',        decision: 'bad'  },
    { key: 'duplicate', label: 'Duplicates', decision: null   }, // duplicates use is_duplicate flag
  ]

  return ALBUM_DECISIONS.map(({ key, label, decision }) => {
    let row
    if (key === 'duplicate') {
      row = db.prepare(`
        SELECT COUNT(*) as count, MIN(id) as cover_id
        FROM uploads WHERE session_id = ? AND is_duplicate = 1 AND status = 'done'
      `).get(sessionId)
    } else {
      row = db.prepare(`
        SELECT COUNT(*) as count, MIN(id) as cover_id
        FROM uploads WHERE session_id = ? AND swipe_decision = ? AND status = 'done' AND is_duplicate = 0
      `).get(sessionId, decision)
    }
    return { key, label, count: row?.count || 0, coverId: row?.cover_id || null }
  })
}
// --- ALBUM CACHING ---
export function getCachedAlbumId(email, title) {
  if (!email) return null;
  const row = db.prepare('SELECT album_id FROM user_albums WHERE google_email = ? AND album_title = ?').get(email, title)
  return row ? row.album_id : null
}

export function setCachedAlbumId(email, title, id) {
  if (!email) return;
  db.prepare('INSERT OR REPLACE INTO user_albums (google_email, album_title, album_id) VALUES (?, ?, ?)').run(email, title, id)
}

// --- SESSION PERSISTENCE FIX ---
// Update this function to look up by email so uploads survive logouts
export function getUploadsByUserEmail(email) {
  if (!email) return [];
  return db.prepare(`SELECT * FROM uploads WHERE google_email = ? ORDER BY creation_time ASC`).all(email)
}

// Modify createUploadRow to accept and save google_email
export function createUploadRow(sessionId, email, pickerSessionId, pickerItemId, mimeType) {
  const stmt = db.prepare(`
    INSERT INTO uploads (session_id, google_email, picker_session_id, picker_item_id, mime_type)
    VALUES (?, ?, ?, ?, ?)
  `)
  return stmt.run(sessionId, email, pickerSessionId, pickerItemId, mimeType).lastInsertRowid
}

// ── Verifier helpers (v2.4) ───────────────────────────────────────────────────

// Returns up to `limit` items due for verification for a given email.
// Eligible: done, not duplicate, not deleted, not verified in last 2 hours.
export function getItemsForVerification(email, limit = 10) {
  const twoHoursAgo = Math.floor(Date.now() / 1000) - 7200
  return db.prepare(`
    SELECT id, our_media_item_id FROM uploads
    WHERE google_email = ?
      AND status = 'done'
      AND our_media_item_id IS NOT NULL
      AND is_duplicate = 0
      AND deleted_at IS NULL
      AND (last_verified_at IS NULL OR last_verified_at < ?)
    ORDER BY last_verified_at ASC NULLS FIRST
    LIMIT ?
  `).all(email, twoHoursAgo, limit)
}

// Mark a single upload row as deleted.
export function markDeleted(id) {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    UPDATE uploads SET deleted_at = ?, last_verified_at = ?,
    updated_at = strftime('%s','now') WHERE id = ?
  `).run(now, now, id)
}

// Mark a single upload row as verified (still exists in Google Photos).
export function markVerified(id) {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    UPDATE uploads SET last_verified_at = ?,
    updated_at = strftime('%s','now') WHERE id = ?
  `).run(now, id)
}

// Purge rows deleted more than 15 days ago.
export function purgeOldDeleted(email) {
  const fifteenDaysAgo = Math.floor(Date.now() / 1000) - 15 * 24 * 3600
  const result = db.prepare(`
    DELETE FROM uploads
    WHERE google_email = ? AND deleted_at IS NOT NULL AND deleted_at < ?
  `).run(email, fifteenDaysAgo)
  if (result.changes > 0) console.log(`[db] purged ${result.changes} rows deleted >15 days ago for ${email}`)
}

// Returns all deleted (but not yet purged) items for a user, for the frontend.
export function getDeletedUploads(email) {
  return db.prepare(`
    SELECT * FROM uploads
    WHERE google_email = ? AND deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  `).all(email)
}

// Returns all unique google_email values that have active sessions —
// used by the cron job to know which accounts to verify.
export function getActiveUserEmails() {
  return db.prepare(`
    SELECT DISTINCT google_email FROM sessions
    WHERE google_email IS NOT NULL
  `).all().map(r => r.google_email)
}