import { getMoodConfidenceScores, classifyMoods } from '../utils'
import { deleteImageAnalysisRecord, getImageAnalysisRecord, setImageAnalysisRecord } from './storageService'
import { analyzePixelFeaturesInWorker } from './pixelAnalysisWorkerClient'

const ANALYSIS_VERSION = 1

const DEFAULT_FEATURES = Object.freeze({
  dominantColors: [],
  subjects: [],
  brightness: 0,
  temperature: 'cool',
  complexity: 0,
})

let tfModulePromise
let mobilenetPromise
let modelPromise

function getErrorMessage(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

function isAbortError(error) {
  return (
    error?.name === 'AbortError' ||
    (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError')
  )
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const abortError = new DOMException('Aborted', 'AbortError')
    throw abortError
  }
}

function yieldToMain({ signal } = {}) {
  throwIfAborted(signal)

  if (typeof requestIdleCallback === 'function') {
    return new Promise((resolve, reject) => {
      const id = requestIdleCallback(
        () => {
          try {
            throwIfAborted(signal)
            resolve()
          } catch (error) {
            reject(error)
          }
        },
        { timeout: 100 }
      )

      signal?.addEventListener(
        'abort',
        () => {
          cancelIdleCallback(id)
          reject(new DOMException('Aborted', 'AbortError'))
        },
        { once: true }
      )
    })
  }

  return new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      try {
        throwIfAborted(signal)
        resolve()
      } catch (error) {
        reject(error)
      }
    }, 0)

    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(id)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true }
    )
  })
}


async function ensureTensorflowReady({ signal } = {}) {
  throwIfAborted(signal)

  if (!tfModulePromise) {
    tfModulePromise = import('@tensorflow/tfjs')
  }

  const tf = await tfModulePromise
  await tf.ready()
  return tf
}

export async function initImageAnalysis({ signal } = {}) {
  throwIfAborted(signal)

  if (!mobilenetPromise) {
    mobilenetPromise = import('@tensorflow-models/mobilenet')
  }

  if (!modelPromise) {
    modelPromise = (async () => {
      await ensureTensorflowReady({ signal })
      const mobilenet = await mobilenetPromise
      return mobilenet.load({ version: 2, alpha: 1.0 })
    })()
  }

  const model = await modelPromise
  return model
}

function createCanvas(size) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  return canvas
}

async function loadImageFromUrl(url, { signal } = {}) {
  throwIfAborted(signal)

  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'

    const cleanup = () => {
      image.onload = null
      image.onerror = null
    }

    image.onload = () => {
      cleanup()
      resolve(image)
    }

    image.onerror = () => {
      cleanup()
      reject(new Error(`Failed to load image: ${url}`))
    }

    signal?.addEventListener(
      'abort',
      () => {
        cleanup()
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true }
    )

    image.src = url
  })
}

async function resolveImageInput(input, { signal } = {}) {
  throwIfAborted(signal)

  if (typeof input === 'string') {
    return loadImageFromUrl(input, { signal })
  }

  return input
}

function normalizeToSquareCanvas(imageLike, { maxSize = 256 } = {}) {
  const width = Number(imageLike?.width ?? 0)
  const height = Number(imageLike?.height ?? 0)
  const size = Math.max(1, Math.min(maxSize, Math.max(width, height)))
  const canvas = createCanvas(size)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { canvas, ctx: null }

  const scale = size / Math.max(width, height)
  const drawWidth = Math.max(1, Math.floor(width * scale))
  const drawHeight = Math.max(1, Math.floor(height * scale))

  const dx = Math.floor((size - drawWidth) / 2)
  const dy = Math.floor((size - drawHeight) / 2)

  ctx.clearRect(0, 0, size, size)
  ctx.drawImage(imageLike, dx, dy, drawWidth, drawHeight)
  return { canvas, ctx }
}

function rgbToHex(r, g, b) {
  return (
    '#' +
    [r, g, b]
      .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'))
      .join('')
  )
}

function quantizeRgb(r, g, b) {
  const rq = r >> 3
  const gq = g >> 3
  const bq = b >> 3
  return (rq << 10) | (gq << 5) | bq
}

function dequantizeRgb(bucket) {
  const bq = bucket & 31
  const gq = (bucket >> 5) & 31
  const rq = (bucket >> 10) & 31
  return {
    r: rq * 8 + 4,
    g: gq * 8 + 4,
    b: bq * 8 + 4,
  }
}

async function extractPixelFeatures(ctx, width, height, { signal } = {}) {
  throwIfAborted(signal)

  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data

  const counts = new Map()
  const totalPixels = width * height
  const targetSamples = Math.min(45000, totalPixels)
  const stride = Math.max(1, Math.floor(Math.sqrt(totalPixels / targetSamples)))

  let samples = 0
  let luminanceSum = 0
  let luminanceSqSum = 0
  let warmthSum = 0
  let chromaSum = 0

  const yieldEverySamples = 6000

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const index = (y * width + x) * 4
      const r = data[index]
      const g = data[index + 1]
      const b = data[index + 2]

      const bucket = quantizeRgb(r, g, b)
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1)

      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      luminanceSum += luminance
      luminanceSqSum += luminance * luminance

      warmthSum += (r - b) / 255
      chromaSum += (Math.max(r, g, b) - Math.min(r, g, b)) / 255

      samples += 1
      if (samples % yieldEverySamples === 0) {
        await yieldToMain({ signal })
      }
    }
  }

  const brightness = samples > 0 ? luminanceSum / samples : 0
  const variance = samples > 1 ? luminanceSqSum / samples - brightness * brightness : 0
  const luminanceStd = Math.sqrt(Math.max(0, variance))

  const warmth = samples > 0 ? warmthSum / samples : 0
  const avgChroma = samples > 0 ? chromaSum / samples : 0

  const dominantColors = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([bucket, count]) => {
      const rgb = dequantizeRgb(bucket)
      return {
        hex: rgbToHex(rgb.r, rgb.g, rgb.b),
        rgb: [rgb.r, rgb.g, rgb.b],
        weight: count / samples,
      }
    })

  const distinctBuckets = counts.size
  let entropy = 0
  for (const count of counts.values()) {
    const p = count / samples
    if (p > 0) entropy -= p * Math.log(p)
  }
  const normalizedEntropy =
    distinctBuckets > 1 ? entropy / Math.log(Math.min(distinctBuckets, 1024)) : 0

  const complexity = Math.max(
    0,
    Math.min(1, 0.55 * normalizedEntropy + 0.35 * luminanceStd + 0.1 * avgChroma)
  )

  const temperature = warmth >= 0.03 ? 'warm' : 'cool'

  return {
    dominantColors,
    brightness: Math.max(0, Math.min(1, brightness)),
    temperature,
    complexity,
  }
}

const SUBJECT_RULES = [
  { subject: 'galaxies', patterns: ['galaxy', 'milky way', 'andromeda'] },
  { subject: 'nebulae', patterns: ['nebula', 'orion', 'carina'] },
  { subject: 'planets', patterns: ['planet', 'saturn', 'jupiter', 'mars', 'venus', 'mercury'] },
  { subject: 'moons', patterns: ['moon', 'lunar'] },
  { subject: 'stars', patterns: ['star', 'sun'] },
  { subject: 'comets', patterns: ['comet'] },
  { subject: 'asteroids', patterns: ['asteroid', 'meteor'] },
  { subject: 'rockets', patterns: ['rocket', 'missile', 'space shuttle'] },
  { subject: 'satellites', patterns: ['satellite', 'space station', 'iss'] },
  { subject: 'telescopes', patterns: ['telescope', 'observatory'] },
  { subject: 'earth', patterns: ['earth', 'globe'] },
]

function classifySubjects(predictions) {
  const subjects = new Set()

  for (const prediction of predictions ?? []) {
    const className = String(prediction?.className ?? '').toLowerCase()
    if (!className) continue

    for (const rule of SUBJECT_RULES) {
      if (rule.patterns.some((pattern) => className.includes(pattern))) {
        subjects.add(rule.subject)
      }
    }
  }

  return Array.from(subjects)
}

class AnalysisQueue {
  queue = []
  running = false

  enqueue(taskFn, { signal } = {}) {
    return new Promise((resolve, reject) => {
      throwIfAborted(signal)

      const job = { taskFn, resolve, reject, signal }
      this.queue.push(job)
      this.run()
    })
  }

  async run() {
    if (this.running) return
    this.running = true

    while (this.queue.length > 0) {
      const job = this.queue.shift()
      if (!job) continue

      try {
        throwIfAborted(job.signal)
        await yieldToMain({ signal: job.signal })
        const result = await job.taskFn()
        job.resolve(result)
      } catch (error) {
        job.reject(error)
      }
    }

    this.running = false
  }
}

const analysisQueue = new AnalysisQueue()

function getCacheKey(input, explicitKey) {
  if (explicitKey) return explicitKey
  if (typeof input === 'string') return input
  return null
}

async function getCachedFeatures(cacheKey, { maxAgeMs } = {}) {
  if (!cacheKey) return null

  try {
    const record = await getImageAnalysisRecord(cacheKey)
    if (!record || record.version !== ANALYSIS_VERSION) return null
    if (typeof maxAgeMs === 'number' && maxAgeMs > 0) {
      const ageMs = Date.now() - Number(record.createdAt ?? 0)
      if (Number.isFinite(ageMs) && ageMs > maxAgeMs) return null
    }
    return record.features ?? null
  } catch (error) {
    void error
    return null
  }
}

async function setCachedFeatures(cacheKey, features) {
  if (!cacheKey) return
  try {
    await setImageAnalysisRecord(cacheKey, {
      key: cacheKey,
      version: ANALYSIS_VERSION,
      createdAt: Date.now(),
      features,
    })
  } catch (error) {
    void error
    return
  }
}

async function analyzeNow(input, { signal } = {}) {
  throwIfAborted(signal)

  const imageLike = await resolveImageInput(input, { signal })
  if (!imageLike) return DEFAULT_FEATURES

  const { canvas, ctx } = normalizeToSquareCanvas(imageLike, { maxSize: 256 })
  if (!ctx) return DEFAULT_FEATURES

  let pixelFeatures = DEFAULT_FEATURES
  try {
    if (typeof input === 'string' && typeof Worker !== 'undefined') {
      pixelFeatures = await analyzePixelFeaturesInWorker(input, { signal, maxSize: 256 })
    } else {
      pixelFeatures = await extractPixelFeatures(ctx, canvas.width, canvas.height, { signal })
    }
  } catch (error) {
    if (isAbortError(error)) throw error
  }

  let subjects = []
  try {
    const model = await initImageAnalysis({ signal })
    const predictions = await model.classify(canvas, 5)
    subjects = classifySubjects(predictions)
  } catch (error) {
    if (isAbortError(error)) throw error
  }

  const features = {
    dominantColors: pixelFeatures.dominantColors,
    subjects,
    brightness: pixelFeatures.brightness,
    temperature: pixelFeatures.temperature,
    complexity: pixelFeatures.complexity,
  }

  const moodScores = getMoodConfidenceScores(features)
  const topMoods = classifyMoods(features, { topN: 3 })

  return {
    ...features,
    moods: topMoods,
    moodScores,
  }
}

export async function analyzeImage(input, options = {}) {
  const { cacheKey: explicitCacheKey, maxAgeMs, signal } = options
  throwIfAborted(signal)

  if (typeof indexedDB === 'undefined') {
    return analysisQueue.enqueue(() => analyzeNow(input, { signal }), { signal })
  }

  const cacheKey = getCacheKey(input, explicitCacheKey)
  const cached = await getCachedFeatures(cacheKey, { maxAgeMs })
  if (cached) return cached

  const features = await analysisQueue.enqueue(() => analyzeNow(input, { signal }), { signal })
  await setCachedFeatures(cacheKey, features)
  return features
}

export async function deleteImageAnalysisCache(cacheKey) {
  if (typeof indexedDB === 'undefined') return
  if (!cacheKey) return
  await deleteImageAnalysisRecord(cacheKey)
}

export function getImageAnalysisDefaults() {
  return DEFAULT_FEATURES
}

export function getImageAnalysisVersion() {
  return ANALYSIS_VERSION
}

export function formatImageAnalysisError(error) {
  if (isAbortError(error)) return 'aborted'
  return getErrorMessage(error)
}
