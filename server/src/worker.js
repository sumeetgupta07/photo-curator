// worker.js — v2.1
// PURPOSE: Download → dedup → EXIF → re-upload pipeline with local thumbnail
// generation. v2.1 adds generateThumbs() call after download so images are
// available locally without needing Google's getMediaItem (which requires
// photoslibrary.readonly scope, blocked for post-March-2025 projects).
// Thumbnails are stored at /app/data/thumbs/{400,1600}/{uploadId}.jpg.
//
// CONCURRENCY MODEL:
//   - Byte downloads + uploads: parallel, MAX_CONCURRENT workers.
//   - mediaItems:batchCreate: serialized (single-flight chain) per Google docs.

import { getValidAccessToken } from './google-auth.js'
import { extractExif } from './exif.js'
import { uploadBytes, createMediaItem } from './library-upload.js'
import { generateThumbs } from './thumbs.js'
import {
  updateUploadStatus, incrementRetryCount, getUploadRow,
  findDuplicateUpload, getPendingUploads,
} from './db.js'

const MAX_CONCURRENT = 4
const MAX_RETRIES = 3
const RETRY_BASE_DELAY_MS = 4000

let activeWorkers = 0
let queueRunning = false

let batchCreateChain = Promise.resolve()
function serializedCreateMediaItem(accessToken, uploadToken, filename, albumId) {
  const result = batchCreateChain.then(() => createMediaItem(accessToken, uploadToken, filename, albumId))
  batchCreateChain = result.catch(() => {})
  return result
}

async function downloadOriginalBytes(accessToken, baseUrl, mimeType) {
  const isVideo = mimeType && mimeType.startsWith('video/')
  const downloadParam = isVideo ? '=dv' : '=d'
  const res = await fetch(`${baseUrl}${downloadParam}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function processOne(row, { sessionId, albumIdForUploads }) {
  try {
    // ── Dedup ────────────────────────────────────────────────────────────
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
    const buffer = await downloadOriginalBytes(accessToken, row._baseUrl, row.mime_type)

    // ── Thumbnails (v2.1) ─────────────────────────────────────────────────
    // Generate before upload so thumbnails are available even if upload fails.
    // Non-fatal — thumb failure never blocks the upload pipeline.
    try {
      await generateThumbs(row.id, buffer, row.mime_type)
      console.log(`[worker] #${row.id} thumbnails generated`)
    } catch (thumbErr) {
      console.warn(`[worker] #${row.id} thumbnail generation failed (non-fatal):`, thumbErr.message)
    }

    // ── EXIF ─────────────────────────────────────────────────────────────
    const exif = await extractExif(buffer, row.mime_type)

    // ── Upload bytes ──────────────────────────────────────────────────────
    updateUploadStatus(row.id, 'uploading')
    const uploadToken = await uploadBytes(accessToken, buffer, row.filename, row.mime_type)

    // ── Create media item (serialized) ────────────────────────────────────
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
      await new Promise(r => setTimeout(r, RETRY_BASE_DELAY_MS * fresh.retry_count))
    }
  }
}

const baseUrlMap = new Map()
export function registerBaseUrl(uploadRowId, baseUrl) { baseUrlMap.set(uploadRowId, baseUrl) }

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
  runQueueLoop().catch(err => {
    console.error('[worker] queue loop crashed:', err.message)
    queueRunning = false
  })
}
