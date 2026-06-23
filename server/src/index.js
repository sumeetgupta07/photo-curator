// index.js — v2.0 Stage 3
//
// Stage 3: adds /api/swipe — the endpoint that finally wires swipe
// decisions to real Google Photos album writes. Works because Stage 2
// guarantees every item has our_media_item_id (app-created, satisfying
// Google's batchAddMediaItems ownership requirement). Also adds
// /api/swipe-decisions for the frontend to hydrate persisted decisions on
// reload (so swipe history isn't lost across page refreshes).
//
// PURPOSE: Photo Curator backend.
//
// Stage 1: Google OAuth (code flow, refresh tokens), image proxy, Picker
// session proxy routes.
//
// Stage 2 (this version): the download/re-upload pipeline.
//   - POST /api/picker-session/:id/start-upload — takes the already-fetched
//     Picker items (frontend has these from GET .../items already) and
//     enqueues each as a row in the uploads table, then kicks the worker
//     pool. Creates/reuses the "Curated" working album that all re-uploads
//     land in (separate from the eventual Good/Bad albums — see Stage 3).
//   - GET /api/uploads/status?pickerSessionId=... — queue-level counts for
//     the monitoring UI.
//   - GET /api/uploads/ready?pickerSessionId=... — items with status=done,
//     i.e. swipeable (has our_media_item_id). Frontend polls this to grow
//     the swipe stack incrementally as uploads complete.
//   - POST /api/uploads/:id/retry — resets a failed row back to pending.
//
// Still NOT in scope: /api/swipe (the actual Good/Bad album routing) —
// that's Stage 3, since it needs our_media_item_id from this stage's work
// to exist first.
import 'dotenv/config'
import express from 'express'
import cookieParser from 'cookie-parser'
import crypto from 'node:crypto'
import { saveSession, getSession, deleteSession,
  createUploadRow, getUploadsByPickerSession, getReadyUploads,
  getUploadStatusCounts, getUploadRow, updateUploadStatus,
  getUploadByOurMediaItemId, setSwipeDecision } from './db.js'
import { buildAuthUrl, exchangeCodeForTokens, getValidAccessToken } from './google-auth.js'
import { createPickerSession, getPickerSession, deletePickerSession, fetchPickerItems } from './picker.js'
import { kickWorkerPool, registerBaseUrl, registerRowContext } from './worker.js'
import { createAlbum, getMediaItem, batchAddMediaItems } from './library-upload.js'

const app = express()
const PORT = process.env.PORT || 3001
const SESSION_COOKIE = 'pc_session'
const IS_PROD = process.env.NODE_ENV === 'production'

app.use(cookieParser())
app.use(express.json())

// In-memory map for short-lived OAuth `state` values (CSRF protection
// during the redirect round-trip). Not persisted — a server restart
// mid-login just means the user retries, which is an acceptable edge case.
const pendingStates = new Map() // state -> expiry timestamp
function makeState() {
  const state = crypto.randomBytes(16).toString('hex')
  pendingStates.set(state, Date.now() + 5 * 60_000) // 5 min to complete login
  return state
}
function consumeState(state) {
  const exp = pendingStates.get(state)
  pendingStates.delete(state)
  return exp && Date.now() < exp
}

// ── Auth middleware ─────────────────────────────────────────────────────────
function requireSession(req, res, next) {
  const sessionId = req.cookies[SESSION_COOKIE]
  if (!sessionId || !getSession(sessionId)) {
    return res.status(401).json({ error: 'NOT_AUTHENTICATED' })
  }
  req.sessionId = sessionId
  next()
}

// ── OAuth routes ─────────────────────────────────────────────────────────────

app.get('/api/oauth/start', (req, res) => {
  const state = makeState()
  res.redirect(buildAuthUrl(state))
})

app.get('/api/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query

  if (error) {
    return res.redirect('/?auth_error=' + encodeURIComponent(String(error)))
  }
  if (!code || !state || !consumeState(String(state))) {
    return res.redirect('/?auth_error=invalid_state')
  }

  try {
    const tokens = await exchangeCodeForTokens(String(code))
    if (!tokens.refresh_token) {
      console.error('[oauth/callback] No refresh_token in response.')
      return res.redirect('/?auth_error=no_refresh_token')
    }

    // --- FETCH USER EMAIL ---
    let email = null
    try {
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      })
      if (profileRes.ok) {
        const profileData = await profileRes.json()
        email = profileData.email || null
      }
    } catch (profileErr) {
      console.warn('[oauth/callback] Could not fetch user profile details:', profileErr.message)
    }
    // ------------------------

    const sessionId = crypto.randomBytes(24).toString('hex')
    const now = Math.floor(Date.now() / 1000)
    
    saveSession(sessionId, {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessTokenExp: now + tokens.expires_in,
      googleEmail: email // Make sure your db.js saveSession maps this to your google_email column!
    })

    res.cookie(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: 'lax',
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

// ── Image proxy ──────────────────────────────────────────────────────────────
// GET /api/image-proxy?baseUrl=<picker baseUrl>&size=<suffix e.g. =w400-h400-c>
// Fetches the image server-side with the required Bearer token and streams
// it back. baseUrl must be a lh3.googleusercontent.com URL — reject
// anything else to avoid this becoming an open proxy.
app.get('/api/image-proxy', requireSession, async (req, res) => {
  const { baseUrl, size } = req.query
  if (!baseUrl || typeof baseUrl !== 'string') {
    return res.status(400).json({ error: 'MISSING_BASE_URL' })
  }
  let parsed
  try { parsed = new URL(baseUrl) } catch { return res.status(400).json({ error: 'INVALID_BASE_URL' }) }
  if (parsed.hostname !== 'lh3.googleusercontent.com') {
    return res.status(400).json({ error: 'DISALLOWED_HOST' })
  }

  try {
    const accessToken = await getValidAccessToken(req.sessionId)
    const targetUrl = baseUrl + (typeof size === 'string' ? size : '')

    const upstream = await fetch(targetUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!upstream.ok) {
      console.error('[image-proxy] upstream error:', upstream.status, targetUrl.slice(0, 80))
      return res.status(upstream.status).json({ error: 'UPSTREAM_ERROR', status: upstream.status })
    }

    res.set('Content-Type', upstream.headers.get('content-type') || 'image/jpeg')
    res.set('Cache-Control', 'private, max-age=3600')
    const buf = Buffer.from(await upstream.arrayBuffer())
    res.send(buf)
  } catch (err) {
    if (err.message === 'NO_SESSION') return res.status(401).json({ error: 'NOT_AUTHENTICATED' })
    console.error('[image-proxy] failed:', err.message)
    res.status(502).json({ error: 'PROXY_FAILED', message: err.message })
  }
})

// GET /api/image-proxy/by-id?mediaItemId=...&size=...
// For items we re-uploaded ourselves (Stage 2+) — looks up a fresh baseUrl
// via mediaItems.get (baseUrls expire ~60min and aren't persisted, see
// worker.js), then proxies the same way as /api/image-proxy. Small in-
// memory cache on the fresh baseUrl avoids a mediaItems.get round-trip on
// every single image request (e.g. grid re-renders) within its validity
// window.
const mediaItemBaseUrlCache = new Map() // mediaItemId -> { baseUrl, fetchedAt }
const MEDIA_ITEM_CACHE_TTL_MS = 50 * 60_000 // refresh a bit before the real ~60min expiry

app.get('/api/image-proxy/by-id', requireSession, async (req, res) => {
  const { mediaItemId, size } = req.query
  if (!mediaItemId || typeof mediaItemId !== 'string') {
    return res.status(400).json({ error: 'MISSING_MEDIA_ITEM_ID' })
  }

  try {
    const accessToken = await getValidAccessToken(req.sessionId)

    let cached = mediaItemBaseUrlCache.get(mediaItemId)
    if (!cached || Date.now() - cached.fetchedAt > MEDIA_ITEM_CACHE_TTL_MS) {
      const mediaItem = await getMediaItem(accessToken, mediaItemId)
      cached = { baseUrl: mediaItem.baseUrl, fetchedAt: Date.now() }
      mediaItemBaseUrlCache.set(mediaItemId, cached)
    }

    const targetUrl = cached.baseUrl + (typeof size === 'string' ? size : '')
    const upstream = await fetch(targetUrl, { headers: { Authorization: `Bearer ${accessToken}` } })

    if (!upstream.ok) {
      console.error('[image-proxy/by-id] upstream error:', upstream.status, mediaItemId)
      return res.status(upstream.status).json({ error: 'UPSTREAM_ERROR', status: upstream.status })
    }

    res.set('Content-Type', upstream.headers.get('content-type') || 'image/jpeg')
    res.set('Cache-Control', 'private, max-age=3600')
    res.send(Buffer.from(await upstream.arrayBuffer()))
  } catch (err) {
    if (err.message === 'NO_SESSION') return res.status(401).json({ error: 'NOT_AUTHENTICATED' })
    console.error('[image-proxy/by-id] failed:', err.message)
    res.status(502).json({ error: 'PROXY_FAILED', message: err.message })
  }
})

// ── Picker API proxy ──────────────────────────────────────────────────────────
// Browser never holds a Google token (Stage 1 design) — these routes do the
// Picker API calls server-side using the session's managed access token,
// mirroring what the old frontend src/lib/api.js did directly.

app.post('/api/picker/sessions', requireSession, async (req, res) => {
  try {
    const accessToken = await getValidAccessToken(req.sessionId)
    const session = await createPickerSession(accessToken)
    res.json(session) // { id, pickerUri, pollingConfig, expireTime }
  } catch (err) {
    console.error('[picker/sessions create] failed:', err.message)
    res.status(502).json({ error: 'PICKER_SESSION_CREATE_FAILED', message: err.message })
  }
})

app.get('/api/picker/sessions/:id', requireSession, async (req, res) => {
  try {
    const accessToken = await getValidAccessToken(req.sessionId)
    const session = await getPickerSession(accessToken, req.params.id)
    res.json(session)
  } catch (err) {
    console.error('[picker/sessions get] failed:', err.message)
    res.status(502).json({ error: 'PICKER_SESSION_GET_FAILED', message: err.message })
  }
})

app.get('/api/picker/sessions/:id/items', requireSession, async (req, res) => {
  try {
    const accessToken = await getValidAccessToken(req.sessionId)
    const items = await fetchPickerItems(accessToken, req.params.id)
    res.json({ items })
  } catch (err) {
    console.error('[picker/sessions items] failed:', err.message)
    res.status(502).json({ error: 'PICKER_ITEMS_FETCH_FAILED', message: err.message })
  }
})

app.delete('/api/picker/sessions/:id', requireSession, async (req, res) => {
  try {
    const accessToken = await getValidAccessToken(req.sessionId)
    await deletePickerSession(accessToken, req.params.id)
    res.json({ ok: true })
  } catch (err) {
    // Non-fatal — session cleanup failing shouldn't block the user
    console.warn('[picker/sessions delete] failed (non-fatal):', err.message)
    res.json({ ok: false })
  }
})

// ── Upload pipeline (Stage 2) ─────────────────────────────────────────────────
// All re-uploaded items land in one shared "working" album first (created
// once, reused forever — same cached pattern the old frontend used for
// Good/Bad). This isn't the final Good/Bad album from Stage 3 — it's just
// where every re-upload goes so it's easy to find/verify in Google Photos
// during this stage, before Stage 3 adds the actual swipe-routing.
const WORKING_ALBUM_TITLE = 'Photo Curator — Inbox'
let workingAlbumId = null // in-memory cache; cold on server restart, recreated lazily (cheap, idempotent enough for a personal tool)

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
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'MISSING_ITEMS' })
  }

  try {
    const albumId = await getOrCreateWorkingAlbum(req.sessionId)

    let enqueued = 0
    for (const item of items) {
      if (!item.id || !item.baseUrl) continue
      const rowId = createUploadRow({
        sessionId: req.sessionId,
        pickerSessionId,
        pickerItemId: item.id,
        filename: item.filename || null,
        fileSize: item.fileSize || null,   // Picker items don't always include size; null is fine, dedup just won't match on it
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
    console.error('[start-upload] failed:', err.message)
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
  if (!row || row.session_id !== req.sessionId) {
    return res.status(404).json({ error: 'NOT_FOUND' })
  }
  if (row.status !== 'failed') {
    return res.status(400).json({ error: 'NOT_FAILED', message: 'Only failed uploads can be retried' })
  }
  // Re-registering baseUrl/context isn't possible after a restart (in-
  // memory maps are gone) — if this retry is happening in the same
  // process lifetime as the original enqueue, the worker can still find
  // it; otherwise the caller should re-run start-upload instead. Surface
  // that clearly rather than silently failing again.
  updateUploadStatus(row.id, 'pending', { error_message: null })
  kickWorkerPool()
  res.json({ ok: true })
})

// ── Swipe routing — Stage 3 ───────────────────────────────────────────────────
// Album ID cache (in-memory, per the same lazy-create-once pattern used for
// the working album above). Good/Bad albums are separate from the Stage 2
// "Inbox" working album — items live in both. This is intentional:
// - Inbox: every re-upload lands here (easy to see/verify the raw copies)
// - Good/Bad: swipe routing, for the "review Bad and delete" workflow
// Cold on server restart, recreated lazily on first swipe after restart.
const albumIdCache = new Map() // albumTitle -> albumId

async function getOrCreateNamedAlbum(sessionId, title) {
  if (albumIdCache.has(title)) return albumIdCache.get(title)
  const accessToken = await getValidAccessToken(sessionId)
  const album = await createAlbum(accessToken, title)
  albumIdCache.set(title, album.id)
  return album.id
}

// POST /api/swipe
// Body: { ourMediaItemId, decision: 'good'|'bad'|'skip' }
// - Persists the decision to the uploads row (swipe_decision column)
// - For good/bad: creates/reuses the album and calls batchAddMediaItems
// - For skip: just persists the decision, no album write needed
// - "Latest action wins": if the same ourMediaItemId is swiped again
//   with a different decision, the album write for the NEW decision is
//   made. Note: we don't *remove* from the old album (Library API has
//   no removeMediaItems endpoint), but the item will appear in both —
//   this is an acceptable trade-off for a personal curation tool.
app.post('/api/swipe', requireSession, async (req, res) => {
  const { ourMediaItemId, decision } = req.body || {}
  if (!ourMediaItemId || !['good', 'bad', 'skip'].includes(decision)) {
    return res.status(400).json({ error: 'INVALID_BODY', message: 'ourMediaItemId and decision (good|bad|skip) are required' })
  }

  const row = getUploadByOurMediaItemId(req.sessionId, ourMediaItemId)
  if (!row) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'No upload found for this ourMediaItemId in this session' })
  }

  // Persist immediately so even if the album write fails, the decision
  // is remembered for retry/display purposes.
  setSwipeDecision(row.id, decision)

  if (decision === 'skip') {
    return res.json({ ok: true, decision: 'skip', albumId: null })
  }

  try {
    const albumTitle = decision === 'good' ? 'Good' : 'Bad'
    const albumId = await getOrCreateNamedAlbum(req.sessionId, albumTitle)
    const accessToken = await getValidAccessToken(req.sessionId)
    await batchAddMediaItems(accessToken, albumId, [ourMediaItemId])
    console.log(`[Swipe] ${ourMediaItemId.slice(0, 20)}… → "${albumTitle}" ✓`)
    res.json({ ok: true, decision, albumId })
  } catch (err) {
    console.error('[Swipe] album write failed:', err.message, { ourMediaItemId, decision })
    // Decision is already persisted — frontend can retry via this same
    // endpoint without re-swiping. Surface the error clearly.
    res.status(502).json({ error: 'ALBUM_WRITE_FAILED', message: err.message, decision })
  }
})

// GET /api/swipe-decisions?pickerSessionId=...
// Returns all persisted swipe decisions for a picker session — used by the
// frontend on load to hydrate swipe history (so swipe position + decisions
// survive page refreshes without re-swiping). Only returns done items
// (ones with our_media_item_id) that have a decision set.
app.get('/api/swipe-decisions', requireSession, (req, res) => {
  const { pickerSessionId } = req.query
  if (!pickerSessionId) return res.status(400).json({ error: 'MISSING_PICKER_SESSION_ID' })
  const rows = getReadyUploads(String(pickerSessionId))
    .filter(r => r.swipe_decision)
    .map(r => ({ ourMediaItemId: r.our_media_item_id, decision: r.swipe_decision }))
  res.json({ decisions: rows })
})

app.listen(PORT, () => {
  console.log(`[server] Photo Curator backend listening on :${PORT}`)
})
