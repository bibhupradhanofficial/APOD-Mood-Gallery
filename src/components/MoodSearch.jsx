import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, isValid, parseISO, subDays } from 'date-fns'

import { analyzeImage, fetchAPODRange, fetchRandomAPODs, preferenceLearner } from '../services'
import { getMoodConfidenceScores, MOODS } from '../utils'

const PRESETS_KEY = 'apod-mood-search-presets:v1'
const DEFAULT_MAX_CANDIDATES = 60
const DEFAULT_SURPRISE_BATCH = 20
const DEFAULT_MOOD_THRESHOLD = 60

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function safeParseDate(dateString) {
  if (!dateString) return null
  try {
    const parsed = parseISO(dateString)
    if (!isValid(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

function toISOInput(date) {
  if (!date) return ''
  try {
    return format(date, 'yyyy-MM-dd')
  } catch {
    return ''
  }
}

function normalizeKey(item) {
  const key = item?.hdurl || item?.url
  return key ? String(key) : null
}

function readPresets() {
  try {
    if (typeof window === 'undefined') return []
    const raw = window.localStorage?.getItem(PRESETS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => {
        const id = String(entry?.id ?? '').trim()
        const name = String(entry?.name ?? '').trim()
        if (!id || !name) return null
        return {
          id,
          name,
          createdAt: Number(entry?.createdAt ?? Date.now()),
          query: entry?.query ?? null,
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

function writePresets(presets) {
  try {
    if (typeof window === 'undefined') return
    window.localStorage?.setItem(PRESETS_KEY, JSON.stringify(presets))
  } catch {
    return
  }
}

function colorStats(dominantColors = []) {
  const entries = Array.isArray(dominantColors) ? dominantColors : []
  const rawTotal = entries.reduce((sum, c) => sum + (Number(c?.weight) || 0), 0)
  const colors =
    rawTotal > 0
      ? entries.map((c) => ({ ...c, _w: (Number(c?.weight) || 0) / rawTotal }))
      : entries.map((c) => ({ ...c, _w: entries.length > 0 ? 1 / entries.length : 0 }))

  let avgSat = 0
  let minLum = 1
  let maxLum = 0
  let coolWeight = 0

  for (const c of colors) {
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

  return {
    avgSat: clamp(avgSat, 0, 1),
    contrast: clamp(maxLum - minLum, 0, 1),
    coolWeight: clamp(coolWeight, 0, 1),
  }
}

function rgbToHsl(rgb) {
  const r = clamp(Number(rgb?.[0] ?? 0) / 255, 0, 1)
  const g = clamp(Number(rgb?.[1] ?? 0) / 255, 0, 1)
  const b = clamp(Number(rgb?.[2] ?? 0) / 255, 0, 1)

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

function approximateColorName(rgb) {
  const { h, s, l } = rgbToHsl(rgb)
  if (l < 0.18) return 'black'
  if (l > 0.86 && s < 0.18) return 'white'
  if (s < 0.14) return 'gray'

  if (h >= 345 || h < 15) return 'red'
  if (h >= 15 && h < 45) return 'orange'
  if (h >= 45 && h < 75) return 'yellow'
  if (h >= 75 && h < 165) return 'green'
  if (h >= 165 && h < 190) return 'teal'
  if (h >= 190 && h < 215) return 'cyan'
  if (h >= 215 && h < 255) return 'blue'
  if (h >= 255 && h < 295) return 'purple'
  if (h >= 295 && h < 345) return 'magenta'
  return 'color'
}

function matchesColorTerms(features, terms) {
  const wants = Array.isArray(terms) ? terms.map((t) => String(t ?? '').trim().toLowerCase()).filter(Boolean) : []
  if (wants.length === 0) return true

  const colors = Array.isArray(features?.dominantColors) ? features.dominantColors : []
  if (colors.length === 0) return false

  const observed = new Set()
  for (const c of colors) {
    const name = approximateColorName(c?.rgb)
    if (name) observed.add(name)
  }

  const expanded = wants.flatMap((t) => {
    if (t === 'pink') return ['magenta']
    if (t === 'violet' || t === 'indigo' || t === 'lavender') return ['purple']
    if (t === 'fuchsia') return ['magenta']
    if (t === 'aqua' || t === 'turquoise') return ['cyan', 'teal']
    if (t === 'grey') return ['gray']
    return [t]
  })

  return expanded.some((t) => observed.has(t))
}

function matchesPalette(features, palette) {
  const mode = String(palette ?? 'any').toLowerCase()
  if (mode === 'any') return true

  const temperature = String(features?.temperature ?? '').toLowerCase()
  const stats = colorStats(features?.dominantColors)

  if (mode === 'warm') return temperature === 'warm'
  if (mode === 'cool') return temperature === 'cool'
  if (mode === 'vibrant') return stats.avgSat >= 0.55 && stats.contrast >= 0.25
  if (mode === 'muted') return stats.avgSat <= 0.35 && stats.contrast <= 0.55
  return true
}

function matchesSubjects(subjects, selectedGroups) {
  const set = new Set((Array.isArray(subjects) ? subjects : []).map((s) => String(s).toLowerCase()))
  const groups = selectedGroups ?? {}

  const wants = Object.entries(groups)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([key]) => key)

  if (wants.length === 0) return true

  const groupToSubjects = {
    galaxies: ['galaxies'],
    planets: ['planets'],
    nebulae: ['nebulae'],
    earth: ['earth'],
    stars: ['stars'],
    phenomena: ['comets', 'asteroids', 'moons'],
  }

  for (const want of wants) {
    const mapped = groupToSubjects[want] ?? []
    if (mapped.some((s) => set.has(s))) return true
  }

  return false
}

function matchesMood(scores, selectedMoods, logic, threshold) {
  const moods = Array.isArray(selectedMoods) ? selectedMoods.filter(Boolean) : []
  if (moods.length === 0) return true

  const mode = String(logic ?? 'or').toLowerCase()
  const min = clamp(Number(threshold ?? DEFAULT_MOOD_THRESHOLD), 0, 100)

  if (mode === 'and') {
    return moods.every((mood) => Number(scores?.[mood] ?? 0) >= min)
  }

  return moods.some((mood) => Number(scores?.[mood] ?? 0) >= min)
}

function MoodButton({ mood, selected, onToggle }) {
  const key = String(mood ?? '').toLowerCase()
  const theme = key.includes('calm')
    ? 'from-sky-500/25 to-indigo-500/10 text-sky-100 ring-sky-400/30'
    : key.includes('energ')
      ? 'from-orange-500/25 to-rose-500/10 text-orange-100 ring-orange-400/30'
      : key.includes('myster')
        ? 'from-indigo-500/25 to-fuchsia-500/10 text-indigo-100 ring-indigo-400/30'
        : key.includes('inspir')
          ? 'from-emerald-500/25 to-sky-500/10 text-emerald-100 ring-emerald-400/30'
          : 'from-fuchsia-500/25 to-slate-500/10 text-fuchsia-100 ring-fuchsia-400/30'

  return (
    <button
      type="button"
      onClick={() => onToggle?.(mood)}
      className={[
        'group relative flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition',
        'bg-gradient-to-br backdrop-blur-xl',
        selected ? 'border-white/25 ring-1 ring-white/20' : 'border-white/10 hover:border-white/20',
        theme,
      ].join(' ')}
    >
      <span className="font-medium tracking-wide">{mood}</span>
      <span
        className={[
          'inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs',
          selected ? 'border-white/30 bg-white/15' : 'border-white/15 bg-white/5',
        ].join(' ')}
        aria-hidden="true"
      >
        {selected ? '✓' : '+'}
      </span>
    </button>
  )
}

export default function MoodSearch({
  items,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  onSurprise,
  onQueryChange,
  moodThreshold = DEFAULT_MOOD_THRESHOLD,
  externalQuery,
  externalQueryKey,
}) {
  const today = useMemo(() => new Date(), [])
  const defaultEnd = useMemo(() => toISOInput(today), [today])
  const defaultStart = useMemo(() => toISOInput(subDays(today, 30)), [today])

  const [dateStart, setDateStart] = useState(defaultStart)
  const [dateEnd, setDateEnd] = useState(defaultEnd)
  const [palette, setPalette] = useState('any')
  const [subjectGroups, setSubjectGroups] = useState({
    galaxies: false,
    planets: false,
    nebulae: false,
    earth: false,
    stars: false,
    phenomena: false,
  })
  const [minBrightnessPct, setMinBrightnessPct] = useState(0)
  const [moodLogic, setMoodLogic] = useState('or')
  const [selectedMoods, setSelectedMoods] = useState([])
  const [colorTerms, setColorTerms] = useState([])

  const [candidateItems, setCandidateItems] = useState([])
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [candidateError, setCandidateError] = useState(null)

  const [analysisByKey, setAnalysisByKey] = useState({})
  const analysisRef = useRef(analysisByKey)
  useEffect(() => {
    analysisRef.current = analysisByKey
  }, [analysisByKey])

  const [analysisProgress, setAnalysisProgress] = useState({ total: 0, done: 0 })

  const [surpriseItem, setSurpriseItem] = useState(null)
  const [surpriseError, setSurpriseError] = useState(null)
  const [surpriseRunning, setSurpriseRunning] = useState(false)

  const [presets, setPresets] = useState(() => readPresets())
  const [presetName, setPresetName] = useState('')

  const minBrightness = clamp(minBrightnessPct / 100, 0, 1)
  const query = useMemo(
    () => ({
      moods: selectedMoods,
      moodLogic,
      moodThreshold,
      palette,
      colors: colorTerms,
      subjects: subjectGroups,
      minBrightness,
      dateStart,
      dateEnd,
    }),
    [selectedMoods, moodLogic, moodThreshold, palette, colorTerms, subjectGroups, minBrightness, dateStart, dateEnd]
  )

  useEffect(() => {
    onQueryChange?.(query)
  }, [query, onQueryChange])

  const applyQueryObject = useCallback((q) => {
    const next = q ?? null
    if (!next) return
    preferenceLearner.recordSearchQuery(next)

    setSelectedMoods(Array.isArray(next?.moods) ? next.moods : [])
    setMoodLogic(typeof next?.moodLogic === 'string' ? String(next.moodLogic ?? 'or') : 'or')
    setPalette(typeof next?.palette === 'string' ? String(next.palette ?? 'any') : 'any')
    setColorTerms(Array.isArray(next?.colors) ? next.colors : [])

    setSubjectGroups({
      galaxies: Boolean(next?.subjects?.galaxies),
      planets: Boolean(next?.subjects?.planets),
      nebulae: Boolean(next?.subjects?.nebulae),
      earth: Boolean(next?.subjects?.earth),
      stars: Boolean(next?.subjects?.stars),
      phenomena: Boolean(next?.subjects?.phenomena),
    })

    setMinBrightnessPct(
      typeof next?.minBrightness === 'number' ? clamp(Number(next.minBrightness) * 100, 0, 100) : 0
    )

    if (typeof next?.dateStart === 'string') setDateStart(next.dateStart)
    if (typeof next?.dateEnd === 'string') setDateEnd(next.dateEnd)
  }, [])

  useEffect(() => {
    if (!externalQuery) return
    applyQueryObject(externalQuery)
  }, [externalQueryKey, externalQuery, applyQueryObject])

  const effectiveItems = items ?? candidateItems
  const safeRange = useMemo(() => {
    const start = safeParseDate(dateStart)
    const end = safeParseDate(dateEnd)
    if (!start || !end) return null
    const startMs = start.getTime()
    const endMs = end.getTime()
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
    return startMs <= endMs ? { start, end } : { start: end, end: start }
  }, [dateStart, dateEnd])

  const rangeFilteredItems = useMemo(() => {
    const list = Array.isArray(effectiveItems) ? effectiveItems : []
    if (!safeRange) return list
    const startMs = safeRange.start.getTime()
    const endMs = safeRange.end.getTime()
    return list.filter((item) => {
      const d = safeParseDate(item?.date)
      if (!d) return false
      const t = d.getTime()
      return t >= startMs && t <= endMs
    })
  }, [effectiveItems, safeRange])

  const cappedCandidates = useMemo(() => {
    const list = [...rangeFilteredItems]
    list.sort((a, b) => String(b?.date ?? '').localeCompare(String(a?.date ?? '')))
    return list.slice(0, clamp(Number(maxCandidates) || DEFAULT_MAX_CANDIDATES, 10, 200))
  }, [rangeFilteredItems, maxCandidates])

  useEffect(() => {
    if (items) return
    if (!safeRange) return

    let mounted = true
    setLoadingCandidates(true)
    setCandidateError(null)

    ;(async () => {
      try {
        const start = toISOInput(safeRange.start)
        const end = toISOInput(safeRange.end)
        const results = await fetchAPODRange(start, end)
        if (!mounted) return
        setCandidateItems(Array.isArray(results) ? results : [])
      } catch (error) {
        if (!mounted) return
        setCandidateError(error)
        setCandidateItems([])
      } finally {
        if (mounted) {
          setLoadingCandidates(false)
        }
      }
    })()

    return () => {
      mounted = false
    }
  }, [items, safeRange])

  useEffect(() => {
    const controller = new AbortController()
    let mounted = true

    setAnalysisProgress({ total: 0, done: 0 })

    ;(async () => {
      const candidates = cappedCandidates
      if (candidates.length === 0) return

      const missing = []
      for (const item of candidates) {
        const key = normalizeKey(item)
        if (!key) continue
        if (analysisRef.current[key]) continue
        missing.push({ key, item })
      }

      if (missing.length === 0) return

      const total = missing.length
      let done = 0
      if (!mounted) return
      setAnalysisProgress({ total, done })

      for (const entry of missing) {
        if (controller.signal.aborted) break
        try {
          const features = await analyzeImage(entry.key, {
            cacheKey: entry.key,
            signal: controller.signal,
            maxAgeMs: 1000 * 60 * 60 * 24 * 30,
          })
          const moods = features.moodScores || getMoodConfidenceScores(features)
          if (!mounted) return
          setAnalysisByKey((prev) => ({ ...prev, [entry.key]: { features, moods } }))
        } catch {
          if (!mounted) return
        } finally {
          done += 1
          if (mounted) {
            setAnalysisProgress((prev) => ({ ...prev, total, done }))
          }
        }
      }
    })()

    return () => {
      mounted = false
      controller.abort()
    }
  }, [cappedCandidates])

  const { matchedCount, analyzedCount } = useMemo(() => {
    const candidates = cappedCandidates
    if (candidates.length === 0) return { matchedCount: 0, analyzedCount: 0 }

    let analyzed = 0
    let matched = 0
    for (const item of candidates) {
      const key = normalizeKey(item)
      if (!key) continue
      const record = analysisByKey[key]
      if (!record) continue
      analyzed += 1

      const brightnessOk = Number(record?.features?.brightness ?? 0) >= minBrightness
      if (!brightnessOk) continue
      if (!matchesPalette(record?.features, palette)) continue
      if (!matchesColorTerms(record?.features, colorTerms)) continue
      if (!matchesSubjects(record?.features?.subjects, subjectGroups)) continue
      if (!matchesMood(record?.moods, selectedMoods, moodLogic, moodThreshold)) continue

      matched += 1
    }

    return { matchedCount: matched, analyzedCount: analyzed }
  }, [
    cappedCandidates,
    analysisByKey,
    minBrightness,
    palette,
    colorTerms,
    subjectGroups,
    selectedMoods,
    moodLogic,
    moodThreshold,
  ])

  const toggleMood = useCallback((mood) => {
    setSelectedMoods((prev) => {
      const key = String(mood ?? '').trim()
      if (!key) return prev
      if (prev.includes(key)) return prev.filter((m) => m !== key)
      return [...prev, key]
    })
  }, [])

  const toggleSubjectGroup = useCallback((groupKey) => {
    setSubjectGroups((prev) => ({ ...prev, [groupKey]: !prev?.[groupKey] }))
  }, [])

  const clearAll = useCallback(() => {
    setSelectedMoods([])
    setMoodLogic('or')
    setPalette('any')
    setColorTerms([])
    setSubjectGroups({
      galaxies: false,
      planets: false,
      nebulae: false,
      earth: false,
      stars: false,
      phenomena: false,
    })
    setMinBrightnessPct(0)
  }, [])

  const savePreset = useCallback(() => {
    preferenceLearner.recordSearchQuery(query)
    const name = String(presetName ?? '').trim()
    if (!name) return

    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      createdAt: Date.now(),
      query,
    }

    setPresets((prev) => {
      const next = [entry, ...(Array.isArray(prev) ? prev : [])].slice(0, 30)
      writePresets(next)
      return next
    })
    setPresetName('')
  }, [presetName, query])

  const applyPreset = useCallback((preset) => {
    const q = preset?.query ?? null
    if (!q) return
    applyQueryObject(q)
  }, [applyQueryObject])

  const deletePreset = useCallback((presetId) => {
    const id = String(presetId ?? '').trim()
    if (!id) return
    setPresets((prev) => {
      const next = (Array.isArray(prev) ? prev : []).filter((p) => String(p?.id ?? '') !== id)
      writePresets(next)
      return next
    })
  }, [])

  const matchesCurrentQuery = useCallback(
    (item, record) => {
      const brightnessOk = Number(record?.features?.brightness ?? 0) >= minBrightness
      if (!brightnessOk) return false
      if (!matchesPalette(record?.features, palette)) return false
      if (!matchesColorTerms(record?.features, colorTerms)) return false
      if (!matchesSubjects(record?.features?.subjects, subjectGroups)) return false
      if (!matchesMood(record?.moods, selectedMoods, moodLogic, moodThreshold)) return false
      return true
    },
    [minBrightness, palette, colorTerms, subjectGroups, selectedMoods, moodLogic, moodThreshold]
  )

  const handleSurprise = useCallback(async () => {
    preferenceLearner.recordSearchQuery(query)
    setSurpriseError(null)
    setSurpriseItem(null)
    setSurpriseRunning(true)

    try {
      const matches = []
      for (const item of cappedCandidates) {
        const key = normalizeKey(item)
        if (!key) continue
        const record = analysisRef.current[key]
        if (!record) continue
        if (!matchesCurrentQuery(item, record)) continue
        matches.push(item)
      }

      if (matches.length > 0) {
        const pick = matches[Math.floor(Math.random() * matches.length)]
        setSurpriseItem(pick)
        onSurprise?.(pick)
        return
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const randoms = await fetchRandomAPODs(DEFAULT_SURPRISE_BATCH)
        const list = Array.isArray(randoms) ? randoms : []
        for (const item of list) {
          const key = normalizeKey(item)
          if (!key) continue
          const features = await analyzeImage(key, { cacheKey: key, maxAgeMs: 1000 * 60 * 60 * 24 * 30 })
          const moods = features.moodScores || getMoodConfidenceScores(features)
          const record = { features, moods }
          setAnalysisByKey((prev) => ({ ...prev, [key]: record }))
          if (matchesCurrentQuery(item, record)) {
            setSurpriseItem(item)
            onSurprise?.(item)
            return
          }
        }
      }

      setSurpriseError(new Error('No matching images found. Try widening your filters.'))
    } catch (error) {
      setSurpriseError(error)
    } finally {
      setSurpriseRunning(false)
    }
  }, [cappedCandidates, matchesCurrentQuery, onSurprise, query])

  return (
    <section
      className={[
        'mx-auto w-full max-w-5xl',
        'rounded-3xl border border-white/20 bg-white/10 px-4 py-4 shadow-xl shadow-black/40',
        'backdrop-blur-2xl',
      ].join(' ')}
    >
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-wide text-white">Mood Search</h2>
          <p className="mt-1 text-sm text-slate-200/80">
            Pick moods and fine-tune color, subjects, brightness, and dates.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSurprise}
            disabled={surpriseRunning}
            className={[
              'inline-flex items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium transition',
              'border-white/15 bg-white/10 text-white hover:border-white/25 hover:bg-white/15',
              'disabled:cursor-not-allowed disabled:opacity-60',
            ].join(' ')}
          >
            Surprise me
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100/90 transition hover:border-white/20 hover:bg-white/10"
          >
            Reset
          </button>
        </div>
      </header>

      <div className="mt-4 grid gap-4 md:grid-cols-12">
        <div className="md:col-span-5">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold tracking-wide text-white">Moods</h3>
              <div className="inline-flex overflow-hidden rounded-full border border-white/10 bg-white/5 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setMoodLogic('or')}
                  className={[
                    'rounded-full px-3 py-1 transition',
                    moodLogic === 'or' ? 'bg-white/15 text-white' : 'text-slate-200/80 hover:text-white',
                  ].join(' ')}
                >
                  OR
                </button>
                <button
                  type="button"
                  onClick={() => setMoodLogic('and')}
                  className={[
                    'rounded-full px-3 py-1 transition',
                    moodLogic === 'and' ? 'bg-white/15 text-white' : 'text-slate-200/80 hover:text-white',
                  ].join(' ')}
                >
                  AND
                </button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {MOODS.map((mood) => (
                <MoodButton key={mood} mood={mood} selected={selectedMoods.includes(mood)} onToggle={toggleMood} />
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-xl">
            <h3 className="text-sm font-semibold tracking-wide text-white">Advanced Filters</h3>

            <div className="mt-3 grid gap-3">
              <label className="grid gap-1">
                <span className="text-xs font-medium text-slate-200/80">Color palette</span>
                <select
                  value={palette}
                  onChange={(event) => setPalette(event.target.value)}
                  className="h-10 w-full rounded-xl border border-white/10 bg-space-void/50 px-3 text-sm text-slate-100 outline-none transition focus:border-white/25"
                >
                  <option value="any">Any</option>
                  <option value="warm">Warm</option>
                  <option value="cool">Cool</option>
                  <option value="vibrant">Vibrant</option>
                  <option value="muted">Muted</option>
                </select>
              </label>

              <div className="grid gap-2">
                <span className="text-xs font-medium text-slate-200/80">Subject types</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {[
                    ['galaxies', 'Galaxies'],
                    ['planets', 'Planets'],
                    ['nebulae', 'Nebulae'],
                    ['earth', 'Earth'],
                    ['stars', 'Stars'],
                    ['phenomena', 'Phenomena'],
                  ].map(([key, label]) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100/90 transition hover:border-white/20"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(subjectGroups?.[key])}
                        onChange={() => toggleSubjectGroup(key)}
                        className="h-4 w-4 rounded border-white/25 bg-white/5 text-white"
                      />
                      <span className="select-none">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid gap-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-slate-200/80">Minimum brightness</span>
                  <span className="text-xs text-slate-100/80">{Math.round(minBrightnessPct)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={minBrightnessPct}
                  onChange={(event) => setMinBrightnessPct(Number(event.target.value))}
                  className="w-full accent-white"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-slate-200/80">Start date</span>
                  <input
                    type="date"
                    value={dateStart}
                    onChange={(event) => setDateStart(event.target.value)}
                    className="h-10 w-full rounded-xl border border-white/10 bg-space-void/50 px-3 text-sm text-slate-100 outline-none transition focus:border-white/25"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-slate-200/80">End date</span>
                  <input
                    type="date"
                    value={dateEnd}
                    onChange={(event) => setDateEnd(event.target.value)}
                    className="h-10 w-full rounded-xl border border-white/10 bg-space-void/50 px-3 text-sm text-slate-100 outline-none transition focus:border-white/25"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="md:col-span-7">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold tracking-wide text-white">Results</h3>
                <p className="mt-1 text-sm text-slate-200/80">
                  {matchedCount} matches
                  <span className="mx-2 text-white/30">•</span>
                  {analyzedCount}/{cappedCandidates.length} analyzed
                  {analysisProgress.total > 0 ? (
                    <span className="ml-2 text-xs text-slate-200/70">
                      (processing {analysisProgress.done}/{analysisProgress.total})
                    </span>
                  ) : null}
                </p>
                {loadingCandidates ? (
                  <p className="mt-1 text-xs text-slate-200/70">Loading candidates…</p>
                ) : null}
                {candidateError ? (
                  <p className="mt-1 text-xs text-rose-200/90">Couldn’t load APOD items for this range.</p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                  <span className="text-xs font-medium text-slate-200/80">Save preset</span>
                  <input
                    value={presetName}
                    onChange={(event) => setPresetName(event.target.value)}
                    placeholder="Name"
                    className="h-6 w-32 bg-transparent text-xs text-white outline-none placeholder:text-slate-200/50"
                  />
                  <button
                    type="button"
                    onClick={savePreset}
                    disabled={!presetName.trim()}
                    className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-xs text-white transition hover:border-white/20 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>

            {presets.length > 0 ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {presets.map((preset) => (
                  <div
                    key={preset.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className="min-w-0 flex-1 text-left text-sm font-medium text-white/90 transition hover:text-white"
                      title={preset.name}
                    >
                      <span className="block truncate">{preset.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-200/70">
                        {Array.isArray(preset?.query?.moods) && preset.query.moods.length > 0
                          ? preset.query.moods.join(', ')
                          : 'Any mood'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePreset(preset.id)}
                      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-100/80 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-200/60">No presets saved yet.</p>
            )}

            {surpriseItem ? (
              <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-space-void/40">
                <div className="relative aspect-[16/10] w-full">
                  <img
                    src={surpriseItem?.url ?? ''}
                    alt={surpriseItem?.title ?? 'Surprise APOD'}
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <div className="text-sm font-semibold text-white">{surpriseItem?.title ?? 'Surprise pick'}</div>
                    <div className="mt-1 text-xs text-slate-200/80">{surpriseItem?.date ?? ''}</div>
                  </div>
                </div>
              </div>
            ) : null}

            {surpriseError ? <p className="mt-3 text-sm text-rose-200/90">{String(surpriseError?.message)}</p> : null}
          </div>
        </div>
      </div>
    </section>
  )
}

