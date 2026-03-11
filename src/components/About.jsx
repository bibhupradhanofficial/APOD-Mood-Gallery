export default function About() {
  const socialLinks = [
    {
      label: 'LinkedIn',
      href: 'https://www.linkedin.com/in/bibhupradhanofficial/',
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
          className="h-5 w-5"
        >
          <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.03-1.85-3.03-1.85 0-2.13 1.44-2.13 2.93v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.62-1.85 3.33-1.85 3.56 0 4.22 2.34 4.22 5.39v6.35ZM5.33 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14ZM7.11 20.45H3.55V9h3.56v11.45ZM22.23 0H1.77C.79 0 0 .78 0 1.75v20.5C0 23.22.79 24 1.77 24h20.46c.98 0 1.77-.78 1.77-1.75V1.75C24 .78 23.21 0 22.23 0Z" />
        </svg>
      ),
    },
    {
      label: 'GitHub',
      href: 'https://github.com/bibhupradhanofficial',
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
          className="h-5 w-5"
        >
          <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1.1-.8.1-.8.1-.8 1.2.1 1.9 1.2 1.9 1.2 1.1 1.9 2.9 1.3 3.6 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.4 11.4 0 0 1 6 0C17.5 4.1 18.5 4.4 18.5 4.4c.6 1.6.2 2.8.1 3.1.8.9 1.2 2 1.2 3.2 0 4.6-2.7 5.6-5.3 5.9.4.3.8 1 .8 2.1v3.1c0 .3.2.7.8.6A12 12 0 0 0 12 .3Z" />
        </svg>
      ),
    },
    {
      label: 'Instagram',
      href: 'https://www.instagram.com/techtonicquill/',
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
          className="h-5 w-5"
        >
          <path d="M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9A5.5 5.5 0 0 1 16.5 22h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2Zm0 2A3.5 3.5 0 0 0 4 7.5v9A3.5 3.5 0 0 0 7.5 20h9a3.5 3.5 0 0 0 3.5-3.5v-9A3.5 3.5 0 0 0 16.5 4h-9ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm5.75-2.25a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Z" />
        </svg>
      ),
    },
    {
      label: 'Twitter',
      href: 'https://x.com/TechtonicQuill',
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
          className="h-5 w-5"
        >
          <path d="M18.24 2.25h3.68l-8.05 9.2L23.3 21.75h-7.4l-5.8-6.69-5.86 6.69H.56l8.6-9.83L.7 2.25h7.6l5.24 6.06 5.7-6.06Zm-1.29 17.3h2.04L7.19 4.34H5.02l11.93 15.21Z" />
        </svg>
      ),
    },
  ];

  return (
    <section className="mx-auto mt-10 w-full max-w-6xl">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 sm:p-10">
        <p className="text-xs font-medium tracking-widest text-space-aurora/90 uppercase">
          About
        </p>
        <h2 className="mt-5 text-2xl font-semibold tracking-tight text-space-stardust sm:text-3xl">
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
        <div className="mt-4 rounded-xl bg-white/5 px-4 py-3 text-xs text-slate-200/70 ring-1 ring-white/10">
          <span className="text-space-aurora/80">system_info: </span>Built with React + Vite + Tailwind, powered by NASA&apos;s APOD data.
        </div>
        {/* <div className="rounded-2xl bg-black/20 p-5 ring-1 ring-white/10"></div> */}
        <h2 className="mt-5 text-2xl font-semibold tracking-tight text-space-stardust sm:text-3xl">
          Developer
        </h2>
        <div className="mt-3 flex flex-col gap-6 sm:flex-row sm:items-start text-left">
          <div className="flex-1 sm:text-left">
            <h3 className="text-xl font-medium text-white">Bibhu Pradhan</h3>
            <p className="mt-1 text-sm font-medium text-space-aurora/80">Full-Stack Developer & Creative Coder</p>
            <p className="mt-4 text-sm leading-relaxed text-slate-400">
              I’m Bibhu Pradhan, a passionate Software Developer driven by a vision to create meaningful impact in society through technology. With a strong foundation in software development and a keen interest in Generative AI (GenAI), I strive to build solutions that solve real-world problems and empower users with intelligent, efficient tools.
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-3">
          {socialLinks.map((item) => (
            <a
              key={item.label}
              href={item.href}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={item.label}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-slate-200/70 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-space-aurora/60"
            >
              {item.icon}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
