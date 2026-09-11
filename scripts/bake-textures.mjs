/**
 * Turns an ambientCG material zip into the two small maps the game ships.
 *
 * The packs are 1K JPGs at one to two megabytes a map, which is more than the
 * whole rest of the game weighs. What actually reaches the player here is a
 * tile a couple of centimetres across on a phone, lit by torches, so a 512px
 * colour map and a 512px normal are indistinguishable from the originals and
 * fit in a tenth of the space. Roughness is dropped and set as a constant in
 * the material: it is nearly flat across every stone we use.
 *
 * Run after dropping new zips in, not at build time — the output is committed.
 *
 *   node scripts/bake-textures.mjs <zip> [<zip> ...]
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, mkdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";

const OUT = "public/assets/textures";
const SIZE = 512;

/** Which map we want, and what it is called once it lands. */
const WANTED = [
  { match: /_Color\.jpg$/i, suffix: "color", quality: 78 },
  // GL rather than DX: three.js expects the green channel pointing up.
  { match: /_NormalGL\.jpg$/i, suffix: "normal", quality: 82 },
];

const zips = process.argv.slice(2);
if (zips.length === 0) {
  console.error("usage: node scripts/bake-textures.mjs <material zip> ...");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

for (const zip of zips) {
  const id = basename(zip).replace(/_1K-JPG\.zip$|\.zip$/i, "").toLowerCase();
  const work = mkdtempSync(join(tmpdir(), "acg-"));

  try {
    // PowerShell rather than unzip: it is the one extractor Windows always has.
    execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${work}' -Force`,
    ]);

    for (const want of WANTED) {
      const file = readdirSync(work).find((name) => want.match.test(name));
      if (!file) {
        console.warn(`  ${id}: no ${want.suffix} map in the zip, skipped`);
        continue;
      }

      const to = join(OUT, `${id}_${want.suffix}.webp`);
      await sharp(join(work, file))
        .resize(SIZE, SIZE, { fit: "fill" })
        .webp({ quality: want.quality })
        .toFile(to);

      const before = statSync(join(work, file)).size;
      const after = statSync(to).size;
      console.log(
        `  ${id}_${want.suffix}.webp  ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB`,
      );
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
