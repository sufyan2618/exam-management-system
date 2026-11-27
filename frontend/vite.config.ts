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
          // Direct Vite development targets the API service. Set
          // VITE_DEV_PROXY_TARGET=http://127.0.0.1:8088 only when a local
          // Compose gateway is intentionally listening on that port.
          target: env.VITE_DEV_PROXY_TARGET || "http://127.0.0.1:5000",
          changeOrigin: true,
        },
      },
    },
  }
})
