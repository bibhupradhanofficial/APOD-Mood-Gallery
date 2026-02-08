import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { fetchAPODRange, queryApodsBySubject } from '../services'

const EXO_CACHE_KEY = 'exoplanets-cache:v2'
const EXO_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_LIMIT = 350

function clampNumber(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

function round(value, digits = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const factor = Math.pow(10, Math.max(0, digits))
  return Math.round(n * factor) / factor
}

function safeText(value) {
  const t = String(value ?? '').trim()
  return t || null
}

function parseYear(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const y = Math.round(n)
  if (y < 1600 || y > 3000) return null
  return y
}

function parseIsoYearMonth(value) {
  const t = safeText(value)
  if (!t) return null
  const match = /^(\d{4})-(\d{2})$/.exec(t)
  if (!match) return null
  const y = parseYear(match[1])
  const m = clampNumber(match[2], 1, 12)
  if (!y) return null
  return { year: y, month: m }
}

function hashUnit(value) {
  const t = String(value ?? '')
  let h = 2166136261
  for (let i = 0; i < t.length; i += 1) {
    h ^= t.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

function formatMaybe(value, unit, digits = 2) {
  const v = round(value, digits)
  if (v === null) return '—'
  return `${v}${unit ? ` ${unit}` : ''}`
}

function parseExoplanetsCache() {
  try {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage?.getItem(EXO_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (!Array.isArray(parsed.items)) return null
    const fetchedAt = Number(parsed.fetchedAt ?? 0)
    if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return null
    const limit = Number(parsed.limit ?? 0)
    return { items: parsed.items, fetchedAt, limit: Number.isFinite(limit) ? limit : null }
  } catch {
    return null
  }
}

function writeExoplanetsCache({ items, fetchedAt, limit }) {
  try {
    if (typeof window === 'undefined') return
    window.localStorage?.setItem(EXO_CACHE_KEY, JSON.stringify({ items, fetchedAt, limit }))
  } catch {
    return
  }
}

function fetchWithTimeout(url, { timeoutMs = 12000, ...options } = {}) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 12000))
  const signal = options.signal
  if (signal && typeof signal.addEventListener === 'function') {
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeoutId))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)))
}

async function fetchJsonWithRetries(url, { timeoutMs = 45000, attempts = 2 } = {}) {
  let lastError
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetchWithTimeout(url, { timeoutMs })
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      return await res.json()
    } catch (error) {
      lastError = error
      const isAbort =
        (error instanceof Error && error.name === 'AbortError') || String(error?.name ?? '').toLowerCase() === 'aborterror'
      if (isAbort && i < attempts - 1) {
        await sleep(300 * Math.pow(2, i))
        continue
      }
      if (i < attempts - 1) {
        await sleep(250 * Math.pow(2, i))
        continue
      }
      throw lastError
    }
  }
  throw lastError ?? new Error('Request failed')
}

function parseNumberOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1]
        if (next === '"') {
          cur += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
      continue
    }

    if (ch === ',') {
      out.push(cur)
      cur = ''
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
}

function estimateStellarLuminosityLog10({ starRadiusSolar, starTeffK } = {}) {
  const r = Number(starRadiusSolar)
  const t = Number(starTeffK)
  if (!Number.isFinite(r) || r <= 0) return null
  if (!Number.isFinite(t) || t <= 0) return null
  const lum = Math.pow(r, 2) * Math.pow(t / 5772, 4)
  if (!Number.isFinite(lum) || lum <= 0) return null
  return Math.log10(lum)
}

function parseExoplanetsEuCsv(text, { limit }) {
  const raw = String(text ?? '')
  const lines = raw.split(/\r?\n/)
  const header = parseCsvLine(lines[0] ?? '')
  const idx = new Map(header.map((h, i) => [String(h).trim(), i]))

  const get = (row, key) => {
    const i = idx.get(key)
    if (typeof i !== 'number') return ''
    return row[i] ?? ''
  }

  const items = []
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line) continue
    const row = parseCsvLine(line)
    const status = safeText(get(row, 'planet_status'))
    if (status && status !== 'Confirmed') continue

    const pl_name = safeText(get(row, 'name'))
    const hostname = safeText(get(row, 'star_name'))
    const disc_year = parseYear(get(row, 'discovered'))
    if (!pl_name || !hostname || !disc_year) continue

    const radiusJup = parseNumberOrNull(get(row, 'radius'))
    const massJup = parseNumberOrNull(get(row, 'mass')) ?? parseNumberOrNull(get(row, 'mass_sini'))
    const starRadiusSolar = parseNumberOrNull(get(row, 'star_radius'))
    const st_teff = parseNumberOrNull(get(row, 'star_teff'))
    const st_lum = estimateStellarLuminosityLog10({ starRadiusSolar, starTeffK: st_teff })

    const pl_rade = radiusJup ? radiusJup * 11.209 : null
    const pl_bmasse = massJup ? massJup * 317.828 : null

    items.push({
      pl_name,
      hostname,
      disc_year,
      disc_pubdate: null,
      discoverymethod: safeText(get(row, 'detection_type')),
      pl_orbper: parseNumberOrNull(get(row, 'orbital_period')),
      pl_orbsmax: parseNumberOrNull(get(row, 'semi_major_axis')),
      pl_rade,
      pl_bmasse,
      pl_eqt: parseNumberOrNull(get(row, 'temp_calculated')),
      st_lum,
      st_teff,
      sy_dist: parseNumberOrNull(get(row, 'star_distance')),
    })
  }

  items.sort((a, b) => {
    const ay = parseYear(a?.disc_year) ?? 0
    const by = parseYear(b?.disc_year) ?? 0
    if (ay !== by) return by - ay
    const an = safeText(a?.pl_name) ?? ''
    const bn = safeText(b?.pl_name) ?? ''
    return an.localeCompare(bn)
  })

  const n = Math.max(20, Math.floor(Number(limit) || DEFAULT_LIMIT))
  return items.slice(0, n)
}

function computeHabitableZoneAu({ st_lum, st_teff } = {}) {
  const lumLog = Number(st_lum)
  const teff = Number(st_teff)
  const lum = Number.isFinite(lumLog) ? Math.pow(10, lumLog) : null

  const innerFactor = Number.isFinite(teff) && teff > 0 ? 1.1 : 1.1
  const outerFactor = Number.isFinite(teff) && teff > 0 ? 0.53 : 0.53

  const resolvedLum = Number.isFinite(lum) && lum > 0 ? lum : 1
  const inner = Math.sqrt(resolvedLum / innerFactor)
  const outer = Math.sqrt(resolvedLum / outerFactor)
  return { inner, outer, lum: resolvedLum }
}

function classifyPlanet({ pl_rade, pl_bmasse } = {}) {
  const r = Number(pl_rade)
  const m = Number(pl_bmasse)
  const radius = Number.isFinite(r) && r > 0 ? r : null
  const mass = Number.isFinite(m) && m > 0 ? m : null

  const density =
    radius && mass
      ? round(mass / Math.pow(radius, 3) * 5.51, 2)
      : null

  let sizeClass = 'Unknown'
  if (radius) {
    if (radius < 1.6) sizeClass = 'Rocky'
    else if (radius < 3.0) sizeClass = 'Sub-Neptune'
    else if (radius < 6.0) sizeClass = 'Neptune-like'
    else sizeClass = 'Gas giant'
  }

  const gravity = radius && mass ? round(mass / Math.pow(radius, 2), 2) : null
  return { radius, mass, density, sizeClass, gravity }
}

function computeHabitabilityScore(planet) {
  const a = Number(planet?.pl_orbsmax)
  const eqt = Number(planet?.pl_eqt)
  const { radius, mass, sizeClass, gravity } = classifyPlanet(planet)

  const semimajor = Number.isFinite(a) && a > 0 ? a : null
  const hz = computeHabitableZoneAu(planet)
  const inHz = semimajor ? semimajor >= hz.inner && semimajor <= hz.outer : null

  let hzScore = 0
  if (semimajor) {
    if (inHz) hzScore = 40
    else {
      const nearest = semimajor < hz.inner ? hz.inner : hz.outer
      const ratio = semimajor > 0 && nearest > 0 ? Math.max(semimajor, nearest) / Math.min(semimajor, nearest) : 2
      hzScore = clampNumber(40 * Math.exp(-Math.pow(Math.log(ratio), 2)), 0, 40)
    }
  }

  let sizeScore = 0
  if (sizeClass === 'Rocky') sizeScore = 25
  else if (sizeClass === 'Sub-Neptune') sizeScore = 14
  else if (sizeClass === 'Neptune-like') sizeScore = 6
  else if (sizeClass === 'Gas giant') sizeScore = 0

  let tempScore = 0
  if (Number.isFinite(eqt) && eqt > 0) {
    if (eqt >= 230 && eqt <= 310) tempScore = 25
    else if (eqt >= 200 && eqt <= 350) tempScore = 15
    else if (eqt >= 150 && eqt <= 500) tempScore = 6
  }

  let atmoScore = 0
  const g = Number(gravity)
  if (Number.isFinite(g) && g > 0) {
    if (g >= 0.6 && g <= 1.8) atmoScore += 10
    else if (g >= 0.35 && g <= 3.0) atmoScore += 6
    else atmoScore += 2
  }

  const isTemperate = Number.isFinite(eqt) ? eqt >= 180 && eqt <= 380 : false
  const isTerrestrial = sizeClass === 'Rocky' || sizeClass === 'Sub-Neptune'
  if (isTerrestrial && isTemperate) atmoScore += 5
  atmoScore = clampNumber(atmoScore, 0, 15)

  const raw = hzScore + sizeScore + tempScore + atmoScore
  const score = clampNumber(raw, 0, 100)

  const atmosphereCandidate =
    Boolean(isTerrestrial) &&
    Boolean(isTemperate) &&
    ((Number.isFinite(g) && g >= 0.35) || (Number.isFinite(mass) && mass >= 0.3))

  return {
    score,
    hz: { ...hz, semimajor, inHz },
    planet: { radius, mass, sizeClass, gravity, density: classifyPlanet(planet).density },
    temperature: Number.isFinite(eqt) && eqt > 0 ? eqt : null,
    atmosphereCandidate,
  }
}

function rangeToBounds(numbers) {
  const list = (Array.isArray(numbers) ? numbers : []).filter((n) => Number.isFinite(n))
  if (list.length === 0) return null
  let min = list[0]
  let max = list[0]
  for (const n of list) {
    if (n < min) min = n
    if (n > max) max = n
  }
  return { min, max }
}

function OrbitDiagram({ systemName, planets, activeName, onSelect }) {
  const [hovered, setHovered] = useState(null)

  const list = useMemo(() => {
    return (Array.isArray(planets) ? planets : [])
      .map((p) => {
        const a = Number(p?.pl_orbsmax)
        return {
          name: safeText(p?.pl_name),
          a: Number.isFinite(a) && a > 0 ? a : null,
          radius: Number(p?.pl_rade),
        }
      })
      .filter((p) => p.name)
  }, [planets])

  const maxA = useMemo(() => {
    const values = list.map((p) => p.a).filter((n) => Number.isFinite(n))
    return values.length ? Math.max(...values) : 1
  }, [list])

  const view = 340
  const center = view / 2
  const baseOrbit = 42
  const orbitSpan = 120
  const scale = maxA > 0 ? orbitSpan / maxA : 1

  const planetsRendered = useMemo(() => {
    return list
      .map((p) => {
        const orbitR = p.a ? baseOrbit + p.a * scale : baseOrbit + orbitSpan * 0.65
        const angle = hashUnit(p.name) * Math.PI * 2
        const x = center + Math.cos(angle) * orbitR
        const y = center + Math.sin(angle) * orbitR
        const isActive = Boolean(activeName) && p.name === activeName
        const isHovered = Boolean(hovered) && p.name === hovered

        const size = clampNumber(Number(p.radius) || 1, 0.6, 14)
        const dotR = clampNumber(2.2 + Math.log10(size + 1) * 2.4, 2, 8)

        return {
          ...p,
          orbitR,
          x,
          y,
          isActive,
          isHovered,
          dotR,
        }
      })
      .sort((a, b) => (a.orbitR > b.orbitR ? 1 : -1))
  }, [activeName, center, hovered, list, scale])

  const orbits = useMemo(() => {
    const distinct = new Map()
    for (const p of planetsRendered) {
      const k = Math.round(p.orbitR * 10) / 10
      if (!distinct.has(k)) distinct.set(k, p.orbitR)
    }
    return Array.from(distinct.values()).sort((a, b) => a - b)
  }, [planetsRendered])

  const label = hovered || activeName || null

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-space-stardust">Orbit diagram</h3>
          <p className="mt-1 text-xs text-slate-200/70">
            {systemName ? `${systemName} system` : 'Exoplanet system'} · {planetsRendered.length} planets
          </p>
        </div>
        <div className="text-right text-xs text-slate-200/70">{label ? label : 'Hover or click a planet'}</div>
      </div>

      <div className="mt-3 flex items-center justify-center">
        <svg
          width={view}
          height={view}
          viewBox={`0 0 ${view} ${view}`}
          className="max-w-full"
          onMouseLeave={() => setHovered(null)}
        >
          <defs>
            <radialGradient id="starGlow" cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor="rgba(34,211,238,0.85)" />
              <stop offset="70%" stopColor="rgba(124,58,237,0.25)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0)" />
            </radialGradient>
          </defs>

          <circle cx={center} cy={center} r={52} fill="url(#starGlow)" />
          <circle cx={center} cy={center} r={6} fill="rgba(226,232,240,0.95)" />

          {orbits.map((r) => (
            <circle key={`orbit-${r}`} cx={center} cy={center} r={r} fill="none" stroke="rgba(255,255,255,0.12)" />
          ))}

          {planetsRendered.map((p) => (
            <g key={p.name}>
              <circle
                cx={p.x}
                cy={p.y}
                r={p.dotR + (p.isActive ? 1.5 : 0)}
                fill={p.isActive ? 'rgba(34,211,238,0.95)' : 'rgba(233,213,255,0.85)'}
                stroke={p.isHovered ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.18)'}
                strokeWidth={p.isHovered ? 2 : 1}
                className="cursor-pointer transition-all"
                onMouseEnter={() => setHovered(p.name)}
                onFocus={() => setHovered(p.name)}
                onClick={() => onSelect?.(p.name)}
              />
            </g>
          ))}
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-200/70">
        <span className="rounded-full bg-white/5 px-3 py-1 ring-1 ring-white/10">Scale: {formatMaybe(maxA, 'AU', 2)} max</span>
        <span className="rounded-full bg-white/5 px-3 py-1 ring-1 ring-white/10">Click a dot to focus</span>
      </div>
    </div>
  )
}

function SizeComparison({ radiusEarths }) {
  const r = Number(radiusEarths)
  const radius = Number.isFinite(r) && r > 0 ? r : null

  const view = 220
  const center = view / 2
  const earthR = 34
  const scaled = radius ? earthR * clampNumber(radius, 0.4, 12) : null

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-space-stardust">Size vs Earth</h3>
          <p className="mt-1 text-xs text-slate-200/70">
            {radius ? `${formatMaybe(radius, 'R⊕', 2)} radius` : 'Radius unknown'}
          </p>
        </div>
        <div className="text-xs text-slate-200/70">Earth baseline</div>
      </div>

      <div className="mt-3 flex items-center justify-center">
        <svg width={view} height={view} viewBox={`0 0 ${view} ${view}`} className="max-w-full">
          <circle cx={center} cy={center} r={earthR} fill="rgba(59,130,246,0.2)" stroke="rgba(59,130,246,0.65)" />
          {scaled ? (
            <circle
              cx={center}
              cy={center}
              r={scaled}
              fill="rgba(34,211,238,0.12)"
              stroke="rgba(34,211,238,0.75)"
            />
          ) : null}
        </svg>
      </div>
    </div>
  )
}

function DistanceScale({ semimajorAu }) {
  const a = Number(semimajorAu)
  const semimajor = Number.isFinite(a) && a > 0 ? a : null

  const width = 360
  const height = 66
  const pad = 18
  const axisW = width - pad * 2
  const max = semimajor ? Math.max(2, semimajor * 1.2) : 5
  const earthAu = 1

  const x = (value) => pad + axisW * clampNumber(value / max, 0, 1)

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-space-stardust">Distance scale</h3>
          <p className="mt-1 text-xs text-slate-200/70">{semimajor ? `${formatMaybe(semimajor, 'AU', 2)} from star` : 'Distance unknown'}</p>
        </div>
        <div className="text-xs text-slate-200/70">Earth = 1 AU</div>
      </div>

      <div className="mt-3 flex items-center justify-center">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="max-w-full">
          <line x1={pad} y1={height / 2} x2={width - pad} y2={height / 2} stroke="rgba(255,255,255,0.18)" />
          <circle cx={pad} cy={height / 2} r={5} fill="rgba(226,232,240,0.9)" />
          <text x={pad} y={height / 2 - 12} fill="rgba(226,232,240,0.75)" fontSize="10" textAnchor="middle">
            Star
          </text>

          <circle cx={x(earthAu)} cy={height / 2} r={5} fill="rgba(59,130,246,0.75)" />
          <text x={x(earthAu)} y={height / 2 + 18} fill="rgba(226,232,240,0.75)" fontSize="10" textAnchor="middle">
            1 AU
          </text>

          {semimajor ? (
            <>
              <circle cx={x(semimajor)} cy={height / 2} r={6} fill="rgba(34,211,238,0.85)" />
              <text x={x(semimajor)} y={height / 2 - 12} fill="rgba(226,232,240,0.9)" fontSize="10" textAnchor="middle">
                Planet
              </text>
            </>
          ) : null}
        </svg>
      </div>
    </div>
  )
}

function HabitabilityBadge({ score }) {
  const s = clampNumber(score, 0, 100)
  const label = s >= 80 ? 'High' : s >= 60 ? 'Promising' : s >= 35 ? 'Low' : 'Unlikely'
  const klass =
    s >= 80
      ? 'bg-emerald-500/15 text-emerald-100 ring-emerald-400/30'
      : s >= 60
        ? 'bg-sky-500/15 text-sky-100 ring-sky-400/30'
        : s >= 35
          ? 'bg-amber-500/15 text-amber-100 ring-amber-400/30'
          : 'bg-rose-500/15 text-rose-100 ring-rose-400/30'

  return (
    <span className={['inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ring-1', klass].join(' ')}>
      <span className="font-semibold tabular-nums">{Math.round(s)}</span>
      <span className="opacity-80">Habitability</span>
      <span className="opacity-80">·</span>
      <span className="font-medium">{label}</span>
    </span>
  )
}

function normalizeApodText(apod) {
  const title = String(apod?.title ?? '').toLowerCase()
  const explanation = String(apod?.explanation ?? '').toLowerCase()
  return `${title} ${explanation}`.trim()
}

function scoreApodRelevance(apod, { hostStar, planetName } = {}) {
  const text = normalizeApodText(apod)
  if (!text) return 0

  let score = 0
  const bumps = [
    { re: /\bexoplanet(s)?\b/, w: 6 },
    { re: /\bkepler\b/, w: 4 },
    { re: /\btess\b/, w: 4 },
    { re: /\btransit(s|ing)?\b/, w: 3 },
    { re: /\bplanet(s)?\b/, w: 2 },
    { re: /\bhabitable\b/, w: 3 },
  ]
  for (const b of bumps) if (b.re.test(text)) score += b.w

  const host = safeText(hostStar)?.toLowerCase()
  const planet = safeText(planetName)?.toLowerCase()
  if (host && host.length >= 4 && text.includes(host)) score += 5
  if (planet && planet.length >= 4 && text.includes(planet)) score += 6

  return score
}

export default function ExoplanetExplorer() {
  const [limit, setLimit] = useState(DEFAULT_LIMIT)
  const [status, setStatus] = useState({ loading: false, error: '' })
  const [planets, setPlanets] = useState([])

  const [query, setQuery] = useState('')
  const [method, setMethod] = useState('any')
  const [minHabitability, setMinHabitability] = useState(55)
  const [maxDistanceLy, setMaxDistanceLy] = useState(600)
  const [yearRange, setYearRange] = useState({ min: null, max: null })
  const [yearFilter, setYearFilter] = useState({ min: null, max: null })

  const [activePlanetName, setActivePlanetName] = useState(null)

  const [relatedApods, setRelatedApods] = useState([])
  const [apodHint, setApodHint] = useState('')
  const [apodStatus, setApodStatus] = useState({ loading: false, error: '' })
  const lastApodKeyRef = useRef('')

  const derived = useMemo(() => {
    const list = (Array.isArray(planets) ? planets : []).map((p) => ({
      ...p,
      __habitability: computeHabitabilityScore(p),
    }))
    return list
  }, [planets])

  const years = useMemo(() => {
    return derived.map((p) => parseYear(p?.disc_year)).filter(Boolean)
  }, [derived])

  useEffect(() => {
    const bounds = rangeToBounds(years)
    if (!bounds) return
    const min = Math.round(bounds.min)
    const max = Math.round(bounds.max)
    setYearRange({ min, max })
    setYearFilter((prev) => ({
      min: prev.min ?? min,
      max: prev.max ?? max,
    }))
  }, [years])

  const methods = useMemo(() => {
    const set = new Set()
    for (const p of derived) {
      const m = safeText(p?.discoverymethod)
      if (m) set.add(m)
    }
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b))
  }, [derived])

  const activePlanet = useMemo(() => {
    if (!activePlanetName) return null
    return derived.find((p) => safeText(p?.pl_name) === activePlanetName) ?? null
  }, [activePlanetName, derived])

  const systemPlanets = useMemo(() => {
    const host = safeText(activePlanet?.hostname)
    if (!host) return []
    return derived.filter((p) => safeText(p?.hostname) === host)
  }, [activePlanet, derived])

  const filtered = useMemo(() => {
    const q = String(query ?? '').trim().toLowerCase()
    const wantMethod = method === 'any' ? null : method
    const minScore = clampNumber(minHabitability, 0, 100)
    const maxLy = clampNumber(maxDistanceLy, 1, 50000)
    const minYear = parseYear(yearFilter?.min) ?? null
    const maxYear = parseYear(yearFilter?.max) ?? null

    const out = []
    for (const p of derived) {
      const name = safeText(p?.pl_name) ?? ''
      const host = safeText(p?.hostname) ?? ''
      const discMethod = safeText(p?.discoverymethod) ?? ''

      if (q) {
        const text = `${name} ${host} ${discMethod}`.toLowerCase()
        if (!text.includes(q)) continue
      }

      if (wantMethod && discMethod !== wantMethod) continue

      const score = Number(p?.__habitability?.score ?? 0)
      if (score < minScore) continue

      const distPc = Number(p?.sy_dist)
      const distLy = Number.isFinite(distPc) && distPc > 0 ? distPc * 3.26156 : null
      if (distLy !== null && distLy > maxLy) continue

      const y = parseYear(p?.disc_year)
      if (minYear !== null && y !== null && y < minYear) continue
      if (maxYear !== null && y !== null && y > maxYear) continue

      out.push({ ...p, __distanceLy: distLy })
    }

    out.sort((a, b) => Number(b.__habitability.score) - Number(a.__habitability.score))
    return out
  }, [derived, maxDistanceLy, method, minHabitability, query, yearFilter])

  useEffect(() => {
    if (!activePlanetName && filtered.length) setActivePlanetName(safeText(filtered[0]?.pl_name))
  }, [activePlanetName, filtered])

  const loadExoplanets = useCallback(
    async ({ force = false } = {}) => {
      setStatus({ loading: true, error: '' })

      try {
        const cached = parseExoplanetsCache()
        const cachedFresh =
          cached &&
          Array.isArray(cached.items) &&
          cached.items.length > 0 &&
          Number.isFinite(cached.fetchedAt) &&
          Date.now() - cached.fetchedAt < EXO_CACHE_TTL_MS &&
          (cached.limit === null || cached.limit >= limit)

        if (cachedFresh && !force) {
          setPlanets(cached.items)
          setStatus({ loading: false, error: '' })
          return
        }

        const sql = [
          `select top ${Math.max(20, Math.floor(limit))}`,
          'pl_name, hostname, disc_year, disc_pubdate, discoverymethod,',
          'pl_orbper, pl_orbsmax, pl_rade, pl_bmasse, pl_eqt,',
          'st_lum, st_teff, sy_dist',
          'from pscomppars',
          'order by disc_year desc, pl_name asc',
        ].join(' ')

        let items = []
        try {
          const url = `/api/exoplanets-archive/TAP/sync?query=${encodeURIComponent(sql)}&format=json`
          const json = await fetchJsonWithRetries(url, { timeoutMs: 120000, attempts: 2 })
          items = Array.isArray(json) ? json : []
        } catch {
          const res = await fetchWithTimeout('/api/exoplanets-eu/catalog/csv/', {
            timeoutMs: 60000,
            headers: { accept: 'text/csv' },
          })
          if (!res.ok) throw new Error(`Exoplanet dataset error (${res.status})`)
          const text = await res.text()
          items = parseExoplanetsEuCsv(text, { limit })
        }

        setPlanets(items)
        writeExoplanetsCache({ items, fetchedAt: Date.now(), limit })
        setStatus({ loading: false, error: '' })
      } catch (e) {
        const isAbort =
          (e instanceof Error && e.name === 'AbortError') || String(e?.name ?? '').toLowerCase() === 'aborterror'
        setStatus({
          loading: false,
          error: isAbort ? 'Exoplanet request timed out. Please try again.' : e?.message ? String(e.message) : 'Failed to load exoplanets.',
        })
      }
    },
    [limit],
  )

  useEffect(() => {
    void loadExoplanets({ force: false })
  }, [loadExoplanets])

  const resetFilters = useCallback(() => {
    setQuery('')
    setMethod('any')
    setMinHabitability(55)
    setMaxDistanceLy(600)
    setYearFilter({ min: yearRange.min, max: yearRange.max })
  }, [yearRange.max, yearRange.min])

  const loadRelatedApods = useCallback(async () => {
    const exo = activePlanet
    const name = safeText(exo?.pl_name)
    const host = safeText(exo?.hostname)
    const year = parseYear(exo?.disc_year)
    if (!exo || !year) {
      setRelatedApods([])
      setApodHint('')
      setApodStatus({ loading: false, error: '' })
      lastApodKeyRef.current = ''
      return
    }

    const key = `${name ?? ''}|${host ?? ''}|${year}`
    if (lastApodKeyRef.current === key) return
    lastApodKeyRef.current = key
    setApodStatus({ loading: true, error: '' })

    try {
      const pub = parseIsoYearMonth(exo?.disc_pubdate)
      const startMonth = pub ? pub.month : 6
      const start = `${year}-${String(startMonth).padStart(2, '0')}-01`
      const endMonth = clampNumber(startMonth + 2, 1, 12)
      const end = `${year}-${String(endMonth).padStart(2, '0')}-28`

      const [planetsBySubject, starsBySubject, range] = await Promise.all([
        queryApodsBySubject('planets', { limit: 60 }).catch(() => []),
        queryApodsBySubject('stars', { limit: 60 }).catch(() => []),
        fetchAPODRange(start, end).catch(() => []),
      ])

      const rangeList = Array.isArray(range) ? range : []
      const combined = [...rangeList, ...(Array.isArray(planetsBySubject) ? planetsBySubject : []), ...(Array.isArray(starsBySubject) ? starsBySubject : [])]
      const byKey = new Map()
      for (const apod of combined) {
        const k = String(apod?.date ?? '').trim() || String(apod?.url ?? '').trim()
        if (!k || byKey.has(k)) continue
        byKey.set(k, apod)
      }

      const scored = Array.from(byKey.values())
        .map((apod) => ({ apod, s: scoreApodRelevance(apod, { hostStar: host, planetName: name }) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 8)
        .map((x) => x.apod)

      if (scored.length > 0) {
        setRelatedApods(scored)
        setApodHint('Keyword matches')
      } else {
        setRelatedApods(rangeList.slice(0, 8))
        setApodHint('Around discovery window')
      }
      setApodStatus({ loading: false, error: '' })
    } catch (e) {
      setRelatedApods([])
      setApodHint('')
      setApodStatus({
        loading: false,
        error: e?.message ? String(e.message) : 'Failed to load related APOD images.',
      })
    }
  }, [activePlanet])

  useEffect(() => {
    void loadRelatedApods()
  }, [loadRelatedApods])

  const details = useMemo(() => {
    if (!activePlanet) return null
    const h = activePlanet.__habitability
    const distLy = Number.isFinite(activePlanet?.sy_dist) ? Number(activePlanet.sy_dist) * 3.26156 : null
    return {
      name: safeText(activePlanet?.pl_name),
      host: safeText(activePlanet?.hostname),
      discoveryYear: parseYear(activePlanet?.disc_year),
      discoveryMethod: safeText(activePlanet?.discoverymethod),
      orbitalPeriodDays: Number(activePlanet?.pl_orbper),
      semimajorAu: Number(activePlanet?.pl_orbsmax),
      radiusEarths: h?.planet?.radius ?? null,
      massEarths: h?.planet?.mass ?? null,
      eqTempK: h?.temperature ?? null,
      distLy,
      sizeClass: h?.planet?.sizeClass ?? 'Unknown',
      density: h?.planet?.density ?? null,
      gravity: h?.planet?.gravity ?? null,
      hz: h?.hz ?? null,
      atmosphereCandidate: Boolean(h?.atmosphereCandidate),
      habitabilityScore: h?.score ?? 0,
    }
  }, [activePlanet])

  return (
    <section className="rounded-3xl border border-white/10 bg-space-void/50 p-6 backdrop-blur">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-space-stardust">Exoplanet Explorer</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-200/70">
            Browse confirmed planets from the NASA Exoplanet Archive, filter by discovery and habitability, and connect discoveries to APOD imagery.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => loadExoplanets({ force: true })}
            className="rounded-full bg-white/5 px-4 py-2 text-xs font-medium text-slate-100 ring-1 ring-white/10 hover:bg-white/10"
          >
            Refresh
          </button>
          <button
            onClick={resetFilters}
            className="rounded-full bg-white/5 px-4 py-2 text-xs font-medium text-slate-100 ring-1 ring-white/10 hover:bg-white/10"
          >
            Reset filters
          </button>
        </div>
      </div>

      {status.error ? (
        <div className="mt-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">
          {status.error}
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold text-space-stardust">Filters</h3>
              <div className="text-xs text-slate-200/70">
                {status.loading ? 'Loading…' : `${filtered.length} / ${derived.length}`}
              </div>
            </div>

            <div className="mt-3 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-200/80">Search</label>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Planet, host star, method…"
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-space-aurora/50"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-200/80">Discovery method</label>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-space-aurora/50"
                  >
                    <option value="any">Any</option>
                    {methods.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-200/80">Max distance (ly)</label>
                  <input
                    type="number"
                    min={1}
                    max={50000}
                    value={maxDistanceLy}
                    onChange={(e) => setMaxDistanceLy(clampNumber(e.target.value, 1, 50000))}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-space-aurora/50"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-medium text-slate-200/80">Min habitability score</label>
                  <span className="text-xs text-slate-200/70 tabular-nums">{Math.round(minHabitability)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={minHabitability}
                  onChange={(e) => setMinHabitability(clampNumber(e.target.value, 0, 100))}
                  className="mt-1 w-full accent-space-aurora"
                />
              </div>

              {yearRange.min !== null && yearRange.max !== null ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-200/80">From year</label>
                    <input
                      type="number"
                      min={yearRange.min}
                      max={yearRange.max}
                      value={yearFilter.min ?? yearRange.min}
                      onChange={(e) => setYearFilter((prev) => ({ ...prev, min: clampNumber(e.target.value, yearRange.min, yearRange.max) }))}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-space-aurora/50"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-200/80">To year</label>
                    <input
                      type="number"
                      min={yearRange.min}
                      max={yearRange.max}
                      value={yearFilter.max ?? yearRange.max}
                      onChange={(e) => setYearFilter((prev) => ({ ...prev, max: clampNumber(e.target.value, yearRange.min, yearRange.max) }))}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-space-aurora/50"
                    />
                  </div>
                </div>
              ) : null}

              <div>
                <label className="text-xs font-medium text-slate-200/80">Loaded rows</label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="number"
                    min={50}
                    max={5000}
                    value={limit}
                    onChange={(e) => setLimit(clampNumber(e.target.value, 50, 5000))}
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-space-aurora/50"
                  />
                  <button
                    onClick={() => loadExoplanets({ force: true })}
                    className="shrink-0 rounded-xl bg-space-aurora/15 px-3 py-2 text-xs font-semibold text-space-stardust ring-1 ring-space-aurora/30 hover:bg-space-aurora/20"
                  >
                    Load
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <h3 className="text-sm font-semibold text-space-stardust">Results</h3>
              <span className="text-xs text-slate-200/70">{filtered.length}</span>
            </div>
            <div className="max-h-[520px] overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <div className="p-4 text-sm text-slate-200/70">No matches. Try lowering the habitability threshold.</div>
              ) : (
                filtered.slice(0, 240).map((p) => {
                  const name = safeText(p?.pl_name)
                  const host = safeText(p?.hostname)
                  const methodText = safeText(p?.discoverymethod)
                  const year = parseYear(p?.disc_year)
                  const active = Boolean(activePlanetName) && name === activePlanetName
                  const score = Number(p?.__habitability?.score ?? 0)
                  const distLy = p.__distanceLy
                  return (
                    <button
                      key={name ?? `${host}-${year}-${Math.random()}`}
                      onClick={() => setActivePlanetName(name)}
                      className={[
                        'w-full rounded-2xl px-3 py-3 text-left ring-1 transition-colors',
                        active ? 'bg-space-aurora/10 ring-space-aurora/30' : 'bg-white/0 ring-white/10 hover:bg-white/5',
                      ].join(' ')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-100">{name ?? 'Unknown planet'}</div>
                          <div className="mt-1 truncate text-xs text-slate-200/70">
                            {host ? host : 'Unknown host'}
                            {year ? ` · ${year}` : ''}
                            {methodText ? ` · ${methodText}` : ''}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-xs font-semibold text-space-stardust tabular-nums">{Math.round(score)}</div>
                          <div className="mt-1 text-[11px] text-slate-200/60">{distLy ? `${Math.round(distLy)} ly` : '—'}</div>
                        </div>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {details ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-lg font-semibold text-space-stardust">{details.name ?? 'Planet'}</h3>
                    <HabitabilityBadge score={details.habitabilityScore} />
                  </div>
                  <div className="mt-1 text-sm text-slate-200/70">
                    {details.host ? `Host: ${details.host}` : 'Host unknown'}
                    {details.discoveryYear ? ` · Discovered: ${details.discoveryYear}` : ''}
                    {details.discoveryMethod ? ` · ${details.discoveryMethod}` : ''}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-200/70">
                  <span className="rounded-full bg-white/5 px-3 py-1 ring-1 ring-white/10">
                    {details.distLy ? `${Math.round(details.distLy)} ly away` : 'Distance unknown'}
                  </span>
                  <span className="rounded-full bg-white/5 px-3 py-1 ring-1 ring-white/10">{details.sizeClass}</span>
                  {details.atmosphereCandidate ? (
                    <span className="rounded-full bg-space-aurora/15 px-3 py-1 text-slate-100 ring-1 ring-space-aurora/30">
                      Atmosphere candidate
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                  <div className="text-[11px] text-slate-200/60">Orbital period</div>
                  <div className="mt-2 text-sm font-semibold text-slate-100">
                    {formatMaybe(details.orbitalPeriodDays, 'days', 1)}
                  </div>
                </div>
                <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                  <div className="text-[11px] text-slate-200/60">Distance from star</div>
                  <div className="mt-2 text-sm font-semibold text-slate-100">{formatMaybe(details.semimajorAu, 'AU', 3)}</div>
                </div>
                <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                  <div className="text-[11px] text-slate-200/60">Radius</div>
                  <div className="mt-2 text-sm font-semibold text-slate-100">{formatMaybe(details.radiusEarths, 'R⊕', 2)}</div>
                </div>
                <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                  <div className="text-[11px] text-slate-200/60">Mass</div>
                  <div className="mt-2 text-sm font-semibold text-slate-100">{formatMaybe(details.massEarths, 'M⊕', 2)}</div>
                </div>
                <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                  <div className="text-[11px] text-slate-200/60">Equilibrium temp</div>
                  <div className="mt-2 text-sm font-semibold text-slate-100">{formatMaybe(details.eqTempK, 'K', 0)}</div>
                </div>
                <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                  <div className="text-[11px] text-slate-200/60">Density</div>
                  <div className="mt-2 text-sm font-semibold text-slate-100">
                    {details.density ? `${details.density} g/cc` : '—'}
                  </div>
                </div>
                <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                  <div className="text-[11px] text-slate-200/60">Surface gravity</div>
                  <div className="mt-2 text-sm font-semibold text-slate-100">
                    {details.gravity ? `${details.gravity} g⊕` : '—'}
                  </div>
                </div>
                <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                  <div className="text-[11px] text-slate-200/60">Habitable zone</div>
                  <div className="mt-2 text-sm font-semibold text-slate-100">
                    {details.hz?.inner && details.hz?.outer ? `${round(details.hz.inner, 2)}–${round(details.hz.outer, 2)} AU` : '—'}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-slate-200/70">
              Select an exoplanet to see details.
            </div>
          )}

          {activePlanet ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <OrbitDiagram
                systemName={safeText(activePlanet?.hostname)}
                planets={systemPlanets}
                activeName={safeText(activePlanet?.pl_name)}
                onSelect={(name) => setActivePlanetName(name)}
              />
              <SizeComparison radiusEarths={details?.radiusEarths ?? null} />
              <DistanceScale semimajorAu={details?.semimajorAu ?? null} />
            </div>
          ) : null}

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-space-stardust">Related APOD images</h3>
                <p className="mt-1 text-xs text-slate-200/70">
                  Matches by year window, subjects, and text relevance (exoplanet/planet/transit keywords).
                </p>
              </div>
              <div className="text-xs text-slate-200/70">{apodStatus.loading ? 'Loading…' : apodHint || ''}</div>
            </div>

            {apodStatus.error ? (
              <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-100">
                {apodStatus.error}
              </div>
            ) : null}

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {relatedApods.length === 0 && !apodStatus.loading ? (
                <div className="col-span-full text-sm text-slate-200/70">No relevant APOD matches found for this planet yet.</div>
              ) : null}

              {relatedApods.map((apod) => {
                const date = safeText(apod?.date) ?? 'APOD'
                const title = safeText(apod?.title) ?? 'Untitled'
                const src = safeText(apod?.url) ?? safeText(apod?.hdurl)
                if (!src) return null
                return (
                  <a
                    key={`${date}-${src}`}
                    href={src}
                    target="_blank"
                    rel="noreferrer"
                    className="group overflow-hidden rounded-2xl border border-white/10 bg-black/20 hover:bg-white/5"
                  >
                    <div className="aspect-[4/3] overflow-hidden bg-black/30">
                      <img src={src} alt={title} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                    </div>
                    <div className="p-3">
                      <div className="text-xs text-slate-200/60">{date}</div>
                      <div className="mt-1 line-clamp-2 text-sm font-semibold text-slate-100">{title}</div>
                    </div>
                  </a>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
