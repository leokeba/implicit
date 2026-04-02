import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    open: false,
    port: 3000,
    host: true,
    watch: {
      usePolling: true,
      interval: 100,
    },
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