# Dungeon Warden — defense pivot

**Date:** 2026-09-09
**Status:** approved, not yet implemented

## Why

The game shipped with the player carving corridors out of solid rock. That was
the wrong shape. What the game is meant to be is a **defense**: you are handed a
room, you fill it with monsters and obstacles, and adventurers who walk in are
beaten automatically while you watch.

Digging goes. Everything the digging existed to produce — a route the player
designs, a reason to spend gold early — is produced by placing obstacles
instead.

This is not a rewrite. The deterministic simulation, the renderer, the
authoritative server, minions, traps, rooms, warden skills, the jail and
converts, nemeses, the research tree, looted weapons, the leaderboard, the
economy and the Korean/English UI all survive unchanged. One idea changes: how
terrain works.

## The loop

Unchanged from today. Build, press start, watch the wave resolve, read the
result, build again. Threat rises with each repel and the next party is
stronger. A breached core costs gold, never the dungeon.

## The board

A single open room. All floor. The **entrance** sits at `(0, midY)`, the
**core** at `(w - 1, midY)` — the same fixed pair the game already uses.

| Research | Room | Obstacle budget |
|---|---|---|
| — | 12 × 12 | 20 |
| `expand1` (420 G) | 16 × 12 | 28 |
| `expand2` (700 G) | 20 × 12 | 36 |

The two existing expansion nodes carry the obstacle budget with them rather
than adding new nodes. A bigger room with the same wall budget would make the
maze thinner, not deeper, so the two numbers have to move together. Their
Korean and English labels change from "심층 굴착 / Deep Excavation" to
"던전 확장 / Dungeon Expansion"; ids, costs and prerequisites do not change.

## Obstacles

A fourth kind of placement, alongside minions, traps and rooms. One occupant
per tile, the rule the game already enforces. Obstacles may not sit on the
entrance or the core.

| Type | Cost | HP | Role |
|---|---|---|---|
| Wooden barricade | 12 G | 120 | Early mazing. Cheap, and expected to die. |
| Stone wall | 35 G | 380 | Holds a sealed line long enough to matter. |

**Costs and HP are provisional.** A level-1 knight deals 13 damage every 1.1 s
(≈ 11.8 DPS), so a barricade is about ten seconds of one adventurer's attention
and a stone wall about half a minute. Both numbers get verified against real
parties after implementation, the same way the raid economy was.

Digging cost 10 G per tile and was the early gold sink. Obstacles take that
job.

## How adventurers treat obstacles

One rule, no exceptions:

> **If a walkable path to the core exists, they take it — however long it is.
> Only when no path exists at all do they break through.**

There is no patience, no detour tolerance, no per-class behaviour. A player who
folds the route five times is rewarded with five folds of trap and minion time.

When the room is sealed:

1. Compute the route **ignoring obstacles** — the line they would walk if the
   walls were not there.
2. Walk it until the next tile holds an obstacle.
3. Attack that obstacle until it is destroyed, then carry on.

This targets the wall in the way, not the globally weakest wall. It is cheaper,
it is deterministic without tie-breaking, and on screen it reads the way a
player expects: they smash what is in front of them.

Routes are recomputed only when an obstacle is destroyed — for every
adventurer, since one hole changes the map for all of them. Nothing repaths per
frame.

### Destroyed obstacles do not come back

A wall broken during a raid is **gone**. The player rebuilds and pays again.

This is the counterweight to sealing. Without it, a full seal would be free
time — strictly better than any maze, every wave, forever. With it, sealing is
a purchase: you buy however many seconds the wall's HP is worth, and you buy it
again next wave. The obstacle budget caps how much wall can be standing at
once; the rebuild cost is what makes using it a decision.

## What the player loses

The warning "입구에서 코어까지 길이 이어져야 합니다" disappears, along with the
`NO_PATH` raid error and the client-side path check. Sealing the room is now a
legal, meaningful move, so nothing needs to forbid it. One rule fewer to learn.

## Data model

### Server (`server.js`)

- `SAVE_VERSION` 1 → 2.
- `grid` (RLE-encoded cells) is **removed** from the save. The room is
  described by its size alone, which is derived from research.
- `obstacles: [{ id, type, x, y }]` is added. HP is runtime state inside the
  simulation and is never saved — a raid starts with every standing obstacle at
  full HP, and ends with the destroyed ones removed from the save.
- `DIG_COST` is removed. `OBSTACLE_COST` and `MAX_OBSTACLES` are added, and
  obstacle pricing joins the existing "charge only for what is new or changed"
  validation in `saveDungeon`.
- `startRaid` drops its "no route" rejection.
- `finishRaid` removes obstacles the raid destroyed.

### Migration

Version 2 loads a version 1 save by dropping `grid` and keeping everything
else: gold, research, threat, records, nemeses, prisoners, loot, and the
placed minions, traps and rooms. Those placements sat on carved floor, and the
whole room is floor now, so their coordinates stay valid. Nobody loses a
dungeon.

## Code

| File | Change |
|---|---|
| `server.js` | Save v2, obstacles, pricing, cap, migration; drop grid and `DIG_COST`; `startRaid` stops checking for a route |
| `src/game/types.ts` | `Obstacle`, `ObstacleType`, `OBSTACLE_COST`, `MAX_OBSTACLES`, labels as translation keys |
| `src/game/grid.ts` | Shrinks to room size plus entrance/core. Tile enum keeps `FLOOR`/`ENTRANCE`/`CORE`; `ROCK` goes |
| `src/game/sim/pathfinding.ts` | Takes a set of blocked coordinates instead of a grid; gains the "ignore obstacles" route used when sealed |
| `src/game/sim/RaidSim.ts` | Obstacles as damageable entities; the break-through branch; repath on destruction |
| `src/game/DungeonRenderer.ts` | Obstacle models from the KayKit dungeon pack (`barrier_*`, `wall`, `box_stacked`), with damage state visible |
| `src/game/useDungeonSave.ts` | Obstacle placement and removal; drop dig |
| `src/App.tsx` | Dig/remove tools become obstacle tools; drop the path warning |
| `src/game/research.ts` | `expand1`/`expand2` also raise the obstacle budget; labels renamed |
| `src/i18n/strings.ts` | Obstacle names, hints, renamed research labels — Korean and English |

## Testing

- **Long route respected.** A maze that folds the path many times over is
  walked in full; no obstacle takes damage.
- **Sealed room.** With no route, an adventurer attacks the obstacle on its
  ideal line, destroys it, and every adventurer repaths.
- **Determinism.** The same dungeon and party produce an identical event
  stream across runs — the property the simulation already guarantees.
- **Server pricing.** Obstacles are charged once, re-saving an unchanged
  dungeon costs nothing, the cap is enforced server-side, and obstacles cannot
  be placed on the entrance, the core, or an occupied tile.
- **Migration.** A version 1 save loads as version 2 with gold, research and
  placements intact.
- **Balance pass.** Numeric, through the existing `__dw.stepRaid` harness:
  what a level-1 party costs to stop, and what a sealed line actually buys at
  low and high threat.

## Deliberately not in scope

- Per-class obstacle behaviour (a barbarian smashing what a rogue walks around).
- A shop, rerolls, or merging units. The auto-chess reference was about
  watching the fight resolve, not about its economy.
- More obstacle types. Two are enough to see whether the shape works.
