// library-upload.js — v2.4
// PURPOSE: Google Photos Library API calls for upload pipeline.
// v2.4: All thrown errors now carry a numeric `.status` property (the HTTP
// status code from the failed response) in addition to the existing message
// string. This lets callers detect specific failures (e.g. 404 = album no
// longer exists) reliably, instead of string-matching error.message.
// v2.3: added description: '#PhotoCurator' to batchCreate so all uploaded
// items are searchable/filterable in Google Photos by that tag.

const PHOTOS_API = 'https://photoslibrary.googleapis.com/v1'

function httpError(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

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
    const b = await res.text()
    throw httpError(`Byte upload failed: HTTP ${res.status} ${b.slice(0, 200)}`, res.status)
  }
  return res.text()
}

export async function createMediaItem(accessToken, uploadToken, filename, albumId) {
  const body = {
    newMediaItems: [{
      description: '#PhotoCurator',           // v2.3: searchable tag in Google Photos
      simpleMediaItem: {
        uploadToken,
        fileName: filename || undefined,
      },
    }],
  }
  if (albumId) body.albumId = albumId

  const res = await fetch(`${PHOTOS_API}/mediaItems:batchCreate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok && res.status !== 207) {
    const e = await res.text()
    throw httpError(`batchCreate failed: HTTP ${res.status} ${e.slice(0, 200)}`, res.status)
  }
  const data = await res.json()
  const result = data.newMediaItemResults?.[0]
  if (!result) throw new Error('batchCreate returned no result')
  const status = result.status
  if (status && status.code && status.code !== 0) {
    // Google's per-item status.code is its own gRPC-style code, not an HTTP
    // status — 5 is NOT_FOUND in that scheme. Tag it so callers can still
    // detect "album doesn't exist" here, even though the outer HTTP call was 200.
    throw httpError(`batchCreate item error: ${status.message} (code ${status.code})`, status.code === 5 ? 404 : undefined)
  }
  if (!result.mediaItem?.id) throw new Error('batchCreate succeeded but returned no mediaItem.id')
  return result.mediaItem
}

export async function createAlbum(accessToken, title) {
  const res = await fetch(`${PHOTOS_API}/albums`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ album: { title } }),
  })
  if (!res.ok) {
    const b = await res.text()
    throw httpError(`createAlbum failed: HTTP ${res.status} ${b.slice(0, 200)}`, res.status)
  }
  return res.json()
}

export async function getMediaItem(accessToken, mediaItemId) {
  const res = await fetch(`${PHOTOS_API}/mediaItems/${mediaItemId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const b = await res.text()
    throw httpError(`getMediaItem failed: HTTP ${res.status} ${b.slice(0, 200)}`, res.status)
  }
  return res.json()
}

export async function batchAddMediaItems(accessToken, albumId, mediaItemIds) {
  if (!mediaItemIds?.length) return null
  const res = await fetch(`${PHOTOS_API}/albums/${albumId}:batchAddMediaItems`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaItemIds }),
  })
  if (!res.ok) {
    const b = await res.text()
    throw httpError(`batchAddMediaItems failed: HTTP ${res.status} ${b.slice(0, 200)}`, res.status)
  }
  return res.status === 204 ? null : res.json()
}
