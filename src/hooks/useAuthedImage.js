// useAuthedImage.js — v2.1
// PURPOSE: Build URLs for backend image serving.
// v2.1: switched by-id image URLs from /api/image-proxy/by-id (called
// getMediaItem → 403 scope error for post-March-2025 projects) to
// /api/thumbs/{size}/{uploadId}.jpg — locally generated thumbnails served
// as static files by the backend. Size mapping:
//   IMG_SIZES.thumb ('=w400-h400-c') → /api/thumbs/400/{uploadId}.jpg
//   IMG_SIZES.full  ('=w1200')       → /api/thumbs/1600/{uploadId}.jpg
//   IMG_SIZES.preload ('=w800')      → /api/thumbs/1600/{uploadId}.jpg
// The uploadId here is the numeric uploads.id (item.id in the store),
// NOT ourMediaItemId — see useMediaItems.js mapReadyItem for the mapping.
import { useMemo } from 'react'

export function authedImageUrl(baseUrl, sizeParam) {
  if (!baseUrl) return null
  const params = new URLSearchParams({ baseUrl, size: sizeParam || '' })
  return `/api/image-proxy?${params.toString()}`
}

function sizeFolder(sizeParam) {
  // '=w1200' and '=w800' both map to the 1600px copy (best quality available)
  // '=w400-h400-c' maps to the 400px copy
  if (!sizeParam) return 400
  return sizeParam.startsWith('=w4') ? 400 : 1600
}

export function authedMediaItemUrl(uploadId, sizeParam) {
  if (!uploadId) return null
  return `/api/thumbs/${sizeFolder(sizeParam)}/${uploadId}.jpg`
}

export function useAuthedImageUrl(baseUrl, sizeParam) {
  return useMemo(() => authedImageUrl(baseUrl, sizeParam), [baseUrl, sizeParam])
}

export function useAuthedMediaItemUrl(uploadId, sizeParam) {
  return useMemo(() => authedMediaItemUrl(uploadId, sizeParam), [uploadId, sizeParam])
}

export function preloadAuthedImage(baseUrl, sizeParam) {
  const url = authedImageUrl(baseUrl, sizeParam)
  if (!url) return
  const img = new Image(); img.src = url
}

export function preloadAuthedMediaItem(uploadId, sizeParam) {
  const url = authedMediaItemUrl(uploadId, sizeParam)
  if (!url) return
  const img = new Image(); img.src = url
}

export function clearAuthedImageCache() {
  // Intentionally empty — browser HTTP cache handles this.
}
