let workerInstance
let nextId = 1

const pending = new Map()

function ensureWorker() {
  if (workerInstance) return workerInstance
  if (typeof Worker === 'undefined') return null
  workerInstance = new Worker(new URL('../workers/collectionSuggestions.worker.js', import.meta.url), { type: 'module' })
  workerInstance.onmessage = (event) => {
    const message = event?.data
    if (!message || typeof message !== 'object') return
    if (message.type !== 'result') return

    const id = message.id
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)

    if (message.ok) entry.resolve(message.payload)
    else entry.reject(new Error(message.error || 'Worker failed'))
  }
  return workerInstance
}

export function suggestCollectionCandidatesInWorker(
  { collectionItems, candidates, analysisByKey, profile, limit = 12 },
  options = {}
) {
  const worker = ensureWorker()
  if (!worker) return Promise.reject(new Error('Workers not supported'))

  const id = nextId++
  const signal = options?.signal

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const abortHandler = () => {
      pending.delete(id)
      try {
        worker.postMessage({ type: 'cancel', id })
      } catch {
        void 0
      }
      reject(new DOMException('Aborted', 'AbortError'))
    }

    if (signal) signal.addEventListener('abort', abortHandler, { once: true })

    pending.set(id, {
      resolve: (payload) => {
        if (signal) signal.removeEventListener('abort', abortHandler)
        resolve(payload)
      },
      reject: (error) => {
        if (signal) signal.removeEventListener('abort', abortHandler)
        reject(error)
      },
    })

    worker.postMessage({ type: 'suggest', id, collectionItems, candidates, analysisByKey, profile, limit })
  })
}

