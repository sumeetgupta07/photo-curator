// backendApi.js — v2.4
// PURPOSE: Thin client for Photo Curator backend /api/* routes.
// v2.4: added curation session management calls:
//   getCurationSessions(), startNewCurationSession(name?),
//   activateCurationSession(id), renameCurationSession(id, name),
//   deleteCurationSession(id).

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

export async function createPickerSession()  { return backendRequest('/api/picker/sessions', { method: 'POST' }) }
export async function getPickerSession(id)   { return backendRequest(`/api/picker/sessions/${id}`) }
export async function fetchPickerItems(id)   { const d = await backendRequest(`/api/picker/sessions/${id}/items`); return d.items }
export async function deletePickerSession(id){ return backendRequest(`/api/picker/sessions/${id}`, { method: 'DELETE' }) }

export async function startUpload(pickerSessionId, items) {
  return backendRequest(`/api/picker-session/${pickerSessionId}/start-upload`, { method: 'POST', body: JSON.stringify({ items }) })
}
export async function getUploadStatus(pickerSessionId) {
  return backendRequest(`/api/uploads/status?pickerSessionId=${encodeURIComponent(pickerSessionId)}`)
}
export async function getReadyUploads(pickerSessionId) {
  const d = await backendRequest(`/api/uploads/ready?pickerSessionId=${encodeURIComponent(pickerSessionId)}`)
  return d.items
}
export async function getUploadQueue(pickerSessionId) {
  const d = await backendRequest(`/api/uploads/queue?pickerSessionId=${encodeURIComponent(pickerSessionId)}`)
  return d.items
}
export async function getAllUploads() {
  const d = await backendRequest('/api/uploads/all')
  return d.items
}
export async function getDeletedUploads() {
  const d = await backendRequest('/api/uploads/deleted')
  return d.items
}
export async function getScopeStatus() { return backendRequest('/api/scope-status') }
export async function retryUpload(uploadId) { return backendRequest(`/api/uploads/${uploadId}/retry`, { method: 'POST' }) }
export async function cleanupSession()      { return backendRequest('/api/cleanup', { method: 'POST' }) }
export async function recordSwipe(ourMediaItemId, decision) {
  return backendRequest('/api/swipe', { method: 'POST', body: JSON.stringify({ ourMediaItemId, decision }) })
}
export async function getSwipeDecisions(pickerSessionId) {
  const d = await backendRequest(`/api/swipe-decisions?pickerSessionId=${encodeURIComponent(pickerSessionId)}`)
  return d.decisions
}
export async function getAlbums() {
  const d = await backendRequest('/api/albums')
  return d.albums
}

// ── Curation sessions ─────────────────────────────────────────────────────────

export async function getCurationSessions() {
  return backendRequest('/api/curation-sessions')
  // returns { sessions: [...], active: {...} | null }
}

// "Start New Session" — saves current (already named), creates fresh,
// marks it active, returns the new session object.
export async function startNewCurationSession(name = null) {
  return backendRequest('/api/curation-sessions/start-new', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export async function activateCurationSession(id) {
  return backendRequest(`/api/curation-sessions/${id}/activate`, { method: 'POST' })
}

export async function renameCurationSession(id, name) {
  return backendRequest(`/api/curation-sessions/${id}/rename`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export async function deleteCurationSession(id) {
  return backendRequest(`/api/curation-sessions/${id}`, { method: 'DELETE' })
}
