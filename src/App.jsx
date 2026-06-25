// App.jsx — v2.0 Stage 1
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
      <DebugPanel />
    </>
  )
}
