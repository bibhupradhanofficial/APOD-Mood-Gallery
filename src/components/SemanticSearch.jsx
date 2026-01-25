import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, isValid, parseISO, subDays } from 'date-fns'

import MoodSearch from './MoodSearch'
import { MOODS } from '../utils'

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function toISOInput(date) {
  if (!date) return ''
  try {
    return format(date, 'yyyy-MM-dd')
  } catch {
    return ''
  }
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

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'me',
  'my',
  'show',
  'find',
  'search',
  'look',
  'for',
  'with',
  'from',
  'in',
  'on',
  'between',
  'to',
  'and',
  'or',
  'of',
  'images',
  'image',
  'photos',
  'photo',
  'pictures',
  'picture',
  'apod',
  'nasa',
  'please',
])

const MOOD_SYNONYMS = {
  calming: 'Calming',
  calm: 'Calming',
  serene: 'Calming',
  peaceful: 'Calming',
  relaxing: 'Calming',
  tranquil: 'Calming',
  soothing: 'Calming',
  energizing: 'Energizing',
  energetic: 'Energizing',
  vibrant: 'Energizing',
  intense: 'Energizing',
  exciting: 'Energizing',
  dynamic: 'Energizing',
  mysterious: 'Mysterious',
  eerie: 'Mysterious',
  ominous: 'Mysterious',
  spooky: 'Mysterious',
  shadowy: 'Mysterious',
  inspiring: 'Inspiring',
  inspirational: 'Inspiring',
  uplifting: 'Inspiring',
  hopeful: 'Inspiring',
  awe: 'Inspiring',
  awesome: 'Inspiring',
  cosmic: 'Cosmic',
  galactic: 'Cosmic',
  epic: 'Cosmic',
  grand: 'Cosmic',
}

const SUBJECT_SYNONYMS = {
  galaxy: 'galaxies',
  galaxies: 'galaxies',
  spiral: 'galaxies',
  milkyway: 'galaxies',
  nebula: 'nebulae',
  nebulae: 'nebulae',
  cloud: 'nebulae',
  clouds: 'nebulae',
  planet: 'planets',
  planets: 'planets',
  mars: 'planets',
  jupiter: 'planets',
  saturn: 'planets',
  earth: 'earth',
  terrestrial: 'earth',
  'blue-marble': 'earth',
  star: 'stars',
  stars: 'stars',
  cluster: 'stars',
  clusters: 'stars',
  comet: 'phenomena',
  comets: 'phenomena',
  asteroid: 'phenomena',
  asteroids: 'phenomena',
  meteor: 'phenomena',
  meteors: 'phenomena',
  moon: 'phenomena',
  moons: 'phenomena',
  eclipse: 'phenomena',
}

const COLOR_SYNONYMS = {
  purple: 'purple',
  violet: 'purple',
  lavender: 'purple',
  indigo: 'purple',
  blue: 'blue',
  azure: 'blue',
  navy: 'blue',
  cyan: 'cyan',
  aqua: 'cyan',
  turquoise: 'cyan',
  teal: 'teal',
  green: 'green',
  emerald: 'green',
  lime: 'green',
  yellow: 'yellow',
  gold: 'yellow',
  golden: 'yellow',
  orange: 'orange',
  red: 'red',
  crimson: 'red',
  pink: 'pink',
  magenta: 'magenta',
  fuchsia: 'magenta',
  white: 'white',
  black: 'black',
  gray: 'gray',
  grey: 'gray',
  dark: 'black',
}

const ADJECTIVES = new Set([
  'bright',
  'dark',
  'colorful',
  'vibrant',
  'muted',
  'soft',
  'pastel',
  'cool',
  'warm',
  'glowing',
  'dramatic',
  'high-contrast',
  'low-contrast',
])

const SENTIMENT_LEXICON = {
  calm: 1,
  peaceful: 2,
  serene: 2,
  soothing: 2,
  relaxing: 2,
  tranquil: 2,
  inspiring: 2,
  uplifting: 2,
  hopeful: 2,
  bright: 1,
  vibrant: 1,
  colorful: 1,
  energizing: 2,
  energetic: 2,
  exciting: 1,
  epic: 1,
  grand: 1,
  mysterious: -2,
  eerie: -2,
  ominous: -2,
  spooky: -2,
  dark: -1,
  shadowy: -1,
}

function normalizeText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(text) {
  const normalized = normalizeText(text)
  if (!normalized) return []
  return normalized.split(' ').filter(Boolean)
}

function unique(list) {
  const out = []
  const seen = new Set()
  for (const v of Array.isArray(list) ? list : []) {
    const k = String(v ?? '').trim()
    if (!k) continue
    if (seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

function inferPalette({ colors, adjectives }) {
  const a = new Set((Array.isArray(adjectives) ? adjectives : []).map((v) => String(v).toLowerCase()))
  const c = new Set((Array.isArray(colors) ? colors : []).map((v) => String(v).toLowerCase()))

  if (a.has('vibrant') || a.has('colorful')) return 'vibrant'
  if (a.has('muted') || a.has('soft') || a.has('pastel')) return 'muted'
  if (a.has('cool')) return 'cool'
  if (a.has('warm')) return 'warm'

  const coolColors = ['blue', 'purple', 'cyan', 'teal']
  const warmColors = ['red', 'orange', 'yellow']
  if (coolColors.some((x) => c.has(x))) return 'cool'
  if (warmColors.some((x) => c.has(x))) return 'warm'
  return 'any'
}

function inferMinBrightnessPct(adjectives) {
  const a = new Set((Array.isArray(adjectives) ? adjectives : []).map((v) => String(v).toLowerCase()))
  if (a.has('bright') || a.has('glowing')) return 55
  return 0
}

function sentimentScore(tokens) {
  let score = 0
  for (const token of tokens) {
    score += Number(SENTIMENT_LEXICON[token] ?? 0)
  }
  return clamp(score, -8, 8)
}

function inferMoods({ explicitMoods, score, adjectives }) {
  const selected = unique(explicitMoods).filter((m) => MOODS.includes(m))
  if (selected.length > 0) return selected

  const a = new Set((Array.isArray(adjectives) ? adjectives : []).map((v) => String(v).toLowerCase()))
  if (score <= -2) return ['Mysterious']
  if (score >= 3) return a.has('bright') || a.has('vibrant') ? ['Energizing'] : ['Inspiring']
  if (score >= 1) return ['Cosmic']
  return []
}

function parseDateRange(text, { today }) {
  const normalized = normalizeText(text)
  if (!normalized) return { dateStart: null, dateEnd: null, rawYears: [] }

  const years = []
  const yearRegex = /\b(19|20)\d{2}\b/g
  for (const match of normalized.matchAll(yearRegex)) {
    years.push(Number(match[0]))
  }

  const uniqueYears = unique(years).map((y) => Number(y)).filter((y) => Number.isFinite(y))
  if (uniqueYears.length === 0) return { dateStart: null, dateEnd: null, rawYears: [] }

  const minYear = Math.min(...uniqueYears)
  const maxYear = Math.max(...uniqueYears)
  const hasFrom = /\b(from|since)\b/.test(normalized)
  const hasBetween = /\b(between)\b/.test(normalized) || /\bto\b/.test(normalized)
  const hasIn = /\b(in)\b/.test(normalized)

  if (uniqueYears.length >= 2 && hasBetween) {
    return {
      dateStart: `${minYear}-01-01`,
      dateEnd: `${maxYear}-12-31`,
      rawYears: uniqueYears,
    }
  }

  if (uniqueYears.length >= 1 && hasFrom) {
    return {
      dateStart: `${minYear}-01-01`,
      dateEnd: toISOInput(today),
      rawYears: uniqueYears,
    }
  }

  if (uniqueYears.length >= 1 && hasIn) {
    return {
      dateStart: `${minYear}-01-01`,
      dateEnd: `${minYear}-12-31`,
      rawYears: uniqueYears,
    }
  }

  if (uniqueYears.length >= 1) {
    return {
      dateStart: `${minYear}-01-01`,
      dateEnd: `${minYear}-12-31`,
      rawYears: uniqueYears,
    }
  }

  return { dateStart: null, dateEnd: null, rawYears: uniqueYears }
}

function parseSemanticQuery(text, { today }) {
  const tokens = tokenize(text)
  const meaningfulTokens = tokens.filter((t) => t && !STOPWORDS.has(t))
  const adjectives = []
  const colors = []
  const explicitMoods = []
  const subjectGroups = {
    galaxies: false,
    planets: false,
    nebulae: false,
    earth: false,
    stars: false,
    phenomena: false,
  }

  for (const t of tokens) {
    if (ADJECTIVES.has(t)) adjectives.push(t)
    const mood = MOOD_SYNONYMS[t]
    if (mood) explicitMoods.push(mood)
    const color = COLOR_SYNONYMS[t]
    if (color) colors.push(color)
    const subjectGroup = SUBJECT_SYNONYMS[t]
    if (subjectGroup && subjectGroups[subjectGroup] !== undefined) subjectGroups[subjectGroup] = true
  }

  const date = parseDateRange(text, { today })
  const score = sentimentScore(tokens)
  const moods = inferMoods({ explicitMoods, score, adjectives })
  const palette = inferPalette({ colors, adjectives })
  const minBrightnessPct = inferMinBrightnessPct(adjectives)

  const keywords = unique(meaningfulTokens)
  const subjectEnabled = Object.values(subjectGroups).some(Boolean)

  return {
    raw: String(text ?? ''),
    tokens,
    keywords,
    adjectives: unique(adjectives),
    colors: unique(colors),
    subjectGroups,
    subjectEnabled,
    dateStart: date.dateStart,
    dateEnd: date.dateEnd,
    moods,
    palette,
    minBrightnessPct,
    sentiment: { score },
  }
}

function badge(text) {
  return (
    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-100/80">
      {text}
    </span>
  )
}

const EXAMPLE_QUERIES = [
  'Show me calming purple nebulae',
  'Find energizing images with Earth',
  'Mysterious dark space from 2023',
  'Colorful galaxies between 2020 and 2022',
  'Cool blue star clusters',
  'Warm orange planets',
]

function buildSuggestions(input) {
  const q = normalizeText(input)
  if (!q) return EXAMPLE_QUERIES.slice(0, 6)

  const tokens = q.split(' ').filter(Boolean)
  const last = tokens[tokens.length - 1] ?? ''
  const suggestions = []

  const synonymKeys = Object.keys({ ...MOOD_SYNONYMS, ...SUBJECT_SYNONYMS, ...COLOR_SYNONYMS })
  if (last.length >= 2) {
    const matches = synonymKeys
      .filter((k) => k.startsWith(last))
      .slice(0, 6)
      .map((k) => {
        const replaced = [...tokens.slice(0, -1), k].join(' ')
        return replaced
      })
    suggestions.push(...matches)
  }

  const rankedExamples = EXAMPLE_QUERIES.filter((e) => normalizeText(e).includes(q))
  suggestions.push(...rankedExamples)

  const fallbackExamples = EXAMPLE_QUERIES.filter((e) => {
    const t = normalizeText(e)
    return tokens.some((w) => w.length >= 3 && t.includes(w))
  })
  suggestions.push(...fallbackExamples)

  return unique(suggestions).slice(0, 8)
}

export default function SemanticSearch() {
  const today = useMemo(() => new Date(), [])
  const defaultEnd = useMemo(() => toISOInput(today), [today])
  const defaultStart = useMemo(() => toISOInput(subDays(today, 30)), [today])

  const [input, setInput] = useState('')
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1)
  const [appliedText, setAppliedText] = useState('')

  const parsed = useMemo(() => parseSemanticQuery(input, { today }), [input, today])
  const appliedParsed = useMemo(() => parseSemanticQuery(appliedText, { today }), [appliedText, today])

  const suggestions = useMemo(() => buildSuggestions(input), [input])
  const suggestionsRef = useRef(suggestions)
  useEffect(() => {
    suggestionsRef.current = suggestions
  }, [suggestions])

  const applyQuery = useCallback(() => {
    setAppliedText(input)
    setActiveSuggestionIndex(-1)
  }, [input])

  const applyExample = useCallback((example) => {
    setInput(example)
    setAppliedText(example)
    setActiveSuggestionIndex(-1)
  }, [])

  const onKeyDown = useCallback(
    (e) => {
      const list = suggestionsRef.current
      if (e.key === 'Enter') {
        e.preventDefault()
        if (activeSuggestionIndex >= 0 && activeSuggestionIndex < list.length) {
          const chosen = list[activeSuggestionIndex]
          setInput(chosen)
          setAppliedText(chosen)
          setActiveSuggestionIndex(-1)
          return
        }
        applyQuery()
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveSuggestionIndex((prev) => clamp(prev + 1, -1, Math.max(-1, list.length - 1)))
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveSuggestionIndex((prev) => clamp(prev - 1, -1, Math.max(-1, list.length - 1)))
        return
      }

      if (e.key === 'Escape') {
        setActiveSuggestionIndex(-1)
      }
    },
    [activeSuggestionIndex, applyQuery]
  )

  const externalQuery = useMemo(() => {
    const q = appliedParsed
    const moods = unique(q.moods).filter((m) => MOODS.includes(m))
    const dateStart = q.dateStart || null
    const dateEnd = q.dateEnd || null
    const datesValid =
      (!dateStart && !dateEnd) ||
      (Boolean(dateStart) && Boolean(dateEnd) && Boolean(safeParseDate(dateStart)) && Boolean(safeParseDate(dateEnd)))

    return {
      moods: moods.length > 0 ? moods : undefined,
      moodLogic: moods.length > 1 ? 'or' : undefined,
      moodThreshold: moods.length > 0 ? 60 : undefined,
      palette: q.palette !== 'any' ? q.palette : undefined,
      subjects: q.subjectEnabled ? q.subjectGroups : undefined,
      minBrightness: q.minBrightnessPct > 0 ? clamp(q.minBrightnessPct / 100, 0, 1) : undefined,
      dateStart: datesValid ? (dateStart ?? undefined) : undefined,
      dateEnd: datesValid ? (dateEnd ?? undefined) : undefined,
      colors: q.colors.length > 0 ? q.colors : undefined,
    }
  }, [appliedParsed])

  const externalQueryKey = useMemo(() => JSON.stringify(externalQuery), [externalQuery])

  const usingDefaults = !appliedText.trim()
  const effectiveParsed = usingDefaults ? parsed : appliedParsed

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-space-void/40 p-5">
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-space-stardust">Semantic Search</h2>
              <p className="mt-1 text-sm text-slate-200/70">
                Describe what you want in plain English. The app will interpret your intent into moods, colors, subjects,
                and dates.
              </p>
            </div>
            <button
              type="button"
              onClick={() => applyExample(EXAMPLE_QUERIES[0])}
              className="hidden sm:inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-100/80 hover:bg-white/10"
            >
              Try an example
            </button>
          </div>

          <div className="relative">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label className="text-xs font-medium text-slate-200/75">Natural language query</label>
                <input
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value)
                    setActiveSuggestionIndex(-1)
                  }}
                  onKeyDown={onKeyDown}
                  placeholder="e.g. Show me calming purple nebulae"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-400/70 outline-none focus:border-space-aurora/40 focus:ring-2 focus:ring-space-aurora/20"
                />
                <p className="mt-2 text-[11px] text-slate-200/60">
                  Press Enter to apply. Use ↑/↓ to navigate suggestions.
                </p>
              </div>
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={applyQuery}
                  className="inline-flex items-center justify-center rounded-xl bg-space-aurora/20 px-4 py-3 text-sm font-semibold text-space-aurora ring-1 ring-space-aurora/50 hover:bg-space-aurora/25"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInput('')
                    setAppliedText('')
                    setActiveSuggestionIndex(-1)
                  }}
                  className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-100/80 hover:bg-white/10"
                >
                  Clear
                </button>
              </div>
            </div>

            {suggestions.length > 0 && input.trim().length > 0 ? (
              <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 p-3">
                <div className="text-[11px] font-medium text-slate-200/70">Suggestions</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {suggestions.map((s, idx) => (
                    <button
                      key={`${s}-${idx}`}
                      type="button"
                      onClick={() => {
                        setInput(s)
                        setAppliedText(s)
                        setActiveSuggestionIndex(-1)
                      }}
                      onMouseEnter={() => setActiveSuggestionIndex(idx)}
                      className={[
                        'rounded-full border px-3 py-1 text-[11px] transition',
                        idx === activeSuggestionIndex
                          ? 'border-space-aurora/30 bg-space-aurora/10 text-space-aurora'
                          : 'border-white/10 bg-white/5 text-slate-100/75 hover:bg-white/10',
                      ].join(' ')}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-space-stardust">Interpreted Parameters</h3>
                <div className="text-[11px] text-slate-200/60">
                  {usingDefaults ? 'Live preview' : `Applied: ${appliedText || '—'}`}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {effectiveParsed.moods.length ? badge(`Mood: ${effectiveParsed.moods.join(', ')}`) : badge('Mood: —')}
                {effectiveParsed.palette !== 'any' ? badge(`Palette: ${effectiveParsed.palette}`) : badge('Palette: —')}
                {effectiveParsed.colors.length ? badge(`Colors: ${effectiveParsed.colors.join(', ')}`) : badge('Colors: —')}
                {effectiveParsed.subjectEnabled
                  ? badge(
                      `Subjects: ${Object.entries(effectiveParsed.subjectGroups)
                        .filter(([, v]) => v)
                        .map(([k]) => k)
                        .join(', ')}`
                    )
                  : badge('Subjects: —')}
                {effectiveParsed.dateStart && effectiveParsed.dateEnd
                  ? badge(`Dates: ${effectiveParsed.dateStart} → ${effectiveParsed.dateEnd}`)
                  : badge(`Dates: ${defaultStart} → ${defaultEnd}`)}
                {effectiveParsed.minBrightnessPct > 0
                  ? badge(`Min brightness: ${effectiveParsed.minBrightnessPct}%`)
                  : badge('Min brightness: —')}
                {effectiveParsed.adjectives.length
                  ? badge(`Adjectives: ${effectiveParsed.adjectives.join(', ')}`)
                  : badge('Adjectives: —')}
                {badge(`Sentiment: ${effectiveParsed.sentiment.score}`)}
              </div>

              {effectiveParsed.keywords.length ? (
                <div className="mt-3 text-[11px] text-slate-200/60">
                  Keywords: <span className="text-slate-100/75">{effectiveParsed.keywords.join(', ')}</span>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <h3 className="text-sm font-semibold text-space-stardust">Examples</h3>
              <p className="mt-1 text-xs text-slate-200/65">Click to run a search.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {EXAMPLE_QUERIES.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => applyExample(q)}
                    className="rounded-full border border-white/10 bg-black/15 px-3 py-1 text-[11px] text-slate-100/75 hover:bg-white/10"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <MoodSearch externalQuery={externalQuery} externalQueryKey={externalQueryKey} />
    </section>
  )
}

