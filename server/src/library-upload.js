// library-upload.js — v2.0 Stage 3
//
// Stage 3: added batchAddMediaItems — the function that finally makes the
// core Good/Bad album routing work. This only works because Stage 2
// ensures every item was re-uploaded by this app (our_media_item_id),
// satisfying Google's rule that batchAddMediaItems only accepts items the
// calling app itself created. Picker item IDs can never work here —
// see Session Handover notes on "invalid media item id" for the full
// history of why.
const PHOTOS_API = 'https://photoslibrary.googleapis.com/v1'

export async function uploadBytes(accessToken, buffer, filename, mimeType) {
  const res = await fetch(`${PHOTOS_API}/uploads`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'X-Goog-Upload-Content-Type': mimeType || 'application/octet-stream',
      'X-Goog-Upload-Protocol': 'raw',
      'X-Goog-Upload-File-Name': filename || 'upload',
    },
    body: buffer,
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Byte upload failed: HTTP ${res.status} ${body.slice(0, 200)}`)
  }

  // This endpoint returns the upload token as plain text, not JSON.
  return res.text()
}

export async function createMediaItem(accessToken, uploadToken, filename, albumId) {
  const body = {
    newMediaItems: [{
      simpleMediaItem: { uploadToken, fileName: filename || undefined },
    }],
  }
  if (albumId) body.albumId = albumId

  const res = await fetch(`${PHOTOS_API}/mediaItems:batchCreate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  // 207 = partial success across the batch; we only ever send one item per
  // call (see worker.js — items are uploaded one at a time, not batched,
  // to keep per-item status tracking simple), so treat 200 and 207 the
  // same way and inspect the single result either way.
  if (!res.ok && res.status !== 207) {
    const errBody = await res.text()
    throw new Error(`batchCreate failed: HTTP ${res.status} ${errBody.slice(0, 200)}`)
  }

  const data = await res.json()
  const result = data.newMediaItemResults?.[0]
  if (!result) throw new Error('batchCreate returned no result for the uploaded item')

  const status = result.status
  if (status && status.code && status.code !== 0) {
    throw new Error(`batchCreate item error: ${status.message || 'unknown error'} (code ${status.code})`)
  }

  if (!result.mediaItem?.id) {
    throw new Error('batchCreate succeeded but returned no mediaItem.id')
  }

  return result.mediaItem // { id, productUrl, baseUrl, mimeType, mediaMetadata, ... }
}

// ── Albums (re-implemented here for Stage 2's worker; api.js's frontend
// version of this is now dead code pending Stage 3 cleanup) ───────────────────

export async function createAlbum(accessToken, title) {
  const res = await fetch(`${PHOTOS_API}/albums`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ album: { title } }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`createAlbum failed: HTTP ${res.status} ${body.slice(0, 200)}`)
  }
  return res.json() // { id, title, ... }
}

// Fetches current metadata (incl. a fresh baseUrl) for a media item WE
// created. Needed because baseUrls expire after ~60min and aren't
// persisted (see worker.js's baseUrlMap comment) — when the frontend wants
// to display a re-uploaded item later, it asks for a fresh baseUrl via
// this, keyed by our_media_item_id, rather than reusing the original
// Picker item's (different, also-expired) baseUrl.
export async function getMediaItem(accessToken, mediaItemId) {
  const res = await fetch(`${PHOTOS_API}/mediaItems/${mediaItemId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`getMediaItem failed: HTTP ${res.status} ${body.slice(0, 200)}`)
  }
  return res.json() // { id, baseUrl, mimeType, mediaMetadata, ... }
}

// Stage 3: add one or more app-created media items to an app-created album.
// Only works when all mediaItemIds were created by this app (via
// uploadBytes + createMediaItem above) — this is the invariant Stage 2's
// pipeline establishes by re-uploading every Picker selection.
export async function batchAddMediaItems(accessToken, albumId, mediaItemIds) {
  if (!mediaItemIds?.length) return null
  const res = await fetch(`${PHOTOS_API}/albums/${albumId}:batchAddMediaItems`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mediaItemIds }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`batchAddMediaItems failed: HTTP ${res.status} ${body.slice(0, 200)}`)
  }
  return res.status === 204 ? null : res.json()
}
