function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return clamp(n, 0, 1)
}

function safeNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function hexToRgb(hex) {
  const raw = String(hex ?? '').trim().replace('#', '')
  if (raw.length !== 6) return null
  const r = Number.parseInt(raw.slice(0, 2), 16)
  const g = Number.parseInt(raw.slice(2, 4), 16)
  const b = Number.parseInt(raw.slice(4, 6), 16)
  if (![r, g, b].every(Number.isFinite)) return null
  return { r, g, b }
}

function rgbToHex({ r, g, b }) {
  const to2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')
  return `#${to2(r)}${to2(g)}${to2(b)}`
}

function mixColors(colors) {
  const list = Array.isArray(colors) ? colors : []
  let sumW = 0
  let r = 0
  let g = 0
  let b = 0
  for (const entry of list) {
    const w = safeNumber(entry?.weight, 0)
    if (w <= 0) continue
    const rgb = hexToRgb(entry?.hex)
    if (!rgb) continue
    sumW += w
    r += rgb.r * w
    g += rgb.g * w
    b += rgb.b * w
  }
  if (sumW <= 0) return null
  return { r: r / sumW, g: g / sumW, b: b / sumW }
}

function colorDistance(a, b) {
  if (!a || !b) return 1
  const dr = (safeNumber(a.r) - safeNumber(b.r)) / 255
  const dg = (safeNumber(a.g) - safeNumber(b.g)) / 255
  const db = (safeNumber(a.b) - safeNumber(b.b)) / 255
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function normalizeKey(item) {
  const key = item?.hdurl || item?.url
  return key ? String(key) : null
}

function getItemImageSrc(item) {
  const src = item?.hdurl || item?.url
  return src ? String(src) : null
}

function parseISODate(dateString) {
  if (!dateString) return null
  const raw = String(dateString).trim()
  if (!raw) return null
  const date = new Date(`${raw}T00:00:00Z`)
  if (!Number.isFinite(date.getTime())) return null
  return date
}

function getSeasonForMonth(monthIndex) {
  const m = clamp(Number(monthIndex) || 0, 0, 11)
  if (m === 11 || m <= 1) return { id: 'winter', label: 'Winter' }
  if (m >= 2 && m <= 4) return { id: 'spring', label: 'Spring' }
  if (m >= 5 && m <= 7) return { id: 'summer', label: 'Summer' }
  return { id: 'fall', label: 'Fall' }
}

function circularMonthDistance(a, b) {
  const ma = clamp(Number(a) || 0, 0, 11)
  const mb = clamp(Number(b) || 0, 0, 11)
  const d = Math.abs(ma - mb)
  return Math.min(d, 12 - d)
}

function extractEventSignals(text) {
  const raw = String(text ?? '').toLowerCase()
  const matches = (re) => re.test(raw)
  return {
    meteor: matches(/meteor|shower|perseid|geminid|leonid|lyrid|quadrantid|eta\s+aqua/i),
    eclipse: matches(/eclipse|transit|occultation/i),
    aurora: matches(/aurora/i),
    comet: matches(/comet|perihelion/i),
    solstice: matches(/solstice/i),
    equinox: matches(/equinox/i),
  }
}

function summarizeSubjects(featuresList) {
  const counts = new Map()
  for (const features of featuresList) {
    const subjects = Array.isArray(features?.subjects) ? features.subjects : []
    for (const s of subjects) {
      const key = String(s ?? '').trim().toLowerCase()
      if (!key) continue
      counts.set(key, (counts.get(key) || 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function moodCentroid(moodsList) {
  const sums = new Map()
  let count = 0
  for (const moods of moodsList) {
    if (!moods) continue
    count += 1
    for (const [key, value] of Object.entries(moods)) {
      const mood = String(key)
      sums.set(mood, (sums.get(mood) || 0) + safeNumber(value, 0))
    }
  }
  if (count <= 0) return { count: 0, avg: {} }
  const avg = {}
  for (const [mood, sum] of sums.entries()) {
    avg[mood] = sum / count
  }
  return { count, avg }
}

function moodDistance(moodsA, moodsB) {
  const keys = new Set([...Object.keys(moodsA ?? {}), ...Object.keys(moodsB ?? {})])
  if (keys.size === 0) return 1
  let sum = 0
  let n = 0
  for (const key of keys) {
    const a = safeNumber(moodsA?.[key], 0) / 100
    const b = safeNumber(moodsB?.[key], 0) / 100
    sum += Math.abs(a - b)
    n += 1
  }
  return n > 0 ? sum / n : 1
}

export function buildCollectionProfile(collectionItems, analysisByKey) {
  const items = Array.isArray(collectionItems) ? collectionItems : []
  const featuresList = []
  const moodsList = []
  const monthCounts = new Array(12).fill(0)
  const eventCounts = { meteor: 0, eclipse: 0, aurora: 0, comet: 0, solstice: 0, equinox: 0 }
  const colors = []

  for (const item of items) {
    const key = normalizeKey(item)
    if (!key) continue
    const record = analysisByKey?.[key]
    if (record?.features) {
      featuresList.push(record.features)
      if (Array.isArray(record.features?.dominantColors)) {
        const weighted = record.features.dominantColors
          .map((c) => ({ hex: c?.hex, weight: safeNumber(c?.weight, 0) }))
          .filter((c) => c.hex && c.weight > 0)
        const mixed = mixColors(weighted)
        if (mixed) colors.push(mixed)
      }
    }
    if (record?.moods) moodsList.push(record.moods)
    const d = parseISODate(item?.date)
    if (d) monthCounts[d.getUTCMonth()] += 1
    const signals = extractEventSignals(`${item?.title ?? ''} ${item?.explanation ?? ''}`)
    for (const k of Object.keys(eventCounts)) {
      if (signals[k]) eventCounts[k] += 1
    }
  }

  const avgBrightness =
    featuresList.length > 0
      ? featuresList.reduce((sum, f) => sum + safeNumber(f?.brightness, 0), 0) / featuresList.length
      : 0.5
  const avgComplexity =
    featuresList.length > 0
      ? featuresList.reduce((sum, f) => sum + safeNumber(f?.complexity, 0), 0) / featuresList.length
      : 0.5
  const warmRatio =
    featuresList.length > 0
      ? featuresList.reduce((sum, f) => sum + (f?.temperature === 'warm' ? 1 : 0), 0) / featuresList.length
      : 0.5

  const dominantMonth = monthCounts.reduce(
    (best, count, month) => (count > best.count ? { month, count } : best),
    { month: 0, count: 0 }
  )
  const season = getSeasonForMonth(dominantMonth.month)
  const centroid = moodCentroid(moodsList)
  const avgColor = colors.length > 0 ? mixColors(colors.map((c) => ({ hex: rgbToHex(c), weight: 1 }))) : null

  return {
    size: items.length,
    avgBrightness,
    avgComplexity,
    warmRatio,
    dominantMonth: dominantMonth.count > 0 ? dominantMonth.month : null,
    season,
    eventCounts,
    mood: centroid.avg,
    avgColor,
    subjects: summarizeSubjects(featuresList),
  }
}

export function scoreCandidateAgainstProfile(candidate, candidateRecord, profile) {
  const features = candidateRecord?.features
  const moods = candidateRecord?.moods
  if (!features || !moods || !profile) return null

  const candidateColor = mixColors(
    (Array.isArray(features?.dominantColors) ? features.dominantColors : [])
      .map((c) => ({ hex: c?.hex, weight: safeNumber(c?.weight, 0) }))
      .filter((c) => c.hex && c.weight > 0)
  )
  const visualColorScore = profile?.avgColor && candidateColor ? 1 - clamp01(colorDistance(profile.avgColor, candidateColor)) : 0.5
  const visualBrightnessScore = 1 - clamp01(Math.abs(safeNumber(features?.brightness, 0.5) - safeNumber(profile?.avgBrightness, 0.5)))
  const visualComplexityScore = 1 - clamp01(Math.abs(safeNumber(features?.complexity, 0.5) - safeNumber(profile?.avgComplexity, 0.5)))
  const compositionScore = clamp01(0.55 * visualComplexityScore + 0.45 * visualBrightnessScore)
  const visualScore = clamp01(0.55 * visualColorScore + 0.45 * compositionScore)

  const moodScore = 1 - clamp01(moodDistance(moods, profile?.mood))

  const d = parseISODate(candidate?.date)
  const month = d ? d.getUTCMonth() : null
  const monthScore =
    profile?.dominantMonth != null && month != null ? 1 - clamp01(circularMonthDistance(profile.dominantMonth, month) / 6) : 0.5

  const signals = extractEventSignals(`${candidate?.title ?? ''} ${candidate?.explanation ?? ''}`)
  const eventWeightTotal = Object.values(profile?.eventCounts ?? {}).reduce((sum, v) => sum + safeNumber(v, 0), 0)
  const eventAffinity =
    eventWeightTotal > 0
      ? Object.keys(signals).reduce((sum, key) => {
          if (!signals[key]) return sum
          return sum + safeNumber(profile?.eventCounts?.[key], 0) / eventWeightTotal
        }, 0)
      : 0

  const temporalScore = clamp01(0.7 * monthScore + 0.3 * clamp01(eventAffinity))

  const total = clamp01(0.45 * visualScore + 0.35 * moodScore + 0.2 * temporalScore)

  return {
    total,
    breakdown: {
      visual: visualScore,
      mood: moodScore,
      temporal: temporalScore,
    },
  }
}

export function generateCollectionName(collectionItems, analysisByKey) {
  const items = Array.isArray(collectionItems) ? collectionItems : []
  if (items.length === 0) return 'Untitled Collection'

  const profile = buildCollectionProfile(items, analysisByKey)
  const topSubject = profile?.subjects?.[0]?.[0] ?? null
  const subjectLabel = topSubject ? topSubject.replace(/^\w/, (c) => c.toUpperCase()) : null

  const moodEntries = Object.entries(profile?.mood ?? {}).filter(([, v]) => Number.isFinite(Number(v)))
  moodEntries.sort((a, b) => safeNumber(b[1]) - safeNumber(a[1]) || String(a[0]).localeCompare(String(b[0])))
  const topMood = moodEntries[0]?.[0] ?? null

  const seasonLabel = profile?.season?.label ?? null
  const base = [topMood, subjectLabel, seasonLabel].filter(Boolean).join(' ')
  if (base) return base.length > 48 ? base.slice(0, 48).trim() : base

  const fallbackTitle = String(items[0]?.title ?? '').trim()
  if (fallbackTitle) return fallbackTitle.length > 48 ? fallbackTitle.slice(0, 48).trim() : fallbackTitle
  return 'Untitled Collection'
}

export function getDominantSwatchHex(features) {
  const list = Array.isArray(features?.dominantColors) ? features.dominantColors : []
  const best = list
    .map((c) => ({ hex: String(c?.hex ?? '').trim(), weight: safeNumber(c?.weight, 0) }))
    .filter((c) => c.hex && c.weight > 0)
    .sort((a, b) => b.weight - a.weight)[0]
  return best?.hex ?? null
}

export function getItemKey(item) {
  return normalizeKey(item)
}

export function getItemMonthIndex(item) {
  const d = parseISODate(item?.date)
  return d ? d.getUTCMonth() : null
}

export function getItemSeason(item) {
  const month = getItemMonthIndex(item)
  return month == null ? null : getSeasonForMonth(month)
}

export function getImageSrc(item) {
  return getItemImageSrc(item)
}

