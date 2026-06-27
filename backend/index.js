/**
 * Photo Curator v3.0.0 — index.js
 * Purpose: Express server — all routes for Phase 1.
 *          Covers: extension scan/batch, thumbs, heartbeat, trash-queue,
 *          PWA auth (password), library reads, swipe decisions.
 *          No OAuth. No Picker API. No re-upload pipeline.
 *
 * Changelog:
 *   v3.0.0 — Complete rewrite. Removed all v2.7 OAuth/Picker/upload routes.
 *             Added extension routes (X-Ext-Secret), PWA password auth,
 *             library/swipe/trash endpoints.
 */

'use strict';

const express    = require('express');
const cors       = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt     = require('bcrypt');
const crypto     = require('crypto');
const path       = require('path');
const fs         = require('fs');
const multer     = require('multer');

const db = require('./db');

const app  = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------

const EXT_SECRET       = process.env.EXT_SECRET;
const CURATOR_PASSWORD = process.env.CURATOR_PASSWORD;
const THUMBS_DIR       = process.env.THUMBS_DIR || '/app/data/thumbs';
const ALLOWED_ORIGINS  = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);

if (!EXT_SECRET)       console.warn('[WARN] EXT_SECRET not set — extension routes unprotected!');
if (!CURATOR_PASSWORD) console.warn('[WARN] CURATOR_PASSWORD not set — PWA login disabled!');

fs.mkdirSync(THUMBS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // same-origin / curl
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    if (origin.startsWith('chrome-extension://')) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// ---------------------------------------------------------------------------
// Auth middleware factories
// ---------------------------------------------------------------------------

/** Validates X-Ext-Secret header — used on all extension routes */
function requireExtSecret(req, res, next) {
  const secret = req.headers['x-ext-secret'];
  if (!EXT_SECRET || secret !== EXT_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/** Validates pc_session cookie — used on all PWA routes */
function requirePwaSession(req, res, next) {
  const sessionId = req.cookies?.pc_session;
  if (!sessionId) return res.status(401).json({ error: 'Not logged in' });
  const session = db.getPwaSession(sessionId);
  if (!session) return res.status(401).json({ error: 'Session expired' });
  db.touchPwaSession(sessionId);
  req.sessionId = sessionId;
  next();
}

// ---------------------------------------------------------------------------
// Multer — in-memory for thumbnail uploads (max 2MB each)
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// PWA Auth routes
// ---------------------------------------------------------------------------

app.post('/api/login', async (req, res) => {
  const { password } = req.body;
  if (!CURATOR_PASSWORD) return res.status(503).json({ error: 'Auth not configured' });
  if (!password) return res.status(400).json({ error: 'Password required' });

  // Accept plain-text match or bcrypt hash in env
  let valid = false;
  if (CURATOR_PASSWORD.startsWith('$2')) {
    valid = await bcrypt.compare(password, CURATOR_PASSWORD);
  } else {
    valid = password === CURATOR_PASSWORD;
  }

  if (!valid) return res.status(401).json({ error: 'Wrong password' });

  const sessionId = crypto.randomBytes(32).toString('hex');
  db.createPwaSession(sessionId);
  res.cookie('pc_session', sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days
  });
  res.json({ ok: true });
});

app.post('/api/logout', requirePwaSession, (req, res) => {
  db.deletePwaSession(req.sessionId);
  res.clearCookie('pc_session');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const sessionId = req.cookies?.pc_session;
  if (!sessionId) return res.json({ authenticated: false });
  const session = db.getPwaSession(sessionId);
  res.json({ authenticated: !!session });
});

// ---------------------------------------------------------------------------
// Extension — heartbeat
// ---------------------------------------------------------------------------

app.post('/api/extension/heartbeat', requireExtSecret, (req, res) => {
  db.updateHeartbeat(req.body?.version);
  res.json({ ok: true });
});

app.get('/api/extension/heartbeat', (req, res) => {
  const hb = db.getHeartbeat();
  const STALE_THRESHOLD = 30; // seconds
  const connected = hb && (Math.floor(Date.now() / 1000) - hb.last_seen) < STALE_THRESHOLD;
  res.json({
    connected: !!connected,
    lastSeen: hb?.last_seen ?? null,
    version: hb?.version ?? null,
  });
});

// ---------------------------------------------------------------------------
// Extension — scan batch
// ---------------------------------------------------------------------------

app.post('/api/scan/batch', requireExtSecret, (req, res) => {
  const { items, cursor, totalScanned, totalEstimated } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array required' });
  }

  // Compute month_key from creation_timestamp if not provided
  const enriched = items.map(item => {
    if (!item.monthKey && item.creationTimestamp) {
      const d = new Date(item.creationTimestamp);
      item.monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    return item;
  });

  db.upsertLibraryBatch(enriched);

  // Update month stats for affected months
  const months = [...new Set(enriched.map(i => i.monthKey).filter(Boolean))];
  for (const m of months) db.upsertMonthStats(m);

  // Update scan state
  const stateUpdate = {};
  if (cursor !== undefined)        stateUpdate.cursor          = cursor;
  if (totalScanned !== undefined)  stateUpdate.total_scanned   = totalScanned;
  if (totalEstimated !== undefined) stateUpdate.total_estimated = totalEstimated;
  if (Object.keys(stateUpdate).length) db.updateScanState(stateUpdate);

  // Phase 1: simple dhash duplicate detection
  let dupsFound = 0;
  for (const item of enriched) {
    if (!item.dhash) continue;
    const candidates = db.getDHashCandidates(item.dhash, item.mediaKey);
    if (candidates.length === 0) continue;

    for (const candidate of candidates) {
      // Both have same dhash and neither is in a group yet — create group
      const groupId = db.createDuplicateGroup(1.0, 'dhash');

      // Determine which to keep: Live Photo > file_size > creation_timestamp
      const newItem = { ...item, mediaKey: item.mediaKey };
      const keepNew = shouldKeep(newItem, candidate);

      db.assignDuplicateGroup(item.mediaKey,     groupId, keepNew);
      db.assignDuplicateGroup(candidate.media_key, groupId, !keepNew);
      dupsFound++;
    }
  }

  if (dupsFound > 0) {
    const state = db.getScanState();
    db.updateScanState({ duplicates_found: (state.duplicates_found || 0) + dupsFound });
  }

  res.json({ ok: true, dupsFound });
});

/**
 * Determine whether newItem should be the kept copy over existing.
 * Priority: is_live_photo > file_size > creation_timestamp (older = original)
 */
function shouldKeep(newItem, existing) {
  if (newItem.isLivePhoto && !existing.is_live_photo) return true;
  if (!newItem.isLivePhoto && existing.is_live_photo) return false;
  if ((newItem.fileSize ?? 0) > (existing.file_size ?? 0)) return true;
  if ((newItem.fileSize ?? 0) < (existing.file_size ?? 0)) return false;
  // Older timestamp = more likely original
  return (newItem.creationTimestamp ?? 0) < (existing.creation_timestamp ?? 0);
}

// ---------------------------------------------------------------------------
// Extension — thumbnail upload
// ---------------------------------------------------------------------------

app.post('/api/scan/thumb', requireExtSecret, upload.single('thumb'), (req, res) => {
  const { mediaKey, size } = req.body;
  if (!mediaKey || !size || !req.file) {
    return res.status(400).json({ error: 'mediaKey, size, and thumb file required' });
  }
  if (!['w400', 'w1600'].includes(size)) {
    return res.status(400).json({ error: 'size must be w400 or w1600' });
  }

  const dir = path.join(THUMBS_DIR, mediaKey);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${size}.jpg`), req.file.buffer);
  db.markThumbCached(mediaKey, size);

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Extension — scan progress (for resume on next session)
// ---------------------------------------------------------------------------

app.get('/api/scan/progress', requireExtSecret, (req, res) => {
  const state = db.getScanState();
  res.json({
    cursor:         state.cursor,
    totalScanned:   state.total_scanned,
    totalEstimated: state.total_estimated,
    duplicatesFound:state.duplicates_found,
    lastScannedAt:  state.last_scanned_at,
    scanComplete:   !!state.scan_complete,
    lastCompleteMonth: state.last_complete_month,
  });
});

app.post('/api/scan/complete', requireExtSecret, (req, res) => {
  db.updateScanState({ scan_complete: 1, cursor: null });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Extension — trash queue
// ---------------------------------------------------------------------------

app.get('/api/extension/trash-queue', requireExtSecret, (req, res) => {
  const items = db.getPendingTrashQueue();
  res.json({ items });
});

app.post('/api/extension/trash-confirm', requireExtSecret, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }
  db.confirmTrashExecuted(ids);
  res.json({ ok: true, confirmed: ids.length });
});

app.post('/api/extension/trash-error', requireExtSecret, (req, res) => {
  const { id, error } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  db.markTrashError(id, error);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Extension — album queue (Good album writes)
// ---------------------------------------------------------------------------

app.get('/api/extension/album-queue', requireExtSecret, (req, res) => {
  const items = db.getPendingAlbumQueue();
  res.json({ items });
});

app.post('/api/extension/album-confirm', requireExtSecret, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }
  db.confirmAlbumWritten(ids);
  res.json({ ok: true, confirmed: ids.length });
});

// ---------------------------------------------------------------------------
// Extension — album builder (YYYY-MM)
// ---------------------------------------------------------------------------

app.post('/api/albums/month', requireExtSecret, (req, res) => {
  const { monthKey, googleAlbumId } = req.body;
  if (!monthKey || !googleAlbumId) {
    return res.status(400).json({ error: 'monthKey and googleAlbumId required' });
  }
  db.upsertMonthAlbum(monthKey, googleAlbumId);
  res.json({ ok: true });
});

app.post('/api/albums/month/populated', requireExtSecret, (req, res) => {
  const { monthKey } = req.body;
  if (!monthKey) return res.status(400).json({ error: 'monthKey required' });
  db.markMonthPopulated(monthKey);
  res.json({ ok: true });
});

app.get('/api/albums/progress', requireExtSecret, (req, res) => {
  const months = db.getAlbumProgress();
  res.json({
    months,
    populated: months.filter(m => m.populated).length,
    total: months.length,
  });
});

// ---------------------------------------------------------------------------
// PWA — library reads
// ---------------------------------------------------------------------------

app.get('/api/library/months', requirePwaSession, (req, res) => {
  const months = db.getMonthList();
  res.json({ months });
});

app.get('/api/library/month', requirePwaSession, (req, res) => {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month param required (YYYY-MM)' });
  }
  const items = db.getItemsForMonth(month);
  res.json({ items });
});

app.get('/api/library/dupes', requirePwaSession, (req, res) => {
  const resolved = req.query.resolved === '1';
  const groups = db.getDuplicateGroups(resolved);
  res.json({ groups });
});

// ---------------------------------------------------------------------------
// PWA — swipe decisions
// ---------------------------------------------------------------------------

app.post('/api/swipe', requirePwaSession, (req, res) => {
  const { mediaKey, decision } = req.body;
  if (!mediaKey || !decision) {
    return res.status(400).json({ error: 'mediaKey and decision required' });
  }
  if (!['good', 'bad', 'skip', 'duplicate_keep', 'duplicate_discard'].includes(decision)) {
    return res.status(400).json({ error: 'Invalid decision' });
  }

  db.recordDecision(mediaKey, decision);

  // Queue for extension execution
  if (decision === 'bad' || decision === 'duplicate_discard') {
    const item = db.db.prepare(
      'SELECT dedup_key FROM library_items WHERE media_key = ?'
    ).get(mediaKey);

    if (item?.dedup_key) {
      db.enqueueTrash(mediaKey, item.dedup_key, decision);
    }
    // If no dedup_key yet, will be queued when getItemInfoExt stream provides it (Phase 2)
  }

  if (decision === 'good' || decision === 'duplicate_keep') {
    // Album ID will be resolved by extension from its own config
    db.enqueueAlbumWrite(mediaKey, null);
  }

  res.json({ ok: true, decision });
});

app.get('/api/swipe/decisions', requirePwaSession, (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month required' });
  const decisions = db.getDecisionsForMonth(month);
  // Return as { mediaKey: decision } map
  const map = {};
  for (const d of decisions) map[d.media_key] = d.decision;
  res.json({ decisions: map });
});

// ---------------------------------------------------------------------------
// PWA — thumbnail serving
// ---------------------------------------------------------------------------

app.get('/api/image/thumb', requirePwaSession, (req, res) => {
  const { mediaKey, size = 'w400' } = req.query;
  if (!mediaKey) return res.status(400).json({ error: 'mediaKey required' });
  if (!['w400', 'w1600'].includes(size)) return res.status(400).json({ error: 'Invalid size' });

  const thumbPath = path.join(THUMBS_DIR, mediaKey, `${size}.jpg`);
  if (!fs.existsSync(thumbPath)) {
    return res.status(404).json({ error: 'Thumbnail not yet cached' });
  }

  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(thumbPath);
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: '3.0.0' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`[Photo Curator v3.0.0] Backend listening on port ${PORT}`);
});

module.exports = app;
