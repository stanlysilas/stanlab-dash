import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  root: 'client',
  resolve: { alias: { '@': path.resolve(process.cwd(), 'client/src') } },
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': process.env.VITE_API_TARGET ?? 'http://localhost:3000' } },
  build: { outDir: '../dist/client', emptyOutDir: true },
});
