// worker.js — v2.0 Stage 2 (new file)
//
// PURPOSE: The download -> dedup -> EXIF-extract -> re-upload pipeline.
// One worker pool runs per backend process (not per-session — concurrency
// is capped globally at MAX_CONCURRENT regardless of how many picker
// sessions are active, to stay within Google's per-user rate limits and
// avoid hammering the home connection's upload bandwidth).
//
// CONCURRENCY MODEL (per Google's documented best practices — see
// server/src/library-upload.js header):
//   - Byte downloads (from Picker baseUrl) and byte uploads (to Google's
//     /uploads endpoint): safe to run in parallel. MAX_CONCURRENT workers
//     pull from the pending queue independently.
//   - mediaItems:batchCreate: must be serialized per user. A single-flight
//     queue (batchCreateQueue) ensures only one batchCreate call is
//     in-flight at a time, even though multiple workers may finish
//     downloading/uploading bytes around the same moment.
//
// DEDUP: before downloading anything, check uploads table for an existing
// `done` row with the same (session_id, filename, file_size, creation_time).
// If found, skip the download/upload entirely and just copy the existing
// our_media_item_id — this is the fast path requested for re-running the
// picker on overlapping photo selections.
import { getValidAccessToken } from './google-auth.js'
import { extractExif } from './exif.js'
import { uploadBytes, createMediaItem } from './library-upload.js'
import {
  updateUploadStatus, incrementRetryCount, getUploadRow,
  findDuplicateUpload, getPendingUploads,
} from './db.js'

const MAX_CONCURRENT = 4   // within the 3-5 concurrent range agreed
const MAX_RETRIES = 3
const RETRY_BASE_DELAY_MS = 4000

let activeWorkers = 0
let queueRunning = false

// Single-flight serialization for batchCreate calls (per Google's
// "don't call batchCreate in parallel for the same user" guidance).
let batchCreateChain = Promise.resolve()
function serializedCreateMediaItem(accessToken, uploadToken, filename, albumId) {
  const result = batchCreateChain.then(() => createMediaItem(accessToken, uploadToken, filename, albumId))
  // Swallow errors in the chain itself so one failure doesn't permanently
  // wedge the queue for subsequent calls — each caller still gets the
  // real rejection via the returned promise.
  batchCreateChain = result.catch(() => {})
  return result
}

async function downloadOriginalBytes(accessToken, baseUrl, mimeType) {
  const isVideo = mimeType && mimeType.startsWith('video/')
  const downloadParam = isVideo ? '=dv' : '=d'
  const res = await fetch(`${baseUrl}${downloadParam}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status}`)
  }
  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

async function processOne(row, { sessionId, albumIdForUploads }) {
  try {
    // ── Dedup check ──────────────────────────────────────────────────────
    const dup = findDuplicateUpload({
      sessionId, filename: row.filename, fileSize: row.file_size, creationTime: row.creation_time,
    })
    if (dup) {
      updateUploadStatus(row.id, 'done', {
        our_media_item_id: dup.our_media_item_id,
        is_duplicate: 1,
        duplicate_of_id: dup.id,
        exif_raw: dup.exif_raw,
        exif_date_taken: dup.exif_date_taken,
        exif_gps_lat: dup.exif_gps_lat,
        exif_gps_lon: dup.exif_gps_lon,
        exif_camera_make: dup.exif_camera_make,
        exif_camera_model: dup.exif_camera_model,
      })
      console.log(`[worker] #${row.id} "${row.filename}" — duplicate of #${dup.id}, skipped download`)
      return
    }

    // ── Download ─────────────────────────────────────────────────────────
    updateUploadStatus(row.id, 'downloading')
    const accessToken = await getValidAccessToken(sessionId)

    // baseUrl isn't stored on the row (it's time-limited, ~60min, no point
    // persisting it) — the caller passes it in via the items map at enqueue
    // time instead. See index.js's start-upload route for how this is wired.
    const buffer = await downloadOriginalBytes(accessToken, row._baseUrl, row.mime_type)

    // ── EXIF extraction (per user request: full raw + promoted fields) ────
    const exif = await extractExif(buffer, row.mime_type)

    // ── Upload bytes ─────────────────────────────────────────────────────
    updateUploadStatus(row.id, 'uploading')
    const uploadToken = await uploadBytes(accessToken, buffer, row.filename, row.mime_type)

    // ── Create media item (serialized) ──────────────────────────────────
    const mediaItem = await serializedCreateMediaItem(accessToken, uploadToken, row.filename, albumIdForUploads)

    updateUploadStatus(row.id, 'done', {
      our_media_item_id: mediaItem.id,
      exif_raw: exif.raw ? JSON.stringify(exif.raw) : null,
      exif_date_taken: exif.dateTaken,
      exif_gps_lat: exif.gpsLat,
      exif_gps_lon: exif.gpsLon,
      exif_camera_make: exif.cameraMake,
      exif_camera_model: exif.cameraModel,
    })
    console.log(`[worker] #${row.id} "${row.filename}" — done (our id: ${mediaItem.id.slice(0, 20)}...)`)
  } catch (err) {
    console.error(`[worker] #${row.id} "${row.filename}" failed:`, err.message)
    incrementRetryCount(row.id)
    const fresh = getUploadRow(row.id)
    if (fresh.retry_count >= MAX_RETRIES) {
      updateUploadStatus(row.id, 'failed', { error_message: err.message })
    } else {
      updateUploadStatus(row.id, 'pending', { error_message: err.message })
      // Exponential backoff before this item becomes eligible again —
      // simplest implementation: a short sleep here, since the queue loop
      // re-polls 'pending' rows anyway rather than using per-item timers.
      await new Promise(r => setTimeout(r, RETRY_BASE_DELAY_MS * fresh.retry_count))
    }
  }
}

// In-memory map of uploadRowId -> baseUrl, populated when items are
// enqueued (see index.js). baseUrls are short-lived (60min) so there's no
// point persisting them to SQLite — if the server restarts mid-upload,
// those specific pending items will need their baseUrl refreshed by
// re-running start-upload for that picker session (acceptable for a
// personal tool; see server/README.md Stage 2 notes for the rationale).
const baseUrlMap = new Map()
export function registerBaseUrl(uploadRowId, baseUrl) {
  baseUrlMap.set(uploadRowId, baseUrl)
}

// uploadRowId -> { sessionId, albumIdForUploads } — registered alongside
// the baseUrl at enqueue time. NOTE: the queue loop is global (one process-
// wide pool, not one per session/user) so it must look up each row's OWN
// session/album rather than being told a single pair up front — multiple
// picker sessions (even across different signed-in users on this backend)
// can have pending rows in the queue at the same time, and each row must
// only ever use its own session's access token and album.
const rowContextMap = new Map()
export function registerRowContext(uploadRowId, { sessionId, albumIdForUploads }) {
  rowContextMap.set(uploadRowId, { sessionId, albumIdForUploads })
}

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
        // Shouldn't normally happen — every enqueued row gets both
        // registered at the same time. Guard anyway rather than crash the
        // whole queue loop on one bad row.
        console.error(`[worker] #${row.id} missing baseUrl or context, marking failed`)
        updateUploadStatus(row.id, 'failed', { error_message: 'INTERNAL: missing baseUrl or session context' })
        continue
      }
      activeWorkers++
      processOne(row, ctx)
        .finally(() => { activeWorkers--; baseUrlMap.delete(row.id); rowContextMap.delete(row.id) })
    }

    await new Promise(r => setTimeout(r, 500))
  }

  queueRunning = false
}

export function kickWorkerPool() {
  // Fire and forget — status is observed via GET /api/uploads/status, not
  // via this function's return value. Safe to call repeatedly; if a loop
  // is already running, this is a no-op (queueRunning guard).
  runQueueLoop().catch(err => {
    console.error('[worker] queue loop crashed:', err.message)
    queueRunning = false
  })
}
