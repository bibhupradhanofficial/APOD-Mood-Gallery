import { scoreCandidateAgainstProfile, getItemKey } from '../utils/collectionAI'

let nextCleanupTick = 0
const cancelledIds = new Set()

self.onmessage = async (event) => {
  const message = event?.data
  if (!message || typeof message !== 'object') return

  if (message.type === 'cancel') {
    if (message.id != null) cancelledIds.add(message.id)
    return
  }

  if (message.type !== 'suggest') return
  const id = message.id
  const cancelled = () => cancelledIds.has(id)

  try {
    const collectionItems = Array.isArray(message.collectionItems) ? message.collectionItems : []
    const candidates = Array.isArray(message.candidates) ? message.candidates : []
    const analysisByKey = message.analysisByKey ?? {}
    const profile = message.profile ?? null
    const limit = Math.max(1, Math.min(24, Number(message.limit) || 12))

    if (!profile || collectionItems.length === 0) {
      self.postMessage({ type: 'result', id, ok: true, payload: [] })
      return
    }

    const existing = new Set(collectionItems.map((item) => getItemKey(item)).filter(Boolean))

    const list = []
    for (const item of candidates) {
      if (cancelled()) throw new Error('aborted')
      const key = getItemKey(item)
      if (!key) continue
      if (existing.has(key)) continue
      const record = analysisByKey[key]
      if (!record?.features || !record?.moods) continue
      const scored = scoreCandidateAgainstProfile(item, record, profile)
      if (!scored) continue
      list.push({ item, key, ...scored })
      if (list.length % 75 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }

    list.sort((a, b) => b.total - a.total || String(b?.item?.date ?? '').localeCompare(String(a?.item?.date ?? '')))
    const sliced = list.slice(0, limit)
    self.postMessage({ type: 'result', id, ok: true, payload: sliced })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    self.postMessage({ type: 'result', id, ok: false, error: message })
  } finally {
    cancelledIds.delete(id)
    nextCleanupTick += 1
    if (nextCleanupTick % 30 === 0) {
      for (const value of cancelledIds) {
        if (typeof value === 'number' && value < id - 1000) cancelledIds.delete(value)
      }
    }
  }
}

