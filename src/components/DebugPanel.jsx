// DebugPanel.jsx — v0.7 STALE — remove in Phase 5
import React, { useState } from 'react'
import { useAppStore } from '../store/appStore.js'
import { photoUrl, getOrCreateAlbum, batchAddToAlbum } from '../lib/api.js'
import { IMG_SIZES } from '../lib/config.js'
export default function DebugPanel() {
  const { token, items } = useAppStore()
  const [log, setLog] = useState([])
  const [open, setOpen] = useState(false)
  const append = (msg, data) => setLog(l => [...l, { msg, data: JSON.stringify(data,null,2) }])
  async function testPhotos() { append(`Items in store: ${items.length}`, items.slice(0,2)) }
  if (!open) return <button onClick={() => setOpen(true)} style={{ position:'fixed',bottom:90,left:12,zIndex:999,background:'rgba(255,200,0,0.9)',color:'#000',border:'none',borderRadius:8,padding:'6px 12px',fontSize:11,fontWeight:700,fontFamily:'monospace' }}>DEBUG</button>
  return (
    <div style={{ position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,0.96)',overflow:'auto',padding:16,fontFamily:'monospace',fontSize:11 }}>
      <div style={{ display:'flex',gap:8,marginBottom:12,flexWrap:'wrap' }}>
        <button onClick={() => setOpen(false)} style={{ background:'#333',color:'#fff',border:'none',borderRadius:6,padding:'6px 12px' }}>✕ Close</button>
        <button onClick={testPhotos} style={{ background:'#1a5',color:'#fff',border:'none',borderRadius:6,padding:'6px 12px' }}>Inspect items</button>
        <button onClick={() => setLog([])} style={{ background:'#555',color:'#fff',border:'none',borderRadius:6,padding:'6px 12px' }}>Clear</button>
      </div>
      <div style={{ color:'#0f0',marginBottom:8 }}>Items: {items.length} | Token: {token ? `✓ ${token.slice(0,12)}…` : '✗'}</div>
      {log.map((e,i) => <div key={i} style={{ marginBottom:14,borderLeft:'3px solid #444',paddingLeft:10 }}><div style={{ color:'#fa0',marginBottom:4 }}>{e.msg}</div><pre style={{ color:'#eee',whiteSpace:'pre-wrap',wordBreak:'break-all',margin:0 }}>{e.data}</pre></div>)}
    </div>
  )
}
