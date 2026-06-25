// thumbs.js — v2.1
// PURPOSE: Generate and persist local thumbnails from downloaded image/video
// bytes. Solves the Google Photos API scope limitation where getMediaItem
// (needed to refresh baseUrls) requires photoslibrary.readonly — a scope
// blocked for post-March-2025 projects. Instead we generate two local copies
// from the original bytes during the upload pipeline:
//   - 400×400 max (thumb) → /app/data/thumbs/400/{uploadId}.jpg
//   - 1600×1600 max (full) → /app/data/thumbs/1600/{uploadId}.jpg
// Both preserve aspect ratio. Videos use ffmpeg to extract the first
// keyframe before resizing. Cleanup removes both files.

import sharp from 'sharp'
import ffmpeg from 'fluent-ffmpeg'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import os from 'node:os'

const THUMB_DIR_400  = '/app/data/thumbs/400'
const THUMB_DIR_1600 = '/app/data/thumbs/1600'

export function thumbPath(uploadId, size) {
  const dir = size === 400 ? THUMB_DIR_400 : THUMB_DIR_1600
  return path.join(dir, `${uploadId}.jpg`)
}

// Ensure dirs exist at startup (also created in Dockerfile, belt+suspenders)
export async function ensureThumbDirs() {
  await fs.mkdir(THUMB_DIR_400,  { recursive: true })
  await fs.mkdir(THUMB_DIR_1600, { recursive: true })
}

// Extract first keyframe from video buffer → returns jpeg Buffer
async function extractVideoFrame(buffer) {
  // Write buffer to temp file (ffmpeg needs seekable input)
  const tmp = path.join(os.tmpdir(), `pc_video_${Date.now()}.mp4`)
  const outTmp = path.join(os.tmpdir(), `pc_frame_${Date.now()}.jpg`)
  await fs.writeFile(tmp, buffer)

  await new Promise((resolve, reject) => {
    ffmpeg(tmp)
      .inputOptions(['-skip_frame', 'noref'])   // first keyframe, fastest
      .outputOptions(['-frames:v', '1', '-q:v', '3'])
      .output(outTmp)
      .on('end', resolve)
      .on('error', reject)
      .run()
  })

  const frame = await fs.readFile(outTmp)
  // Clean up temp files
  await Promise.allSettled([fs.unlink(tmp), fs.unlink(outTmp)])
  return frame
}

// Generate both thumbnail sizes from image or video bytes.
// mimeType used to decide image vs video path.
export async function generateThumbs(uploadId, buffer, mimeType) {
  const isVideo = mimeType && mimeType.startsWith('video/')

  let sourceBuffer
  if (isVideo) {
    try {
      sourceBuffer = await extractVideoFrame(buffer)
    } catch (err) {
      console.warn(`[thumbs] video frame extraction failed for #${uploadId}:`, err.message)
      return  // non-fatal — no thumb for this video
    }
  } else {
    sourceBuffer = buffer
  }

  await Promise.all([
    sharp(sourceBuffer)
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toFile(thumbPath(uploadId, 400)),
    sharp(sourceBuffer)
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toFile(thumbPath(uploadId, 1600)),
  ])
}

// Delete both thumbnail files for an upload row. Non-fatal if missing.
export async function deleteThumbs(uploadId) {
  await Promise.allSettled([
    fs.unlink(thumbPath(uploadId, 400)),
    fs.unlink(thumbPath(uploadId, 1600)),
  ])
}

// Delete thumbnails for a list of upload IDs (bulk cleanup).
export async function deleteThumbsBulk(uploadIds) {
  await Promise.all(uploadIds.map(id => deleteThumbs(id)))
}
