// thumbs.js — v2.2
// PURPOSE: Local thumbnail generation + perceptual dHash computation.
// v2.2: added computeDHash() — generates a 64-bit difference hash from
// image bytes using sharp. dHash works by resizing to 9×8, converting to
// greyscale, then comparing adjacent pixels in each row to produce a
// 64-bit binary string. Stored in the uploads.dhash column for exact
// duplicate detection across sessions.
// Video frames: extracted via ffmpeg first keyframe, then hashed same way.

import sharp from 'sharp'
import ffmpeg from 'fluent-ffmpeg'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

const THUMB_DIR_400  = '/app/data/thumbs/400'
const THUMB_DIR_1600 = '/app/data/thumbs/1600'

export function thumbPath(uploadId, size) {
  return path.join(size === 400 ? THUMB_DIR_400 : THUMB_DIR_1600, `${uploadId}.jpg`)
}

export async function ensureThumbDirs() {
  await fs.mkdir(THUMB_DIR_400,  { recursive: true })
  await fs.mkdir(THUMB_DIR_1600, { recursive: true })
}

async function extractVideoFrame(buffer) {
  const tmp    = path.join(os.tmpdir(), `pc_video_${Date.now()}.mp4`)
  const outTmp = path.join(os.tmpdir(), `pc_frame_${Date.now()}.jpg`)
  await fs.writeFile(tmp, buffer)
  await new Promise((resolve, reject) => {
    ffmpeg(tmp)
      .inputOptions(['-skip_frame', 'noref'])
      .outputOptions(['-frames:v', '1', '-q:v', '3'])
      .output(outTmp)
      .on('end', resolve)
      .on('error', reject)
      .run()
  })
  const frame = await fs.readFile(outTmp)
  await Promise.allSettled([fs.unlink(tmp), fs.unlink(outTmp)])
  return frame
}

// Compute 64-bit dHash from image buffer.
// Resize to 9×8 greyscale → compare adjacent pixels in each row → 64-bit string.
// Returns null on failure (non-fatal — upload continues without hash).
export async function computeDHash(buffer, mimeType) {
  try {
    let src = buffer
    if (mimeType && mimeType.startsWith('video/')) {
      src = await extractVideoFrame(buffer)
    }
    const { data } = await sharp(src)
      .resize(9, 8, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true })

    let hash = ''
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const left  = data[row * 9 + col]
        const right = data[row * 9 + col + 1]
        hash += left < right ? '1' : '0'
      }
    }
    return hash  // 64-char binary string
  } catch (err) {
    console.warn('[thumbs] dHash computation failed (non-fatal):', err.message)
    return null
  }
}

export async function generateThumbs(uploadId, buffer, mimeType) {
  const isVideo = mimeType && mimeType.startsWith('video/')
  let sourceBuffer
  if (isVideo) {
    try { sourceBuffer = await extractVideoFrame(buffer) }
    catch (err) { console.warn(`[thumbs] video frame extraction failed for #${uploadId}:`, err.message); return }
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

export async function deleteThumbs(uploadId) {
  await Promise.allSettled([
    fs.unlink(thumbPath(uploadId, 400)),
    fs.unlink(thumbPath(uploadId, 1600)),
  ])
}

export async function deleteThumbsBulk(uploadIds) {
  await Promise.all(uploadIds.map(id => deleteThumbs(id)))
}
