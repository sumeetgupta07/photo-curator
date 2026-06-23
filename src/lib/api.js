// api.js — v2.0 Stage 1
//
// Remaining client-side Google-related helpers: album functions (currently
// INERT pending Stage 3 — see useSwipeActions.js header), the photoUrl()
// string-builder (kept for reference/back-compat, no longer the primary
// path — see useAuthedImage.js v2.0, which builds /api/image-proxy URLs
// instead), and groupByDate (pure client-side logic, unaffected by any of
// this).
//
// REMOVED in Stage 1: createPickerSession, getPickerSession,
// fetchPickerItems, deletePickerSession, normalizePickerItem, and the
// request()/pickerReq() helpers. These called Google's Picker API directly
// with a browser-held token, which no longer exists (Stage 1 moved all
// Picker calls server-side — see lib/backendApi.js and
// server/src/picker.js). Keeping dead functions that reference a
// nonexistent `token` param risked confusing future edits, so they're
// fully removed rather than left commented out.
//
// album functions still take a `token` param for now and are unchanged
// from v0.7 — they're simply never called with a real token in this stage
// (useSwipeActions.js's guards keep them inert). Stage 3 will rewire these
// to a new backend /api/swipe endpoint instead of calling Google directly;
// at that point this file's album functions will likely be removed too.
import { getCachedAlbumId, setCachedAlbumId } from './storage.js'

const PHOTOS_API = 'https://photoslibrary.googleapis.com/v1'

async function photosReq(token, path, options = {}) {
  const res = await fetch(`${PHOTOS_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })

  if (res.status === 401) throw new Error('TOKEN_EXPIRED')

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`
    try { const b = await res.json(); errMsg = b?.error?.message || b?.message || errMsg } catch {}
    throw new Error(errMsg)
  }

  if (res.status === 204) return null
  return res.json()
}

// ── Image URL helper ──────────────────────────────────────────────────────────
// Builds a Picker baseUrl + sizing suffix string. Kept for reference, but
// no longer the primary image-loading path — see useAuthedImage.js v2.0,
// which builds /api/image-proxy URLs (our own backend) instead, since
// direct browser fetch of lh3.googleusercontent.com is CORS-blocked
// regardless of auth (see Session Handover notes on the CORS bug found
// during v0.7 testing).
// sizeParam examples: '=w400-h400-c', '=w1200', '=w800'

export function photoUrl(baseUrl, sizeParam) {
  if (!baseUrl) return ''
  return `${baseUrl}${sizeParam}`
}

// ── Albums (Library API — appendonly scope) ───────────────────────────────────
// INERT in Stage 1 — see useSwipeActions.js header for why these are never
// actually invoked with a real token right now.

export async function listAlbums(token) {
  const res = await photosReq(token, '/albums?pageSize=50')
  return res.albums || []
}

export async function createAlbum(token, title) {
  return photosReq(token, '/albums', {
    method: 'POST',
    body: JSON.stringify({ album: { title } }),
  })
}

export async function batchAddToAlbum(token, albumId, mediaItemIds) {
  if (!mediaItemIds?.length) return null
  return photosReq(token, `/albums/${albumId}:batchAddMediaItems`, {
    method: 'POST',
    body: JSON.stringify({ mediaItemIds }),
  })
}

export async function getOrCreateAlbum(token, title) {
  const cached = getCachedAlbumId(title)
  if (cached) return cached

  const created = await createAlbum(token, title)
  setCachedAlbumId(title, created.id)
  return created.id
}

// ── Date grouping ─────────────────────────────────────────────────────────────

export function groupByDate(items) {
  const groups = {}
  for (const item of items) {
    const raw = item.mediaMetadata?.creationTime
    const d   = raw ? new Date(raw) : null
    const key = d
      ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      : 'unknown'
    if (!groups[key]) groups[key] = []
    groups[key].push(item)
  }
  return Object.entries(groups)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, items]) => ({ date, label: formatDateLabel(date), items }))
}

function formatDateLabel(dateStr) {
  if (dateStr === 'unknown') return 'Unknown date'
  const d         = new Date(dateStr + 'T12:00:00')
  const today     = new Date()
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  if (dateStr === toDateStr(today))     return 'Today'
  if (dateStr === toDateStr(yesterday)) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' })
}

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
