// SwipeCard.jsx — v2.1
// v2.1: uses item.id (uploadId) for local thumb URL instead of ourMediaItemId.
import React, { useState } from 'react'
import { motion, useMotionValue, useTransform, useAnimation } from 'framer-motion'
import { useAuthedMediaItemUrl } from '../hooks/useAuthedImage.js'
import { IMG_SIZES } from '../lib/config.js'
import styles from './SwipeCard.module.css'
const SWIPE_X = 80, SWIPE_Y = 80, FLY = 600
export default function SwipeCard({ item, onSwipeRight, onSwipeLeft, onSwipeUp, onSwipeDown }) {
  const x = useMotionValue(0), y = useMotionValue(0), controls = useAnimation()
  const [isDragging, setIsDragging] = useState(false)
  const rotate      = useTransform(x, [-200,0,200], [-18,0,18])
  const goodOpacity = useTransform(x, [10,SWIPE_X], [0,1])
  const badOpacity  = useTransform(x, [-SWIPE_X,-10], [1,0])
  const skipOpacity = useTransform(y, [-SWIPE_Y,-20], [1,0])
  const backOpacity = useTransform(y, [20,SWIPE_Y], [0,1])
  const src = useAuthedMediaItemUrl(item.id, IMG_SIZES.full)
  async function flyOff(dir) {
    const t = { right:{x:FLY,y:0,rotate:20}, left:{x:-FLY,y:0,rotate:-20}, up:{x:0,y:-FLY,rotate:0}, down:{x:0,y:FLY,rotate:0} }
    await controls.start({ ...t[dir], opacity:0, transition:{ duration:0.3, ease:[0.36,0.66,0.04,1] } })
  }
  async function snapBack() { await controls.start({ x:0,y:0,rotate:0,opacity:1, transition:{ type:'spring', stiffness:400, damping:30 } }) }
  async function handleDragEnd(_, info) {
    setIsDragging(false)
    const { offset } = info; const absX = Math.abs(offset.x), absY = Math.abs(offset.y)
    if (absX > absY) {
      if (offset.x > SWIPE_X) { await flyOff('right'); onSwipeRight() }
      else if (offset.x < -SWIPE_X) { await flyOff('left'); onSwipeLeft() }
      else await snapBack()
    } else {
      if (offset.y < -SWIPE_Y) { await flyOff('up'); onSwipeUp() }
      else if (offset.y > SWIPE_Y) { await flyOff('down'); onSwipeDown() }
      else await snapBack()
    }
  }
  function handleKey(e) {
    const map = { ArrowRight: async()=>{await flyOff('right');onSwipeRight()}, ArrowLeft: async()=>{await flyOff('left');onSwipeLeft()}, ArrowUp: async()=>{await flyOff('up');onSwipeUp()}, ArrowDown: async()=>{await flyOff('down');onSwipeDown()} }
    if (map[e.key]) { e.preventDefault(); map[e.key]() }
  }
  return (
    <motion.div className={styles.card} drag dragConstraints={{ top:0,bottom:0,left:0,right:0 }} dragElastic={0.7}
      style={{ x,y,rotate }} animate={controls} initial={{ scale:1,opacity:1 }} exit={{ opacity:0,scale:0.8,transition:{duration:0.15} }}
      onDragStart={() => setIsDragging(true)} onDragEnd={handleDragEnd} tabIndex={0} onKeyDown={handleKey} whileTap={{ cursor:'grabbing' }}>
      {src ? <img src={src} alt={item.filename||''} className={styles.photo} draggable={false} onError={() => console.error('[Image] failed:', src.slice(0,80))}/> : <div className={styles.photo} style={{ background:'var(--bg-3)' }}/>}
      <div className={styles.topGradient}/><div className={styles.bottomGradient}/>
      <motion.div className={`${styles.label} ${styles.good}`} style={{ opacity:goodOpacity }}>✓ Good</motion.div>
      <motion.div className={`${styles.label} ${styles.bad}`}  style={{ opacity:badOpacity  }}>✕ Bad</motion.div>
      <motion.div className={`${styles.label} ${styles.skip}`} style={{ opacity:skipOpacity }}>↑ Skip</motion.div>
      <motion.div className={`${styles.label} ${styles.back}`} style={{ opacity:backOpacity }}>↓ Back</motion.div>
      <div className={styles.meta}>
        {item.mediaMetadata?.creationTime && <span className={styles.metaDate}>{new Date(item.mediaMetadata.creationTime).toLocaleDateString('en-US',{ month:'short',day:'numeric',year:'numeric' })}</span>}
        {item.filename && <span className={styles.metaName}>{item.filename}</span>}
      </div>
    </motion.div>
  )
}
