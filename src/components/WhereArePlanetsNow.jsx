import { format } from 'date-fns'
import { memo, useEffect, useMemo, useState } from 'react'

import {
  getDistanceAuFromVector,
  getGeocentricVectorAu,
  getPlanetSkySeparationFromSunDegrees,
  getSolarSystemBodies,
  getGeocentricEclipticLongitude,
  getSunGeocentricEclipticLongitude,
  signedAngleDifferenceDegrees,
} from '../utils/solarSystem'

function PlanetRow({ planet, date }) {
  const body = planet?.body
  const isEarth = planet?.id === 'earth'
  const elongation = body && !isEarth ? getPlanetSkySeparationFromSunDegrees(body, date) : null
  const earthDistance = isEarth ? 0 : body ? getDistanceAuFromVector(getGeocentricVectorAu(body, date)) : null

  const sunLon = getSunGeocentricEclipticLongitude(date)
  const planetLon = body && !isEarth ? getGeocentricEclipticLongitude(body, date) : null

  const delta = planetLon == null ? null : signedAngleDifferenceDegrees(planetLon, sunLon)
  const skyHint = isEarth ? 'You are here' : delta == null ? '—' : delta > 0 ? 'Evening' : 'Morning'

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/5 px-4 py-3 ring-1 ring-white/10">
      <div className="flex items-center gap-3">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: planet.color }} />
        <span className="text-sm font-medium text-slate-100">{planet.name}</span>
      </div>
      <div className="text-right text-xs text-slate-200/70">
        <div>
          {elongation == null ? '—' : `${elongation.toFixed(0)}°`} from Sun • {skyHint}
        </div>
        <div className="text-slate-200/55">{earthDistance == null ? '—' : `${earthDistance.toFixed(2)} AU`} from Earth</div>
      </div>
    </div>
  )
}

const WhereArePlanetsNow = memo(function WhereArePlanetsNow() {
  const [now, setNow] = useState(() => new Date())
  const planets = useMemo(() => getSolarSystemBodies().slice(0, 7), [])

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60 * 1000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <section className="mt-6 rounded-3xl border border-white/10 bg-space-void/40 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-space-stardust">Where are the planets now?</h3>
          <p className="mt-1 text-xs text-slate-200/70">Quick sky context based on the current date.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-200/70 ring-1 ring-white/10">
            {format(now, 'MMM d, yyyy • HH:mm')}
          </span>
          <a
            href="?view=solarsystem"
            className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-100 ring-1 ring-white/10 hover:bg-white/10"
          >
            Open Solar System
          </a>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2">
        {planets.map((planet) => (
          <PlanetRow key={planet.id} planet={planet} date={now} />
        ))}
      </div>
    </section>
  )
})

export default WhereArePlanetsNow
