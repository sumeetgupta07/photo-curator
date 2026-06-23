// backendApi.js — v2.0 Stage 3
//
// v2.0 Stage 2: added upload-pipeline functions.
// v2.0 Stage 3: added recordSwipe and getSwipeDecisions — the new
// endpoints that route swipe decisions to real Google Photos album writes
// via the backend (using our_media_item_id, which batchAddMediaItems
// accepts because Stage 2 re-uploaded everything under app ownership).
//
// PURPOSE: Thin client for our OWN backend's /api/* routes (not Google's
// APIs directly — that's entirely server-side, see server/src/picker.js,
// server/src/worker.js, server/src/index.js). No token is needed here —
// the session cookie (HTTP-only, set by /api/oauth/callback) is sent
// automatically by the browser on every same-origin request.
//
// v2.0 Stage 2: added the upload-pipeline functions (startUpload,
// getUploadStatus, getReadyUploads, retryUpload) — see useMediaItems.js
// v2.0 Stage 2 for how these are used to grow the swipe stack incrementally
// as background re-uploads complete, per the agreed design.
async function backendRequest(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })

  if (res.status === 401) throw new Error('NOT_AUTHENTICATED')

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`
    try { const b = await res.json(); errMsg = b?.message || b?.error || errMsg } catch {}
    throw new Error(errMsg)
  }

  if (res.status === 204) return null
  return res.json()
}

export async function createPickerSession() {
  return backendRequest('/api/picker/sessions', { method: 'POST' })
}

export async function getPickerSession(sessionId) {
  return backendRequest(`/api/picker/sessions/${sessionId}`)
}

export async function fetchPickerItems(sessionId) {
  const data = await backendRequest(`/api/picker/sessions/${sessionId}/items`)
  console.log(`[Picker] normalized ${data.items.length} items`)
  if (data.items[0]) console.log('[Picker] first item:', JSON.stringify(data.items[0], null, 2))
  return data.items
}

export async function deletePickerSession(sessionId) {
  return backendRequest(`/api/picker/sessions/${sessionId}`, { method: 'DELETE' })
}

// ── Upload pipeline (Stage 2) ─────────────────────────────────────────────────

export async function startUpload(pickerSessionId, items) {
  return backendRequest(`/api/picker-session/${pickerSessionId}/start-upload`, {
    method: 'POST',
    body: JSON.stringify({ items }),
  })
}

export async function getUploadStatus(pickerSessionId) {
  return backendRequest(`/api/uploads/status?pickerSessionId=${encodeURIComponent(pickerSessionId)}`)
}

export async function getReadyUploads(pickerSessionId) {
  const data = await backendRequest(`/api/uploads/ready?pickerSessionId=${encodeURIComponent(pickerSessionId)}`)
  return data.items
}

export async function retryUpload(uploadId) {
  return backendRequest(`/api/uploads/${uploadId}/retry`, { method: 'POST' })
}

// ── Swipe routing — Stage 3 ────────────────────────────────────────────────────

export async function recordSwipe(ourMediaItemId, decision) {
  return backendRequest('/api/swipe', {
    method: 'POST',
    body: JSON.stringify({ ourMediaItemId, decision }),
  })
}

export async function getSwipeDecisions(pickerSessionId) {
  const data = await backendRequest(`/api/swipe-decisions?pickerSessionId=${encodeURIComponent(pickerSessionId)}`)
  return data.decisions // [{ ourMediaItemId, decision }]
}
