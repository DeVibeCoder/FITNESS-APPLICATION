import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'
import { devApiPlugin } from './server/devApiPlugin.ts'

export default defineConfig(({ mode }) => {
  /**
   * Vite only exposes VITE_-prefixed variables, and only to the client. The
   * food-scan endpoint runs in this Node process and reads `process.env`, so
   * the server-side keys are lifted across explicitly.
   *
   * The list is an allow-list on purpose: nothing else from .env is promoted,
   * and none of these ever reach the browser bundle.
   */
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of [
    'GEMINI_API_KEY',
    'GEMINI_MODEL',
    'FDC_API_KEY',
    'FOOD_SCAN_MOCK',
    'WORKOUT_SCAN_MOCK',
  ]) {
    if (env[key] && !process.env[key]) process.env[key] = env[key]
  }

  return {
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      rollupOptions: {
        output: {
          /**
           * Group the vendors by hand.
           *
           * Left alone, per-route splitting turns every lucide icon into its
           * own 200-byte chunk — dozens of extra requests and precache entries
           * for no benefit. These three change rarely, so they also cache well
           * across deploys.
           */
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (/[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/.test(id)) {
              return 'react'
            }
            if (id.includes('lucide-react')) return 'icons'
            if (id.includes('dexie')) return 'dexie'
            return 'vendor'
          },
        },
      },
    },
    /*
     * Authentication needs D1, which only exists inside a Worker, so /api/auth
     * is proxied to one running beside this server:
     *
     *   npx wrangler pages dev .wrangler/api-only --port 8788      *     --d1 DB=<database id> --compatibility-date 2026-08-22      *     --compatibility-flags nodejs_compat
     *
     * Pointed at an empty directory on purpose. Asked to serve the built
     * bundle as well, wrangler took twenty seconds a file and then fell over;
     * given only the functions it is stable, and Vite is far better at the
     * other job anyway.
     *
     * Proxying rather than talking to port 8788 directly is what keeps the
     * session cookie working: the browser only ever sees this origin, so the
     * cookie is same-origin and needs no CORS and no SameSite relaxation.
     * Nothing about production changes — there, one Pages deployment serves
     * both halves already.
     */
    server: {
      proxy: {
        // Auth and the fitness data both need D1, so both go to the Worker.
        // The scan endpoints stay with devApiPlugin above, which serves them
        // from this process and needs no database.
        '/api/auth': {
          target: process.env.API_ORIGIN ?? 'http://127.0.0.1:8788',
          changeOrigin: false,
        },
        '/api/fitness': {
          target: process.env.API_ORIGIN ?? 'http://127.0.0.1:8788',
          changeOrigin: false,
        },
        '/api/data': {
          target: process.env.API_ORIGIN ?? 'http://127.0.0.1:8788',
          changeOrigin: false,
        },
        '/api/admin': {
          target: process.env.API_ORIGIN ?? 'http://127.0.0.1:8788',
          changeOrigin: false,
        },
      },
    },
    plugins: [
      react(),
      devApiPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'icons/favicon-32.png',
          'icons/favicon-64.png',
          'icons/apple-touch-icon.png',
          'icons/rally-mark.png',
        ],
        manifest: {
          name: 'RALLY — Rise, Act, Lift, Live, Yourself',
          short_name: 'RALLY',
          description:
            'Rise, Act, Lift, Live, Yourself. Track workouts, weight, steps and meals with your group.',
          theme_color: '#14100d',
          background_color: '#14100d',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          scope: '/',
          categories: ['health', 'fitness', 'lifestyle'],
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          cleanupOutdatedCaches: true,
          /*
           * The document comes from the network first. This is the whole fix
           * for a returning browser running last week's app.
           *
           * `navigateFallback` below serves the *precached* shell for every
           * navigation, which is cache-first by construction. That is correct
           * offline and wrong online: after a deploy the old service worker
           * kept answering navigations from its own precache, so a returning
           * browser was served the previous build's HTML — measured at two
           * full page loads before it caught up, and indefinitely if the new
           * worker could not install. The stale HTML then asks for the chunk
           * hashes it was built against, and once those age out of the hosting
           * platform the dynamic imports reject and the screen goes blank with
           * no way to recover, because every reload is answered from the same
           * stale cache.
           *
           * So: try the network, fall back to the cached copy. Online, you are
           * never more than one request behind. Offline, the fallback below
           * still opens the app. Four seconds because a slow connection should
           * open the app, not hang on a white page.
           */
          runtimeCaching: [
            {
              urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'rally-shell',
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 8 },
                cacheableResponse: { statuses: [200] },
              },
            },
          ],
          /*
           * `navigateFallback` is deliberately not set.
           *
           * It registers a NavigationRoute backed by the precache, and workbox
           * registers it *before* the runtime rules above — first match wins,
           * so it would answer every navigation from the cache and the rule
           * above would never run. That ordering is exactly how a returning
           * browser ended up two builds behind.
           *
           * The shell is still precached (the manifest transform below keeps
           * `/`), so it is on the device; what changed is that the network is
           * asked first. Offline, the NetworkFirst rule serves whatever
           * navigation it cached last — which for an installed app is
           * `start_url`, `/`. An offline deep link to a URL this browser has
           * never opened online is the one case that now falls through to the
           * browser's offline page, and it is worth that: the alternative was
           * a blank screen online, with no way out of it.
           *
           * `null` rather than omitted: left out, vite-plugin-pwa defaults it
           * to `index.html`, and `index.html` is not in this manifest — the
           * transform below rewrites it to `/`. That default produced a
           * `createHandlerBoundToURL("index.html")` that throws while the
           * worker is starting, which breaks the worker for every request
           * rather than just navigations.
           */
          navigateFallback: null,
          manifestTransforms: [
            (entries) => ({
              manifest: entries.map((entry) =>
                entry.url === 'index.html' ? { ...entry, url: '/' } : entry,
              ),
              warnings: [],
            }),
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
  }
})
