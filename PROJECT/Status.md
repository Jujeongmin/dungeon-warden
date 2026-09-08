# Status — dungeon-warden

## Implemented

- **Server** (`server.js`): dungeon load/save with server-side pricing and path
  validation, raid start/finish, research, rankings, entitlements, reset,
  `$onItemPurchased`. Verified against the live verse.
- **Simulation**: deterministic 20 Hz raid sim — five adventurer classes with
  distinct trap resistance and targeting, minions, traps, rooms, warden skills,
  downed/capture/conversion flow.
- **Rendering**: three.js scene with KayKit models, edge-placed walls,
  landmarks, animation clips from the shared rig files, path preview, damage
  floaters, camera pan/zoom/rotate.
- **Progression**: 17-node research tree, dungeon expansion, looted weapons,
  jail and converts, recurring nemeses with return timers, threat curve.
- **Shell**: title screen, intro, settings (sound, quality, language, tutorial
  replay, reset), five-step tutorial, leaderboard, VX shop.
- **i18n**: Korean and English, seeded from `navigator.language`, switchable in
  settings, persisted per device.

## Verified on the live verse

- `capabilities` — the sandbox has no `fetch` / `XMLHttpRequest` / `WebSocket` /
  `require` / `process` / `crypto` / `setTimeout`.
- `probeLock` — `$lock` runs, returns the callback's value, and nests on
  distinct keys.
- Two exploits found by inspection and closed: an abandoned raid used to leave
  party members marked `raiding` forever, eventually yielding free gold from an
  empty party; and `claimAdReward` had no cap, so it was removed outright.

## Not done

- Real-device mobile performance pass.
- CC0 sound files (audio is synthesised).
- Content depth beyond the current research tree.
