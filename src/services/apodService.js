import axios from 'axios'
import { format, parseISO } from 'date-fns'

import { NASA_APOD_API_ENDPOINT } from '../constants/nasa'
import {
  getApodItemByDate,
  getApodItemsByDateRange,
  storeApodItem,
  storeApodItems,
  getApodSyncState,
  setApodSyncState,
} from './storageService'

const CACHE_PREFIX = 'apod-cache:v1:'
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000
const RANDOM_TTL_MS = 30 * 60 * 1000
const MAX_RETRIES = 2
const INITIAL_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 4000

const inflightByDate = new Map()
let batchedByDate = new Map()
let batchTimer = null
const BATCH_WINDOW_MS = 40
const MAX_BATCH_RANGE_DAYS = 45

let backgroundSyncState = null

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getLocalStorage() {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage ?? null
  } catch {
    return null
  }
}

function isOffline() {
  try {
    if (typeof navigator === 'undefined') return false
    return navigator.onLine === false
  } catch {
    return false
  }
}

function makeCacheKey(parts) {
  return `${CACHE_PREFIX}${parts.filter(Boolean).join(':')}`
}

function readCache(key) {
  const storage = getLocalStorage()
  if (!storage) return undefined

  try {
    const raw = storage.getItem(key)
    if (!raw) return undefined

    const entry = JSON.parse(raw)
    const storedAt = Number(entry?.storedAt)
    const ttlMs = Number(entry?.ttlMs)

    if (!Number.isFinite(storedAt) || !Number.isFinite(ttlMs)) {
      storage.removeItem(key)
      return undefined
    }

    if (Date.now() - storedAt > ttlMs) {
      storage.removeItem(key)
      return undefined
    }

    return entry.data
  } catch {
    try {
      storage.removeItem(key)
    } catch {
      return undefined
    }
    return undefined
  }
}

function writeCache(key, data, ttlMs) {
  const storage = getLocalStorage()
  if (!storage) return

  try {
    storage.setItem(
      key,
      JSON.stringify({
        storedAt: Date.now(),
        ttlMs,
        data,
      }),
    )
  } catch {
    return
  }
}

function toDateString(value) {
  if (!value) return undefined
  if (value instanceof Date) return format(value, 'yyyy-MM-dd')
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      throw new Error(`Invalid date format: ${value}`)
    }
    return trimmed
  }
  throw new Error('Date must be a Date or YYYY-MM-DD string')
}

function toUtcDayMs(dateString) {
  const [y, m, d] = String(dateString).split('-').map((v) => Number(v))
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN
  return Date.UTC(y, m - 1, d)
}

function diffUtcDays(a, b) {
  const aMs = toUtcDayMs(a)
  const bMs = toUtcDayMs(b)
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return NaN
  return Math.round((bMs - aMs) / 86400000)
}

function makeDateCacheKey(dateString) {
  return makeCacheKey(['date', dateString])
}

async function flushDateBatch() {
  const snapshot = batchedByDate
  batchedByDate = new Map()
  batchTimer = null

  const dates = Array.from(snapshot.keys()).filter(Boolean).sort()
  if (dates.length === 0) return

  if (isOffline()) {
    for (const d of dates) {
      snapshot.get(d)?.resolve(null)
      inflightByDate.delete(d)
    }
    return
  }

  const ranges = []
  let rangeStart = dates[0]
  let prev = dates[0]

  for (let i = 1; i < dates.length; i += 1) {
    const current = dates[i]
    const gap = diffUtcDays(prev, current)
    const span = diffUtcDays(rangeStart, current)
    if (gap === 1 && span >= 0 && span < MAX_BATCH_RANGE_DAYS) {
      prev = current
      continue
    }
    ranges.push({ start: rangeStart, end: prev })
    rangeStart = current
    prev = current
  }
  ranges.push({ start: rangeStart, end: prev })

  const itemsByDate = new Map()

  try {
    for (const range of ranges) {
      const raw = await fetchApodApi({
        start_date: range.start,
        end_date: range.end,
        thumbs: false,
      })
      for (const item of Array.isArray(raw) ? raw : []) {
        const normalized = normalizeApodItem(item)
        if (!normalized?.date) continue
        itemsByDate.set(normalized.date, normalized)
      }
    }

    const allItems = Array.from(itemsByDate.values())
    if (allItems.length > 0) void storeApodItems(allItems).catch(() => null)

    for (const d of dates) {
      const value = itemsByDate.get(d) ?? null
      writeCache(makeDateCacheKey(d), value, DEFAULT_TTL_MS)
      snapshot.get(d)?.resolve(value)
      inflightByDate.delete(d)
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(getErrorMessage(error))
    for (const d of dates) {
      snapshot.get(d)?.reject(err)
      inflightByDate.delete(d)
    }
  }
}

function enqueueDateBatch(dateString) {
  return new Promise((resolve, reject) => {
    batchedByDate.set(dateString, { resolve, reject })
    if (batchTimer) return
    batchTimer = setTimeout(() => {
      void flushDateBatch()
    }, BATCH_WINDOW_MS)
  })
}

function normalizeApodItem(raw) {
  if (!raw || raw.media_type !== 'image') return null
  if (!raw.url) return null

  return {
    date: raw.date ?? null,
    title: raw.title ?? null,
    url: raw.url ?? null,
    hdurl: raw.hdurl ?? null,
    explanation: raw.explanation ?? null,
    copyright: raw.copyright ?? null,
  }
}

function buildApiParams(params) {
  const apiKey = import.meta.env.VITE_NASA_API_KEY || 'DEMO_KEY'
  return {
    api_key: apiKey,
    ...params,
  }
}

function getErrorMessage(error) {
  const status = error?.response?.status
  const statusText = error?.response?.statusText
  const apiMessage =
    error?.response?.data?.error?.message ??
    error?.response?.data?.msg ??
    error?.response?.data?.message

  if (status) {
    const tail = [statusText, apiMessage].filter(Boolean).join(' - ')
    return `NASA APOD request failed (${status})${tail ? `: ${tail}` : ''}`
  }

  return error?.message || 'NASA APOD request failed'
}

function isRetryable(error) {
  const status = error?.response?.status
  if (!status) return true
  if (status === 408) return true
  if (status === 429) return true
  return status >= 500 && status <= 599
}

async function getWithRetry(url, config, { retries = MAX_RETRIES } = {}) {
  let attempt = 0

  while (true) {
    try {
      return await axios.get(url, config)
    } catch (error) {
      if (attempt >= retries || !isRetryable(error)) {
        throw new Error(getErrorMessage(error))
      }

      const delayBase = Math.min(
        INITIAL_BACKOFF_MS * 2 ** attempt,
        MAX_BACKOFF_MS,
      )
      const delayMs = delayBase + Math.floor(Math.random() * 100)
      attempt += 1
      await sleep(delayMs)
    }
  }
}

async function fetchApodApi(params) {
  const response = await getWithRetry(NASA_APOD_API_ENDPOINT, {
    params: buildApiParams(params),
  })
  return response.data
}

export async function fetchAPODByDate(date) {
  const dateString = toDateString(date)
  const cacheKey = makeDateCacheKey(dateString)
  const cached = readCache(cacheKey)

  if (cached !== undefined) {
    void storeApodItem(cached).catch(() => null)
    return cached
  }

  const cachedIdb = await getApodItemByDate(dateString)
  if (cachedIdb) {
    const ageMs = Date.now() - Number(cachedIdb?.fetchedAt ?? 0)
    if (Number.isFinite(ageMs) && ageMs > DEFAULT_TTL_MS && !isOffline()) {
      void revalidateApodByDate(dateString)
        .then((fresh) => {
          if (fresh) writeCache(cacheKey, fresh, DEFAULT_TTL_MS)
        })
        .catch(() => null)
    }
    return cachedIdb
  }

  if (isOffline()) return null

  const inflight = inflightByDate.get(dateString)
  if (inflight) return inflight

  const promise = enqueueDateBatch(dateString)
  inflightByDate.set(dateString, promise)
  promise.finally(() => inflightByDate.delete(dateString))
  return promise
}

export async function fetchAPODRange(startDate, endDate, count) {
  const startDateString = toDateString(startDate)
  const endDateString = toDateString(endDate)
  const countValue =
    typeof count === 'number' && Number.isFinite(count) && count > 0
      ? Math.floor(count)
      : null

  const cacheKey = makeCacheKey([
    'range',
    startDateString,
    endDateString,
    countValue ? `count-${countValue}` : 'all',
  ])

  const cached = readCache(cacheKey)
  if (cached !== undefined) {
    void storeApodItems(cached).catch(() => null)
    return cached
  }

  const cachedIdb = await getApodItemsByDateRange(startDateString, endDateString)
  if (cachedIdb.length > 0) {
    if (!isOffline()) {
      void (async () => {
        const raw = await fetchApodApi({
          start_date: startDateString,
          end_date: endDateString,
          thumbs: false,
        })

        const normalized = (Array.isArray(raw) ? raw : [])
          .map(normalizeApodItem)
          .filter(Boolean)
          .sort((a, b) => (a.date < b.date ? 1 : -1))

        writeCache(cacheKey, normalized, DEFAULT_TTL_MS)
        void storeApodItems(normalized).catch(() => null)
      })().catch(() => null)
    }

    const result = countValue ? cachedIdb.slice(0, countValue) : cachedIdb
    return result
  }

  if (isOffline()) return []

  const raw = await fetchApodApi({
    start_date: startDateString,
    end_date: endDateString,
    thumbs: false,
  })

  const normalized = (Array.isArray(raw) ? raw : [])
    .map(normalizeApodItem)
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? 1 : -1))

  const result = countValue ? normalized.slice(0, countValue) : normalized
  writeCache(cacheKey, result, DEFAULT_TTL_MS)
  void storeApodItems(result).catch(() => null)
  return result
}

export async function fetchRandomAPODs(count, { bypassCache = false } = {}) {
  const countValue =
    typeof count === 'number' && Number.isFinite(count) && count > 0
      ? Math.min(100, Math.floor(count))
      : 1

  const cacheKey = makeCacheKey(['random', `count-${countValue}`])
  
  if (!bypassCache) {
    const cached = readCache(cacheKey)
    if (cached !== undefined) {
      void storeApodItems(cached).catch(() => null)
      return cached
    }
  }

  if (isOffline()) return []

  const resultsByDate = new Map()
  let remaining = countValue
  let attempts = 0

  while (remaining > 0 && attempts < 3) {
    const batchCount = Math.min(100, Math.max(remaining * 2, remaining))
    const raw = await fetchApodApi({ count: batchCount, thumbs: false })

    for (const item of Array.isArray(raw) ? raw : []) {
      const normalized = normalizeApodItem(item)
      if (!normalized) continue
      if (!normalized.date) continue
      if (resultsByDate.has(normalized.date)) continue
      resultsByDate.set(normalized.date, normalized)
      remaining -= 1
      if (remaining <= 0) break
    }

    attempts += 1
  }

  const result = Array.from(resultsByDate.values()).slice(0, countValue)
  writeCache(cacheKey, result, RANDOM_TTL_MS)
  void storeApodItems(result).catch(() => null)
  return result
}

export async function revalidateApodByDate(date) {
  const dateString = toDateString(date)
  if (!dateString) return null
  if (isOffline()) return null

  try {
    const raw = await fetchApodApi({ date: dateString, thumbs: false })
    const fresh = normalizeApodItem(raw)
    if (!fresh) return null
    await storeApodItem(fresh)
    writeCache(makeDateCacheKey(dateString), fresh, DEFAULT_TTL_MS)
    return fresh
  } catch {
    return null
  }
}

export async function syncNewApods({ maxLookbackDays = 14 } = {}) {
  if (isOffline()) {
    return { ok: false, reason: 'offline' }
  }

  const now = new Date()
  const end = format(now, 'yyyy-MM-dd')

  const state = await getApodSyncState()
  const lastSynced = state?.lastSyncedDate

  const startFallback = format(new Date(now.getTime() - maxLookbackDays * 24 * 60 * 60 * 1000), 'yyyy-MM-dd')
  const start = lastSynced ? format(new Date(parseISO(lastSynced).getTime() + 24 * 60 * 60 * 1000), 'yyyy-MM-dd') : startFallback

  if (start > end) return { ok: true, fetched: 0 }

  const cachedEnd = await getApodItemByDate(end)
  if (cachedEnd && lastSynced === end) return { ok: true, fetched: 0 }

  const items = await fetchAPODRange(start, end)
  await setApodSyncState({ lastSyncedDate: end, updatedAt: Date.now() })
  return { ok: true, fetched: items.length }
}

export function startBackgroundApodSync({ intervalMs = 6 * 60 * 60 * 1000, maxLookbackDays = 14 } = {}) {
  if (backgroundSyncState) return backgroundSyncState
  if (typeof window === 'undefined') return null

  const state = {
    intervalMs: Math.max(30 * 1000, Number(intervalMs) || 0),
    maxLookbackDays: Math.max(1, Number(maxLookbackDays) || 1),
    timerId: null,
    stopped: false,
    stop() {
      this.stopped = true
      if (this.timerId) clearInterval(this.timerId)
      this.timerId = null
      if (backgroundSyncState === this) backgroundSyncState = null
    },
  }

  const run = async () => {
    if (state.stopped) return
    try {
      await syncNewApods({ maxLookbackDays: state.maxLookbackDays })
    } catch {
      return
    }
  }

  void run()
  state.timerId = setInterval(() => {
    void run()
  }, state.intervalMs)

  backgroundSyncState = state
  return state
}
