export const cosmicColors = {
  primary: '#0B0D21',
  secondary: '#6B3FA0',
  accent: '#FFD700',
  surface0: '#050510',
  surface1: '#090A1A',
  surface2: '#0F102B',
  text: '#F1F5F9',
  textMuted: '#CBD5E1',
  border: 'rgba(255, 255, 255, 0.14)',
  overlay: 'rgba(7, 8, 26, 0.78)',
  shadow: 'rgba(0, 0, 0, 0.55)',
  glowPrimary: 'rgba(107, 63, 160, 0.55)',
  glowAccent: 'rgba(255, 215, 0, 0.35)',
}

export const moodColors = {
  Calming: {
    hex: '#38BDF8',
    glow: 'rgba(56, 189, 248, 0.35)',
    gradient: 'linear-gradient(135deg, rgba(56, 189, 248, 0.28), rgba(107, 63, 160, 0.18))',
  },
  Energizing: {
    hex: '#FB923C',
    glow: 'rgba(251, 146, 60, 0.35)',
    gradient: 'linear-gradient(135deg, rgba(251, 146, 60, 0.3), rgba(255, 215, 0, 0.14))',
  },
  Mysterious: {
    hex: '#818CF8',
    glow: 'rgba(129, 140, 248, 0.35)',
    gradient: 'linear-gradient(135deg, rgba(129, 140, 248, 0.24), rgba(11, 13, 33, 0.32))',
  },
  Inspiring: {
    hex: '#34D399',
    glow: 'rgba(52, 211, 153, 0.32)',
    gradient: 'linear-gradient(135deg, rgba(52, 211, 153, 0.22), rgba(56, 189, 248, 0.14))',
  },
  Cosmic: {
    hex: '#E879F9',
    glow: 'rgba(232, 121, 249, 0.35)',
    gradient: 'linear-gradient(135deg, rgba(232, 121, 249, 0.22), rgba(107, 63, 160, 0.22))',
  },
  Unknown: {
    hex: '#94A3B8',
    glow: 'rgba(148, 163, 184, 0.3)',
    gradient: 'linear-gradient(135deg, rgba(148, 163, 184, 0.16), rgba(255, 255, 255, 0.06))',
  },
}

export const typography = {
  fontFamily: {
    sans: [
      'ui-sans-serif',
      'system-ui',
      '-apple-system',
      'Segoe UI',
      'Roboto',
      'Inter',
      'Helvetica Neue',
      'Arial',
      'Noto Sans',
      'Apple Color Emoji',
      'Segoe UI Emoji',
      'Segoe UI Symbol',
    ].join(','),
    mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'Liberation Mono', 'Courier New', 'monospace'].join(
      ',',
    ),
  },
  scale: {
    xs: { fontSize: '0.75rem', lineHeight: '1.1rem', letterSpacing: '0.01em' },
    sm: { fontSize: '0.875rem', lineHeight: '1.35rem', letterSpacing: '0.005em' },
    base: { fontSize: '1rem', lineHeight: '1.6rem', letterSpacing: '0em' },
    lg: { fontSize: '1.125rem', lineHeight: '1.75rem', letterSpacing: '-0.005em' },
    xl: { fontSize: '1.25rem', lineHeight: '1.9rem', letterSpacing: '-0.01em' },
    '2xl': { fontSize: '1.5rem', lineHeight: '2.1rem', letterSpacing: '-0.015em' },
    '3xl': { fontSize: '1.875rem', lineHeight: '2.5rem', letterSpacing: '-0.02em' },
    '4xl': { fontSize: '2.25rem', lineHeight: '2.9rem', letterSpacing: '-0.025em' },
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  measure: {
    readable: '65ch',
    tight: '50ch',
    wide: '75ch',
  },
}

export const spacing = {
  grid: 8,
  px: (steps) => `${Math.round(Number(steps) * 8)}px`,
  n: (steps) => Math.round(Number(steps) * 8),
  scale: Object.freeze({
    0: 0,
    0.5: 4,
    1: 8,
    1.5: 12,
    2: 16,
    2.5: 20,
    3: 24,
    4: 32,
    5: 40,
    6: 48,
    8: 64,
    10: 80,
    12: 96,
    16: 128,
  }),
}

export const radius = {
  sm: '10px',
  md: '14px',
  lg: '18px',
  xl: '24px',
  pill: '9999px',
}

export const effects = {
  glass: {
    background: 'rgba(255, 255, 255, 0.08)',
    border: '1px solid rgba(255, 255, 255, 0.14)',
    boxShadow: '0 18px 50px rgba(0, 0, 0, 0.35)',
    backdropFilter: 'blur(14px) saturate(1.2)',
    WebkitBackdropFilter: 'blur(14px) saturate(1.2)',
  },
  glassStrong: {
    background: 'rgba(255, 255, 255, 0.12)',
    border: '1px solid rgba(255, 255, 255, 0.18)',
    boxShadow: '0 24px 70px rgba(0, 0, 0, 0.42)',
    backdropFilter: 'blur(18px) saturate(1.25)',
    WebkitBackdropFilter: 'blur(18px) saturate(1.25)',
  },
  neumo: {
    background: 'linear-gradient(145deg, rgba(255, 255, 255, 0.08), rgba(0, 0, 0, 0.22))',
    boxShadow: '10px 10px 24px rgba(0, 0, 0, 0.55), -10px -10px 22px rgba(255, 255, 255, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
  },
  neumoInset: {
    background: 'linear-gradient(145deg, rgba(255, 255, 255, 0.07), rgba(0, 0, 0, 0.28))',
    boxShadow: 'inset 10px 10px 24px rgba(0, 0, 0, 0.6), inset -10px -10px 22px rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
  },
}

export const motion = {
  easing: {
    standard: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    out: 'cubic-bezier(0.16, 1, 0.3, 1)',
    in: 'cubic-bezier(0.7, 0, 0.84, 0)',
  },
  duration: {
    instant: '90ms',
    fast: '160ms',
    base: '240ms',
    slow: '420ms',
  },
}

export const components = {
  button: {
    baseTW:
      'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold ring-1 ring-white/10 transition will-change-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-space-nebula/60 disabled:opacity-50 disabled:pointer-events-none',
    variantsTW: {
      primary:
        'bg-space-deepBlue text-slate-50 hover:translate-y-[-1px] hover:shadow-[0_16px_40px_rgba(0,0,0,0.35)] hover:ring-white/20 active:translate-y-0',
      secondary:
        'bg-space-purple/80 text-slate-50 hover:bg-space-purple/90 hover:translate-y-[-1px] hover:ring-white/20 active:translate-y-0',
      accent:
        'bg-amber-400/95 text-slate-950 hover:bg-amber-300 hover:translate-y-[-1px] hover:shadow-[0_18px_55px_rgba(255,215,0,0.14)] active:translate-y-0',
      ghost: 'bg-white/0 text-slate-100 hover:bg-white/8 hover:ring-white/20',
      glass:
        'bg-white/10 text-slate-50 backdrop-blur-md hover:bg-white/14 hover:translate-y-[-1px] hover:ring-white/20',
      neumo:
        'bg-gradient-to-br from-white/12 to-black/30 text-slate-50 shadow-[10px_10px_24px_rgba(0,0,0,0.55),-10px_-10px_22px_rgba(255,255,255,0.06)] hover:translate-y-[-1px] hover:ring-white/20',
    },
    sizesTW: {
      sm: 'px-3 py-1.5 text-xs rounded-lg',
      md: 'px-4 py-2 text-sm rounded-xl',
      lg: 'px-5 py-2.5 text-base rounded-2xl',
    },
  },
  card: {
    baseTW: 'rounded-2xl ring-1 ring-white/10',
    variantsTW: {
      base: 'bg-space-void/70 shadow-[0_18px_60px_rgba(0,0,0,0.35)]',
      glass: 'bg-white/8 backdrop-blur-xl shadow-[0_18px_60px_rgba(0,0,0,0.35)]',
      neumo:
        'bg-gradient-to-br from-white/10 to-black/35 shadow-[12px_12px_28px_rgba(0,0,0,0.55),-12px_-12px_26px_rgba(255,255,255,0.05)]',
    },
  },
  badge: {
    baseTW: 'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1',
    variantsTW: {
      default: 'bg-white/10 text-slate-200 ring-white/15',
      calming: 'bg-sky-500/15 text-sky-200 ring-sky-400/30',
      energizing: 'bg-orange-500/15 text-orange-200 ring-orange-400/30',
      mysterious: 'bg-indigo-500/15 text-indigo-200 ring-indigo-400/30',
      inspiring: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30',
      cosmic: 'bg-fuchsia-500/15 text-fuchsia-200 ring-fuchsia-400/30',
    },
  },
}

function toCssVars(values = {}) {
  const out = {}
  for (const [key, value] of Object.entries(values)) {
    const name = String(key).trim()
    if (!name) continue
    const cssKey = name.startsWith('--') ? name : `--${name}`
    out[cssKey] = String(value)
  }
  return out
}

export function applyThemeToRoot(theme = {}, target = typeof document !== 'undefined' ? document.documentElement : null) {
  if (!target) return
  const vars = toCssVars(theme)
  for (const [k, v] of Object.entries(vars)) {
    target.style.setProperty(k, v)
  }
}

export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function ensureDesignSystemStyles({ id = 'apod-design-system', force = false } = {}) {
  if (typeof document === 'undefined') return null
  const existing = document.getElementById(id)
  if (existing && !force) return existing
  if (existing && force) existing.remove()

  const style = document.createElement('style')
  style.id = id
  style.textContent = `
    :root{
      --ds-primary:${cosmicColors.primary};
      --ds-secondary:${cosmicColors.secondary};
      --ds-accent:${cosmicColors.accent};
      --ds-surface0:${cosmicColors.surface0};
      --ds-surface1:${cosmicColors.surface1};
      --ds-surface2:${cosmicColors.surface2};
      --ds-text:${cosmicColors.text};
      --ds-text-muted:${cosmicColors.textMuted};
      --ds-border:${cosmicColors.border};
      --ds-shadow:${cosmicColors.shadow};
      --ds-glow-primary:${cosmicColors.glowPrimary};
      --ds-glow-accent:${cosmicColors.glowAccent};
    }

    @keyframes ds-float{0%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-4px,0)}100%{transform:translate3d(0,0,0)}}
    @keyframes ds-soft-glow{0%{filter:drop-shadow(0 0 0 rgba(0,0,0,0))}50%{filter:drop-shadow(0 0 18px var(--ds-glow-primary))}100%{filter:drop-shadow(0 0 0 rgba(0,0,0,0))}}
    @keyframes ds-galaxy-rotate{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
    @keyframes ds-star-pulse{0%{opacity:.55;transform:scale(.96)}50%{opacity:1;transform:scale(1.06)}100%{opacity:.55;transform:scale(.96)}}
    @keyframes ds-particles-drift{0%{transform:translate3d(-2%, -2%, 0)}50%{transform:translate3d(2%, 2%, 0)}100%{transform:translate3d(-2%, -2%, 0)}}
    @keyframes ds-parallax-slow{0%{transform:translate3d(0,0,0)}100%{transform:translate3d(0,-20px,0)}}

    .ds-transition{transition:transform ${motion.duration.base} ${motion.easing.out},opacity ${motion.duration.base} ${motion.easing.out},box-shadow ${motion.duration.base} ${motion.easing.out},background-color ${motion.duration.base} ${motion.easing.out},border-color ${motion.duration.base} ${motion.easing.out}}
    .ds-hover-float{will-change:transform;transition:transform ${motion.duration.base} ${motion.easing.out}}
    .ds-hover-float:hover{transform:translate3d(0,-2px,0)}
    .ds-hover-glow{transition:filter ${motion.duration.base} ${motion.easing.out}}
    .ds-hover-glow:hover{filter:drop-shadow(0 0 18px var(--ds-glow-primary))}

    .ds-glass{background:${effects.glass.background};border:${effects.glass.border};backdrop-filter:${effects.glass.backdropFilter};-webkit-backdrop-filter:${effects.glass.WebkitBackdropFilter};box-shadow:${effects.glass.boxShadow}}
    .ds-glass-strong{background:${effects.glassStrong.background};border:${effects.glassStrong.border};backdrop-filter:${effects.glassStrong.backdropFilter};-webkit-backdrop-filter:${effects.glassStrong.WebkitBackdropFilter};box-shadow:${effects.glassStrong.boxShadow}}
    .ds-neumo{background:${effects.neumo.background};border:${effects.neumo.border};box-shadow:${effects.neumo.boxShadow}}
    .ds-neumo-inset{background:${effects.neumoInset.background};border:${effects.neumoInset.border};box-shadow:${effects.neumoInset.boxShadow}}

    .ds-bg-particles{position:relative;isolation:isolate}
    .ds-bg-particles::before,
    .ds-bg-particles::after{
      content:"";
      position:absolute;
      inset:-20%;
      z-index:-1;
      pointer-events:none;
      background:
        radial-gradient(var(--ds-particle-size, 1px) var(--ds-particle-size, 1px) at 10% 20%, var(--ds-particle-color, rgba(255,255,255,.45)), transparent 55%),
        radial-gradient(var(--ds-particle-size, 1px) var(--ds-particle-size, 1px) at 40% 80%, var(--ds-particle-color-2, rgba(255,255,255,.35)), transparent 55%),
        radial-gradient(var(--ds-particle-size, 1px) var(--ds-particle-size, 1px) at 70% 30%, var(--ds-particle-color, rgba(255,255,255,.38)), transparent 55%),
        radial-gradient(var(--ds-particle-size, 1px) var(--ds-particle-size, 1px) at 85% 65%, var(--ds-particle-color-2, rgba(255,255,255,.3)), transparent 55%),
        radial-gradient(var(--ds-particle-size, 1px) var(--ds-particle-size, 1px) at 25% 55%, var(--ds-particle-color-2, rgba(255,255,255,.26)), transparent 55%);
      opacity:var(--ds-particle-opacity, .85);
      animation:ds-particles-drift 18s ${motion.easing.standard} infinite;
    }
    .ds-bg-particles::after{
      opacity:.55;
      filter:blur(.5px);
      animation-duration:28s;
      transform:translate3d(1%,1%,0);
    }

    .ds-loader-galaxy{
      width:42px;height:42px;border-radius:9999px;
      background:conic-gradient(from 180deg, rgba(255,215,0,.0), rgba(255,215,0,.7), rgba(107,63,160,.7), rgba(56,189,248,.55), rgba(255,215,0,.0));
      -webkit-mask:radial-gradient(farthest-side, transparent 58%, #000 60%);
      mask:radial-gradient(farthest-side, transparent 58%, #000 60%);
      animation:ds-galaxy-rotate 1.15s linear infinite;
      filter:drop-shadow(0 0 16px var(--ds-glow-primary));
    }

    .ds-loader-stars{
      width:42px;height:42px;position:relative;
    }
    .ds-loader-stars::before,
    .ds-loader-stars::after{
      content:"";
      position:absolute;inset:0;margin:auto;
      width:10px;height:10px;border-radius:9999px;
      background:rgba(255,255,255,.9);
      box-shadow:
        0 -16px 0 rgba(255,255,255,.6),
        14px -6px 0 rgba(255,255,255,.45),
        14px 10px 0 rgba(255,255,255,.55),
        0 18px 0 rgba(255,255,255,.4),
        -14px 10px 0 rgba(255,255,255,.6),
        -14px -6px 0 rgba(255,255,255,.45);
      animation:ds-star-pulse 1.1s ${motion.easing.out} infinite;
      filter:drop-shadow(0 0 12px var(--ds-glow-accent));
    }
    .ds-loader-stars::after{
      width:6px;height:6px;
      opacity:.8;
      animation-duration:1.55s;
    }

    @media (prefers-reduced-motion: reduce){
      .ds-transition,.ds-hover-float,.ds-hover-glow,.ds-bg-particles::before,.ds-bg-particles::after,.ds-loader-galaxy,.ds-loader-stars::before,.ds-loader-stars::after{animation:none!important;transition:none!important}
    }
  `
  document.head.appendChild(style)
  return style
}

export function createParticleStyle({
  opacity = 0.85,
  size = 1,
  color = 'rgba(255,255,255,.45)',
  secondaryColor = 'rgba(255,255,255,.3)',
} = {}) {
  const s = Math.max(0.5, Number(size) || 1)
  const o = Math.max(0, Math.min(1, Number(opacity)))
  return {
    position: 'relative',
    isolation: 'isolate',
    '--ds-particle-opacity': String(o),
    '--ds-particle-size': `${s}px`,
    '--ds-particle-color': String(color),
    '--ds-particle-color-2': String(secondaryColor),
  }
}

export function createParallaxController({
  element,
  speed = 0.12,
  axis = 'y',
  max = 48,
  disabled = prefersReducedMotion(),
} = {}) {
  const el = element
  if (!el || typeof window === 'undefined') return { destroy: () => {} }
  const s = Math.max(-1, Math.min(1, Number(speed)))
  const limit = Math.max(0, Number(max) || 0)
  if (disabled) return { destroy: () => {} }

  let raf = 0
  const update = () => {
    raf = 0
    const y = window.scrollY || 0
    const offset = Math.max(-limit, Math.min(limit, -y * s))
    if (axis === 'x') el.style.transform = `translate3d(${offset}px, 0, 0)`
    else el.style.transform = `translate3d(0, ${offset}px, 0)`
  }

  const onScroll = () => {
    if (raf) return
    raf = window.requestAnimationFrame(update)
  }

  window.addEventListener('scroll', onScroll, { passive: true })
  update()

  return {
    destroy: () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) window.cancelAnimationFrame(raf)
    },
  }
}

export const designSystem = {
  colors: cosmicColors,
  moods: moodColors,
  typography,
  spacing,
  radius,
  effects,
  motion,
  components,
}

export default designSystem
