import * as Astronomy from 'astronomy-engine'

import { METEOR_SHOWERS, MOON_DEFINITION, PLANET_DEFINITIONS } from '../constants/solarSystem'

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function wrapDegrees(angle) {
  const value = Number(angle) % 360
  return value < 0 ? value + 360 : value
}

export function getAstronomyBody(bodyName) {
  const body = Astronomy.Body?.[bodyName]
  if (!body) return null
  return body
}

export function getSolarSystemBodies() {
  return PLANET_DEFINITIONS.map((p) => ({
    ...p,
    body: getAstronomyBody(p.bodyName),
  })).filter((p) => Boolean(p.body))
}

export function getMoonBody() {
  return { ...MOON_DEFINITION, body: getAstronomyBody(MOON_DEFINITION.bodyName) }
}

export function toAstroTime(date) {
  if (date instanceof Astronomy.AstroTime) return date
  return new Astronomy.AstroTime(date instanceof Date ? date : new Date(date))
}

export function getHeliocentricPositionAu(body, date) {
  const time = toAstroTime(date)
  const v = Astronomy.HelioVector(body, time)
  return { x: v.x, y: v.y, z: v.z }
}

export function getGeocentricVectorAu(body, date) {
  const time = toAstroTime(date)
  const v = Astronomy.GeoVector(body, time, true)
  return { x: v.x, y: v.y, z: v.z }
}

export function getDistanceAuFromVector(vec) {
  if (!vec) return null
  const x = Number(vec.x) || 0
  const y = Number(vec.y) || 0
  const z = Number(vec.z) || 0
  return Math.sqrt(x * x + y * y + z * z)
}

export function getGeocentricEclipticLongitude(body, date) {
  const time = toAstroTime(date)
  const v = Astronomy.GeoVector(body, time, true)
  const e = Astronomy.Ecliptic(v)
  return wrapDegrees(e.elon)
}

export function getSunGeocentricEclipticLongitude(date) {
  const time = toAstroTime(date)
  const v = Astronomy.GeoVector(Astronomy.Body.Sun, time, true)
  const e = Astronomy.Ecliptic(v)
  return wrapDegrees(e.elon)
}

export function signedAngleDifferenceDegrees(a, b) {
  const delta = wrapDegrees(a) - wrapDegrees(b)
  const wrapped = ((delta + 540) % 360) - 180
  return wrapped
}

export function getPlanetSkySeparationFromSunDegrees(body, date) {
  if (!body) return null
  if (body === Astronomy.Body.Earth) return null
  const time = toAstroTime(date)
  try {
    return Astronomy.AngleFromSun(body, time)
  } catch {
    return null
  }
}

export function getMoonPhaseDegrees(date) {
  const time = toAstroTime(date)
  return wrapDegrees(Astronomy.MoonPhase(time))
}

export function describeMoonPhase(phaseDegrees) {
  const angle = wrapDegrees(phaseDegrees)
  const eighth = 360 / 8
  const index = Math.floor((angle + eighth / 2) / eighth) % 8
  return [
    { label: 'New Moon', key: 'new' },
    { label: 'Waxing Crescent', key: 'waxing_crescent' },
    { label: 'First Quarter', key: 'first_quarter' },
    { label: 'Waxing Gibbous', key: 'waxing_gibbous' },
    { label: 'Full Moon', key: 'full' },
    { label: 'Waning Gibbous', key: 'waning_gibbous' },
    { label: 'Last Quarter', key: 'last_quarter' },
    { label: 'Waning Crescent', key: 'waning_crescent' },
  ][index]
}

export function getNextMoonPhases(date) {
  const start = toAstroTime(date)
  const phases = [
    { label: 'New Moon', degrees: 0 },
    { label: 'First Quarter', degrees: 90 },
    { label: 'Full Moon', degrees: 180 },
    { label: 'Last Quarter', degrees: 270 },
  ]
  return phases
    .map((phase) => {
      try {
        const found = Astronomy.SearchMoonPhase(phase.degrees, start, 40)
        return found ? { ...phase, time: found.date } : null
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time)
}

export function getPlanetOrbitSamples(body, date, steps = 256) {
  const start = date instanceof Date ? date : new Date(date)
  const periodDays = Astronomy.PlanetOrbitalPeriod(body)
  const totalMs = periodDays * 86400 * 1000
  const base = start.getTime()
  const points = []
  for (let i = 0; i <= steps; i += 1) {
    const frac = i / steps
    const sampleDate = new Date(base + frac * totalMs)
    const pos = getHeliocentricPositionAu(body, sampleDate)
    points.push(pos)
  }
  return points
}

export function getNextGlobalSolarEclipse(date) {
  const start = toAstroTime(date)
  try {
    const event = Astronomy.NextGlobalSolarEclipse(start)
    if (!event) return null
    return {
      label: 'Global solar eclipse',
      time: event.peak?.date ?? event.peak,
      kind: event.kind,
    }
  } catch {
    return null
  }
}

export function getNextLunarEclipse(date) {
  const start = toAstroTime(date)
  try {
    const event = Astronomy.NextLunarEclipse(start)
    if (!event) return null
    return {
      label: 'Lunar eclipse',
      time: event.peak?.date ?? event.peak,
      kind: event.kind,
    }
  } catch {
    return null
  }
}

function nextAnnualDate(fromDate, month, day) {
  const base = fromDate instanceof Date ? fromDate : new Date(fromDate)
  const year = base.getFullYear()
  const candidate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
  if (candidate.getTime() >= base.getTime()) return candidate
  return new Date(Date.UTC(year + 1, month - 1, day, 0, 0, 0))
}

export function getUpcomingMeteorShowers(date, count = 4) {
  const base = date instanceof Date ? date : new Date(date)
  const upcoming = METEOR_SHOWERS.map((shower) => ({
    ...shower,
    time: nextAnnualDate(base, shower.peakMonth, shower.peakDay),
  }))
    .sort((a, b) => a.time - b.time)
    .slice(0, count)
  return upcoming
}

export function getNextPlanetConjunctionOpposition(body, date) {
  const start = date instanceof Date ? date : new Date(date)
  try {
    const conj = Astronomy.SearchRelativeLongitude(body, 0, start)
    const opp = Astronomy.SearchRelativeLongitude(body, 180, start)
    return { conjunction: conj?.date ?? conj, opposition: opp?.date ?? opp }
  } catch {
    return { conjunction: null, opposition: null }
  }
}

export function getNextInferiorSuperiorConjunction(body, date) {
  const start = date instanceof Date ? date : new Date(date)
  try {
    const inferior = Astronomy.SearchRelativeLongitude(body, 0, start)
    const superior = Astronomy.SearchRelativeLongitude(body, 180, start)
    return { inferior: inferior?.date ?? inferior, superior: superior?.date ?? superior }
  } catch {
    return { inferior: null, superior: null }
  }
}

export function findNextPlanetAlignment(date, options = {}) {
  const {
    daysAhead = 365,
    minPlanets = 4,
    maxSpanDegrees = 25,
    bodies = PLANET_DEFINITIONS.map((p) => getAstronomyBody(p.bodyName)).filter(Boolean),
  } = options

  const base = date instanceof Date ? date : new Date(date)
  const dayMs = 86400 * 1000
  for (let dayIndex = 0; dayIndex <= daysAhead; dayIndex += 1) {
    const sampleDate = new Date(base.getTime() + dayIndex * dayMs)
    const longitudes = bodies
      .map((body) => {
        try {
          return { body, lon: getGeocentricEclipticLongitude(body, sampleDate) }
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.lon - b.lon)

    if (longitudes.length < minPlanets) continue

    const duplicated = [...longitudes, ...longitudes.map((p) => ({ ...p, lon: p.lon + 360 }))]
    let best = null
    for (let i = 0; i < longitudes.length; i += 1) {
      for (let j = i + minPlanets - 1; j < i + longitudes.length; j += 1) {
        const span = duplicated[j].lon - duplicated[i].lon
        if (span > maxSpanDegrees) break
        const group = duplicated.slice(i, j + 1)
        if (!best || span < best.span) best = { span, group }
      }
    }

    if (best) {
      return {
        time: sampleDate,
        spanDegrees: best.span,
        bodies: best.group.map((p) => p.body),
      }
    }
  }

  return null
}

export function getViewScalePreset(scaleMode) {
  if (scaleMode === 'realistic') {
    return {
      distanceScale: 2.2,
      radiusScale: 0.0012,
      distanceTransform: (au) => au,
    }
  }

  return {
    distanceScale: 18,
    radiusScale: 0.02,
    distanceTransform: (au) => Math.log10(1 + au * 9),
  }
}

export function kmToEarthRadii(radiusKm) {
  return (Number(radiusKm) || 0) / 6371
}

export function getPlanetRenderRadius(radiusKm, radiusScale) {
  const earthRadii = kmToEarthRadii(radiusKm)
  const scaled = earthRadii * radiusScale
  return clamp(scaled, 0.02, 0.6)
}
