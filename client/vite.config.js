import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4001",
      "/socket.io": { target: "http://127.0.0.1:4001", ws: true },
      "/uploads": "http://127.0.0.1:4001",
    },
  },
});
