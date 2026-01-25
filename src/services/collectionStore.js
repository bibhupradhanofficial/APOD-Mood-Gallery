const COLLECTIONS_KEY = 'apod-collections:v1'

function safeJsonParse(raw) {
  try {
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function readAllCollections() {
  try {
    if (typeof window === 'undefined') return {}
    const raw = window.localStorage?.getItem(COLLECTIONS_KEY)
    const parsed = safeJsonParse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch {
    return {}
  }
}

function writeAllCollections(map) {
  try {
    if (typeof window === 'undefined') return
    window.localStorage?.setItem(COLLECTIONS_KEY, JSON.stringify(map))
  } catch {
    return
  }
}

function randomId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function toBase64Url(text) {
  const utf8 = encodeURIComponent(text).replace(/%([0-9A-F]{2})/g, (_, p1) =>
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

export function createCollectionId() {
  return randomId()
}

export function upsertCollection(collection) {
  const id = String(collection?.id ?? '').trim() || createCollectionId()
  const now = new Date().toISOString()
  const current = readAllCollections()
  const prev = current[id]
  const next = {
    ...(prev && typeof prev === 'object' ? prev : {}),
    ...collection,
    id,
    updatedAt: now,
    createdAt: prev?.createdAt ?? collection?.createdAt ?? now,
  }
  current[id] = next
  writeAllCollections(current)
  return next
}

export function loadCollection(id) {
  const key = String(id ?? '').trim()
  if (!key) return null
  const all = readAllCollections()
  const entry = all[key]
  return entry && typeof entry === 'object' ? entry : null
}

export function listCollections() {
  const all = readAllCollections()
  return Object.values(all)
    .filter((v) => v && typeof v === 'object')
    .sort((a, b) => String(b?.updatedAt ?? '').localeCompare(String(a?.updatedAt ?? '')))
}

export function deleteCollection(id) {
  const key = String(id ?? '').trim()
  if (!key) return
  const all = readAllCollections()
  if (!all[key]) return
  delete all[key]
  writeAllCollections(all)
}

export function buildShareUrl({ id, payload }) {
  if (typeof window === 'undefined') return ''
  const url = new URL(window.location.href)
  url.searchParams.set('collection', String(id))
  if (payload) url.searchParams.set('payload', String(payload))
  return url.toString()
}

export function getCollectionIdFromLocation() {
  if (typeof window === 'undefined') return null
  const url = new URL(window.location.href)
  const id = url.searchParams.get('collection')
  return id ? String(id) : null
}

export function getSharePayloadFromLocation() {
  if (typeof window === 'undefined') return null
  const url = new URL(window.location.href)
  const payload = url.searchParams.get('payload')
  return payload ? String(payload) : null
}

export function encodeCollectionPayload(collection) {
  const json = JSON.stringify(collection ?? {})
  return toBase64Url(json)
}

export function decodeCollectionPayload(payload) {
  try {
    const json = fromBase64Url(payload)
    const parsed = safeJsonParse(json)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

