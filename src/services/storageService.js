import { format, parseISO } from 'date-fns'
import { getApodFromDb, saveApodToDb } from './supabaseService'

const DB_NAME = 'apod-mood-gallery'

const STORE_IMAGE_ANALYSIS = 'imageAnalysis'
const STORE_APODS = 'apods'
const STORE_COLLECTIONS = 'collections'
const STORE_KV = 'kv'
const STORE_META = 'meta'

const KV_KEYS = Object.freeze({
  favorites: 'favorites',
  moodSearchPresets: 'moodSearchPresets',
  preferenceLearnerState: 'preferenceLearnerState',
})

const META_KEYS = Object.freeze({
  apodSync: 'apodSync',
})

const LEGACY_KEYS = Object.freeze({
  collections: 'apod-collections:v1',
  preferences: 'apod-preferences:v1',
  favorites: 'apod-favorites:v1',
  moodSearchPresets: 'apod-mood-search-presets:v1',
})

const MIGRATIONS = [
  {
    version: 1,
    migrate(db) {
      if (!db.objectStoreNames.contains(STORE_IMAGE_ANALYSIS)) {
        db.createObjectStore(STORE_IMAGE_ANALYSIS, { keyPath: 'key' })
      }
    },
  },
  {
    version: 2,
    migrate(db, tx) {
      if (!db.objectStoreNames.contains(STORE_APODS)) {
        const store = db.createObjectStore(STORE_APODS, { keyPath: 'date' })
        store.createIndex('byDate', 'date', { unique: true })
        store.createIndex('byAnalysisKey', 'analysisKey', { unique: false })
        store.createIndex('byMoodTag', 'moodTags', { unique: false, multiEntry: true })
        store.createIndex('bySubject', 'subjects', { unique: false, multiEntry: true })
        store.createIndex('byColor', 'colorValues', { unique: false, multiEntry: true })
      }

      if (!db.objectStoreNames.contains(STORE_COLLECTIONS)) {
        const store = db.createObjectStore(STORE_COLLECTIONS, { keyPath: 'id' })
        store.createIndex('byUpdatedAt', 'updatedAt', { unique: false })
        store.createIndex('byCreatedAt', 'createdAt', { unique: false })
      }

      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV, { keyPath: 'key' })
      }

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' })
      }

      migrateLegacyLocalStorage(tx)
    },
  },
  {
    version: 3,
    migrate(db, tx) {
      if (!db.objectStoreNames.contains(STORE_IMAGE_ANALYSIS)) {
        db.createObjectStore(STORE_IMAGE_ANALYSIS, { keyPath: 'key' })
      }

      const store = tx.objectStore(STORE_IMAGE_ANALYSIS)
      if (!store.indexNames.contains('byUpdatedAt')) {
        store.createIndex('byUpdatedAt', 'updatedAt', { unique: false })
      }
      if (!store.indexNames.contains('byCreatedAt')) {
        store.createIndex('byCreatedAt', 'createdAt', { unique: false })
      }
      if (!store.indexNames.contains('byVersion')) {
        store.createIndex('byVersion', 'version', { unique: false })
      }
    },
  },
  {
    version: 4,
    migrate(db, tx) {
      if (!db.objectStoreNames.contains(STORE_IMAGE_ANALYSIS)) {
        db.createObjectStore(STORE_IMAGE_ANALYSIS, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(STORE_APODS)) {
        const store = db.createObjectStore(STORE_APODS, { keyPath: 'date' })
        store.createIndex('byDate', 'date', { unique: true })
        store.createIndex('byAnalysisKey', 'analysisKey', { unique: false })
        store.createIndex('byMoodTag', 'moodTags', { unique: false, multiEntry: true })
        store.createIndex('bySubject', 'subjects', { unique: false, multiEntry: true })
        store.createIndex('byColor', 'colorValues', { unique: false, multiEntry: true })
      }

      if (!db.objectStoreNames.contains(STORE_COLLECTIONS)) {
        const store = db.createObjectStore(STORE_COLLECTIONS, { keyPath: 'id' })
        store.createIndex('byUpdatedAt', 'updatedAt', { unique: false })
        store.createIndex('byCreatedAt', 'createdAt', { unique: false })
      }

      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV, { keyPath: 'key' })
      }

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' })
      }

      const analysisStore = tx.objectStore(STORE_IMAGE_ANALYSIS)
      if (!analysisStore.indexNames.contains('byUpdatedAt')) {
        analysisStore.createIndex('byUpdatedAt', 'updatedAt', { unique: false })
      }
      if (!analysisStore.indexNames.contains('byCreatedAt')) {
        analysisStore.createIndex('byCreatedAt', 'createdAt', { unique: false })
      }
      if (!analysisStore.indexNames.contains('byVersion')) {
        analysisStore.createIndex('byVersion', 'version', { unique: false })
      }
    },
  },
]

const DB_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

let dbPromise

function deleteDatabase(dbName) {
  if (typeof indexedDB === 'undefined') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('IndexedDB delete failed'))
    request.onblocked = () => reject(new Error('IndexedDB delete blocked'))
  })
}

function hasRequiredStores(db) {
  if (!db) return false
  const required = [
    STORE_IMAGE_ANALYSIS,
    STORE_APODS,
    STORE_COLLECTIONS,
    STORE_KV,
    STORE_META,
  ]
  return required.every((name) => db.objectStoreNames.contains(name))
}

function getLocalStorage() {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage ?? null
  } catch {
    return null
  }
}

function safeJsonParse(raw) {
  try {
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function normalizeDateString(value) {
  if (!value) return null
  if (value instanceof Date) return format(value, 'yyyy-MM-dd')
  const s = String(value).trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  try {
    const parsed = parseISO(s)
    if (Number.isFinite(parsed?.getTime?.())) return format(parsed, 'yyyy-MM-dd')
  } catch {
    return null
  }
  return null
}

function normalizeToken(value) {
  const s = String(value ?? '').trim().toLowerCase()
  return s || null
}

function normalizeHex(value) {
  const s = String(value ?? '').trim().toLowerCase()
  if (!s) return null
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  return null
}

function uniqueList(values) {
  const out = []
  const seen = new Set()
  for (const v of Array.isArray(values) ? values : []) {
    const key = String(v ?? '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

function runMigrations(db, tx, oldVersion, newVersion) {
  const from = Number.isFinite(oldVersion) ? oldVersion : 0
  const to = Number.isFinite(newVersion) ? newVersion : DB_VERSION
  for (const m of MIGRATIONS) {
    if (m.version > from && m.version <= to) {
      m.migrate(db, tx, { oldVersion: from, newVersion: to })
    }
  }
}

function migrateLegacyLocalStorage(tx) {
  const storage = getLocalStorage()
  if (!storage) return

  const collections = safeJsonParse(storage.getItem(LEGACY_KEYS.collections) ?? '')
  if (collections && typeof collections === 'object') {
    const store = tx.objectStore(STORE_COLLECTIONS)
    for (const value of Object.values(collections)) {
      if (!value || typeof value !== 'object') continue
      const id = String(value.id ?? '').trim()
      if (!id) continue
      store.put(value)
    }
  }

  const preferences = safeJsonParse(storage.getItem(LEGACY_KEYS.preferences) ?? '')
  if (preferences && typeof preferences === 'object') {
    tx.objectStore(STORE_KV).put({ key: KV_KEYS.preferenceLearnerState, value: preferences })
  }

  const favorites = safeJsonParse(storage.getItem(LEGACY_KEYS.favorites) ?? '')
  if (favorites) {
    tx.objectStore(STORE_KV).put({ key: KV_KEYS.favorites, value: favorites })
  }

  const presets = safeJsonParse(storage.getItem(LEGACY_KEYS.moodSearchPresets) ?? '')
  if (presets) {
    tx.objectStore(STORE_KV).put({ key: KV_KEYS.moodSearchPresets, value: presets })
  }
}

async function openDb() {
  if (typeof indexedDB === 'undefined') return null
  if (dbPromise) return dbPromise

  const openAttempt = (requestedVersion) =>
    new Promise((resolve, reject) => {
      const request =
        typeof requestedVersion === 'number'
          ? indexedDB.open(DB_NAME, requestedVersion)
          : indexedDB.open(DB_NAME)

      request.onupgradeneeded = () => {
        const db = request.result
        const tx = request.transaction
        runMigrations(db, tx, request.oldVersion, request.result.version)
      }

      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => {
          try {
            db.close()
          } catch {
            return
          }
          dbPromise = null
        }
        resolve(db)
      }

      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
      request.onblocked = () => reject(new Error('IndexedDB open blocked'))
    })

  dbPromise = (async () => {
    try {
      return await openAttempt(DB_VERSION)
    } catch (error) {
      dbPromise = null
      if (error?.name !== 'VersionError') throw error

      const db = await openAttempt()
      if (hasRequiredStores(db)) return db

      try {
        db.close()
      } catch {
        return db
      }

      await deleteDatabase(DB_NAME)
      return await openAttempt(DB_VERSION)
    }
  })()

  return dbPromise
}

async function withStore(storeName, mode, run) {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const store = tx.objectStore(storeName)
    let result
    try {
      result = run(store, tx)
    } catch (error) {
      reject(error)
      return
    }

    tx.oncomplete = () => resolve(result ?? null)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

async function withStores(storeNames, mode, run) {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode)
    const stores = Object.fromEntries(storeNames.map((name) => [name, tx.objectStore(name)]))
    let result
    try {
      result = run(stores, tx)
    } catch (error) {
      reject(error)
      return
    }

    tx.oncomplete = () => resolve(result ?? null)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

function deriveApodIndexFields({ analysisKey, analysis }) {
  const moodTags = uniqueList((analysis?.moods ?? []).map(normalizeToken).filter(Boolean))
  const subjects = uniqueList((analysis?.subjects ?? []).map(normalizeToken).filter(Boolean))
  const colorValues = uniqueList(
    (analysis?.dominantColors ?? [])
      .map((c) => normalizeHex(c?.hex))
      .filter(Boolean),
  )

  return {
    analysisKey: analysisKey || null,
    moodTags,
    subjects,
    colorValues,
  }
}

export async function storeApodItem(item, { analysis, fetchedAt = Date.now() } = {}) {
  const date = normalizeDateString(item?.date)
  if (!date) return null
  const analysisKey = String(item?.hdurl || item?.url || '').trim() || null
  const indexes = deriveApodIndexFields({ analysisKey, analysis })

  const record = {
    date,
    title: item?.title ?? null,
    url: item?.url ?? null,
    hdurl: item?.hdurl ?? null,
    explanation: item?.explanation ?? null,
    copyright: item?.copyright ?? null,
    fetchedAt: Number(fetchedAt) || Date.now(),
    updatedAt: Date.now(),
    ...indexes,
  }

  await withStore(STORE_APODS, 'readwrite', (store) => store.put(record))
  
  // Async background sync to Supabase if possible
  void saveApodToDb(record).catch(() => null)
  
  return record
}

export async function storeApodItems(items, { fetchedAt = Date.now() } = {}) {
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) return []

  const now = Date.now()
  const baseFetchedAt = Number(fetchedAt) || now

  const stored = []
  await withStore(STORE_APODS, 'readwrite', (store) => {
    for (const item of list) {
      const date = normalizeDateString(item?.date)
      if (!date) continue
      const analysisKey = String(item?.hdurl || item?.url || '').trim() || null
      const record = {
        date,
        title: item?.title ?? null,
        url: item?.url ?? null,
        hdurl: item?.hdurl ?? null,
        explanation: item?.explanation ?? null,
        copyright: item?.copyright ?? null,
        fetchedAt: baseFetchedAt,
        updatedAt: now,
        analysisKey,
        moodTags: [],
        subjects: [],
        colorValues: [],
      }
      store.put(record)
      stored.push(record)
    }
  })

  return stored
}

export async function getApodItemByDate(date) {
  const key = normalizeDateString(date)
  if (!key) return null
  
  // Try local first for speed
  const record = await withStore(STORE_APODS, 'readonly', (store) => store.get(key))
  if (record) return record

  // If not found local, try Supabase
  const cloudRecord = await getApodFromDb(key)
  if (cloudRecord) {
    // Cache it locally
    void withStore(STORE_APODS, 'readwrite', (store) => store.put(cloudRecord)).catch(() => null)
    return cloudRecord
  }

  return null
}

export async function getApodItemsByDateRange(startDate, endDate) {
  const start = normalizeDateString(startDate)
  const end = normalizeDateString(endDate)
  if (!start || !end) return []

  const keyRange = IDBKeyRange.bound(start, end)

  const results = []
  await withStore(STORE_APODS, 'readonly', (store) => {
    const index = store.index('byDate')
    const request = index.openCursor(keyRange)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      results.push(cursor.value)
      cursor.continue()
    }
  })

  results.sort((a, b) => (String(a?.date) < String(b?.date) ? -1 : 1))
  return results
}

export async function queryApodsByMoodTag(moodTag, { limit = 200 } = {}) {
  const tag = normalizeToken(moodTag)
  if (!tag) return []

  const results = []
  await withStore(STORE_APODS, 'readonly', (store) => {
    const index = store.index('byMoodTag')
    const request = index.openCursor(IDBKeyRange.only(tag))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      results.push(cursor.value)
      if (results.length >= limit) return
      cursor.continue()
    }
  })

  results.sort((a, b) => String(b?.date).localeCompare(String(a?.date)))
  return results
}

export async function queryApodsBySubject(subject, { limit = 200 } = {}) {
  const key = normalizeToken(subject)
  if (!key) return []

  const results = []
  await withStore(STORE_APODS, 'readonly', (store) => {
    const index = store.index('bySubject')
    const request = index.openCursor(IDBKeyRange.only(key))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      results.push(cursor.value)
      if (results.length >= limit) return
      cursor.continue()
    }
  })

  results.sort((a, b) => String(b?.date).localeCompare(String(a?.date)))
  return results
}

export async function queryApodsByColor(colorHex, { limit = 200 } = {}) {
  const key = normalizeHex(colorHex)
  if (!key) return []

  const results = []
  await withStore(STORE_APODS, 'readonly', (store) => {
    const index = store.index('byColor')
    const request = index.openCursor(IDBKeyRange.only(key))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      results.push(cursor.value)
      if (results.length >= limit) return
      cursor.continue()
    }
  })

  results.sort((a, b) => String(b?.date).localeCompare(String(a?.date)))
  return results
}

export async function getImageAnalysisRecord(key) {
  const cacheKey = String(key ?? '').trim()
  if (!cacheKey) return null
  const record = await withStore(STORE_IMAGE_ANALYSIS, 'readonly', (store) => store.get(cacheKey))
  return record ?? null
}

export async function setImageAnalysisRecord(key, record) {
  const cacheKey = String(key ?? '').trim()
  if (!cacheKey) return null

  const now = Date.now()
  const value = {
    key: cacheKey,
    version: record?.version ?? null,
    createdAt: Number(record?.createdAt) || now,
    updatedAt: now,
    features: record?.features ?? null,
  }

  await withStores([STORE_IMAGE_ANALYSIS, STORE_APODS], 'readwrite', (stores) => {
    stores[STORE_IMAGE_ANALYSIS].put(value)
    const analysis = value.features
    const indexes = deriveApodIndexFields({ analysisKey: cacheKey, analysis })
    const request = stores[STORE_APODS].index('byAnalysisKey').openCursor(IDBKeyRange.only(cacheKey))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const next = {
        ...cursor.value,
        ...indexes,
        updatedAt: Date.now(),
      }
      cursor.update(next)
      cursor.continue()
    }
  })

  return value
}

export async function deleteImageAnalysisRecord(key) {
  const cacheKey = String(key ?? '').trim()
  if (!cacheKey) return
  await withStore(STORE_IMAGE_ANALYSIS, 'readwrite', (store) => store.delete(cacheKey))
}

export async function getKv(key) {
  const k = String(key ?? '').trim()
  if (!k) return null
  const record = await withStore(STORE_KV, 'readonly', (store) => store.get(k))
  return record?.value ?? null
}

export async function setKv(key, value) {
  const k = String(key ?? '').trim()
  if (!k) return
  await withStore(STORE_KV, 'readwrite', (store) => store.put({ key: k, value }))
}

export async function deleteKv(key) {
  const k = String(key ?? '').trim()
  if (!k) return
  await withStore(STORE_KV, 'readwrite', (store) => store.delete(k))
}

export async function getCollectionsIdb() {
  const results = []
  await withStore(STORE_COLLECTIONS, 'readonly', (store) => {
    const index = store.index('byUpdatedAt')
    const request = index.openCursor(null, 'prev')
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      results.push(cursor.value)
      cursor.continue()
    }
  })
  return results
}

export async function getCollectionIdb(id) {
  const key = String(id ?? '').trim()
  if (!key) return null
  const record = await withStore(STORE_COLLECTIONS, 'readonly', (store) => store.get(key))
  return record ?? null
}

export async function upsertCollectionIdb(collection) {
  const id = String(collection?.id ?? '').trim() || null
  if (!id) return null
  const nowIso = new Date().toISOString()
  const record = {
    ...(collection && typeof collection === 'object' ? collection : {}),
    id,
    updatedAt: nowIso,
    createdAt: collection?.createdAt ?? nowIso,
  }
  await withStore(STORE_COLLECTIONS, 'readwrite', (store) => store.put(record))
  return record
}

export async function deleteCollectionIdb(id) {
  const key = String(id ?? '').trim()
  if (!key) return
  await withStore(STORE_COLLECTIONS, 'readwrite', (store) => store.delete(key))
}

export async function getStorageEstimate() {
  if (typeof navigator === 'undefined') return null
  if (!navigator.storage?.estimate) return null
  try {
    const estimate = await navigator.storage.estimate()
    const usage = Number(estimate?.usage ?? 0)
    const quota = Number(estimate?.quota ?? 0)
    const ratio = quota > 0 ? usage / quota : 0
    return { usage, quota, ratio }
  } catch {
    return null
  }
}

export async function getStoragePersisted() {
  if (typeof navigator === 'undefined') return null
  if (!navigator.storage?.persisted) return null
  try {
    return await navigator.storage.persisted()
  } catch {
    return null
  }
}

export async function clearCache({ preserveUserData = true } = {}) {
  if (typeof indexedDB === 'undefined') return
  const stores = preserveUserData
    ? [STORE_APODS, STORE_IMAGE_ANALYSIS]
    : [STORE_APODS, STORE_IMAGE_ANALYSIS, STORE_COLLECTIONS, STORE_KV, STORE_META]

  await withStores(stores, 'readwrite', (s) => {
    for (const store of Object.values(s)) store.clear()
  })
}

export async function exportUserData({ includeCache = false } = {}) {
  const payload = await withStores(
    includeCache
      ? [STORE_COLLECTIONS, STORE_KV, STORE_META, STORE_APODS, STORE_IMAGE_ANALYSIS]
      : [STORE_COLLECTIONS, STORE_KV, STORE_META],
    'readonly',
    (stores) => {
      const readAll = (store) =>
        new Promise((resolve) => {
          const req = store.getAll()
          req.onsuccess = () => resolve(req.result ?? [])
          req.onerror = () => resolve([])
        })

      const collections = readAll(stores[STORE_COLLECTIONS])
      const kv = readAll(stores[STORE_KV])
      const meta = readAll(stores[STORE_META])
      const apods = includeCache ? readAll(stores[STORE_APODS]) : Promise.resolve([])
      const analysis = includeCache ? readAll(stores[STORE_IMAGE_ANALYSIS]) : Promise.resolve([])

      return Promise.all([collections, kv, meta, apods, analysis]).then(([c, k, m, a, i]) => ({
        exportedAt: new Date().toISOString(),
        schemaVersion: DB_VERSION,
        includeCache: Boolean(includeCache),
        collections: c,
        kv: k,
        meta: m,
        apods: a,
        imageAnalysis: i,
      }))
    },
  )

  return JSON.stringify(payload ?? {}, null, 2)
}

export async function importUserData(jsonText, { replace = false } = {}) {
  const parsed = safeJsonParse(jsonText)
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'Invalid JSON' }

  const collections = Array.isArray(parsed.collections) ? parsed.collections : []
  const kv = Array.isArray(parsed.kv) ? parsed.kv : []
  const meta = Array.isArray(parsed.meta) ? parsed.meta : []
  const apods = Array.isArray(parsed.apods) ? parsed.apods : []
  const analysis = Array.isArray(parsed.imageAnalysis) ? parsed.imageAnalysis : []

  const storeNames = uniqueList([
    STORE_COLLECTIONS,
    STORE_KV,
    STORE_META,
    ...(apods.length > 0 ? [STORE_APODS] : []),
    ...(analysis.length > 0 ? [STORE_IMAGE_ANALYSIS] : []),
  ])

  await withStores(storeNames, 'readwrite', (stores) => {
    if (replace) {
      for (const store of Object.values(stores)) store.clear()
    }

    for (const item of collections) {
      if (!item || typeof item !== 'object') continue
      const id = String(item.id ?? '').trim()
      if (!id) continue
      stores[STORE_COLLECTIONS]?.put(item)
    }

    for (const item of kv) {
      const key = String(item?.key ?? '').trim()
      if (!key) continue
      stores[STORE_KV]?.put({ key, value: item?.value ?? null })
    }

    for (const item of meta) {
      const key = String(item?.key ?? '').trim()
      if (!key) continue
      stores[STORE_META]?.put({ key, value: item?.value ?? null })
    }

    for (const item of apods) {
      const date = normalizeDateString(item?.date)
      if (!date) continue
      stores[STORE_APODS]?.put({ ...item, date })
    }

    for (const item of analysis) {
      const key = String(item?.key ?? '').trim()
      if (!key) continue
      stores[STORE_IMAGE_ANALYSIS]?.put({ ...item, key })
    }
  })

  return { ok: true }
}

export async function getApodSyncState() {
  const record = await withStore(STORE_META, 'readonly', (store) => store.get(META_KEYS.apodSync))
  return record?.value ?? null
}

export async function setApodSyncState(value) {
  await withStore(STORE_META, 'readwrite', (store) => store.put({ key: META_KEYS.apodSync, value }))
}

export const storageKeys = KV_KEYS
