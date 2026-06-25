// SwipeSummary.jsx — unchanged
import React from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../store/appStore.js'
import styles from './SwipeSummary.module.css'
export default function SwipeSummary({ onContinue, onReset }) {
  const { swipeHistory } = useAppStore()
  const counts = swipeHistory.reduce((acc,{action}) => { acc[action]=(acc[action]||0)+1; return acc }, { good:0, bad:0, skip:0 })
  const total = swipeHistory.length
  return (
    <motion.div className={styles.root} initial={{ opacity:0,y:40 }} animate={{ opacity:1,y:0 }} transition={{ duration:0.4, ease:[0.16,1,0.3,1] }}>
      <div className={styles.icon}>✦</div>
      <h2 className={styles.title}>Session Complete</h2>
      <p className={styles.sub}>You reviewed {total} photo{total!==1?'s':''}</p>
      <div className={styles.stats}>
        <Stat value={counts.good} label="Good"    color="var(--good)"   symbol="✓"/>
        <Stat value={counts.bad}  label="Bad"     color="var(--bad)"    symbol="✕"/>
        <Stat value={counts.skip} label="Skipped" color="var(--text-2)" symbol="↑"/>
      </div>
      <div className={styles.actions}>
        <motion.button className={styles.primaryBtn} onClick={onContinue} whileTap={{ scale:0.96 }}>Back to Gallery</motion.button>
        <button className={styles.secondaryBtn} onClick={onReset}>Start New Session</button>
      </div>
    </motion.div>
  )
}
function Stat({ value, label, color, symbol }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statSymbol} style={{ color }}>{symbol}</span>
      <span className={styles.statValue} style={{ color }}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}
