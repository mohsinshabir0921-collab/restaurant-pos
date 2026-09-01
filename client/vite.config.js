import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

function posDevFallback() {
  return {
    name: 'pos-dev-fallback',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const u = req.url.split('?')[0];
        if ((u === '/pos' || u.startsWith('/pos/')) && !/\.\w+$/.test(u)) {
          req.url = '/pos.html';
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [react(), posDevFallback()],
  build: {
    rollupOptions: {
      input: {
        website: fileURLToPath(new URL('./index.html', import.meta.url)),
        pos: fileURLToPath(new URL('./pos.html', import.meta.url)),
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})