// useAuthedImage.js — v2.0 Stage 2
//
// PURPOSE: Build URLs for the backend's image proxies. Plain URL strings
// work directly in <img src>/backgroundImage since auth is a same-origin
// HTTP-only cookie (Stage 1) — no fetch()/blob/object-URL machinery needed.
//
// v2.0 Stage 2: added useAuthedMediaItemUrl()/preloadAuthedMediaItem(),
// pointing at /api/image-proxy/by-id instead of /api/image-proxy. Once an
// item has been re-uploaded (status=done, has our_media_item_id), the app
// displays OUR copy rather than the original Picker baseUrl — see
// GridView.jsx/SwipeCard.jsx/SwipeView.jsx v2.0 Stage 2 for where this
// switch happens. The original baseUrl-based functions are kept for the
// pre-upload "still uploading" preview state, if used.
import { useMemo } from 'react'

export function authedImageUrl(baseUrl, sizeParam) {
  if (!baseUrl) return null
  const params = new URLSearchParams({ baseUrl, size: sizeParam || '' })
  return `/api/image-proxy?${params.toString()}`
}

export function authedMediaItemUrl(mediaItemId, sizeParam) {
  if (!mediaItemId) return null
  const params = new URLSearchParams({ mediaItemId, size: sizeParam || '' })
  return `/api/image-proxy/by-id?${params.toString()}`
}

/**
 * Hook for rendering a single authenticated Picker API image (pre-upload
 * preview, by raw baseUrl). No async state needed — pure, synchronous URL
 * builder memoized on its inputs.
 */
export function useAuthedImageUrl(baseUrl, sizeParam) {
  return useMemo(() => authedImageUrl(baseUrl, sizeParam), [baseUrl, sizeParam])
}

/**
 * Hook for rendering OUR re-uploaded copy of an item, by our_media_item_id.
 * This is the primary image-display path once an item's upload completes.
 */
export function useAuthedMediaItemUrl(mediaItemId, sizeParam) {
  return useMemo(() => authedMediaItemUrl(mediaItemId, sizeParam), [mediaItemId, sizeParam])
}

/**
 * Preload an image into the browser's HTTP cache ahead of time (e.g. for
 * upcoming swipe cards).
 */
export function preloadAuthedImage(baseUrl, sizeParam) {
  const url = authedImageUrl(baseUrl, sizeParam)
  if (!url) return
  const img = new Image()
  img.src = url
}

export function preloadAuthedMediaItem(mediaItemId, sizeParam) {
  const url = authedMediaItemUrl(mediaItemId, sizeParam)
  if (!url) return
  const img = new Image()
  img.src = url
}

/**
 * No-op — kept as a named export so existing callers (signOut,
 * clearAndReset) don't need conditional imports. There's no client-side
 * object-URL cache anymore; the browser's native HTTP cache handles this.
 */
export function clearAuthedImageCache() {
  // Intentionally empty — see comment above.
}
