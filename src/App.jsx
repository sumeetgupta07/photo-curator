// App.jsx — v2.1
// PURPOSE: Root app shell — auth gate, view switcher, global toast layer.
// v2.1: added DupeToast corner notification for skipped duplicates.
import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAppStore } from './store/appStore.js'
import { useAuth } from './hooks/useAuth.js'
import { useMediaItems } from './hooks/useMediaItems.js'
import LoginScreen from './components/LoginScreen.jsx'
import GridView from './components/GridView.jsx'
import SwipeView from './components/SwipeView.jsx'
import LoadingScreen from './components/LoadingScreen.jsx'
import DebugPanel from './components/DebugPanel.jsx'

function DupeToast() {
  const { dupeToast } = useAppStore()
  return (
    <AnimatePresence>
      {dupeToast.visible && (
        <motion.div
          key="dupe-toast"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.25 }}
          style={{
            position: 'fixed', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)', left: 16,
            background: 'rgba(30,30,30,0.85)', backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
            padding: '8px 14px', fontSize: 13, color: 'var(--text-2)',
            pointerEvents: 'none', zIndex: 9999,
          }}
        >
          {dupeToast.count} duplicate{dupeToast.count !== 1 ? 's' : ''} skipped
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default function App() {
  const { authState, view } = useAppStore()
  const { signIn, signOut } = useAuth()
  const { pickerState, startPickerSession, clearAndReset, cancelPickerSession } = useMediaItems()
  if (authState === 'loading') return <LoadingScreen />
  if (authState === 'unauthenticated') return <LoginScreen onSignIn={signIn} />
  return (
    <>
      <AnimatePresence mode="wait">
        {view === 'grid' ? (
          <motion.div key="grid" initial={{ opacity:0, x:-20 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:-20 }} transition={{ duration:0.25 }} style={{ height:'100%' }}>
            <GridView onSignOut={signOut} pickerState={pickerState} onPickPhotos={() => startPickerSession(false)} onAddMorePhotos={() => startPickerSession(true)} onClearSession={clearAndReset} onCancelPicker={cancelPickerSession} />
          </motion.div>
        ) : (
          <motion.div key="swipe" initial={{ opacity:0, scale:0.97 }} animate={{ opacity:1, scale:1 }} exit={{ opacity:0, scale:0.97 }} transition={{ duration:0.25 }} style={{ height:'100%' }}>
            <SwipeView />
          </motion.div>
        )}
      </AnimatePresence>
      <DupeToast />
      <DebugPanel />
    </>
  )
}
