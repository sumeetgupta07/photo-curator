// picker.js — v2.1
// PURPOSE: Google Photos Picker API proxy functions.
// v2.1: normalizePickerItem now passes filename and fileSize through to the
// caller so index.js can persist them in createUploadRow (fixes null filename).

const PICKER_API = 'https://photospicker.googleapis.com/v1'
const PAGE_SIZE  = 100

async function pickerReq(accessToken, path, options = {}) {
  const res = await fetch(`${PICKER_API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`
    try { const b = await res.json(); errMsg = b?.error?.message || b?.message || errMsg } catch {}
    throw new Error(errMsg)
  }
  if (res.status === 204) return null
  return res.json()
}

export async function createPickerSession(accessToken) {
  return pickerReq(accessToken, '/sessions', { method: 'POST', body: '{}' })
}

export async function getPickerSession(accessToken, sessionId) {
  return pickerReq(accessToken, `/sessions/${sessionId}`)
}

export async function deletePickerSession(accessToken, sessionId) {
  return pickerReq(accessToken, `/sessions/${sessionId}`, { method: 'DELETE' })
}

export async function fetchPickerItems(accessToken, sessionId) {
  const items = []
  let pageToken = null
  do {
    const params = new URLSearchParams({ sessionId, pageSize: PAGE_SIZE })
    if (pageToken) params.set('pageToken', pageToken)
    const data = await pickerReq(accessToken, `/mediaItems?${params}`)
    const batch = (data.mediaItems || []).map(normalizePickerItem)
    items.push(...batch)
    pageToken = data.nextPageToken || null
  } while (pageToken)
  return items
}

function normalizePickerItem(raw) {
  const mf  = raw.mediaFile || {}
  const mfm = mf.mediaFileMetadata || {}
  return {
    id:       raw.id,
    baseUrl:  mf.baseUrl  || raw.baseUrl  || '',
    mimeType: mf.mimeType || raw.mimeType || '',
    filename: mf.filename || raw.filename || null,   // v2.1: was missing in v2.0
    fileSize: mfm.fileSize ? Number(mfm.fileSize) : null,  // v2.1: passed for dedup
    mediaMetadata: {
      creationTime: mfm.creationTime || raw.createTime || null,
      width:        Number(mfm.width)  || null,
      height:       Number(mfm.height) || null,
      video:        mfm.videoMetadata  || null,
    },
  }
}
