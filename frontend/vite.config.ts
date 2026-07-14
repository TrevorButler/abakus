import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // FastAPI backend runs separately (uvicorn api:app) -- proxy avoids
      // hardcoding the backend URL in frontend code and sidesteps CORS
      // during local dev even though the API also allows all origins.
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // Backend serves geo_assets/*.geojson at /assets -- separate proxy
      // entry so it doesn't collide with the /api prefix-rewrite above.
      '/map-assets': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/map-assets/, '/assets'),
      },
    },
  },
})
