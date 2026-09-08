# Requirements — dungeon-warden

## Coding Patterns

- Function components with hooks; no class components.
- Hand-written CSS. Component styles in `App.css`, globals in `index.css`.
- **No user-facing string in a component.** Everything goes in
  `src/i18n/strings.ts` and is read through `useT()` (or the locale-bound
  `translate()` in `App.tsx`). Label tables in `types.ts`, `research.ts` and
  `tutorial.ts` hold keys, so a missing translation is a type error rather than
  Korean leaking into the English build.
- **Never build a runtime asset URL with a leading slash.** Use
  `publicUrl(path)` from `src/game/assets/publicUrl.ts`.
- Simulation code under `src/game/sim/` stays pure: no DOM, no three.js, no
  `Date.now()` inside a step. Rendering reads the emitted event stream.
- The server decides. The client may predict, but gold, unlocks, raid outcomes
  and entitlements are whatever `server.js` says they are.

## Known Issues / Constraints

- The server sandbox has **no outbound network**, so ad views and purchases
  cannot be verified against a third party. Rewarded ads pay out inside the
  fight (reviving fallen minions) rather than in currency, and entitlements are
  granted only from `$onItemPurchased`.
- `$global.getCollectionItems` cannot combine filters with `orderBy`.
- `$shop` exposes only `generateShopUrl`, `getPlayerAssets` and
  `subscribeCrossRampStatus` — there is no purchase-history query.
- The bundle is a single ~950 kB chunk, mostly three.js. Acceptable for now;
  `chunkSizeWarningLimit` is raised so the advisory is not noise.
- Sounds are synthesised. Dropping CC0 files into `public/assets/audio` and
  running `npm run assets` switches them over with no code change.
