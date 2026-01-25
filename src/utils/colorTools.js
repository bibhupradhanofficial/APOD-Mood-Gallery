function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

export function normalizeHex(input) {
  const raw = String(input ?? '').trim().toLowerCase()
  if (!raw) return null
  const v = raw.startsWith('#') ? raw.slice(1) : raw
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/.test(v)) return null
  if (v.length === 3) return `#${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}`
  return `#${v}`
}

export function hexToRgb(hex) {
  const h = normalizeHex(hex)
  if (!h) return null
  const r = Number.parseInt(h.slice(1, 3), 16)
  const g = Number.parseInt(h.slice(3, 5), 16)
  const b = Number.parseInt(h.slice(5, 7), 16)
  return { r, g, b }
}

export function rgbToHex({ r, g, b }) {
  return (
    '#' +
    [r, g, b]
      .map((v) => clamp(Math.round(Number(v) || 0), 0, 255).toString(16).padStart(2, '0'))
      .join('')
  )
}

function srgbToLinear(c) {
  const v = clamp(c, 0, 1)
  if (v <= 0.04045) return v / 12.92
  return Math.pow((v + 0.055) / 1.055, 2.4)
}

function rgbToXyz({ r, g, b }) {
  const rl = srgbToLinear(r / 255)
  const gl = srgbToLinear(g / 255)
  const bl = srgbToLinear(b / 255)
  return {
    x: rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375,
    y: rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175,
    z: rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041,
  }
}

function xyzToLab({ x, y, z }) {
  const xn = 0.95047
  const yn = 1.0
  const zn = 1.08883

  const fx = x / xn
  const fy = y / yn
  const fz = z / zn

  const e = 216 / 24389
  const k = 24389 / 27

  const f = (t) => {
    if (t > e) return Math.cbrt(t)
    return (k * t + 16) / 116
  }

  const xr = f(fx)
  const yr = f(fy)
  const zr = f(fz)

  return {
    l: 116 * yr - 16,
    a: 500 * (xr - yr),
    b: 200 * (yr - zr),
  }
}

export function hexToLab(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  return xyzToLab(rgbToXyz(rgb))
}

export function deltaE76(lab1, lab2) {
  if (!lab1 || !lab2) return Infinity
  const dl = lab1.l - lab2.l
  const da = lab1.a - lab2.a
  const db = lab1.b - lab2.b
  return Math.sqrt(dl * dl + da * da + db * db)
}

function relativeLuminance({ r, g, b }) {
  const rl = srgbToLinear(r / 255)
  const gl = srgbToLinear(g / 255)
  const bl = srgbToLinear(b / 255)
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
}

export function contrastRatio(hexA, hexB) {
  const a = hexToRgb(hexA)
  const b = hexToRgb(hexB)
  if (!a || !b) return 1
  const l1 = relativeLuminance(a)
  const l2 = relativeLuminance(b)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

export function bestTextOn(bgHex) {
  const onBlack = contrastRatio(bgHex, '#000000')
  const onWhite = contrastRatio(bgHex, '#ffffff')
  if (onBlack >= onWhite) return { text: '#000000', ratio: onBlack }
  return { text: '#ffffff', ratio: onWhite }
}

export function ratioBadge(ratio) {
  const r = Number(ratio) || 0
  const aa = r >= 4.5 ? 'AA' : 'Fail'
  const aaa = r >= 7 ? 'AAA' : null
  if (aaa) return 'AAA'
  return aa
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  let h = 0
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6
    else if (max === gn) h = (bn - rn) / delta + 2
    else h = (rn - gn) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }
  const l = (max + min) / 2
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))
  return { h, s, l }
}

function hslToRgb({ h, s, l }) {
  const hh = ((Number(h) || 0) % 360 + 360) % 360
  const ss = clamp(Number(s) || 0, 0, 1)
  const ll = clamp(Number(l) || 0, 0, 1)

  const c = (1 - Math.abs(2 * ll - 1)) * ss
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = ll - c / 2

  let r1 = 0
  let g1 = 0
  let b1 = 0
  if (hh < 60) {
    r1 = c
    g1 = x
  } else if (hh < 120) {
    r1 = x
    g1 = c
  } else if (hh < 180) {
    g1 = c
    b1 = x
  } else if (hh < 240) {
    g1 = x
    b1 = c
  } else if (hh < 300) {
    r1 = x
    b1 = c
  } else {
    r1 = c
    b1 = x
  }

  return {
    r: Math.round(clamp((r1 + m) * 255, 0, 255)),
    g: Math.round(clamp((g1 + m) * 255, 0, 255)),
    b: Math.round(clamp((b1 + m) * 255, 0, 255)),
  }
}

export function rotateHue(hex, degrees) {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const hsl = rgbToHsl(rgb)
  const next = { ...hsl, h: hsl.h + degrees }
  return rgbToHex(hslToRgb(next))
}

export function makeSchemes(baseHex) {
  const base = normalizeHex(baseHex)
  if (!base) return []
  const mk = (name, hues) => ({
    name,
    colors: [base, ...hues.map((d) => rotateHue(base, d)).filter(Boolean)],
  })
  return [
    mk('Complementary', [180]),
    mk('Analogous', [-30, 30]),
    mk('Triadic', [120, 240]),
    mk('Split Complementary', [150, 210]),
    mk('Tetradic', [90, 180, 270]),
  ]
}

export function buildExportStrings({ colors, prefix }) {
  const list = (Array.isArray(colors) ? colors : []).map((c) => normalizeHex(c)).filter(Boolean)
  const base = String(prefix ?? 'apod').trim() || 'apod'
  const css = [
    ':root {',
    ...list.map((hex, i) => `  --${base}-${String(i + 1).padStart(2, '0')}: ${hex};`),
    '}',
  ].join('\n')
  const tokens = {
    color: {
      [base]: Object.fromEntries(
        list.map((hex, i) => [
          String(i + 1).padStart(2, '0'),
          { value: hex, type: 'color' },
        ])
      ),
    },
  }
  return { css, tokens: JSON.stringify(tokens, null, 2) }
}
