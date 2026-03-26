import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    open: false,
    port: 3000,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});