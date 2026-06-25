// exif.js — v2.0 Stage 2
import exifr from 'exifr'
const EXIF_PARSE_OPTIONS = {
  tiff: true, ifd0: true, exif: true, gps: true, xmp: true,
  icc: false, iptc: false, jfif: false,
  translateKeys: true, translateValues: true, reviveValues: true,
  sanitize: true, mergeOutput: true,
}
export async function extractExif(buffer, mimeType) {
  const empty = { raw: null, dateTaken: null, gpsLat: null, gpsLon: null, cameraMake: null, cameraModel: null }
  if (mimeType && mimeType.startsWith('video/')) return empty
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
  } catch { return null }
}
