import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/hbase-04-rowkey-design/',
  server: {
    port: 54304,
  },
})
