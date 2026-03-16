import { supabase } from './supabaseClient'

/**
 * Get the current user's profile from Supabase.
 */
export const getUserProfile = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (error) throw error
    return data
  } catch (error) {
    console.error('Error fetching profile:', error)
    return null
  }
}

/**
 * Update user points and check for level ups/badges.
 */
export const addUserPoints = async (userId, pointsToAdd) => {
  try {
    // 1. Get current points
    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('points, badges')
      .eq('id', userId)
      .single()

    if (fetchError) throw fetchError

    const nextPoints = (profile.points || 0) + pointsToAdd
    const badges = [...(profile.badges || [])]

    // 2. Logic for badges (demo)
    if (nextPoints >= 100 && !badges.includes('Stargazer')) {
      badges.push('Stargazer')
    }
    if (nextPoints >= 500 && !badges.includes('Planetary Scout')) {
      badges.push('Planetary Scout')
    }

    // 3. Update Supabase
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ 
        points: nextPoints, 
        badges: badges,
        updated_at: new Date().toISOString() 
      })
      .eq('id', userId)

    if (updateError) throw updateError
    return { points: nextPoints, badges }
  } catch (error) {
    console.error('Error updating points:', error)
    return null
  }
}

/**
 * Calculate level and title based on points.
 */
export const getLevelInfo = (points) => {
  if (points >= 1000) return { level: 4, title: 'Cosmic Master', next: null }
  if (points >= 500) return { level: 3, title: 'Galactic Sage', next: 1000 }
  if (points >= 100) return { level: 2, title: 'Planetary Scout', next: 500 }
  return { level: 1, title: 'Stargazer', next: 100 }
}
