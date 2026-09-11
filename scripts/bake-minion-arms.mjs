/**
 * Cuts a pair of arms out of each minion, for the view from inside one.
 *
 * The warden can take a body during a raid, and what it sees when it does has
 * to be that body's arms rather than its own - possessing a skeleton and
 * looking down at an imp's claws is worse than having no arms at all. The
 * minions are KayKit models with no arms file of their own, so the arms are
 * taken out of the shipped body the same way the warden's were.
 *
 * Unlike scripts/bake-warden.mjs this needs nothing from art-src: it reads
 * what is already committed under public/assets/kaykit. Run with:
 *
 *   node scripts/bake-minion-arms.mjs
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { cutArmsAndPrune } from "./lib/cut-arms.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const packs = join(root, "public/assets/kaykit");
const out = join(root, "public/assets/arms");

/**
 * Which body each minion type wears, named the way MODEL_PATTERNS looks for
 * it. The warrior is the rogue model - see the m_warrior patterns, which have
 * always resolved to it, because the free pack ships no warrior.
 */
const BODIES = {
  "warrior-arms": "skeletons/Skeleton_Rogue.glb",
  "mage-arms": "skeletons/Skeleton_Mage.glb",
  // A convert keeps the body it was caught in, so those are rideable too.
  "knight-arms": "adventurers/Knight.glb",
  "barbarian-arms": "adventurers/Barbarian.glb",
  "rogue-arms": "adventurers/Rogue.glb",
  "ranger-arms": "adventurers/Ranger.glb",
  "advmage-arms": "adventurers/Mage.glb",
};

async function main() {
  mkdirSync(out, { recursive: true });
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

  for (const [name, file] of Object.entries(BODIES)) {
    const source = join(packs, file);
    if (!existsSync(source)) {
      console.error(`missing ${source} - unzip the KayKit packs first`);
      process.exitCode = 1;
      return;
    }

    const document = await io.read(source);
    if (!(await cutArmsAndPrune(document))) {
      console.error(`${file}: no arm bones found, nothing written`);
      process.exitCode = 1;
      return;
    }

    const target = join(out, `${name}.glb`);
    await io.write(target, document);
    const size = (readFileSync(target).byteLength / 1024).toFixed(0);
    console.log(`${name}.glb  ${size}KB  (from ${file})`);
  }
}

await main();
