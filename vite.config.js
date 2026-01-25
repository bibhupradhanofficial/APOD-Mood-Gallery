import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { Buffer } from 'node:buffer'

export default defineConfig({
  plugins: [
    {
      name: 'image-proxy',
      configureServer(server) {
        server.middlewares.use('/__image_proxy', async (req, res) => {
          try {
            const requestUrl = new URL(req.url ?? '', 'http://vite.local')
            const rawTarget = requestUrl.searchParams.get('url')
            if (!rawTarget) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'text/plain; charset=utf-8')
              res.end('Missing url')
              return
            }

            let targetUrl
            try {
              targetUrl = new URL(rawTarget)
            } catch {
              res.statusCode = 400
              res.setHeader('Content-Type', 'text/plain; charset=utf-8')
              res.end('Invalid url')
              return
            }

            if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
              res.statusCode = 400
              res.setHeader('Content-Type', 'text/plain; charset=utf-8')
              res.end('Unsupported protocol')
              return
            }

            const hostname = targetUrl.hostname.toLowerCase()
            const allowed = hostname === 'apod.nasa.gov' || hostname.endsWith('.nasa.gov')
            if (!allowed) {
              res.statusCode = 403
              res.setHeader('Content-Type', 'text/plain; charset=utf-8')
              res.end('Host not allowed')
              return
            }

            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 15000)
            let upstream
            try {
              upstream = await fetch(targetUrl.href, {
                redirect: 'follow',
                signal: controller.signal,
                headers: {
                  accept: 'image/*,*/*;q=0.8',
                  referer: 'https://apod.nasa.gov/',
                  'user-agent': 'Mozilla/5.0',
                },
              })
            } finally {
              clearTimeout(timeoutId)
            }

            res.statusCode = upstream.status

            const contentType = upstream.headers.get('content-type')
            if (contentType) res.setHeader('Content-Type', contentType)
            res.setHeader('X-Content-Type-Options', 'nosniff')
            res.setHeader('Cache-Control', upstream.headers.get('cache-control') || 'public, max-age=86400')

            const body = Buffer.from(await upstream.arrayBuffer())
            res.end(body)
          } catch (error) {
            if (res.headersSent) {
              res.end()
              return
            }

            const message = error instanceof Error ? error.message : String(error)
            res.statusCode = 502
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.end(message)
          }
        })
      },
      configurePreviewServer(server) {
        server.middlewares.use('/__image_proxy', async (req, res) => {
          try {
            const requestUrl = new URL(req.url ?? '', 'http://vite.local')
            const rawTarget = requestUrl.searchParams.get('url')
            if (!rawTarget) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'text/plain; charset=utf-8')
              res.end('Missing url')
              return
            }

            let targetUrl
            try {
              targetUrl = new URL(rawTarget)
            } catch {
              res.statusCode = 400
              res.setHeader('Content-Type', 'text/plain; charset=utf-8')
              res.end('Invalid url')
              return
            }

            if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
              res.statusCode = 400
              res.setHeader('Content-Type', 'text/plain; charset=utf-8')
              res.end('Unsupported protocol')
              return
            }

            const hostname = targetUrl.hostname.toLowerCase()
            const allowed = hostname === 'apod.nasa.gov' || hostname.endsWith('.nasa.gov')
            if (!allowed) {
              res.statusCode = 403
              res.setHeader('Content-Type', 'text/plain; charset=utf-8')
              res.end('Host not allowed')
              return
            }

            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 15000)
            let upstream
            try {
              upstream = await fetch(targetUrl.href, {
                redirect: 'follow',
                signal: controller.signal,
                headers: {
                  accept: 'image/*,*/*;q=0.8',
                  referer: 'https://apod.nasa.gov/',
                  'user-agent': 'Mozilla/5.0',
                },
              })
            } finally {
              clearTimeout(timeoutId)
            }

            res.statusCode = upstream.status

            const contentType = upstream.headers.get('content-type')
            if (contentType) res.setHeader('Content-Type', contentType)
            res.setHeader('X-Content-Type-Options', 'nosniff')
            res.setHeader('Cache-Control', upstream.headers.get('cache-control') || 'public, max-age=86400')

            const body = Buffer.from(await upstream.arrayBuffer())
            res.end(body)
          } catch (error) {
            if (res.headersSent) {
              res.end()
              return
            }

            const message = error instanceof Error ? error.message : String(error)
            res.statusCode = 502
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.end(message)
          }
        })
      },
    },
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['vite.svg'],
      manifest: {
        name: 'APOD Mood Gallery',
        short_name: 'APOD Mood',
        description: 'Explore NASA APOD images by mood, color, and time.',
        theme_color: '#050816',
        background_color: '#050816',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/vite.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
          { src: '/vite.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://api.nasa.gov' && url.pathname.includes('/planetary/apod'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'nasa-apod-api',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'apod-images',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api/exoplanets-archive': {
        target: 'https://exoplanetarchive.ipac.caltech.edu',
        changeOrigin: true,
        secure: true,
        timeout: 12000,
        proxyTimeout: 12000,
        rewrite: (path) => path.replace(/^\/api\/exoplanets-archive/, ''),
      },
      '/api/exoplanets-eu': {
        target: 'https://exoplanet.eu',
        changeOrigin: true,
        secure: true,
        timeout: 20000,
        proxyTimeout: 20000,
        rewrite: (path) => path.replace(/^\/api\/exoplanets-eu/, ''),
      },
    },
  },
  preview: {
    proxy: {
      '/api/exoplanets-archive': {
        target: 'https://exoplanetarchive.ipac.caltech.edu',
        changeOrigin: true,
        secure: true,
        timeout: 12000,
        proxyTimeout: 12000,
        rewrite: (path) => path.replace(/^\/api\/exoplanets-archive/, ''),
      },
      '/api/exoplanets-eu': {
        target: 'https://exoplanet.eu',
        changeOrigin: true,
        secure: true,
        timeout: 20000,
        proxyTimeout: 20000,
        rewrite: (path) => path.replace(/^\/api\/exoplanets-eu/, ''),
      },
    },
  },
})
