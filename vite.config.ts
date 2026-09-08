import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Verse8 serves the game from a sub-path — the editor preview and the
  // published verse both do — so root-absolute asset URLs 404 and the page
  // comes up blank. Relative URLs work in every case, including plain
  // `vite preview` on localhost. Runtime fetches go through
  // src/game/assets/publicUrl.ts for the same reason.
  base: "./",

  build: {
    outDir: "dist",
    // Skip gzip-size reporting: nobody here optimises by bundle size, and it
    // only slows the build. Output is byte-identical.
    reportCompressedSize: false,
    // three.js legitimately ships a 1-3 MB chunk, so the default 500 kB
    // advisory fires on every build as noise. Keep it for the pathological
    // cases only.
    chunkSizeWarningLimit: 5000,
  },
});
