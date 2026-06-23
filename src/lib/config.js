// config.js — v2.0 Stage 1
//
// v2.0 Stage 1: GOOGLE_CLIENT_ID, SCOPES, and PICKER_API removed entirely.
// With backend-managed OAuth (server/src/google-auth.js), the frontend
// never needs the client ID or scopes — those now live only in
// server/.env (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET, neither of which
// should ever be in frontend code, since this bundle is publicly served).
// This also means the earlier ".env for GOOGLE_CLIENT_ID" request is moot
// for the frontend — there's nothing left here that needs to be a secret
// or configurable per-environment; see server/.env.example instead for
// where that configuration now lives.
//
// PHOTOS_API also removed — only used by api.js's (now-inert, pending
// Stage 3) album functions, which build full Library API URLs themselves;
// kept inline there instead since it's the only remaining consumer.
//
// ─────────────────────────────────────────────────────────────────────────────
// Authorized JS Origins:    https://photo.sumeetg.duckdns.org
// Authorized Redirect URIs: https://photo.sumeetg.duckdns.org/oauth-callback.html  (UNUSED — old implicit flow, safe to remove from Google Cloud Console)
//                           https://photo.sumeetg.duckdns.org/picker-callback.html (UNUSED — abandoned in v0.5, safe to remove)
//                           https://photo.sumeetg.duckdns.org/api/oauth/callback   (ACTIVE — backend code-flow callback, Stage 1)
// Enabled APIs: Google Photos Picker API, Google Photos Library API
// ─────────────────────────────────────────────────────────────────────────────

export const IMG_SIZES = {
  thumb:   '=w400-h400-c',   // square crop
  full:    '=w1200',
  preload: '=w800',
}

export const PICKER_POLL_MS = 2500
export const ALBUM_GOOD     = 'Good'
export const ALBUM_BAD      = 'Bad'
