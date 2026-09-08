import { TILE, type GridData, type TileId, type Dungeon } from "./types";

/** Mirrors the encoder in server.js. Keep the two in sync. */
export function encodeRLE(cells: number[]): string {
  const parts: string[] = [];
  let run = 1;
  for (let i = 1; i <= cells.length; i++) {
    if (i < cells.length && cells[i] === cells[i - 1]) {
      run++;
    } else {
      parts.push(`${run}*${cells[i - 1]}`);
      run = 1;
    }
  }
  return parts.join(",");
}

export function decodeRLE(str: string, length: number): number[] {
  const cells: number[] = [];
  for (const part of str.split(",")) {
    const [runStr, tileStr] = part.split("*");
    const run = Number(runStr);
    const tile = Number(tileStr);
    for (let k = 0; k < run; k++) cells.push(tile);
  }
  if (cells.length !== length) {
    throw new Error(`RLE length mismatch: got ${cells.length}, expected ${length}`);
  }
  return cells;
}

/**
 * Mutable in-memory grid. Digs land here first and are flushed to the server at
 * checkpoints, because remoteFunction is rate limited to ~10 calls/sec.
 */
export class Grid {
  readonly w: number;
  readonly h: number;
  private cells: number[];

  constructor(data: GridData) {
    this.w = data.w;
    this.h = data.h;
    this.cells = decodeRLE(data.cells, data.w * data.h);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): TileId {
    return this.cells[y * this.w + x] as TileId;
  }

  /** Only rock can be dug, which matches the server's transition rule. */
  canDig(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.get(x, y) === TILE.ROCK;
  }

  dig(x: number, y: number): boolean {
    if (!this.canDig(x, y)) return false;
    this.cells[y * this.w + x] = TILE.FLOOR;
    return true;
  }

  forEach(fn: (x: number, y: number, tile: TileId) => void): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        fn(x, y, this.cells[y * this.w + x] as TileId);
      }
    }
  }

  toData(): GridData {
    return { w: this.w, h: this.h, cells: encodeRLE(this.cells) };
  }

  snapshot(): number[] {
    return this.cells.slice();
  }

  /** Number of tiles that differ from `baseline` — the pending dig count. */
  diffCount(baseline: number[]): number {
    let n = 0;
    for (let i = 0; i < this.cells.length; i++) {
      if (this.cells[i] !== baseline[i]) n++;
    }
    return n;
  }
}

const LOCAL_W = 12;
const LOCAL_H = 12;

/**
 * Offline fallback so `npm run dev` is playable before the first deploy, when
 * VITE_AGENT8_VERSE does not exist yet. Never persisted.
 */
export function createLocalDungeon(): Dungeon {
  const cells = new Array(LOCAL_W * LOCAL_H).fill(TILE.ROCK);
  const midY = Math.floor(LOCAL_H / 2);
  cells[midY * LOCAL_W + 0] = TILE.ENTRANCE;
  cells[midY * LOCAL_W + (LOCAL_W - 1)] = TILE.CORE;
  cells[midY * LOCAL_W + 1] = TILE.FLOOR;
  cells[midY * LOCAL_W + (LOCAL_W - 2)] = TILE.FLOOR;

  const now = Date.now();
  return {
    version: 1,
    grid: { w: LOCAL_W, h: LOCAL_H, cells: encodeRLE(cells) },
    minions: [],
    traps: [],
    rooms: [],
    loot: [],
    prisoners: [],
    adventurers: [],
    research: [],
    entrance: { x: 0, y: midY },
    core: { x: LOCAL_W - 1, y: midY },
    threat: 0,
    wavesRepelled: 0,
    coreBreaches: 0,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
  };
}
