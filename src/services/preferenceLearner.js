import { getMoodConfidenceScores, MOODS } from '../utils'

const STORAGE_KEY = 'apod-preferences:v1'
const DEFAULT_HALF_LIFE_DAYS = 28
const DEFAULT_MAX_SEEN = 220
const DEFAULT_MAX_COLLECTIONS = 30

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return clamp(n, 0, 1)
}

function getLocalStorage() {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage ?? null
  } catch {
    return null
  }
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function fnv1aHash(input) {
  const str = String(input ?? '')
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function normalizeItemKey(item) {
  if (!item) return null
  if (item?.date) return `date:${item.date}`
  const url = item?.hdurl || item?.url
  if (!url) return null
  return `url:${fnv1aHash(url)}`
}

function normalizeWeightMap(raw) {
  const map = raw && typeof raw === 'object' ? raw : {}
  const next = {}
  for (const [key, value] of Object.entries(map)) {
    const normalizedKey = String(key ?? '').trim()
    const n = Number(value)
    if (!normalizedKey) continue
    if (!Number.isFinite(n) || n <= 0) continue
    next[normalizedKey] = n
  }
  return next
}

function normalizeSeen(raw, maxEntries) {
  const map = raw && typeof raw === 'object' ? raw : {}
  const entries = []
  for (const [key, value] of Object.entries(map)) {
    const k = String(key ?? '').trim()
    const t = Number(value)
    if (!k) continue
    if (!Number.isFinite(t) || t <= 0) continue
    entries.push([k, t])
  }
  entries.sort((a, b) => b[1] - a[1])
  return Object.fromEntries(entries.slice(0, maxEntries))
}

function emptyState(now, options) {
  const ts = Number(now ?? Date.now())
  const maxSeen = Number(options?.maxSeen ?? DEFAULT_MAX_SEEN)
  const maxCollections = Number(options?.maxCollections ?? DEFAULT_MAX_COLLECTIONS)
  return {
    version: 1,
    createdAt: ts,
    updatedAt: ts,
    lastDecayAt: ts,
    stats: {
      likes: 0,
      views: 0,
      viewTimeMs: 0,
      searches: 0,
      collectionsCreated: 0,
    },
    weights: {
      moods: Object.fromEntries(MOODS.map((mood) => [mood, 0])),
      palettes: { warm: 0, cool: 0, vibrant: 0, muted: 0 },
      subjects: {},
    },
    complexity: {
      mean: 0.5,
      weight: 0,
    },
    seen: {},
    collections: [],
    limits: {
      maxSeen,
      maxCollections,
    },
  }
}

function coerceState(raw, now, options) {
  const base = emptyState(now, options)
  const obj = raw && typeof raw === 'object' ? raw : null
  if (!obj) return base

  const maxSeen = Number(obj?.limits?.maxSeen ?? options?.maxSeen ?? DEFAULT_MAX_SEEN)
  const maxCollections = Number(obj?.limits?.maxCollections ?? options?.maxCollections ?? DEFAULT_MAX_COLLECTIONS)

  const moods = { ...base.weights.moods, ...normalizeWeightMap(obj?.weights?.moods) }
  for (const mood of Object.keys(moods)) {
    moods[mood] = clamp(Number(moods[mood]) || 0, 0, 10_000)
  }

  const palettes = { ...base.weights.palettes, ...normalizeWeightMap(obj?.weights?.palettes) }
  for (const key of Object.keys(palettes)) {
    palettes[key] = clamp(Number(palettes[key]) || 0, 0, 10_000)
  }

  const subjects = normalizeWeightMap(obj?.weights?.subjects)

  const mean = clamp01(obj?.complexity?.mean ?? base.complexity.mean)
  const weight = clamp(Number(obj?.complexity?.weight ?? base.complexity.weight) || 0, 0, 1_000_000)

  const stats = {
    likes: clamp(Number(obj?.stats?.likes) || 0, 0, 1_000_000),
    views: clamp(Number(obj?.stats?.views) || 0, 0, 1_000_000),
    viewTimeMs: clamp(Number(obj?.stats?.viewTimeMs) || 0, 0, 1_000_000_000),
    searches: clamp(Number(obj?.stats?.searches) || 0, 0, 1_000_000),
    collectionsCreated: clamp(Number(obj?.stats?.collectionsCreated) || 0, 0, 1_000_000),
  }

  const createdAt = Number(obj?.createdAt ?? base.createdAt)
  const updatedAt = Number(obj?.updatedAt ?? base.updatedAt)
  const lastDecayAt = Number(obj?.lastDecayAt ?? base.lastDecayAt)

  const seen = normalizeSeen(obj?.seen, maxSeen)
  const collections = Array.isArray(obj?.collections)
    ? obj.collections
        .map((c) => {
          const id = String(c?.id ?? '').trim()
          const kind = String(c?.kind ?? '').trim() || 'collection'
          const name = String(c?.name ?? '').trim()
          const createdAt = Number(c?.createdAt ?? 0)
          if (!id || !name || !Number.isFinite(createdAt) || createdAt <= 0) return null
          return { id, kind, name, createdAt }
        })
        .filter(Boolean)
        .slice(0, maxCollections)
    : []

  return {
    ...base,
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : base.createdAt,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : base.updatedAt,
    lastDecayAt: Number.isFinite(lastDecayAt) && lastDecayAt > 0 ? lastDecayAt : base.lastDecayAt,
    stats,
    weights: { moods, palettes, subjects },
    complexity: { mean, weight },
    seen,
    collections,
    limits: { maxSeen, maxCollections },
  }
}

function totalWeight(map) {
  let sum = 0
  for (const value of Object.values(map ?? {})) {
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) continue
    sum += n
  }
  return sum
}

function bumpWeight(map, key, delta, maxValue = 10_000) {
  if (!key) return
  const current = Number(map[key]) || 0
  const next = clamp(current + delta, 0, maxValue)
  if (next <= 0) delete map[key]
  else map[key] = next
}

function decayFactor(deltaDays, halfLifeDays) {
  const days = Number(deltaDays)
  const halfLife = Number(halfLifeDays)
  if (!Number.isFinite(days) || days <= 0) return 1
  if (!Number.isFinite(halfLife) || halfLife <= 0) return 1
  return 0.5 ** (days / halfLife)
}

function applyDecay(state, now, halfLifeDays) {
  const last = Number(state?.lastDecayAt ?? 0)
  const ts = Number(now ?? Date.now())
  if (!Number.isFinite(last) || last <= 0) {
    state.lastDecayAt = ts
    return
  }

  const deltaDays = (ts - last) / (24 * 60 * 60 * 1000)
  const factor = decayFactor(deltaDays, halfLifeDays)
  if (factor >= 0.999) {
    state.lastDecayAt = ts
    return
  }

  for (const map of [state.weights.moods, state.weights.palettes, state.weights.subjects]) {
    for (const [key, value] of Object.entries(map ?? {})) {
      const n = Number(value)
      if (!Number.isFinite(n) || n <= 0) {
        delete map[key]
        continue
      }
      const decayed = n * factor
      if (decayed < 0.0005) delete map[key]
      else map[key] = decayed
    }
  }

  state.complexity.weight = (Number(state?.complexity?.weight) || 0) * factor
  state.lastDecayAt = ts
}

function derivePalette(features) {
  const temperature = String(features?.temperature ?? '').toLowerCase()
  if (temperature === 'warm') return 'warm'
  if (temperature === 'cool') return 'cool'

  const colors = Array.isArray(features?.dominantColors) ? features.dominantColors : []
  const rawTotal = colors.reduce((sum, c) => sum + (Number(c?.weight) || 0), 0)
  const normalized =
    rawTotal > 0
      ? colors.map((c) => ({ ...c, _w: (Number(c?.weight) || 0) / rawTotal }))
      : colors.map((c) => ({ ...c, _w: colors.length > 0 ? 1 / colors.length : 0 }))

  let avgSat = 0
  let minLum = 1
  let maxLum = 0
  let coolWeight = 0

  for (const c of normalized) {
    const w = Number(c?._w) || 0
    const rgb = c?.rgb ?? []
    const r = clamp(Number(rgb?.[0] ?? 0) / 255, 0, 1)
    const g = clamp(Number(rgb?.[1] ?? 0) / 255, 0, 1)
    const b = clamp(Number(rgb?.[2] ?? 0) / 255, 0, 1)

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const delta = max - min
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b

    const sat = delta === 0 ? 0 : delta / (1 - Math.abs(2 * ((max + min) / 2) - 1))
    avgSat += w * clamp(sat, 0, 1)
    minLum = Math.min(minLum, lum)
    maxLum = Math.max(maxLum, lum)

    let hue = 0
    if (delta !== 0) {
      if (max === r) hue = ((g - b) / delta) % 6
      else if (max === g) hue = (b - r) / delta + 2
      else hue = (r - g) / delta + 4
      hue *= 60
      if (hue < 0) hue += 360
    }

    const cool = hue >= 200 && hue <= 290
    if (cool) coolWeight += w
  }

  const contrast = clamp(maxLum - minLum, 0, 1)
  if (avgSat >= 0.55 && contrast >= 0.25) return 'vibrant'
  if (avgSat <= 0.35 && contrast <= 0.55) return 'muted'
  if (coolWeight >= 0.55) return 'cool'
  return 'warm'
}

function updateComplexity(state, complexity, weight) {
  const w = clamp(Number(weight) || 0, 0, 1000)
  if (w <= 0) return
  const c = clamp01(complexity)
  const prevWeight = Number(state?.complexity?.weight) || 0
  const prevMean = clamp01(state?.complexity?.mean)
  const nextWeight = prevWeight + w
  const nextMean = prevWeight <= 0 ? c : (prevMean * prevWeight + c * w) / nextWeight
  state.complexity.mean = clamp01(nextMean)
  state.complexity.weight = clamp(nextWeight, 0, 1_000_000)
}

function featuresToSubjects(features) {
  const subjects = Array.isArray(features?.subjects) ? features.subjects : []
  return subjects
    .map((s) => String(s ?? '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12)
}

function learnFromFeatures(state, features, strength) {
  const s = clamp(Number(strength) || 0, 0, 50)
  if (s <= 0) return

  const moodScores = getMoodConfidenceScores(features)
  for (const mood of MOODS) {
    const confidence = clamp(Number(moodScores?.[mood]) || 0, 0, 100) / 100
    if (confidence <= 0) continue
    bumpWeight(state.weights.moods, mood, s * confidence)
  }

  const palette = derivePalette(features)
  bumpWeight(state.weights.palettes, palette, s)

  for (const subject of featuresToSubjects(features)) {
    bumpWeight(state.weights.subjects, subject, s * 0.55)
  }

  updateComplexity(state, features?.complexity, s)
}

function scoreWithProfile(profileState, features) {
  const safeFeatures = features ?? {}
  const moodScores = safeFeatures.moodScores || getMoodConfidenceScores(safeFeatures)

  const moodWeights = profileState?.weights?.moods ?? {}
  const moodTotal = totalWeight(moodWeights)
  let moodScore = 0
  if (moodTotal > 0) {
    for (const mood of MOODS) {
      const w = Number(moodWeights?.[mood]) || 0
      if (w <= 0) continue
      moodScore += (w / moodTotal) * (clamp(Number(moodScores?.[mood]) || 0, 0, 100) / 100)
    }
  } else {
    moodScore = 0.5
  }

  const paletteWeights = profileState?.weights?.palettes ?? {}
  const paletteTotal = totalWeight(paletteWeights)
  const palette = derivePalette(safeFeatures)
  const paletteScore =
    paletteTotal > 0 ? clamp((Number(paletteWeights?.[palette]) || 0) / paletteTotal, 0, 1) : 0.5

  const subjects = featuresToSubjects(safeFeatures)
  const subjectWeights = profileState?.weights?.subjects ?? {}
  const subjectTotal = totalWeight(subjectWeights)
  let subjectScore = 0.5
  if (subjectTotal > 0 && subjects.length > 0) {
    let sum = 0
    for (const subject of subjects) {
      sum += Number(subjectWeights?.[subject]) || 0
    }
    subjectScore = clamp(sum / subjectTotal, 0, 1)
  }

  const complexityMean = clamp01(profileState?.complexity?.mean)
  const complexityWeight = Number(profileState?.complexity?.weight) || 0
  const complexityValue = clamp01(safeFeatures?.complexity)
  const complexityScore =
    complexityWeight > 0 ? clamp(1 - Math.abs(complexityValue - complexityMean) * 1.6, 0, 1) : 0.5

  const total = 0.4 * moodScore + 0.2 * paletteScore + 0.25 * subjectScore + 0.15 * complexityScore
  return clamp(total, 0, 1)
}

function stableSortByScore(entries) {
  return [...entries].sort((a, b) => b.score - a.score || String(a.key).localeCompare(String(b.key)))
}

export function createPreferenceLearner(options = {}) {
  const storageKey = String(options?.storageKey ?? STORAGE_KEY)
  const halfLifeDays = Number(options?.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS)
  const maxSeen = Number(options?.maxSeen ?? DEFAULT_MAX_SEEN)
  const maxCollections = Number(options?.maxCollections ?? DEFAULT_MAX_COLLECTIONS)

  let state = null
  const listeners = new Set()

  function ensureLoaded() {
    if (state) return state
    const storage = getLocalStorage()
    const now = Date.now()
    if (!storage) {
      state = emptyState(now, { maxSeen, maxCollections })
      return state
    }
    const raw = safeJsonParse(storage.getItem(storageKey) ?? '')
    state = coerceState(raw, now, { maxSeen, maxCollections })
    applyDecay(state, now, halfLifeDays)
    state.updatedAt = now
    persist()
    return state
  }

  function persist() {
    const storage = getLocalStorage()
    if (!storage || !state) return
    try {
      storage.setItem(storageKey, JSON.stringify(state))
    } catch {
      return
    }
  }

  function emit() {
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        continue
      }
    }
  }

  function touchSeen(itemKey, now) {
    if (!itemKey) return
    const s = ensureLoaded()
    s.seen[itemKey] = now
    const entries = Object.entries(s.seen)
    if (entries.length <= s.limits.maxSeen) return
    entries.sort((a, b) => b[1] - a[1])
    s.seen = Object.fromEntries(entries.slice(0, s.limits.maxSeen))
  }

  function recordInteraction({ kind, item, features, strength, durationMs }) {
    const s = ensureLoaded()
    const now = Date.now()
    applyDecay(s, now, halfLifeDays)

    const itemKey = normalizeItemKey(item)
    if (itemKey) touchSeen(itemKey, now)

    if (kind === 'like') {
      s.stats.likes += 1
    } else if (kind === 'view') {
      s.stats.views += 1
      s.stats.viewTimeMs += clamp(Number(durationMs) || 0, 0, 6 * 60 * 60 * 1000)
    } else if (kind === 'search') {
      s.stats.searches += 1
    } else if (kind === 'collection') {
      s.stats.collectionsCreated += 1
    }

    if (features) {
      learnFromFeatures(s, features, strength)
    }

    s.updatedAt = now
    persist()
    emit()
  }

  function learnFromQuery(query, strength) {
    const s = ensureLoaded()
    const now = Date.now()
    applyDecay(s, now, halfLifeDays)

    const moods = Array.isArray(query?.moods) ? query.moods : []
    for (const mood of moods) {
      const key = String(mood ?? '').trim()
      if (!key) continue
      bumpWeight(s.weights.moods, key, strength * 0.9)
    }

    const palette = String(query?.palette ?? '').trim().toLowerCase()
    if (palette && palette !== 'any') bumpWeight(s.weights.palettes, palette, strength * 0.85)

    const groups = query?.subjects ?? {}
    const enabled = Object.entries(groups)
      .filter(([, on]) => Boolean(on))
      .map(([k]) => String(k).trim().toLowerCase())
      .filter(Boolean)
    for (const group of enabled) {
      bumpWeight(s.weights.subjects, group, strength * 0.55)
    }

    s.updatedAt = now
    persist()
    emit()
  }

  function getProfile() {
    const s = ensureLoaded()
    const moodEntries = Object.entries(s.weights.moods)
      .map(([mood, weight]) => ({ mood, weight: Number(weight) || 0 }))
      .filter((entry) => entry.weight > 0)
      .sort((a, b) => b.weight - a.weight || a.mood.localeCompare(b.mood))

    const paletteEntries = Object.entries(s.weights.palettes)
      .map(([palette, weight]) => ({ palette, weight: Number(weight) || 0 }))
      .filter((entry) => entry.weight > 0)
      .sort((a, b) => b.weight - a.weight || a.palette.localeCompare(b.palette))

    const subjectEntries = Object.entries(s.weights.subjects)
      .map(([subject, weight]) => ({ subject, weight: Number(weight) || 0 }))
      .filter((entry) => entry.weight > 0)
      .sort((a, b) => b.weight - a.weight || a.subject.localeCompare(b.subject))

    return {
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      stats: { ...s.stats },
      favorites: {
        moods: moodEntries.slice(0, 3).map((entry) => entry.mood),
        palettes: paletteEntries.slice(0, 2).map((entry) => entry.palette),
        subjects: subjectEntries.slice(0, 5).map((entry) => entry.subject),
        complexity: {
          mean: clamp01(s.complexity.mean),
        },
      },
    }
  }

  function recommend(items, options = {}) {
    const s = ensureLoaded()
    const list = Array.isArray(items) ? items : []
    const featuresByKey = options?.featuresByKey ?? null
    const getFeatures = typeof options?.getFeatures === 'function' ? options.getFeatures : null
    const limit = clamp(Number(options?.limit ?? 16) || 16, 1, 60)
    const excludeSeen = options?.excludeSeen !== false

    const entries = []
    for (const item of list) {
      const itemKey = normalizeItemKey(item)
      if (!itemKey) continue
      if (excludeSeen && s.seen[itemKey]) continue

      const src = item?.hdurl || item?.url
      const features =
        (featuresByKey && src ? featuresByKey[src]?.features ?? featuresByKey[src] : null) ??
        (getFeatures ? getFeatures(item) : null)
      if (!features) continue

      const score = scoreWithProfile(s, features)
      entries.push({ item, key: itemKey, score })
    }

    const ranked = stableSortByScore(entries)
    return ranked.slice(0, limit)
  }

  function reset() {
    const storage = getLocalStorage()
    try {
      storage?.removeItem(storageKey)
    } catch {
      return
    }
    state = null
    ensureLoaded()
    emit()
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return {
    storageKey,
    normalizeItemKey,
    getProfile,
    recommend,
    reset,
    subscribe,
    recordLike({ item, features, liked = true } = {}) {
      const strength = liked ? 2.2 : 0.6
      recordInteraction({ kind: 'like', item, features, strength })
    },
    recordView({ item, features, durationMs } = {}) {
      const ms = clamp(Number(durationMs) || 0, 0, 6 * 60 * 60 * 1000)
      const durationMinutes = ms / (60 * 1000)
      const strength = clamp(0.25 + durationMinutes * 0.55, 0.25, 2.2)
      recordInteraction({ kind: 'view', item, features, durationMs: ms, strength })
    },
    recordSearchQuery(query) {
      const strength = 0.35
      recordInteraction({ kind: 'search', strength: 0 })
      learnFromQuery(query, strength)
    },
    recordCollectionCreated({ kind = 'collection', name, query } = {}) {
      const collectionName = String(name ?? '').trim()
      if (!collectionName) return
      const s = ensureLoaded()
      const now = Date.now()
      applyDecay(s, now, halfLifeDays)

      s.stats.collectionsCreated += 1
      s.collections = [
        {
          id: `${now}-${fnv1aHash(`${kind}:${collectionName}`)}`,
          kind: String(kind ?? '').trim() || 'collection',
          name: collectionName,
          createdAt: now,
        },
        ...(Array.isArray(s.collections) ? s.collections : []),
      ].slice(0, s.limits.maxCollections)

      const strength = 1.2
      learnFromQuery(query, strength)
      s.updatedAt = now
      persist()
      emit()
    },
  }
}

export const preferenceLearner = createPreferenceLearner()

