// live-photo.js — v1.1
// PURPOSE: Live Photo detection (via =dv probe) and muxing (JPEG/HEIC still +
// MOV video component → single Google Motion Photo v2 file).
//
// v1.1 changes:
//   - probeLivePhoto: full diagnostic logging of every =dv probe result
//     (status, content-type, size). Confirms in docker logs whether Picker API
//     baseUrls actually support =dv.
//   - muxLivePhoto: removed tmpMuxed dead variable (was never written).
//   - muxLivePhoto: returns { buffer, filename } instead of bare Buffer.
//     filename is always .jpg regardless of source MIME type — Google Motion
//     Photo v2 requires JPEG outer container; uploading as .heic causes Google
//     Photos to silently ignore the embedded video.
//   - worker.js caller updated to destructure { buffer, filename } and use
//     returned filename for the upload (not row.filename).

import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const MIN_MOV_BYTES = 10 * 1024

// ── Probe ─────────────────────────────────────────────────────────────────────

export async function probeLivePhoto(accessToken, baseUrl) {
  try {
    const res = await fetch(`${baseUrl}=dv`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const ct = res.headers.get('content-type') || '(none)'

    if (!res.ok) {
      console.log(`[live-photo] =dv probe → HTTP ${res.status} content-type:${ct} — not Live Photo`)
      return { isLivePhoto: false }
    }
    if (!ct.startsWith('video/')) {
      console.log(`[live-photo] =dv probe → HTTP ${res.status} content-type:${ct} — not video, not Live Photo`)
      return { isLivePhoto: false }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < MIN_MOV_BYTES) {
      console.log(`[live-photo] =dv probe → video but only ${buf.length}B < ${MIN_MOV_BYTES}B minimum — not Live Photo`)
      return { isLivePhoto: false }
    }
    console.log(`[live-photo] =dv probe → Live Photo confirmed! MOV: ${(buf.length / 1024).toFixed(0)}KB content-type:${ct}`)
    return { isLivePhoto: true, movBuffer: buf }
  } catch (err) {
    console.warn(`[live-photo] =dv probe error (not Live Photo):`, err.message)
    return { isLivePhoto: false }
  }
}

// ── Mux ──────────────────────────────────────────────────────────────────────

function runExiftool(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('exiftool', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    proc.stdout.on('data', d => { stdout += d })
    proc.stderr.on('data', d => { stderr += d })
    proc.on('close', code => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(`exiftool exited ${code}: ${stderr.trim().slice(0, 300)}`))
    })
  })
}

// Returns { buffer: Buffer, filename: string }
// filename is always .jpg — Google Motion Photo v2 requires JPEG outer container.
// Even HEIC-sourced Live Photos must be uploaded as .jpg for Google Photos to
// recognise and play the embedded video component.
export async function muxLivePhoto(stillBuffer, movBuffer, mimeType, originalFilename) {
  const isHeic   = mimeType === 'image/heic' || mimeType === 'image/heif'
  const tmpExt   = isHeic ? '.heic' : '.jpg'
  const tmpStill = path.join(os.tmpdir(), `pc_still_${Date.now()}${tmpExt}`)

  // Upload filename: always .jpg regardless of source
  const baseName       = (originalFilename || 'photo').replace(/\.[^.]+$/, '')
  const uploadFilename = `${baseName}.jpg`

  try {
    await fs.writeFile(tmpStill, stillBuffer)

    // MicroVideoOffset = movBuffer.length (bytes from EOF back to start of MOV).
    // XMP injection adds bytes to the still but not to the MOV, so the offset
    // from EOF is always movBuffer.length regardless of XMP size.
    const exiftoolOut = await runExiftool([
      '-overwrite_original',
      '-XMP-GCamera:MicroVideo=1',
      '-XMP-GCamera:MicroVideoVersion=1',
      `-XMP-GCamera:MicroVideoOffset=${movBuffer.length}`,
      '-XMP-GCamera:MicroVideoPresentationTimestampUs=0',
      tmpStill,
    ])
    console.log(`[live-photo] exiftool XMP injection: ${exiftoolOut || 'ok'} (+${(await fs.stat(tmpStill)).size - stillBuffer.length}B)`)

    const injectedStill = await fs.readFile(tmpStill)
    const muxed = Buffer.concat([injectedStill, movBuffer])
    console.log(`[live-photo] muxed: ${(muxed.length / 1024).toFixed(0)}KB → "${uploadFilename}"`)

    return { buffer: muxed, filename: uploadFilename }
  } finally {
    await Promise.allSettled([fs.unlink(tmpStill)])
  }
}
