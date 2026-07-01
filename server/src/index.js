// index.js — v2.11
// PURPOSE: Photo Curator backend — all Express routes.
// v2.11 changes:
//   - GET  /api/curation-sessions        — list all sessions for user
//   - POST /api/curation-sessions        — create new session (auto-name)
//   - POST /api/curation-sessions/:id/activate — switch active session
//   - PATCH /api/curation-sessions/:id/rename  — rename a session
//   - DELETE /api/curation-sessions/:id  — delete session + its uploads + thumbs
//                                          (blocked if session is active)
//   - POST /api/curation-sessions/start-new — saves current (no-op, it's already
//       named), creates a fresh session, marks it active, returns it
//   - GET /api/uploads/all now scoped to active curation session only
//       (fixes "previous session comes back on refresh")
//   - start-upload now stamps curation_session_id on each new upload row
//   - Inbox album self-healing: getOrCreateWorkingAlbum persisted via user_albums
// v2.10 changes:
//   - batchAddMediaItems 404 self-heal (stale cached album_id).
//   - bandwidthToday in /api/uploads/status.
// v2.8 changes: filename fix, swipe by email, quota log, live photo.

import 'dotenv/config'
import express from 'express'
import cookieParser from 'cookie-parser'
import crypto from 'node:crypto'
import {
  saveSession, getSession, deleteSession,
  createUploadRow, getReadyUploads,
  getUploadStatusCounts, getUploadRow, updateUploadStatus,
  getUploadByOurMediaItemId, setSwipeDecision,
  getAlbumSummaries, getDeletedUploads,
  setNeedsReauthScope, getNeedsReauthScope, getQuotaToday,
  incrementQuotaLog, getBandwidthToday,
  getCachedAlbumId, setCachedAlbumId, deleteCachedAlbumId,
  getUploadsForActiveSession,
  createCurationSession, getActiveCurationSession, listCurationSessions,
  setActiveCurationSession, renameCurationSession,
  deleteCurationSession, getUploadIdsByCurationSession,
  db,
} from './db.js'
import { buildAuthUrl, exchangeCodeForTokens, getValidAccessToken } from './google-auth.js'
import { createPickerSession, getPickerSession, deletePickerSession, fetchPickerItems } from './picker.js'
import { kickWorkerPool, registerBaseUrl, registerRowContext } from './worker.js'
import { createAlbum, batchAddMediaItems } from './library-upload.js'
import { ensureThumbDirs, deleteThumbsBulk } from './thumbs.js'
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
function sessionEmail(req) {
  return getSession(req.sessionId)?.google_email || null
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
    if (email) setImmediate(() => runVerificationPass(email, getValidAccessToken).catch(() => {}))
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
app.get('/api/quota', requireSession, (req, res) => {
  res.json({ date: new Date().toISOString().slice(0, 10), apiCalls: getQuotaToday() })
})

// ── Curation sessions ─────────────────────────────────────────────────────────

// GET /api/curation-sessions — list all sessions for user with photo counts
app.get('/api/curation-sessions', requireSession, (req, res) => {
  const email = sessionEmail(req)
  if (!email) return res.json({ sessions: [], active: null })
  const sessions = listCurationSessions(email)
  const active = sessions.find(s => s.is_active) || null
  res.json({ sessions, active })
})

// POST /api/curation-sessions — create a new session (not yet active)
app.post('/api/curation-sessions', requireSession, (req, res) => {
  const email = sessionEmail(req)
  if (!email) return res.status(401).json({ error: 'NO_EMAIL' })
  const name = req.body?.name || null
  const session = createCurationSession(email, name)
  res.json({ ok: true, session })
})

// POST /api/curation-sessions/start-new
// Saves the current session as-is (already named, nothing to do),
// creates a new session, marks it active, returns it.
// Frontend uses this for "Start New Session" button.
app.post('/api/curation-sessions/start-new', requireSession, (req, res) => {
  const email = sessionEmail(req)
  if (!email) return res.status(401).json({ error: 'NO_EMAIL' })
  const name = req.body?.name || null
  const newSession = createCurationSession(email, name)
  setActiveCurationSession(email, newSession.id)
  console.log(`[sessions] started new curation session "${newSession.name}" (id=${newSession.id}) for ${email}`)
  res.json({ ok: true, session: { ...newSession, is_active: 1, photo_count: 0 } })
})

// POST /api/curation-sessions/:id/activate — switch active session
app.post('/api/curation-sessions/:id/activate', requireSession, (req, res) => {
  const email = sessionEmail(req)
  if (!email) return res.status(401).json({ error: 'NO_EMAIL' })
  const ok = setActiveCurationSession(email, Number(req.params.id))
  if (!ok) return res.status(404).json({ error: 'NOT_FOUND' })
  console.log(`[sessions] activated curation session ${req.params.id} for ${email}`)
  res.json({ ok: true })
})

// PATCH /api/curation-sessions/:id/rename
app.patch('/api/curation-sessions/:id/rename', requireSession, (req, res) => {
  const email = sessionEmail(req)
  const name  = req.body?.name
  if (!name?.trim()) return res.status(400).json({ error: 'MISSING_NAME' })
  const ok = renameCurationSession(email, Number(req.params.id), name.trim())
  if (!ok) return res.status(404).json({ error: 'NOT_FOUND' })
  res.json({ ok: true })
})

// DELETE /api/curation-sessions/:id
// Blocked if session is active. Deletes uploads rows + thumbnail files.
app.delete('/api/curation-sessions/:id', requireSession, async (req, res) => {
  const email = sessionEmail(req)
  if (!email) return res.status(401).json({ error: 'NO_EMAIL' })
  const result = deleteCurationSession(email, Number(req.params.id))
  if (!result.ok) {
    const status = result.reason === 'ACTIVE_SESSION' ? 409 : 404
    const message = result.reason === 'ACTIVE_SESSION'
      ? 'Cannot delete the active session. Switch to another session first.'
      : 'Session not found.'
    return res.status(status).json({ error: result.reason, message })
  }
  // Delete thumbnails for removed upload rows (non-fatal)
  if (result.uploadIds?.length) {
    deleteThumbsBulk(result.uploadIds).catch(err =>
      console.warn('[sessions] thumb cleanup failed (non-fatal):', err.message)
    )
  }
  console.log(`[sessions] deleted curation session ${req.params.id} (${result.uploadIds?.length} uploads) for ${email}`)
  res.json({ ok: true, deleted: result.uploadIds?.length || 0 })
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

// v2.10+: persisted via user_albums (not in-memory variable)
async function getOrCreateWorkingAlbum(sessionId) {
  const email = getSession(sessionId)?.google_email || null
  if (email) {
    const cached = getCachedAlbumId(email, WORKING_ALBUM_TITLE)
    if (cached) return cached
  }
  const album = await createAlbum(await getValidAccessToken(sessionId), WORKING_ALBUM_TITLE)
  if (email) setCachedAlbumId(email, WORKING_ALBUM_TITLE, album.id)
  return album.id
}

app.post('/api/picker-session/:id/start-upload', requireSession, async (req, res) => {
  const email           = sessionEmail(req)
  const pickerSessionId = req.params.id
  const items           = req.body?.items
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'MISSING_ITEMS' })
  try {
    const albumId = await getOrCreateWorkingAlbum(req.sessionId)

    // Ensure user has an active curation session; create one if needed
    let cs = getActiveCurationSession(email)
    if (!cs) {
      const created = createCurationSession(email)
      setActiveCurationSession(email, created.id)
      cs = { id: created.id }
      console.log(`[sessions] auto-created curation session for ${email}`)
    }

    let enqueued = 0
    for (const item of items) {
      if (!item.id || !item.baseUrl) continue
      const rowId = createUploadRow(
        req.sessionId, email, pickerSessionId, item.id, item.mimeType || null,
        {
          filename:           item.filename || null,
          fileSize:           item.fileSize || null,
          creationTime:       item.mediaMetadata?.creationTime || null,
          pickerBaseUrl:      item.baseUrl,
          curationSessionId:  cs.id,     // v2.11: stamp session
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
  const counts = getUploadStatusCounts(String(pickerSessionId))
  const email = sessionEmail(req)
  const bandwidthToday = email ? getBandwidthToday(email) : 0
  res.json({ ...counts, bandwidthToday })
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

// v2.11: scoped to active curation session only
app.get('/api/uploads/all', requireSession, (req, res) => {
  const email = sessionEmail(req)
  if (!email) return res.json({ items: [] })
  res.json({ items: getUploadsForActiveSession(email).map(rowToItem) })
})

app.get('/api/uploads/deleted', requireSession, (req, res) => {
  const email = sessionEmail(req)
  if (!email) return res.json({ items: [] })
  res.json({ items: getDeletedUploads(email).map(rowToItem) })
})

app.get('/api/uploads/queue', requireSession, (req, res) => {
  const { pickerSessionId } = req.query
  if (!pickerSessionId) return res.status(400).json({ error: 'MISSING_PICKER_SESSION_ID' })
  const rows = db.prepare(`SELECT id, filename, status, mime_type, is_live_photo FROM uploads WHERE picker_session_id = ? ORDER BY id ASC`).all(String(pickerSessionId))
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

app.get('/api/albums', requireSession, (req, res) => {
  res.json({ albums: getAlbumSummaries(req.sessionId) })
})

// ── Swipe routing ─────────────────────────────────────────────────────────────
async function getOrCreateNamedAlbum(sessionId, albumTitle) {
  const session = getSession(sessionId)
  if (!session?.google_email) throw new Error('No user email for album caching')
  const email = session.google_email
  const cached = getCachedAlbumId(email, albumTitle)
  if (cached) return cached
  const album = await createAlbum(await getValidAccessToken(sessionId), albumTitle)
  setCachedAlbumId(email, albumTitle, album.id)
  return album.id
}

async function recreateNamedAlbum(sessionId, albumTitle) {
  const session = getSession(sessionId)
  const email   = session?.google_email
  if (email) deleteCachedAlbumId(email, albumTitle)
  const album = await createAlbum(await getValidAccessToken(sessionId), albumTitle)
  if (email) setCachedAlbumId(email, albumTitle, album.id)
  console.warn(`[Swipe] stale album_id for "${albumTitle}" — recreated as ${album.id}`)
  return album.id
}

app.post('/api/swipe', requireSession, async (req, res) => {
  const { ourMediaItemId, decision } = req.body || {}
  if (!ourMediaItemId || !['good', 'bad', 'skip'].includes(decision)) return res.status(400).json({ error: 'INVALID_BODY' })
  const email = sessionEmail(req)
  const row   = email ? getUploadByOurMediaItemId(email, ourMediaItemId) : null
  if (!row) return res.status(404).json({ error: 'NOT_FOUND' })
  if (row.is_duplicate) { setSwipeDecision(row.id, decision); return res.json({ ok: true, decision, albumId: null }) }
  setSwipeDecision(row.id, decision)
  if (decision === 'skip') return res.json({ ok: true, decision: 'skip', albumId: null })
  const albumTitle = decision === 'good' ? 'Good' : 'Bad'
  try {
    const albumId = await getOrCreateNamedAlbum(req.sessionId, albumTitle)
    await batchAddMediaItems(await getValidAccessToken(req.sessionId), albumId, [ourMediaItemId])
    incrementQuotaLog(1)
    console.log(`[Swipe] ${ourMediaItemId.slice(0, 20)}… → "${albumTitle}" ✓`)
    return res.json({ ok: true, decision, albumId })
  } catch (err) {
    if (err.status === 404) {
      try {
        const freshId = await recreateNamedAlbum(req.sessionId, albumTitle)
        await batchAddMediaItems(await getValidAccessToken(req.sessionId), freshId, [ourMediaItemId])
        incrementQuotaLog(1)
        return res.json({ ok: true, decision, albumId: freshId })
      } catch (retryErr) {
        return res.status(502).json({ error: 'ALBUM_WRITE_FAILED', message: retryErr.message, decision })
      }
    }
    console.error('[Swipe] album write failed:', err.message)
    return res.status(502).json({ error: 'ALBUM_WRITE_FAILED', message: err.message, decision })
  }
})

app.get('/api/swipe-decisions', requireSession, (req, res) => {
  const { pickerSessionId } = req.query
  if (!pickerSessionId) return res.status(400).json({ error: 'MISSING_PICKER_SESSION_ID' })
  const rows = getReadyUploads(String(pickerSessionId)).filter(r => r.swipe_decision)
    .map(r => ({ ourMediaItemId: r.our_media_item_id, decision: r.swipe_decision }))
  res.json({ decisions: rows })
})

// ── Cron ──────────────────────────────────────────────────────────────────────
cron.schedule('0 */2 * * *', () => {
  runVerificationPassForAllUsers(getValidAccessToken).catch(err =>
    console.error('[cron] verification pass failed:', err.message)
  )
})

app.listen(PORT, () => console.log(`[server] Photo Curator backend v2.11 listening on :${PORT}`))
