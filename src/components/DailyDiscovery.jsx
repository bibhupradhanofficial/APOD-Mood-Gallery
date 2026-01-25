import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, isValid, parseISO, subDays, subYears } from 'date-fns'

import {
  analyzeImage,
  fetchAPODByDate,
  fetchAPODRange,
  preferenceLearner,
  getKv,
  setKv,
  queryApodsByMoodTag,
  listCollections,
} from '../services'
import { buildShareUrlWithMeta, copyToClipboard, getSocialShareLinks, getMoodConfidenceScores, MOODS } from '../utils'

const DISCOVERY_KV_KEY = 'dailyDiscoveryState:v1'
const DISCOVERY_VERSION = 1
const COLOR_FAMILIES = ['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Purple', 'Magenta', 'Neutral']

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function toISODate(input) {
  const d = input instanceof Date ? input : parseISO(String(input ?? ''))
  if (!(d instanceof Date) || !isValid(d)) return ''
  return format(d, 'yyyy-MM-dd')
}

function toBase64Url(text) {
  const utf8 = encodeURIComponent(String(text ?? '')).replace(/%([0-9A-F]{2})/g, (_, p1) =>
    String.fromCharCode(Number.parseInt(p1, 16))
  )
  const b64 = btoa(utf8)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(base64Url) {
  const padded = String(base64Url ?? '').replace(/-/g, '+').replace(/_/g, '/')
  const b64 = padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '=')
  const utf8 = atob(b64)
  const percent = Array.from(utf8, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')
  return decodeURIComponent(percent)
}

function normalizeSrc(item) {
  const src = item?.hdurl || item?.url
  return src ? String(src) : null
}

function getLocalPreferenceState() {
  try {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage?.getItem('apod-preferences:v1')
    const parsed = safeJsonParse(raw ?? '')
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function countPreferenceSeenDates(prefState) {
  const seen = prefState?.seen && typeof prefState.seen === 'object' ? prefState.seen : null
  if (!seen) return 0
  let count = 0
  for (const key of Object.keys(seen)) {
    if (String(key).startsWith('date:')) count += 1
  }
  return count
}

function computeUnderexploredMood({ prefState, discoveryState, todayIso }) {
  const weights = prefState?.weights?.moods && typeof prefState.weights.moods === 'object' ? prefState.weights.moods : null
  const recent = discoveryState?.moodRecentCounts && typeof discoveryState.moodRecentCounts === 'object' ? discoveryState.moodRecentCounts : {}

  const candidates = MOODS.map((mood) => {
    const w = Number(weights?.[mood] ?? 0) || 0
    const r = Number(recent?.[mood] ?? 0) || 0
    return { mood, score: w + r * 0.65 }
  })

  candidates.sort((a, b) => a.score - b.score || a.mood.localeCompare(b.mood))
  const pick = candidates[0]?.mood
  if (pick) return pick

  const key = String(todayIso ?? '')
  const idx = Math.abs(
    Array.from(key).reduce((acc, c) => {
      acc = (acc * 31 + c.charCodeAt(0)) % 100000
      return acc
    }, 7)
  )
  return MOODS[idx % MOODS.length]
}

function dateDiffDays(aIso, bIso) {
  const a = parseISO(String(aIso ?? ''))
  const b = parseISO(String(bIso ?? ''))
  if (!isValid(a) || !isValid(b)) return Infinity
  const ms = a.getTime() - b.getTime()
  return Math.round(ms / (24 * 60 * 60 * 1000))
}

function isYesterdayOrToday(lastIso, todayIso) {
  const diff = dateDiffDays(todayIso, lastIso)
  if (!Number.isFinite(diff)) return { today: false, yesterday: false }
  return { today: diff === 0, yesterday: diff === 1 }
}

function rgbToHsl({ r, g, b }) {
  const rn = (Number(r) || 0) / 255
  const gn = (Number(g) || 0) / 255
  const bn = (Number(b) || 0) / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  let h = 0
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6
    else if (max === gn) h = (bn - rn) / delta + 2
    else h = (rn - gn) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }
  const l = (max + min) / 2
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))
  return { h, s, l }
}

function classifyColorFamily(rgb) {
  const hsl = rgbToHsl(rgb ?? {})
  if (hsl.s <= 0.15 || hsl.l <= 0.1 || hsl.l >= 0.9) return 'Neutral'
  const h = ((Number(hsl.h) || 0) % 360 + 360) % 360
  if (h < 15 || h >= 345) return 'Red'
  if (h < 45) return 'Orange'
  if (h < 70) return 'Yellow'
  if (h < 160) return 'Green'
  if (h < 200) return 'Cyan'
  if (h < 255) return 'Blue'
  if (h < 290) return 'Purple'
  return 'Magenta'
}

function getFamiliesFromFeatures(features) {
  const colors = Array.isArray(features?.dominantColors) ? features.dominantColors : []
  const found = new Set()
  for (const c of colors) {
    const rgb = c?.rgb
    if (!rgb || typeof rgb !== 'object') continue
    const family = classifyColorFamily(rgb)
    if (family) found.add(family)
  }
  if (found.size === 0) found.add('Neutral')
  return [...found]
}

function chooseUniqueByDate(list, usedDates) {
  const picks = []
  const used = usedDates instanceof Set ? usedDates : new Set()
  for (const item of list) {
    const date = String(item?.date ?? '').trim()
    if (!date) continue
    if (used.has(date)) continue
    const src = normalizeSrc(item)
    if (!src) continue
    used.add(date)
    picks.push(item)
  }
  return picks
}

async function loadDiscoveryState() {
  const value = await getKv(DISCOVERY_KV_KEY)
  const state = value && typeof value === 'object' ? value : null
  if (!state || state.version !== DISCOVERY_VERSION) {
    return {
      version: DISCOVERY_VERSION,
      streak: 0,
      bestStreak: 0,
      lastCompletedDate: null,
      completedDates: [],
      exploredDates: {},
      viewedMoods: {},
      colorFamilies: {},
      moodRecentCounts: {},
      dailySelections: {},
      lastChallenge: null,
    }
  }
  return {
    version: DISCOVERY_VERSION,
    streak: clamp(Number(state?.streak ?? 0) || 0, 0, 10000),
    bestStreak: clamp(Number(state?.bestStreak ?? 0) || 0, 0, 10000),
    lastCompletedDate: state?.lastCompletedDate ? String(state.lastCompletedDate) : null,
    completedDates: Array.isArray(state?.completedDates) ? state.completedDates.map((d) => String(d)) : [],
    exploredDates: state?.exploredDates && typeof state.exploredDates === 'object' ? state.exploredDates : {},
    viewedMoods: state?.viewedMoods && typeof state.viewedMoods === 'object' ? state.viewedMoods : {},
    colorFamilies: state?.colorFamilies && typeof state.colorFamilies === 'object' ? state.colorFamilies : {},
    moodRecentCounts: state?.moodRecentCounts && typeof state.moodRecentCounts === 'object' ? state.moodRecentCounts : {},
    dailySelections: state?.dailySelections && typeof state.dailySelections === 'object' ? state.dailySelections : {},
    lastChallenge: state?.lastChallenge && typeof state.lastChallenge === 'object' ? state.lastChallenge : null,
  }
}

async function persistDiscoveryState(state) {
  await setKv(DISCOVERY_KV_KEY, state)
}

async function computeDailySelection({ todayIso, profile, prefState, discoveryState, signal }) {
  const usedDates = new Set()
  const picks = []

  const todayItem = await fetchAPODByDate(todayIso)
  if (todayItem) {
    usedDates.add(todayIso)
    picks.push({ item: todayItem, reason: 'Today', meta: { badge: 'Today' } })
  }

  const moodOfDay = computeUnderexploredMood({ prefState, discoveryState, todayIso })

  const favoriteMood = profile?.favorites?.moods?.[0] ? String(profile.favorites.moods[0]) : null
  if (favoriteMood && favoriteMood !== moodOfDay) {
    const prefMatches = await queryApodsByMoodTag(favoriteMood, { limit: 60 })
    const candidate = chooseUniqueByDate(prefMatches, usedDates)[0]
    if (candidate) picks.push({ item: candidate, reason: 'For You', meta: { badge: favoriteMood } })
  }

  if (moodOfDay) {
    const underMatches = await queryApodsByMoodTag(moodOfDay, { limit: 80 })
    const candidate = chooseUniqueByDate(underMatches, usedDates)[0]
    if (candidate) picks.push({ item: candidate, reason: 'Underexplored', meta: { badge: moodOfDay } })
  }

  const todayDate = parseISO(todayIso)
  const seasonalAnchors = [subYears(todayDate, 1), subYears(todayDate, 7)]
  for (const anchor of seasonalAnchors) {
    if (signal?.aborted) break
    const seed = `${todayIso}:${format(anchor, 'yyyy')}`
    const offset = (Array.from(seed).reduce((acc, c) => acc + c.charCodeAt(0), 0) % 7) - 3
    const date = toISODate(subDays(anchor, -offset))
    if (!date || usedDates.has(date)) continue
    const item = await fetchAPODByDate(date)
    if (!item) continue
    usedDates.add(date)
    picks.push({ item, reason: 'Seasonal', meta: { badge: String(format(anchor, 'yyyy')) } })
  }

  if (picks.length < 5) {
    const start = toISODate(subDays(todayDate, 45))
    const end = todayIso
    const recent = await fetchAPODRange(start, end)
    const list = Array.isArray(recent) ? recent : []
    list.sort((a, b) => String(b?.date ?? '').localeCompare(String(a?.date ?? '')))

    const pool = chooseUniqueByDate(list, usedDates)
    for (const candidate of pool) {
      if (picks.length >= 5) break
      picks.push({ item: candidate, reason: 'Curated', meta: { badge: 'Recent' } })
    }
  }

  return {
    date: todayIso,
    moodOfDay,
    picks: picks.slice(0, 5),
  }
}

function ProgressBar({ value, max, label }) {
  const pct = max > 0 ? clamp((Number(value) || 0) / max, 0, 1) : 0
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between text-[11px] text-slate-200/70">
        <span>{label}</span>
        <span className="tabular-nums">
          {Math.min(Number(value) || 0, max)}/{max}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full bg-space-aurora/70" style={{ width: `${Math.round(pct * 100)}%` }} />
      </div>
    </div>
  )
}

function BadgeCard({ title, description, progress, complete }) {
  return (
    <div
      className={[
        'rounded-2xl border p-4 backdrop-blur',
        complete ? 'border-emerald-400/20 bg-emerald-500/10' : 'border-white/10 bg-space-void/45',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-100">{title}</div>
          <div className="mt-1 text-xs text-slate-200/70">{description}</div>
        </div>
        <div
          className={[
            'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
            complete ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-100' : 'border-white/10 bg-white/5 text-slate-100/80',
          ].join(' ')}
        >
          {complete ? 'Unlocked' : 'Locked'}
        </div>
      </div>
      {progress ? <div className="mt-3">{progress}</div> : null}
    </div>
  )
}

function PickCard({ pick, analysis, moodOfDay, challengeThreshold, onView, onCompleteChallenge }) {
  const item = pick?.item ?? null
  const src = normalizeSrc(item)
  const title = String(item?.title ?? 'Untitled')
  const date = String(item?.date ?? '').trim()
  const reason = String(pick?.reason ?? '').trim()
  const badge = String(pick?.meta?.badge ?? '').trim()

  const scores = analysis?.scores ?? null
  const topMood = analysis?.topMood ?? null
  const topScore = topMood && scores ? Number(scores[topMood] ?? 0) : null
  const matchScore = moodOfDay && scores ? Number(scores[moodOfDay] ?? 0) : null

  return (
    <a
      href={src || '#'}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        if (!src) event.preventDefault()
        onView?.(pick)
      }}
      className={[
        'group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-space-void/40',
        'transition hover:border-white/20 hover:bg-space-void/55',
      ].join(' ')}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-black/20">
        {src ? (
          <img src={src} alt={title} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
        ) : null}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold tracking-wide text-white/90">{date || '—'}</div>
            <div className="flex items-center gap-1 text-[11px] text-white/85">
              {reason ? (
                <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5">{reason}</span>
              ) : null}
              {badge ? <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5">{badge}</span> : null}
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="line-clamp-2 text-sm font-semibold text-slate-100">{title}</div>
        <div className="mt-auto flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-200/70">
            {topMood ? (
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">
                Dominant {topMood} · {Math.round(clamp(topScore ?? 0, 0, 100))}%
              </span>
            ) : (
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">Analyzing…</span>
            )}
            {typeof matchScore === 'number' ? (
              <span className="rounded-full border border-space-aurora/20 bg-space-aurora/10 px-2 py-0.5 text-space-aurora/90">
                Mood of the Day · {Math.round(clamp(matchScore, 0, 100))}%
              </span>
            ) : null}
          </div>
          {moodOfDay && typeof matchScore === 'number' ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onCompleteChallenge?.({ pick, matchScore })
              }}
              className={[
                'h-9 w-full rounded-xl border text-xs font-semibold transition',
                matchScore >= challengeThreshold
                  ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15'
                  : 'border-white/10 bg-white/5 text-slate-100 hover:border-white/20 hover:bg-white/10',
              ].join(' ')}
            >
              {matchScore >= challengeThreshold ? 'Complete Challenge' : 'Check In'}
            </button>
          ) : null}
        </div>
      </div>
    </a>
  )
}

export default function DailyDiscovery() {
  const todayIso = useMemo(() => toISODate(new Date()), [])
  const [discoveryState, setDiscoveryState] = useState(null)
  const [daily, setDaily] = useState(null)
  const [status, setStatus] = useState({ loading: true, error: null })
  const [analysisBySrc, setAnalysisBySrc] = useState({})
  const analysisRef = useRef(analysisBySrc)
  useEffect(() => {
    analysisRef.current = analysisBySrc
  }, [analysisBySrc])

  const [shareInfo, setShareInfo] = useState({ url: '', copied: false, error: null })
  const [personalizationTick, setPersonalizationTick] = useState(0)

  useEffect(() => {
    return preferenceLearner.subscribe(() => setPersonalizationTick((prev) => prev + 1))
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const state = await loadDiscoveryState()
        if (!mounted) return
        setDiscoveryState(state)
      } catch (error) {
        if (!mounted) return
        setDiscoveryState(null)
        setStatus({ loading: false, error: error?.message || 'Unable to load discovery state.' })
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!discoveryState) return
    const controller = new AbortController()
    let mounted = true

    const sharedPayload = (() => {
      try {
        if (typeof window === 'undefined') return null
        const url = new URL(window.location.href)
        const payload = url.searchParams.get('dailyPayload')
        if (!payload) return null
        const json = fromBase64Url(payload)
        const parsed = safeJsonParse(json)
        return parsed && typeof parsed === 'object' ? parsed : null
      } catch {
        return null
      }
    })()

    queueMicrotask(() => {
      if (mounted) setStatus({ loading: true, error: null })
    })

    ;(async () => {
      try {
        const profile = (() => {
          void personalizationTick
          return preferenceLearner.getProfile()
        })()
        const prefState = getLocalPreferenceState()

        if (sharedPayload?.picks && Array.isArray(sharedPayload.picks)) {
          const dates = sharedPayload.picks.map((d) => String(d)).filter(Boolean)
          const results = []
          for (const date of dates.slice(0, 5)) {
            if (controller.signal.aborted) break
            const item = await fetchAPODByDate(date)
            if (!item) continue
            results.push({ item, reason: 'Shared', meta: { badge: 'Shared' } })
          }
          const moodOfDay = String(sharedPayload?.moodOfDay ?? '') || computeUnderexploredMood({ prefState, discoveryState, todayIso })
          const selection = { date: todayIso, moodOfDay, picks: results }
          if (!mounted) return
          setDaily(selection)
          setStatus({ loading: false, error: null })
          return
        }

        const cached = discoveryState?.dailySelections?.[todayIso]
        if (cached && cached?.date === todayIso && Array.isArray(cached?.picks) && cached.picks.length === 5) {
          if (!mounted) return
          setDaily(cached)
          setStatus({ loading: false, error: null })
          return
        }

        const selection = await computeDailySelection({
          todayIso,
          profile,
          prefState,
          discoveryState,
          signal: controller.signal,
        })
        if (!mounted) return
        setDaily(selection)
        setStatus({ loading: false, error: null })

        const nextState = {
          ...discoveryState,
          dailySelections: {
            ...(discoveryState?.dailySelections ?? {}),
            [todayIso]: selection,
          },
        }
        setDiscoveryState(nextState)
        await persistDiscoveryState(nextState)
      } catch (error) {
        if (!mounted) return
        setDaily(null)
        setStatus({ loading: false, error: error?.message || 'Unable to curate daily discoveries.' })
      }
    })()

    return () => {
      mounted = false
      controller.abort()
    }
  }, [discoveryState, personalizationTick, todayIso])

  useEffect(() => {
    const controller = new AbortController()
    let mounted = true

    ;(async () => {
      const picks = Array.isArray(daily?.picks) ? daily.picks : []
      for (const pick of picks) {
        if (controller.signal.aborted) break
        const src = normalizeSrc(pick?.item)
        if (!src) continue
        if (analysisRef.current[src]) continue
        try {
          const features = await analyzeImage(src, { cacheKey: src, signal: controller.signal, maxAgeMs: 1000 * 60 * 60 * 24 * 90 })
          if (!mounted) return
          const scores = getMoodConfidenceScores(features)
          const ranked = Object.entries(scores)
            .map(([mood, score]) => ({ mood, score: Number(score) || 0 }))
            .sort((a, b) => b.score - a.score || a.mood.localeCompare(b.mood))
          const topMood = ranked[0]?.mood ?? null
          const families = getFamiliesFromFeatures(features)
          setAnalysisBySrc((prev) => ({ ...prev, [src]: { features, scores, topMood, families } }))
        } catch {
          if (!mounted) return
        }
      }
    })()

    return () => {
      mounted = false
      controller.abort()
    }
  }, [daily])

  const markCompletedToday = useCallback(async () => {
    if (!discoveryState) return
    const last = discoveryState.lastCompletedDate
    const relation = isYesterdayOrToday(last, todayIso)
    if (relation.today) return
    const nextStreak = relation.yesterday ? (Number(discoveryState.streak) || 0) + 1 : 1
    const best = Math.max(Number(discoveryState.bestStreak) || 0, nextStreak)
    const completedDates = Array.isArray(discoveryState.completedDates) ? discoveryState.completedDates : []
    const nextDates = [todayIso, ...completedDates.filter((d) => d !== todayIso)].slice(0, 500)
    const next = {
      ...discoveryState,
      streak: nextStreak,
      bestStreak: best,
      lastCompletedDate: todayIso,
      completedDates: nextDates,
    }
    setDiscoveryState(next)
    await persistDiscoveryState(next)
  }, [discoveryState, todayIso])

  const onView = useCallback(
    async (pick) => {
      if (!discoveryState) return
      const item = pick?.item ?? null
      const date = String(item?.date ?? '').trim()
      const src = normalizeSrc(item)
      if (!date) return
      let analysis = src ? analysisRef.current[src] : null
      if (src && !analysis) {
        try {
          const features = await analyzeImage(src, { cacheKey: src, maxAgeMs: 1000 * 60 * 60 * 24 * 90 })
          const scores = getMoodConfidenceScores(features)
          const ranked = Object.entries(scores)
            .map(([mood, score]) => ({ mood, score: Number(score) || 0 }))
            .sort((a, b) => b.score - a.score || a.mood.localeCompare(b.mood))
          const topMood = ranked[0]?.mood ?? null
          const families = getFamiliesFromFeatures(features)
          analysis = { features, scores, topMood, families }
          setAnalysisBySrc((prev) => ({ ...prev, [src]: analysis }))
        } catch {
          analysis = null
        }
      }
      const topMood = analysis?.topMood ? String(analysis.topMood) : null
      const families = Array.isArray(analysis?.families) ? analysis.families : []

      const exploredDates = { ...(discoveryState.exploredDates ?? {}) }
      exploredDates[date] = true

      const viewedMoods = { ...(discoveryState.viewedMoods ?? {}) }
      if (topMood) viewedMoods[topMood] = true

      const colorFamilies = { ...(discoveryState.colorFamilies ?? {}) }
      for (const family of families) colorFamilies[String(family)] = true

      const moodRecentCounts = { ...(discoveryState.moodRecentCounts ?? {}) }
      if (topMood) moodRecentCounts[topMood] = clamp((Number(moodRecentCounts[topMood]) || 0) + 1, 0, 10000)

      const next = { ...discoveryState, exploredDates, viewedMoods, colorFamilies, moodRecentCounts }
      setDiscoveryState(next)
      await persistDiscoveryState(next)
      await markCompletedToday()
    },
    [discoveryState, markCompletedToday]
  )

  const onCompleteChallenge = useCallback(
    async ({ pick, matchScore }) => {
      if (!discoveryState || !daily) return
      const threshold = 70
      if (Number(matchScore) < threshold) {
        await markCompletedToday()
        const next = {
          ...discoveryState,
          lastChallenge: {
            date: todayIso,
            mood: daily.moodOfDay,
            completed: false,
            attemptedAt: Date.now(),
          },
        }
        setDiscoveryState(next)
        await persistDiscoveryState(next)
        return
      }

      const completedWithDate = String(pick?.item?.date ?? '').trim() || null
      const next = {
        ...discoveryState,
        lastChallenge: {
          date: todayIso,
          mood: daily.moodOfDay,
          completed: true,
          completedAt: Date.now(),
          completedWithDate,
        },
      }
      setDiscoveryState(next)
      await persistDiscoveryState(next)
      await markCompletedToday()
    },
    [daily, discoveryState, markCompletedToday, todayIso]
  )

  const achievements = useMemo(() => {
    const moodCount = Object.keys(discoveryState?.viewedMoods ?? {}).filter((m) => MOODS.includes(m)).length
    const moodExplorer = { complete: moodCount >= MOODS.length, value: moodCount, max: MOODS.length }

    const prefState = getLocalPreferenceState()
    const seenDates = countPreferenceSeenDates(prefState)
    const exploredDates = Object.keys(discoveryState?.exploredDates ?? {}).length
    const timeTravelerCount = Math.max(seenDates, exploredDates)
    const timeTraveler = { complete: timeTravelerCount >= 365, value: timeTravelerCount, max: 365 }

    const boards = (() => {
      try {
        const list = listCollections()
        return Array.isArray(list) ? list.length : 0
      } catch {
        return 0
      }
    })()
    const statsCollections = Number(prefState?.stats?.collectionsCreated ?? 0) || 0
    const collectorCount = Math.max(boards, statsCollections)
    const collector = { complete: collectorCount >= 10, value: collectorCount, max: 10 }

    const families = Object.keys(discoveryState?.colorFamilies ?? {}).filter((k) => COLOR_FAMILIES.includes(k)).length
    const colorHunter = { complete: families >= COLOR_FAMILIES.length, value: families, max: COLOR_FAMILIES.length }

    return { moodExplorer, timeTraveler, collector, colorHunter }
  }, [discoveryState])

  const shareUrl = useMemo(() => {
    if (!daily) return ''
    const payload = toBase64Url(
      JSON.stringify({
        date: daily.date,
        moodOfDay: daily.moodOfDay,
        picks: (Array.isArray(daily?.picks) ? daily.picks : []).map((p) => String(p?.item?.date ?? '')).filter(Boolean),
      })
    )
    const first = Array.isArray(daily?.picks) ? daily.picks[0]?.item : null
    const firstSrc = normalizeSrc(first)
    const title = `Daily Discovery · ${daily.date}`
    const description = daily.moodOfDay ? `Mood of the Day: ${daily.moodOfDay}` : 'Curated daily picks from NASA APOD.'
    return buildShareUrlWithMeta({
      params: { view: 'daily', daily: daily.date, dailyPayload: payload },
      meta: {
        title,
        description,
        image: firstSrc ?? '',
        url: typeof window !== 'undefined' ? window.location.href : '',
      },
    })
  }, [daily])

  const socialLinks = useMemo(() => {
    if (!shareUrl) return null
    const title = daily?.date ? `Daily Discovery · ${daily.date}` : 'Daily Discovery'
    const description = daily?.moodOfDay ? `Mood of the Day: ${daily.moodOfDay}` : ''
    const image = normalizeSrc(daily?.picks?.[0]?.item)
    return getSocialShareLinks({ url: shareUrl, title, description, image })
  }, [daily, shareUrl])

  const share = useCallback(async () => {
    if (!shareUrl) return
    setShareInfo({ url: shareUrl, copied: false, error: null })
    try {
      const title = daily?.date ? `Daily Discovery · ${daily.date}` : 'Daily Discovery'
      const text = daily?.moodOfDay ? `Mood of the Day: ${daily.moodOfDay}` : 'Curated daily discoveries from NASA APOD.'
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title, text, url: shareUrl })
        return
      }
      const ok = await copyToClipboard(shareUrl)
      setShareInfo({ url: shareUrl, copied: ok, error: ok ? null : 'Copy failed.' })
    } catch (error) {
      setShareInfo({ url: shareUrl, copied: false, error: error?.message || 'Unable to share.' })
    }
  }, [daily, shareUrl])

  const challengeThreshold = 70
  const challengeDone = Boolean(discoveryState?.lastChallenge?.date === todayIso && discoveryState.lastChallenge.completed)

  return (
    <section className="rounded-2xl border border-white/10 bg-space-void/50 p-6 backdrop-blur">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-space-stardust">Daily Discovery</h2>
          <p className="mt-2 text-sm text-slate-200/75">A curated set of five images that adapts to your taste and what you have not explored yet.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-200/70">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
              Streak <span className="tabular-nums font-semibold text-slate-100">{Number(discoveryState?.streak ?? 0) || 0}</span>
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
              Best <span className="tabular-nums font-semibold text-slate-100">{Number(discoveryState?.bestStreak ?? 0) || 0}</span>
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
              {todayIso}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={share}
            className={[
              'rounded-full border px-4 py-2 text-xs font-semibold transition',
              'border-white/10 bg-white/5 text-slate-100 hover:border-white/20 hover:bg-white/10',
            ].join(' ')}
          >
            Share
          </button>
          <button
            type="button"
            onClick={markCompletedToday}
            className={[
              'rounded-full border px-4 py-2 text-xs font-semibold transition',
              'border-emerald-400/20 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15',
            ].join(' ')}
          >
            Claim Streak
          </button>
        </div>
      </div>

      {shareInfo.error ? (
        <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{shareInfo.error}</div>
      ) : null}
      {shareInfo.copied ? (
        <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
          Link copied to clipboard.
        </div>
      ) : null}
      {socialLinks ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <a
            href={socialLinks.twitter}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-100/80 hover:border-white/20 hover:bg-white/10 hover:text-white"
          >
            Twitter
          </a>
          <a
            href={socialLinks.reddit}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-100/80 hover:border-white/20 hover:bg-white/10 hover:text-white"
          >
            Reddit
          </a>
          <a
            href={socialLinks.pinterest}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-100/80 hover:border-white/20 hover:bg-white/10 hover:text-white"
          >
            Pinterest
          </a>
        </div>
      ) : null}

      {status.loading ? (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200/80">Curating today’s picks…</div>
      ) : null}
      {status.error ? (
        <div className="mt-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{status.error}</div>
      ) : null}

      {daily ? (
        <div className="mt-6 grid gap-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-100">Mood of the Day</div>
                <div className="mt-1 text-xs text-slate-200/70">
                  Challenge: find a discovery that matches <span className="font-semibold text-space-aurora/90">{daily.moodOfDay}</span> at{' '}
                  <span className="tabular-nums font-semibold">{challengeThreshold}%</span> or higher.
                </div>
              </div>
              <div
                className={[
                  'rounded-full border px-3 py-1 text-xs font-semibold',
                  challengeDone ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100' : 'border-white/10 bg-white/5 text-slate-100/80',
                ].join(' ')}
              >
                {challengeDone ? 'Completed' : 'Open a pick to start'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {daily.picks.map((pick, index) => {
              const src = normalizeSrc(pick?.item)
              const analysis = src ? analysisBySrc[src] : null
              return (
                <PickCard
                  key={String(pick?.item?.date ?? src ?? index)}
                  pick={pick}
                  analysis={analysis}
                  moodOfDay={daily.moodOfDay}
                  challengeThreshold={challengeThreshold}
                  onView={onView}
                  onCompleteChallenge={onCompleteChallenge}
                />
              )
            })}
          </div>

          <div className="rounded-2xl border border-white/10 bg-space-void/45 p-4">
            <div className="text-sm font-semibold text-slate-100">Achievements</div>
            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              <BadgeCard
                title="Mood Explorer"
                description="View at least one discovery from every mood category."
                complete={achievements.moodExplorer.complete}
                progress={<ProgressBar value={achievements.moodExplorer.value} max={achievements.moodExplorer.max} label="Moods viewed" />}
              />
              <BadgeCard
                title="Time Traveler"
                description="Explore 365 unique days of APODs."
                complete={achievements.timeTraveler.complete}
                progress={<ProgressBar value={achievements.timeTraveler.value} max={achievements.timeTraveler.max} label="Days explored" />}
              />
              <BadgeCard
                title="Collector"
                description="Create 10 mood boards."
                complete={achievements.collector.complete}
                progress={<ProgressBar value={achievements.collector.value} max={achievements.collector.max} label="Boards created" />}
              />
              <BadgeCard
                title="Color Hunter"
                description="Find images across all color families."
                complete={achievements.colorHunter.complete}
                progress={<ProgressBar value={achievements.colorHunter.value} max={achievements.colorHunter.max} label="Color families" />}
              />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

