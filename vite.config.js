import { defineConfig } from 'vite';
import { resolve } from 'path'; // Import resolve

export default defineConfig({
  base: '/Spuders/', // Your GitHub repository name
  build: {
    outDir: 'dist', // This is the default, but good to be explicit
    assetsDir: 'assets', // Ensure assets go to the assets directory
    copyPublicDir: true, // Ensure public directory is copied
    rollupOptions: { // Add rollupOptions to specify multiple inputs
      input: {
        main: resolve(__dirname, 'index.html'), // Your main entry point
        'theory-loader': resolve(__dirname, 'src/theory-loader.js') // Renamed for clarity
      },
      output: { // Add output options
        entryFileNames: assetInfo => {
          // Keep 'theory-loader.js' name, others get hash
          return assetInfo.name === 'theory-loader' ? 'assets/[name].js' : 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  }
}); 