import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'InventoryBlind',
        short_name: 'InventoryBlind',
        description: 'Inteligência para inventários, estoque e gestão operacional',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        orientation: 'any',
        theme_color: '#0F3D68',
        background_color: '#0F3D68',
        icons: [
          { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache only static app assets (precache). Never cache API/auth responses.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Do not cache Supabase or any external API requests
        navigateFallback: '/index.html',
        runtimeCaching: [],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  optimizeDeps: {
    exclude: ['lucide-react'],
    include: ['gsap', 'gsap/ScrollTrigger', '@gsap/react', 'motion/react'],
  },
  build: {
    chunkSizeWarningLimit: 700,
  },
});
