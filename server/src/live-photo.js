// live-photo.js — v1.0
// PURPOSE: Live Photo detection (via =dv probe) and muxing (JPEG/HEIC still +
// MOV video component → single Google Motion Photo v2 file).
//
// Detection: attempt GET baseUrl=dv — if response is video/quicktime with
// meaningful bytes (>10KB), this is a Live Photo. No Picker API field signals
// this; opportunistic probe is the only viable approach.
//
// Mux strategy (no HEIC→JPEG conversion):
//   1. Inject GCamera XMP namespace into the still's EXIF via exiftool subprocess
//   2. Append the MOV bytes to the still file
//   3. Upload the resulting single file — Google Photos recognises it as a
//      Motion Photo and plays the video component automatically.
//
// References:
//   - MotionPhoto2 (https://github.com/mihairobinson/MotionPhoto2)
//   - Google Motion Photo v2 spec (XMP GCamera:MicroVideo)

import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const MIN_MOV_BYTES = 10 * 1024 // 10KB — below this, =dv returned noise not a real MOV

// ── Probe ────────────────────────────────────────────────────────────────────

/**
 * Probe baseUrl for a MOV component.
 * Returns { isLivePhoto: true, movBuffer } or { isLivePhoto: false }.
 */
export async function probeLivePhoto(accessToken, baseUrl) {
  try {
    const res = await fetch(`${baseUrl}=dv`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return { isLivePhoto: false }
    const ct = res.headers.get('content-type') || ''
    if (!ct.startsWith('video/')) return { isLivePhoto: false }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < MIN_MOV_BYTES) return { isLivePhoto: false }
    return { isLivePhoto: true, movBuffer: buf }
  } catch {
    return { isLivePhoto: false }
  }
}

// ── Mux ──────────────────────────────────────────────────────────────────────

/**
 * Run exiftool as a subprocess. Resolves with stdout, rejects on non-zero exit.
 */
function runExiftool(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('exiftool', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    proc.stdout.on('data', d => { stdout += d })
    proc.stderr.on('data', d => { stderr += d })
    proc.on('close', code => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`exiftool exited ${code}: ${stderr.trim().slice(0, 200)}`))
    })
  })
}

/**
 * Mux a JPEG/HEIC still buffer and a MOV buffer into a single
 * Google Motion Photo v2 file buffer.
 *
 * The output file is: [JPEG/HEIC bytes with GCamera XMP] + [MOV bytes]
 * XMP tags written:
 *   GCamera:MicroVideo = 1
 *   GCamera:MicroVideoVersion = 1
 *   GCamera:MicroVideoOffset = <MOV byte length>  (offset from EOF)
 *   GCamera:MicroVideoPresentationTimestampUs = 0
 *
 * Returns a Buffer of the muxed file.
 */
export async function muxLivePhoto(stillBuffer, movBuffer, mimeType) {
  const ext = mimeType === 'image/heic' || mimeType === 'image/heif' ? '.heic' : '.jpg'
  const tmpStill = path.join(os.tmpdir(), `pc_still_${Date.now()}${ext}`)
  const tmpMuxed = path.join(os.tmpdir(), `pc_muxed_${Date.now()}${ext}`)

  try {
    await fs.writeFile(tmpStill, stillBuffer)

    // Inject GCamera XMP into the still file (exiftool writes in-place)
    await runExiftool([
      '-overwrite_original',
      '-XMP-GCamera:MicroVideo=1',
      '-XMP-GCamera:MicroVideoVersion=1',
      `-XMP-GCamera:MicroVideoOffset=${movBuffer.length}`,
      '-XMP-GCamera:MicroVideoPresentationTimestampUs=0',
      tmpStill,
    ])

    // Read back the XMP-injected still
    const injectedStill = await fs.readFile(tmpStill)

    // Concatenate: still + MOV
    const muxed = Buffer.concat([injectedStill, movBuffer])
    return muxed
  } finally {
    await Promise.allSettled([
      fs.unlink(tmpStill),
      fs.unlink(tmpMuxed),
    ])
  }
}
