import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Web MIDI requires a secure context. localhost counts as secure, so plain `npm run
// dev` works on this machine. To test on the Android tablet over the LAN you need
// HTTPS — use `npm run dev:https` (self-signed cert; accept the browser warning once).
const useHttps = !!process.env.HTTPS;

export default defineConfig({
  // GitHub Pages project site is served from a subpath. This base is applied to
  // asset URLs AND picked up by vite-plugin-pwa for the service-worker scope and
  // manifest start_url — both must match or the deployed page goes blank / the PWA
  // fails to register. Dev server therefore serves at http://localhost:5173/piano/.
  base: '/piano/',
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
        theme_color: '#1c1c28',
        background_color: '#1c1c28',
        display: 'standalone',
        icons: [
          {
            // Relative so it resolves against the manifest URL (/piano/) rather
            // than the domain root — keeps the icon correct on a project subpath.
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ].filter(Boolean)
});
