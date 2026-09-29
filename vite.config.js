import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Sourcemaps activados: si algo falla en producción, el error en la
  // consola del navegador señala directamente a la línea real de
  // src/App.jsx (con su nombre y número), en vez de un archivo
  // minificado ilegible como "index-XXXX.js:190".
  build: {
    sourcemap: true,
  },
});
