# Structure — dungeon-warden

## Root

- **`server.js`** — the authoritative game server. `class Server {}`, no export,
  runs in the Agent8 isolated-vm sandbox. Owns gold, dungeon validation, raid
  resolution, research, rankings and `$onItemPurchased`.
- **`index.html`** — mounts `#root`, carries the Verse8 iframe size handshake
  (`GAME_SIZE_RESPONSE` / `REQUEST_GAME_SIZE`) and a boot placeholder shown
  until React takes over.
- **`vite.config.ts`** — `base: "./"` (see Context.md), `dist` output.
- **`.env` / `.agent8.lock`** — platform-managed verse identity.
- **`scripts/build-asset-manifest.mjs`** — `npm run assets`; walks
  `public/assets` and writes the per-pack `manifest.json` files.

## `src/`

### Entry

- **`main.tsx`** — `createRoot` under `StrictMode`, wrapped in
  `GameServerProvider`.
- **`App.tsx`** — the whole shell: top bar, banners, tutorial, raid bar, skill
  bar, result modal and the build / manage / research HUD. Wraps its tree in
  `LocaleProvider` so dialogs can call `useT()`.

### `src/game/` — rules and state

- **`types.ts`** — tile and entity types, costs, caps, and the label tables.
  Labels hold **translation keys**, not prose.
- **`useDungeonSave.ts`** — load / save / mutate the dungeon against the server.
- **`useRaid.ts`** — drives the simulation, skills, speed and the ad revive.
- **`grid.ts`, `rooms.ts`, `placements.ts`** — grid encoding and placement rules.
- **`research.ts`, `tutorial.ts`** — content tables, keyed for translation.
- **`settings.ts`** — localStorage preferences (mute, quality, locale, intro and
  tutorial flags). Never progress.
- **`audio.ts`** — CC0 files when present under `public/assets/audio`,
  WebAudio synthesis when not. Both paths share the same cue names.
- **`devtools.ts`** — `window.__dw` / `window.__call` helpers.

### `src/game/sim/` — deterministic simulation

Pure logic, no rendering. Fixed `SIM_DT = 1/20`; emits a `SimEvent[]` stream the
renderer drains each frame.

- **`RaidSim.ts`** — the simulation itself.
- **`units.ts`, `traps.ts`, `pathfinding.ts`** — stats, trap and skill effects,
  routing from entrance to core.

### `src/game/assets/`

- **`ModelLibrary.ts`** — reads the KayKit manifest, matches models by regex,
  clones skinned meshes and supplies the shared animation clips.
- **`publicUrl.ts`** — rebases runtime asset URLs onto the deployment base.

### `src/game/DungeonRenderer.ts`

three.js scene: instanced floors and rock, edge-placed wall panels, landmarks,
unit models with animation mixers, path preview, markers, hit testing and the
custom 4-way-snap camera.

### `src/i18n/`

- **`strings.ts`** — one `ko` / `en` table pair. `StringKey` is derived from the
  Korean table, so a missing English string is a type error.
- **`index.tsx`** — `LocaleProvider`, `useT`, `useLocale`.

### `src/ui/`

`TitleScreen`, `IntroDialog`, `SettingsDialog`, `ShopDialog`,
`LeaderboardDialog`. All translated through `useT()`.

## `public/assets/`

CC0 KayKit models (`kaykit/`, with a generated `manifest.json` per pack) and
audio. Served as static files, fetched at runtime through `publicUrl()`.

## Deviations from the template

- No Tailwind or PostCSS — the game ships hand-written CSS, so
  `tailwind.config.js` and `postcss.config.js` were removed.
- No `src/assets.json`. Assets are large binary packs served from `public/` and
  indexed by a generated manifest instead of a checked-in URL map.
