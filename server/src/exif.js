// exif.js — v2.0 Stage 2 (new file)
//
// PURPOSE: Extract EXIF from downloaded photo bytes, server-side, before
// re-uploading. Uses exifr (pure JS, no native bindings — avoids adding a
// second native-compile dependency alongside better-sqlite3). Per user
// request: store the FULL raw EXIF as JSON, plus promote a handful of
// commonly-needed fields (date taken, GPS, camera make/model) into their
// own columns for fast querying later (see db.js's uploads table).
//
// Videos don't carry traditional EXIF — exifr will simply find nothing in
// a video file and return an empty/undefined result, which is handled
// gracefully here (all fields come back null rather than throwing).
import exifr from 'exifr'

const EXIF_PARSE_OPTIONS = {
  tiff: true, ifd0: true, exif: true, gps: true,
  xmp: true, icc: false, iptc: false, jfif: false,
  translateKeys: true, translateValues: true, reviveValues: true,
  sanitize: true, mergeOutput: true,
}

/**
 * Extracts EXIF from a buffer of image bytes. Returns:
 *   { raw: object|null, dateTaken, gpsLat, gpsLon, cameraMake, cameraModel }
 * All fields are null if extraction fails or finds nothing (e.g. videos,
 * or images with no EXIF segment) — this is treated as a normal case, not
 * an error, since plenty of legitimate photos have no EXIF.
 */
export async function extractExif(buffer, mimeType) {
  const empty = { raw: null, dateTaken: null, gpsLat: null, gpsLon: null, cameraMake: null, cameraModel: null }

  // Video formats: exifr can't parse traditional EXIF out of these.
  // Skip straight to empty rather than letting exifr throw/warn on a
  // format it doesn't understand.
  if (mimeType && mimeType.startsWith('video/')) {
    return empty
  }

  try {
    const parsed = await exifr.parse(buffer, EXIF_PARSE_OPTIONS)
    if (!parsed) return empty

    return {
      raw: parsed,
      dateTaken: toIsoOrNull(parsed.DateTimeOriginal || parsed.CreateDate || parsed.ModifyDate),
      gpsLat: typeof parsed.latitude === 'number' ? parsed.latitude : null,
      gpsLon: typeof parsed.longitude === 'number' ? parsed.longitude : null,
      cameraMake: parsed.Make || null,
      cameraModel: parsed.Model || null,
    }
  } catch (err) {
    // exifr throws on some malformed/unsupported files — don't let that
    // kill the upload pipeline, just proceed without EXIF for this item.
    console.warn('[exif] extraction failed (non-fatal):', err.message)
    return empty
  }
}

function toIsoOrNull(value) {
  if (!value) return null
  try {
    const d = value instanceof Date ? value : new Date(value)
    if (isNaN(d.getTime())) return null
    return d.toISOString()
  } catch {
    return null
  }
}
