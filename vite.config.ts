import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

// LAN=1 (npm run dev:lan): serve to the whole network over HTTPS with a self-signed certificate.
// Browsers only expose the microphone on https:// or localhost, so plain http://192.168.x.x has no voice.
const lan = !!process.env.LAN;

export default defineConfig({
  plugins: lan ? [basicSsl()] : [],
  build: { chunkSizeWarningLimit: 800 }, // three.js alone is ~600 kB
  server: {
    host: lan || undefined,
    // The game server runs separately (npm run server); the page talks to it through /ws
    proxy: { '/ws': { target: process.env.YACHEIKA_SERVER ?? 'ws://localhost:8788', ws: true } },
  },
});
