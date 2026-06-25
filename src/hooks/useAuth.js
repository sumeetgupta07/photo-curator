// useAuth.js — v2.0 Stage 1
import { useEffect, useCallback } from 'react'
import { useAppStore } from '../store/appStore.js'
import { clearAuthedImageCache } from './useAuthedImage.js'
export function useAuth() {
  const { setAuthState } = useAppStore()
  useEffect(() => {
    let cancelled = false
    fetch('/api/me', { credentials: 'include' })
      .then(res => res.json())
      .then(data => { if (!cancelled) setAuthState(data.authenticated ? 'authenticated' : 'unauthenticated') })
      .catch(err => { if (!cancelled) { console.error('[Auth] /api/me check failed:', err.message); setAuthState('unauthenticated') } })
    return () => { cancelled = true }
  }, [])
  const signIn = useCallback(() => { window.location.href = '/api/oauth/start' }, [])
  const signOut = useCallback(async () => {
    try { await fetch('/api/logout', { method: 'POST', credentials: 'include' }) } catch (err) { console.error('[Auth] logout failed:', err.message) }
    setAuthState('unauthenticated')
    clearAuthedImageCache()
    useAppStore.getState().reset()
  }, [])
  return { signIn, signOut }
}
