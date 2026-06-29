// worker.js — v2.3
// PURPOSE: Download → Live Photo probe → dedup → EXIF → thumbnail → re-upload pipeline.
// v2.3 changes:
//   - Live Photo detection: after downloading still, probe baseUrl=dv for MOV component.
//     If video/quicktime returned (>10KB), mux JPEG/HEIC + MOV into a single
//     Google Motion Photo v2 file via live-photo.js before upload.
//   - Fixed "null" filename: createUploadRow now receives filename, fileSize,
//     creationTime, pickerBaseUrl from index.js start-upload handler.
//   - Google API 429 handling: exponential backoff (8s → 16s → 32s → 64s)
//     with incrementQuotaLog() tracking daily call count.
//   - findDuplicateByHash now scoped by google_email (not session_id) and
//     excludes deleted items.
//   - Duplicate rows no longer reuse another row's our_media_item_id — each
//     gets a fresh upload (fixes "invalid media item id" from Google).

import { getValidAccessToken } from './google-auth.js'
import { extractExif } from './exif.js'
import { uploadBytes, createMediaItem, batchAddMediaItems, createAlbum } from './library-upload.js'
import { generateThumbs, computeDHash } from './thumbs.js'
import { probeLivePhoto, muxLivePhoto } from './live-photo.js'
import {
  db, updateUploadStatus, incrementRetryCount, getUploadRow,
  findDuplicateByHash, getPendingUploads, getSession,
  getCachedAlbumId, setCachedAlbumId, incrementQuotaLog,
} from './db.js'

const MAX_CONCURRENT      = 4
const MAX_RETRIES         = 3
const RETRY_BASE_DELAY_MS = 4000
const QUOTA_429_DELAYS    = [8000, 16000, 32000, 64000] // exponential backoff on 429

const DUPLICATES_ALBUM_TITLE = 'Photo Curator — Duplicates'

let activeWorkers = 0
let queueRunning  = false

// ── Album helpers ─────────────────────────────────────────────────────────────

async function getOrCreateDuplicatesAlbum(sessionId) {
  const session = getSession(sessionId)
  const email   = session?.google_email || null
  if (email) {
    const cached = getCachedAlbumId(email, DUPLICATES_ALBUM_TITLE)
    if (cached) return cached
  }
  const accessToken = await getValidAccessToken(sessionId)
  const album = await createAlbum(accessToken, DUPLICATES_ALBUM_TITLE)
  if (email) setCachedAlbumId(email, DUPLICATES_ALBUM_TITLE, album.id)
  return album.id
}

// ── Serialized batchCreate ────────────────────────────────────────────────────

let batchCreateChain = Promise.resolve()
function serializedCreateMediaItem(accessToken, uploadToken, filename, albumId) {
  const result = batchCreateChain.then(() => createMediaItem(accessToken, uploadToken, filename, albumId))
  batchCreateChain = result.catch(() => {})
  return result
}

// ── Download helpers ──────────────────────────────────────────────────────────

async function downloadWithRetry(url, accessToken, attempt = 0) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (res.status === 429) {
    incrementQuotaLog(1)
    const delay = QUOTA_429_DELAYS[Math.min(attempt, QUOTA_429_DELAYS.length - 1)]
    console.warn(`[worker] 429 rate limit — waiting ${delay / 1000}s before retry`)
    await new Promise(r => setTimeout(r, delay))
    return downloadWithRetry(url, accessToken, attempt + 1)
  }
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  incrementQuotaLog(1)
  return Buffer.from(await res.arrayBuffer())
}

async function downloadStill(accessToken, baseUrl, mimeType) {
  const isVideo = mimeType && mimeType.startsWith('video/')
  return downloadWithRetry(`${baseUrl}${isVideo ? '=dv' : '=d'}`, accessToken)
}

// ── Core worker ───────────────────────────────────────────────────────────────

async function processOne(row, { sessionId, albumIdForUploads }) {
  const session = getSession(sessionId)
  const email   = session?.google_email || null

  try {
    // ── Download still ────────────────────────────────────────────────────
    updateUploadStatus(row.id, 'downloading')
    const accessToken = await getValidAccessToken(sessionId)
    let stillBuffer = await downloadStill(accessToken, row._baseUrl, row.mime_type)

    // ── Live Photo probe ──────────────────────────────────────────────────
    // Probe for MOV component on every image (videos skip this).
    // =dv returns video/quicktime if it's a Live Photo, error/non-video otherwise.
    let isLivePhoto   = false
    let movBuffer     = null
    let uploadBuffer  = stillBuffer
    let uploadMime    = row.mime_type

    const isImage = !row.mime_type?.startsWith('video/')
    if (isImage) {
      const probe = await probeLivePhoto(accessToken, row._baseUrl)
      if (probe.isLivePhoto) {
        isLivePhoto = true
        movBuffer   = probe.movBuffer
        console.log(`[worker] #${row.id} "${row.filename}" — Live Photo detected (MOV: ${(movBuffer.length / 1024).toFixed(0)}KB)`)
        try {
          uploadBuffer = await muxLivePhoto(stillBuffer, movBuffer, row.mime_type)
          console.log(`[worker] #${row.id} muxed Live Photo (${(uploadBuffer.length / 1024).toFixed(0)}KB total)`)
        } catch (muxErr) {
          // Non-fatal: if mux fails, upload the still only (no video component)
          console.warn(`[worker] #${row.id} Live Photo mux failed (uploading still only):`, muxErr.message)
          isLivePhoto = false
          uploadBuffer = stillBuffer
        }
      }
    }

    // ── dHash dedup ───────────────────────────────────────────────────────
    // Always hash the still (not the muxed file) for consistent matching.
    const dhash = await computeDHash(stillBuffer, row.mime_type)
    const dup   = email && dhash
      ? findDuplicateByHash(email, dhash)
      : null

    if (dup && dup.id !== row.id) {
      // Generate thumbs for the duplicate so it appears in Duplicates album view
      try { await generateThumbs(row.id, stillBuffer, row.mime_type) } catch {}

      const dupAlbumId = await getOrCreateDuplicatesAlbum(sessionId)

      // Fresh upload (not reusing dup's our_media_item_id — would be rejected by Google)
      const uploadToken = await uploadBytes(accessToken, uploadBuffer, row.filename, uploadMime)
      incrementQuotaLog(1)
      const mediaItem = await serializedCreateMediaItem(accessToken, uploadToken, row.filename, dupAlbumId)
      incrementQuotaLog(1)

      updateUploadStatus(row.id, 'done', {
        our_media_item_id:   mediaItem.id,
        is_duplicate:        1,
        duplicate_of_id:     dup.id,
        dhash:               String(dhash),
        swipe_decision:      'duplicate',
        is_live_photo:       isLivePhoto ? 1 : 0,
        live_photo_mov_size: movBuffer ? movBuffer.length : null,
      })
      console.log(`[worker] #${row.id} "${row.filename}" — duplicate of #${dup.id}, routed to Duplicates album`)
      return
    }

    // ── Thumbnails ────────────────────────────────────────────────────────
    try { await generateThumbs(row.id, stillBuffer, row.mime_type) }
    catch (err) { console.warn(`[worker] #${row.id} thumb gen failed (non-fatal):`, err.message) }

    // ── EXIF ──────────────────────────────────────────────────────────────
    const exif = await extractExif(stillBuffer, row.mime_type)

    // ── Upload bytes ──────────────────────────────────────────────────────
    updateUploadStatus(row.id, 'uploading')
    const uploadToken = await uploadBytes(accessToken, uploadBuffer, row.filename, uploadMime)
    incrementQuotaLog(1)

    // ── Create media item (serialized) ────────────────────────────────────
    const mediaItem = await serializedCreateMediaItem(accessToken, uploadToken, row.filename, albumIdForUploads)
    incrementQuotaLog(1)

    updateUploadStatus(row.id, 'done', {
      our_media_item_id:   mediaItem.id,
      dhash:               dhash ? String(dhash) : null,
      is_live_photo:       isLivePhoto ? 1 : 0,
      live_photo_mov_size: movBuffer ? movBuffer.length : null,
      exif_raw:            exif.raw ? JSON.stringify(exif.raw) : null,
      exif_date_taken:     exif.dateTaken,
      exif_gps_lat:        exif.gpsLat,
      exif_gps_lon:        exif.gpsLon,
      exif_camera_make:    exif.cameraMake,
      exif_camera_model:   exif.cameraModel,
    })
    const liveTag = isLivePhoto ? ' [Live Photo]' : ''
    console.log(`[worker] #${row.id} "${row.filename}"${liveTag} — done (${mediaItem.id.slice(0, 20)}...)`)

  } catch (err) {
    console.error(`[worker] #${row.id} "${row.filename}" failed:`, err.message)
    incrementRetryCount(row.id)
    const fresh = getUploadRow(row.id)
    if (fresh.retry_count >= MAX_RETRIES) {
      updateUploadStatus(row.id, 'failed', { error_message: err.message })
    } else {
      updateUploadStatus(row.id, 'pending', { error_message: err.message })
      await new Promise(r => setTimeout(r, RETRY_BASE_DELAY_MS * fresh.retry_count))
    }
  }
}

// ── Queue management ──────────────────────────────────────────────────────────

const baseUrlMap    = new Map()
const rowContextMap = new Map()

export function registerBaseUrl(uploadRowId, baseUrl)             { baseUrlMap.set(uploadRowId, baseUrl) }
export function registerRowContext(uploadRowId, ctx)              { rowContextMap.set(uploadRowId, ctx) }

async function runQueueLoop() {
  if (queueRunning) return
  queueRunning = true
  while (true) {
    const pending = getPendingUploads(MAX_CONCURRENT - activeWorkers)
    if (pending.length === 0 && activeWorkers === 0) break
    for (const row of pending) {
      if (activeWorkers >= MAX_CONCURRENT) break
      const ctx = rowContextMap.get(row.id)
      row._baseUrl = baseUrlMap.get(row.id)
      if (!row._baseUrl || !ctx) {
        // v2.8: check if picker_base_url was persisted to DB (restart recovery)
        if (row.picker_base_url) {
          row._baseUrl = row.picker_base_url
          // Rebuild ctx from session — sessionId is on the row
          const session = getSession(row.session_id)
          if (session) {
            rowContextMap.set(row.id, { sessionId: row.session_id, albumIdForUploads: null })
            // albumIdForUploads=null: createMediaItem without album is fine —
            // it lands in "All Photos" rather than Inbox. Acceptable on restart.
          } else {
            console.error(`[worker] #${row.id} no session for restart recovery, marking failed`)
            updateUploadStatus(row.id, 'failed', { error_message: 'INTERNAL: session expired on restart' })
            continue
          }
        } else {
          console.error(`[worker] #${row.id} missing baseUrl or context, marking failed`)
          updateUploadStatus(row.id, 'failed', { error_message: 'INTERNAL: missing baseUrl or session context' })
          continue
        }
      }
      activeWorkers++
      const ctx2 = rowContextMap.get(row.id)
      processOne(row, ctx2).finally(() => {
        activeWorkers--
        baseUrlMap.delete(row.id)
        rowContextMap.delete(row.id)
      })
    }
    await new Promise(r => setTimeout(r, 500))
  }
  queueRunning = false
}

export function kickWorkerPool() {
  runQueueLoop().catch(err => {
    console.error('[worker] queue loop crashed:', err.message)
    queueRunning = false
  })
}
