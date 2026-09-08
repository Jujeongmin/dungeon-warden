import { ROOM_SIZE, type PlacedRoom, type RoomEffects, type RoomType } from "./types";

const BASE_MAX_MINIONS = 8;
const BARRACKS_MINION_BONUS = 2;
const MAX_MINION_CAP = 16;
const WORKSHOP_COOLDOWN_STEP = 0.8;
const MIN_TRAP_COOLDOWN_SCALE = 0.5;
const VAULT_PLUNDER_STEP = 0.6;
const MIN_PLUNDER_SCALE = 0.3;
const ALTAR_REVIVE_STEP = 0.6;
const MIN_REVIVE_SCALE = 0.25;

const JAIL_CELLS_PER_ROOM = 2;

export const EMPTY_ROOM_EFFECTS: RoomEffects = {
  minionCap: BASE_MAX_MINIONS,
  trapCooldownScale: 1,
  plunderScale: 1,
  reviveScale: 1,
  treasuryCount: 0,
  jailCapacity: 0,
};

/** Mirrors roomEffects() in server.js. The server's answer always wins. */
export function roomEffects(rooms: PlacedRoom[]): RoomEffects {
  let minionCap = BASE_MAX_MINIONS;
  let trapCooldownScale = 1;
  let plunderScale = 1;
  let reviveScale = 1;
  let treasuryCount = 0;
  let jailCapacity = 0;

  for (const room of rooms) {
    const type: RoomType = room.type;
    if (type === "barracks") minionCap += BARRACKS_MINION_BONUS;
    else if (type === "workshop") trapCooldownScale *= WORKSHOP_COOLDOWN_STEP;
    else if (type === "vault") plunderScale *= VAULT_PLUNDER_STEP;
    else if (type === "altar") reviveScale *= ALTAR_REVIVE_STEP;
    else if (type === "treasury") treasuryCount++;
    else if (type === "jail") jailCapacity += JAIL_CELLS_PER_ROOM;
  }

  return {
    minionCap: Math.min(minionCap, MAX_MINION_CAP),
    trapCooldownScale: Math.max(trapCooldownScale, MIN_TRAP_COOLDOWN_SCALE),
    plunderScale: Math.max(plunderScale, MIN_PLUNDER_SCALE),
    reviveScale: Math.max(reviveScale, MIN_REVIVE_SCALE),
    treasuryCount,
    jailCapacity,
  };
}

export function roomTiles(room: { x: number; y: number }): Array<{ x: number; y: number }> {
  const tiles: Array<{ x: number; y: number }> = [];
  for (let dy = 0; dy < ROOM_SIZE; dy++) {
    for (let dx = 0; dx < ROOM_SIZE; dx++) {
      tiles.push({ x: room.x + dx, y: room.y + dy });
    }
  }
  return tiles;
}

export function roomCovers(room: PlacedRoom, x: number, y: number): boolean {
  return (
    x >= room.x && x < room.x + ROOM_SIZE && y >= room.y && y < room.y + ROOM_SIZE
  );
}

/** Treasuries pull a raiding party off the direct route. */
export function lureTiles(rooms: PlacedRoom[]): Array<{ x: number; y: number }> {
  return rooms.filter((r) => r.type === "treasury").map((r) => ({ x: r.x, y: r.y }));
}
