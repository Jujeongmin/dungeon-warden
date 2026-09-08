# Context — dungeon-warden

## Project Overview

DUNGEON WARDEN is a save-based dungeon management game. The player is the
keeper, not the hero: they carve corridors out of rock, post skeleton minions,
set traps, and turn back parties of adventurers who keep coming back stronger.
Progress persists between sessions — the dungeon, the research tree, looted
weapons, prisoners and the roster of recurring nemeses all live on the server.
There is no run to restart and no score to chase.

The scene is rendered in three.js with CC0 KayKit models over a fixed 20 Hz
deterministic simulation.

## Tech Stack

_Exact versions are in `package.json`._

- **Framework**: React 18, React DOM
- **Build / Lang**: Vite, TypeScript
- **3D**: three.js (InstancedMesh terrain, GLTFLoader characters, AnimationMixer)
- **Platform**: `@agent8/gameserver`, `@verse8/platform` (VX shop), `@verse8/ads`
- **Lint**: oxlint
- **Styling**: hand-written CSS (`src/App.css`, `src/index.css`). No Tailwind.

## Critical Memory

- **`base: "./"` is required.** Verse8 serves the game from a sub-path, both in
  the editor preview and in the published verse. Root-absolute asset URLs 404
  and the page comes up blank. Runtime fetches must go through
  `src/game/assets/publicUrl.ts` for the same reason — Vite only rewrites URLs
  it can see at build time.
- **`server.js` at the project root**, `class Server {}` with **no export**.
  It takes priority over `server/dist/server.js` and is the authority on gold,
  raids, research and entitlements; the client never grants itself anything.
- **The server sandbox has no outbound network.** `fetch`, `XMLHttpRequest`,
  `WebSocket`, `require`, `process`, `crypto` and `setTimeout` are all
  undefined. Verified on the live verse via the `capabilities` remote function.
- **`$lock` works** (verified via `probeLock`), including nesting on distinct
  keys, so the double-spend guards around purchases, conversions and research
  are real.
- **`.env` and `.agent8.lock` carry the verse identity.** Never rewrite them.
- Local Cache (`@verse8/local-cache`) must not hold progress or inventory.
