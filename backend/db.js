/**
 * Photo Curator v3.0.0 — db.js
 * Purpose: SQLite schema and all DB access functions for v3.
 *          Clean slate — no migration from v2.7.
 *          Tables: library_items, duplicate_groups, month_albums,
 *                  scan_state, trash_queue, extension_queue, pwa_sessions
 *
 * Changelog:
 *   v3.0.0 — Complete rewrite for v3 architecture. Removed uploads/sessions tables.
 *             Added library_items, duplicate_groups, month_albums, scan_state,
 *             trash_queue, extension_queue, pwa_sessions.
 */

'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || '/app/data/photo-curator.db';

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS library_items (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    media_key             TEXT    NOT NULL UNIQUE,
    dedup_key             TEXT,
    filename              TEXT,
    mime_type             TEXT,
    creation_timestamp    INTEGER,
    upload_timestamp      INTEGER,
    month_key             TEXT,
    is_live_photo         INTEGER NOT NULL DEFAULT 0,
    live_photo_duration_ms INTEGER,
    is_archived           INTEGER NOT NULL DEFAULT 0,
    is_favorite           INTEGER NOT NULL DEFAULT 0,
    file_size             INTEGER,
    thumb_w400_cached     INTEGER NOT NULL DEFAULT 0,
    thumb_w1600_cached    INTEGER NOT NULL DEFAULT 0,
    embedding             BLOB,
    dhash                 TEXT,
    decision              TEXT,
    duplicate_group_id    INTEGER REFERENCES duplicate_groups(id),
    keep_in_group         INTEGER NOT NULL DEFAULT 0,
    trash_queued_at       INTEGER,
    trashed_at            INTEGER,
    album_queued_at       INTEGER,
    album_written_at      INTEGER,
    scan_error            TEXT,
    created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at            INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS duplicate_groups (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    similarity_score  REAL,
    detection_method  TEXT NOT NULL DEFAULT 'embedding',
    resolved          INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS month_albums (
    month_key         TEXT PRIMARY KEY,
    google_album_id   TEXT,
    item_count        INTEGER NOT NULL DEFAULT 0,
    decided_count     INTEGER NOT NULL DEFAULT 0,
    populated         INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS scan_state (
    id                INTEGER PRIMARY KEY DEFAULT 1,
    cursor            TEXT,
    total_estimated   INTEGER NOT NULL DEFAULT 0,
    total_scanned     INTEGER NOT NULL DEFAULT 0,
    duplicates_found  INTEGER NOT NULL DEFAULT 0,
    last_complete_month TEXT,
    scan_started_at   INTEGER,
    last_scanned_at   INTEGER,
    scan_complete     INTEGER NOT NULL DEFAULT 0
  );

  INSERT OR IGNORE INTO scan_state (id) VALUES (1);

  CREATE TABLE IF NOT EXISTS trash_queue (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    media_key   TEXT NOT NULL,
    dedup_key   TEXT NOT NULL,
    decision    TEXT NOT NULL,
    queued_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    executed_at INTEGER,
    error       TEXT
  );

  CREATE TABLE IF NOT EXISTS extension_queue (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    media_key   TEXT NOT NULL,
    action      TEXT NOT NULL,
    payload     TEXT,
    queued_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    executed_at INTEGER,
    error       TEXT
  );

  CREATE TABLE IF NOT EXISTS pwa_sessions (
    session_id  TEXT PRIMARY KEY,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    last_seen   INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS extension_heartbeat (
    id          INTEGER PRIMARY KEY DEFAULT 1,
    version     TEXT,
    last_seen   INTEGER NOT NULL DEFAULT 0
  );

  INSERT OR IGNORE INTO extension_heartbeat (id) VALUES (1);

  CREATE INDEX IF NOT EXISTS idx_library_month_key       ON library_items(month_key);
  CREATE INDEX IF NOT EXISTS idx_library_decision        ON library_items(decision);
  CREATE INDEX IF NOT EXISTS idx_library_dhash           ON library_items(dhash);
  CREATE INDEX IF NOT EXISTS idx_library_duplicate_group ON library_items(duplicate_group_id);
  CREATE INDEX IF NOT EXISTS idx_library_creation_ts     ON library_items(creation_timestamp);
  CREATE INDEX IF NOT EXISTS idx_library_trashed         ON library_items(trashed_at);
  CREATE INDEX IF NOT EXISTS idx_library_dedup_key       ON library_items(dedup_key);
  CREATE INDEX IF NOT EXISTS idx_trash_executed          ON trash_queue(executed_at);
  CREATE INDEX IF NOT EXISTS idx_ext_queue_executed      ON extension_queue(executed_at);
`);

// ---------------------------------------------------------------------------
// Scan state
// ---------------------------------------------------------------------------

function getScanState() {
  return db.prepare('SELECT * FROM scan_state WHERE id = 1').get();
}

function updateScanState(fields) {
  const sets = Object.keys(fields).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE scan_state SET ${sets}, last_scanned_at = unixepoch() WHERE id = 1`)
    .run(fields);
}

// ---------------------------------------------------------------------------
// Library items — upsert batch
// ---------------------------------------------------------------------------

const upsertItem = db.prepare(`
  INSERT INTO library_items (
    media_key, dedup_key, filename, mime_type,
    creation_timestamp, upload_timestamp, month_key,
    is_live_photo, live_photo_duration_ms,
    is_archived, is_favorite, file_size,
    dhash, embedding, scan_error
  ) VALUES (
    @media_key, @dedup_key, @filename, @mime_type,
    @creation_timestamp, @upload_timestamp, @month_key,
    @is_live_photo, @live_photo_duration_ms,
    @is_archived, @is_favorite, @file_size,
    @dhash, @embedding, @scan_error
  )
  ON CONFLICT(media_key) DO UPDATE SET
    dedup_key             = COALESCE(excluded.dedup_key, dedup_key),
    filename              = COALESCE(excluded.filename, filename),
    mime_type             = COALESCE(excluded.mime_type, mime_type),
    creation_timestamp    = COALESCE(excluded.creation_timestamp, creation_timestamp),
    upload_timestamp      = COALESCE(excluded.upload_timestamp, upload_timestamp),
    month_key             = COALESCE(excluded.month_key, month_key),
    is_live_photo         = excluded.is_live_photo,
    live_photo_duration_ms = COALESCE(excluded.live_photo_duration_ms, live_photo_duration_ms),
    is_archived           = excluded.is_archived,
    is_favorite           = excluded.is_favorite,
    file_size             = COALESCE(excluded.file_size, file_size),
    dhash                 = COALESCE(excluded.dhash, dhash),
    embedding             = COALESCE(excluded.embedding, embedding),
    scan_error            = excluded.scan_error,
    updated_at            = unixepoch()
`);

function upsertLibraryBatch(items) {
  const insert = db.transaction((items) => {
    for (const item of items) {
      upsertItem.run({
        media_key:             item.mediaKey,
        dedup_key:             item.dedupKey             ?? null,
        filename:              item.filename             ?? null,
        mime_type:             item.mimeType             ?? null,
        creation_timestamp:    item.creationTimestamp    ?? null,
        upload_timestamp:      item.uploadTimestamp      ?? null,
        month_key:             item.monthKey             ?? null,
        is_live_photo:         item.isLivePhoto ? 1 : 0,
        live_photo_duration_ms:item.livePhotoDurationMs  ?? null,
        is_archived:           item.isArchived  ? 1 : 0,
        is_favorite:           item.isFavorite  ? 1 : 0,
        file_size:             item.fileSize             ?? null,
        dhash:                 item.dhash                ?? null,
        embedding:             item.embedding            ?? null,
        scan_error:            item.scanError            ?? null,
      });
    }
  });
  insert(items);
}

// ---------------------------------------------------------------------------
// Thumbnail cache tracking
// ---------------------------------------------------------------------------

function markThumbCached(mediaKey, size) {
  const col = size === 'w400' ? 'thumb_w400_cached' : 'thumb_w1600_cached';
  db.prepare(`UPDATE library_items SET ${col} = 1, updated_at = unixepoch()
              WHERE media_key = ?`).run(mediaKey);
}

// ---------------------------------------------------------------------------
// Month album stats — recompute after each batch
// ---------------------------------------------------------------------------

function upsertMonthStats(monthKey) {
  const count = db.prepare(
    `SELECT COUNT(*) AS n FROM library_items WHERE month_key = ?`
  ).get(monthKey)?.n ?? 0;

  const decided = db.prepare(
    `SELECT COUNT(*) AS n FROM library_items
     WHERE month_key = ? AND decision IS NOT NULL`
  ).get(monthKey)?.n ?? 0;

  db.prepare(`
    INSERT INTO month_albums (month_key, item_count, decided_count)
    VALUES (?, ?, ?)
    ON CONFLICT(month_key) DO UPDATE SET
      item_count    = excluded.item_count,
      decided_count = excluded.decided_count,
      updated_at    = unixepoch()
  `).run(monthKey, count, decided);
}

// ---------------------------------------------------------------------------
// Duplicate detection (called after each batch by index.js)
// ---------------------------------------------------------------------------

function getDHashCandidates(dhash, excludeMediaKey) {
  // Return items with same dhash (exact match for Phase 1; Hamming in Phase 2)
  return db.prepare(`
    SELECT id, media_key, dhash, embedding, is_live_photo, file_size,
           creation_timestamp, duplicate_group_id
    FROM library_items
    WHERE dhash = ? AND media_key != ? AND duplicate_group_id IS NULL
  `).all(dhash, excludeMediaKey);
}

function createDuplicateGroup(similarityScore, method) {
  const result = db.prepare(`
    INSERT INTO duplicate_groups (similarity_score, detection_method)
    VALUES (?, ?)
  `).run(similarityScore, method);
  return result.lastInsertRowid;
}

function assignDuplicateGroup(mediaKey, groupId, keepInGroup) {
  db.prepare(`
    UPDATE library_items
    SET duplicate_group_id = ?, keep_in_group = ?, updated_at = unixepoch()
    WHERE media_key = ?
  `).run(groupId, keepInGroup ? 1 : 0, mediaKey);
}

// ---------------------------------------------------------------------------
// Swipe decisions
// ---------------------------------------------------------------------------

function recordDecision(mediaKey, decision) {
  db.prepare(`
    UPDATE library_items
    SET decision = ?, updated_at = unixepoch()
    WHERE media_key = ?
  `).run(decision, mediaKey);

  // Update month stats
  const item = db.prepare(
    'SELECT month_key FROM library_items WHERE media_key = ?'
  ).get(mediaKey);
  if (item?.month_key) upsertMonthStats(item.month_key);
}

function getDecisionsForMonth(monthKey) {
  return db.prepare(`
    SELECT media_key, decision FROM library_items
    WHERE month_key = ? AND decision IS NOT NULL
  `).all(monthKey);
}

// ---------------------------------------------------------------------------
// Trash queue
// ---------------------------------------------------------------------------

function enqueueTrash(mediaKey, dedupKey, decision) {
  // Idempotent — skip if already queued
  const existing = db.prepare(
    'SELECT id FROM trash_queue WHERE media_key = ? AND executed_at IS NULL'
  ).get(mediaKey);
  if (existing) return;

  db.prepare(`
    INSERT INTO trash_queue (media_key, dedup_key, decision)
    VALUES (?, ?, ?)
  `).run(mediaKey, dedupKey, decision);

  db.prepare(`
    UPDATE library_items SET trash_queued_at = unixepoch(), updated_at = unixepoch()
    WHERE media_key = ?
  `).run(mediaKey);
}

function getPendingTrashQueue() {
  return db.prepare(`
    SELECT tq.id, tq.media_key, tq.dedup_key, tq.decision
    FROM trash_queue tq
    WHERE tq.executed_at IS NULL
    ORDER BY tq.queued_at ASC
    LIMIT 50
  `).all();
}

function confirmTrashExecuted(ids) {
  const update = db.transaction((ids) => {
    for (const id of ids) {
      const row = db.prepare(
        'SELECT media_key FROM trash_queue WHERE id = ?'
      ).get(id);
      if (!row) continue;

      db.prepare(
        'UPDATE trash_queue SET executed_at = unixepoch() WHERE id = ?'
      ).run(id);
      db.prepare(`
        UPDATE library_items
        SET trashed_at = unixepoch(), updated_at = unixepoch()
        WHERE media_key = ?
      `).run(row.media_key);
    }
  });
  update(ids);
}

function markTrashError(id, error) {
  db.prepare('UPDATE trash_queue SET error = ? WHERE id = ?').run(error, id);
}

// ---------------------------------------------------------------------------
// Extension queue (Good album writes)
// ---------------------------------------------------------------------------

function enqueueAlbumWrite(mediaKey, albumId) {
  const existing = db.prepare(
    `SELECT id FROM extension_queue
     WHERE media_key = ? AND action = 'addToAlbum' AND executed_at IS NULL`
  ).get(mediaKey);
  if (existing) return;

  db.prepare(`
    INSERT INTO extension_queue (media_key, action, payload)
    VALUES (?, 'addToAlbum', ?)
  `).run(mediaKey, JSON.stringify({ albumId }));

  db.prepare(`
    UPDATE library_items SET album_queued_at = unixepoch(), updated_at = unixepoch()
    WHERE media_key = ?
  `).run(mediaKey);
}

function getPendingAlbumQueue() {
  return db.prepare(`
    SELECT id, media_key, payload
    FROM extension_queue
    WHERE action = 'addToAlbum' AND executed_at IS NULL
    ORDER BY queued_at ASC
    LIMIT 50
  `).all();
}

function confirmAlbumWritten(ids) {
  const update = db.transaction((ids) => {
    for (const id of ids) {
      const row = db.prepare(
        'SELECT media_key FROM extension_queue WHERE id = ?'
      ).get(id);
      if (!row) continue;
      db.prepare(
        'UPDATE extension_queue SET executed_at = unixepoch() WHERE id = ?'
      ).run(id);
      db.prepare(`
        UPDATE library_items
        SET album_written_at = unixepoch(), updated_at = unixepoch()
        WHERE media_key = ?
      `).run(row.media_key);
    }
  });
  update(ids);
}

// ---------------------------------------------------------------------------
// Library reads for PWA
// ---------------------------------------------------------------------------

function getMonthList() {
  return db.prepare(`
    SELECT
      ma.month_key,
      ma.item_count,
      ma.decided_count,
      (ma.item_count - ma.decided_count) AS undecided_count,
      ma.populated,
      (SELECT COUNT(*) FROM library_items li
       WHERE li.month_key = ma.month_key
         AND li.thumb_w400_cached = 1) AS thumbs_ready
    FROM month_albums ma
    ORDER BY ma.month_key ASC
  `).all();
}

function getItemsForMonth(monthKey) {
  return db.prepare(`
    SELECT
      id, media_key, dedup_key, filename, mime_type,
      creation_timestamp, month_key,
      is_live_photo, is_favorite, is_archived,
      file_size, dhash, decision,
      duplicate_group_id, keep_in_group,
      thumb_w400_cached, thumb_w1600_cached,
      trashed_at, trash_queued_at
    FROM library_items
    WHERE month_key = ? AND trashed_at IS NULL
    ORDER BY creation_timestamp ASC
  `).all(monthKey);
}

function getDuplicateGroups(resolvedFilter) {
  const resolved = resolvedFilter === true ? 1 : 0;
  const groups = db.prepare(`
    SELECT id, similarity_score, detection_method, resolved
    FROM duplicate_groups
    WHERE resolved = ?
    ORDER BY id ASC
  `).all(resolved);

  return groups.map(g => ({
    ...g,
    items: db.prepare(`
      SELECT media_key, filename, is_live_photo, file_size,
             creation_timestamp, keep_in_group, decision,
             thumb_w400_cached
      FROM library_items
      WHERE duplicate_group_id = ?
      ORDER BY keep_in_group DESC, file_size DESC
    `).all(g.id)
  }));
}

// ---------------------------------------------------------------------------
// Extension heartbeat
// ---------------------------------------------------------------------------

function updateHeartbeat(version) {
  db.prepare(`
    UPDATE extension_heartbeat SET version = ?, last_seen = unixepoch() WHERE id = 1
  `).run(version ?? null);
}

function getHeartbeat() {
  return db.prepare('SELECT * FROM extension_heartbeat WHERE id = 1').get();
}

// ---------------------------------------------------------------------------
// PWA sessions (password auth)
// ---------------------------------------------------------------------------

function createPwaSession(sessionId) {
  db.prepare(`
    INSERT OR REPLACE INTO pwa_sessions (session_id, created_at, last_seen)
    VALUES (?, unixepoch(), unixepoch())
  `).run(sessionId);
}

function touchPwaSession(sessionId) {
  db.prepare(
    'UPDATE pwa_sessions SET last_seen = unixepoch() WHERE session_id = ?'
  ).run(sessionId);
}

function getPwaSession(sessionId) {
  return db.prepare(
    'SELECT * FROM pwa_sessions WHERE session_id = ?'
  ).get(sessionId);
}

function deletePwaSession(sessionId) {
  db.prepare('DELETE FROM pwa_sessions WHERE session_id = ?').run(sessionId);
}

// ---------------------------------------------------------------------------
// Month albums (GPTK album builder)
// ---------------------------------------------------------------------------

function upsertMonthAlbum(monthKey, googleAlbumId) {
  db.prepare(`
    INSERT INTO month_albums (month_key, google_album_id)
    VALUES (?, ?)
    ON CONFLICT(month_key) DO UPDATE SET
      google_album_id = excluded.google_album_id,
      updated_at = unixepoch()
  `).run(monthKey, googleAlbumId);
}

function markMonthPopulated(monthKey) {
  db.prepare(`
    UPDATE month_albums SET populated = 1, updated_at = unixepoch()
    WHERE month_key = ?
  `).run(monthKey);
}

function getAlbumProgress() {
  return db.prepare(`
    SELECT month_key, google_album_id, item_count, populated
    FROM month_albums
    ORDER BY month_key ASC
  `).all();
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  db,
  // Scan
  getScanState,
  updateScanState,
  // Library
  upsertLibraryBatch,
  markThumbCached,
  upsertMonthStats,
  getDHashCandidates,
  createDuplicateGroup,
  assignDuplicateGroup,
  // Decisions
  recordDecision,
  getDecisionsForMonth,
  // Trash
  enqueueTrash,
  getPendingTrashQueue,
  confirmTrashExecuted,
  markTrashError,
  // Album queue
  enqueueAlbumWrite,
  getPendingAlbumQueue,
  confirmAlbumWritten,
  // PWA reads
  getMonthList,
  getItemsForMonth,
  getDuplicateGroups,
  // Month albums
  upsertMonthAlbum,
  markMonthPopulated,
  getAlbumProgress,
  // Heartbeat
  updateHeartbeat,
  getHeartbeat,
  // Auth
  createPwaSession,
  touchPwaSession,
  getPwaSession,
  deletePwaSession,
};
