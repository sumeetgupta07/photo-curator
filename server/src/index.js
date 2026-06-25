// index.js — v2.1
// PURPOSE: Photo Curator backend — all Express routes.
// v2.1 changes vs v2.0 Stage 3:
//   - Removed /api/image-proxy/by-id (required getMediaItem → 403 scope error)
//   - Added express.static serving /app/data/thumbs under /api/thumbs
//     (no auth needed — URLs are unguessable upload IDs on a private LAN)
//   - Added POST /api/cleanup — deletes thumbnail files for all uploads in
//     the current session; called by frontend "Clear Session" flow
//   - ensureThumbDirs() called at startup
import 'dotenv/config'
import express from 'express'
import cookieParser from 'cookie-parser'
import crypto from 'node:crypto'
import { saveSession, getSession, deleteSession,
  createUploadRow, getReadyUploads,
  getUploadStatusCounts, getUploadRow, updateUploadStatus,
  getUploadByOurMediaItemId, setSwipeDecision,
  getUploadIdsBySession } from './db.js'
import { buildAuthUrl, exchangeCodeForTokens, getValidAccessToken } from './google-auth.js'
import { createPickerSession, getPickerSession, deletePickerSession, fetchPickerItems } from './picker.js'
import { kickWorkerPool, registerBaseUrl, registerRowContext } from './worker.js'
import { createAlbum, batchAddMediaItems } from './library-upload.js'
import { ensureThumbDirs, deleteThumbsBulk } from './thumbs.js'

const app = express()
const PORT = process.env.PORT || 3001
const SESSION_COOKIE = 'pc_session'
const IS_PROD = process.env.NODE_ENV === 'production'

ensureThumbDirs().catch(err => console.warn('[startup] ensureThumbDirs failed:', err.message))

app.use(cookieParser())
app.use(express.json())

// Serve local thumbnails — no auth, private LAN, IDs are unguessable
// GET /api/thumbs/400/{uploadId}.jpg  → 400px thumbnail
// GET /api/thumbs/1600/{uploadId}.jpg → 1600px full-swipe image
app.use('/api/thumbs', express.static('/app/data/thumbs', {
  maxAge: '1h',
  immutable: false,
}))

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
  if (!sessionId || !getSession(sessionId)) {
    return res.status(401).json({ error: 'NOT_AUTHENTICATED' })
  }
  req.sessionId = sessionId
  next()
}

// ── OAuth ─────────────────────────────────────────────────────────────────────

app.get('/api/oauth/start', (req, res) => {
  const state = makeState()
  res.redirect(buildAuthUrl(state))
})

app.get('/api/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query
  if (error) return res.redirect('/?auth_error=' + encodeURIComponent(String(error)))
  if (!code || !state || !consumeState(String(state))) return res.redirect('/?auth_error=invalid_state')

  try {
    const tokens = await exchangeCodeForTokens(String(code))
    if (!tokens.refresh_token) {
      console.error('[oauth/callback] No refresh_token in response.')
      return res.redirect('/?auth_error=no_refresh_token')
    }

    let email = null
    try {
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      })
      if (profileRes.ok) { const d = await profileRes.json(); email = d.email || null }
    } catch (e) { console.warn('[oauth/callback] userinfo fetch failed:', e.message) }

    const sessionId = crypto.randomBytes(24).toString('hex')
    const now = Math.floor(Date.now() / 1000)
    saveSession(sessionId, {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessTokenExp: now + tokens.expires_in,
      googleEmail: email,
    })

    res.cookie(SESSION_COOKIE, sessionId, {
      httpOnly: true, secure: IS_PROD, sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 90,
    })
    res.redirect('/')
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

app.post('/api/logout', (req, res) => {
  const sessionId = req.cookies[SESSION_COOKIE]
  if (sessionId) deleteSession(sessionId)
  res.clearCookie(SESSION_COOKIE)
  res.json({ ok: true })
})

// ── Image proxy (baseUrl-based, for Picker previews if ever needed) ───────────
app.get('/api/image-proxy', requireSession, async (req, res) => {
  const { baseUrl, size } = req.query
  if (!baseUrl || typeof baseUrl !== 'string') return res.status(400).json({ error: 'MISSING_BASE_URL' })
  let parsed
  try { parsed = new URL(baseUrl) } catch { return res.status(400).json({ error: 'INVALID_BASE_URL' }) }
  if (parsed.hostname !== 'lh3.googleusercontent.com') return res.status(400).json({ error: 'DISALLOWED_HOST' })

  try {
    const accessToken = await getValidAccessToken(req.sessionId)
    const upstream = await fetch(baseUrl + (typeof size === 'string' ? size : ''), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
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
  try {
    const accessToken = await getValidAccessToken(req.sessionId)
    res.json(await createPickerSession(accessToken))
  } catch (err) { res.status(502).json({ error: 'PICKER_SESSION_CREATE_FAILED', message: err.message }) }
})

app.get('/api/picker/sessions/:id', requireSession, async (req, res) => {
  try {
    const accessToken = await getValidAccessToken(req.sessionId)
    res.json(await getPickerSession(accessToken, req.params.id))
  } catch (err) { res.status(502).json({ error: 'PICKER_SESSION_GET_FAILED', message: err.message }) }
})

app.get('/api/picker/sessions/:id/items', requireSession, async (req, res) => {
  try {
    const accessToken = await getValidAccessToken(req.sessionId)
    res.json({ items: await fetchPickerItems(accessToken, req.params.id) })
  } catch (err) { res.status(502).json({ error: 'PICKER_ITEMS_FETCH_FAILED', message: err.message }) }
})

app.delete('/api/picker/sessions/:id', requireSession, async (req, res) => {
  try {
    const accessToken = await getValidAccessToken(req.sessionId)
    await deletePickerSession(accessToken, req.params.id)
    res.json({ ok: true })
  } catch (err) { res.json({ ok: false }) }
})

// ── Upload pipeline ───────────────────────────────────────────────────────────

const WORKING_ALBUM_TITLE = 'Photo Curator — Inbox'
let workingAlbumId = null

async function getOrCreateWorkingAlbum(sessionId) {
  if (workingAlbumId) return workingAlbumId
  const accessToken = await getValidAccessToken(sessionId)
  const album = await createAlbum(accessToken, WORKING_ALBUM_TITLE)
  workingAlbumId = album.id
  return workingAlbumId
}

app.post('/api/picker-session/:id/start-upload', requireSession, async (req, res) => {
  const pickerSessionId = req.params.id
  const items = req.body?.items
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'MISSING_ITEMS' })

  try {
    const albumId = await getOrCreateWorkingAlbum(req.sessionId)
    let enqueued = 0
    for (const item of items) {
      if (!item.id || !item.baseUrl) continue
      const rowId = createUploadRow({
        sessionId: req.sessionId, pickerSessionId,
        pickerItemId: item.id, filename: item.filename || null,
        fileSize: item.fileSize || null,
        creationTime: item.mediaMetadata?.creationTime || null,
        mimeType: item.mimeType || null,
      })
      registerBaseUrl(rowId, item.baseUrl)
      registerRowContext(rowId, { sessionId: req.sessionId, albumIdForUploads: albumId })
      enqueued++
    }
    kickWorkerPool()
    res.json({ ok: true, enqueued })
  } catch (err) {
    res.status(502).json({ error: 'START_UPLOAD_FAILED', message: err.message })
  }
})

app.get('/api/uploads/status', requireSession, (req, res) => {
  const { pickerSessionId } = req.query
  if (!pickerSessionId) return res.status(400).json({ error: 'MISSING_PICKER_SESSION_ID' })
  res.json(getUploadStatusCounts(String(pickerSessionId)))
})

app.get('/api/uploads/ready', requireSession, (req, res) => {
  const { pickerSessionId } = req.query
  if (!pickerSessionId) return res.status(400).json({ error: 'MISSING_PICKER_SESSION_ID' })
  const rows = getReadyUploads(String(pickerSessionId))
  res.json({
    items: rows.map(r => ({
      uploadId: r.id,
      pickerItemId: r.picker_item_id,
      filename: r.filename,
      ourMediaItemId: r.our_media_item_id,
      isDuplicate: !!r.is_duplicate,
      exif: {
        dateTaken: r.exif_date_taken,
        gpsLat: r.exif_gps_lat,
        gpsLon: r.exif_gps_lon,
        cameraMake: r.exif_camera_make,
        cameraModel: r.exif_camera_model,
      },
    })),
  })
})

app.post('/api/uploads/:id/retry', requireSession, (req, res) => {
  const row = getUploadRow(Number(req.params.id))
  if (!row || row.session_id !== req.sessionId) return res.status(404).json({ error: 'NOT_FOUND' })
  if (row.status !== 'failed') return res.status(400).json({ error: 'NOT_FAILED' })
  updateUploadStatus(row.id, 'pending', { error_message: null })
  kickWorkerPool()
  res.json({ ok: true })
})

// ── Cleanup — v2.1 ────────────────────────────────────────────────────────────
// POST /api/cleanup — deletes local thumbnail files for all uploads belonging
// to this session. Called by the frontend "Clear Session" button before
// resetting the store. Non-fatal: errors are logged but a 200 is returned
// so the frontend clear flow is never blocked.
app.post('/api/cleanup', requireSession, async (req, res) => {
  try {
    const ids = getUploadIdsBySession(req.sessionId)
    await deleteThumbsBulk(ids)
    console.log(`[cleanup] deleted thumbnails for ${ids.length} uploads (session ${req.sessionId.slice(0, 8)}…)`)
    res.json({ ok: true, deleted: ids.length })
  } catch (err) {
    console.error('[cleanup] failed (non-fatal):', err.message)
    res.json({ ok: false, error: err.message })
  }
})

// ── Swipe routing ─────────────────────────────────────────────────────────────

const albumIdCache = new Map()
async function getOrCreateNamedAlbum(sessionId, title) {
  if (albumIdCache.has(title)) return albumIdCache.get(title)
  const accessToken = await getValidAccessToken(sessionId)
  const album = await createAlbum(accessToken, title)
  albumIdCache.set(title, album.id)
  return album.id
}

app.post('/api/swipe', requireSession, async (req, res) => {
  const { ourMediaItemId, decision } = req.body || {}
  if (!ourMediaItemId || !['good', 'bad', 'skip'].includes(decision)) {
    return res.status(400).json({ error: 'INVALID_BODY' })
  }

  const row = getUploadByOurMediaItemId(req.sessionId, ourMediaItemId)
  if (!row) return res.status(404).json({ error: 'NOT_FOUND' })

  setSwipeDecision(row.id, decision)

  if (decision === 'skip') return res.json({ ok: true, decision: 'skip', albumId: null })

  try {
    const albumTitle = decision === 'good' ? 'Good' : 'Bad'
    const albumId = await getOrCreateNamedAlbum(req.sessionId, albumTitle)
    const accessToken = await getValidAccessToken(req.sessionId)
    await batchAddMediaItems(accessToken, albumId, [ourMediaItemId])
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

app.listen(PORT, () => {
  console.log(`[server] Photo Curator backend v2.1 listening on :${PORT}`)
})
