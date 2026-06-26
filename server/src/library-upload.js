// library-upload.js — v2.3
// PURPOSE: Google Photos Library API calls for upload pipeline.
// v2.3: added description: '#PhotoCurator' to batchCreate so all uploaded
// items are searchable/filterable in Google Photos by that tag.

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
    const b = await res.text()
    throw new Error(`Byte upload failed: HTTP ${res.status} ${b.slice(0, 200)}`)
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
    throw new Error(`batchCreate failed: HTTP ${res.status} ${e.slice(0, 200)}`)
  }
  const data = await res.json()
  const result = data.newMediaItemResults?.[0]
  if (!result) throw new Error('batchCreate returned no result')
  const status = result.status
  if (status && status.code && status.code !== 0) {
    throw new Error(`batchCreate item error: ${status.message} (code ${status.code})`)
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
    throw new Error(`createAlbum failed: HTTP ${res.status} ${b.slice(0, 200)}`)
  }
  return res.json()
}

export async function getMediaItem(accessToken, mediaItemId) {
  const res = await fetch(`${PHOTOS_API}/mediaItems/${mediaItemId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const b = await res.text()
    throw new Error(`getMediaItem failed: HTTP ${res.status} ${b.slice(0, 200)}`)
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
    throw new Error(`batchAddMediaItems failed: HTTP ${res.status} ${b.slice(0, 200)}`)
  }
  return res.status === 204 ? null : res.json()
}
