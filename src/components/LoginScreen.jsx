import React from 'react'
import { motion } from 'framer-motion'
import styles from './LoginScreen.module.css'
export default function LoginScreen({ onSignIn }) {
  return (
    <div className={styles.root}>
      <div className={styles.bg}>{[...Array(6)].map((_,i) => <div key={i} className={styles.blob} style={{'--i':i}} />)}</div>
      <motion.div className={styles.card} initial={{ opacity:0, y:32 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.6, ease:[0.16,1,0.3,1] }}>
        <div className={styles.icon}>
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <rect width="40" height="40" rx="12" fill="#1e1e1e"/>
            <path d="M20 8L28 14V22L20 28L12 22V14L20 8Z" stroke="#e8d5b0" strokeWidth="1.5" fill="none"/>
            <circle cx="20" cy="20" r="3" fill="#e8d5b0"/>
            <path d="M20 8V14M28 14L23 17M28 22L23 23M20 28V22M12 22L17 23M12 14L17 17" stroke="#e8d5b0" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
        <h1 className={styles.title}>Photo<br /><em>Curator</em></h1>
        <p className={styles.sub}>Swipe through your library.<br />Keep what matters.</p>
        <motion.button className={styles.btn} onClick={onSignIn} whileTap={{ scale:0.96 }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </motion.button>
        <p className={styles.hint}>Requires access to Google Photos</p>
      </motion.div>
    </div>
  )
}
