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

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

async function loadBitmap(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`)
  const blob = await response.blob()
  return createImageBitmap(blob)
}

function normalizeToSquareCanvas(imageLike, maxSize) {
  const width = Number(imageLike?.width ?? 0)
  const height = Number(imageLike?.height ?? 0)
  const size = Math.max(1, Math.min(Number(maxSize) || 256, Math.max(width, height)))
  const canvas = new OffscreenCanvas(size, size)
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

async function extractPixelFeatures(ctx, width, height, cancelled) {
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

  const yieldEverySamples = 12000

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      if (cancelled()) throw new Error('aborted')
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
        await new Promise((resolve) => setTimeout(resolve, 0))
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
  const normalizedEntropy = distinctBuckets > 1 ? entropy / Math.log(Math.min(distinctBuckets, 1024)) : 0

  const complexity = Math.max(0, Math.min(1, 0.55 * normalizedEntropy + 0.35 * luminanceStd + 0.1 * avgChroma))
  const temperature = warmth >= 0.03 ? 'warm' : 'cool'

  return {
    dominantColors,
    brightness: clamp(brightness, 0, 1),
    temperature,
    complexity,
  }
}

const cancelledIds = new Set()

self.onmessage = async (event) => {
  const message = event?.data
  if (!message || typeof message !== 'object') return

  if (message.type === 'cancel') {
    const id = message.id
    if (id != null) cancelledIds.add(id)
    return
  }

  if (message.type !== 'analyze') return

  const id = message.id
  const url = message.url
  const maxSize = message.maxSize
  const cancelled = () => cancelledIds.has(id)

  try {
    if (!url) throw new Error('missing url')
    const bitmap = await loadBitmap(String(url))
    if (cancelled()) throw new Error('aborted')
    const { canvas, ctx } = normalizeToSquareCanvas(bitmap, maxSize)
    if (!ctx) throw new Error('no canvas context')
    const features = await extractPixelFeatures(ctx, canvas.width, canvas.height, cancelled)
    if (cancelled()) throw new Error('aborted')
    self.postMessage({ type: 'result', id, ok: true, payload: features })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    self.postMessage({ type: 'result', id, ok: false, error: message })
  } finally {
    cancelledIds.delete(id)
  }
}

