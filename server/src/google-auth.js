// google-auth.js — v2.0 Stage 1
//
// PURPOSE: Backend-side Google OAuth 2.0 authorization-code flow. Unlike
// the old frontend implicit flow (useAuth.js v0.x), this flow runs
// entirely server-side: it's the only flow that issues a refresh token,
// which is what lets the backend silently re-authenticate without the
// user re-logging-in every ~60 minutes. The browser never sees any Google
// token at all in this design — only an HTTP-only session cookie scoped
// to our own domain.
import { getSession, updateAccessToken } from './db.js'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth'

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI

const SCOPES = [
  'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
  'https://www.googleapis.com/auth/photoslibrary.appendonly',
  'openid',
  'email',
].join(' ')

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
  console.warn('[google-auth] WARNING: missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REDIRECT_URI in server/.env')
}

export function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',   // required to receive a refresh_token
    prompt: 'consent',        // forces refresh_token on every consent (Google omits it on repeat silent grants otherwise)
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

export async function exchangeCodeForTokens(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
      code,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token exchange failed: ${res.status} ${body}`)
  }
  return res.json() // { access_token, refresh_token, expires_in, id_token, ... }
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token refresh failed: ${res.status} ${body}`)
  }
  return res.json() // { access_token, expires_in, ... } — no new refresh_token on refresh grant
}

// Returns a valid access token for the given session, refreshing if the
// cached one is expired or about to expire (60s buffer, same pattern as
// the old frontend storage.js v0.x had for its own token).
export async function getValidAccessToken(sessionId) {
  const session = getSession(sessionId)
  if (!session) throw new Error('NO_SESSION')

  const now = Math.floor(Date.now() / 1000)
  if (session.access_token && session.access_token_exp && now < session.access_token_exp - 60) {
    return session.access_token
  }

  const refreshed = await refreshAccessToken(session.refresh_token)
  const exp = now + refreshed.expires_in
  updateAccessToken(sessionId, refreshed.access_token, exp)
  return refreshed.access_token
}
