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
  SolarSystem,
  SemanticSearch,
  TimelineExplorer,
} from "./components";
import { startBackgroundApodSync } from "./services";
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
          "about",
        ].includes(view)
      )
        return view;
    }
    return "gallery";
  });

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
      case "about":
        return <About />;
      default:
        return <APODGallery />;
    }
  };

  return (
    <div className="min-h-screen px-4 py-8 sm:px-6 lg:px-8">
      <header className="mx-auto max-w-6xl mb-8">
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
        </div>
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
