import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, isValid, parseISO, subDays } from 'date-fns'

import { analyzeImage, fetchAPODRange, preferenceLearner } from '../services'
import SpaceGuideAgent from './SpaceGuideAgent'
import {
  copyToClipboard,
  downloadApodImage,
  formatApodAttribution,
  generateApodImageEmbedCode,
  getApodImageUrl,
  getSocialShareLinks,
} from '../utils'
import WhereArePlanetsNow from './WhereArePlanetsNow'

const FAVORITES_KEY = 'apod-favorites:v1'
const PAGE_WINDOW_DAYS = 35
const PAGE_TARGET_COUNT = 16
const SKELETON_COUNT = 12

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

function formatDateStamp(dateString) {
  const date = safeParseDate(dateString)
  if (!date) return '—'
  return format(date, 'MMM d, yyyy')
}

function normalizeFavoriteKey(item) {
  if (!item) return null
  if (item.date) return `date:${item.date}`
  if (item.url) return `url:${item.url}`
  return null
}

function readFavorites() {
  try {
    if (typeof window === 'undefined') return new Set()
    const raw = window.localStorage?.getItem(FAVORITES_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter(Boolean))
  } catch {
    return new Set()
  }
}

function writeFavorites(favorites) {
  try {
    if (typeof window === 'undefined') return
    window.localStorage?.setItem(FAVORITES_KEY, JSON.stringify([...favorites]))
  } catch {
    return
  }
}

function computeMoodTagsFromMetadata(item) {
  const text = `${item?.title ?? ''} ${item?.explanation ?? ''}`.toLowerCase()
  const tags = []

  if (/(nebula|aurora|milky way|andromeda|galaxy|cluster)/.test(text)) {
    tags.push('Awe')
  }
  if (/(moon|lunar|eclipse|night|dark|shadow|noir)/.test(text)) {
    tags.push('Mystery')
  }
  if (/(earth|ocean|cloud|horizon|calm|quiet|serene)/.test(text)) {
    tags.push('Calm')
  }
  if (/(comet|meteor|rocket|launch|iss|station)/.test(text)) {
    tags.push('Adventure')
  }
  if (/(sun|solar|flare|fire|storm|eruption)/.test(text)) {
    tags.push('Energy')
  }

  if (tags.length === 0) tags.push('Wonder')
  return tags.slice(0, 3)
}

function moodBadgeClass(mood) {
  const key = String(mood ?? '').toLowerCase()
  if (key.includes('awe')) return 'bg-fuchsia-500/15 text-fuchsia-200 ring-fuchsia-400/30'
  if (key.includes('myst')) return 'bg-indigo-500/15 text-indigo-200 ring-indigo-400/30'
  if (key.includes('calm')) return 'bg-sky-500/15 text-sky-200 ring-sky-400/30'
  if (key.includes('adven')) return 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30'
  if (key.includes('energ')) return 'bg-orange-500/15 text-orange-200 ring-orange-400/30'
  return 'bg-white/10 text-slate-200 ring-white/20'
}

function deriveMoodBreakdown(analysisData) {
  if (!analysisData || !analysisData.moodScores) return []
  
  const scores = analysisData.moodScores
  const mapping = [
    { label: 'Calming', className: 'bg-sky-400' },
    { label: 'Energizing', className: 'bg-orange-400' },
    { label: 'Mysterious', className: 'bg-indigo-400' },
    { label: 'Inspiring', className: 'bg-emerald-400' },
    { label: 'Cosmic', className: 'bg-fuchsia-400' },
  ]

  return mapping.map(m => ({
    ...m,
    value: scores[m.label] || 0
  })).sort((a, b) => b.value - a.value)
}

function HeartIcon({ filled, className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      className={className}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.995 20.12s-7.94-4.97-9.46-9.38C1.44 7.36 3.64 4.5 6.8 4.5c1.75 0 3.33.86 4.2 2.2.87-1.34 2.45-2.2 4.2-2.2 3.16 0 5.36 2.86 4.26 6.24-1.52 4.41-9.46 9.38-9.46 9.38Z"
      />
    </svg>
  )
}

function CloseIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

function ShareIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 8a3 3 0 1 0-2.83-4H12a3 3 0 0 0 3 3ZM6 14a3 3 0 1 0 2.83 4H9a3 3 0 0 0-3-3Zm12 0a3 3 0 1 0-2.83 4H15a3 3 0 0 0 3-3Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.9 15.2 15.1 18.8M15.1 5.2 8.9 8.8" />
    </svg>
  )
}

function DownloadIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0 4-4m-4 4-4-4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 17v3h16v-3" />
    </svg>
  )
}

const CardSkeleton = memo(function CardSkeleton({ variant = 0 }) {
  const height = 220 + (Number(variant) % 6) * 26
  return (
    <div
      className="mb-4 w-full overflow-hidden glass-card"
      style={{ breakInside: 'avoid' }}
    >
      <div className="relative w-full animate-pulse" style={{ height }}>
        <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-white/5" />
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/40 to-transparent" />
        <div className="absolute bottom-4 left-4 right-4 space-y-2">
          <div className="h-4 w-2/3 rounded bg-white/5" />
          <div className="flex gap-2">
            <div className="h-5 w-14 rounded-full bg-white/5" />
            <div className="h-5 w-12 rounded-full bg-white/5" />
          </div>
        </div>
      </div>
    </div>
  )
})

const ApodCard = memo(function ApodCard({ item, moods, isFavorite, onToggleFavorite, onOpen }) {
  const [loaded, setLoaded] = useState(false)
  const title = item?.title ?? 'Untitled'
  const dateStamp = formatDateStamp(item?.date)

  return (
    <article
      className="group relative mb-4 w-full overflow-hidden glass-card glass-card-hover animate-in fade-in zoom-in-95 duration-500"
      style={{ breakInside: 'avoid' }}
    >
      <button type="button" className="block w-full text-left" onClick={onOpen}>
        <div className="relative w-full overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60 opacity-70 transition-opacity duration-300 lg:opacity-0 lg:group-hover:opacity-70" />
          {!loaded ? <div className="absolute inset-0 animate-pulse bg-white/5" /> : null}
          <img
            src={item?.url ?? ''}
            alt={title}
            loading="lazy"
            decoding="async"
            className={[
              'w-full select-none object-cover transition duration-300',
              loaded ? 'opacity-100' : 'opacity-0',
              'group-hover:scale-[1.01]',
            ].join(' ')}
            onLoad={() => setLoaded(true)}
          />

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-4 transition-opacity duration-300 lg:opacity-0 lg:group-hover:opacity-100">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-200/85">
                  <span className="rounded-full bg-black/35 px-2 py-1 ring-1 ring-white/10">
                    {dateStamp}
                  </span>
                </div>
                  <h3 className="mt-3 truncate text-sm font-semibold text-space-stardust">
                    {title}
                  </h3>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {moods.map((mood) => (
                <span
                  key={mood}
                  className={[
                    'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1',
                    moodBadgeClass(mood),
                  ].join(' ')}
                >
                  {mood}
                </span>
              ))}
            </div>
          </div>
        </div>
      </button>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between p-3">
        <div className="flex items-center gap-2 opacity-0 transition group-hover:opacity-100">
          <span className="rounded-full bg-black/40 px-2 py-1 text-[11px] text-slate-200/80 ring-1 ring-white/10">
            View
          </span>
        </div>
        <button
          type="button"
          className={[
            'pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full',
            'bg-black/40 text-slate-100 ring-1 ring-white/10 backdrop-blur transition',
            'hover:bg-black/55 hover:ring-white/20',
          ].join(' ')}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onToggleFavorite()
          }}
          aria-label={isFavorite ? 'Remove from favorites' : 'Save to favorites'}
        >
          <HeartIcon filled={isFavorite} className="h-5 w-5" />
        </button>
      </div>
    </article>
  )
})

function Modal({ item, onClose, isFavorite, onToggleFavorite }) {
  const [analysisState, setAnalysisState] = useState(() => ({
    status: 'loading',
    data: null,
    error: null,
  }))
  const [shareVariant, setShareVariant] = useState('hd')
  const [shareNotice, setShareNotice] = useState(null)
  const panelRef = useRef(null)
  const analysisDataRef = useRef(null)

  useEffect(() => {
    analysisDataRef.current = analysisState.data
  }, [analysisState.data])

  useEffect(() => {
    const start = Date.now()
    return () => {
      const duration = Date.now() - start
      preferenceLearner.recordView({
        item,
        features: analysisDataRef.current,
        durationMs: duration,
      })
    }
  }, [item])

  const hdSrc = item?.hdurl ?? item?.url ?? ''
  const title = item?.title ?? 'Untitled'
  const dateStamp = formatDateStamp(item?.date)
  const explanation = item?.explanation ?? ''
  const attribution = useMemo(() => formatApodAttribution(item), [item])
  const shareUrl = useMemo(() => getApodImageUrl(item, shareVariant) ?? hdSrc, [item, shareVariant, hdSrc])
  const socialLinks = useMemo(() => {
    return getSocialShareLinks({
      url: shareUrl,
      title,
      description: attribution,
      image: getApodImageUrl(item, 'thumbnail') ?? getApodImageUrl(item, 'original') ?? shareUrl,
    })
  }, [shareUrl, title, attribution, item])
  const moodBreakdown = useMemo(() => {
    if (!analysisState.data) return null
    return deriveMoodBreakdown(analysisState.data, item)
  }, [analysisState.data, item])

  useEffect(() => {
    let cancelled = false

    analyzeImage(hdSrc, { cacheKey: hdSrc })
      .then((data) => {
        if (cancelled) return
        setAnalysisState({ status: 'ready', data, error: null })
      })
      .catch((error) => {
        if (cancelled) return
        setAnalysisState({ status: 'error', data: null, error })
      })

    return () => {
      cancelled = true
    }
  }, [hdSrc])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus?.()

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  const handleShare = useCallback(async () => {
    const url = shareUrl
    const shareText = attribution || (explanation ? explanation.slice(0, 180) : title)
    try {
      if (navigator.share) {
        await navigator.share({ title, text: shareText, url })
        setShareNotice('Shared.')
        return
      }
    } catch {
      return
    }

    const ok = await copyToClipboard(url)
    setShareNotice(ok ? 'Link copied.' : 'Copy failed.')
  }, [attribution, explanation, shareUrl, title])

  const handleDownload = useCallback(async () => {
    try {
      await downloadApodImage(item, shareVariant)
      setShareNotice('Download started.')
    } catch {
      setShareNotice('Download failed.')
    }
  }, [item, shareVariant])

  const copyEmbed = useCallback(async () => {
    const code = generateApodImageEmbedCode(item, { variant: shareVariant })
    const ok = await copyToClipboard(code)
    setShareNotice(ok ? 'Embed code copied.' : 'Copy failed.')
  }, [item, shareVariant])

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-6 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative max-h-full w-full max-w-6xl overflow-hidden glass-card shadow-2xl shadow-black/80 outline-none animate-in fade-in zoom-in-95 duration-500"
      >
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-200/75">
              <span className="rounded-full bg-white/5 px-2 py-1 ring-1 ring-white/10">{dateStamp}</span>
              {item?.copyright ? (
                <span className="rounded-full bg-white/5 px-2 py-1 ring-1 ring-white/10">
                  © {item.copyright}
                </span>
              ) : null}
            </div>
            <h2 className="mt-2 truncate text-base font-semibold text-space-stardust">{title}</h2>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-sm text-slate-100 ring-1 ring-white/10 transition hover:bg-white/10 hover:ring-white/20"
              onClick={onToggleFavorite}
            >
              <HeartIcon filled={isFavorite} className="h-5 w-5" />
              <span>{isFavorite ? 'Saved' : 'Save'}</span>
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-sm text-slate-100 ring-1 ring-white/10 transition hover:bg-white/10 hover:ring-white/20"
              onClick={handleShare}
            >
              <ShareIcon className="h-5 w-5" />
              <span>Share</span>
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-sm text-slate-100 ring-1 ring-white/10 transition hover:bg-white/10 hover:ring-white/20"
              onClick={handleDownload}
            >
              <DownloadIcon className="h-5 w-5" />
              <span>Download</span>
            </button>
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-slate-100 ring-1 ring-white/10 transition hover:bg-white/10 hover:ring-white/20"
              onClick={onClose}
              aria-label="Close modal"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="grid max-h-[calc(100vh-8rem)] grid-cols-1 gap-0 overflow-y-auto lg:grid-cols-2">
          <div className="relative bg-black/20">
            <img src={hdSrc} alt={title} className="h-full w-full object-contain" />
          </div>

          <div className="p-6 overflow-y-auto max-h-full">
            <div className="glass-card bg-white/[0.02] p-5 mb-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-space-stardust">Share & download</h3>
                {shareNotice ? <span className="text-xs text-slate-200/60">{shareNotice}</span> : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  value={shareVariant}
                  onChange={(event) => setShareVariant(event.target.value)}
                  className="rounded-xl border border-white/10 bg-space-void/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-white/25"
                >
                  <option value="original">Original</option>
                  <option value="hd">HD</option>
                  <option value="thumbnail">Thumbnail</option>
                </select>
                <button
                  type="button"
                  onClick={handleShare}
                  className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10"
                >
                  Copy link
                </button>
                <button
                  type="button"
                  onClick={copyEmbed}
                  className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10"
                >
                  Copy embed
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10"
                >
                  Download
                </button>
              </div>
              <div className="mt-3 flex gap-2">
                <a
                  href={socialLinks.twitter}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 text-center py-2 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10"
                >
                  Twitter
                </a>
                <a
                  href={socialLinks.pinterest}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 text-center py-2 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10"
                >
                  Pinterest
                </a>
                <a
                  href={socialLinks.reddit}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 text-center py-2 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10"
                >
                  Reddit
                </a>
              </div>
              <div className="mt-3 text-xs text-slate-200/60">
                {attribution || 'Credits: NASA/APOD; additional rights retained by original copyright holders'}
              </div>
            </div>

            <h3 className="text-sm font-semibold text-space-stardust">Description</h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-200/80">{explanation || '—'}</p>

            <SpaceGuideAgent apod={item} />

            <div className="mt-8">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-space-stardust">Mood breakdown</h3>
                {analysisState.status === 'loading' ? (
                  <span className="text-xs text-slate-200/60">Analyzing…</span>
                ) : null}
              </div>

              {analysisState.status === 'error' ? (
                <p className="mt-3 text-sm text-rose-200/80">
                  Unable to analyze this image right now.
                </p>
              ) : null}

              {analysisState.status === 'loading' ? (
                <div className="mt-4 space-y-3">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} className="space-y-2">
                      <div className="h-3 w-32 animate-pulse rounded bg-white/10" />
                      <div className="h-2 w-full animate-pulse rounded bg-white/10" />
                    </div>
                  ))}
                </div>
              ) : null}

              {analysisState.status === 'ready' && moodBreakdown ? (
                <div className="mt-4 space-y-4">
                  {moodBreakdown.map((entry) => (
                    <div key={entry.label}>
                      <div className="flex items-center justify-between text-xs text-slate-200/70">
                        <span>{entry.label}</span>
                        <span>{entry.value}%</span>
                      </div>
                      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className={['h-full rounded-full', entry.className].join(' ')}
                          style={{ width: `${entry.value}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {analysisState.status === 'ready' && analysisState.data ? (
                <div className="mt-8 grid grid-cols-2 gap-3 text-xs text-slate-200/70">
                  <div className="glass-card bg-white/5 p-4">
                    <div className="text-slate-200/60 uppercase tracking-tighter font-bold text-[10px]">Brightness</div>
                    <div className="mt-2 text-sm font-semibold text-slate-100">
                      {Math.round(clamp(analysisState.data.brightness ?? 0, 0, 1) * 100)}%
                    </div>
                  </div>
                  <div className="glass-card bg-white/5 p-4">
                    <div className="text-slate-200/60 uppercase tracking-tighter font-bold text-[10px]">Complexity</div>
                    <div className="mt-2 text-sm font-semibold text-slate-100">
                      {Math.round(clamp(analysisState.data.complexity ?? 0, 0, 1) * 100)}%
                    </div>
                  </div>
                  <div className="glass-card bg-white/5 p-4">
                    <div className="text-slate-200/60 uppercase tracking-tighter font-bold text-[10px]">Temperature</div>
                    <div className="mt-2 text-sm font-semibold capitalize text-slate-100">
                      {analysisState.data.temperature ?? '—'}
                    </div>
                  </div>
                  <div className="glass-card bg-white/5 p-4">
                    <div className="text-slate-200/60 uppercase tracking-tighter font-bold text-[10px]">Subjects</div>
                    <div className="mt-2 text-sm font-semibold text-slate-100">
                      {Array.isArray(analysisState.data.subjects) && analysisState.data.subjects.length > 0
                        ? analysisState.data.subjects.slice(0, 3).join(', ')
                        : '—'}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function APODGallery() {
  const [items, setItems] = useState([])
  const [favorites, setFavorites] = useState(() => readFavorites())
  const [status, setStatus] = useState({ loading: false, error: null })
  const [cursorDate, setCursorDate] = useState(() => new Date())
  const [selected, setSelected] = useState(null)
  const sentinelRef = useRef(null)
  const loadingRef = useRef(false)
  const didInitialLoadRef = useRef(false)

  const itemsByKey = useMemo(() => {
    const map = new Map()
    for (const item of items) {
      const key = normalizeFavoriteKey(item)
      if (!key) continue
      map.set(key, item)
    }
    return map
  }, [items])

  const addItems = useCallback((nextItems) => {
    setItems((previous) => {
      const seen = new Set(previous.map((item) => normalizeFavoriteKey(item)).filter(Boolean))
      const merged = [...previous]
      for (const item of nextItems) {
        const key = normalizeFavoriteKey(item)
        if (!key || seen.has(key)) continue
        seen.add(key)
        merged.push(item)
      }
      return merged
    })
  }, [])

  const toggleFavorite = useCallback(
    (item) => {
      const key = normalizeFavoriteKey(item)
      if (!key) return
      
      const isLiked = !favorites.has(key)

      setFavorites((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        writeFavorites(next)
        return next
      })

      if (isLiked) {
        const src = item.hdurl || item.url
        analyzeImage(src, { cacheKey: src })
          .then((features) => {
            preferenceLearner.recordLike({ item, features, liked: true })
          })
          .catch(() => {
            preferenceLearner.recordLike({ item, liked: true })
          })
      } else {
        preferenceLearner.recordLike({ item, liked: false })
      }
    },
    [favorites, setFavorites],
  )

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    setStatus((prev) => ({ ...prev, loading: true, error: null }))

    try {
      const cursor = cursorDate instanceof Date ? cursorDate : new Date()
      const start = subDays(cursor, PAGE_WINDOW_DAYS)
      const startString = format(start, 'yyyy-MM-dd')
      const endString = format(cursor, 'yyyy-MM-dd')

      const batch = await fetchAPODRange(startString, endString)
      const filtered = (Array.isArray(batch) ? batch : []).slice(0, PAGE_TARGET_COUNT)
      addItems(filtered)
      setCursorDate(start)
      setStatus({ loading: false, error: null })
    } catch (error) {
      setStatus({ loading: false, error: error?.message || 'Unable to load images.' })
    } finally {
      loadingRef.current = false
    }
  }, [addItems, cursorDate])

  useEffect(() => {
    if (didInitialLoadRef.current) return
    didInitialLoadRef.current = true
    loadMore()
  }, [loadMore])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting) return
        if (status.loading) return
        loadMore()
      },
      { rootMargin: '1400px 0px' },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore, status.loading])

  const cards = useMemo(() => {
    return items.map((item) => {
      const key = normalizeFavoriteKey(item) ?? `${item?.date ?? ''}-${item?.url ?? ''}`
      const moods = computeMoodTagsFromMetadata(item)
      const favoriteKey = normalizeFavoriteKey(item)
      const isFavorite = favoriteKey ? favorites.has(favoriteKey) : false
      return (
        <ApodCard
          key={key}
          item={item}
          moods={moods}
          isFavorite={isFavorite}
          onToggleFavorite={() => toggleFavorite(item)}
          onOpen={() => setSelected(item)}
        />
      )
    })
  }, [favorites, items, toggleFavorite])

  const selectedFavorite = selected ? favorites.has(normalizeFavoriteKey(selected) ?? '') : false

  return (
    <section className="mx-auto mt-10 w-full max-w-6xl">
      <WhereArePlanetsNow />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="mt-8">
          <h2 className="text-xl font-semibold tracking-tight text-space-stardust">Gallery</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-200/75">
            Scroll to explore APOD images. Tap a card for the full-size view, description, and mood analysis.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-200/70">
          <span className="rounded-full bg-white/5 px-3 py-1 ring-1 ring-white/10">
            {items.length} images
          </span>
          <span className="rounded-full bg-white/5 px-3 py-1 ring-1 ring-white/10">
            {favorites.size} saved
          </span>
        </div>
      </div>

      {status.error ? (
        <div className="mt-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-5 text-sm text-rose-100">
          {status.error}
        </div>
      ) : null}

      <div className="mt-8 columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
        {cards}
        {status.loading
          ? Array.from({
              length: items.length === 0 ? SKELETON_COUNT : Math.min(8, SKELETON_COUNT),
            }).map((_, index) => (
              <CardSkeleton key={`skeleton-${index}`} variant={items.length + index} />
            ))
          : null}
      </div>

      <div ref={sentinelRef} className="mt-6 h-6 w-full" />

      {status.loading && items.length > 0 ? (
        <div className="mt-4 flex items-center justify-center text-sm text-slate-200/70">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 ring-1 ring-white/10">
            <span className="h-2 w-2 animate-pulse rounded-full bg-space-aurora" />
            Loading more…
          </span>
        </div>
      ) : null}

      {selected ? (
        <Modal
          key={normalizeFavoriteKey(selected) ?? selected?.url ?? selected?.date ?? 'modal'}
          item={itemsByKey.get(normalizeFavoriteKey(selected)) ?? selected}
          onClose={() => setSelected(null)}
          isFavorite={selectedFavorite}
          onToggleFavorite={() => toggleFavorite(selected)}
        />
      ) : null}
    </section>
  )
}

