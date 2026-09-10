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

  // @agent8/gameserver lists react as a peer dependency, so whether it ends up
  // sharing our copy or getting one of its own is decided by the order Vite
  // discovers and pre-bundles deps in — which differs between a warm local
  // cache and a cold container. Two React copies means "Invalid hook call",
  // which unmounts the tree and leaves a blank page. Pinning both sides makes
  // that deterministic. The SDK has to be *included* rather than excluded: it
  // ships CJS dependencies (lz4js) that do not load unbundled.
  resolve: { dedupe: ["react", "react-dom"] },
  optimizeDeps: {
    include: ["@agent8/gameserver", "react", "react-dom", "react/jsx-runtime"],
  },

  server: {
    // Vite defaults to 5173 and silently walks to the next free port when it
    // is taken, which leaves any tool that assigned us a port talking to the
    // wrong one. Honour PORT when it is set; unset, this is the old default.
    port: Number(process.env.PORT) || 5173,

    watch: {
      // public/assets holds ~530 CC0 model, texture and audio files. They are
      // static art: watching them buys no HMR and costs one inotify watch each,
      // which the Agent8 dev container cannot afford — its Vite process was
      // dropping its socket and returning 500/503 until it restarted.
      ignored: [
        "**/.git/**",
        "**/node_modules/**",
        "**/public/assets/**",
        "**/art-src/**",
        "**/dist/**",
      ],
    },
  },

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
