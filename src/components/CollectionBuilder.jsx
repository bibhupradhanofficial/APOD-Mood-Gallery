import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, isValid, parseISO, subDays } from 'date-fns'

import {
  analyzeImage,
  createCollectionId,
  decodeCollectionPayload,
  encodeCollectionPayload,
  fetchAPODRange,
  getCollectionIdFromLocation,
  getSharePayloadFromLocation,
  loadCollection,
  upsertCollection,
  preferenceLearner,
} from '../services'
import { suggestCollectionCandidatesInWorker } from '../services/collectionSuggestionsWorkerClient'
import { getMoodConfidenceScores, MOODS } from '../utils'
import {
  buildCollectionProfile,
  buildCollectionShareMeta,
  buildShareUrlWithMeta,
  copyToClipboard,
  downloadBlob,
  downloadCollectionAsZip,
  exportPdfMoodBoard,
  generateEmbedCode,
  generateCollectionName,
  getDominantSwatchHex,
  getSocialShareLinks,
  getImageSrc,
  getItemKey,
} from '../utils'

const DEFAULT_MAX_CANDIDATES = 120
const DEFAULT_ANALYSIS_WINDOW = 90

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

function downloadTextFile(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function scoreBarClass(pct) {
  if (pct >= 80) return 'bg-emerald-400/70'
  if (pct >= 65) return 'bg-sky-400/70'
  if (pct >= 50) return 'bg-amber-400/70'
  return 'bg-white/15'
}

function summarizeSuggestionReason(breakdown) {
  if (!breakdown) return 'Balanced match'
  const entries = Object.entries(breakdown)
    .map(([k, v]) => ({ key: k, value: Number(v) || 0 }))
    .sort((a, b) => b.value - a.value)
  const best = entries[0]
  if (!best) return 'Balanced match'
  if (best.key === 'visual') return 'Visual similarity'
  if (best.key === 'mood') return 'Mood coherence'
  if (best.key === 'temporal') return 'Seasonal pattern'
  return 'Balanced match'
}

function swatchGradient(swatches) {
  const list = Array.isArray(swatches) ? swatches.filter(Boolean) : []
  if (list.length === 0) return null
  const stops = list.map((hex, idx) => {
    const pct = list.length === 1 ? 0 : (idx / (list.length - 1)) * 100
    return `${hex} ${pct.toFixed(2)}%`
  })
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

const CollectionItemRow = memo(function CollectionItemRow({
  item,
  itemKey,
  src,
  selected,
  onSelect,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
}) {
  return (
    <div
      draggable
      onDragStart={(event) => onDragStart(event, itemKey)}
      onDragOver={onDragOver}
      onDrop={(event) => onDrop(event, itemKey)}
      className={[
        'flex items-center gap-3 rounded-2xl border bg-space-void/40 p-3',
        selected ? 'border-white/25' : 'border-white/10',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={() => onSelect(itemKey)}
        className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5"
        aria-label="Preview item"
      >
        {src ? <img src={src} alt={item?.title ?? 'APOD'} className="h-full w-full object-cover" /> : null}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-100">{item?.title ?? 'Untitled'}</p>
        <p className="mt-1 text-xs text-slate-200/60">{item?.date ?? '—'}</p>
      </div>
      <button
        type="button"
        onClick={() => onRemove(itemKey)}
        className="rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs text-slate-100 hover:bg-white/10"
      >
        Remove
      </button>
    </div>
  )
})

const SuggestionCard = memo(function SuggestionCard({ item, src, pct, reason, onAdd }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-space-void/40 p-3">
      <div className="flex gap-3">
        <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5">
          {src ? <img src={src} alt={item?.title ?? 'APOD'} className="h-full w-full object-cover" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-100">{item?.title ?? 'Untitled'}</p>
          <p className="mt-1 text-xs text-slate-200/60">{item?.date ?? '—'}</p>
          <p className="mt-2 text-xs text-slate-200/70">{reason}</p>
        </div>
      </div>
      <div className="mt-3 h-2 w-full rounded-full bg-white/5">
        <div className={`h-2 rounded-full ${scoreBarClass(pct)}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs text-slate-200/70">{pct}% match</span>
        <button
          type="button"
          onClick={() => onAdd(item)}
          className="rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs text-slate-100 hover:bg-white/10"
        >
          Add
        </button>
      </div>
    </div>
  )
})

const CandidateCard = memo(function CandidateCard({ item, src, inCollection, itemKey, onAdd, onPreview }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-space-void/40 p-3">
      <div className="flex gap-3">
        <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5">
          {src ? <img src={src} alt={item?.title ?? 'APOD'} className="h-full w-full object-cover" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-100">{item?.title ?? 'Untitled'}</p>
          <p className="mt-1 text-xs text-slate-200/60">{item?.date ?? '—'}</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={inCollection}
              onClick={() => onAdd(item)}
              className="rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs text-slate-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {inCollection ? 'Added' : 'Add'}
            </button>
            <button
              type="button"
              onClick={() => onPreview(itemKey)}
              className="rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs text-slate-100 hover:bg-white/10"
            >
              Preview
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})

export default function CollectionBuilder({ items, maxCandidates = DEFAULT_MAX_CANDIDATES }) {
  const today = useMemo(() => new Date(), [])
  const defaultEnd = useMemo(() => toISOInput(today), [today])
  const defaultStart = useMemo(() => toISOInput(subDays(today, DEFAULT_ANALYSIS_WINDOW)), [today])

  const [theme, setTheme] = useState('Cosmic Calm')
  const [nameMode, setNameMode] = useState('auto')
  const [collectionName, setCollectionName] = useState('Untitled Collection')
  const [showColorStory, setShowColorStory] = useState(true)

  const [collectionId, setCollectionId] = useState(null)
  const [shareUrl, setShareUrl] = useState('')
  const [loadId, setLoadId] = useState('')
  const [collectionNotice, setCollectionNotice] = useState(null)
  const [zipVariant, setZipVariant] = useState('original')
  const [isExportingZip, setIsExportingZip] = useState(false)

  const [collectionItems, setCollectionItems] = useState([])
  const [activeKey, setActiveKey] = useState(null)
  const dragRef = useRef({ key: null })

  const [dateStart, setDateStart] = useState(defaultStart)
  const [dateEnd, setDateEnd] = useState(defaultEnd)
  const [candidateItems, setCandidateItems] = useState([])
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [candidateError, setCandidateError] = useState(null)
  const [isExportingPdf, setIsExportingPdf] = useState(false)

  const [analysisByKey, setAnalysisByKey] = useState({})
  const analysisRef = useRef(analysisByKey)
  useEffect(() => {
    analysisRef.current = analysisByKey
  }, [analysisByKey])

  const [analysisProgress, setAnalysisProgress] = useState({ total: 0, done: 0 })
  const [suggestionCandidates, setSuggestionCandidates] = useState([])

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
      } catch (err) {
        if (!mounted) return
        setCandidateError(err instanceof Error ? err.message : 'Failed to load APOD range')
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

  const cappedCandidates = useMemo(() => {
    const list = Array.isArray(effectiveItems) ? [...effectiveItems] : []
    list.sort((a, b) => String(b?.date ?? '').localeCompare(String(a?.date ?? '')))
    return list.slice(0, clamp(Number(maxCandidates) || DEFAULT_MAX_CANDIDATES, 30, 250))
  }, [effectiveItems, maxCandidates])

  const profile = useMemo(() => buildCollectionProfile(collectionItems, analysisByKey), [collectionItems, analysisByKey])

  useEffect(() => {
    if (nameMode !== 'auto') return
    const next = generateCollectionName(collectionItems, analysisByKey)
    setCollectionName(next)
  }, [nameMode, collectionItems, analysisByKey])

  const minifyApodItem = useCallback((item) => {
    return {
      date: item?.date ?? null,
      title: item?.title ?? null,
      url: item?.url ?? null,
      hdurl: item?.hdurl ?? null,
      media_type: item?.media_type ?? null,
      explanation: item?.explanation ?? null,
    }
  }, [])

  const applyLoadedCollection = useCallback(
    (collection) => {
      const incomingItems = Array.isArray(collection?.items) ? collection.items : []
      setCollectionId(collection?.id ? String(collection.id) : null)
      setCollectionName(String(collection?.name ?? 'Untitled Collection'))
      setNameMode('manual')
      setTheme(String(collection?.theme ?? 'Cosmic Calm'))
      setCollectionItems(incomingItems)
      const firstKey = getItemKey(incomingItems[0])
      setActiveKey(firstKey ?? null)
      setShareUrl('')
    },
    [setCollectionId, setCollectionName, setTheme, setCollectionItems]
  )

  useEffect(() => {
    const idFromUrl = getCollectionIdFromLocation()
    const payload = getSharePayloadFromLocation()
    if (!idFromUrl && !payload) return

    const stored = idFromUrl ? loadCollection(idFromUrl) : null
    if (stored) {
      applyLoadedCollection(stored)
      setCollectionNotice(`Loaded collection ${stored?.id ?? idFromUrl} from local storage.`)
      return
    }

    if (!payload) return
    const decoded = decodeCollectionPayload(payload)
    if (!decoded) {
      setCollectionNotice('Share payload was not readable.')
      return
    }
    const id = idFromUrl || decoded?.id || createCollectionId()
    const normalized = {
      id,
      version: 1,
      name: String(decoded?.name ?? 'Untitled Collection'),
      theme: String(decoded?.theme ?? 'Cosmic Calm'),
      createdAt: decoded?.createdAt ?? new Date().toISOString(),
      items: Array.isArray(decoded?.items) ? decoded.items : [],
    }
    const saved = upsertCollection(normalized)
    applyLoadedCollection(saved)
    setCollectionNotice(`Imported shared collection ${saved?.id ?? id}.`)
  }, [applyLoadedCollection])

  const saveAndCreateShareLink = useCallback(async () => {
    if (collectionItems.length === 0) return
    const id = collectionId || createCollectionId()
    const payload = {
      id,
      version: 1,
      name: collectionName,
      theme,
      createdAt: new Date().toISOString(),
      items: collectionItems.map((item) => minifyApodItem(item)),
    }
    const saved = upsertCollection(payload)
    setCollectionId(saved.id)
    const encoded = encodeCollectionPayload(saved)
    const withPayload = encoded.length <= 12000 ? encoded : null
    const baseUrl = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : ''
    const meta = buildCollectionShareMeta({ name: collectionName, theme, items: collectionItems, baseUrl })
    const url = buildShareUrlWithMeta({
      baseUrl,
      meta,
      params: { view: 'collections', collection: saved.id, payload: withPayload },
    })
    setShareUrl(url)
    setCollectionNotice(withPayload ? 'Saved. Share link includes payload.' : 'Saved. Share link uses local storage only.')
    
    const topMoods = Object.entries(profile?.mood || {})
      .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
      .slice(0, 3)
      .map(([m]) => m)

    preferenceLearner.recordCollectionCreated({
      name: collectionName,
      query: { moods: topMoods },
    })

    await copyToClipboard(url)
  }, [
    collectionItems,
    collectionId,
    collectionName,
    theme,
    minifyApodItem,
    profile,
  ])

  const shareLinks = useMemo(() => {
    if (!shareUrl) return null
    const preview = collectionItems[0]
    return getSocialShareLinks({
      url: shareUrl,
      title: collectionName,
      description: theme,
      image: getImageSrc(preview) ?? preview?.url ?? '',
    })
  }, [shareUrl, collectionItems, collectionName, theme])

  const copyEmbed = useCallback(async () => {
    if (!shareUrl) return
    const code = generateEmbedCode({
      url: shareUrl,
      title: collectionName,
      attribution: 'Credits: NASA/APOD; additional rights retained by original copyright holders',
    })
    await copyToClipboard(code)
    setCollectionNotice('Embed code copied.')
  }, [shareUrl, collectionName])

  const exportZip = useCallback(async () => {
    if (collectionItems.length === 0) return
    setIsExportingZip(true)
    try {
      const collection = { id: collectionId, name: collectionName, theme, items: collectionItems }
      const { filename } = await downloadCollectionAsZip({
        collection,
        items: collectionItems,
        variant: zipVariant,
        filename: collectionName,
      })
      setCollectionNotice(`Exported ZIP: ${filename}`)
    } catch (err) {
      console.error(err)
      setCollectionNotice('Failed to export ZIP.')
    } finally {
      setIsExportingZip(false)
    }
  }, [collectionItems, collectionId, collectionName, theme, zipVariant])

  const loadStoredCollection = useCallback(() => {
    const id = String(loadId ?? '').trim()
    if (!id) return
    const loaded = loadCollection(id)
    if (!loaded) {
      setCollectionNotice(`No saved collection found for ${id}.`)
      return
    }
    applyLoadedCollection(loaded)
    setCollectionNotice(`Loaded collection ${loaded.id}.`)
  }, [loadId, applyLoadedCollection])

  const addToCollection = useCallback((item) => {
    const key = getItemKey(item)
    if (!key) return
    setCollectionItems((prev) => {
      if (prev.some((existing) => getItemKey(existing) === key)) return prev
      return [...prev, item]
    })
    setActiveKey(key)
  }, [])

  const collectionKeySet = useMemo(() => {
    const set = new Set()
    for (const entry of collectionItems) {
      const key = getItemKey(entry)
      if (key) set.add(key)
    }
    return set
  }, [collectionItems])

  const removeFromCollection = useCallback((key) => {
    const target = String(key ?? '')
    setCollectionItems((prev) => prev.filter((item) => getItemKey(item) !== target))
    setActiveKey((prev) => (prev === target ? null : prev))
  }, [])

  const clearCollection = useCallback(() => {
    setCollectionItems([])
    setActiveKey(null)
    setNameMode('auto')
    setCollectionId(null)
    setShareUrl('')
    setCollectionNotice(null)
  }, [])

  const onDragStart = useCallback((event, key) => {
    const safeKey = String(key ?? '')
    if (!safeKey) return
    dragRef.current.key = safeKey
    event.dataTransfer.effectAllowed = 'move'
    try {
      event.dataTransfer.setData('text/plain', safeKey)
    } catch {
      return
    }
  }, [])

  const onDrop = useCallback((event, toKey) => {
    event.preventDefault()
    const fromKey = dragRef.current.key
    const targetKey = String(toKey ?? '')
    if (!fromKey || !targetKey) return
    if (fromKey === targetKey) return

    setCollectionItems((prev) => {
      const fromIndex = prev.findIndex((item) => getItemKey(item) === fromKey)
      const toIndex = prev.findIndex((item) => getItemKey(item) === targetKey)
      if (fromIndex < 0 || toIndex < 0) return prev
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }, [])

  const onDragOver = useCallback((event) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let mounted = true

    setAnalysisProgress({ total: 0, done: 0 })

    ;(async () => {
      const priority = []
      for (const item of collectionItems) {
        const key = getItemKey(item)
        if (!key) continue
        if (analysisRef.current[key]) continue
        priority.push({ key })
      }

      const candidateWindow = cappedCandidates.slice(0, 70)
      for (const item of candidateWindow) {
        const key = getItemKey(item)
        if (!key) continue
        if (analysisRef.current[key]) continue
        if (priority.some((p) => p.key === key)) continue
        priority.push({ key })
      }

      if (priority.length === 0) return

      const total = priority.length
      let done = 0
      if (!mounted) return
      setAnalysisProgress({ total, done })

      for (const entry of priority) {
        if (controller.signal.aborted) break
        try {
          const features = await analyzeImage(entry.key, {
            cacheKey: entry.key,
            signal: controller.signal,
            maxAgeMs: 1000 * 60 * 60 * 24 * 30,
          })
          const moods = getMoodConfidenceScores(features)
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
  }, [collectionItems, cappedCandidates])

  useEffect(() => {
    if (collectionItems.length === 0) {
      setSuggestionCandidates([])
      return
    }

    const controller = new AbortController()
    let mounted = true
    setSuggestionCandidates([])

    const timeoutId = setTimeout(() => {
      ;(async () => {
        try {
          const results = await suggestCollectionCandidatesInWorker(
            {
              collectionItems,
              candidates: cappedCandidates,
              analysisByKey,
              profile,
              limit: 12,
            },
            { signal: controller.signal }
          )
          if (!mounted) return
          setSuggestionCandidates(Array.isArray(results) ? results : [])
        } catch {
          if (!mounted) return
          setSuggestionCandidates([])
        }
      })()
    }, 120)

    return () => {
      mounted = false
      clearTimeout(timeoutId)
      controller.abort()
    }
  }, [collectionItems, cappedCandidates, analysisByKey, profile])

  const colorSwatches = useMemo(() => {
    const swatches = []
    for (const item of collectionItems) {
      const key = getItemKey(item)
      if (!key) continue
      const record = analysisByKey[key]
      const hex = getDominantSwatchHex(record?.features)
      if (hex) swatches.push(hex)
    }
    return swatches
  }, [collectionItems, analysisByKey])

  const exportJson = useCallback(() => {
    const payload = {
      id: collectionId,
      version: 1,
      name: collectionName,
      theme,
      createdAt: new Date().toISOString(),
      items: collectionItems.map((item) => ({
        date: item?.date ?? null,
        title: item?.title ?? null,
        url: item?.url ?? null,
        hdurl: item?.hdurl ?? null,
        media_type: item?.media_type ?? null,
        explanation: item?.explanation ?? null,
      })),
      profile,
    }
    downloadTextFile(
      `${collectionName.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'collection'}.json`,
      JSON.stringify(payload, null, 2),
      'application/json'
    )
  }, [collectionId, collectionName, theme, collectionItems, profile])

  const exportPdf = useCallback(async () => {
    if (collectionItems.length === 0) return
    setIsExportingPdf(true)
    try {
      const { blob, filename } = await exportPdfMoodBoard({
        name: collectionName,
        theme,
        items: collectionItems,
        columns: 3,
        rows: 2,
      })
      downloadBlob(filename, blob)
      setCollectionNotice(`Exported PDF mood board: ${filename}`)
    } catch (err) {
      console.error(err)
      setCollectionNotice('Failed to generate PDF mood board.')
    } finally {
      setIsExportingPdf(false)
    }
  }, [collectionName, theme, collectionItems])

  const activeItem = useMemo(() => {
    if (!activeKey) return null
    return collectionItems.find((item) => getItemKey(item) === activeKey) ?? null
  }, [activeKey, collectionItems])

  const activeRecord = activeItem ? analysisByKey[getItemKey(activeItem) ?? ''] : null
  const activeMoods = useMemo(() => {
    const moods = activeRecord?.moods
    if (!moods) return []
    return MOODS.map((mood) => ({ mood, value: Number(moods[mood]) || 0 })).sort((a, b) => b.value - a.value)
  }, [activeRecord])

  return (
    <section className="rounded-3xl border border-white/10 bg-space-void/50 p-6 backdrop-blur">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-space-stardust">Collection Builder</h2>
          <p className="mt-1 text-sm text-slate-200/70">
            Curate themed mood boards and let similarity scoring suggest cohesive additions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={clearCollection}
            className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10"
          >
            New collection
          </button>
          <button
            type="button"
            onClick={saveAndCreateShareLink}
            disabled={collectionItems.length === 0}
            className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save + copy link
          </button>
          <button
            type="button"
            onClick={exportJson}
            disabled={collectionItems.length === 0}
            className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={exportPdf}
            disabled={collectionItems.length === 0 || isExportingPdf}
            className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isExportingPdf ? 'Generating PDF...' : 'Export PDF'}
          </button>
        </div>
      </div>

      {collectionNotice ? <p className="mt-3 text-sm text-slate-200/70">{collectionNotice}</p> : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex-1">
                <label className="text-xs font-medium tracking-widest text-slate-200/70">COLLECTION NAME</label>
                <input
                  value={collectionName}
                  onChange={(event) => {
                    setCollectionName(event.target.value)
                    setNameMode('manual')
                  }}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-space-void/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-white/25"
                  placeholder="Untitled Collection"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setNameMode((prev) => (prev === 'auto' ? 'manual' : 'auto'))}
                  className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10"
                >
                  {nameMode === 'auto' ? 'Auto naming: On' : 'Auto naming: Off'}
                </button>
              </div>
            </div>

            <div className="mt-4">
              <label className="text-xs font-medium tracking-widest text-slate-200/70">THEME</label>
              <input
                value={theme}
                onChange={(event) => setTheme(event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-space-void/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-white/25"
                placeholder="Cosmic Calm"
              />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium tracking-widest text-slate-200/70">SAVED ID</label>
                <div className="mt-2 rounded-xl border border-white/10 bg-space-void/40 px-3 py-2 text-sm text-slate-100">
                  {collectionId ?? 'Not saved yet'}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium tracking-widest text-slate-200/70">LOAD BY ID</label>
                <div className="mt-2 flex gap-2">
                  <input
                    value={loadId}
                    onChange={(event) => setLoadId(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-space-void/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-white/25"
                    placeholder="Paste collection id"
                  />
                  <button
                    type="button"
                    onClick={loadStoredCollection}
                    className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10"
                  >
                    Load
                  </button>
                </div>
              </div>
            </div>

            {shareUrl ? (
              <div className="mt-4">
                <label className="text-xs font-medium tracking-widest text-slate-200/70">SHARE LINK</label>
                <div className="mt-2 flex gap-2">
                  <input
                    readOnly
                    value={shareUrl}
                    className="w-full rounded-xl border border-white/10 bg-space-void/40 px-3 py-2 text-sm text-slate-100/90 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => copyToClipboard(shareUrl)}
                    className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10"
                  >
                    Copy
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={copyEmbed}
                    className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10"
                  >
                    Copy embed
                  </button>
                  <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-space-void/40 px-3 py-2">
                    <span className="text-xs text-slate-200/70">ZIP</span>
                    <select
                      value={zipVariant}
                      onChange={(event) => setZipVariant(event.target.value)}
                      className="bg-transparent text-xs text-slate-100 outline-none"
                    >
                      <option value="original">Original</option>
                      <option value="hd">HD</option>
                      <option value="thumbnail">Thumbnail</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={exportZip}
                    disabled={collectionItems.length === 0 || isExportingZip}
                    className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isExportingZip ? 'Exporting ZIP…' : 'Export ZIP'}
                  </button>
                </div>
                {shareLinks ? (
                  <div className="mt-3 flex gap-2">
                    <a
                      href={shareLinks.twitter}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 text-center py-2 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10"
                    >
                      Twitter
                    </a>
                    <a
                      href={shareLinks.pinterest}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 text-center py-2 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10"
                    >
                      Pinterest
                    </a>
                    <a
                      href={shareLinks.reddit}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 text-center py-2 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10"
                    >
                      Reddit
                    </a>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-slate-200/70">
                {collectionItems.length} item{collectionItems.length === 1 ? '' : 's'} in collection
                {analysisProgress.total > 0 ? (
                  <span className="ml-2 text-xs text-slate-200/60">
                    (analyzing {analysisProgress.done}/{analysisProgress.total})
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setShowColorStory((prev) => !prev)}
                className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10"
              >
                {showColorStory ? 'Hide color story' : 'Show color story'}
              </button>
            </div>
          </div>

          {showColorStory ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-sm font-semibold text-space-stardust">Color story</h3>
                <p className="text-xs text-slate-200/60">Dominant swatches in sequence</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {colorSwatches.length === 0 ? (
                  <div className="text-sm text-slate-200/60">Add images to reveal the palette progression.</div>
                ) : (
                  colorSwatches.map((hex, idx) => (
                    <div
                      key={`${hex}-${idx}`}
                      className="h-8 w-8 rounded-lg border border-white/10"
                      style={{ backgroundColor: hex }}
                      title={hex}
                    />
                  ))
                )}
              </div>
              {colorSwatches.length > 1 ? (
                <div
                  className="mt-3 h-3 w-full rounded-full border border-white/10"
                  style={{ backgroundImage: swatchGradient(colorSwatches) }}
                />
              ) : null}
            </div>
          ) : null}

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-sm font-semibold text-space-stardust">Collection items</h3>
              <p className="text-xs text-slate-200/60">Drag to reorder</p>
            </div>

            <div className="mt-4 space-y-3">
              {collectionItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/15 bg-space-void/30 p-6 text-center text-sm text-slate-200/60">
                  Add images from suggestions or the candidate pool.
                </div>
              ) : (
                collectionItems.map((item) => {
                  const key = getItemKey(item)
                  if (!key) return null
                  const src = getImageSrc(item)
                  const selected = key === activeKey
                  return (
                    <CollectionItemRow
                      key={key}
                      item={item}
                      itemKey={key}
                      src={src}
                      selected={selected}
                      onSelect={setActiveKey}
                      onRemove={removeFromCollection}
                      onDragStart={onDragStart}
                      onDragOver={onDragOver}
                      onDrop={onDrop}
                    />
                  )
                })
              )}
            </div>

            {activeItem ? (
              <div className="mt-5 rounded-2xl border border-white/10 bg-space-void/30 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="h-36 w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5 sm:h-28 sm:w-44">
                    {getImageSrc(activeItem) ? (
                      <img
                        src={getImageSrc(activeItem)}
                        alt={activeItem?.title ?? 'APOD'}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-100">{activeItem?.title ?? 'Untitled'}</p>
                    <p className="mt-1 text-xs text-slate-200/60">{activeItem?.date ?? '—'}</p>
                    {activeRecord?.features ? (
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-200/70">
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                          Brightness {Math.round((Number(activeRecord.features?.brightness) || 0) * 100)}%
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                          Complexity {Math.round((Number(activeRecord.features?.complexity) || 0) * 100)}%
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                          {activeRecord.features?.temperature === 'warm' ? 'Warm' : 'Cool'}
                        </span>
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-slate-200/60">Analyzing for mood + palette…</p>
                    )}
                  </div>
                </div>
                {activeMoods.length > 0 ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {activeMoods.slice(0, 4).map((entry) => (
                      <div key={entry.mood} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-100">{entry.mood}</span>
                          <span className="text-xs text-slate-200/70">{Math.round(entry.value)}%</span>
                        </div>
                        <div className="mt-2 h-2 w-full rounded-full bg-white/5">
                          <div
                            className={`h-2 rounded-full ${scoreBarClass(entry.value)}`}
                            style={{ width: `${clamp(entry.value, 0, 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-space-stardust">Candidate pool</h3>
                <p className="mt-1 text-xs text-slate-200/60">Choose a time range for similarity scanning.</p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-slate-200/60">
                  Start
                  <input
                    type="date"
                    value={dateStart}
                    onChange={(event) => setDateStart(event.target.value)}
                    className="mt-1 block rounded-xl border border-white/10 bg-space-void/40 px-3 py-2 text-xs text-slate-100 outline-none focus:border-white/25"
                  />
                </label>
                <label className="text-xs text-slate-200/60">
                  End
                  <input
                    type="date"
                    value={dateEnd}
                    onChange={(event) => setDateEnd(event.target.value)}
                    className="mt-1 block rounded-xl border border-white/10 bg-space-void/40 px-3 py-2 text-xs text-slate-100 outline-none focus:border-white/25"
                  />
                </label>
              </div>
            </div>
            {candidateError ? <p className="mt-3 text-sm text-rose-200/80">{candidateError}</p> : null}
            {loadingCandidates ? (
              <p className="mt-3 text-sm text-slate-200/70">Loading candidate images…</p>
            ) : (
              <p className="mt-3 text-xs text-slate-200/60">
                {cappedCandidates.length} candidates ready for similarity scoring.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-sm font-semibold text-space-stardust">AI suggestions</h3>
              <p className="text-xs text-slate-200/60">Visual + mood + seasonal match</p>
            </div>
            {collectionItems.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-white/15 bg-space-void/30 p-6 text-center text-sm text-slate-200/60">
                Add at least one image to start getting suggestions.
              </div>
            ) : suggestionCandidates.length === 0 ? (
              <p className="mt-4 text-sm text-slate-200/60">Analyzing candidates to generate suggestions…</p>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {suggestionCandidates.map((entry) => {
                  const src = getImageSrc(entry.item)
                  const pct = Math.round(entry.total * 100)
                  const reason = summarizeSuggestionReason(entry.breakdown)
                  return (
                    <SuggestionCard
                      key={entry.key}
                      item={entry.item}
                      src={src}
                      pct={pct}
                      reason={reason}
                      onAdd={addToCollection}
                    />
                  )
                })}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-sm font-semibold text-space-stardust">Browse candidates</h3>
              <p className="text-xs text-slate-200/60">Recent first</p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {cappedCandidates.slice(0, 8).map((item) => {
                const key = getItemKey(item)
                if (!key) return null
                const src = getImageSrc(item)
                const inCollection = collectionKeySet.has(key)
                return (
                  <CandidateCard
                    key={key}
                    item={item}
                    itemKey={key}
                    src={src}
                    inCollection={inCollection}
                    onAdd={addToCollection}
                    onPreview={setActiveKey}
                  />
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

