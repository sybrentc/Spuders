import { defineConfig } from 'vite';

export default defineConfig({
  base: '/Spuders/', // Your GitHub repository name
  build: {
    outDir: 'dist' // This is the default, but good to be explicit
  }
}); 