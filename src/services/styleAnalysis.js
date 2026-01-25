import { getKv, setKv } from './storageService.js'

const STYLE_CACHE_PREFIX = 'styleEmbedding:'
const STYLE_CACHE_VERSION = 1
const STYLE_MODEL_ID = 'mobilenet_v2_1.0_embedding'

let tfModulePromise
let mobilenetPromise
let modelPromise

function isAbortError(error) {
  return (
    error?.name === 'AbortError' ||
    (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError')
  )
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
}

function toKey(input, explicitKey) {
  if (explicitKey) return String(explicitKey)
  if (typeof input === 'string') return input
  if (input && typeof input === 'object' && typeof input.currentSrc === 'string') return input.currentSrc
  if (input && typeof input === 'object' && typeof input.src === 'string') return input.src
  return null
}

async function ensureTensorflowReady({ signal } = {}) {
  throwIfAborted(signal)
  if (!tfModulePromise) tfModulePromise = import('@tensorflow/tfjs')
  const tf = await tfModulePromise
  await tf.ready()
  return tf
}

export async function initStyleAnalysis({ signal } = {}) {
  throwIfAborted(signal)

  if (!mobilenetPromise) mobilenetPromise = import('@tensorflow-models/mobilenet')
  if (!modelPromise) {
    modelPromise = (async () => {
      await ensureTensorflowReady({ signal })
      const mobilenet = await mobilenetPromise
      return mobilenet.load({ version: 2, alpha: 1.0 })
    })()
  }

  return modelPromise
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
      { once: true },
    )

    image.src = url
  })
}

async function resolveImageInput(input, { signal } = {}) {
  throwIfAborted(signal)
  if (typeof input === 'string') return loadImageFromUrl(input, { signal })
  return input
}

function drawNormalizedSquare(imageLike, size) {
  const width = Number(imageLike?.width ?? 0)
  const height = Number(imageLike?.height ?? 0)
  const canvas = createCanvas(size)
  const ctx = canvas.getContext('2d', { willReadFrequently: false })
  if (!ctx) return { canvas, ctx: null }
  const sourceSize = Math.max(1, Math.max(width, height))
  const scale = size / sourceSize
  const drawWidth = Math.max(1, Math.floor(width * scale))
  const drawHeight = Math.max(1, Math.floor(height * scale))
  const dx = Math.floor((size - drawWidth) / 2)
  const dy = Math.floor((size - drawHeight) / 2)
  ctx.clearRect(0, 0, size, size)
  ctx.drawImage(imageLike, dx, dy, drawWidth, drawHeight)
  return { canvas, ctx }
}

function l2Normalize(vector) {
  const n = vector?.length ?? 0
  if (!n) return new Float32Array()
  let sumSq = 0
  for (let i = 0; i < n; i += 1) {
    const v = Number(vector[i]) || 0
    sumSq += v * v
  }
  const denom = Math.sqrt(sumSq) || 1
  const out = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    out[i] = (Number(vector[i]) || 0) / denom
  }
  return out
}

function toNumberArray(vector) {
  if (!vector) return []
  if (Array.isArray(vector)) return vector.map((v) => Number(v) || 0)
  const n = Number(vector.length) || 0
  const out = new Array(n)
  for (let i = 0; i < n; i += 1) out[i] = Number(vector[i]) || 0
  return out
}

async function getCachedEmbedding(cacheKey, { maxAgeMs } = {}) {
  if (!cacheKey) return null
  try {
    const record = await getKv(`${STYLE_CACHE_PREFIX}${cacheKey}`)
    if (!record || record.version !== STYLE_CACHE_VERSION) return null
    if (record.modelId !== STYLE_MODEL_ID) return null
    if (typeof maxAgeMs === 'number' && maxAgeMs > 0) {
      const ageMs = Date.now() - Number(record.createdAt ?? 0)
      if (Number.isFinite(ageMs) && ageMs > maxAgeMs) return null
    }
    const vec = record.vector
    if (!vec || !vec.length) return null
    return l2Normalize(vec)
  } catch (error) {
    void error
    return null
  }
}

async function setCachedEmbedding(cacheKey, vector) {
  if (!cacheKey) return
  const key = `${STYLE_CACHE_PREFIX}${cacheKey}`
  const record = {
    version: STYLE_CACHE_VERSION,
    modelId: STYLE_MODEL_ID,
    createdAt: Date.now(),
    vector: toNumberArray(vector),
  }
  try {
    await setKv(key, record)
  } catch (error) {
    void error
  }
}

export function cosineSimilarity(a, b) {
  const n = Math.min(Number(a?.length) || 0, Number(b?.length) || 0)
  if (!n) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < n; i += 1) {
    const va = Number(a[i]) || 0
    const vb = Number(b[i]) || 0
    dot += va * vb
    normA += va * va
    normB += vb * vb
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  if (!denom) return 0
  return dot / denom
}

export async function extractStyleEmbedding(input, options = {}) {
  const { cacheKey: explicitCacheKey, maxAgeMs, signal, imageSize = 224 } = options
  throwIfAborted(signal)

  if (typeof document === 'undefined') {
    throw new Error('Style embedding requires a browser environment')
  }

  const cacheKey = toKey(input, explicitCacheKey)
  const cached = await getCachedEmbedding(cacheKey, { maxAgeMs })
  if (cached) return cached

  const model = await initStyleAnalysis({ signal })
  const tf = await ensureTensorflowReady({ signal })
  const imageLike = await resolveImageInput(input, { signal })
  if (!imageLike) return new Float32Array()

  const { canvas } = drawNormalizedSquare(imageLike, imageSize)

  let embeddingTensor = null
  try {
    embeddingTensor = tf.tidy(() => model.infer(canvas, true))
    const data = await embeddingTensor.data()
    const normalized = l2Normalize(data)
    if (cacheKey) await setCachedEmbedding(cacheKey, normalized)
    return normalized
  } catch (error) {
    if (isAbortError(error)) throw error
    throw error
  } finally {
    if (embeddingTensor) embeddingTensor.dispose()
  }
}

export async function buildStyleDescriptor(input, options = {}) {
  const { signal, maxAgeMs, cacheKey: explicitCacheKey, includeAnalysis = true } = options
  throwIfAborted(signal)

  const item = input && typeof input === 'object' && !Array.isArray(input) ? input : null
  const url = item ? String(item?.hdurl || item?.url || '') : String(input ?? '')
  const cacheKey = toKey(url, explicitCacheKey)

  const analysis = includeAnalysis
    ? await import('./imageAnalysis.js').then((mod) => mod.analyzeImage(url, { cacheKey, maxAgeMs, signal }))
    : null
  const styleVector = await extractStyleEmbedding(url, { cacheKey, maxAgeMs, signal })

  return {
    id: item?.date ?? cacheKey ?? url,
    key: cacheKey ?? url,
    item: item ?? null,
    analysis,
    styleVector,
    url,
  }
}

async function asyncPool(concurrency, items, run) {
  const list = Array.isArray(items) ? items : []
  const limit = Math.max(1, Number(concurrency) || 2)
  const results = new Array(list.length)
  let nextIndex = 0

  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (nextIndex < list.length) {
      const idx = nextIndex
      nextIndex += 1
      results[idx] = await run(list[idx], idx)
    }
  })

  await Promise.all(workers)
  return results
}

export async function buildStyleIndex(items, options = {}) {
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) return []

  const { signal, concurrency = 2 } = options
  throwIfAborted(signal)

  return asyncPool(concurrency, list, async (item) => {
    try {
      return await buildStyleDescriptor(item, options)
    } catch (error) {
      if (isAbortError(error)) throw error
      return null
    }
  }).then((results) => results.filter(Boolean))
}

function clamp01(value) {
  const v = Number(value)
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

function parseHexChannel(hex) {
  const v = Number.parseInt(hex, 16)
  if (!Number.isFinite(v)) return 0
  return Math.min(255, Math.max(0, v))
}

function hexToRgb(hex) {
  const text = String(hex ?? '').trim()
  const m = /^#?([0-9a-fA-F]{6})$/.exec(text)
  if (!m) return null
  const raw = m[1]
  return {
    r: parseHexChannel(raw.slice(0, 2)),
    g: parseHexChannel(raw.slice(2, 4)),
    b: parseHexChannel(raw.slice(4, 6)),
  }
}

function meanColorVector(dominantColors) {
  const list = Array.isArray(dominantColors) ? dominantColors : []
  if (list.length === 0) return null
  let total = 0
  let r = 0
  let g = 0
  let b = 0
  for (const swatch of list) {
    const rgb = hexToRgb(swatch?.hex ?? swatch)
    if (!rgb) continue
    const w = clamp01(swatch?.pct ?? swatch?.weight ?? 1 / list.length) || 1 / list.length
    total += w
    r += rgb.r * w
    g += rgb.g * w
    b += rgb.b * w
  }
  if (!total) return null
  return { r: r / total / 255, g: g / total / 255, b: b / total / 255 }
}

function euclidean3(a, b) {
  const dx = (Number(a?.r) || 0) - (Number(b?.r) || 0)
  const dy = (Number(a?.g) || 0) - (Number(b?.g) || 0)
  const dz = (Number(a?.b) || 0) - (Number(b?.b) || 0)
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function jaccardSimilarity(a, b) {
  const aa = Array.isArray(a) ? a : []
  const bb = Array.isArray(b) ? b : []
  if (aa.length === 0 && bb.length === 0) return 0
  const setA = new Set(aa.map((v) => String(v ?? '').toLowerCase()).filter(Boolean))
  const setB = new Set(bb.map((v) => String(v ?? '').toLowerCase()).filter(Boolean))
  let intersection = 0
  for (const v of setA) {
    if (setB.has(v)) intersection += 1
  }
  const union = setA.size + setB.size - intersection
  if (!union) return 0
  return intersection / union
}

function compositionSimilarity(a, b) {
  const brightnessA = clamp01((Number(a?.brightness) || 0) / 100)
  const brightnessB = clamp01((Number(b?.brightness) || 0) / 100)
  const complexityA = clamp01((Number(a?.complexity) || 0) / 100)
  const complexityB = clamp01((Number(b?.complexity) || 0) / 100)
  const temperatureA = String(a?.temperature ?? '').toLowerCase()
  const temperatureB = String(b?.temperature ?? '').toLowerCase()
  const tempMatch = temperatureA && temperatureB && temperatureA === temperatureB ? 1 : 0
  const brightnessSim = 1 - Math.min(1, Math.abs(brightnessA - brightnessB))
  const complexitySim = 1 - Math.min(1, Math.abs(complexityA - complexityB))
  return 0.45 * brightnessSim + 0.45 * complexitySim + 0.1 * tempMatch
}

export function scoreStyleMatch(target, candidate, options = {}) {
  const weights = {
    visual: 0.7,
    color: 0.15,
    theme: 0.1,
    composition: 0.05,
    ...options.weights,
  }

  const targetVector = target?.styleVector ?? target?.embedding ?? target?.vector ?? null
  const candidateVector = candidate?.styleVector ?? candidate?.embedding ?? candidate?.vector ?? null
  const vectorSim = targetVector && candidateVector ? cosineSimilarity(targetVector, candidateVector) : 0
  const visualSim = clamp01((vectorSim + 1) / 2)

  const targetColors = meanColorVector(target?.analysis?.dominantColors ?? target?.dominantColors)
  const candidateColors = meanColorVector(candidate?.analysis?.dominantColors ?? candidate?.dominantColors)
  const colorSim =
    targetColors && candidateColors ? 1 - Math.min(1, euclidean3(targetColors, candidateColors) / Math.sqrt(3)) : 0

  const themeSim = jaccardSimilarity(target?.analysis?.subjects ?? target?.subjects, candidate?.analysis?.subjects ?? candidate?.subjects)
  const compSim = compositionSimilarity(target?.analysis ?? target, candidate?.analysis ?? candidate)

  const totalWeight = (Number(weights.visual) || 0) + (Number(weights.color) || 0) + (Number(weights.theme) || 0) + (Number(weights.composition) || 0) || 1

  const score = clamp01(
    (weights.visual * visualSim + weights.color * colorSim + weights.theme * themeSim + weights.composition * compSim) /
      totalWeight,
  )
  return {
    score,
    breakdown: {
      visual: (weights.visual * visualSim) / totalWeight,
      color: (weights.color * colorSim) / totalWeight,
      theme: (weights.theme * themeSim) / totalWeight,
      composition: (weights.composition * compSim) / totalWeight,
    },
  }
}

export function findSimilar(target, candidates, options = {}) {
  const list = Array.isArray(candidates) ? candidates : []
  const limit = Number(options.limit) || 24
  const minScore = typeof options.minScore === 'number' ? options.minScore : 0
  const targetId = options.targetId ?? target?.id ?? target?.key ?? target?.date ?? target?.url ?? null

  const scored = []
  for (const candidate of list) {
    const candidateId = candidate?.id ?? candidate?.key ?? candidate?.date ?? candidate?.url ?? null
    if (targetId && candidateId && String(candidateId) === String(targetId)) continue
    const { score, breakdown } = scoreStyleMatch(target, candidate, options)
    if (score < minScore) continue
    scored.push({ candidate, score, breakdown })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

function dot(a, b) {
  const n = Math.min(Number(a?.length) || 0, Number(b?.length) || 0)
  let s = 0
  for (let i = 0; i < n; i += 1) s += (Number(a[i]) || 0) * (Number(b[i]) || 0)
  return s
}

function squaredDistance(a, b) {
  const n = Math.min(Number(a?.length) || 0, Number(b?.length) || 0)
  let sum = 0
  for (let i = 0; i < n; i += 1) {
    const d = (Number(a[i]) || 0) - (Number(b[i]) || 0)
    sum += d * d
  }
  return sum
}

function mulberry32(seed) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let x = t
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function pickKMeansPlusPlus(vectors, k, rng) {
  const n = vectors.length
  const centers = []
  const first = Math.floor(rng() * n)
  centers.push(vectors[first])
  const distances = new Array(n).fill(0)

  while (centers.length < k) {
    let sum = 0
    for (let i = 0; i < n; i += 1) {
      let best = Infinity
      for (const c of centers) {
        best = Math.min(best, squaredDistance(vectors[i], c))
      }
      distances[i] = best
      sum += best
    }

    if (!sum) {
      centers.push(vectors[Math.floor(rng() * n)])
      continue
    }

    let r = rng() * sum
    let picked = 0
    for (let i = 0; i < n; i += 1) {
      r -= distances[i]
      if (r <= 0) {
        picked = i
        break
      }
    }
    centers.push(vectors[picked])
  }

  return centers.map((c) => Float32Array.from(c))
}

function meanOfAssigned(vectors, assignments, k, dims) {
  const sums = Array.from({ length: k }, () => new Float32Array(dims))
  const counts = new Array(k).fill(0)
  for (let i = 0; i < vectors.length; i += 1) {
    const cluster = assignments[i]
    if (cluster == null || cluster < 0 || cluster >= k) continue
    counts[cluster] += 1
    const v = vectors[i]
    const acc = sums[cluster]
    for (let d = 0; d < dims; d += 1) {
      acc[d] += Number(v[d]) || 0
    }
  }

  const centers = Array.from({ length: k }, () => new Float32Array(dims))
  for (let c = 0; c < k; c += 1) {
    const denom = counts[c] || 1
    for (let d = 0; d < dims; d += 1) centers[c][d] = sums[c][d] / denom
  }
  return centers
}

export function kMeans(vectorsInput, kInput, options = {}) {
  const vectors = (Array.isArray(vectorsInput) ? vectorsInput : []).filter((v) => (v?.length ?? 0) > 0)
  const n = vectors.length
  if (!n) return { k: 0, centroids: [], assignments: [], iterations: 0, inertia: 0 }

  const dims = Number(vectors[0]?.length) || 0
  const k = Math.max(1, Math.min(Number(kInput) || 1, n))
  const maxIterations = Math.max(1, Number(options.maxIterations) || 50)
  const seed = Number(options.seed) || 42
  const rng = mulberry32(seed)

  let centroids = pickKMeansPlusPlus(vectors, k, rng)
  let assignments = new Array(n).fill(-1)
  let iterations = 0

  for (; iterations < maxIterations; iterations += 1) {
    let changed = 0
    for (let i = 0; i < n; i += 1) {
      let best = 0
      let bestDist = Infinity
      for (let c = 0; c < k; c += 1) {
        const dist = squaredDistance(vectors[i], centroids[c])
        if (dist < bestDist) {
          bestDist = dist
          best = c
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best
        changed += 1
      }
    }

    centroids = meanOfAssigned(vectors, assignments, k, dims)
    if (!changed) break
  }

  let inertia = 0
  for (let i = 0; i < n; i += 1) inertia += squaredDistance(vectors[i], centroids[assignments[i]])

  return {
    k,
    centroids,
    assignments,
    iterations,
    inertia,
  }
}

export function createStyleFamilies(descriptors, options = {}) {
  const list = Array.isArray(descriptors) ? descriptors : []
  const vectors = []
  const keyed = []
  for (const item of list) {
    const v = item?.styleVector ?? item?.embedding ?? item?.vector
    if (!v || !v.length) continue
    keyed.push(item)
    vectors.push(v)
  }
  if (vectors.length === 0) return { families: [], assignments: [], centroids: [] }

  const k = Number(options.k) || Math.max(2, Math.round(Math.sqrt(vectors.length / 2)))
  const result = kMeans(vectors, k, options)

  const families = Array.from({ length: result.k }, (_, idx) => ({
    id: `family-${idx}`,
    centroid: result.centroids[idx],
    members: [],
  }))

  for (let i = 0; i < keyed.length; i += 1) {
    const cluster = result.assignments[i]
    if (cluster == null || cluster < 0) continue
    families[cluster]?.members.push(keyed[i])
  }

  families.sort((a, b) => b.members.length - a.members.length)
  return {
    families,
    assignments: result.assignments,
    centroids: result.centroids,
  }
}

function covarianceMul(centeredRows, v) {
  const n = centeredRows.length
  const dims = Number(v?.length) || 0
  const tmp = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    tmp[i] = dot(centeredRows[i], v)
  }
  const out = new Float32Array(dims)
  const scale = n > 1 ? 1 / (n - 1) : 1
  for (let d = 0; d < dims; d += 1) {
    let s = 0
    for (let i = 0; i < n; i += 1) {
      s += (Number(centeredRows[i][d]) || 0) * tmp[i]
    }
    out[d] = s * scale
  }
  return out
}

function normalizeVector(v) {
  const n = Number(v?.length) || 0
  if (!n) return new Float32Array()
  let sumSq = 0
  for (let i = 0; i < n; i += 1) sumSq += (Number(v[i]) || 0) ** 2
  const denom = Math.sqrt(sumSq) || 1
  const out = new Float32Array(n)
  for (let i = 0; i < n; i += 1) out[i] = (Number(v[i]) || 0) / denom
  return out
}

function orthogonalize(v, basis) {
  let out = Float32Array.from(v)
  for (const b of basis) {
    const proj = dot(out, b)
    for (let i = 0; i < out.length; i += 1) out[i] -= proj * (Number(b[i]) || 0)
  }
  return out
}

function randomUnitVector(dims, rng) {
  const v = new Float32Array(dims)
  for (let i = 0; i < dims; i += 1) v[i] = (rng() * 2 - 1) * 0.5
  return normalizeVector(v)
}

function powerIteration(centeredRows, { iters = 18, seed = 1, orthogonalTo = [] } = {}) {
  const dims = Number(centeredRows?.[0]?.length) || 0
  const rng = mulberry32(seed)
  let v = randomUnitVector(dims, rng)
  if (orthogonalTo.length) v = normalizeVector(orthogonalize(v, orthogonalTo))

  for (let i = 0; i < iters; i += 1) {
    let next = covarianceMul(centeredRows, v)
    if (orthogonalTo.length) next = orthogonalize(next, orthogonalTo)
    v = normalizeVector(next)
  }
  return v
}

export function projectTo2D(descriptors, options = {}) {
  const list = Array.isArray(descriptors) ? descriptors : []
  const keyed = []
  const rows = []
  for (const item of list) {
    const v = item?.styleVector ?? item?.embedding ?? item?.vector
    if (!v || !v.length) continue
    keyed.push(item)
    rows.push(Float32Array.from(v))
  }
  const n = rows.length
  if (!n) return { points: [], basis: [] }
  const dims = Number(rows[0].length) || 0

  const mean = new Float32Array(dims)
  for (const row of rows) {
    for (let d = 0; d < dims; d += 1) mean[d] += Number(row[d]) || 0
  }
  for (let d = 0; d < dims; d += 1) mean[d] /= n

  const centered = rows.map((row) => {
    const out = new Float32Array(dims)
    for (let d = 0; d < dims; d += 1) out[d] = (Number(row[d]) || 0) - mean[d]
    return out
  })

  const seed = Number(options.seed) || 7
  const pc1 = powerIteration(centered, { seed, iters: Number(options.iters) || 18 })
  const pc2 = powerIteration(centered, { seed: seed + 1, iters: Number(options.iters) || 18, orthogonalTo: [pc1] })

  const xs = new Float32Array(n)
  const ys = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    xs[i] = dot(centered[i], pc1)
    ys[i] = dot(centered[i], pc2)
  }

  let meanX = 0
  let meanY = 0
  for (let i = 0; i < n; i += 1) {
    meanX += xs[i]
    meanY += ys[i]
  }
  meanX /= n
  meanY /= n

  let varX = 0
  let varY = 0
  for (let i = 0; i < n; i += 1) {
    varX += (xs[i] - meanX) ** 2
    varY += (ys[i] - meanY) ** 2
  }
  const stdX = Math.sqrt(varX / Math.max(1, n - 1)) || 1
  const stdY = Math.sqrt(varY / Math.max(1, n - 1)) || 1

  const points = []
  for (let i = 0; i < n; i += 1) {
    const item = keyed[i]
    points.push({
      id: item?.id ?? item?.key ?? item?.date ?? item?.url ?? String(i),
      x: (xs[i] - meanX) / stdX,
      y: (ys[i] - meanY) / stdY,
      item,
    })
  }

  return { points, basis: [pc1, pc2] }
}

export function createSimilarityMap(descriptors, options = {}) {
  const { points } = projectTo2D(descriptors, options)
  const k = Math.max(1, Number(options.neighbors) || 3)
  const edges = []
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const distances = []
    for (let j = 0; j < points.length; j += 1) {
      if (i === j) continue
      const b = points[j]
      const dx = a.x - b.x
      const dy = a.y - b.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      distances.push({ j, dist })
    }
    distances.sort((u, v) => u.dist - v.dist)
    for (const { j } of distances.slice(0, k)) {
      const b = points[j]
      edges.push({ from: a.id, to: b.id })
    }
  }
  return { points, edges }
}

export function suggestComplementary(target, candidates, options = {}) {
  const list = Array.isArray(candidates) ? candidates : []
  const limit = Number(options.limit) || 12
  const mode = options.mode === 'contrast' ? 'contrast' : 'harmony'
  const targetId = options.targetId ?? target?.id ?? target?.key ?? target?.date ?? target?.url ?? null

  const targetColors = meanColorVector(target?.analysis?.dominantColors ?? target?.dominantColors)

  const scored = []
  for (const candidate of list) {
    const candidateId = candidate?.id ?? candidate?.key ?? candidate?.date ?? candidate?.url ?? null
    if (targetId && candidateId && String(candidateId) === String(targetId)) continue

    const targetVec = target?.styleVector ?? target?.embedding ?? target?.vector
    const candVec = candidate?.styleVector ?? candidate?.embedding ?? candidate?.vector
    const vectorSim = targetVec && candVec ? cosineSimilarity(targetVec, candVec) : 0

    const themeSim = jaccardSimilarity(target?.analysis?.subjects ?? target?.subjects, candidate?.analysis?.subjects ?? candidate?.subjects)

    const candidateColors = meanColorVector(candidate?.analysis?.dominantColors ?? candidate?.dominantColors)
    const colorDistance =
      targetColors && candidateColors ? Math.min(1, euclidean3(targetColors, candidateColors) / Math.sqrt(3)) : 0.5

    if (mode === 'harmony') {
      const { score, breakdown } = scoreStyleMatch(target, candidate, options)
      scored.push({ candidate, score, breakdown: { ...breakdown, intent: 'harmony' } })
      continue
    }

    const contrastScore = clamp01(0.6 * (1 - clamp01((vectorSim + 1) / 2)) + 0.25 * themeSim + 0.15 * colorDistance)
    scored.push({
      candidate,
      score: contrastScore,
      breakdown: { visualContrast: 0.6 * (1 - clamp01((vectorSim + 1) / 2)), theme: 0.25 * themeSim, colorContrast: 0.15 * colorDistance, intent: 'contrast' },
    })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}
