// worker.js — v2.2
// PURPOSE: Download → dedup → EXIF → thumbnail → re-upload pipeline.
// v2.2 changes:
//   - Hash-based dedup: after download, compute dHash and check DB.
//     If a match is found, route to "Duplicates" album automatically,
//     mark is_duplicate=1, skip re-upload, exclude from swipe stack.
//   - Fix issue 4: duplicate rows that reuse our_media_item_id from an
//     older upload now get their OWN fresh upload so batchAddMediaItems
//     works correctly. Previously copied ID was rejected by Google.
//   - dhash stored in uploads table for future queries.

import { getValidAccessToken } from './google-auth.js'
import { extractExif } from './exif.js'
import { uploadBytes, createMediaItem, batchAddMediaItems, createAlbum } from './library-upload.js'
import { generateThumbs, computeDHash } from './thumbs.js'
import {
  updateUploadStatus, incrementRetryCount, getUploadRow,
  findDuplicateByHash, getPendingUploads,
} from './db.js'

const MAX_CONCURRENT     = 4
const MAX_RETRIES        = 3
const RETRY_BASE_DELAY_MS = 4000

const DUPLICATES_ALBUM_TITLE = 'Photo Curator — Duplicates'

let activeWorkers  = 0
let queueRunning   = false

// In-memory album ID cache for Duplicates album (same pattern as Good/Bad in index.js)
let duplicatesAlbumId = null
async function getOrCreateDuplicatesAlbum(sessionId) {
  if (duplicatesAlbumId) return duplicatesAlbumId
  const accessToken = await getValidAccessToken(sessionId)
  const album = await createAlbum(accessToken, DUPLICATES_ALBUM_TITLE)
  duplicatesAlbumId = album.id
  return duplicatesAlbumId
}

// Serialized batchCreate chain — Google requires no concurrent batchCreate per user
let batchCreateChain = Promise.resolve()
function serializedCreateMediaItem(accessToken, uploadToken, filename, albumId) {
  const result = batchCreateChain.then(() => createMediaItem(accessToken, uploadToken, filename, albumId))
  batchCreateChain = result.catch(() => {})
  return result
}

async function downloadOriginalBytes(accessToken, baseUrl, mimeType) {
  const isVideo = mimeType && mimeType.startsWith('video/')
  const res = await fetch(`${baseUrl}${isVideo ? '=dv' : '=d'}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function processOne(row, { sessionId, albumIdForUploads }) {
  try {
    // ── Download ─────────────────────────────────────────────────────────
    updateUploadStatus(row.id, 'downloading')
    const accessToken = await getValidAccessToken(sessionId)
    const buffer = await downloadOriginalBytes(accessToken, row._baseUrl, row.mime_type)

    // ── dHash dedup (v2.2) ────────────────────────────────────────────────
    const dhash = await computeDHash(buffer, row.mime_type)
    const dup   = dhash ? findDuplicateByHash(sessionId, dhash) : null

    if (dup) {
      // Generate thumbs for this row so it's visible in the duplicate album view
      try { await generateThumbs(row.id, buffer, row.mime_type) } catch {}

      // Upload fresh copy to Google Photos and add to Duplicates album.
      // We do NOT reuse dup.our_media_item_id — Google rejects foreign IDs
      // in batchAddMediaItems (issue 4 fix).
      updateUploadStatus(row.id, 'uploading')
      const uploadToken  = await uploadBytes(accessToken, buffer, row.filename, row.mime_type)
      const dupAlbumId   = await getOrCreateDuplicatesAlbum(sessionId)
      const mediaItem    = await serializedCreateMediaItem(accessToken, uploadToken, row.filename, dupAlbumId)

      updateUploadStatus(row.id, 'done', {
        our_media_item_id: mediaItem.id,
        is_duplicate:      1,
        duplicate_of_id:   dup.id,
        dhash,
        swipe_decision:    'duplicate',   // sentinel — excluded from swipe stack in getReadyUploads
      })
      console.log(`[worker] #${row.id} "${row.filename}" — duplicate of #${dup.id}, routed to Duplicates album`)
      return
    }

    // ── Thumbnails ────────────────────────────────────────────────────────
    try { await generateThumbs(row.id, buffer, row.mime_type) }
    catch (err) { console.warn(`[worker] #${row.id} thumb gen failed (non-fatal):`, err.message) }

    // ── EXIF ──────────────────────────────────────────────────────────────
    const exif = await extractExif(buffer, row.mime_type)

    // ── Upload bytes ──────────────────────────────────────────────────────
    updateUploadStatus(row.id, 'uploading')
    const uploadToken = await uploadBytes(accessToken, buffer, row.filename, row.mime_type)

    // ── Create media item (serialized) ────────────────────────────────────
    const mediaItem = await serializedCreateMediaItem(accessToken, uploadToken, row.filename, albumIdForUploads)

    updateUploadStatus(row.id, 'done', {
      our_media_item_id: mediaItem.id,
      dhash,
      exif_raw:          exif.raw ? JSON.stringify(exif.raw) : null,
      exif_date_taken:   exif.dateTaken,
      exif_gps_lat:      exif.gpsLat,
      exif_gps_lon:      exif.gpsLon,
      exif_camera_make:  exif.cameraMake,
      exif_camera_model: exif.cameraModel,
    })
    console.log(`[worker] #${row.id} "${row.filename}" — done (${mediaItem.id.slice(0, 20)}...)`)
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

const baseUrlMap   = new Map()
const rowContextMap = new Map()

export function registerBaseUrl(uploadRowId, baseUrl) {
  baseUrlMap.set(uploadRowId, baseUrl)
}
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
      processOne(row, ctx).finally(() => {
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
