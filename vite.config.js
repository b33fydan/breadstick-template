import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Limit dep scanning to our own index.html. By default Vite crawls every
    // index.html in the project tree, which trips on the chung-u/ + remotion/
    // junctions (they ship their own demos with their own deps like `three`).
    entries: ['index.html'],
    // Don't pre-bundle MediaPipe Hands — it's a UMD that esbuild can't statically
    // analyze cleanly. Loaded for side-effect, accessed via window.Hands.
    exclude: ['@mediapipe/hands'],
  },
  server: {
    fs: {
      // Don't serve files from junctioned reference dirs over the dev server.
      // Belt-and-suspenders alongside the optimizeDeps.entries fix above.
      deny: ['**/external/**'],
    },
  },
})
