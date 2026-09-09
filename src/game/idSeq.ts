/**
 * Highest numeric suffix among ids shaped like `<prefix><digits>` (e.g. "o3"
 * for prefix "o"). Anything that doesn't match is ignored — including a
 * server-minted convert id like `c-<advId>`, which carries no numeric suffix
 * at all. Returns 0 when nothing matches, so a caller can seed a counter
 * directly from the result without a separate empty-collection check.
 *
 * Seeding a generated-id counter from *how many* items are loaded (rather
 * than from the highest suffix actually in use) lets it fall behind: delete
 * some low-numbered items and the counter restarts small, and the next
 * generated id can collide with an id still present in the save.
 */
export function maxIdSuffix(ids: Iterable<string>, prefix: string): number {
  let max = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const suffix = id.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    const n = Number(suffix);
    if (n > max) max = n;
  }
  return max;
}
