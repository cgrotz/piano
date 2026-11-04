import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Web MIDI requires a secure context. localhost counts as secure, so plain `npm run
// dev` works on this machine. To test on the Android tablet over the LAN you need
// HTTPS — use `npm run dev:https` (self-signed cert; accept the browser warning once).
const useHttps = !!process.env.HTTPS;

export default defineConfig(({ command }) => ({
  // GitHub Pages project site is served from a subpath, so the production build
  // uses '/piano/' (applied to asset URLs AND picked up by vite-plugin-pwa for the
  // service-worker scope / manifest start_url — both must match or the deployed page
  // goes blank). Dev serves from root for cleaner local URLs and preview tooling.
  base: command === 'build' ? '/piano/' : '/',
  server: process.env.PORT ? { port: Number(process.env.PORT) } : undefined,
  plugins: [
    svelte(),
    useHttps ? basicSsl() : undefined,
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'Piano Tutor',
        short_name: 'Piano Tutor',
        description: 'Practice sheet music with note-by-note MIDI verification.',
        // Match the app's light background (the page's <meta name="theme-color">
        // switches to the dark value in dark mode).
        theme_color: '#f3f4f7',
        background_color: '#f3f4f7',
        display: 'standalone',
        // Relative paths resolve against the manifest URL (/piano/) rather than
        // the domain root — keeps icons correct on a project subpath. PNGs are
        // what Android uses for the home-screen icon; the maskable one keeps the
        // piano inside the safe zone when the launcher crops it to a circle.
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
        ]
      }
    })
  ].filter(Boolean)
}));
