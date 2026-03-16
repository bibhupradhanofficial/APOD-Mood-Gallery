import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, isValid, parseISO, subDays } from 'date-fns'

import { analyzeImage, fetchAPODRange, getKv, setKv, generateQuizQuestion, addUserPoints, supabase } from '../services'
import { buildShareUrlWithMeta, copyToClipboard, getApodImageUrl, getSocialShareLinks, MOODS } from '../utils'

const QUIZ_KV_KEY = 'spaceQuizProgress:v1'
const QUIZ_VERSION = 1
const DEFAULT_ROUND_LENGTH = 5

const MODES = [
  { id: 'mood', label: 'Guess the Mood', description: 'Predict the mood, then compare with the AI classifier.' },
  { id: 'phenomenon', label: 'Name That Phenomenon', description: 'Use APOD titles as clues to identify the phenomenon.' },
  { id: 'color', label: 'Color Match', description: 'Match a palette to the correct image.' },
  { id: 'date', label: 'Before / After', description: 'Decide which APOD came earlier in time.' },
  { id: 'ai-challenge', label: 'AI Cosmic Quiz', description: 'Test your literacy with AI-generated questions from recent APODs.' },
]

const PHENOMENA = [
  { id: 'nebula', label: 'Nebula' },
  { id: 'galaxy', label: 'Galaxy' },
  { id: 'planet', label: 'Planet' },
  { id: 'moon', label: 'Moon' },
  { id: 'eclipse', label: 'Eclipse' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'comet', label: 'Comet / Meteor' },
  { id: 'sun', label: 'Sun' },
  { id: 'rocket', label: 'Rocket / ISS' },
  { id: 'blackhole', label: 'Black Hole' },
  { id: 'stars', label: 'Stars / Cluster' },
]

const TOOLTIP_LIBRARY = {
  phenomenon: {
    title: 'Astronomical Phenomena',
    body: 'Many APOD titles hint at the subject. Look for words like “nebula”, “cluster”, “eclipse”, “aurora”, or famous objects (Orion, Andromeda, Saturn).',
  },
  photography: {
    title: 'Photography Techniques',
    body: 'APOD images are often composites: stacked exposures for low noise, narrowband filters (Hα/OIII/SII), or long exposures for faint structures and star trails.',
  },
  color: {
    title: 'Color Theory in Space',
    body: 'Colors can be physical (emission lines) or mapped (false color). Hα tends to appear red, OIII blue-green. “Cool” palettes feel calmer; high contrast + vivid colors feel energetic.',
  },
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizeMode(modeId) {
  const id = String(modeId ?? '').trim().toLowerCase()
  if (MODES.some((m) => m.id === id)) return id
  return MODES[0].id
}

function toISODate(input) {
  const d = input instanceof Date ? input : parseISO(String(input ?? ''))
  if (!(d instanceof Date) || !isValid(d)) return ''
  return format(d, 'yyyy-MM-dd')
}

function shuffle(list) {
  const arr = Array.isArray(list) ? [...list] : []
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

function pickRandom(list, count = 1, avoid = new Set()) {
  const arr = Array.isArray(list) ? list : []
  const picked = []
  const used = avoid instanceof Set ? new Set(avoid) : new Set()
  const shuffled = shuffle(arr)
  for (const item of shuffled) {
    if (picked.length >= count) break
    const key = String(item?.date ?? item?.url ?? '')
    if (!key) continue
    if (used.has(key)) continue
    used.add(key)
    picked.push(item)
  }
  return picked
}

function modeBadgeClass(modeId) {
  const id = String(modeId ?? '').toLowerCase()
  if (id === 'mood') return 'bg-sky-500/15 text-sky-200 ring-sky-400/30'
  if (id === 'phenomenon') return 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30'
  if (id === 'color') return 'bg-fuchsia-500/15 text-fuchsia-200 ring-fuchsia-400/30'
  if (id === 'date') return 'bg-indigo-500/15 text-indigo-200 ring-indigo-400/30'
  return 'bg-white/10 text-slate-200 ring-white/20'
}

function moodChipClass(mood, active) {
  const key = String(mood ?? '').toLowerCase()
  const base = 'px-3 py-2 rounded-lg text-sm font-medium ring-1 transition-colors'
  const on = active ? 'bg-white/10 text-white ring-white/30' : 'bg-white/5 text-slate-200 ring-white/15 hover:bg-white/10'
  if (key.includes('calm')) return `${base} ${active ? 'bg-sky-500/20 text-sky-100 ring-sky-400/40' : on}`
  if (key.includes('energ')) return `${base} ${active ? 'bg-orange-500/20 text-orange-100 ring-orange-400/40' : on}`
  if (key.includes('myst')) return `${base} ${active ? 'bg-indigo-500/20 text-indigo-100 ring-indigo-400/40' : on}`
  if (key.includes('insp')) return `${base} ${active ? 'bg-emerald-500/20 text-emerald-100 ring-emerald-400/40' : on}`
  if (key.includes('cosm')) return `${base} ${active ? 'bg-fuchsia-500/20 text-fuchsia-100 ring-fuchsia-400/40' : on}`
  return `${base} ${on}`
}

function formatPct(value01) {
  const n = Number(value01)
  if (!Number.isFinite(n)) return '—'
  return `${Math.round(clamp(n, 0, 1) * 100)}%`
}

function scoreFromConfidence(conf01) {
  const n = Number(conf01)
  if (!Number.isFinite(n)) return 10
  return 8 + Math.round(clamp(n, 0, 1) * 6)
}

function deriveTemperatureLabel(features) {
  const t = String(features?.temperature ?? '').toLowerCase()
  if (t === 'warm') return 'warm'
  if (t === 'cool') return 'cool'
  return 'mixed'
}

function computeLuminance(rgb) {
  const r = clamp(Number(rgb?.[0] ?? 0) / 255, 0, 1)
  const g = clamp(Number(rgb?.[1] ?? 0) / 255, 0, 1)
  const b = clamp(Number(rgb?.[2] ?? 0) / 255, 0, 1)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function computeColorStats(dominantColors = []) {
  const colors = Array.isArray(dominantColors) ? dominantColors : []
  const rawTotal = colors.reduce((sum, c) => sum + (Number(c?.weight) || 0), 0)
  const normalized = rawTotal > 0 ? colors.map((c) => ({ ...c, _w: (Number(c?.weight) || 0) / rawTotal })) : colors.map((c) => ({ ...c, _w: 1 / Math.max(1, colors.length) }))

  let minLum = 1
  let maxLum = 0
  let vividWeight = 0
  let darkWeight = 0
  let brightWeight = 0
  for (const c of normalized) {
    const w = Number(c?._w) || 0
    const rgb = c?.rgb
    const lum = computeLuminance(rgb)
    minLum = Math.min(minLum, lum)
    maxLum = Math.max(maxLum, lum)
    if (lum < 0.25) darkWeight += w
    if (lum > 0.75) brightWeight += w
    const r = clamp(Number(rgb?.[0] ?? 0) / 255, 0, 1)
    const g = clamp(Number(rgb?.[1] ?? 0) / 255, 0, 1)
    const b = clamp(Number(rgb?.[2] ?? 0) / 255, 0, 1)
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const chroma = max - min
    if (chroma > 0.35 && lum > 0.2 && lum < 0.9) vividWeight += w
  }
  return {
    contrast: clamp(maxLum - minLum, 0, 1),
    vividWeight: clamp(vividWeight, 0, 1),
    darkWeight: clamp(darkWeight, 0, 1),
    brightWeight: clamp(brightWeight, 0, 1),
  }
}

function buildMoodExplanation(features, topMood) {
  const safeMood = String(topMood ?? '').trim()
  const colors = Array.isArray(features?.dominantColors) ? features.dominantColors : []
  const subjects = Array.isArray(features?.subjects) ? features.subjects : []
  const brightness = clamp(Number(features?.brightness ?? 0), 0, 1)
  const complexity = clamp(Number(features?.complexity ?? 0), 0, 1)
  const temp = deriveTemperatureLabel(features)
  const stats = computeColorStats(colors)

  const reasons = []
  if (temp !== 'mixed') reasons.push(`Overall color temperature trends ${temp}.`)
  reasons.push(`Brightness is ${formatPct(brightness)} with contrast around ${formatPct(stats.contrast)}.`)
  reasons.push(`Visual complexity is ${formatPct(complexity)} (more structure means more “busy” energy).`)
  if (subjects.length) reasons.push(`Detected subjects: ${subjects.slice(0, 4).join(', ')}.`)

  if (/calm/i.test(safeMood)) {
    if (temp === 'cool') reasons.unshift('Cool tones often read as calming.')
    if (stats.contrast < 0.45) reasons.unshift('Lower contrast feels smoother and less intense.')
  } else if (/energ/i.test(safeMood)) {
    if (brightness > 0.55) reasons.unshift('Brighter scenes tend to feel more energetic.')
    if (complexity > 0.55 || stats.contrast > 0.55) reasons.unshift('Higher contrast or complexity increases visual intensity.')
  } else if (/myst/i.test(safeMood)) {
    if (stats.darkWeight > 0.45 || brightness < 0.5) reasons.unshift('Darker tonal ranges often read as mysterious.')
    if (complexity > 0.5) reasons.unshift('Complex structure can feel deep and enigmatic.')
  } else if (/insp/i.test(safeMood)) {
    if (stats.vividWeight > 0.25) reasons.unshift('Vivid accent colors can feel uplifting and inspiring.')
    if (brightness > 0.45) reasons.unshift('Moderate-to-high brightness supports a hopeful tone.')
  } else if (/cosm/i.test(safeMood)) {
    if (complexity > 0.45) reasons.unshift('Abstract structure and detail often read as “cosmic”.')
    if (subjects.length) reasons.unshift('Recognizable celestial subjects reinforce a cosmic vibe.')
  }

  return reasons.slice(0, 6)
}

function inferPhenomenon(apod) {
  const title = String(apod?.title ?? '').toLowerCase()
  const text = `${apod?.title ?? ''} ${apod?.explanation ?? ''}`.toLowerCase()
  const m = (id, patterns) => patterns.some((p) => text.includes(p) || title.includes(p)) ? id : null

  return (
    m('blackhole', ['black hole', 'event horizon', 'gravitational lens', 'accretion']) ||
    m('eclipse', ['eclipse', 'transit', 'occultation']) ||
    m('aurora', ['aurora', 'northern lights', 'southern lights']) ||
    m('comet', ['comet', 'meteor', 'meteor shower', 'bolide']) ||
    m('rocket', ['rocket', 'launch', 'shuttle', 'iss', 'space station', 'satellite']) ||
    m('sun', ['sun', 'solar', 'sunspot', 'corona', 'flare', 'prominence']) ||
    m('moon', ['moon', 'lunar']) ||
    m('planet', ['saturn', 'jupiter', 'mars', 'venus', 'mercury', 'uranus', 'neptune', 'planet']) ||
    m('nebula', ['nebula', 'orion', 'carina', 'veil', 'rosette', 'tarantula']) ||
    m('galaxy', ['galaxy', 'andromeda', 'milky way', 'spiral', 'messier']) ||
    m('stars', ['star', 'cluster', 'pleiades', 'globular']) ||
    null
  )
}

function uniqueByDate(items) {
  const list = Array.isArray(items) ? items : []
  const out = []
  const seen = new Set()
  for (const item of list) {
    const d = String(item?.date ?? '').trim()
    const src = getApodImageUrl(item, 'original') ?? getApodImageUrl(item, 'hd')
    if (!d || !src) continue
    if (seen.has(d)) continue
    seen.add(d)
    out.push({ ...item, _src: src })
  }
  return out
}

function Tooltip({ content, children }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex items-center">
      <span
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        tabIndex={0}
        className="inline-flex items-center outline-none"
      >
        {children}
      </span>
      {open && (
        <span className="absolute z-30 left-1/2 top-full mt-2 w-72 -translate-x-1/2 rounded-lg border border-white/10 bg-space-night/95 p-3 text-xs text-slate-200 shadow-lg ring-1 ring-white/10">
          <span className="block font-semibold text-slate-100">{content?.title}</span>
          <span className="mt-1 block text-slate-200/90">{content?.body}</span>
        </span>
      )}
    </span>
  )
}

function StatPill({ label, value, tooltip }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs text-slate-200 ring-1 ring-white/10">
      <span className="text-slate-300">{label}</span>
      <span className="font-medium text-slate-100">{value}</span>
      {tooltip && (
        <Tooltip content={tooltip}>
          <button
            type="button"
            className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/5 text-slate-200 ring-1 ring-white/10 hover:bg-white/10"
            aria-label={`${tooltip.title} info`}
          >
            ?
          </button>
        </Tooltip>
      )}
    </div>
  )
}

function defaultProgress() {
  const perMode = {}
  for (const m of MODES) {
    perMode[m.id] = { attempts: 0, correct: 0, streak: 0, bestStreak: 0, learned: {} }
  }
  return { version: QUIZ_VERSION, points: 0, perMode, lastPlayed: null }
}

async function loadProgress() {
  const stored = await getKv(QUIZ_KV_KEY)
  const obj = stored && typeof stored === 'object' ? stored : null
  if (!obj || obj.version !== QUIZ_VERSION) return defaultProgress()
  const base = defaultProgress()
  const merged = { ...base, ...obj, perMode: { ...base.perMode, ...(obj.perMode ?? {}) } }
  for (const m of MODES) {
    const entry = merged.perMode[m.id]
    merged.perMode[m.id] = {
      ...base.perMode[m.id],
      ...(entry && typeof entry === 'object' ? entry : {}),
      learned: entry?.learned && typeof entry.learned === 'object' ? entry.learned : {},
    }
  }
  return merged
}

async function persistProgress(progress) {
  await setKv(QUIZ_KV_KEY, progress)
}

export default function SpaceQuiz() {
  const abortRef = useRef(null)
  const [mode, setMode] = useState(() => {
    if (typeof window === 'undefined') return MODES[0].id
    const params = new URLSearchParams(window.location.search)
    return normalizeMode(params.get('quiz'))
  })
  const [pool, setPool] = useState([])
  const [poolStatus, setPoolStatus] = useState({ loading: true, error: null })
  const [progress, setProgress] = useState(() => defaultProgress())
  const [question, setQuestion] = useState(null)
  const [round, setRound] = useState({ index: 0, total: DEFAULT_ROUND_LENGTH, correct: 0, done: false })
  const [share, setShare] = useState({ copied: false, url: null })

  const modeInfo = useMemo(() => MODES.find((m) => m.id === mode) ?? MODES[0], [mode])
  const perMode = progress?.perMode?.[mode] ?? defaultProgress().perMode[mode]

  const overallStats = useMemo(() => {
    const modes = progress?.perMode && typeof progress.perMode === 'object' ? progress.perMode : {}
    let attempts = 0
    let correct = 0
    for (const m of MODES) {
      attempts += Number(modes?.[m.id]?.attempts ?? 0) || 0
      correct += Number(modes?.[m.id]?.correct ?? 0) || 0
    }
    const rate = attempts > 0 ? correct / attempts : 0
    return { attempts, correct, rate }
  }, [progress])

  const setModeAndPersistInUrl = useCallback((nextMode) => {
    const resolved = normalizeMode(nextMode)
    setMode(resolved)
    setShare({ copied: false, url: null })
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    url.searchParams.set('view', 'quiz')
    url.searchParams.set('quiz', resolved)
    window.history.replaceState({}, '', url.toString())
  }, [])

  useEffect(() => {
    let mounted = true
    loadProgress().then((p) => {
      if (!mounted) return
      setProgress(p)
    })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    abortRef.current?.abort?.()
    const abort = new AbortController()
    abortRef.current = abort

    async function loadPool() {
      setPoolStatus({ loading: true, error: null })
      try {
        const todayIso = toISODate(new Date())
        const startIso = toISODate(subDays(new Date(), 260))
        const list = await fetchAPODRange(startIso, todayIso)
        if (abort.signal.aborted) return
        const unique = uniqueByDate(list).filter((x) => x?._src)
        if (unique.length < 10) throw new Error('Not enough APOD images to build quiz pool')
        setPool(unique)
        setPoolStatus({ loading: false, error: null })
      } catch (error) {
        if (abort.signal.aborted) return
        setPool([])
        setPoolStatus({ loading: false, error: error?.message ? String(error.message) : 'Failed to load APOD pool' })
      }
    }

    loadPool()
    return () => abort.abort()
  }, [])

  const startRound = useCallback(
    (opts = {}) => {
      const total = clamp(Number(opts?.total ?? DEFAULT_ROUND_LENGTH) || DEFAULT_ROUND_LENGTH, 3, 12)
      setRound({ index: 0, total, correct: 0, done: false })
      setShare({ copied: false, url: null })
      setQuestion(null)
    },
    [setRound]
  )

  const advanceRound = useCallback(
    ({ wasCorrect, earnedPoints, learnedKey } = {}) => {
      setRound((prev) => {
        const nextIndex = prev.index + 1
        const nextCorrect = prev.correct + (wasCorrect ? 1 : 0)
        const done = nextIndex >= prev.total
        return { ...prev, index: nextIndex, correct: nextCorrect, done }
      })

      setProgress((prev) => {
        const base = prev && typeof prev === 'object' ? prev : defaultProgress()
        const per = base.perMode?.[mode] && typeof base.perMode[mode] === 'object' ? base.perMode[mode] : defaultProgress().perMode[mode]
        const attempts = (Number(per.attempts ?? 0) || 0) + 1
        const correct = (Number(per.correct ?? 0) || 0) + (wasCorrect ? 1 : 0)
        const streak = wasCorrect ? (Number(per.streak ?? 0) || 0) + 1 : 0
        const bestStreak = Math.max(Number(per.bestStreak ?? 0) || 0, streak)
        const learned = per.learned && typeof per.learned === 'object' ? { ...per.learned } : {}
        if (learnedKey) learned[String(learnedKey)] = (Number(learned[String(learnedKey)] ?? 0) || 0) + (wasCorrect ? 1 : 0)
        const next = {
          ...base,
          points: Math.max(0, (Number(base.points ?? 0) || 0) + (Number(earnedPoints ?? 0) || 0)),
          lastPlayed: new Date().toISOString(),
          perMode: {
            ...base.perMode,
            [mode]: { ...per, attempts, correct, streak, bestStreak, learned },
          },
        }
        persistProgress(next)

        // Sync to Supabase if logged in
        void (async () => {
          const { data: sessionData } = await supabase.auth.getSession()
          if (sessionData?.session?.user?.id && earnedPoints > 0) {
            await addUserPoints(sessionData.session.user.id, earnedPoints)
          }
        })()

        return next
      })
    },
    [mode]
  )

  const buildMoodQuestion = useCallback(() => {
    const pick = pickRandom(pool, 1)[0]
    if (!pick) return null
    return { type: 'mood', apod: pick, src: pick._src, state: 'asking', userGuess: null, analysis: null, error: null }
  }, [pool])

  const buildPhenomenonQuestion = useCallback(() => {
    const candidates = shuffle(pool).filter((p) => Boolean(inferPhenomenon(p)))
    const apod = candidates[0] ?? pool[0]
    if (!apod) return null
    const correctId = inferPhenomenon(apod) ?? 'galaxy'
    const correct = PHENOMENA.find((p) => p.id === correctId) ?? PHENOMENA[0]
    const other = shuffle(PHENOMENA.filter((p) => p.id !== correct.id)).slice(0, 3)
    const options = shuffle([correct, ...other])
    const clue = String(apod?.title ?? '').trim()
    const explanation = String(apod?.explanation ?? '').trim()
    return {
      type: 'phenomenon',
      apod,
      src: apod._src,
      clue,
      options,
      correctId: correct.id,
      state: 'asking',
      userChoice: null,
      why: explanation ? explanation.slice(0, 260).trim() : '',
    }
  }, [pool])

  const buildColorQuestion = useCallback(async () => {
    const target = pickRandom(pool, 1)[0]
    if (!target) return null
    const avoid = new Set([String(target?.date ?? '')])
    const decoys = pickRandom(pool, 3, avoid)
    const options = shuffle([target, ...decoys])
    let analysis = null
    try {
      analysis = await analyzeImage(target._src, { cacheKey: target._src, maxAgeMs: 14 * 24 * 60 * 60 * 1000 })
    } catch {
      analysis = null
    }
    const palette = (analysis?.dominantColors ?? []).slice(0, 4)
    if (palette.length === 0) return null
    return {
      type: 'color',
      target,
      options,
      palette,
      state: 'asking',
      userChoice: null,
      src: target._src,
      analysis,
    }
  }, [pool])

  const buildDateQuestion = useCallback(() => {
    const [a, b] = pickRandom(pool, 2)
    if (!a || !b) return null
    const da = String(a.date ?? '')
    const db = String(b.date ?? '')
    const pa = parseISO(da)
    const pb = parseISO(db)
    if (!isValid(pa) || !isValid(pb)) return null
    const older = pa.getTime() < pb.getTime() ? 'a' : 'b'
    return {
      type: 'date',
      a,
      b,
      older,
      state: 'asking',
      userChoice: null,
      src: null,
    }
  }, [pool])

  const nextQuestion = useCallback(async () => {
    setShare({ copied: false, url: null })
    if (!pool.length) return
    if (mode === 'mood') setQuestion(buildMoodQuestion())
    else if (mode === 'phenomenon') setQuestion(buildPhenomenonQuestion())
    else if (mode === 'color') {
      setQuestion({ type: 'color', state: 'loading' })
      const q = await buildColorQuestion()
      setQuestion(q ?? { type: 'color', state: 'error', error: 'Could not build color challenge.' })
    } else if (mode === 'date') setQuestion(buildDateQuestion())
    else if (mode === 'ai-challenge') {
      setQuestion({ type: 'ai-challenge', state: 'loading' })
      const pick = pickRandom(pool, 1)[0]
      const data = await generateQuizQuestion(pick)
      if (data) {
        setQuestion({
          type: 'ai-challenge',
          state: 'asking',
          apod: pick,
          src: pick._src,
          ...data,
          userChoice: null,
          earned: 0
        })
      } else {
        setQuestion({ type: 'ai-challenge', state: 'error', error: 'Gemini is orbiting another planet right now. Try again later.' })
      }
    }
    else setQuestion(buildMoodQuestion())
  }, [pool, mode, buildMoodQuestion, buildPhenomenonQuestion, buildColorQuestion, buildDateQuestion])

  useEffect(() => {
    if (poolStatus.loading || poolStatus.error) return
    if (!pool.length) return
    startRound({ total: DEFAULT_ROUND_LENGTH })
  }, [poolStatus.loading, poolStatus.error, pool.length, startRound])

  useEffect(() => {
    if (poolStatus.loading || poolStatus.error) return
    if (!pool.length) return
    if (round.done) return
    if (question) return
    nextQuestion()
  }, [poolStatus.loading, poolStatus.error, pool.length, round.done, question, nextQuestion])

  const onSubmitMoodGuess = useCallback(
    async (guess) => {
      if (!question || question.type !== 'mood' || question.state !== 'asking') return
      const userGuess = String(guess ?? '')
      setQuestion((prev) => ({ ...(prev ?? {}), state: 'revealing', userGuess }))
      let analysis = null
      let error = null
      try {
        analysis = await analyzeImage(question.src, { cacheKey: question.src, maxAgeMs: 14 * 24 * 60 * 60 * 1000 })
      } catch (err) {
        error = err?.message ? String(err.message) : 'Analysis failed'
      }
      const top = analysis?.moods?.[0]
      const aiMood = top?.mood ? String(top.mood) : null
      const conf = Number(top?.confidence ?? 0) || 0
      const wasCorrect = aiMood ? aiMood === userGuess : false
      const earned = wasCorrect ? scoreFromConfidence(conf) : 0
      const learnedKey = aiMood ? `mood:${aiMood}` : null
      setQuestion((prev) => ({
        ...(prev ?? {}),
        state: 'revealed',
        analysis,
        error,
        aiMood,
        aiConfidence: conf,
        wasCorrect,
        earned,
      }))
      advanceRound({ wasCorrect, earnedPoints: earned, learnedKey })
    },
    [question, advanceRound]
  )

  const onSubmitPhenomenon = useCallback(
    (choiceId) => {
      if (!question || question.type !== 'phenomenon' || question.state !== 'asking') return
      const choice = String(choiceId ?? '')
      const wasCorrect = choice === question.correctId
      const earned = wasCorrect ? 10 : 0
      setQuestion((prev) => ({ ...(prev ?? {}), state: 'revealed', userChoice: choice, wasCorrect, earned }))
      advanceRound({ wasCorrect, earnedPoints: earned, learnedKey: `phenomenon:${question.correctId}` })
    },
    [question, advanceRound]
  )

  const onSubmitColor = useCallback(
    (pickedDate) => {
      if (!question || question.type !== 'color' || question.state !== 'asking') return
      const choice = String(pickedDate ?? '')
      const targetDate = String(question.target?.date ?? '')
      const wasCorrect = choice === targetDate
      const earned = wasCorrect ? 12 : 0
      setQuestion((prev) => ({ ...(prev ?? {}), state: 'revealed', userChoice: choice, wasCorrect, earned }))
      advanceRound({ wasCorrect, earnedPoints: earned, learnedKey: 'color:palette' })
    },
    [question, advanceRound]
  )

  const onSubmitDate = useCallback(
    (choice) => {
      if (!question || question.type !== 'date' || question.state !== 'asking') return
      const userChoice = String(choice ?? '')
      const wasCorrect = userChoice === question.older
      const earned = wasCorrect ? 10 : 0
      setQuestion((prev) => ({ ...(prev ?? {}), state: 'revealed', userChoice, wasCorrect, earned }))
      advanceRound({ wasCorrect, earnedPoints: earned, learnedKey: 'timeline:ordering' })
    },
    [question, advanceRound]
  )

  const onSubmitAI = useCallback(
    (index) => {
      if (!question || question.type !== 'ai-challenge' || question.state !== 'asking') return
      const wasCorrect = index === question.correctIndex
      const earned = wasCorrect ? 15 : 0
      setQuestion((prev) => ({ ...(prev ?? {}), state: 'revealed', userChoice: index, wasCorrect, earned }))
      advanceRound({ wasCorrect, earnedPoints: earned, learnedKey: 'ai:literacy' })
    },
    [question, advanceRound]
  )

  const continueNext = useCallback(() => {
    setQuestion(null)
    setShare({ copied: false, url: null })
  }, [])

  const buildShare = useCallback(() => {
    const title = `Space Quiz Results — ${modeInfo.label}`
    const scoreLine = `${round.correct}/${round.total}`
    const description = `I scored ${scoreLine} in ${modeInfo.label} on APOD Mood Gallery. Total points: ${progress?.points ?? 0}.`
    const image = question?.apod ? getApodImageUrl(question.apod, 'thumbnail') ?? getApodImageUrl(question.apod, 'original') : ''
    const url = buildShareUrlWithMeta({
      meta: {
        title,
        description: description.slice(0, 240),
        image,
        url: typeof window !== 'undefined' ? window.location.href : '',
        siteName: 'APOD Mood Gallery',
        type: 'website',
      },
      params: { view: 'quiz', quiz: mode },
    })
    return { url, title, description, image }
  }, [mode, modeInfo.label, progress?.points, question?.apod, round.correct, round.total])

  const onCopyShare = useCallback(async () => {
    const built = buildShare()
    const ok = await copyToClipboard(built.url)
    setShare({ copied: ok, url: built.url })
  }, [buildShare])

  const onNativeShare = useCallback(async () => {
    const built = buildShare()
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: built.title, text: built.description, url: built.url })
        setShare({ copied: true, url: built.url })
        return
      }
    } catch {
      return
    }
    const ok = await copyToClipboard(built.url)
    setShare({ copied: ok, url: built.url })
  }, [buildShare])

  const shareLinks = useMemo(() => {
    if (!round.done) return null
    const built = buildShare()
    return getSocialShareLinks({ url: built.url, title: built.title, description: built.description, image: built.image })
  }, [round.done, buildShare])

  const ui = useMemo(() => {
    const rate = perMode?.attempts > 0 ? perMode.correct / perMode.attempts : 0
    const learnedCount = perMode?.learned && typeof perMode.learned === 'object' ? Object.keys(perMode.learned).length : 0
    return {
      modeAccuracy: rate,
      learnedCount,
    }
  }, [perMode])

  return (
    <section className="mx-auto max-w-6xl">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 ring-1 ring-white/10">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className={['inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1', modeBadgeClass(mode)].join(' ')}>
                Interactive Learning
              </span>
              <span className="text-xs text-slate-300">
                Progress: {overallStats.correct}/{overallStats.attempts} ({formatPct(overallStats.rate)})
              </span>
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-space-stardust">Space Quiz Lab</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-200/80">{modeInfo.description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatPill label="Points" value={String(progress?.points ?? 0)} />
            <StatPill label="Mode Accuracy" value={formatPct(ui.modeAccuracy)} />
            <StatPill label="Learned Topics" value={String(ui.learnedCount)} tooltip={TOOLTIP_LIBRARY.phenomenon} />
            <StatPill label="Color Theory" value="Tips" tooltip={TOOLTIP_LIBRARY.color} />
            <StatPill label="Photography" value="Tips" tooltip={TOOLTIP_LIBRARY.photography} />
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setModeAndPersistInUrl(m.id)
                  startRound({ total: DEFAULT_ROUND_LENGTH })
                }}
                className={[
                  'px-4 py-2 text-sm font-medium transition-colors duration-200 rounded-full ring-1',
                  mode === m.id ? 'bg-space-aurora/20 text-space-aurora ring-space-aurora/50' : 'text-slate-300 hover:text-white hover:bg-white/5 ring-white/10',
                ].join(' ')}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-300">
              Round: <span className="text-slate-100">{Math.min(round.index + 1, round.total)}</span> / {round.total}
            </div>
            <div className="h-2 w-44 overflow-hidden rounded-full bg-white/5 ring-1 ring-white/10">
              <div
                className="h-full bg-space-aurora/60"
                style={{ width: `${clamp((round.index / Math.max(1, round.total)) * 100, 0, 100)}%` }}
              />
            </div>
            <button
              type="button"
              onClick={() => startRound({ total: round.total })}
              className="rounded-lg bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 ring-1 ring-white/10 hover:bg-white/10"
            >
              Restart
            </button>
          </div>
        </div>

        <div className="mt-6">
          {poolStatus.loading && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-slate-200">
              Loading APOD quiz pool…
            </div>
          )}

          {!poolStatus.loading && poolStatus.error && (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-6 text-sm text-rose-100">
              {poolStatus.error}
            </div>
          )}

          {!poolStatus.loading && !poolStatus.error && round.done && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs font-medium tracking-widest text-slate-300 uppercase">Round Complete</p>
                  <h3 className="mt-2 text-xl font-semibold text-space-stardust">
                    {modeInfo.label}: {round.correct}/{round.total} correct
                  </h3>
                  <p className="mt-1 text-sm text-slate-200/80">
                    Streak: {perMode?.streak ?? 0} • Best: {perMode?.bestStreak ?? 0} • Total points: {progress?.points ?? 0}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      startRound({ total: round.total })
                      continueNext()
                    }}
                    className="rounded-lg bg-space-aurora/15 px-4 py-2 text-sm font-medium text-space-aurora ring-1 ring-space-aurora/30 hover:bg-space-aurora/20"
                  >
                    Play Again
                  </button>
                  <button
                    type="button"
                    onClick={onCopyShare}
                    className="rounded-lg bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 ring-1 ring-white/10 hover:bg-white/10"
                  >
                    Copy Share Link
                  </button>
                  <button
                    type="button"
                    onClick={onNativeShare}
                    className="rounded-lg bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 ring-1 ring-white/10 hover:bg-white/10"
                  >
                    Share
                  </button>
                </div>
              </div>

              {share.copied && (
                <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-100">
                  Share link copied to clipboard.
                </div>
              )}

              {shareLinks && (
                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
                  <a className="text-slate-200 underline hover:text-white" href={shareLinks.twitter} target="_blank" rel="noreferrer">
                    Share on X
                  </a>
                  <a className="text-slate-200 underline hover:text-white" href={shareLinks.reddit} target="_blank" rel="noreferrer">
                    Share on Reddit
                  </a>
                  <a className="text-slate-200 underline hover:text-white" href={shareLinks.pinterest} target="_blank" rel="noreferrer">
                    Share on Pinterest
                  </a>
                </div>
              )}
            </div>
          )}

          {!poolStatus.loading && !poolStatus.error && !round.done && question?.type === 'mood' && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                <div className="w-full lg:w-2/3">
                  <div className="overflow-hidden rounded-xl border border-white/10 bg-space-night/50">
                    <img src={question.src} alt={question.apod?.title ?? 'APOD'} className="h-auto w-full object-cover" />
                  </div>
                  <div className="mt-3 text-xs text-slate-300">
                    Hint: mood is inferred from color temperature, contrast, complexity, and subjects.
                  </div>
                </div>

                <div className="w-full lg:w-1/3">
                  <h3 className="text-lg font-semibold text-space-stardust">Guess the Mood</h3>
                  <p className="mt-1 text-sm text-slate-200/80">Pick the mood you think best matches the image.</p>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {MOODS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        disabled={question.state !== 'asking'}
                        onClick={() => onSubmitMoodGuess(m)}
                        className={moodChipClass(m, false)}
                      >
                        {m}
                      </button>
                    ))}
                  </div>

                  {question.state === 'revealing' && (
                    <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
                      Analyzing image…
                    </div>
                  )}

                  {question.state === 'revealed' && (
                    <div className="mt-4 space-y-3">
                      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-slate-100">Your guess: {question.userGuess}</div>
                          <div className={question.wasCorrect ? 'text-xs font-semibold text-emerald-200' : 'text-xs font-semibold text-rose-200'}>
                            {question.wasCorrect ? `Correct +${question.earned}` : 'Not quite'}
                          </div>
                        </div>
                        <div className="mt-2 text-sm text-slate-200/90">
                          AI mood: <span className="font-semibold text-slate-100">{question.aiMood ?? 'Unknown'}</span>{' '}
                          {question.aiMood ? <span className="text-xs text-slate-300">({formatPct(question.aiConfidence)})</span> : null}
                        </div>
                        {question.error && (
                          <div className="mt-2 text-xs text-rose-200">
                            {question.error}
                          </div>
                        )}
                      </div>

                      {question.analysis?.dominantColors?.length ? (
                        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-medium text-slate-100">Color Cues</div>
                            <Tooltip content={TOOLTIP_LIBRARY.color}>
                              <button
                                type="button"
                                className="rounded-full bg-white/5 px-2 py-1 text-xs text-slate-200 ring-1 ring-white/10 hover:bg-white/10"
                              >
                                Learn
                              </button>
                            </Tooltip>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {question.analysis.dominantColors.slice(0, 5).map((c) => (
                              <div key={c.hex} className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs text-slate-200 ring-1 ring-white/10">
                                <span className="h-3 w-3 rounded-full ring-1 ring-white/10" style={{ backgroundColor: c.hex }} />
                                <span className="font-mono text-[11px]">{c.hex}</span>
                                <span className="text-slate-300">{formatPct(c.weight)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {question.aiMood ? (
                        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                          <div className="text-sm font-medium text-slate-100">Why the AI chose {question.aiMood}</div>
                          <ul className="mt-2 space-y-1 text-sm text-slate-200/90">
                            {buildMoodExplanation(question.analysis, question.aiMood).map((r) => (
                              <li key={r} className="flex gap-2">
                                <span className="text-slate-400">•</span>
                                <span>{r}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      <button
                        type="button"
                        onClick={continueNext}
                        className="w-full rounded-lg bg-space-aurora/15 px-4 py-2 text-sm font-medium text-space-aurora ring-1 ring-space-aurora/30 hover:bg-space-aurora/20"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {!poolStatus.loading && !poolStatus.error && !round.done && question?.type === 'phenomenon' && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                <div className="w-full lg:w-2/3">
                  <div className="overflow-hidden rounded-xl border border-white/10 bg-space-night/50">
                    <img src={question.src} alt={question.apod?.title ?? 'APOD'} className="h-auto w-full object-cover" />
                  </div>
                </div>
                <div className="w-full lg:w-1/3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-space-stardust">Name That Phenomenon</h3>
                    <Tooltip content={TOOLTIP_LIBRARY.phenomenon}>
                      <button
                        type="button"
                        className="rounded-full bg-white/5 px-2 py-1 text-xs text-slate-200 ring-1 ring-white/10 hover:bg-white/10"
                      >
                        Tips
                      </button>
                    </Tooltip>
                  </div>
                  <p className="mt-1 text-sm text-slate-200/80">
                    Title clue: <span className="font-medium text-slate-100">{question.clue || '—'}</span>
                  </p>

                  <div className="mt-4 grid grid-cols-1 gap-2">
                    {question.options.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={question.state !== 'asking'}
                        onClick={() => onSubmitPhenomenon(opt.id)}
                        className={[
                          'rounded-lg px-4 py-2 text-sm font-medium ring-1 transition-colors text-left',
                          question.state === 'asking'
                            ? 'bg-white/5 text-slate-100 ring-white/10 hover:bg-white/10'
                            : question.correctId === opt.id
                              ? 'bg-emerald-500/15 text-emerald-100 ring-emerald-400/30'
                              : question.userChoice === opt.id
                                ? 'bg-rose-500/15 text-rose-100 ring-rose-400/30'
                                : 'bg-white/5 text-slate-200 ring-white/10',
                        ].join(' ')}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {question.state === 'revealed' && (
                    <div className="mt-4 space-y-3">
                      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-slate-100">
                            Correct answer: {PHENOMENA.find((p) => p.id === question.correctId)?.label ?? '—'}
                          </div>
                          <div className={question.wasCorrect ? 'text-xs font-semibold text-emerald-200' : 'text-xs font-semibold text-rose-200'}>
                            {question.wasCorrect ? `Correct +${question.earned}` : 'Not quite'}
                          </div>
                        </div>
                        {question.why && (
                          <div className="mt-2 text-xs text-slate-200/80">
                            APOD excerpt: {question.why}…
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={continueNext}
                        className="w-full rounded-lg bg-space-aurora/15 px-4 py-2 text-sm font-medium text-space-aurora ring-1 ring-space-aurora/30 hover:bg-space-aurora/20"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {!poolStatus.loading && !poolStatus.error && !round.done && question?.type === 'color' && (
            <div className="glass-card p-6">
              {question.state === 'loading' && (
                <div className="text-sm text-slate-200">Preparing color challenge…</div>
              )}
              {question.state === 'error' && (
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-100">
                  {question.error}
                </div>
              )}
              {question.state !== 'loading' && question.state !== 'error' && (
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
                  <div className="w-full lg:w-1/3">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-lg font-semibold text-space-stardust">Color Match</h3>
                      <Tooltip content={TOOLTIP_LIBRARY.color}>
                        <button
                          type="button"
                          className="rounded-full bg-white/5 px-2 py-1 text-xs text-slate-200 ring-1 ring-white/10 hover:bg-white/10"
                        >
                          Learn
                        </button>
                      </Tooltip>
                    </div>
                    <p className="mt-1 text-sm text-slate-200/80">Pick the image that matches this palette.</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {question.palette.map((c) => (
                        <div key={c.hex} className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs text-slate-200 ring-1 ring-white/10">
                          <span className="h-4 w-4 rounded-full ring-1 ring-white/10" style={{ backgroundColor: c.hex }} />
                          <span className="font-mono text-[11px]">{c.hex}</span>
                        </div>
                      ))}
                    </div>
                    {question.state === 'revealed' && (
                      <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-slate-100">
                            {question.wasCorrect ? 'Correct match' : 'Wrong match'}
                          </div>
                          <div className={question.wasCorrect ? 'text-xs font-semibold text-emerald-200' : 'text-xs font-semibold text-rose-200'}>
                            {question.wasCorrect ? `+${question.earned}` : '0 points'}
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-slate-200/80">
                          Target: {question.target?.title ?? '—'} ({question.target?.date ?? '—'})
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="w-full lg:w-2/3">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-2">
                      {question.options.map((opt) => {
                        const active = question.state === 'revealed' && String(opt?.date ?? '') === String(question.target?.date ?? '')
                        const picked = question.state === 'revealed' && String(opt?.date ?? '') === String(question.userChoice ?? '')
                        const ring = question.state === 'revealed'
                          ? active
                            ? 'ring-emerald-400/40'
                            : picked
                              ? 'ring-rose-400/40'
                              : 'ring-white/10'
                          : 'ring-white/10 hover:ring-white/20'
                        return (
                          <button
                            key={opt.date}
                            type="button"
                            disabled={question.state !== 'asking'}
                            onClick={() => onSubmitColor(opt.date)}
                            className={['overflow-hidden rounded-xl border border-white/10 bg-space-night/40 ring-1 transition', ring].join(' ')}
                          >
                            <img src={opt._src} alt={opt.title ?? 'APOD'} className="h-40 w-full object-cover md:h-52" />
                            <div className="p-3 text-left">
                              <div className="text-xs font-medium text-slate-100 line-clamp-2">{opt.title ?? 'APOD'}</div>
                              <div className="mt-1 text-[11px] text-slate-300">{opt.date ?? '—'}</div>
                            </div>
                          </button>
                        )
                      })}
                    </div>

                    {question.state === 'revealed' && (
                      <div className="mt-4">
                        <button
                          type="button"
                          onClick={continueNext}
                          className="w-full rounded-lg bg-space-aurora/15 px-4 py-2 text-sm font-medium text-space-aurora ring-1 ring-space-aurora/30 hover:bg-space-aurora/20"
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {!poolStatus.loading && !poolStatus.error && !round.done && question?.type === 'date' && (
            <div className="glass-card p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                <div className="w-full lg:w-2/3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="overflow-hidden rounded-xl border border-white/10 bg-space-night/50">
                      <img src={question.a?._src} alt={question.a?.title ?? 'APOD A'} className="h-44 w-full object-cover md:h-60" />
                      <div className="p-3">
                        <div className="text-xs font-semibold text-slate-100">A</div>
                      </div>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-white/10 bg-space-night/50">
                      <img src={question.b?._src} alt={question.b?.title ?? 'APOD B'} className="h-44 w-full object-cover md:h-60" />
                      <div className="p-3">
                        <div className="text-xs font-semibold text-slate-100">B</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="w-full lg:w-1/3">
                  <h3 className="text-lg font-semibold text-space-stardust">Before / After</h3>
                  <p className="mt-1 text-sm text-slate-200/80">Which image was published earlier on APOD?</p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={question.state !== 'asking'}
                      onClick={() => onSubmitDate('a')}
                      className={[
                        'rounded-lg px-4 py-2 text-sm font-medium ring-1 transition-colors',
                        question.state === 'asking'
                          ? 'bg-white/5 text-slate-100 ring-white/10 hover:bg-white/10'
                          : question.older === 'a'
                            ? 'bg-emerald-500/15 text-emerald-100 ring-emerald-400/30'
                            : question.userChoice === 'a'
                              ? 'bg-rose-500/15 text-rose-100 ring-rose-400/30'
                              : 'bg-white/5 text-slate-200 ring-white/10',
                      ].join(' ')}
                    >
                      A is older
                    </button>
                    <button
                      type="button"
                      disabled={question.state !== 'asking'}
                      onClick={() => onSubmitDate('b')}
                      className={[
                        'rounded-lg px-4 py-2 text-sm font-medium ring-1 transition-colors',
                        question.state === 'asking'
                          ? 'bg-white/5 text-slate-100 ring-white/10 hover:bg-white/10'
                          : question.older === 'b'
                            ? 'bg-emerald-500/15 text-emerald-100 ring-emerald-400/30'
                            : question.userChoice === 'b'
                              ? 'bg-rose-500/15 text-rose-100 ring-rose-400/30'
                              : 'bg-white/5 text-slate-200 ring-white/10',
                      ].join(' ')}
                    >
                      B is older
                    </button>
                  </div>

                  {question.state === 'revealed' && (
                    <div className="mt-4 space-y-3">
                      <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-slate-100">
                            {question.wasCorrect ? 'Correct ordering' : 'Not quite'}
                          </div>
                          <div className={question.wasCorrect ? 'text-xs font-semibold text-emerald-200' : 'text-xs font-semibold text-rose-200'}>
                            {question.wasCorrect ? `+${question.earned}` : '0 points'}
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-slate-200/80">
                          A: {question.a?.date ?? '—'} • B: {question.b?.date ?? '—'}
                        </div>
                        <div className="mt-1 text-xs text-slate-300">
                          Learning note: APOD is a daily archive—date context is part of the story.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={continueNext}
                        className="w-full rounded-lg bg-space-aurora/15 px-4 py-2 text-sm font-medium text-space-aurora ring-1 ring-space-aurora/30 hover:bg-space-aurora/20"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {!poolStatus.loading && !poolStatus.error && !round.done && question?.type === 'ai-challenge' && (
            <div className="glass-card p-4 sm:p-6 animate-in fade-in duration-500">
              {question.state === 'loading' && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-space-aurora border-t-transparent mb-4" />
                  <div className="text-sm text-slate-200">Gemini is preparing your cosmic challenge…</div>
                </div>
              )}
              {question.state === 'error' && (
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-100">
                  {question.error}
                </div>
              )}
              {question.state !== 'loading' && question.state !== 'error' && (
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
                  <div className="w-full lg:w-2/3">
                    <div className="overflow-hidden rounded-xl border border-white/10 bg-space-night/50 relative group shadow-2xl">
                      <img src={question.src} alt={question.apod?.title ?? 'APOD'} className="h-auto w-full object-cover max-h-[500px]" />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        <p className="text-xs text-white uppercase tracking-tighter opacity-50">Reference Image / Date: {question.apod?.date}</p>
                        <p className="text-sm font-bold text-white truncate">{question.apod?.title}</p>
                      </div>
                    </div>
                  </div>
                  <div className="w-full lg:w-1/3">
                    <div className="flex items-center gap-2 mb-2">
                       <span className="h-2 w-2 rounded-full bg-space-aurora animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                       <span className="text-[10px] font-bold tracking-[0.2em] text-space-aurora uppercase">AI Cosmic Challenge</span>
                    </div>
                    <p className="mt-1 text-base font-semibold text-white leading-relaxed">{question.question}</p>

                    <div className="mt-6 grid grid-cols-1 gap-2.5">
                      {question.options.map((opt, idx) => (
                        <button
                          key={idx}
                          type="button"
                          disabled={question.state !== 'asking'}
                          onClick={() => onSubmitAI(idx)}
                          className={[
                            'rounded-xl px-5 py-3.5 text-sm font-medium ring-1 transition-all text-left relative overflow-hidden group',
                            question.state === 'asking'
                              ? 'bg-white/5 text-slate-100 ring-white/10 hover:bg-white/[0.08] hover:translate-x-1 hover:ring-white/20'
                              : question.correctIndex === idx
                                ? 'bg-emerald-500/20 text-emerald-100 ring-emerald-500/40'
                                : question.userChoice === idx
                                  ? 'bg-rose-500/20 text-rose-100 ring-rose-500/40'
                                  : 'bg-white/5 text-slate-400 ring-white/10 opacity-40',
                          ].join(' ')}
                        >
                          <div className="flex items-center gap-4">
                            <span className="flex-shrink-0 flex items-center justify-center h-7 w-7 rounded-lg bg-white/5 border border-white/10 text-[10px] font-bold text-slate-400 group-hover:text-space-aurora group-hover:border-space-aurora/40 transition-colors uppercase">
                              {String.fromCharCode(65 + idx)}
                            </span>
                            <span className="leading-snug">{opt}</span>
                          </div>
                        </button>
                      ))}
                    </div>

                    {question.state === 'revealed' && (
                      <div className="mt-8 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-2xl backdrop-blur-sm ring-1 ring-white/5">
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <div className="text-[10px] font-black tracking-[0.2em] text-white/40 uppercase">
                              {question.wasCorrect ? 'Evaluation: Correct' : 'Evaluation: Feedback'}
                            </div>
                            <div className={[
                              'px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wider uppercase',
                              question.wasCorrect ? 'bg-emerald-500/30 text-emerald-300' : 'bg-rose-500/30 text-rose-300'
                            ].join(' ')}>
                              {question.wasCorrect ? `+${question.earned} pts` : '0 pts'}
                            </div>
                          </div>
                          <p className="text-sm leading-relaxed text-slate-300 font-medium italic">
                            "{question.explanation}"
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={continueNext}
                          className="w-full group relative overflow-hidden rounded-2xl bg-space-aurora/20 px-4 py-4 text-sm font-black tracking-widest text-space-aurora ring-1 ring-space-aurora/40 hover:bg-space-aurora/30 transition-all active:scale-[0.98] uppercase shadow-[0_0_25px_rgba(34,197,94,0.15)]"
                        >
                          <span className="relative z-10">Next Challenge</span>
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

