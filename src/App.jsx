import { useEffect, useState } from "react";

import {
  APODGallery,
  About,
  CollectionBuilder,
  DailyDiscovery,
  ExoplanetExplorer,
  ForYouFeed,
  MoodBoardCreator,
  SpaceQuiz,
  ProfileDashboard,
  SolarSystem,
  SemanticSearch,
  TimelineExplorer,
} from "./components";
import { startBackgroundApodSync, supabase } from "./services";
import { initOpenGraphFromLocation } from "./utils";

function NavButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-4 py-2 text-sm font-medium transition-colors duration-200 rounded-full",
        active
          ? "bg-space-aurora/20 text-space-aurora ring-1 ring-space-aurora/50"
          : "text-slate-300 hover:text-white hover:bg-white/5",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function App() {
  const hasApiKey = Boolean(import.meta.env.VITE_NASA_API_KEY);
  const [activeView, setActiveView] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const view = params.get("view");
      if (
        view &&
        [
          "gallery",
          "daily",
          "search",
          "collections",
          "foryou",
          "moodboard",
          "timeline",
          "exoplanets",
          "solarsystem",
          "quiz",
          "profile",
          "about",
        ].includes(view)
      )
        return view;
    }
    return "gallery";
  });

  const [session, setSession] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [showEmailLogin, setShowEmailLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState(null); // 'sending', 'sent', 'error'

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = async () => {
    setAuthError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
    if (error) {
      setAuthError(error.message);
      // If Google fails, offer email login
      setShowEmailLogin(true);
    }
  };

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    if (!email) return;
    
    setEmailStatus('sending');
    setAuthError(null);
    
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      }
    });
    
    if (error) {
      setAuthError(error.message);
      setEmailStatus('error');
    } else {
      setEmailStatus('sent');
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setActiveView("gallery");
    setAuthError(null);
    setShowEmailLogin(false);
  };

  useEffect(() => {
    const fallbackImage =
      typeof window !== "undefined"
        ? new URL("/vite.svg", window.location.origin).toString()
        : "";
    initOpenGraphFromLocation({
      fallbackMeta: {
        title: "APOD Mood Gallery",
        description:
          "Explore NASA's Astronomy Picture of the Day through moods, palettes, and collections.",
        image: fallbackImage,
        url: typeof window !== "undefined" ? window.location.href : "",
      },
    });
  }, []);

  useEffect(() => {
    const sync = startBackgroundApodSync({
      intervalMs: 6 * 60 * 60 * 1000,
      maxLookbackDays: 21,
    });
    return () => {
      sync?.stop?.();
    };
  }, []);

  const renderView = () => {
    switch (activeView) {
      case "gallery":
        return <APODGallery />;
      case "daily":
        return <DailyDiscovery />;
      case "search":
        return <SemanticSearch />;
      case "collections":
        return <CollectionBuilder />;
      case "foryou":
        return <ForYouFeed />;
      case "moodboard":
        return <MoodBoardCreator />;
      case "timeline":
        return <TimelineExplorer />;
      case "exoplanets":
        return <ExoplanetExplorer />;
      case "solarsystem":
        return <SolarSystem />;
      case "quiz":
        return <SpaceQuiz />;
      case "profile":
        return <ProfileDashboard />;
      case "about":
        return <About />;
      default:
        return <APODGallery />;
    }
  };

  return (
    <div className="min-h-screen px-4 py-8 sm:px-6 lg:px-8 relative overflow-hidden">
      <div className="stardust-bg" aria-hidden="true" />
      <header className="mx-auto max-w-6xl mb-8 relative z-10">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <p className="text-xs font-medium tracking-widest text-space-aurora/90 uppercase">
              NASA Astronomy Pictures
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-space-stardust sm:text-4xl">
              APOD Mood Gallery
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-200/80">
              Explore the cosmos through moods, palettes, and AI-powered
              collections.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {session ? (
              <div className="flex items-center gap-4 glass-card bg-white/5 px-4 py-2 ring-1 ring-white/10 animate-in fade-in zoom-in-95">
                <div className="flex flex-col items-end">
                  <span className="text-xs font-bold text-white truncate max-w-[120px]">
                    {session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || "Explorer"}
                  </span>
                  <button 
                    onClick={handleLogout}
                    className="text-[10px] text-space-aurora uppercase tracking-widest font-bold hover:text-white transition-colors"
                  >
                    Logout
                  </button>
                </div>
                <button 
                  onClick={() => setActiveView("profile")}
                  className={[
                    "relative h-10 w-10 overflow-hidden rounded-full ring-2 transition-transform hover:scale-105 active:scale-95",
                    activeView === "profile" ? "ring-space-aurora" : "ring-white/20"
                  ].join(" ")}
                >
                  <img
                    src={session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${session.user.id}`}
                    alt="Avatar"
                    className="h-full w-full object-cover"
                  />
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-end gap-2">
                <button
                  onClick={handleLogin}
                  className="inline-flex items-center gap-2 rounded-full bg-space-aurora/20 px-6 py-2.5 text-sm font-bold text-space-aurora ring-1 ring-space-aurora/50 transition-all hover:bg-space-aurora/30 hover:ring-space-aurora shadow-[0_0_20px_rgba(34,197,94,0.1)] active:scale-95"
                >
                  <span>Connect Account</span>
                </button>
                {authError && !showEmailLogin && (
                  <span className="text-[10px] text-rose-400 font-medium">Google Auth not enabled. Try Email below.</span>
                )}
              </div>
            )}
          </div>
        </div>

        {showEmailLogin && !session && (
          <div className="mt-6 glass-card p-6 animate-in slide-in-from-top-4 duration-500 max-w-md ml-auto mr-0 ring-1 ring-space-aurora/20">
            <h3 className="text-sm font-bold text-white mb-2 uppercase tracking-widest">Sign in via Magic Link</h3>
            <p className="text-xs text-slate-400 mb-4">Google login is not configured in your Supabase dashboard yet. Use your email to receive a secure login link instead.</p>
            
            {emailStatus === 'sent' ? (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-xs text-emerald-200">
                🚀 Magic link sent! Please check your inbox to continue.
              </div>
            ) : (
              <form onSubmit={handleEmailLogin} className="flex gap-2">
                <input 
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="flex-1 rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm text-white outline-none focus:border-space-aurora/50 transition-colors"
                  required
                />
                <button 
                  type="submit"
                  disabled={emailStatus === 'sending'}
                  className="rounded-xl bg-space-aurora px-4 py-2 text-sm font-bold text-black hover:bg-space-aurora/80 disabled:opacity-50 transition-all"
                >
                  {emailStatus === 'sending' ? 'Sending...' : 'Send Link'}
                </button>
              </form>
            )}
            {authError && emailStatus === 'error' && (
              <p className="mt-2 text-[10px] text-rose-400 font-medium">{authError}</p>
            )}
            <button 
              onClick={() => setShowEmailLogin(false)}
              className="mt-4 text-[10px] text-slate-500 hover:text-white uppercase tracking-widest font-bold transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
        <div>
          <nav className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 mt-8">
            <div className="ml-1">
            <NavButton
              active={activeView === "gallery"}
              onClick={() => setActiveView("gallery")}
            >
              Gallery
            </NavButton>
            </div>
            <NavButton
              active={activeView === "daily"}
              onClick={() => setActiveView("daily")}
            >
              Daily
            </NavButton>
            <NavButton
              active={activeView === "search"}
              onClick={() => setActiveView("search")}
            >
              Mood Search
            </NavButton>
            <NavButton
              active={activeView === "collections"}
              onClick={() => setActiveView("collections")}
            >
              Collections
            </NavButton>
            <NavButton
              active={activeView === "foryou"}
              onClick={() => setActiveView("foryou")}
            >
              For You
            </NavButton>
            <NavButton
              active={activeView === "moodboard"}
              onClick={() => setActiveView("moodboard")}
            >
              Mood Board
            </NavButton>
            <NavButton
              active={activeView === "timeline"}
              onClick={() => setActiveView("timeline")}
            >
              Timeline
            </NavButton>
            <NavButton
              active={activeView === "exoplanets"}
              onClick={() => setActiveView("exoplanets")}
            >
              Exoplanets
            </NavButton>
            <NavButton
              active={activeView === "solarsystem"}
              onClick={() => setActiveView("solarsystem")}
            >
              Solar System
            </NavButton>
            <NavButton
              active={activeView === "quiz"}
              onClick={() => setActiveView("quiz")}
            >
              Quiz
            </NavButton>
            <NavButton
              active={activeView === "about"}
              onClick={() => setActiveView("about")}
            >
              About
            </NavButton>
          </nav>
        </div>

        {!hasApiKey && (
          <div className="mt-6 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100">
            <strong>Note:</strong> No API key detected. Using demo mode (limited
            rates). Create a <code className="font-mono">.env</code> file with{" "}
            <code className="font-mono">VITE_NASA_API_KEY</code> for full
            access.
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl">{renderView()}</main>
    </div>
  );
}

export default App;
