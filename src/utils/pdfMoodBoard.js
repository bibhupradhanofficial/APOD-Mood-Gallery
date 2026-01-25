function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read image blob'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(blob)
  })
}

function inferImageType(dataUrl) {
  const match = String(dataUrl ?? '').match(/^data:image\/(png|jpeg|jpg);/i)
  const raw = match?.[1]?.toLowerCase()
  if (!raw) return 'JPEG'
  if (raw === 'png') return 'PNG'
  return 'JPEG'
}

async function fetchImageDataUrl(url) {
  const res = await fetch(url, { mode: 'cors' })
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status})`)
  const blob = await res.blob()
  return blobToDataUrl(blob)
}

function pickImageSrc(item) {
  const src = item?.url || item?.hdurl
  return src ? String(src) : null
}

function safeFilename(name) {
  return String(name ?? '')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 60)
}

export async function exportPdfMoodBoard({ name, theme, items, columns = 3, rows = 2 }) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  const margin = 32
  const gutter = 14
  const headerHeight = 48
  const footerHeight = 18

  const gridTop = margin + headerHeight
  const gridBottom = pageHeight - margin - footerHeight
  const gridHeight = gridBottom - gridTop
  const gridWidth = pageWidth - margin * 2

  const safeColumns = clamp(Number(columns) || 3, 1, 4)
  const safeRows = clamp(Number(rows) || 2, 1, 4)

  const cellWidth = (gridWidth - gutter * (safeColumns - 1)) / safeColumns
  const cellHeight = (gridHeight - gutter * (safeRows - 1)) / safeRows
  const captionHeight = 26
  const imageHeight = Math.max(40, cellHeight - captionHeight)

  const images = []
  const cleanItems = (Array.isArray(items) ? items : []).filter((item) => pickImageSrc(item))
  for (const item of cleanItems) {
    const src = pickImageSrc(item)
    if (!src) continue
    try {
      const dataUrl = await fetchImageDataUrl(src)
      images.push({ item, src, dataUrl, type: inferImageType(dataUrl) })
    } catch {
      images.push({ item, src, dataUrl: null, type: null })
    }
  }

  const title = String(name ?? 'Mood Board').trim()
  const subtitle = String(theme ?? '').trim()

  const perPage = safeColumns * safeRows
  const totalPages = Math.max(1, Math.ceil(images.length / perPage))

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    if (pageIndex > 0) doc.addPage()

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.text(title || 'Mood Board', margin, margin + 18)

    if (subtitle) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.text(subtitle, margin, margin + 34)
    }

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(160, 170, 190)
    doc.text(`Page ${pageIndex + 1} of ${totalPages}`, pageWidth - margin, pageHeight - margin + 4, {
      align: 'right',
    })
    doc.setTextColor(20, 20, 20)

    for (let i = 0; i < perPage; i += 1) {
      const entry = images[pageIndex * perPage + i]
      if (!entry) break
      const col = i % safeColumns
      const row = Math.floor(i / safeColumns)
      const x = margin + col * (cellWidth + gutter)
      const y = gridTop + row * (cellHeight + gutter)

      doc.setDrawColor(220, 225, 235)
      doc.setFillColor(248, 248, 250)
      doc.roundedRect(x, y, cellWidth, cellHeight, 10, 10, 'FD')

      const pad = 10
      const ix = x + pad
      const iy = y + pad
      const iw = cellWidth - pad * 2
      const ih = imageHeight - pad

      if (entry.dataUrl) {
        try {
          doc.addImage(entry.dataUrl, entry.type || 'JPEG', ix, iy, iw, ih, undefined, 'FAST')
        } catch {
          doc.setFontSize(9)
          doc.text('Image unavailable', ix, iy + 20)
        }
      } else {
        doc.setFontSize(9)
        doc.text('Image unavailable', ix, iy + 20)
      }

      const caption = String(entry.item?.title ?? entry.item?.date ?? '').trim()
      if (caption) {
        doc.setFontSize(9)
        const clipped = caption.length > 58 ? `${caption.slice(0, 58).trim()}…` : caption
        doc.text(clipped, ix, y + cellHeight - 10)
      }
    }
  }

  const blob = doc.output('blob')
  const filename = `${safeFilename(title) || 'mood_board'}.pdf`
  return { blob, filename }
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

