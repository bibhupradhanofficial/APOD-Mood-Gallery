import { supabase } from './supabaseClient'

/**
 * Supabase Data Service
 * Handles interaction with the persistent PostgreSQL database.
 */

export const getApodFromDb = async (date) => {
  const { data, error } = await supabase
    .from('apods')
    .select('*')
    .eq('date', date)
    .single()

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching APOD from DB:', error)
    return null
  }
  return data
}

export const saveApodToDb = async (apod) => {
  const { data, error } = await supabase
    .from('apods')
    .upsert({
      date: apod.date,
      title: apod.title,
      explanation: apod.explanation,
      url: apod.url,
      hdurl: apod.hdurl,
      media_type: apod.media_type || 'image',
      copyright: apod.copyright,
      moods: apod.moods || [],
      colors: apod.colors || [],
      subjects: apod.subjects || []
    }, { onConflict: 'date' })

  if (error) {
    console.error('Error saving APOD to DB:', error)
  }
  return data
}

export const searchApodsByMood = async (mood) => {
  const { data, error } = await supabase
    .from('apods')
    .select('*')
    .contains('moods', [mood])

  if (error) {
    console.error('Error searching APODs by mood:', error)
    return []
  }
  return data
}

// User Profile & Progress
export const getProfile = async (userId) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (error) {
    console.error('Error fetching profile:', error)
    return null
  }
  return data
}

export const updatePoints = async (userId, pointsToAdd) => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('points')
    .eq('id', userId)
    .single()

  const newPoints = (profile?.points || 0) + pointsToAdd

  const { error } = await supabase
    .from('profiles')
    .update({ points: newPoints })
    .eq('id', userId)

  if (error) {
    console.error('Error updating points:', error)
  }
}
