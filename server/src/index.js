// index.js — v2.8
// PURPOSE: Photo Curator backend — all Express routes.
// v2.8 changes:
//   - start-upload: now passes filename, fileSize, creationTime, pickerBaseUrl
//     to createUploadRow (fixes "null" filename bug throughout the app)
//   - /api/swipe: getUploadByOurMediaItemId now called with email instead of
//     sessionId (fixes 404 after session rotation)
//   - GET /api/quota: returns today's API call count from quota_log table
//   - Live Photo: no route changes needed — handled entirely in worker.js
// v2.7: added GET /api/uploads/queue — per-item filename+status for QueueDrawer.
// v2.6: scope-status endpoint + reauth flag on 403.
// v2.5: deleted-photo detection (verifier + cron).

import 'dotenv/config'
import express from 'express'
import cookieParser from 'cookie-parser'
import crypto from 'node:crypto'
import {
  saveSession, getSession, deleteSession,
  createUploadRow, getReadyUploads,
  getUploadStatusCounts, getUploadRow, updateUploadStatus,
  getUploadByOurMediaItemId, setSwipeDecision,
  getUploadIdsBySession, getAlbumSummaries, getDeletedUploads,
  setNeedsReauthScope, getNeedsReauthScope, getQuotaToday,
  incrementQuotaLog, db,
} from './db.js'
import { buildAuthUrl, exchangeCodeForTokens, getValidAccessToken } from './google-auth.js'
import { createPickerSession, getPickerSession, deletePickerSession, fetchPickerItems } from './picker.js'
import { kickWorkerPool, registerBaseUrl, registerRowContext } from './worker.js'
import { createAlbum, batchAddMediaItems } from './library-upload.js'
import { ensureThumbDirs, deleteThumbsBulk } from './thumbs.js'
import { getCachedAlbumId, setCachedAlbumId } from './db.js'
import cron from 'node-cron'
import { runVerificationPass, runVerificationPassForAllUsers } from './verifier.js'

const app = express()
const PORT = process.env.PORT || 3001
const SESSION_COOKIE = 'pc_session'
const IS_PROD = process.env.NODE_ENV === 'production'

ensureThumbDirs().catch(err => console.warn('[startup] ensureThumbDirs failed:', err.message))

app.use(cookieParser())
app.use(express.json())
app.use('/api/thumbs', express.static('/app/data/thumbs', { maxAge: '1h' }))

const pendingStates = new Map()
function makeState() {
  const state = crypto.randomBytes(16).toString('hex')
  pendingStates.set(state, Date.now() + 5 * 60_000)
  return state
}
function consumeState(state) {
  const exp = pendingStates.get(state)
  pendingStates.delete(state)
  return exp && Date.now() < exp
}

function requireSession(req, res, next) {
  const sessionId = req.cookies[SESSION_COOKIE]
  if (!sessionId || !getSession(sessionId)) return res.status(401).json({ error: 'NOT_AUTHENTICATED' })
  req.sessionId = sessionId
  next()
}

// Helper: get email for current session
function sessionEmail(req) {
  const session = getSession(req.sessionId)
  return session?.google_email || null
}

// ── OAuth ─────────────────────────────────────────────────────────────────────

app.get('/api/oauth/start', (req, res) => { res.redirect(buildAuthUrl(makeState())) })

app.get('/api/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query
  if (error) return res.redirect('/?auth_error=' + encodeURIComponent(String(error)))
  if (!code || !state || !consumeState(String(state))) return res.redirect('/?auth_error=invalid_state')
  try {
    const tokens = await exchangeCodeForTokens(String(code))
    if (!tokens.refresh_token) return res.redirect('/?auth_error=no_refresh_token')
    let email = null
    try {
      const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } })
      if (r.ok) { const d = await r.json(); email = d.email || null }
    } catch {}
    const sessionId = crypto.randomBytes(24).toString('hex')
    const now = Math.floor(Date.now() / 1000)
    saveSession(sessionId, { refreshToken: tokens.refresh_token, accessToken: tokens.access_token, accessTokenExp: now + tokens.expires_in, googleEmail: email })
    res.cookie(SESSION_COOKIE, sessionId, { httpOnly: true, secure: IS_PROD, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 90 })
    if (email) setNeedsReauthScope(email, false)
    res.redirect('/')
    if (email) {
      setImmediate(() => runVerificationPass(email, getValidAccessToken).catch(err =>
        console.error('[verifier] login-triggered pass failed:', err.message)
      ))
    }
  } catch (err) {
    console.error('[oauth/callback] failed:', err.message)
    res.redirect('/?auth_error=token_exchange_failed')
  }
})

app.get('/api/me', (req, res) => {
  const sessionId = req.cookies[SESSION_COOKIE]
  const session = sessionId ? getSession(sessionId) : null
  if (!session) return res.json({ authenticated: false })
  res.json({ authenticated: true, email: session.google_email || null })
})

app.get('/api/scope-status', requireSession, (req, res) => {
  res.json({ needsReauth: getNeedsReauthScope(req.sessionId) })
})

app.post('/api/logout', (req, res) => {
  const sessionId = req.cookies[SESSION_COOKIE]
  if (sessionId) deleteSession(sessionId)
  res.clearCookie(SESSION_COOKIE)
  res.json({ ok: true })
})

// ── Quota ─────────────────────────────────────────────────────────────────────
// v2.8: returns today's Google API call count for the UI to display a warning
// if we're approaching limits (informational only — worker handles 429 itself)
app.get('/api/quota', requireSession, (req, res) => {
  res.json({ date: new Date().toISOString().slice(0, 10), apiCalls: getQuotaToday() })
})

// ── Image proxy ───────────────────────────────────────────────────────────────
app.get('/api/image-proxy', requireSession, async (req, res) => {
  const { baseUrl, size } = req.query
  if (!baseUrl || typeof baseUrl !== 'string') return res.status(400).json({ error: 'MISSING_BASE_URL' })
  let parsed
  try { parsed = new URL(baseUrl) } catch { return res.status(400).json({ error: 'INVALID_BASE_URL' }) }
  if (parsed.hostname !== 'lh3.googleusercontent.com') return res.status(400).json({ error: 'DISALLOWED_HOST' })
  try {
    const at = await getValidAccessToken(req.sessionId)
    const upstream = await fetch(baseUrl + (typeof size === 'string' ? size : ''), { headers: { Authorization: `Bearer ${at}` } })
    if (!upstream.ok) return res.status(upstream.status).json({ error: 'UPSTREAM_ERROR' })
    res.set('Content-Type', upstream.headers.get('content-type') || 'image/jpeg')
    res.set('Cache-Control', 'private, max-age=3600')
    res.send(Buffer.from(await upstream.arrayBuffer()))
  } catch (err) {
    if (err.message === 'NO_SESSION') return res.status(401).json({ error: 'NOT_AUTHENTICATED' })
    res.status(502).json({ error: 'PROXY_FAILED', message: err.message })
  }
})

// ── Picker proxy ──────────────────────────────────────────────────────────────
app.post('/api/picker/sessions', requireSession, async (req, res) => {
  try { res.json(await createPickerSession(await getValidAccessToken(req.sessionId))) }
  catch (err) { res.status(502).json({ error: 'PICKER_SESSION_CREATE_FAILED', message: err.message }) }
})
app.get('/api/picker/sessions/:id', requireSession, async (req, res) => {
  try { res.json(await getPickerSession(await getValidAccessToken(req.sessionId), req.params.id)) }
  catch (err) { res.status(502).json({ error: 'PICKER_SESSION_GET_FAILED', message: err.message }) }
})
app.get('/api/picker/sessions/:id/items', requireSession, async (req, res) => {
  try { res.json({ items: await fetchPickerItems(await getValidAccessToken(req.sessionId), req.params.id) }) }
  catch (err) { res.status(502).json({ error: 'PICKER_ITEMS_FETCH_FAILED', message: err.message }) }
})
app.delete('/api/picker/sessions/:id', requireSession, async (req, res) => {
  try { await deletePickerSession(await getValidAccessToken(req.sessionId), req.params.id); res.json({ ok: true }) }
  catch { res.json({ ok: false }) }
})

// ── Upload pipeline ───────────────────────────────────────────────────────────
const WORKING_ALBUM_TITLE = 'Photo Curator — Inbox'
let workingAlbumId = null
async function getOrCreateWorkingAlbum(sessionId) {
  if (workingAlbumId) return workingAlbumId
  const album = await createAlbum(await getValidAccessToken(sessionId), WORKING_ALBUM_TITLE)
  workingAlbumId = album.id
  return workingAlbumId
}

// v2.8: passes filename, fileSize, creationTime, pickerBaseUrl to createUploadRow
app.post('/api/picker-session/:id/start-upload', requireSession, async (req, res) => {
  const email           = sessionEmail(req)
  const pickerSessionId = req.params.id
  const items           = req.body?.items
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'MISSING_ITEMS' })
  try {
    const albumId = await getOrCreateWorkingAlbum(req.sessionId)
    let enqueued = 0
    for (const item of items) {
      if (!item.id || !item.baseUrl) continue
      const rowId = createUploadRow(
        req.sessionId,
        email,
        pickerSessionId,
        item.id,
        item.mimeType || null,
        {
          filename:      item.filename || null,
          fileSize:      item.fileSize || null,
          creationTime:  item.mediaMetadata?.creationTime || null,
          pickerBaseUrl: item.baseUrl,              // persisted for restart recovery
        }
      )
      registerBaseUrl(rowId, item.baseUrl)
      registerRowContext(rowId, { sessionId: req.sessionId, albumIdForUploads: albumId })
      enqueued++
    }
    kickWorkerPool()
    res.json({ ok: true, enqueued })
  } catch (err) { res.status(502).json({ error: 'START_UPLOAD_FAILED', message: err.message }) }
})

app.get('/api/uploads/status', requireSession, (req, res) => {
  const { pickerSessionId } = req.query
  if (!pickerSessionId) return res.status(400).json({ error: 'MISSING_PICKER_SESSION_ID' })
  res.json(getUploadStatusCounts(String(pickerSessionId)))
})

function rowToItem(r) {
  return {
    uploadId:       r.id,
    pickerItemId:   r.picker_item_id,
    filename:       r.filename,
    ourMediaItemId: r.our_media_item_id,
    isDuplicate:    !!r.is_duplicate,
    isLivePhoto:    !!r.is_live_photo,
    swipeDecision:  r.swipe_decision || null,
    exif: {
      dateTaken:   r.exif_date_taken,
      gpsLat:      r.exif_gps_lat,
      gpsLon:      r.exif_gps_lon,
      cameraMake:  r.exif_camera_make,
      cameraModel: r.exif_camera_model,
    },
  }
}

app.get('/api/uploads/ready', requireSession, (req, res) => {
  const { pickerSessionId } = req.query
  if (!pickerSessionId) return res.status(400).json({ error: 'MISSING_PICKER_SESSION_ID' })
  res.json({ items: getReadyUploads(String(pickerSessionId)).map(rowToItem) })
})

app.get('/api/uploads/all', requireSession, (req, res) => {
  const email = sessionEmail(req)
  if (!email) return res.json({ items: [] })
  const rows = db.prepare(`
    SELECT * FROM uploads
    WHERE google_email = ? AND status = 'done' AND our_media_item_id IS NOT NULL
      AND is_duplicate = 0 AND deleted_at IS NULL
    ORDER BY id ASC
  `).all(email)
  res.json({ items: rows.map(rowToItem) })
})

app.get('/api/uploads/deleted', requireSession, (req, res) => {
  const email = sessionEmail(req)
  if (!email) return res.json({ items: [] })
  res.json({ items: getDeletedUploads(email).map(rowToItem) })
})

app.get('/api/uploads/queue', requireSession, (req, res) => {
  const { pickerSessionId } = req.query
  if (!pickerSessionId) return res.status(400).json({ error: 'MISSING_PICKER_SESSION_ID' })
  const rows = db.prepare(`
    SELECT id, filename, status, mime_type, is_live_photo FROM uploads
    WHERE picker_session_id = ? ORDER BY id ASC
  `).all(String(pickerSessionId))
  res.json({ items: rows })
})

app.post('/api/uploads/:id/retry', requireSession, (req, res) => {
  const row = getUploadRow(Number(req.params.id))
  if (!row || row.session_id !== req.sessionId) return res.status(404).json({ error: 'NOT_FOUND' })
  if (row.status !== 'failed') return res.status(400).json({ error: 'NOT_FAILED' })
  updateUploadStatus(row.id, 'pending', { error_message: null })
  kickWorkerPool()
  res.json({ ok: true })
})

// ── Album drawer ──────────────────────────────────────────────────────────────
app.get('/api/albums', requireSession, (req, res) => {
  res.json({ albums: getAlbumSummaries(req.sessionId) })
})

// ── Cleanup ───────────────────────────────────────────────────────────────────
app.post('/api/cleanup', requireSession, async (req, res) => {
  try {
    const ids = getUploadIdsBySession(req.sessionId)
    await deleteThumbsBulk(ids)
    res.json({ ok: true, deleted: ids.length })
  } catch (err) {
    console.error('[cleanup] failed (non-fatal):', err.message)
    res.json({ ok: false, error: err.message })
  }
})

// ── Swipe routing ─────────────────────────────────────────────────────────────
async function getOrCreateNamedAlbum(sessionId, albumTitle) {
  const session = getSession(sessionId)
  if (!session?.google_email) throw new Error('No user email for album caching')
  const email = session.google_email
  let albumId = getCachedAlbumId(email, albumTitle)
  if (albumId) return albumId
  const accessToken = await getValidAccessToken(sessionId)
  const album = await createAlbum(accessToken, albumTitle)
  setCachedAlbumId(email, albumTitle, album.id)
  return album.id
}

// v2.8: lookup by email (not sessionId) — survives session rotation
app.post('/api/swipe', requireSession, async (req, res) => {
  const { ourMediaItemId, decision } = req.body || {}
  if (!ourMediaItemId || !['good', 'bad', 'skip'].includes(decision)) {
    return res.status(400).json({ error: 'INVALID_BODY' })
  }
  const email = sessionEmail(req)
  const row   = email ? getUploadByOurMediaItemId(email, ourMediaItemId) : null
  if (!row) return res.status(404).json({ error: 'NOT_FOUND' })

  if (row.is_duplicate) {
    setSwipeDecision(row.id, decision)
    return res.json({ ok: true, decision, albumId: null, note: 'duplicate — already in Duplicates album' })
  }

  setSwipeDecision(row.id, decision)
  if (decision === 'skip') return res.json({ ok: true, decision: 'skip', albumId: null })

  try {
    const albumTitle = decision === 'good' ? 'Good' : 'Bad'
    const albumId    = await getOrCreateNamedAlbum(req.sessionId, albumTitle)
    const at         = await getValidAccessToken(req.sessionId)
    await batchAddMediaItems(at, albumId, [ourMediaItemId])
    incrementQuotaLog(1)
    console.log(`[Swipe] ${ourMediaItemId.slice(0, 20)}… → "${albumTitle}" ✓`)
    res.json({ ok: true, decision, albumId })
  } catch (err) {
    console.error('[Swipe] album write failed:', err.message)
    res.status(502).json({ error: 'ALBUM_WRITE_FAILED', message: err.message, decision })
  }
})

app.get('/api/swipe-decisions', requireSession, (req, res) => {
  const { pickerSessionId } = req.query
  if (!pickerSessionId) return res.status(400).json({ error: 'MISSING_PICKER_SESSION_ID' })
  const rows = getReadyUploads(String(pickerSessionId))
    .filter(r => r.swipe_decision)
    .map(r => ({ ourMediaItemId: r.our_media_item_id, decision: r.swipe_decision }))
  res.json({ decisions: rows })
})

// ── Cron ──────────────────────────────────────────────────────────────────────
cron.schedule('0 */2 * * *', () => {
  console.log('[cron] running 2-hourly verification pass')
  runVerificationPassForAllUsers(getValidAccessToken).catch(err =>
    console.error('[cron] verification pass failed:', err.message)
  )
})
console.log('[server] cron scheduled: deleted-photo verification every 2 hours')

app.listen(PORT, () => console.log(`[server] Photo Curator backend v2.8 listening on :${PORT}`))
