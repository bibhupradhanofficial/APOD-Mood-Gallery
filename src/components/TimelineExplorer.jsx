import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addDays,
  addMonths,
  differenceInDays,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subDays,
} from 'date-fns'

import { analyzeImage, fetchAPODRange } from '../services'
import { deltaE76, hexToLab, normalizeHex } from '../utils/colorTools'
import ColorPalette from './ColorPalette'

const MOODS = ['Calming', 'Energizing', 'Mysterious', 'Inspiring', 'Cosmic']

const MOOD_COLORS = {
  Calming: { hex: '#38bdf8', dotClass: 'bg-sky-400', softClass: 'bg-sky-500/15 text-sky-200 ring-sky-400/30' },
  Energizing: { hex: '#fb923c', dotClass: 'bg-orange-400', softClass: 'bg-orange-500/15 text-orange-200 ring-orange-400/30' },
  Mysterious: { hex: '#818cf8', dotClass: 'bg-indigo-400', softClass: 'bg-indigo-500/15 text-indigo-200 ring-indigo-400/30' },
  Inspiring: { hex: '#34d399', dotClass: 'bg-emerald-400', softClass: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30' },
  Cosmic: { hex: '#e879f9', dotClass: 'bg-fuchsia-400', softClass: 'bg-fuchsia-500/15 text-fuchsia-200 ring-fuchsia-400/30' },
  Unknown: { hex: '#94a3b8', dotClass: 'bg-slate-400', softClass: 'bg-white/10 text-slate-200 ring-white/20' },
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

function iso(d) {
  return format(d, 'yyyy-MM-dd')
}

function safeParseISO(v) {
  try {
    return parseISO(String(v))
  } catch {
    return null
  }
}

function getKeyForItem(item) {
  return String(item?.hdurl || item?.url || item?.date || '')
}

function dominantMoodFromAnalysis(analysis) {
  const scores = analysis?.moodScores
  if (!scores) return 'Unknown'
  let bestMood = 'Unknown'
  let bestScore = -Infinity
  for (const mood of MOODS) {
    const v = Number(scores[mood] ?? -Infinity)
    if (v > bestScore) {
      bestScore = v
      bestMood = mood
    }
  }
  return bestMood
}

function iconForEventType(type) {
  if (type === 'equinox') return '◑'
  if (type === 'meteor_shower') return '✶'
  if (type === 'eclipse') return '◐'
  return '•'
}

function buildBuiltInEventsForRange(startDate, endDate) {
  const start = startOfMonth(startDate)
  const end = endOfMonth(endDate)

  const eclipseCatalog = [
    { date: '2023-04-20', label: 'Hybrid Solar Eclipse', type: 'eclipse' },
    { date: '2023-10-14', label: 'Annular Solar Eclipse', type: 'eclipse' },
    { date: '2024-04-08', label: 'Total Solar Eclipse', type: 'eclipse' },
    { date: '2024-10-02', label: 'Annular Solar Eclipse', type: 'eclipse' },
    { date: '2025-03-14', label: 'Total Lunar Eclipse', type: 'eclipse' },
    { date: '2025-09-07', label: 'Total Lunar Eclipse', type: 'eclipse' },
  ]

  const meteorShowers = [
    { month: 1, day: 3, label: 'Quadrantids Peak' },
    { month: 4, day: 22, label: 'Lyrids Peak' },
    { month: 5, day: 6, label: 'Eta Aquariids Peak' },
    { month: 8, day: 12, label: 'Perseids Peak' },
    { month: 10, day: 21, label: 'Orionids Peak' },
    { month: 11, day: 17, label: 'Leonids Peak' },
    { month: 12, day: 14, label: 'Geminids Peak' },
  ]

  const events = []
  for (let y = start.getFullYear(); y <= end.getFullYear(); y += 1) {
    const marchEquinox = safeParseISO(`${y}-03-20`)
    const septEquinox = safeParseISO(`${y}-09-22`)
    if (marchEquinox && !isBefore(marchEquinox, start) && !isAfter(marchEquinox, end)) {
      events.push({ date: iso(marchEquinox), label: 'March Equinox', type: 'equinox' })
    }
    if (septEquinox && !isBefore(septEquinox, start) && !isAfter(septEquinox, end)) {
      events.push({ date: iso(septEquinox), label: 'September Equinox', type: 'equinox' })
    }
    for (const shower of meteorShowers) {
      const d = safeParseISO(`${y}-${String(shower.month).padStart(2, '0')}-${String(shower.day).padStart(2, '0')}`)
      if (d && !isBefore(d, start) && !isAfter(d, end)) {
        events.push({ date: iso(d), label: shower.label, type: 'meteor_shower' })
      }
    }
  }

  for (const e of eclipseCatalog) {
    const d = safeParseISO(e.date)
    if (!d) continue
    if (isBefore(d, start) || isAfter(d, end)) continue
    events.push(e)
  }

  events.sort((a, b) => String(a.date).localeCompare(String(b.date)))
  return events
}

function aggregateMoodDistribution(itemsInRange, analysisByKey) {
  const counts = Object.fromEntries([...MOODS, 'Unknown'].map((m) => [m, 0]))
  const avg = Object.fromEntries([...MOODS].map((m) => [m, 0]))
  let scoreSamples = 0

  for (const item of itemsInRange) {
    const key = getKeyForItem(item)
    const analysis = analysisByKey.get(key)
    const mood = dominantMoodFromAnalysis(analysis)
    counts[mood] = (counts[mood] ?? 0) + 1

    const scores = analysis?.moodScores
    if (scores) {
      for (const m of MOODS) avg[m] += Number(scores[m] ?? 0)
      scoreSamples += 1
    }
  }

  if (scoreSamples > 0) {
    for (const m of MOODS) avg[m] = avg[m] / scoreSamples
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return { counts, avg, total }
}

function MoodPill({ mood }) {
  const style = MOOD_COLORS[mood] ?? MOOD_COLORS.Unknown
  return (
    <span className={['inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1', style.softClass].join(' ')}>
      {mood}
    </span>
  )
}

function MiniMap({ totalDays, dayToMood, viewport, onJump }) {
  const ref = useRef(null)
  const [dragging, setDragging] = useState(false)

  const viewBoxWidth = Math.min(1200, Math.max(60, totalDays))
  const step = totalDays > viewBoxWidth ? totalDays / viewBoxWidth : 1

  const bins = useMemo(() => {
    const out = []
    if (!Number.isFinite(totalDays) || totalDays <= 0) return out
    const binCount = Math.floor(viewBoxWidth)
    for (let i = 0; i < binCount; i += 1) {
      const dayStart = Math.floor(i * step)
      const dayEnd = Math.min(totalDays - 1, Math.floor((i + 1) * step) - 1)
      const moodCounts = new Map()
      for (let d = dayStart; d <= dayEnd; d += 1) {
        const m = dayToMood(d)
        moodCounts.set(m, (moodCounts.get(m) ?? 0) + 1)
      }
      let bestMood = 'Unknown'
      let best = -Infinity
      for (const [m, c] of moodCounts.entries()) {
        if (c > best) {
          best = c
          bestMood = m
        }
      }
      out.push({ i, mood: bestMood })
    }
    return out
  }, [dayToMood, step, totalDays, viewBoxWidth])

  const viewportStart = totalDays > viewBoxWidth ? viewport.startDay / step : viewport.startDay
  const viewportWidth = totalDays > viewBoxWidth ? viewport.daySpan / step : viewport.daySpan

  const handlePointer = (clientX) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = clamp((clientX - rect.left) / rect.width, 0, 1)
    const day = x * totalDays
    onJump(day)
  }

  return (
    <div className="rounded-lg border border-white/10 bg-space-void/40 p-2">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-[11px] font-medium text-slate-200/80">Navigator</div>
        <div className="text-[11px] text-slate-200/60">{totalDays} days</div>
      </div>
      <svg
        ref={ref}
        className="h-10 w-full cursor-pointer rounded bg-black/20"
        viewBox={`0 0 ${viewBoxWidth} 10`}
        preserveAspectRatio="none"
        onPointerDown={(e) => {
          setDragging(true)
          e.currentTarget.setPointerCapture(e.pointerId)
          handlePointer(e.clientX)
        }}
        onPointerMove={(e) => {
          if (!dragging) return
          handlePointer(e.clientX)
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        {bins.map((b) => {
          const color = (MOOD_COLORS[b.mood] ?? MOOD_COLORS.Unknown).hex
          return <rect key={b.i} x={b.i} y={0} width={1} height={10} fill={color} opacity={0.75} />
        })}
        <rect
          x={viewportStart}
          y={0.2}
          width={Math.max(0.8, viewportWidth)}
          height={9.6}
          fill="none"
          stroke="rgba(255,255,255,0.9)"
          strokeWidth={0.35}
        />
      </svg>
    </div>
  )
}

function MoodDistributionChart({ title, distribution }) {
  const rows = useMemo(() => {
    const moods = [...MOODS, 'Unknown']
    return moods
      .map((m) => ({ mood: m, count: Number(distribution.counts[m] ?? 0) }))
      .sort((a, b) => b.count - a.count)
  }, [distribution.counts])

  return (
    <div className="rounded-xl border border-white/10 bg-space-void/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-space-stardust">{title}</h3>
        <div className="text-xs text-slate-200/70">{distribution.total} APODs</div>
      </div>
      <div className="mt-3 space-y-2">
        {rows.map((r) => {
          const pct = distribution.total > 0 ? (r.count / distribution.total) * 100 : 0
          const style = MOOD_COLORS[r.mood] ?? MOOD_COLORS.Unknown
          return (
            <div key={r.mood} className="grid grid-cols-[90px_1fr_60px] items-center gap-2">
              <MoodPill mood={r.mood} />
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div className={['h-full', style.dotClass].join(' ')} style={{ width: `${pct}%` }} />
              </div>
              <div className="text-right text-[11px] tabular-nums text-slate-200/70">
                {r.count} ({Math.round(pct)}%)
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MonthCalendar({ monthDate, itemsByDate, analysisByKey, eventsByDate, onSelectDate }) {
  const start = startOfWeek(startOfMonth(monthDate), { weekStartsOn: 0 })
  const end = endOfWeek(endOfMonth(monthDate), { weekStartsOn: 0 })
  const days = []
  for (let d = start; !isAfter(d, end); d = addDays(d, 1)) days.push(d)

  return (
    <div className="rounded-xl border border-white/10 bg-space-void/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-space-stardust">Cosmic Calendar</h3>
        <div className="text-xs text-slate-200/70">{format(monthDate, 'MMMM yyyy')}</div>
      </div>
      <div className="grid grid-cols-7 gap-2 text-[11px] text-slate-200/70">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => (
          <div key={w} className="text-center">
            {w}
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-2">
        {days.map((d) => {
          const key = iso(d)
          const item = itemsByDate.get(key)
          const analysis = item ? analysisByKey.get(getKeyForItem(item)) : null
          const mood = item ? dominantMoodFromAnalysis(analysis) : 'Unknown'
          const moodColor = (MOOD_COLORS[mood] ?? MOOD_COLORS.Unknown).hex
          const isCurrentMonth = isSameMonth(d, monthDate)
          const events = eventsByDate.get(key) ?? []

          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDate(d)}
              className={[
                'relative aspect-square overflow-hidden rounded-lg border text-left transition-colors',
                isCurrentMonth ? 'border-white/10 hover:border-white/25' : 'border-white/5 opacity-60',
              ].join(' ')}
              style={{ backgroundColor: item ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.03)' }}
            >
              <div className="absolute inset-0" style={{ boxShadow: `inset 0 0 0 2px ${item ? moodColor : 'transparent'}` }} />
              {item?.url ? (
                <img src={item.url} alt={item.title ?? key} className="absolute inset-0 h-full w-full object-cover opacity-70" />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-white/5" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
              <div className="absolute left-1 top-1 text-[10px] font-semibold text-white/90">{format(d, 'd')}</div>
              {events.length > 0 && (
                <div className="absolute right-1 top-1 flex gap-1">
                  {events.slice(0, 3).map((e) => (
                    <span key={e.label} className="rounded bg-black/40 px-1 text-[10px] text-white/80">
                      {iconForEventType(e.type)}
                    </span>
                  ))}
                </div>
              )}
            </button>
          )
        })}
      </div>
      <div className="mt-3 text-[11px] text-slate-200/60">
        Mood borders use the dominant mood for each day (computed from cached or generated analysis).
      </div>
    </div>
  )
}

export default function TimelineExplorer({
  initialStartDate,
  initialEndDate,
  items: itemsProp,
  events: eventsProp,
}) {
  const today = useMemo(() => new Date(), [])
  const defaultEnd = useMemo(() => (initialEndDate ? safeParseISO(initialEndDate) ?? today : today), [initialEndDate, today])
  const defaultStart = useMemo(() => {
    if (initialStartDate) return safeParseISO(initialStartDate) ?? subDays(defaultEnd, 365)
    return subDays(defaultEnd, 365)
  }, [defaultEnd, initialStartDate])

  const [rangeStart, setRangeStart] = useState(() => iso(defaultStart))
  const [rangeEnd, setRangeEnd] = useState(() => iso(defaultEnd))

  const [items, setItems] = useState(() => (Array.isArray(itemsProp) ? itemsProp : []))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [analysisByKey, setAnalysisByKey] = useState(() => new Map())
  const [analysisQueueEnabled, setAnalysisQueueEnabled] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState({ done: 0, total: 0 })

  const [colorFilter, setColorFilter] = useState(() => ({
    enabled: false,
    hex: null,
    threshold: 18,
    includeUnanalyzed: false,
  }))

  const [zoomPxPerDay, setZoomPxPerDay] = useState(0)
  const [timelineMode, setTimelineMode] = useState('lanes')
  const [viewMode, setViewMode] = useState('timeline')

  const [selectedDates, setSelectedDates] = useState({ start: null, end: null })
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(defaultEnd))

  const scrollerRef = useRef(null)
  const [scrollerWidth, setScrollerWidth] = useState(0)
  const [viewport, setViewport] = useState({ startDay: 0, daySpan: 1 })

  const parsedRange = useMemo(() => {
    const s = safeParseISO(rangeStart) ?? defaultStart
    const e = safeParseISO(rangeEnd) ?? defaultEnd
    const start = isAfter(s, e) ? e : s
    const end = isAfter(s, e) ? s : e
    return { start, end }
  }, [defaultEnd, defaultStart, rangeEnd, rangeStart])

  const totalDays = useMemo(() => differenceInDays(parsedRange.end, parsedRange.start) + 1, [parsedRange.end, parsedRange.start])

  const colorFilterLab = useMemo(() => {
    if (!colorFilter.enabled) return null
    const hex = normalizeHex(colorFilter.hex)
    if (!hex) return null
    return hexToLab(hex)
  }, [colorFilter.enabled, colorFilter.hex])

  const matchesColorFilter = useCallback(
    (it) => {
      if (!colorFilter.enabled || !colorFilterLab) return true
      const key = getKeyForItem(it)
      if (!key) return false
      const features = analysisByKey.get(key)
      if (!features) return Boolean(colorFilter.includeUnanalyzed)
      const t = clamp(Number(colorFilter.threshold) || 0, 0, 60)
      const colors = Array.isArray(features?.dominantColors) ? features.dominantColors : []
      for (const c of colors) {
        const cand = normalizeHex(c?.hex)
        if (!cand) continue
        const lab = hexToLab(cand)
        if (deltaE76(colorFilterLab, lab) <= t) return true
      }
      return false
    },
    [analysisByKey, colorFilter.enabled, colorFilter.includeUnanalyzed, colorFilter.threshold, colorFilterLab]
  )

  const filteredItems = useMemo(() => {
    if (!colorFilter.enabled || !colorFilterLab) return items
    return items.filter(matchesColorFilter)
  }, [colorFilter.enabled, colorFilterLab, items, matchesColorFilter])

  const itemsByDate = useMemo(() => {
    const m = new Map()
    for (const it of filteredItems) {
      const d = String(it?.date ?? '')
      if (!d) continue
      m.set(d, it)
    }
    return m
  }, [filteredItems])

  const eventList = useMemo(() => {
    const base = buildBuiltInEventsForRange(parsedRange.start, parsedRange.end)
    const extra = Array.isArray(eventsProp) ? eventsProp : []
    return [...base, ...extra].filter((e) => e?.date && e?.label)
  }, [eventsProp, parsedRange.end, parsedRange.start])

  const eventsByDate = useMemo(() => {
    const m = new Map()
    for (const e of eventList) {
      const key = String(e.date)
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(e)
    }
    return m
  }, [eventList])

  const monthSegments = useMemo(() => {
    const out = []
    const start = parsedRange.start
    const end = parsedRange.end
    let cursor = startOfMonth(start)
    while (!isAfter(cursor, end)) {
      const segStart = isBefore(cursor, start) ? start : cursor
      const segEnd = isAfter(endOfMonth(cursor), end) ? end : endOfMonth(cursor)
      const leftDays = differenceInDays(segStart, start)
      const widthDays = differenceInDays(segEnd, segStart) + 1
      out.push({
        key: iso(cursor),
        label: format(cursor, 'MMM yyyy'),
        leftDays,
        widthDays,
      })
      cursor = addMonths(cursor, 1)
    }
    return out
  }, [parsedRange.end, parsedRange.start])

  const selectionItems = useMemo(() => {
    if (!selectedDates.start || !selectedDates.end) return filteredItems
    const start = selectedDates.start
    const end = selectedDates.end
    const s = isAfter(start, end) ? end : start
    const e = isAfter(start, end) ? start : end
    const out = []
    for (const it of filteredItems) {
      const d = safeParseISO(it?.date)
      if (!d) continue
      if (isBefore(d, s) || isAfter(d, e)) continue
      out.push(it)
    }
    return out
  }, [filteredItems, selectedDates.end, selectedDates.start])

  const distribution = useMemo(() => aggregateMoodDistribution(selectionItems, analysisByKey), [analysisByKey, selectionItems])

  const laneForMood = useMemo(() => {
    const lanes = new Map()
    for (let i = 0; i < MOODS.length; i += 1) lanes.set(MOODS[i], i)
    lanes.set('Unknown', MOODS.length)
    return lanes
  }, [])

  const laneCount = timelineMode === 'lanes' ? MOODS.length + 1 : 1
  const laneHeight = timelineMode === 'lanes' ? 42 : 80
  const timelineHeight = laneCount * laneHeight + 44
  const effectiveZoomPxPerDay = useMemo(() => {
    if (zoomPxPerDay > 0) return zoomPxPerDay
    if (!Number.isFinite(totalDays) || totalDays <= 0) return 1
    const z = scrollerWidth > 0 ? scrollerWidth / totalDays : 1
    return clamp(z, 1, 64)
  }, [scrollerWidth, totalDays, zoomPxPerDay])

  const timelineWidth = totalDays * effectiveZoomPxPerDay

  const dayToMood = (dayIndex) => {
    const d = addDays(parsedRange.start, dayIndex)
    const key = iso(d)
    const it = itemsByDate.get(key)
    if (!it) return 'Unknown'
    const analysis = analysisByKey.get(getKeyForItem(it))
    return dominantMoodFromAnalysis(analysis)
  }

  const updateViewport = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    setScrollerWidth(scroller.clientWidth)
    const startDay = clamp(scroller.scrollLeft / effectiveZoomPxPerDay, 0, Math.max(0, totalDays - 1))
    const daySpan = clamp(scroller.clientWidth / effectiveZoomPxPerDay, 1, totalDays)
    setViewport({ startDay, daySpan })
  }, [effectiveZoomPxPerDay, totalDays])

  useEffect(() => {
    updateViewport()
  }, [updateViewport])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const handler = () => updateViewport()
    scroller.addEventListener('scroll', handler, { passive: true })
    window.addEventListener('resize', handler)
    return () => {
      scroller.removeEventListener('scroll', handler)
      window.removeEventListener('resize', handler)
    }
  }, [updateViewport])

  const fetchRange = async (start, end) => {
    setLoading(true)
    setError('')
    try {
      const startDate = isAfter(start, end) ? end : start
      const endDate = isAfter(start, end) ? start : end
      const chunkDays = 25
      const results = []
      let cursor = startDate
      while (!isAfter(cursor, endDate)) {
        const chunkEnd = addDays(cursor, chunkDays - 1)
        const effectiveEnd = isAfter(chunkEnd, endDate) ? endDate : chunkEnd
        const part = await fetchAPODRange(iso(cursor), iso(effectiveEnd))
        if (Array.isArray(part)) results.push(...part.filter(Boolean))
        cursor = addDays(effectiveEnd, 1)
      }
      results.sort((a, b) => String(a?.date).localeCompare(String(b?.date)))
      setItems(results)
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Failed to load APOD range.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (Array.isArray(itemsProp) && itemsProp.length > 0) {
      setItems(itemsProp)
      return
    }
    fetchRange(parsedRange.start, parsedRange.end)
  }, [itemsProp, parsedRange.end, parsedRange.start])

  useEffect(() => {
    if (!analysisQueueEnabled) return
    if (items.length === 0) return

    let cancelled = false
    const concurrency = 2
    const keysToAnalyze = items
      .map((it) => ({ it, key: getKeyForItem(it) }))
      .filter(({ key }) => Boolean(key))
      .filter(({ key }) => !analysisByKey.has(key))
      .slice(0, 140)

    setAnalysisProgress({ done: 0, total: keysToAnalyze.length })

    const runWorker = async (index) => {
      let i = index
      while (i < keysToAnalyze.length && !cancelled) {
        const { it, key } = keysToAnalyze[i]
        try {
          const src = it?.hdurl || it?.url
          if (!src) {
            i += concurrency
            continue
          }
          const analysis = await analyzeImage(src, { cacheKey: key, maxAgeMs: 1000 * 60 * 60 * 24 * 30 })
          if (!cancelled && analysis?.features) {
            setAnalysisByKey((prev) => {
              if (prev.has(key)) return prev
              const next = new Map(prev)
              next.set(key, analysis.features)
              return next
            })
          }
        } catch (e) {
          void e
        } finally {
          if (!cancelled) {
            setAnalysisProgress((p) => ({ ...p, done: p.done + 1 }))
          }
          i += concurrency
        }
      }
    }

    const workers = []
    for (let w = 0; w < concurrency; w += 1) workers.push(runWorker(w))

    Promise.allSettled(workers).then(() => {
      if (!cancelled) setAnalysisQueueEnabled(false)
    })

    return () => {
      cancelled = true
    }
  }, [analysisByKey, analysisQueueEnabled, items])

  const jumpToDay = (day) => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const target = clamp(day * effectiveZoomPxPerDay - scroller.clientWidth / 2, 0, Math.max(0, timelineWidth - scroller.clientWidth))
    scroller.scrollTo({ left: target, behavior: 'smooth' })
  }

  const onZoomChange = (nextZoom) => {
    const scroller = scrollerRef.current
    const normalizedNextZoom = clamp(Number(nextZoom) || 0, 0, 64)
    if (!scroller) {
      setZoomPxPerDay(normalizedNextZoom)
      return
    }
    const currentZoom = zoomPxPerDay > 0 ? zoomPxPerDay : clamp(scroller.clientWidth / Math.max(1, totalDays), 1, 64)
    const nextEffectiveZoom =
      normalizedNextZoom > 0 ? normalizedNextZoom : clamp(scroller.clientWidth / Math.max(1, totalDays), 1, 64)
    const centerDay = (scroller.scrollLeft + scroller.clientWidth / 2) / currentZoom
    setZoomPxPerDay(normalizedNextZoom)
    requestAnimationFrame(() => {
      const next = scrollerRef.current
      if (!next) return
      const nextLeft = clamp(
        centerDay * nextEffectiveZoom - next.clientWidth / 2,
        0,
        Math.max(0, totalDays * nextEffectiveZoom - next.clientWidth)
      )
      next.scrollLeft = nextLeft
    })
  }

  const handleScrollerWheel = (e) => {
    const scroller = scrollerRef.current
    if (!scroller) return
    if (e.ctrlKey) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -2 : 2
      onZoomChange(clamp(effectiveZoomPxPerDay + delta, 1, 64))
      return
    }
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault()
      scroller.scrollLeft += e.deltaY
    }
  }

  const selectFromTimeline = (date) => {
    setSelectedDates((prev) => {
      if (!prev.start || (prev.start && prev.end)) return { start: date, end: null }
      return { start: prev.start, end: date }
    })
  }

  const selectionLabel = useMemo(() => {
    if (!selectedDates.start) return 'All loaded APODs'
    if (!selectedDates.end) return `From ${format(selectedDates.start, 'MMM d, yyyy')} (select an end date)`
    const s = isAfter(selectedDates.start, selectedDates.end) ? selectedDates.end : selectedDates.start
    const e = isAfter(selectedDates.start, selectedDates.end) ? selectedDates.start : selectedDates.end
    return `${format(s, 'MMM d, yyyy')} → ${format(e, 'MMM d, yyyy')}`
  }, [selectedDates.end, selectedDates.start])

  const visibleMonth = useMemo(() => {
    const day = clamp(viewport.startDay + viewport.daySpan / 2, 0, Math.max(0, totalDays - 1))
    const d = addDays(parsedRange.start, day)
    return startOfMonth(d)
  }, [parsedRange.start, totalDays, viewport.daySpan, viewport.startDay])

  useEffect(() => {
    if (viewMode !== 'calendar') return
    setCalendarMonth(visibleMonth)
  }, [viewMode, visibleMonth])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-space-void/40 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-space-stardust">Timeline Explorer</h2>
              <p className="mt-1 text-sm text-slate-200/70">
                Browse APODs chronologically, spot mood patterns, and overlay key sky events.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setViewMode((v) => (v === 'timeline' ? 'calendar' : 'timeline'))}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10"
              >
                {viewMode === 'timeline' ? 'Cosmic Calendar' : 'Back to Timeline'}
              </button>
              <button
                type="button"
                onClick={() => jumpToDay(totalDays - 1)}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10"
              >
                Jump to End
              </button>
              <button
                type="button"
                onClick={() => jumpToDay(clamp(totalDays - 1 - 30, 0, totalDays))}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10"
              >
                Last 30 days
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1fr]">
            <div className="rounded-xl border border-white/10 bg-black/15 p-3">
              <div className="text-[11px] font-medium text-slate-200/70">Date Range</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <div className="text-[10px] text-slate-200/60">Start</div>
                  <input
                    type="date"
                    value={rangeStart}
                    onChange={(e) => setRangeStart(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-100"
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-[10px] text-slate-200/60">End</div>
                  <input
                    type="date"
                    value={rangeEnd}
                    onChange={(e) => setRangeEnd(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-100"
                  />
                </label>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fetchRange(parsedRange.start, parsedRange.end)}
                  className="rounded-full bg-space-aurora/20 px-3 py-1.5 text-xs font-medium text-space-aurora ring-1 ring-space-aurora/40 hover:bg-space-aurora/25"
                  disabled={loading}
                >
                  {loading ? 'Loading…' : 'Load'}
                </button>
                <div className="text-[11px] text-slate-200/60">
                  {items.length} APODs • {totalDays} days
                </div>
              </div>
              {error && <div className="mt-2 text-[11px] text-rose-200/90">{error}</div>}
            </div>

            <div className="rounded-xl border border-white/10 bg-black/15 p-3">
              <div className="text-[11px] font-medium text-slate-200/70">Zoom & Layout</div>
              <div className="mt-2 flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={64}
                  value={zoomPxPerDay}
                  onChange={(e) => onZoomChange(Number(e.target.value))}
                  className="w-full"
                />
                <div className="w-12 text-right text-[11px] tabular-nums text-slate-200/70">{zoomPxPerDay}px</div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTimelineMode((m) => (m === 'lanes' ? 'single' : 'lanes'))}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10"
                >
                  {timelineMode === 'lanes' ? 'Single Track' : 'Mood Lanes'}
                </button>
                <div className="text-[11px] text-slate-200/60">Ctrl+Wheel to zoom, Wheel to scroll.</div>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/15 p-3">
              <div className="text-[11px] font-medium text-slate-200/70">Mood Analysis</div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAnalysisQueueEnabled(true)}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10"
                  disabled={analysisQueueEnabled}
                >
                  {analysisQueueEnabled ? 'Analyzing…' : 'Analyze (up to 140)'}
                </button>
                <div className="text-[11px] text-slate-200/60">
                  Cached: {analysisByKey.size} • {analysisProgress.total > 0 ? `${analysisProgress.done}/${analysisProgress.total}` : 'Idle'}
                </div>
              </div>
              <div className="mt-2 text-[11px] text-slate-200/60">
                Analysis is stored locally and reused across sessions.
              </div>
            </div>
          </div>
        </div>

        {viewMode === 'timeline' ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-space-void/40 p-4">
              <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="text-sm font-semibold text-space-stardust">Chronological Timeline</div>
                <div className="text-xs text-slate-200/70">Selection: {selectionLabel}</div>
              </div>

              <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black/20">
                <div className="absolute inset-x-0 top-0 z-10 flex h-10 items-center border-b border-white/10 bg-black/25">
                  <div className="relative h-full" style={{ width: timelineWidth }}>
                    {monthSegments.map((m) => (
                      <div
                        key={m.key}
                        className="absolute top-0 flex h-full items-center border-r border-white/10 px-2 text-[11px] font-medium text-slate-200/70"
                        style={{ left: m.leftDays * effectiveZoomPxPerDay, width: m.widthDays * effectiveZoomPxPerDay }}
                      >
                        {m.label}
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  ref={scrollerRef}
                  className="relative h-[420px] overflow-x-auto overflow-y-hidden"
                  style={{ scrollBehavior: 'smooth' }}
                  onWheel={handleScrollerWheel}
                >
                  <div className="relative" style={{ width: timelineWidth, height: timelineHeight, paddingTop: 40 }}>
                    <div className="absolute left-0 right-0 top-14 h-px bg-white/10" />
                    {timelineMode === 'lanes' && (
                      <div className="absolute left-0 top-0 z-0 w-full">
                        {[...MOODS, 'Unknown'].map((mood) => {
                          const laneIndex = laneForMood.get(mood) ?? 0
                          const top = 44 + laneIndex * laneHeight
                          return (
                            <div key={mood} className="absolute left-0 right-0" style={{ top }}>
                              <div className="absolute left-0 right-0 top-0 h-px bg-white/5" />
                              <div className="absolute left-2 top-2">
                                <MoodPill mood={mood} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {eventList.map((ev) => {
                      const d = safeParseISO(ev.date)
                      if (!d) return null
                      const dayIndex = differenceInDays(d, parsedRange.start)
                      if (dayIndex < 0 || dayIndex > totalDays) return null
                      const x = dayIndex * effectiveZoomPxPerDay
                      return (
                        <div key={`${ev.date}:${ev.label}`} className="absolute top-10 h-full" style={{ left: x }}>
                          <div className="h-full w-px bg-white/10" />
                          <div className="absolute top-1 -translate-x-1/2 whitespace-nowrap rounded bg-black/40 px-2 py-0.5 text-[10px] text-slate-100/80">
                            {iconForEventType(ev.type)} {ev.label}
                          </div>
                        </div>
                      )
                    })}

    {filteredItems.map((it) => {
                      const d = safeParseISO(it?.date)
                      if (!d) return null
                      const dayIndex = differenceInDays(d, parsedRange.start)
                      const x = dayIndex * effectiveZoomPxPerDay
                      const key = getKeyForItem(it)
                      const analysis = analysisByKey.get(key)
                      const mood = dominantMoodFromAnalysis(analysis)
                      const laneIndex = timelineMode === 'lanes' ? laneForMood.get(mood) ?? laneForMood.get('Unknown') : 0
                      const y = 56 + laneIndex * laneHeight
                      const selected =
                        selectedDates.start &&
                        (isSameDay(d, selectedDates.start) ||
                          (selectedDates.end && isSameDay(d, selectedDates.end)))
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => selectFromTimeline(d)}
                          title={`${it?.title ?? 'Untitled'} (${it?.date ?? ''})`}
                          className={[
                            'group absolute -translate-x-1/2 rounded-full ring-1 ring-white/10 transition-transform',
                            (MOOD_COLORS[mood] ?? MOOD_COLORS.Unknown).dotClass,
                            selected ? 'scale-125 ring-white/60' : 'hover:scale-110',
                          ].join(' ')}
                          style={{ left: x, top: y, width: 10, height: 10 }}
                        >
                          <span className="sr-only">{it?.title ?? 'APOD'}</span>
                          <div className="pointer-events-none absolute left-1/2 top-6 z-30 hidden w-72 -translate-x-1/2 overflow-hidden rounded-xl border border-white/10 bg-black/70 shadow-xl backdrop-blur group-hover:block">
                            <div className="flex gap-3 p-3">
                              <div className="h-14 w-14 overflow-hidden rounded-lg bg-white/5">
                                {it?.url ? (
                                  <img src={it.url} alt={it?.title ?? ''} className="h-full w-full object-cover" />
                                ) : null}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-semibold text-slate-50">{it?.title ?? 'Untitled'}</div>
                                <div className="mt-1 flex items-center gap-2">
                                  <div className="text-[11px] text-slate-200/70">{it?.date}</div>
                                  <MoodPill mood={mood} />
                                </div>
                              </div>
                            </div>
                          </div>
                        </button>
                      )
                    })}

                    {selectedDates.start && selectedDates.end && (
                      (() => {
                        const s = isAfter(selectedDates.start, selectedDates.end) ? selectedDates.end : selectedDates.start
                        const e = isAfter(selectedDates.start, selectedDates.end) ? selectedDates.start : selectedDates.end
                        const leftDay = clamp(differenceInDays(s, parsedRange.start), 0, totalDays)
                        const rightDay = clamp(differenceInDays(e, parsedRange.start), 0, totalDays)
                        const left = leftDay * effectiveZoomPxPerDay
                        const width = Math.max(4, (rightDay - leftDay + 1) * effectiveZoomPxPerDay)
                        return (
                          <div className="absolute top-10 h-full bg-space-aurora/10 ring-1 ring-space-aurora/30" style={{ left, width }} />
                        )
                      })()
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <MiniMap
                  totalDays={totalDays}
                  dayToMood={dayToMood}
                  viewport={viewport}
                  onJump={(day) => jumpToDay(day)}
                />
              </div>
            </div>

            <MoodDistributionChart title="Mood Distribution (Selected Period)" distribution={distribution} />
          </div>
        ) : (
          <MonthCalendar
            monthDate={calendarMonth}
            itemsByDate={itemsByDate}
            analysisByKey={analysisByKey}
            eventsByDate={eventsByDate}
            onSelectDate={(d) => {
              setViewMode('timeline')
              jumpToDay(differenceInDays(d, parsedRange.start))
              selectFromTimeline(d)
              setTimeout(() => selectFromTimeline(d), 50)
            }}
          />
        )}
      </div>

      <div className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-space-void/40 p-4">
          <h3 className="text-sm font-semibold text-space-stardust">Grouping</h3>
          <div className="mt-2 space-y-2 text-sm text-slate-200/75">
            <div className="flex items-center justify-between gap-3">
              <div>Year/Month</div>
              <div className="text-xs text-slate-200/60">{monthSegments.length} segments</div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>Astronomical events</div>
              <div className="text-xs text-slate-200/60">{eventList.length} markers</div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>Mood patterns</div>
              <div className="text-xs text-slate-200/60">{timelineMode === 'lanes' ? 'Lane view' : 'Single track'}</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-space-void/40 p-4">
          <h3 className="text-sm font-semibold text-space-stardust">Selected Period</h3>
          <div className="mt-2 text-xs text-slate-200/70">{selectionLabel}</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSelectedDates({ start: null, end: null })}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10"
            >
              Clear Selection
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedDates({ start: parsedRange.start, end: parsedRange.end })
              }}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10"
            >
              Select Full Range
            </button>
          </div>
          <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] font-medium text-slate-200/70">Average Mood Scores</div>
            <div className="mt-2 space-y-2">
              {MOODS.map((m) => {
                const v = Number(distribution.avg[m] ?? 0)
                const pct = clamp(v, 0, 100)
                const style = MOOD_COLORS[m]
                return (
                  <div key={m} className="grid grid-cols-[90px_1fr_40px] items-center gap-2">
                    <MoodPill mood={m} />
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div className={['h-full', style.dotClass].join(' ')} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-right text-[11px] tabular-nums text-slate-200/70">{Math.round(v)}</div>
                  </div>
                )
              })}
            </div>
            <div className="mt-2 text-[11px] text-slate-200/60">
              Averages are based on analyzed items within the selected range.
            </div>
          </div>
        </div>

        <ColorPalette
          title="Color Lab"
          items={selectionItems}
          analysisByKey={analysisByKey}
          getKey={getKeyForItem}
          onRequestAnalyze={() => setAnalysisQueueEnabled(true)}
          onFilterChange={(next) => setColorFilter(next)}
        />

        <div className="rounded-2xl border border-white/10 bg-space-void/40 p-4">
          <h3 className="text-sm font-semibold text-space-stardust">Event Legend</h3>
          <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-slate-200/70">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded bg-black/40 px-1">{iconForEventType('equinox')}</span>
                <span>Equinoxes</span>
              </div>
              <span className="text-slate-200/50">Approximate dates</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded bg-black/40 px-1">{iconForEventType('meteor_shower')}</span>
                <span>Meteor showers</span>
              </div>
              <span className="text-slate-200/50">Peak nights</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded bg-black/40 px-1">{iconForEventType('eclipse')}</span>
                <span>Eclipses</span>
              </div>
              <span className="text-slate-200/50">Built-in catalog</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
