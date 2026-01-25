import { useEffect, useMemo, useRef, useState } from 'react'
import {
  bestTextOn,
  buildExportStrings,
  deltaE76,
  hexToLab,
  makeSchemes,
  normalizeHex,
  ratioBadge,
} from '../utils/colorTools'
import { copyToClipboard } from '../utils'
import { filterColorRowsInWorker } from '../services/colorFilterWorkerClient'
import { useDebouncedValue } from '../hooks'

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

function pickDominantHex(colors, fallback) {
  const list = Array.isArray(colors) ? colors : []
  const first = list[0]?.hex
  return normalizeHex(first) ?? normalizeHex(fallback) ?? '#000000'
}

function isColorMatch({ targetLab, candidateHex, threshold }) {
  const cand = normalizeHex(candidateHex)
  if (!cand || !targetLab) return false
  const lab = hexToLab(cand)
  return deltaE76(targetLab, lab) <= threshold
}

export default function ColorPalette({
  title = 'Color Palette',
  items,
  analysisByKey,
  getKey,
  maxColorsPerImage = 7,
  maxItems = 16,
  onFilterChange,
  onRequestAnalyze,
}) {
  const [filterEnabled, setFilterEnabled] = useState(false)
  const [includeUnanalyzed, setIncludeUnanalyzed] = useState(false)
  const [filterHex, setFilterHex] = useState('#6d28d9')
  const [threshold, setThreshold] = useState(18)
  const [exportPrefix, setExportPrefix] = useState('apod')
  const [exportMode, setExportMode] = useState('css')
  const [copied, setCopied] = useState('')

  const copiedTimeout = useRef(null)

  useEffect(() => {
    return () => {
      if (copiedTimeout.current) clearTimeout(copiedTimeout.current)
    }
  }, [])

  const itemKey = useMemo(() => {
    if (typeof getKey === 'function') return getKey
    return (it) => String(it?.hdurl || it?.url || it?.date || '')
  }, [getKey])

  const liveTarget = useMemo(() => normalizeHex(filterHex), [filterHex])
  const target = useDebouncedValue(liveTarget, 180)
  const targetLab = useMemo(() => (target ? hexToLab(target) : null), [target])

  const rows = useMemo(() => {
    const list = Array.isArray(items) ? items : []
    const map = analysisByKey instanceof Map ? analysisByKey : new Map(Object.entries(analysisByKey ?? {}))
    const out = []
    for (const it of list) {
      const key = itemKey(it)
      if (!key) continue
      const features = map.get(key)
      const colors = Array.isArray(features?.dominantColors) ? features.dominantColors : []
      const swatches = colors
        .slice(0, clamp(Number(maxColorsPerImage) || 7, 5, 7))
        .map((c) => normalizeHex(c?.hex))
        .filter(Boolean)
      out.push({
        key,
        it,
        features,
        swatches,
        hasAnalysis: Boolean(features),
        dominantHex: pickDominantHex(colors, '#000000'),
      })
    }
    return out
  }, [analysisByKey, itemKey, items, maxColorsPerImage])

  const [filteredKeys, setFilteredKeys] = useState(null)

  useEffect(() => {
    if (!filterEnabled || !targetLab || !Number.isFinite(threshold)) {
      queueMicrotask(() => setFilteredKeys(null))
      return
    }

    if (typeof Worker === 'undefined') {
      queueMicrotask(() => setFilteredKeys(null))
      return
    }

    const controller = new AbortController()
    let mounted = true
    const timeoutId = setTimeout(() => {
      const rowsPayload = rows.map((r) => ({
        key: r.key,
        hasAnalysis: r.hasAnalysis,
        swatches: r.swatches,
      }))

      filterColorRowsInWorker(
        {
          rows: rowsPayload,
          targetHex: target,
          threshold,
          includeUnanalyzed,
        },
        { signal: controller.signal }
      )
        .then((keys) => {
          if (!mounted) return
          setFilteredKeys(Array.isArray(keys) ? keys : [])
        })
        .catch(() => {
          if (!mounted) return
          setFilteredKeys(null)
        })
    }, 60)

    return () => {
      mounted = false
      clearTimeout(timeoutId)
      controller.abort()
    }
  }, [filterEnabled, includeUnanalyzed, rows, target, targetLab, threshold])

  const filteredRows = useMemo(() => {
    if (!filterEnabled) return rows
    if (!targetLab || !Number.isFinite(threshold)) return rows

    if (typeof Worker === 'undefined') {
      const t = clamp(Number(threshold) || 0, 0, 60)
      return rows.filter((r) => {
        if (!r.hasAnalysis) return includeUnanalyzed
        return r.swatches.some((hex) => isColorMatch({ targetLab, candidateHex: hex, threshold: t }))
      })
    }

    if (filteredKeys === null) return rows
    const allowed = new Set(filteredKeys)
    return rows.filter((r) => allowed.has(r.key))
  }, [filterEnabled, filteredKeys, includeUnanalyzed, rows, targetLab, threshold])

  useEffect(() => {
    if (typeof onFilterChange !== 'function') return
    onFilterChange({
      enabled: filterEnabled,
      hex: target,
      threshold: clamp(Number(threshold) || 0, 0, 60),
      includeUnanalyzed,
    })
  }, [filterEnabled, includeUnanalyzed, onFilterChange, target, threshold])

  const journey = useMemo(() => {
    const list = filteredRows
      .filter((r) => r.it?.date)
      .slice()
      .sort((a, b) => String(a.it?.date).localeCompare(String(b.it?.date)))
      .slice(0, 220)
    const swatches = list.map((r) => r.dominantHex)
    const dates = list.map((r) => String(r.it?.date))
    return { swatches, dates }
  }, [filteredRows])

  const selectedExportPalette = useMemo(() => {
    const first = filteredRows.find((r) => r.swatches.length > 0)
    const palette = first ? first.swatches : []
    return buildExportStrings({ colors: palette, prefix: exportPrefix })
  }, [exportPrefix, filteredRows])

  const schemes = useMemo(() => makeSchemes(target), [target])

  const onCopied = (value) => {
    setCopied(value)
    if (copiedTimeout.current) clearTimeout(copiedTimeout.current)
    copiedTimeout.current = setTimeout(() => setCopied(''), 1200)
  }

  const limited = filteredRows.slice(0, clamp(Number(maxItems) || 0, 4, 60))
  const hiddenCount = Math.max(0, filteredRows.length - limited.length)

  return (
    <div className="rounded-2xl border border-white/10 bg-space-void/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-space-stardust">{title}</h3>
        <div className="text-[11px] text-slate-200/60">
          {filteredRows.length} / {rows.length} images
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-black/15 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-medium text-slate-200/70">Color Filter</div>
            <button
              type="button"
              onClick={() => setFilterEnabled((v) => !v)}
              className={[
                'rounded-full px-3 py-1 text-[11px] font-medium ring-1 transition-colors',
                filterEnabled
                  ? 'bg-space-aurora/20 text-space-aurora ring-space-aurora/40 hover:bg-space-aurora/25'
                  : 'bg-white/5 text-slate-200 ring-white/10 hover:bg-white/10',
              ].join(' ')}
            >
              {filterEnabled ? 'Filtering On' : 'Filtering Off'}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-[44px_1fr] items-center gap-2">
            <input
              type="color"
              value={liveTarget ?? '#000000'}
              onChange={(e) => setFilterHex(e.target.value)}
              className="h-10 w-11 cursor-pointer rounded-lg border border-white/10 bg-transparent p-1"
              aria-label="Pick filter color"
            />
            <input
              value={filterHex}
              onChange={(e) => setFilterHex(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-xs text-slate-100"
              placeholder="#RRGGBB"
            />
          </div>

          <div className="mt-3 flex items-center gap-3">
            <div className="text-[11px] text-slate-200/60">Tolerance</div>
            <input
              type="range"
              min={0}
              max={60}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-full"
              aria-label="Color match tolerance"
            />
            <div className="w-10 text-right text-[11px] tabular-nums text-slate-200/70">{threshold}</div>
          </div>

          <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-200/70">
            <input
              type="checkbox"
              checked={includeUnanalyzed}
              onChange={(e) => setIncludeUnanalyzed(e.target.checked)}
            />
            Include unanalyzed images
          </label>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                const ok = await copyToClipboard(liveTarget ?? '')
                if (ok) onCopied(liveTarget ?? '')
              }}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-slate-200 hover:bg-white/10"
              disabled={!liveTarget}
            >
              {copied === liveTarget ? 'Copied' : 'Copy Hex'}
            </button>
            {typeof onRequestAnalyze === 'function' ? (
              <button
                type="button"
                onClick={() => onRequestAnalyze()}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-slate-200 hover:bg-white/10"
              >
                Analyze Colors
              </button>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/15 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-medium text-slate-200/70">Harmonious Schemes</div>
            <div className="text-[11px] text-slate-200/60">{liveTarget ?? 'Pick a color'}</div>
          </div>

          {schemes.length === 0 ? (
            <div className="mt-3 text-sm text-slate-200/60">Select a valid hex color to generate schemes.</div>
          ) : (
            <div className="mt-3 space-y-3">
              {schemes.map((scheme) => (
                <div key={scheme.name} className="rounded-lg border border-white/10 bg-white/5 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] font-medium text-slate-200/80">{scheme.name}</div>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await copyToClipboard(scheme.colors.join(', '))
                        if (ok) onCopied(scheme.name)
                      }}
                      className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-white/10"
                    >
                      {copied === scheme.name ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {scheme.colors.map((hex) => {
                      const accessibility = bestTextOn(hex)
                      return (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => setFilterHex(hex)}
                          className="group flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 p-1.5 pr-2 text-left hover:bg-black/30"
                          title={`Use ${hex} as filter color`}
                        >
                          <span className="h-6 w-6 rounded-md border border-white/10" style={{ backgroundColor: hex }} />
                          <span className="text-[11px] font-medium text-slate-100">{hex}</span>
                          <span className="ml-1 rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-200/70">
                            {Math.round(accessibility.ratio * 10) / 10} {ratioBadge(accessibility.ratio)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] font-medium text-slate-200/70">Color Journey</div>
          <div className="text-[11px] text-slate-200/60">
            {journey.swatches.length} points{journey.swatches.length >= 220 ? ' (showing first 220)' : ''}
          </div>
        </div>
        {journey.swatches.length === 0 ? (
          <div className="mt-2 text-sm text-slate-200/60">Analyze items (and optionally apply a color filter) to reveal the journey.</div>
        ) : (
          <div className="mt-3">
            <div className="flex h-6 w-full overflow-hidden rounded-lg border border-white/10 bg-black/20">
              {journey.swatches.map((hex, idx) => (
                <button
                  key={`${hex}-${idx}`}
                  type="button"
                  onClick={() => setFilterHex(hex)}
                  className="h-full flex-1"
                  title={`${journey.dates[idx] ?? ''} • ${hex}`}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-200/60">
              <div>{journey.dates[0] ?? ''}</div>
              <div>{journey.dates[journey.dates.length - 1] ?? ''}</div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] font-medium text-slate-200/70">Export</div>
          <div className="flex items-center gap-2">
            <input
              value={exportPrefix}
              onChange={(e) => setExportPrefix(e.target.value)}
              className="w-28 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-slate-100"
              placeholder="prefix"
              aria-label="Export prefix"
            />
            <select
              value={exportMode}
              onChange={(e) => setExportMode(e.target.value)}
              className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-slate-100"
              aria-label="Export format"
            >
              <option value="css">CSS Vars</option>
              <option value="tokens">Design Tokens</option>
            </select>
            <button
              type="button"
              onClick={async () => {
                const text = exportMode === 'css' ? selectedExportPalette.css : selectedExportPalette.tokens
                const ok = await copyToClipboard(text)
                if (ok) onCopied('export')
              }}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-slate-200 hover:bg-white/10"
              disabled={!selectedExportPalette}
            >
              {copied === 'export' ? 'Copied' : 'Copy Export'}
            </button>
          </div>
        </div>
        <textarea
          readOnly
          value={exportMode === 'css' ? selectedExportPalette.css : selectedExportPalette.tokens}
          className="mt-3 h-28 w-full resize-none rounded-xl border border-white/10 bg-black/20 p-2 text-[11px] text-slate-100/90"
        />
        <div className="mt-2 text-[11px] text-slate-200/60">
          Export uses the first available palette in the current filtered set.
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] font-medium text-slate-200/70">Palettes</div>
          {hiddenCount > 0 ? <div className="text-[11px] text-slate-200/60">+{hiddenCount} more</div> : null}
        </div>
        <div className="mt-2 space-y-2">
          {limited.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 bg-black/10 p-4 text-sm text-slate-200/60">
              No palettes to display yet. Run analysis, or relax filters.
            </div>
          ) : (
            limited.map((row) => (
              <div key={row.key} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/15 p-2">
                <div className="h-10 w-10 overflow-hidden rounded-lg border border-white/10 bg-white/5">
                  {row.it?.url ? <img src={row.it.url} alt={row.it?.title ?? ''} className="h-full w-full object-cover" /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-slate-100">{row.it?.title ?? row.it?.date ?? 'APOD'}</div>
                  <div className="mt-0.5 text-[11px] text-slate-200/60">{row.it?.date ?? ''}</div>
                </div>
                {row.swatches.length === 0 ? (
                  <div className="text-[11px] text-slate-200/55">{row.hasAnalysis ? 'No colors' : 'Not analyzed'}</div>
                ) : (
                  <div className="flex flex-wrap justify-end gap-2">
                    {row.swatches.map((hex) => {
                      const accessibility = bestTextOn(hex)
                      const badge = ratioBadge(accessibility.ratio)
                      return (
                        <button
                          key={hex}
                          type="button"
                          onClick={async () => {
                            const ok = await copyToClipboard(hex)
                            if (ok) onCopied(hex)
                          }}
                          className="group flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-1 hover:bg-black/30"
                          title={`Copy ${hex}`}
                        >
                          <span className="h-5 w-5 rounded-md border border-white/10" style={{ backgroundColor: hex }} />
                          <span className="text-[11px] font-medium text-slate-100">{hex}</span>
                          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-200/70">
                            {Math.round(accessibility.ratio * 10) / 10} {badge}
                          </span>
                          <span className="text-[10px] text-slate-200/55">
                            {copied === hex ? 'Copied' : 'Copy'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
