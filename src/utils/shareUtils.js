import { downloadBlob as downloadBlobFile } from './pdfMoodBoard'

function safeFilename(name) {
  return String(name ?? '')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
}

function stripHtml(text) {
  return String(text ?? '').replace(/<[^>]*>/g, '').trim()
}

function guessExtensionFromUrl(url) {
  const clean = String(url ?? '').split('#')[0].split('?')[0]
  const match = clean.match(/\.([a-z0-9]{2,5})$/i)
  const ext = match?.[1]?.toLowerCase()
  if (!ext) return 'jpg'
  if (ext === 'jpeg') return 'jpg'
  return ext
}

function toBase64Url(text) {
  const utf8 = encodeURIComponent(String(text ?? '')).replace(/%([0-9A-F]{2})/g, (_, p1) =>
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

function ensureMeta({ attr, key, content }) {
  if (typeof document === 'undefined') return
  const safeKey = String(key ?? '').trim()
  if (!safeKey) return

  const selector = attr === 'name' ? `meta[name="${safeKey}"]` : `meta[property="${safeKey}"]`
  let node = document.head?.querySelector(selector)
  if (!node) {
    node = document.createElement('meta')
    node.setAttribute(attr, safeKey)
    document.head?.appendChild(node)
  }
  node.setAttribute('content', String(content ?? '').trim())
}

function defaultShareBaseUrl() {
  if (typeof window === 'undefined') return ''
  const url = new URL(window.location.href)
  url.hash = ''
  return url.toString()
}

export function buildShareUrl({ baseUrl, meta, params } = {}) {
  const resolvedBase =
    typeof baseUrl !== 'undefined' && baseUrl !== null ? String(baseUrl) : String(defaultShareBaseUrl())
  const url = new URL(resolvedBase || 'https://example.com/')
  const metaObj = meta && typeof meta === 'object' ? meta : null
  if (metaObj) {
    url.searchParams.set('share', '1')
    url.searchParams.set('meta', toBase64Url(JSON.stringify(metaObj)))
  }
  if (params && typeof params === 'object') {
    for (const [k, v] of Object.entries(params)) {
      const key = String(k ?? '').trim()
      if (!key) continue
      if (v === null || typeof v === 'undefined' || v === '') url.searchParams.delete(key)
      else url.searchParams.set(key, String(v))
    }
  }
  return url.toString()
}

export function buildShareUrlWithMeta({ baseUrl, meta, params } = {}) {
  const url = buildShareUrl({ baseUrl, params })
  const resolvedMeta = meta && typeof meta === 'object' ? meta : {}
  return buildShareUrl({
    baseUrl,
    params,
    meta: {
      ...resolvedMeta,
      url: String(resolvedMeta?.url ?? url),
    },
  })
}

export function readShareMetaFromLocation() {
  if (typeof window === 'undefined') return null
  const url = new URL(window.location.href)
  const raw = url.searchParams.get('meta')
  if (!raw) return null
  try {
    const json = fromBase64Url(raw)
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

export function applyOpenGraphMeta(meta = {}) {
  if (typeof document === 'undefined') return
  const title = stripHtml(meta?.title ?? 'APOD Mood Gallery')
  const description = stripHtml(meta?.description ?? '')
  const image = String(meta?.image ?? '').trim()
  const url = String(meta?.url ?? (typeof window !== 'undefined' ? window.location.href : '')).trim()
  const siteName = stripHtml(meta?.siteName ?? 'APOD Mood Gallery')
  const type = String(meta?.type ?? 'website').trim() || 'website'
  const twitterCard = String(meta?.twitterCard ?? 'summary_large_image').trim() || 'summary_large_image'

  if (title) document.title = title

  ensureMeta({ attr: 'property', key: 'og:title', content: title })
  ensureMeta({ attr: 'property', key: 'og:description', content: description })
  ensureMeta({ attr: 'property', key: 'og:image', content: image })
  ensureMeta({ attr: 'property', key: 'og:url', content: url })
  ensureMeta({ attr: 'property', key: 'og:type', content: type })
  ensureMeta({ attr: 'property', key: 'og:site_name', content: siteName })

  ensureMeta({ attr: 'name', key: 'twitter:card', content: twitterCard })
  ensureMeta({ attr: 'name', key: 'twitter:title', content: title })
  ensureMeta({ attr: 'name', key: 'twitter:description', content: description })
  ensureMeta({ attr: 'name', key: 'twitter:image', content: image })
  ensureMeta({ attr: 'name', key: 'twitter:url', content: url })
}

export function generateOpenGraphTagsHtml(meta = {}) {
  const title = stripHtml(meta?.title ?? 'APOD Mood Gallery')
  const description = stripHtml(meta?.description ?? '')
  const image = String(meta?.image ?? '').trim()
  const url = String(meta?.url ?? '').trim()
  const siteName = stripHtml(meta?.siteName ?? 'APOD Mood Gallery')
  const type = String(meta?.type ?? 'website').trim() || 'website'
  const twitterCard = String(meta?.twitterCard ?? 'summary_large_image').trim() || 'summary_large_image'

  const tags = []
  if (title) tags.push(`<title>${title}</title>`)
  if (title) tags.push(`<meta property="og:title" content="${title}">`)
  if (description) tags.push(`<meta property="og:description" content="${description}">`)
  if (image) tags.push(`<meta property="og:image" content="${image}">`)
  if (url) tags.push(`<meta property="og:url" content="${url}">`)
  if (type) tags.push(`<meta property="og:type" content="${type}">`)
  if (siteName) tags.push(`<meta property="og:site_name" content="${siteName}">`)
  if (twitterCard) tags.push(`<meta name="twitter:card" content="${twitterCard}">`)
  if (title) tags.push(`<meta name="twitter:title" content="${title}">`)
  if (description) tags.push(`<meta name="twitter:description" content="${description}">`)
  if (image) tags.push(`<meta name="twitter:image" content="${image}">`)
  if (url) tags.push(`<meta name="twitter:url" content="${url}">`)
  return tags.join('\n')
}

export function initOpenGraphFromLocation({ fallbackMeta } = {}) {
  const meta = readShareMetaFromLocation()
  applyOpenGraphMeta({ ...(fallbackMeta && typeof fallbackMeta === 'object' ? fallbackMeta : {}), ...(meta ?? {}) })
  return meta
}

export async function copyToClipboard(text) {
  const value = String(text ?? '')
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    return false
  }

  try {
    if (typeof document === 'undefined') return false
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.top = '0'
    textarea.style.left = '0'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    textarea.remove()
    return ok
  } catch {
    return false
  }
}

export function getSocialShareLinks({ url, title, description, image } = {}) {
  const shareUrl = String(url ?? (typeof window !== 'undefined' ? window.location.href : '')).trim()
  const safeTitle = stripHtml(title ?? '')
  const safeDesc = stripHtml(description ?? '')
  const safeImage = String(image ?? '').trim()

  const twitter = new URL('https://twitter.com/intent/tweet')
  twitter.searchParams.set('url', shareUrl)
  if (safeTitle || safeDesc) twitter.searchParams.set('text', `${safeTitle}${safeTitle && safeDesc ? ' — ' : ''}${safeDesc}`)

  const reddit = new URL('https://www.reddit.com/submit')
  reddit.searchParams.set('url', shareUrl)
  if (safeTitle) reddit.searchParams.set('title', safeTitle)

  const pinterest = new URL('https://pinterest.com/pin/create/button/')
  pinterest.searchParams.set('url', shareUrl)
  if (safeImage) pinterest.searchParams.set('media', safeImage)
  if (safeTitle || safeDesc) {
    pinterest.searchParams.set('description', `${safeTitle}${safeTitle && safeDesc ? ' — ' : ''}${safeDesc}`)
  }

  return { twitter: twitter.toString(), reddit: reddit.toString(), pinterest: pinterest.toString() }
}

export function formatApodAttribution(apod) {
  const title = stripHtml(apod?.title ?? '')
  const date = String(apod?.date ?? '').trim()
  const copyright = stripHtml(apod?.copyright ?? '')
  const parts = []
  if (title) parts.push(title)
  if (date) parts.push(date)
  parts.push('NASA/APOD')
  if (copyright) parts.push(`© ${copyright}`)
  return parts.join(' • ')
}

export function buildAttributionLines(items) {
  const list = Array.isArray(items) ? items : []
  const lines = []
  lines.push('Credits: NASA/APOD; additional rights retained by original copyright holders')
  for (const apod of list) {
    const line = formatApodAttribution(apod)
    if (line) lines.push(line)
  }
  return lines
}

export function buildAttributionText(items) {
  return buildAttributionLines(items).join('\n')
}

export function getApodImageUrl(apod, variant = 'original') {
  const v = String(variant ?? 'original').toLowerCase()
  if (v === 'hd' && apod?.hdurl) return String(apod.hdurl)
  if (v === 'thumbnail' && apod?.thumbnail_url) return String(apod.thumbnail_url)
  if (apod?.url) return String(apod.url)
  if (apod?.hdurl) return String(apod.hdurl)
  if (apod?.thumbnail_url) return String(apod.thumbnail_url)
  return null
}

async function fetchBlob(url) {
  const res = await fetch(String(url), { mode: 'cors' })
  if (!res.ok) throw new Error(`Failed to fetch (${res.status})`)
  return res.blob()
}

export async function downloadImage({ url, filename } = {}) {
  const src = String(url ?? '').trim()
  if (!src) throw new Error('Missing image URL')
  const name = String(filename ?? `${safeFilename('image')}.${guessExtensionFromUrl(src)}`)

  try {
    const blob = await fetchBlob(src)
    downloadBlobFile(name, blob)
    return { ok: true, filename: name }
  } catch {
    const a = document.createElement('a')
    a.href = src
    a.download = name
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    a.remove()
    return { ok: false, filename: name }
  }
}

export async function downloadApodImage(apod, variant = 'original') {
  const src = getApodImageUrl(apod, variant)
  if (!src) throw new Error('No APOD image available')
  const date = String(apod?.date ?? '').trim()
  const base = safeFilename(`${date || 'apod'}_${apod?.title ?? ''}`) || 'apod'
  const ext = guessExtensionFromUrl(src)
  const filename = `${base}_${String(variant).toLowerCase()}.${ext}`
  return downloadImage({ url: src, filename })
}

export function buildApodShareMeta(apod, { variant = 'original', baseUrl } = {}) {
  const title = stripHtml(apod?.title ?? 'APOD')
  const date = String(apod?.date ?? '').trim()
  const description = stripHtml(apod?.explanation ?? '')
  const image = getApodImageUrl(apod, variant) ?? getApodImageUrl(apod, 'original') ?? getApodImageUrl(apod, 'hd') ?? ''
  const attribution = formatApodAttribution(apod)
  const safeDesc = [date, attribution, description].filter(Boolean).join(' — ').slice(0, 280)
  return {
    title: date ? `${title} (${date})` : title,
    description: safeDesc,
    image,
    url: String(baseUrl ?? (typeof window !== 'undefined' ? window.location.href : '')).trim(),
    siteName: 'APOD Mood Gallery',
    type: 'article',
    twitterCard: 'summary_large_image',
  }
}

export function buildCollectionShareMeta({ name, theme, items, baseUrl } = {}) {
  const title = stripHtml(name ?? 'Collection')
  const safeTheme = stripHtml(theme ?? '')
  const list = Array.isArray(items) ? items : []
  const preview = list[0]
  const image =
    getApodImageUrl(preview, 'thumbnail') ??
    getApodImageUrl(preview, 'original') ??
    getApodImageUrl(preview, 'hd') ??
    ''
  const description = stripHtml(
    `${safeTheme ? `Theme: ${safeTheme}. ` : ''}${list.length ? `${list.length} APOD items.` : ''} Credits: NASA/APOD; additional rights retained by original copyright holders.`
  )
  return {
    title: safeTheme ? `${title} — ${safeTheme}` : title,
    description,
    image,
    url: String(baseUrl ?? (typeof window !== 'undefined' ? window.location.href : '')).trim(),
    siteName: 'APOD Mood Gallery',
    type: 'website',
    twitterCard: 'summary_large_image',
  }
}

function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl ?? '').match(/^data:([^;]+);base64,(.*)$/)
  if (!match) throw new Error('Invalid data URL')
  const mime = match[1]
  const b64 = match[2]
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return new Blob([bytes], { type: mime })
}

export async function downloadElementAsPng(element, filename = 'mood_board.png', options = {}) {
  if (!element) throw new Error('Missing element')
  const { toPng } = await import('html-to-image')
  const dataUrl = await toPng(element, { cacheBust: true, pixelRatio: 2, ...options })
  const blob = dataUrlToBlob(dataUrl)
  downloadBlobFile(String(filename), blob)
  return { blob, filename: String(filename) }
}

export async function downloadMoodBoardAsPng({
  element,
  filename = 'mood_board.png',
  title,
  items,
  options,
} = {}) {
  const node = element
  if (!node) throw new Error('Missing element')
  const resolvedTitle = stripHtml(title ?? 'Mood Board')
  const credits = buildAttributionLines(items).slice(0, 6).join(' • ')

  const wrapper = document.createElement('div')
  wrapper.style.position = 'fixed'
  wrapper.style.left = '-10000px'
  wrapper.style.top = '0'
  wrapper.style.width = `${node.offsetWidth || 1024}px`
  wrapper.style.background = '#0b1220'
  wrapper.style.padding = '24px'
  wrapper.style.boxSizing = 'border-box'

  const clone = node.cloneNode(true)
  clone.style.minWidth = '0'
  clone.style.width = '100%'
  clone.style.boxSizing = 'border-box'

  const footer = document.createElement('div')
  footer.style.marginTop = '12px'
  footer.style.paddingTop = '12px'
  footer.style.borderTop = '1px solid rgba(255,255,255,0.12)'
  footer.style.font = '12px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif'
  footer.style.color = 'rgba(255,255,255,0.72)'
  footer.textContent = `${resolvedTitle} • ${credits}`

  wrapper.appendChild(clone)
  wrapper.appendChild(footer)
  document.body.appendChild(wrapper)

  try {
    return await downloadElementAsPng(wrapper, filename, options)
  } finally {
    wrapper.remove()
  }
}

export async function downloadCollectionAsZip({ collection, items, variant = 'original', filename } = {}) {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()

  const safeName = safeFilename(filename ?? collection?.name ?? collection?.title ?? 'collection') || 'collection'
  const finalFilename = `${safeName}.zip`

  const list = Array.isArray(items) ? items : Array.isArray(collection?.items) ? collection.items : []
  const manifest = {
    name: String(collection?.name ?? collection?.title ?? safeName),
    theme: String(collection?.theme ?? ''),
    exportedAt: new Date().toISOString(),
    source: 'APOD Mood Gallery',
    attribution: 'NASA/APOD; additional rights retained by original copyright holders',
    items: [],
    failures: [],
  }

  const credits = []
  for (const apod of list) {
    const title = stripHtml(apod?.title ?? '')
    const date = String(apod?.date ?? '').trim()
    const src = getApodImageUrl(apod, variant) ?? getApodImageUrl(apod, 'original') ?? getApodImageUrl(apod, 'hd')
    const ext = guessExtensionFromUrl(src || '')
    const base = safeFilename(`${date || 'apod'}_${title}`) || 'apod'
    const path = `images/${base}.${ext}`
    credits.push(formatApodAttribution(apod))

    if (!src) {
      manifest.failures.push({ date, title, reason: 'missing_url' })
      manifest.items.push({ date, title, path: null, url: null, variant: String(variant) })
      continue
    }

    try {
      const blob = await fetchBlob(src)
      zip.file(path, blob)
      manifest.items.push({ date, title, path, url: src, variant: String(variant) })
    } catch {
      manifest.failures.push({ date, title, reason: 'fetch_failed', url: src })
      manifest.items.push({ date, title, path: null, url: src, variant: String(variant) })
    }
  }

  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  zip.file('CREDITS.txt', credits.filter(Boolean).join('\n'))

  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBlobFile(finalFilename, blob)
  return { blob, filename: finalFilename }
}

export function generateEmbedCode({ url, title, width = 860, height = 720, attribution } = {}) {
  const src = String(url ?? '').trim()
  const safeTitle = stripHtml(title ?? 'APOD Mood Gallery')
  const safeAttr = stripHtml(attribution ?? 'Credits: NASA/APOD; additional rights retained by original copyright holders')
  const w = Number(width) || 860
  const h = Number(height) || 720

  return [
    `<iframe src="${src}" title="${safeTitle}" width="${w}" height="${h}" style="border:0; max-width:100%;" referrerpolicy="no-referrer-when-downgrade"></iframe>`,
    `<div style="font: 12px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #667085; margin-top: 6px;">${safeAttr}</div>`,
  ].join('\n')
}

export function generateApodImageEmbedCode(apod, { variant = 'original', width = 860 } = {}) {
  const src = getApodImageUrl(apod, variant) ?? ''
  const alt = stripHtml(apod?.title ?? 'NASA APOD image')
  const safeWidth = Number(width) || 860
  const caption = stripHtml(formatApodAttribution(apod) || 'Credits: NASA/APOD; additional rights retained by original copyright holders')
  return [
    `<figure style="margin:0;">`,
    `<img src="${src}" alt="${alt}" width="${safeWidth}" style="max-width:100%; height:auto; display:block;">`,
    `<figcaption style="font: 12px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #667085; margin-top: 6px;">${caption}</figcaption>`,
    `</figure>`,
  ].join('\n')
}

export async function generateQrCodeDataUrl(text, options = {}) {
  const value = String(text ?? '').trim()
  if (!value) throw new Error('Missing text')
  const QRCode = await import('qrcode')
  return QRCode.toDataURL(value, {
    margin: 1,
    width: 512,
    color: { dark: '#0b1220', light: '#ffffff' },
    ...options,
  })
}

export async function downloadQrCodePng({ text, filename = 'qr.png', options } = {}) {
  const dataUrl = await generateQrCodeDataUrl(text, options)
  const blob = dataUrlToBlob(dataUrl)
  downloadBlobFile(String(filename), blob)
  return { blob, filename: String(filename), dataUrl }
}
