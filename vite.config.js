import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'client',
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist',
    emptyOutDir: true
  },
  server: {
    port: 5329,
    proxy: {
      '/api': 'http://localhost:5328',
      '/dl': 'http://localhost:5328',
      '/license': 'http://localhost:5328'
    }
  }
});
