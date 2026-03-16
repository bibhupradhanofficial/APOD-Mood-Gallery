import { useEffect, useState } from 'react'
import { getUserProfile, getLevelInfo, supabase } from '../services'

export default function ProfileDashboard() {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user?.id) {
      setLoading(false)
      return
    }

    async function load() {
      setLoading(true)
      try {
        const data = await getUserProfile(session.user.id)
        setProfile(data)
      } catch (err) {
        console.error('Failed to load profile:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [session])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-space-aurora border-t-transparent" />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-12 text-center">
        <h2 className="text-2xl font-bold text-space-stardust">Your Cosmic Identity</h2>
        <p className="mt-4 text-slate-300">Sign in to track your literacy progress, earn points, and unlock badges.</p>
        <div className="mt-8">
           <p className="text-xs text-slate-500 italic">Auth integration is handled by Supabase. Please sign in via the header or sidebar (if available).</p>
        </div>
      </div>
    )
  }

  const levelInfo = getLevelInfo(profile?.points ?? 0)
  const badges = profile?.badges ?? []

  return (
    <div className="mx-auto max-w-4xl animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Profile Card */}
        <div className="md:col-span-1">
          <div className="glass-card p-8 text-center shadow-2xl animate-in fade-in slide-in-from-left-4 duration-700">
            <div className="relative mx-auto h-24 w-24 overflow-hidden rounded-full ring-4 ring-space-aurora/30 shadow-[0_0_30px_rgba(34,197,94,0.2)]">
              <img
                src={session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${session.user.id}`}
                alt="Avatar"
                className="h-full w-full object-cover"
              />
            </div>
            <h2 className="mt-6 text-xl font-bold text-white">{session.user.user_metadata?.full_name || 'Cosmic Explorer'}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{session.user.email}</p>
            <p className="text-[10px] text-space-aurora mt-2 uppercase tracking-widest font-bold">{levelInfo.title}</p>
            
            <div className="mt-8 space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Total Points</span>
                <span className="font-bold text-space-aurora">{profile?.points ?? 0}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800/50 ring-1 ring-inset ring-white/5">
                <div
                  className="h-full bg-gradient-to-r from-space-aurora/40 to-space-aurora/80 shadow-[0_0_10px_rgba(34,197,94,0.4)] transition-all duration-1000"
                  style={{ width: `${levelInfo.progress}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-500 text-right uppercase tracking-tighter">Level {levelInfo.level} • {Math.round(levelInfo.progress)}% to next level</p>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="md:col-span-2 space-y-6">
          {/* Achievement Progress */}
          <div className="glass-card p-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-space-aurora" />
              Cosmic Achievements
            </h3>
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {['Stargazer', 'Planetary Scout', 'Nebula Navigator', 'Galactic Guide', 'Cosmic Sage'].map((badgeName) => {
                const hasBadge = badges.includes(badgeName)
                return (
                  <div
                    key={badgeName}
                    className={[
                      'flex flex-col items-center justify-center glass-card glass-card-hover p-4 transition-all duration-500',
                      hasBadge
                        ? 'border-space-aurora/40 bg-space-aurora/10 text-space-aurora shadow-[0_0_15px_rgba(34,197,94,0.1)] grayscale-0 opacity-100'
                        : 'text-slate-500 opacity-40 grayscale'
                    ].join(' ')}
                  >
                    <div className="text-3xl mb-2">
                       {badgeName === 'Stargazer' && '✨'}
                       {badgeName === 'Planetary Scout' && '🪐'}
                       {badgeName === 'Nebula Navigator' && '☁️'}
                       {badgeName === 'Galactic Guide' && '🌌'}
                       {badgeName === 'Cosmic Sage' && '🧙'}
                    </div>
                    <span className="text-[10px] font-black tracking-widest uppercase text-center">{badgeName}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Literacy Stats */}
          <div className="glass-card p-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-space-aurora" />
              Learning Path
            </h3>
            <div className="mt-4 space-y-4">
               <p className="text-sm text-slate-400">Complete AI Cosmic Quizzes and explore APOD entries to unlock deeper insights into the universe. Every artifact you analyze builds your knowledge.</p>
               <div className="grid grid-cols-2 gap-4">
                  <div className="glass-card bg-white/[0.02] p-4 text-center">
                    <p className="text-2xl font-bold text-white">{profile?.points >= 100 ? 'Master' : 'Initiate'}</p>
                    <p className="text-[10px] uppercase tracking-widest text-slate-500 mt-1">Status</p>
                  </div>
                  <div className="glass-card bg-white/[0.02] p-4 text-center">
                    <p className="text-2xl font-bold text-white">{badges.length}</p>
                    <p className="text-[10px] uppercase tracking-widest text-slate-500 mt-1">Badges Earned</p>
                  </div>
               </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
