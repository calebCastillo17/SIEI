import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // host: true (0.0.0.0) en vez del default (::1 solamente) — en
  // Codespaces el proxy de reenvío de puertos conecta por IPv4 y no
  // alcanza un servidor escuchando solo en loopback IPv6.
  server: {
    host: true,
  },
})
