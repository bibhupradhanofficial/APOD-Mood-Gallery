import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { format, subDays } from 'date-fns'

import { analyzeImage, fetchAPODRange, preferenceLearner } from '../services'

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizeSrc(item) {
  const src = item?.hdurl || item?.url
  return src ? String(src) : null
}

function loadFavoritesSet() {
  try {
    if (typeof window === 'undefined') return new Set()
    const raw = window.localStorage?.getItem('apod-favorites:v1')
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter(Boolean))
  } catch {
    return new Set()
  }
}

function normalizeFavoriteKey(item) {
  if (!item) return null
  if (item.date) return `date:${item.date}`
  if (item.url) return `url:${item.url}`
  return null
}

const MiniCard = memo(function MiniCard({ item, score }) {
  const src = normalizeSrc(item)
  const title = String(item?.title ?? 'Untitled')
  const date = String(item?.date ?? '').trim()

  return (
    <a
      href={item?.hdurl || item?.url || '#'}
      target="_blank"
      rel="noreferrer"
      className={[
        'group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-space-void/40',
        'transition hover:border-white/20 hover:bg-space-void/55',
      ].join(' ')}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-black/20">
        {src ? (
          <img
            src={src}
            alt={title}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        ) : null}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 py-2">
          <div className="text-xs font-semibold tracking-wide text-white/90">{date || '—'}</div>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="line-clamp-2 text-sm font-semibold text-slate-100">{title}</div>
        <div className="mt-auto text-xs text-slate-200/65">
          Match {Math.round(clamp(Number(score) || 0, 0, 1) * 100)}%
        </div>
      </div>
    </a>
  )
})

export default function ForYouFeed({ windowDays = 60, maxCandidates = 48, maxCards = 12 }) {
  const [items, setItems] = useState([])
  const [status, setStatus] = useState({ loading: false, error: null })
  const [analysisBySrc, setAnalysisBySrc] = useState({})
  const analysisRef = useRef(analysisBySrc)
  useEffect(() => {
    analysisRef.current = analysisBySrc
  }, [analysisBySrc])

  const [personalizationTick, setPersonalizationTick] = useState(0)

  useEffect(() => {
    return preferenceLearner.subscribe(() => setPersonalizationTick((prev) => prev + 1))
  }, [])

  const candidates = useMemo(() => {
    const list = Array.isArray(items) ? items : []
    return list.filter((item) => {
      const mediaType = String(item?.media_type ?? 'image').toLowerCase()
      if (mediaType && mediaType !== 'image') return false
      const src = normalizeSrc(item)
      return Boolean(src)
    })
  }, [items])

  useEffect(() => {
    let mounted = true
    queueMicrotask(() => {
      if (mounted) setStatus({ loading: true, error: null })
    })

    ;(async () => {
      try {
        const end = new Date()
        const start = subDays(end, clamp(Number(windowDays) || 60, 7, 180))
        const results = await fetchAPODRange(format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd'))
        if (!mounted) return
        const list = Array.isArray(results) ? results : []
        list.sort((a, b) => String(b?.date ?? '').localeCompare(String(a?.date ?? '')))
        setItems(list.slice(0, clamp(Number(maxCandidates) || 48, 12, 120)))
        setStatus({ loading: false, error: null })
      } catch (error) {
        if (!mounted) return
        setItems([])
        setStatus({ loading: false, error: error?.message || 'Unable to load recommendations.' })
      }
    })()

    return () => {
      mounted = false
    }
  }, [maxCandidates, windowDays])

  useEffect(() => {
    const controller = new AbortController()
    let mounted = true

    ;(async () => {
      if (candidates.length === 0) return

      const missing = []
      for (const item of candidates) {
        const src = normalizeSrc(item)
        if (!src) continue
        if (analysisRef.current[src]) continue
        missing.push({ src, item })
      }
      if (missing.length === 0) return

      for (const entry of missing) {
        if (controller.signal.aborted) break
        try {
          const features = await analyzeImage(entry.src, {
            cacheKey: entry.src,
            signal: controller.signal,
            maxAgeMs: 1000 * 60 * 60 * 24 * 30,
          })
          if (!mounted) return
          setAnalysisBySrc((prev) => ({ ...prev, [entry.src]: { features } }))
        } catch {
          if (!mounted) return
        }
      }
    })()

    return () => {
      mounted = false
      controller.abort()
    }
  }, [candidates])

  const favorites = useMemo(() => {
    void personalizationTick
    return loadFavoritesSet()
  }, [personalizationTick])

  const ranked = useMemo(() => {
    void personalizationTick
    const list = Array.isArray(candidates) ? candidates : []
    const filtered = list.filter((item) => {
      const key = normalizeFavoriteKey(item)
      if (!key) return false
      if (favorites.has(key)) return false
      return true
    })
    return preferenceLearner.recommend(filtered, {
      featuresByKey: analysisBySrc,
      limit: clamp(Number(maxCards) || 12, 4, 24),
      excludeSeen: true,
    })
  }, [analysisBySrc, candidates, favorites, maxCards, personalizationTick])

  const profile = useMemo(() => {
    void personalizationTick
    return preferenceLearner.getProfile()
  }, [personalizationTick])
  const hasSignal = profile?.stats?.likes > 0 || profile?.stats?.views > 0 || profile?.stats?.searches > 0

  const analysisProgress = useMemo(() => {
    const list = Array.isArray(candidates) ? candidates : []
    const total = list.length
    if (total <= 0) return { done: 0, total: 0 }
    let done = 0
    for (const item of list) {
      const src = normalizeSrc(item)
      if (!src) continue
      if (analysisBySrc[src]) done += 1
    }
    return { done, total }
  }, [analysisBySrc, candidates])

  return (
    <section className="rounded-2xl border border-white/10 bg-space-void/50 p-6 backdrop-blur">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-space-stardust">For You</h2>
          <p className="mt-2 text-sm text-slate-200/75">
            Personalized picks based on what you like, view, and search. Stored locally on this device.
          </p>
          {hasSignal ? (
            <p className="mt-3 text-xs text-slate-200/65">
              Current leaning: {profile?.favorites?.moods?.length ? profile.favorites.moods.join(', ') : '—'}
            </p>
          ) : (
            <p className="mt-3 text-xs text-slate-200/65">Interact with a few images to personalize this feed.</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const ok =
                typeof window !== 'undefined'
                  ? window.confirm('Clear personalization data stored on this device?')
                  : false
              if (!ok) return
              preferenceLearner.reset()
            }}
            className={[
              'rounded-full border px-3 py-1 text-xs font-medium transition',
              'border-white/10 bg-white/5 text-slate-100 hover:border-white/20 hover:bg-white/10',
            ].join(' ')}
          >
            Reset
          </button>
        </div>
      </div>

      {status.error ? (
        <div className="mt-5 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">
          {status.error}
        </div>
      ) : null}

      {status.loading && items.length === 0 ? (
        <div className="mt-5 text-sm text-slate-200/70">Loading personalized feed…</div>
      ) : null}

      {ranked.length > 0 ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {ranked.map((entry) => (
            <MiniCard
              key={preferenceLearner.normalizeItemKey(entry.item) ?? normalizeSrc(entry.item) ?? entry.item?.date}
              item={entry.item}
              score={entry.score}
            />
          ))}
        </div>
      ) : (
        <div className="mt-6 text-sm text-slate-200/70">
          {items.length === 0
            ? 'No recent images found.'
            : candidates.length === 0
              ? 'No recent image posts found.'
              : analysisProgress.done < analysisProgress.total
                ? `Analyzing recent images for recommendations… (${analysisProgress.done}/${analysisProgress.total})`
                : hasSignal
                  ? 'No unseen matches in this window yet. Try viewing or liking a few new images, or reset your history.'
                  : 'Interact with a few images to personalize this feed.'}
        </div>
      )}
    </section>
  )
}
