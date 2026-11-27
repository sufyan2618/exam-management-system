import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        // Use the running Compose gateway while Vite serves live source edits.
        target: env.VITE_DEV_PROXY_TARGET || "http://127.0.0.1:8088",
        changeOrigin: true,
      },
    },
  },
  }
})
