import { deltaE76, hexToLab, normalizeHex } from '../utils/colorTools'

const cancelledIds = new Set()

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

self.onmessage = async (event) => {
  const message = event?.data
  if (!message || typeof message !== 'object') return

  if (message.type === 'cancel') {
    if (message.id != null) cancelledIds.add(message.id)
    return
  }

  if (message.type !== 'filter') return

  const id = message.id
  const cancelled = () => cancelledIds.has(id)

  try {
    const rows = Array.isArray(message.rows) ? message.rows : []
    const includeUnanalyzed = Boolean(message.includeUnanalyzed)
    const t = clamp(Number(message.threshold) || 0, 0, 60)
    const targetHex = normalizeHex(message.targetHex)
    const targetLab = targetHex ? hexToLab(targetHex) : null

    if (!targetLab || !Number.isFinite(t)) {
      self.postMessage({ type: 'result', id, ok: true, payload: rows.map((r) => r.key).filter(Boolean) })
      return
    }

    const keys = []
    for (const row of rows) {
      if (cancelled()) throw new Error('aborted')
      const key = row?.key
      if (!key) continue
      const hasAnalysis = Boolean(row?.hasAnalysis)
      if (!hasAnalysis) {
        if (includeUnanalyzed) keys.push(key)
        continue
      }
      const swatches = Array.isArray(row?.swatches) ? row.swatches : []
      let match = false
      for (const hex of swatches) {
        if (cancelled()) throw new Error('aborted')
        const cand = normalizeHex(hex)
        if (!cand) continue
        const lab = hexToLab(cand)
        if (deltaE76(targetLab, lab) <= t) {
          match = true
          break
        }
      }
      if (match) keys.push(key)
      if (keys.length % 120 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }

    self.postMessage({ type: 'result', id, ok: true, payload: keys })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    self.postMessage({ type: 'result', id, ok: false, error: message })
  } finally {
    cancelledIds.delete(id)
  }
}

