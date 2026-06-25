// backendApi.js — v2.1
// PURPOSE: Thin client for Photo Curator backend /api/* routes.
// v2.1: added cleanupSession() — calls POST /api/cleanup to delete local
// thumbnail files before the frontend clears its store. Called from
// useMediaItems.clearAndReset().
// All other functions unchanged from v2.0 Stage 3.
async function backendRequest(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
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

// v2.1: delete local thumbnails for this session before clearing the store
export async function cleanupSession() {
  return backendRequest('/api/cleanup', { method: 'POST' })
}

export async function recordSwipe(ourMediaItemId, decision) {
  return backendRequest('/api/swipe', {
    method: 'POST',
    body: JSON.stringify({ ourMediaItemId, decision }),
  })
}

export async function getSwipeDecisions(pickerSessionId) {
  const data = await backendRequest(`/api/swipe-decisions?pickerSessionId=${encodeURIComponent(pickerSessionId)}`)
  return data.decisions
}
