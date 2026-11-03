import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // The parent project (D:\code\tst-pl) ships a PostCSS config that wants
  // tailwindcss. This app is plain CSS, so do not search upward for it.
  css: { postcss: { plugins: [] } },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
