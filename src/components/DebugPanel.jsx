// DebugPanel.jsx — v0.7 (STALE — pending Stage 3 rewrite)
//
// Temporary diagnostic panel — inspect raw API data, test album writes in
// isolation. To be removed in Phase 5 polish once album writes are
// confirmed stable end-to-end (see handover doc).
//
// v0.7: testAlbumWrite() uses getOrCreateAlbum() instead of listAlbums().
//
// STAGE 1 NOTE: `token` from the store is now always `undefined` (removed
// in appStore.js v2.0 Stage 1 — see useSwipeActions.js v0.7's note for the
// full explanation). "Test album write" will silently fail/no-op here
// until Stage 3 rewires this panel to the new /api/swipe endpoint. The
// "Token: ✗" indicator below will correctly always show ✗ in this stage —
// that's expected, not a bug; it doesn't mean you're signed out (check
// /api/me or the main UI for actual auth status).
import React, { useState } from 'react'
import { useAppStore } from '../store/appStore.js'
import { photoUrl, getOrCreateAlbum, batchAddToAlbum } from '../lib/api.js'
import { IMG_SIZES } from '../lib/config.js'

export default function DebugPanel() {
  const { token, items } = useAppStore()
  const [log, setLog]   = useState([])
  const [open, setOpen] = useState(false)

  const append = (msg, data) =>
    setLog(l => [...l, { msg, data: JSON.stringify(data, null, 2) }])

  async function testPhotos() {
    append(`Items in store: ${items.length}`, items.slice(0, 2))
    if (items[0]) {
      const url = photoUrl(items[0].baseUrl, IMG_SIZES.thumb)
      append('First thumb URL (first 120 chars)', url.slice(0, 120))
    }
  }

  async function testAlbumWrite() {
    if (!items[0]) { append('No items loaded', {}); return }
    try {
      const albumId = await getOrCreateAlbum(token, '__debug_test__')
      append('Album ready (created or reused from cache)', { id: albumId })

      const item = items[0]
      append('Item ID fields', {
        'item.id':                      item.id,
        'item._pickerId':               item._pickerId,
        'item.baseUrl (60 chars)':      item.baseUrl?.slice(0, 60),
      })

      const result = await batchAddToAlbum(token, albumId, [item.id])
      append('batchAddToAlbum result', result || 'null (success/204)')
    } catch (err) {
      append('ERROR', { message: err.message })
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{
        position:'fixed', bottom:90, left:12, zIndex:999,
        background:'rgba(255,200,0,0.9)', color:'#000',
        border:'none', borderRadius:8, padding:'6px 12px',
        fontSize:11, fontWeight:700, fontFamily:'monospace',
      }}>DEBUG</button>
    )
  }

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.96)',
      overflow:'auto', padding:16, fontFamily:'monospace', fontSize:11,
    }}>
      <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
        <button onClick={() => setOpen(false)}
          style={{ background:'#333', color:'#fff', border:'none', borderRadius:6, padding:'6px 12px' }}>✕ Close</button>
        <button onClick={testPhotos}
          style={{ background:'#1a5', color:'#fff', border:'none', borderRadius:6, padding:'6px 12px' }}>Inspect items</button>
        <button onClick={testAlbumWrite}
          style={{ background:'#15a', color:'#fff', border:'none', borderRadius:6, padding:'6px 12px' }}>Test album write</button>
        <button onClick={() => setLog([])}
          style={{ background:'#555', color:'#fff', border:'none', borderRadius:6, padding:'6px 12px' }}>Clear</button>
      </div>
      <div style={{ color:'#0f0', marginBottom:8 }}>
        Items: {items.length} | Token: {token ? `✓ ${token.slice(0,12)}…` : '✗'}
      </div>
      {log.map((e, i) => (
        <div key={i} style={{ marginBottom:14, borderLeft:'3px solid #444', paddingLeft:10 }}>
          <div style={{ color:'#fa0', marginBottom:4 }}>{e.msg}</div>
          <pre style={{ color:'#eee', whiteSpace:'pre-wrap', wordBreak:'break-all', margin:0 }}>{e.data}</pre>
        </div>
      ))}
    </div>
  )
}
