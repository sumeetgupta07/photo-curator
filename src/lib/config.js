// config.js — v2.3
// PURPOSE: App-wide constants.
// v2.3: added SORT_GROUP options for the gallery view selector.

export const IMG_SIZES = {
  thumb:   '=w400-h400-c',
  full:    '=w1200',
  preload: '=w800',
}

export const PICKER_POLL_MS = 2500
export const ALBUM_GOOD     = 'Good'
export const ALBUM_BAD      = 'Bad'

// Sort+Group presets — single selector drives both behaviours
export const SORT_GROUP_OPTIONS = [
  { key: 'date',      label: 'Date' },
  { key: 'month',     label: 'Month & Year' },
  { key: 'album',     label: 'Album' },
  { key: 'name',      label: 'Name' },
]
export const SORT_GROUP_DEFAULT = 'date'
