import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev the API runs separately on :8080; in the built image nginx does the
// same proxying, so the frontend code only ever talks to /api either way.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
