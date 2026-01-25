export default function About() {
  return (
    <section className="mx-auto mt-10 w-full max-w-6xl">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 sm:p-10">
        <p className="text-xs font-medium tracking-widest text-space-aurora/90 uppercase">
          About
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-space-stardust sm:text-3xl">
          APOD Mood Gallery
        </h2>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-200/80">
          APOD Mood Gallery is a creative way to explore NASA&apos;s Astronomy
          Picture of the Day (APOD). It pairs each image with mood tags and
          visual palettes so you can browse space photography by vibe, not just
          by date.
        </p>

        <div className="mt-4 mb-6 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl bg-black/20 p-5 ring-1 ring-white/10">
            <h3 className="text-sm font-semibold text-space-stardust">
              What You Can Do
            </h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-200/75">
              <li>Explore an infinite gallery of APOD imagery.</li>
              <li>
                Open any card for the full story, details, and mood analysis.
              </li>
              <li>Save favorites and build your own space collections.</li>
              <li>
                Search by mood to find images that match your current vibe.
              </li>
            </ul>
          </div>

          <div className="rounded-2xl bg-black/20 p-5 ring-1 ring-white/10">
            <h3 className="text-sm font-semibold text-space-stardust">
              Use Cases
            </h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-200/75">
              <li>
                Pick wallpapers based on mood (calm, dramatic, dreamy, etc.).
              </li>
              <li>
                Create mood boards for design inspiration and color studies.
              </li>
              <li>Discover new topics by exploring timelines and trends.</li>
              <li>
                Share a curated vibe with friends, classmates, or teammates.
              </li>
            </ul>
          </div>
        </div>
        {/* <div className="rounded-2xl bg-black/20 p-5 ring-1 ring-white/10"></div> */}
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-space-stardust sm:text-3xl">
          Developer
        </h2>
        <p className="mt-3 text-sm text-slate-200/75">
          This project is built as a modern front-end experiment focused on
          smooth browsing, thoughtful UI, and fun ways to interact with science
          content. If you&apos;d like to personalize this section, update the
          text in the About page component.
        </p>
        <div className="mt-4 rounded-xl bg-white/5 px-4 py-3 text-xs text-slate-200/70 ring-1 ring-white/10">
          Built with React + Vite + Tailwind, powered by NASA&apos;s APOD data.
        </div>
      </div>
    </section>
  );
}
