import { defineConfig } from 'vite';

export default defineConfig({
  base: '/Spuders/', // Your GitHub repository name
  build: {
    outDir: 'dist', // This is the default, but good to be explicit
    assetsDir: 'assets', // Ensure assets go to the assets directory
    copyPublicDir: true // Ensure public directory is copied
  }
}); 