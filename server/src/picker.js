// picker.js — v2.0 Stage 1
//
// PURPOSE: Server-side Google Picker API calls (session create/poll/fetch-
// items/delete), using the backend-managed access token instead of a
// browser-held one. This mirrors the logic that used to live in the
// frontend's src/lib/api.js (createPickerSession, getPickerSession,
// fetchPickerItems, normalizePickerItem) — moved here so the browser never
// needs to hold a Google token at all, consistent with the rest of Stage 1.
const PICKER_API = 'https://photospicker.googleapis.com/v1'
const PAGE_SIZE = 100

async function pickerReq(accessToken, path, options = {}) {
  const res = await fetch(`${PICKER_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
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
  const mf = raw.mediaFile || {}
  return {
    id: raw.id,
    baseUrl: mf.baseUrl || raw.baseUrl || '',
    mimeType: mf.mimeType || raw.mimeType || '',
    filename: mf.filename || raw.filename || '',
    mediaMetadata: {
      creationTime: mf.mediaFileMetadata?.creationTime || raw.createTime || null,
      width: Number(mf.mediaFileMetadata?.width) || null,
      height: Number(mf.mediaFileMetadata?.height) || null,
      video: mf.mediaFileMetadata?.videoMetadata || null,
    },
  }
}
