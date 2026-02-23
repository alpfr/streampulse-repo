import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:5105",
    },
  },
  build: {
    outDir: "public",
    emptyOutDir: false,
  },
});
