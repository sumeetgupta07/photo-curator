// grouping.js — v2.3 (new file)
// PURPOSE: Sort and group logic for the gallery view.
// Implements four presets driven by the single SORT_GROUP selector:
//   date     — group by individual date, items sorted by date desc
//   month    — group by month+year, items sorted by date desc
//   album    — group by swipe decision (Good/Bad/Uncategorised), items sorted by date asc
//   name     — flat alphabetical sort, grouped by first letter

const ALBUM_ORDER = ['good', 'bad', 'skip', null, undefined]
const ALBUM_LABELS = {
  good: 'Good',
  bad:  'Bad',
  skip: 'Skipped',
  null: 'Uncategorised',
}

function getDecisionKey(item, swipeDecisions) {
  return swipeDecisions?.[item.id] || item.swipeDecision || null
}

function getDateStr(item) {
  const raw = item.mediaMetadata?.creationTime
  if (!raw) return null
  const d = new Date(raw)
  if (isNaN(d)) return null
  return d
}

function toYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function toYM(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
}

function formatDateLabel(dateStr) {
  if (dateStr === 'unknown') return 'Unknown date'
  const d         = new Date(dateStr + 'T12:00:00')
  const today     = new Date(); const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1)
  const todayStr  = toYMD(today); const yestStr = toYMD(yesterday)
  if (dateStr === todayStr)  return 'Today'
  if (dateStr === yestStr)   return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' })
}

function formatMonthLabel(ymStr) {
  if (ymStr === 'unknown') return 'Unknown date'
  const d = new Date(ymStr + '-01T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// Apply active album filter — null means show all
function applyAlbumFilter(items, activeAlbum, swipeDecisions) {
  if (!activeAlbum) return items
  return items.filter(item => {
    const dec = getDecisionKey(item, swipeDecisions)
    if (activeAlbum === 'good')      return dec === 'good'
    if (activeAlbum === 'bad')       return dec === 'bad'
    if (activeAlbum === 'duplicate') return item.isDuplicate
    return false
  })
}

export function applyGrouping(items, sortGroup, swipeDecisions, activeAlbum) {
  const filtered = applyAlbumFilter(items, activeAlbum, swipeDecisions)

  if (sortGroup === 'date') {
    const groups = {}
    for (const item of filtered) {
      const d = getDateStr(item)
      const key = d ? toYMD(d) : 'unknown'
      if (!groups[key]) groups[key] = []
      groups[key].push(item)
    }
    return Object.entries(groups)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, items]) => ({ key, label: formatDateLabel(key), items }))
  }

  if (sortGroup === 'month') {
    const groups = {}
    for (const item of filtered) {
      const d = getDateStr(item)
      const key = d ? toYM(d) : 'unknown'
      if (!groups[key]) groups[key] = []
      groups[key].push(item)
    }
    return Object.entries(groups)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, items]) => ({
        key,
        label: formatMonthLabel(key),
        items: [...items].sort((a, b) => {
          const da = getDateStr(a)?.getTime() || 0
          const db = getDateStr(b)?.getTime() || 0
          return db - da
        }),
      }))
  }

  if (sortGroup === 'album') {
    const groups = {}
    for (const item of filtered) {
      const dec = getDecisionKey(item, swipeDecisions)
      const key = dec || 'null'
      if (!groups[key]) groups[key] = []
      groups[key].push(item)
    }
    const ORDER = ['good', 'bad', 'skip', 'null']
    return ORDER
      .filter(key => groups[key]?.length)
      .map(key => ({
        key,
        label: ALBUM_LABELS[key] || 'Uncategorised',
        items: [...groups[key]].sort((a, b) => {
          const da = getDateStr(a)?.getTime() || 0
          const db_ = getDateStr(b)?.getTime() || 0
          return da - db_   // ascending by date within album group
        }),
      }))
  }

  if (sortGroup === 'name') {
    const sorted = [...filtered].sort((a, b) =>
      (a.filename || '').localeCompare(b.filename || '', undefined, { sensitivity: 'base' })
    )
    const groups = {}
    for (const item of sorted) {
      const letter = (item.filename || '?')[0].toUpperCase()
      if (!groups[letter]) groups[letter] = []
      groups[letter].push(item)
    }
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({ key, label: key, items }))
  }

  return [{ key: 'all', label: 'All', items: filtered }]
}
