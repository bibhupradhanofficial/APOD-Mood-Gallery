const MOOD_DEFINITIONS = [
  {
    mood: 'Calming',
    description: 'Cool tones, low complexity, smooth gradients, and gentle nebulae.',
    criteria: {
      colors: { preferredHues: ['blue', 'purple'], minCoolWeight: 0.45 },
      complexity: { max: 0.4 },
      subjects: { includeAny: ['nebulae'] },
      contrast: { max: 0.55 },
    },
  },
  {
    mood: 'Energizing',
    description: 'Bright, high-contrast imagery with dynamic cosmic activity.',
    criteria: {
      colors: { minVividWeight: 0.35, minBrightness: 0.55 },
      complexity: { min: 0.55 },
      contrast: { min: 0.55 },
      subjects: { includeAny: ['supernovae', 'active galaxies', 'rockets', 'satellites'] },
    },
  },
  {
    mood: 'Mysterious',
    description: 'Dark tones, complex structure, and deep-space subjects.',
    criteria: {
      colors: { minDarkWeight: 0.5 },
      complexity: { min: 0.55 },
      subjects: { includeAny: ['black holes', 'deep space'] },
      brightness: { max: 0.5 },
    },
  },
  {
    mood: 'Inspiring',
    description: 'Earth views and vivid celestial scenes like nebulae and star clusters.',
    criteria: {
      subjects: { includeAny: ['earth', 'nebulae', 'stars', 'star clusters'] },
      colors: { minVividWeight: 0.25 },
      brightness: { min: 0.45 },
    },
  },
  {
    mood: 'Cosmic',
    description: 'Abstract patterns, spiral galaxies, and prominent cosmic phenomena.',
    criteria: {
      subjects: { includeAny: ['galaxies', 'nebulae', 'planets', 'stars', 'comets', 'asteroids'] },
      complexity: { min: 0.45 },
      contrast: { preferred: 'moderate' },
    },
  },
]

export const MOODS = MOOD_DEFINITIONS.map((d) => d.mood)

function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function clampInt(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.round(n)))
}

function weightedSum(terms) {
  let numerator = 0
  let denom = 0
  for (const term of terms) {
    const w = Number(term?.weight)
    const v = Number(term?.value)
    if (!Number.isFinite(w) || !Number.isFinite(v) || w <= 0) continue
    numerator += w * v
    denom += w
  }
  return denom > 0 ? numerator / denom : 0
}

function rgbToHsl(rgb) {
  const r = clamp01(Number(rgb?.[0]) / 255)
  const g = clamp01(Number(rgb?.[1]) / 255)
  const b = clamp01(Number(rgb?.[2]) / 255)

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }

  const l = (max + min) / 2
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))
  return { h, s, l }
}

function luminance(rgb) {
  const r = clamp01(Number(rgb?.[0]) / 255)
  const g = clamp01(Number(rgb?.[1]) / 255)
  const b = clamp01(Number(rgb?.[2]) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function hueInRange(hue, minDeg, maxDeg) {
  const h = ((Number(hue) % 360) + 360) % 360
  const min = ((Number(minDeg) % 360) + 360) % 360
  const max = ((Number(maxDeg) % 360) + 360) % 360

  if (min <= max) return h >= min && h <= max
  return h >= min || h <= max
}

function normalizeWeights(colors) {
  const entries = Array.isArray(colors) ? colors : []
  const rawTotal = entries.reduce((sum, c) => sum + (Number(c?.weight) || 0), 0)
  if (rawTotal > 0) {
    return entries.map((c) => ({ ...c, _w: (Number(c?.weight) || 0) / rawTotal }))
  }
  const fallback = entries.length > 0 ? 1 / entries.length : 0
  return entries.map((c) => ({ ...c, _w: fallback }))
}

function toSubjectSet(subjects) {
  const set = new Set()
  for (const item of Array.isArray(subjects) ? subjects : []) {
    const normalized = String(item ?? '').trim().toLowerCase()
    if (normalized) set.add(normalized)
  }
  return set
}

function subjectAny(subjects, candidates) {
  const set = toSubjectSet(subjects)
  for (const c of candidates) {
    const normalized = String(c ?? '').trim().toLowerCase()
    if (!normalized) continue
    if (set.has(normalized)) return 1
  }
  return 0
}

function subjectCount(subjects, candidates) {
  const set = toSubjectSet(subjects)
  let count = 0
  for (const c of candidates) {
    const normalized = String(c ?? '').trim().toLowerCase()
    if (!normalized) continue
    if (set.has(normalized)) count += 1
  }
  return count
}

function computeColorStats(dominantColors = []) {
  const colors = normalizeWeights(dominantColors)

  let avgSat = 0
  let avgLum = 0
  let minLum = 1
  let maxLum = 0
  let coolWeight = 0
  let darkWeight = 0
  let brightWeight = 0
  let vividWeight = 0

  for (const c of colors) {
    const w = Number(c?._w) || 0
    const rgb = c?.rgb
    const { h, s } = rgbToHsl(rgb)
    const lum = luminance(rgb)

    avgSat += w * clamp01(s)
    avgLum += w * clamp01(lum)
    minLum = Math.min(minLum, lum)
    maxLum = Math.max(maxLum, lum)

    if (hueInRange(h, 200, 290)) coolWeight += w
    if (lum < 0.25) darkWeight += w
    if (lum > 0.75) brightWeight += w
    if (s > 0.65 && lum > 0.25 && lum < 0.9) vividWeight += w
  }

  const contrast = clamp01(maxLum - minLum)
  return {
    avgSat: clamp01(avgSat),
    avgLum: clamp01(avgLum),
    contrast,
    coolWeight: clamp01(coolWeight),
    darkWeight: clamp01(darkWeight),
    brightWeight: clamp01(brightWeight),
    vividWeight: clamp01(vividWeight),
  }
}

function scoreCalming(features, stats) {
  const complexity = clamp01(features?.complexity)
  const temperature = String(features?.temperature ?? '').toLowerCase()
  const coolTemp = temperature === 'cool' ? 1 : 0
  const nebulae = subjectAny(features?.subjects, ['nebulae'])
  const smoothness = clamp01(
    0.55 * (1 - stats.contrast) + 0.25 * (1 - complexity) + 0.2 * coolTemp
  )

  return weightedSum([
    { weight: 0.35, value: stats.coolWeight },
    { weight: 0.35, value: 1 - complexity },
    { weight: 0.2, value: nebulae },
    { weight: 0.1, value: smoothness },
  ])
}

function scoreEnergizing(features, stats) {
  const complexity = clamp01(features?.complexity)
  const vividBright = clamp01(0.55 * stats.vividWeight + 0.45 * stats.brightWeight)
  const activeSubjects =
    subjectAny(features?.subjects, ['supernovae', 'active galaxies', 'rockets', 'satellites']) ||
    subjectAny(features?.subjects, ['comets', 'asteroids'])

  return weightedSum([
    { weight: 0.35, value: vividBright },
    { weight: 0.35, value: stats.contrast },
    { weight: 0.2, value: complexity },
    { weight: 0.1, value: activeSubjects },
  ])
}

function scoreMysterious(features, stats) {
  const complexity = clamp01(features?.complexity)
  const brightness = clamp01(features?.brightness)
  const temperature = String(features?.temperature ?? '').toLowerCase()
  const coolTemp = temperature === 'cool' ? 1 : 0

  const deepSpaceSubjects =
    subjectAny(features?.subjects, ['black holes', 'deep space']) ||
    subjectAny(features?.subjects, ['galaxies', 'nebulae'])

  const earthPenalty = subjectAny(features?.subjects, ['earth']) ? 0.25 : 0

  const base = weightedSum([
    { weight: 0.4, value: stats.darkWeight },
    { weight: 0.3, value: complexity },
    { weight: 0.2, value: deepSpaceSubjects },
    { weight: 0.1, value: 0.5 * (1 - brightness) + 0.5 * coolTemp },
  ])

  return clamp01(base - earthPenalty)
}

function scoreInspiring(features, stats) {
  const brightness = clamp01(features?.brightness)
  const earth = subjectAny(features?.subjects, ['earth'])
  const nebulae = subjectAny(features?.subjects, ['nebulae'])
  const stars = subjectAny(features?.subjects, ['stars', 'star clusters'])

  const colorful = clamp01(0.65 * stats.vividWeight + 0.35 * stats.brightWeight)
  const nebulaColor = nebulae ? colorful : 0
  const starColor = stars ? colorful : 0

  return weightedSum([
    { weight: 0.4, value: earth },
    { weight: 0.25, value: nebulaColor },
    { weight: 0.25, value: starColor },
    { weight: 0.1, value: brightness },
  ])
}

function scoreCosmic(features, stats) {
  const complexity = clamp01(features?.complexity)
  const phenomenaCount = subjectCount(features?.subjects, [
    'galaxies',
    'nebulae',
    'planets',
    'stars',
    'comets',
    'asteroids',
  ])
  const phenomena = clamp01(phenomenaCount / 3)
  const earthPenalty = subjectAny(features?.subjects, ['earth']) ? 0.2 : 0

  const contrastModerate = clamp01(1 - Math.abs(stats.contrast - 0.5) * 2)
  const abstractness = clamp01(0.6 * complexity + 0.4 * stats.contrast)

  const base = weightedSum([
    { weight: 0.3, value: phenomena },
    { weight: 0.25, value: abstractness },
    { weight: 0.25, value: contrastModerate },
    { weight: 0.2, value: stats.avgSat },
  ])

  return clamp01(base - earthPenalty)
}

export function getMoodConfidenceScores(features) {
  const safeFeatures = features ?? {}
  const stats = computeColorStats(safeFeatures?.dominantColors)

  const rawScores = {
    Calming: scoreCalming(safeFeatures, stats),
    Energizing: scoreEnergizing(safeFeatures, stats),
    Mysterious: scoreMysterious(safeFeatures, stats),
    Inspiring: scoreInspiring(safeFeatures, stats),
    Cosmic: scoreCosmic(safeFeatures, stats),
  }

  const confidences = {}
  for (const mood of MOODS) {
    confidences[mood] = clampInt(clamp01(rawScores[mood]) * 100, 0, 100)
  }

  return confidences
}

export function classifyMoods(features, options = {}) {
  const topN = clampInt(options?.topN ?? 3, 1, MOODS.length)
  const scores = getMoodConfidenceScores(features)

  return MOODS.map((mood) => ({ mood, confidence: scores[mood] }))
    .sort((a, b) => b.confidence - a.confidence || a.mood.localeCompare(b.mood))
    .slice(0, topN)
}

export function getMoodCriteria(mood) {
  const key = String(mood ?? '').trim().toLowerCase()
  const def = MOOD_DEFINITIONS.find((d) => d.mood.toLowerCase() === key)
  if (!def) return null
  return { mood: def.mood, description: def.description, criteria: def.criteria }
}

