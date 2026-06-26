// google-auth.js — v2.1
// PURPOSE: Google OAuth helpers for Photo Curator backend.
// v2.1: added photoslibrary.readonly.appcreateddata scope — required for
//   GET /v1/mediaItems/{id} to verify deleted photos. Existing sessions
//   will need to re-authenticate to get this scope consented.
import { getSession, updateAccessToken } from './db.js'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth'
const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI
const SCOPES = [
  'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
  'https://www.googleapis.com/auth/photoslibrary.appendonly',
  'https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata',
  'openid', 'email',
].join(' ')
if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
  console.warn('[google-auth] WARNING: missing env vars in server/.env')
}
export function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI,
    response_type: 'code', scope: SCOPES,
    access_type: 'offline', prompt: 'consent', state,
  })
  return `${AUTH_URL}?${params.toString()}`
}
export async function exchangeCodeForTokens(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI, grant_type: 'authorization_code', code }),
  })
  if (!res.ok) { const b = await res.text(); throw new Error(`Token exchange failed: ${res.status} ${b}`) }
  return res.json()
}
async function refreshAccessToken(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token', refresh_token: refreshToken }),
  })
  if (!res.ok) { const b = await res.text(); throw new Error(`Token refresh failed: ${res.status} ${b}`) }
  return res.json()
}
export async function getValidAccessToken(sessionId) {
  const session = getSession(sessionId)
  if (!session) throw new Error('NO_SESSION')
  const now = Math.floor(Date.now() / 1000)
  if (session.access_token && session.access_token_exp && now < session.access_token_exp - 60) {
    return session.access_token
  }
  const refreshed = await refreshAccessToken(session.refresh_token)
  updateAccessToken(sessionId, refreshed.access_token, now + refreshed.expires_in)
  return refreshed.access_token
}
