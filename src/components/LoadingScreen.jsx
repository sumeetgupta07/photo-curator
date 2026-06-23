import React from 'react'
import { motion } from 'framer-motion'

export default function LoadingScreen({ message = 'Loading…' }) {
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 16,
    }}>
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        style={{
          width: 32, height: 32,
          border: '2px solid var(--border)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
        }}
      />
      <p style={{ color: 'var(--text-2)', fontSize: 14 }}>{message}</p>
    </div>
  )
}
