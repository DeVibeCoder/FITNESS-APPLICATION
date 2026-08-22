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
    plugins: [
      react(),
      devApiPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'icons/icon.svg', 'icons/apple-touch-icon.png'],
        manifest: {
          name: 'Circuit — Fitness & Accountability',
          short_name: 'Circuit',
          description:
            'Track workouts, weight, steps and meals with your group. Show up, log it, keep the chain going.',
          theme_color: '#14100d',
          background_color: '#faf6f2',
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
            { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          cleanupOutdatedCaches: true,
          // The scan endpoints must always hit the network; nothing about a
          // photo or its analysis belongs in a cache.
          navigateFallbackDenylist: [/^\/api\//],
        },
        devOptions: { enabled: false },
      }),
    ],
  }
})
