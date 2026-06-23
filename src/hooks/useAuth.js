// useAuth.js — v2.0 Stage 1
//
// PURPOSE: Sign-in/out for Photo Curator. Completely rewritten for Stage 1:
// the backend now owns the entire OAuth flow (authorization-code, with
// refresh tokens) — see server/src/google-auth.js. This hook no longer
// handles popups, postMessage, or any Google token directly. Signing in is
// just a redirect to /api/oauth/start; the backend handles the Google
// round-trip and sets an HTTP-only session cookie, then redirects back to
// '/'. On mount, we just ask the backend "am I signed in?" via /api/me.
//
// Removed in this version: GOOGLE_CLIENT_ID/SCOPES imports (now backend-
// only, in server/.env), saveToken/getToken/clearToken (storage.js no
// longer holds any Google token), popup/postMessage handling.
import { useEffect, useCallback } from 'react'
import { useAppStore } from '../store/appStore.js'
import { clearAuthedImageCache } from './useAuthedImage.js'

export function useAuth() {
  const { setAuthState } = useAppStore()

  // On mount: ask the backend whether we have a valid session
  useEffect(() => {
    let cancelled = false
    fetch('/api/me', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (cancelled) return
        setAuthState(data.authenticated ? 'authenticated' : 'unauthenticated')
      })
      .catch(err => {
        if (cancelled) return
        console.error('[Auth] /api/me check failed:', err.message)
        setAuthState('unauthenticated')
      })
    return () => { cancelled = true }
  }, [])

  const signIn = useCallback(() => {
    window.location.href = '/api/oauth/start'
  }, [])

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' })
    } catch (err) {
      console.error('[Auth] logout request failed:', err.message)
      // Proceed with local cleanup regardless — worst case the backend
      // session lingers until it naturally expires.
    }
    setAuthState('unauthenticated')
    clearAuthedImageCache()
    useAppStore.getState().reset()
  }, [])

  return { signIn, signOut }
}
