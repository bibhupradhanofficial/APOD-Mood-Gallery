import axios from 'axios'

import { NASA_APOD_API_ENDPOINT } from '../constants/nasa'

export async function fetchApod({ date, signal } = {}) {
  const apiKey = import.meta.env.VITE_NASA_API_KEY || 'DEMO_KEY'

  const params = {
    api_key: apiKey,
    ...(date ? { date } : {}),
  }

  const response = await axios.get(NASA_APOD_API_ENDPOINT, { params, signal })
  return response.data
}

