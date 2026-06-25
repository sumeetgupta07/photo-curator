// api.js — v2.0 Stage 1
import { getCachedAlbumId, setCachedAlbumId } from './storage.js'
const PHOTOS_API = 'https://photoslibrary.googleapis.com/v1'
async function photosReq(token, path, options = {}) {
  const res = await fetch(`${PHOTOS_API}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } })
  if (res.status === 401) throw new Error('TOKEN_EXPIRED')
  if (!res.ok) { let e = `HTTP ${res.status}`; try { const b = await res.json(); e = b?.error?.message || e } catch {}; throw new Error(e) }
  if (res.status === 204) return null
  return res.json()
}
export function photoUrl(baseUrl, sizeParam) { if (!baseUrl) return ''; return `${baseUrl}${sizeParam}` }
export async function listAlbums(token) { const res = await photosReq(token, '/albums?pageSize=50'); return res.albums || [] }
export async function createAlbum(token, title) { return photosReq(token, '/albums', { method: 'POST', body: JSON.stringify({ album: { title } }) }) }
export async function batchAddToAlbum(token, albumId, mediaItemIds) { if (!mediaItemIds?.length) return null; return photosReq(token, `/albums/${albumId}:batchAddMediaItems`, { method: 'POST', body: JSON.stringify({ mediaItemIds }) }) }
export async function getOrCreateAlbum(token, title) { const cached = getCachedAlbumId(title); if (cached) return cached; const created = await createAlbum(token, title); setCachedAlbumId(title, created.id); return created.id }
export function groupByDate(items) {
  const groups = {}
  for (const item of items) {
    const raw = item.mediaMetadata?.creationTime
    const d = raw ? new Date(raw) : null
    const key = d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : 'unknown'
    if (!groups[key]) groups[key] = []
    groups[key].push(item)
  }
  return Object.entries(groups).sort(([a],[b]) => b.localeCompare(a)).map(([date, items]) => ({ date, label: formatDateLabel(date), items }))
}
function formatDateLabel(dateStr) {
  if (dateStr === 'unknown') return 'Unknown date'
  const d = new Date(dateStr + 'T12:00:00')
  const today = new Date(); const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1)
  if (dateStr === toDateStr(today)) return 'Today'
  if (dateStr === toDateStr(yesterday)) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' })
}
function toDateStr(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
