import { Canvas, useFrame } from '@react-three/fiber'
import { Line, OrbitControls, Stars } from '@react-three/drei'
import { format } from 'date-fns'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import { fetchAPODRange, queryApodsBySubject } from '../services'
import {
  describeMoonPhase,
  findNextPlanetAlignment,
  getGeocentricEclipticLongitude,
  getHeliocentricPositionAu,
  getMoonBody,
  getMoonPhaseDegrees,
  getNextGlobalSolarEclipse,
  getNextInferiorSuperiorConjunction,
  getNextLunarEclipse,
  getNextMoonPhases,
  getNextPlanetConjunctionOpposition,
  getPlanetOrbitSamples,
  getPlanetRenderRadius,
  getPlanetSkySeparationFromSunDegrees,
  getSolarSystemBodies,
  getSunGeocentricEclipticLongitude,
  getUpcomingMeteorShowers,
  getViewScalePreset,
  getDistanceAuFromVector,
  getGeocentricVectorAu,
  signedAngleDifferenceDegrees,
} from '../utils/solarSystem'

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function formatMaybeDate(value) {
  if (!value) return '—'
  try {
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return '—'
    return format(date, 'MMM d, yyyy')
  } catch {
    return '—'
  }
}

function normalizeApodText(item) {
  const text = `${item?.title ?? ''} ${item?.explanation ?? ''}`.toLowerCase()
  return text.replace(/\s+/g, ' ').trim()
}

function scoreApodRelevance(item, keywords) {
  if (!item) return 0
  const text = normalizeApodText(item)
  if (!text) return 0
  let score = 0
  for (const raw of keywords) {
    const key = String(raw ?? '').toLowerCase().trim()
    if (!key) continue
    if (text.includes(key)) score += 6
  }
  if (/(planet|moon|lunar|solar system|conjunction|opposition|eclipse|transit|ring|gas giant|ice giant)/.test(text)) score += 1.5
  if (/(mars|jupiter|saturn|venus|mercury|uranus|neptune|pluto)/.test(text)) score += 1
  if (/(cassini|juno|voyager|apollo|venera|magellan|new horizons|messenger)/.test(text)) score += 1
  return score
}

async function loadRelatedApods({ keywords, lookbackDays = 365, limit = 8 }) {
  const end = new Date()
  const start = new Date(end.getTime() - lookbackDays * 86400 * 1000)
  const startString = format(start, 'yyyy-MM-dd')
  const endString = format(end, 'yyyy-MM-dd')

  const subjectCandidates = []
  try {
    const planets = await queryApodsBySubject('planets', { limit: 250 })
    if (Array.isArray(planets)) subjectCandidates.push(...planets)
  } catch {
    subjectCandidates.length = 0
  }

  const rangeCandidates = []
  try {
    const batch = await fetchAPODRange(startString, endString)
    if (Array.isArray(batch)) rangeCandidates.push(...batch)
  } catch {
    rangeCandidates.length = 0
  }

  const seen = new Set()
  const merged = []
  for (const item of [...subjectCandidates, ...rangeCandidates]) {
    if (item?.media_type && item.media_type !== 'image') continue
    const key = item?.date ? `date:${item.date}` : item?.url ? `url:${item.url}` : null
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }

  return merged
    .map((item) => ({ item, score: scoreApodRelevance(item, keywords) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item)
}

const MoonPhaseIcon = memo(function MoonPhaseIcon({ phaseDegrees }) {
  const angle = ((Number(phaseDegrees) % 360) + 360) % 360
  const illumination = 0.5 * (1 - Math.cos((angle * Math.PI) / 180))
  const waxing = angle < 180
  const dx = (waxing ? 1 : -1) * (1 - illumination) * 14
  const clipX = 18 + dx

  return (
    <svg width="46" height="46" viewBox="0 0 46 46" aria-hidden="true">
      <defs>
        <clipPath id="moonClip">
          <circle cx="23" cy="23" r="18" />
        </clipPath>
      </defs>
      <circle cx="23" cy="23" r="19" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.12)" />
      <g clipPath="url(#moonClip)">
        <rect x="5" y="5" width="36" height="36" fill="rgba(0,0,0,0.55)" />
        <ellipse cx={clipX} cy="23" rx="18" ry="18" fill="rgba(255,255,255,0.92)" />
      </g>
    </svg>
  )
})

const OrbitPath = memo(function OrbitPath({ samples, color, scale }) {
  const points = useMemo(() => {
    const out = []
    for (const p of samples) {
      const d = scale.distanceTransform(Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z))
      const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) || 1
      const x = (p.x / r) * d * scale.distanceScale
      const y = (p.z / r) * d * scale.distanceScale
      const z = (p.y / r) * d * scale.distanceScale
      out.push([x, y, z])
    }
    return out
  }, [samples, scale])

  return <Line points={points} color={color} lineWidth={1} transparent opacity={0.35} />
})

const RotationAxis = memo(function RotationAxis({ length, tiltDeg, color, opacity, lineWidth = 1.5 }) {
  const tilt = ((Number(tiltDeg) || 0) * Math.PI) / 180
  const half = (Number(length) || 0) / 2
  if (!Number.isFinite(half) || half <= 0) return null

  return (
    <group rotation={[tilt, 0, 0]}>
      <Line points={[[0, -half, 0], [0, half, 0]]} color={color} transparent opacity={opacity} lineWidth={lineWidth} />
    </group>
  )
})

function Planet({ body, id, name, color, radiusKm, axisTiltDeg, scale, timeRef, onSelect, selected }) {
  const meshRef = useRef(null)
  const updateRef = useRef(0)
  const renderRadius = useMemo(() => getPlanetRenderRadius(radiusKm, scale.radiusScale), [radiusKm, scale.radiusScale])
  const isOuterGiant = id === 'jupiter' || id === 'saturn' || id === 'uranus' || id === 'neptune'
  const axisLength = useMemo(() => {
    const base = renderRadius * (isOuterGiant ? 9.5 : 5.5)
    const min = isOuterGiant ? 0.9 : 0.45
    return Math.max(base, min)
  }, [isOuterGiant, renderRadius])
  const axisLineWidth = useMemo(() => {
    if (isOuterGiant) return 2.4
    return renderRadius < 0.06 ? 2.25 : 1.5
  }, [isOuterGiant, renderRadius])

  useFrame((_, delta) => {
    updateRef.current += delta
    if (updateRef.current < 1 / 18) return
    updateRef.current = 0

    const date = timeRef.current
    if (!date || !meshRef.current) return

    const p = getHeliocentricPositionAu(body, date)
    const au = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) || 1
    const scaledDistance = scale.distanceTransform(au) * scale.distanceScale
    const nx = p.x / au
    const ny = p.y / au
    const nz = p.z / au

    meshRef.current.position.set(nx * scaledDistance, nz * scaledDistance, ny * scaledDistance)
    meshRef.current.rotation.y += delta * 0.15
  })

  return (
    <group
      ref={meshRef}
      onPointerDown={(event) => {
        event.stopPropagation()
        onSelect({ id, name })
      }}
      scale={selected ? 1.22 : 1}
    >
      <RotationAxis
        length={axisLength}
        tiltDeg={axisTiltDeg}
        color={selected ? '#ffffff' : '#cbd5e1'}
        opacity={selected ? 0.7 : 0.3}
        lineWidth={axisLineWidth}
      />
      <mesh>
        <sphereGeometry args={[renderRadius, 32, 32]} />
        <meshStandardMaterial color={color} roughness={0.55} metalness={0.1} emissive={color} emissiveIntensity={selected ? 0.22 : 0.06} />
      </mesh>
    </group>
  )
}

function Sun({ scale }) {
  const sunRef = useRef(null)
  const sunRadius = useMemo(() => clamp(scale.radiusScale * 120, 0.08, 0.3), [scale.radiusScale])

  useFrame((_, delta) => {
    if (!sunRef.current) return
    sunRef.current.rotation.y += delta * 0.08
  })

  return (
    <group ref={sunRef}>
      <RotationAxis length={sunRadius * 5.5} tiltDeg={7.25} color="#fef3c7" opacity={0.55} />
      <mesh>
        <sphereGeometry args={[sunRadius, 44, 44]} />
        <meshStandardMaterial emissive="#ffcc66" emissiveIntensity={1} color="#ffb347" roughness={0.25} metalness={0} />
      </mesh>
    </group>
  )
}

function AsteroidBelt({ scale, count = 900, innerAu = 2.15, outerAu = 3.3 }) {
  const beltRef = useRef(null)
  const meshRef = useRef(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  const asteroidParams = useMemo(() => {
    const seed = Math.floor((innerAu * 1000 + outerAu * 10000 + count) % 2147483647) || 1
    let state = seed
    const next = () => {
      state = (state * 48271) % 2147483647
      return state / 2147483647
    }

    const params = []
    for (let i = 0; i < count; i += 1) {
      const t = next()
      const rAu = innerAu + (outerAu - innerAu) * Math.sqrt(t)
      const theta = next() * Math.PI * 2
      const heightUnit = next() * 2 - 1
      const size = 0.55 + next() * 0.9
      const shade = 0.55 + next() * 0.35
      params.push({ rAu, theta, heightUnit, size, shade })
    }
    return params
  }, [count, innerAu, outerAu])

  useEffect(() => {
    if (!meshRef.current) return

    const innerScaled = scale.distanceTransform(innerAu) * scale.distanceScale
    const outerScaled = scale.distanceTransform(outerAu) * scale.distanceScale
    const thickness = Math.max(outerScaled - innerScaled, 0.01)
    const baseRadius = clamp(scale.radiusScale * 1.6, 0.0025, 0.012)

    for (let i = 0; i < asteroidParams.length; i += 1) {
      const { rAu, theta, heightUnit, size, shade } = asteroidParams[i]
      const rScaled = scale.distanceTransform(rAu) * scale.distanceScale
      const x = Math.cos(theta) * rScaled
      const y = Math.sin(theta) * rScaled
      const z = heightUnit * thickness * 0.12

      dummy.position.set(x, y, z)
      dummy.rotation.set((theta * 0.5) % Math.PI, (theta * 1.3) % Math.PI, (theta * 0.9) % Math.PI)
      const s = baseRadius * size
      dummy.scale.set(s, s * (0.75 + (shade - 0.55) * 0.8), s)
      dummy.updateMatrix()
      meshRef.current.setMatrixAt(i, dummy.matrix)
      meshRef.current.setColorAt(i, new THREE.Color(shade, shade, shade))
    }

    meshRef.current.instanceMatrix.needsUpdate = true
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true
  }, [asteroidParams, dummy, innerAu, outerAu, scale])

  useFrame((_, delta) => {
    if (!beltRef.current) return
    beltRef.current.rotation.z += delta * 0.03
  })

  return (
    <group ref={beltRef}>
      <instancedMesh ref={meshRef} args={[null, null, count]} raycast={() => null}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial vertexColors roughness={0.95} metalness={0.05} />
      </instancedMesh>
    </group>
  )
}

function SolarScene({ bodies, selectedId, onSelectPlanet, scale, timeRef }) {
  const orbitSamples = useMemo(() => {
    const base = new Date()
    const map = new Map()
    for (const planet of bodies) {
      map.set(planet.id, getPlanetOrbitSamples(planet.body, base, 240))
    }
    return map
  }, [bodies])

  return (
    <>
      <color attach="background" args={['#05070c']} />
      <Stars radius={170} depth={50} count={2400} factor={3} saturation={0} fade speed={0.25} />
      <ambientLight intensity={0.22} />
      <pointLight position={[0, 0, 0]} intensity={2.6} distance={260} decay={2} />

      <Sun scale={scale} />
      <AsteroidBelt scale={scale} />

      {bodies.map((planet) => (
        <OrbitPath key={`${planet.id}-orbit`} samples={orbitSamples.get(planet.id) ?? []} color={planet.color} scale={scale} />
      ))}

      {bodies.map((planet) => (
        <Planet
          key={planet.id}
          id={planet.id}
          name={planet.name}
          body={planet.body}
          color={planet.color}
          radiusKm={planet.radiusKm}
          axisTiltDeg={planet.axisTiltDeg}
          scale={scale}
          timeRef={timeRef}
          selected={planet.id === selectedId}
          onSelect={onSelectPlanet}
        />
      ))}

      <OrbitControls enablePan={false} enableDamping dampingFactor={0.08} maxDistance={80} minDistance={6} />
    </>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-slate-200/80">
      <span className="text-slate-200/60">{label}</span>
      <span className="text-right">{value ?? '—'}</span>
    </div>
  )
}

function SpeedButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-full px-3 py-1 text-xs ring-1 transition',
        active ? 'bg-space-aurora/20 text-space-aurora ring-space-aurora/40' : 'bg-white/5 text-slate-100 ring-white/10 hover:bg-white/10',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export default function SolarSystem() {
  const bodies = useMemo(() => getSolarSystemBodies(), [])
  const moon = useMemo(() => getMoonBody(), [])
  const [scaleMode, setScaleMode] = useState('viewable')
  const [distanceBoost, setDistanceBoost] = useState(1)
  const [sizeBoost, setSizeBoost] = useState(1)
  const [selectedPlanetId, setSelectedPlanetId] = useState('earth')
  const [liveMode, setLiveMode] = useState(true)
  const [timeScaleDaysPerSecond, setTimeScaleDaysPerSecond] = useState(0)
  const [displayDate, setDisplayDate] = useState(() => new Date())
  const timeRef = useRef(displayDate)
  const rafRef = useRef(null)

  const scalePreset = useMemo(() => getViewScalePreset(scaleMode), [scaleMode])
  const scale = useMemo(() => {
    return {
      ...scalePreset,
      distanceScale: scalePreset.distanceScale * clamp(distanceBoost, 0.35, 2),
      radiusScale: scalePreset.radiusScale * clamp(sizeBoost, 0.35, 2),
    }
  }, [distanceBoost, scalePreset, sizeBoost])

  useEffect(() => {
    timeRef.current = displayDate
  }, [displayDate])

  useEffect(() => {
    const tick = () => {
      setDisplayDate((prev) => {
        const now = new Date()
        if (liveMode) return now
        const scaleDays = Number(timeScaleDaysPerSecond) || 0
        if (!scaleDays) return prev
        const stepMs = scaleDays * 86400 * 1000 * (1 / 30)
        return new Date(prev.getTime() + stepMs)
      })
      rafRef.current = window.requestAnimationFrame(tick)
    }
    rafRef.current = window.requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
    }
  }, [liveMode, timeScaleDaysPerSecond])

  const selectedPlanet = useMemo(() => bodies.find((p) => p.id === selectedPlanetId) ?? bodies[0], [bodies, selectedPlanetId])
  const apodKeywordKey = useMemo(() => {
    const keywords = Array.isArray(selectedPlanet?.apodKeywords) && selectedPlanet.apodKeywords.length > 0
      ? selectedPlanet.apodKeywords
      : selectedPlanet?.name
        ? [selectedPlanet.name]
        : []
    return keywords.map((k) => String(k ?? '').trim()).filter(Boolean).join('|')
  }, [selectedPlanet])

  const [relatedApods, setRelatedApods] = useState([])
  const [apodStatus, setApodStatus] = useState('idle')

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setApodStatus('loading')
    })

    const keywords = apodKeywordKey ? apodKeywordKey.split('|') : []
    loadRelatedApods({ keywords, lookbackDays: 540, limit: 8 })
      .then((items) => {
        if (cancelled) return
        setRelatedApods(items)
        setApodStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setRelatedApods([])
        setApodStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [apodKeywordKey])

  const [eventsState, setEventsState] = useState(() => ({ status: 'idle', data: null }))
  const eventsDateKey = useMemo(() => {
    try {
      return format(displayDate, 'yyyy-MM-dd')
    } catch {
      return '—'
    }
  }, [displayDate])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setEventsState({ status: 'loading', data: null })
    })

    const baseDate = eventsDateKey && eventsDateKey !== '—' ? new Date(`${eventsDateKey}T12:00:00Z`) : new Date()
    window.setTimeout(() => {
      if (cancelled) return
      const nextSolar = getNextGlobalSolarEclipse(baseDate)
      const nextLunar = getNextLunarEclipse(baseDate)
      const moonPhases = getNextMoonPhases(baseDate)
      const showers = getUpcomingMeteorShowers(baseDate, 4)
      const alignment = findNextPlanetAlignment(baseDate, { daysAhead: 365, minPlanets: 4, maxSpanDegrees: 25 })

      const planetEvents = bodies.map((planet) => {
        if (!planet?.body) return null
        const isInner = planet.id === 'mercury' || planet.id === 'venus'
        if (isInner) {
          const { inferior, superior } = getNextInferiorSuperiorConjunction(planet.body, baseDate)
          return { id: planet.id, name: planet.name, inferior, superior }
        }
        const { conjunction, opposition } = getNextPlanetConjunctionOpposition(planet.body, baseDate)
        return { id: planet.id, name: planet.name, conjunction, opposition }
      })

      setEventsState({
        status: 'ready',
        data: {
          nextSolar,
          nextLunar,
          moonPhases,
          showers,
          alignment,
          planetEvents: planetEvents.filter(Boolean),
        },
      })
    }, 30)

    return () => {
      cancelled = true
    }
  }, [bodies, eventsDateKey])

  const moonPhaseDegrees = getMoonPhaseDegrees(displayDate)
  const moonPhase = describeMoonPhase(moonPhaseDegrees)

  const selectedFacts = selectedPlanet?.facts ?? {}
  const isEarthSelected = selectedPlanetId === 'earth'
  const planetLon = !isEarthSelected && selectedPlanet?.body ? getGeocentricEclipticLongitude(selectedPlanet.body, displayDate) : null
  const sunLon = getSunGeocentricEclipticLongitude(displayDate)
  const lonDelta = planetLon == null ? null : signedAngleDifferenceDegrees(planetLon, sunLon)
  const elongation = !isEarthSelected && selectedPlanet?.body ? getPlanetSkySeparationFromSunDegrees(selectedPlanet.body, displayDate) : null
  const earthDistance = selectedPlanet?.body
    ? isEarthSelected
      ? 0
      : getDistanceAuFromVector(getGeocentricVectorAu(selectedPlanet.body, displayDate))
    : null

  const onSelectPlanet = useCallback(({ id }) => {
    if (!id) return
    setSelectedPlanetId(id)
  }, [])

  return (
    <section className="mx-auto mt-10 w-full max-w-6xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-space-stardust">Interactive Solar System</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-200/75">
            Explore real-time planet positions, adjust scale, and fast-forward through orbital motion.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-200/70">
          <span className="rounded-full bg-white/5 px-3 py-1 ring-1 ring-white/10">{format(displayDate, 'MMM d, yyyy • HH:mm')}</span>
          <span className="rounded-full bg-white/5 px-3 py-1 ring-1 ring-white/10">{liveMode ? 'Live' : 'Simulated'}</span>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-space-void/40">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setLiveMode((prev) => !prev)
                  if (liveMode) setTimeScaleDaysPerSecond(0)
                }}
                className="rounded-full bg-white/5 px-3 py-1.5 text-xs text-slate-100 ring-1 ring-white/10 hover:bg-white/10"
              >
                {liveMode ? 'Pause Live' : 'Resume Live'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setLiveMode(false)
                  setDisplayDate(new Date())
                }}
                className="rounded-full bg-white/5 px-3 py-1.5 text-xs text-slate-100 ring-1 ring-white/10 hover:bg-white/10"
              >
                Reset to Now
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <SpeedButton
                active={timeScaleDaysPerSecond === -120}
                onClick={() => {
                  setLiveMode(false)
                  setTimeScaleDaysPerSecond(-120)
                }}
              >
                Rewind
              </SpeedButton>
              <SpeedButton
                active={timeScaleDaysPerSecond === 0}
                onClick={() => {
                  setLiveMode(false)
                  setTimeScaleDaysPerSecond(0)
                }}
              >
                Stop
              </SpeedButton>
              <SpeedButton
                active={timeScaleDaysPerSecond === 12}
                onClick={() => {
                  setLiveMode(false)
                  setTimeScaleDaysPerSecond(12)
                }}
              >
                12d/s
              </SpeedButton>
              <SpeedButton
                active={timeScaleDaysPerSecond === 120}
                onClick={() => {
                  setLiveMode(false)
                  setTimeScaleDaysPerSecond(120)
                }}
              >
                120d/s
              </SpeedButton>
              <SpeedButton
                active={timeScaleDaysPerSecond === 800}
                onClick={() => {
                  setLiveMode(false)
                  setTimeScaleDaysPerSecond(800)
                }}
              >
                800d/s
              </SpeedButton>
            </div>
          </div>

          <div className="h-[520px] w-full">
            <Canvas camera={{ position: [0, 12, 20], fov: 55 }}>
              <SolarScene bodies={bodies} selectedId={selectedPlanetId} onSelectPlanet={onSelectPlanet} scale={scale} timeRef={timeRef} />
            </Canvas>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-space-void/40 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-space-stardust">{selectedPlanet?.name ?? 'Planet'}</h3>
                <p className="mt-1 text-sm text-slate-200/75">{selectedPlanet?.summary ?? '—'}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPlanetId('earth')}
                className="shrink-0 rounded-full bg-white/5 px-3 py-1 text-xs text-slate-100 ring-1 ring-white/10 hover:bg-white/10"
              >
                Focus Earth
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                <div className="text-xs text-slate-200/60">Separation from Sun</div>
                <div className="mt-2 text-sm font-semibold text-slate-100">
                  {elongation == null ? '—' : `${elongation.toFixed(1)}°`}
                </div>
                <div className="mt-1 text-xs text-slate-200/60">
                  {lonDelta == null ? '—' : lonDelta > 0 ? 'Evening sky (east of Sun)' : 'Morning sky (west of Sun)'}
                </div>
              </div>
              <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                <div className="text-xs text-slate-200/60">Distance from Earth</div>
                <div className="mt-2 text-sm font-semibold text-slate-100">
                  {earthDistance == null ? '—' : `${earthDistance.toFixed(2)} AU`}
                </div>
                <div className="mt-1 text-xs text-slate-200/60">
                  {planetLon == null ? '—' : `Ecliptic lon: ${planetLon.toFixed(1)}°`}
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              {Object.entries(selectedFacts).map(([label, value]) => (
                <InfoRow key={label} label={label} value={value} />
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-space-stardust">Moon phase</h4>
                <div className="text-xs text-slate-200/70">{moonPhase?.label ?? '—'}</div>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <MoonPhaseIcon phaseDegrees={moonPhaseDegrees} />
                <div className="text-xs text-slate-200/70">
                  {moonPhaseDegrees.toFixed(1)}° phase angle • {Math.round(0.5 * (1 - Math.cos((moonPhaseDegrees * Math.PI) / 180)) * 100)}% illuminated
                </div>
              </div>
              <div className="mt-3 text-xs text-slate-200/60">{moon?.summary ?? ''}</div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-space-void/40 p-5">
            <h3 className="text-sm font-semibold text-space-stardust">Scale</h3>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setScaleMode('viewable')}
                className={[
                  'rounded-full px-3 py-1.5 text-xs ring-1 transition',
                  scaleMode === 'viewable'
                    ? 'bg-space-aurora/20 text-space-aurora ring-space-aurora/40'
                    : 'bg-white/5 text-slate-100 ring-white/10 hover:bg-white/10',
                ].join(' ')}
              >
                Viewable
              </button>
              <button
                type="button"
                onClick={() => setScaleMode('realistic')}
                className={[
                  'rounded-full px-3 py-1.5 text-xs ring-1 transition',
                  scaleMode === 'realistic'
                    ? 'bg-space-aurora/20 text-space-aurora ring-space-aurora/40'
                    : 'bg-white/5 text-slate-100 ring-white/10 hover:bg-white/10',
                ].join(' ')}
              >
                Realistic-ish
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs text-slate-200/70">
                  <span>Distance</span>
                  <span>{distanceBoost.toFixed(2)}×</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="1.7"
                  step="0.01"
                  value={distanceBoost}
                  onChange={(e) => setDistanceBoost(Number(e.target.value))}
                  className="mt-2 w-full"
                />
              </div>
              <div>
                <div className="flex items-center justify-between text-xs text-slate-200/70">
                  <span>Planet size</span>
                  <span>{sizeBoost.toFixed(2)}×</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="1.7"
                  step="0.01"
                  value={sizeBoost}
                  onChange={(e) => setSizeBoost(Number(e.target.value))}
                  className="mt-2 w-full"
                />
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-space-void/40 p-5">
            <h3 className="text-sm font-semibold text-space-stardust">Upcoming astronomy</h3>
            {eventsState.status !== 'ready' ? (
              <div className="mt-3 text-xs text-slate-200/60">Calculating…</div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                    <div className="text-xs text-slate-200/60">Next lunar eclipse</div>
                    <div className="mt-2 text-sm font-semibold text-slate-100">
                      {formatMaybeDate(eventsState.data?.nextLunar?.time)}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                    <div className="text-xs text-slate-200/60">Next solar eclipse</div>
                    <div className="mt-2 text-sm font-semibold text-slate-100">
                      {formatMaybeDate(eventsState.data?.nextSolar?.time)}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                  <div className="text-xs font-medium text-slate-100">Moon phases</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-200/70">
                    {(eventsState.data?.moonPhases ?? []).map((p) => (
                      <div key={p.label} className="flex items-center justify-between gap-2">
                        <span className="text-slate-200/60">{p.label}</span>
                        <span>{formatMaybeDate(p.time)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                  <div className="text-xs font-medium text-slate-100">Meteor showers</div>
                  <div className="mt-2 space-y-2 text-xs text-slate-200/70">
                    {(eventsState.data?.showers ?? []).map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-2">
                        <span className="text-slate-200/60">{s.name}</span>
                        <span>{formatMaybeDate(s.time)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                  <div className="text-xs font-medium text-slate-100">Oppositions & conjunctions</div>
                  <div className="mt-2 space-y-2 text-xs text-slate-200/70">
                    {(eventsState.data?.planetEvents ?? []).slice(0, 6).map((entry) => (
                      <div key={entry.id} className="grid grid-cols-[1fr_1fr] gap-2">
                        <div className="text-slate-200/60">{entry.name}</div>
                        <div className="text-right">
                          {'opposition' in entry
                            ? `Opp: ${formatMaybeDate(entry.opposition)}`
                            : `Sup: ${formatMaybeDate(entry.superior)}`}
                        </div>
                        <div />
                        <div className="text-right text-slate-200/60">
                          {'conjunction' in entry
                            ? `Conj: ${formatMaybeDate(entry.conjunction)}`
                            : `Inf: ${formatMaybeDate(entry.inferior)}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                  <div className="text-xs font-medium text-slate-100">Planetary alignment (approx.)</div>
                  <div className="mt-2 text-xs text-slate-200/70">
                    {eventsState.data?.alignment?.time ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-200/60">{formatMaybeDate(eventsState.data.alignment.time)}</span>
                        <span>{eventsState.data.alignment.spanDegrees.toFixed(1)}° span</span>
                      </div>
                    ) : (
                      <div className="text-slate-200/60">No 4-planet tight alignment found in the next year.</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-white/10 bg-space-void/40 p-5">
            <h3 className="text-sm font-semibold text-space-stardust">Related APODs</h3>
            {apodStatus === 'loading' ? <div className="mt-3 text-xs text-slate-200/60">Loading…</div> : null}
            {apodStatus === 'error' ? <div className="mt-3 text-xs text-rose-200/70">Unable to load related APODs.</div> : null}
            {apodStatus === 'ready' && relatedApods.length === 0 ? (
              <div className="mt-3 text-xs text-slate-200/60">No related items found yet.</div>
            ) : null}

            {relatedApods.length > 0 ? (
              <div className="mt-4 grid grid-cols-2 gap-3">
                {relatedApods.slice(0, 6).map((item, index) => (
                  <a
                    key={item?.date ?? item?.url ?? `${selectedPlanetId}-${index}`}
                    href={item?.hdurl ?? item?.url ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="group overflow-hidden rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10"
                    title={item?.title ?? 'APOD'}
                  >
                    <div className="relative aspect-[4/3]">
                      <img src={item?.url ?? ''} alt={item?.title ?? 'APOD'} className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100" />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent p-3">
                        <div className="line-clamp-2 text-[11px] font-medium text-slate-100">{item?.title ?? 'APOD'}</div>
                        <div className="mt-1 text-[10px] text-slate-200/70">{item?.date ?? ''}</div>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-3xl border border-white/10 bg-space-void/40 p-5">
            <h3 className="text-sm font-semibold text-space-stardust">Learn</h3>
            <div className="mt-3 space-y-2 text-sm text-slate-200/75">
              {(selectedPlanet?.education ?? []).slice(0, 4).map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
