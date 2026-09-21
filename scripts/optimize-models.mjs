/**
 * Shrinks the models the game ships.
 *
 * The packs come as exported: full-float vertex data, and animation files
 * that carry a whole mannequin mesh plus every clip in the library. The game
 * draws the characters whole and plays four clips, so:
 *
 *   Characters (adventurers, skeletons) - welded, deduplicated and quantized
 *   so the files are smaller without changing what they draw.
 *   three.js reads KHR_mesh_quantization natively, and every character is
 *   placed as a whole node and sized from its world bounds, so the dequantize
 *   transform the extension adds is accounted for.
 *
 *   Rigs - the mannequin mesh and skin are dropped (the tracks name bones, and
 *   the bones stay), and only the clips DungeonRenderer's CLIP_PATTERNS pick
 *   are kept. Keyframes are resampled, which only removes redundant ones.
 *
 *   Everything, dungeon tiles included - packed with
 *   EXT_meshopt_compression in its lossless mode. It changes how the bytes are
 *   stored, not what they decode to; ModelLibrary hands GLTFLoader the decoder.
 *
 * The dungeon tiles are never quantized: DungeonRenderer.tileProto builds the
 * floor InstancedMesh from a model's raw geometry, which a quantized file would
 * hand over without its dequantize transform.
 *
 * Safe to run again on its own output. Run with:
 *
 *   node scripts/optimize-models.mjs && npm run assets
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune, quantize, resample, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(root, "public/assets");
const kaykit = join(assets, "kaykit");

/** Characters, drawn whole. */
const CHARACTER_DIRS = ["adventurers", "skeletons"];

/**
 * The clips the renderer actually picks, per file: the first match of each
 * CLIP_PATTERNS entry in src/game/DungeonRenderer.ts. Keep these in step
 * with that table - a clip dropped here is a state that stands still.
 */
const RIG_CLIPS = {
  "Rig_Medium_General.glb": ["Idle_A", "Interact", "Death_A"],
  "Rig_Medium_MovementBasic.glb": ["Walking_A"],
};

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const kb = (file) => Math.round(readFileSync(file).byteLength / 1024);

/** Lossless: stores the same values in fewer bytes. */
function pack(doc) {
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
}

async function character(file) {
  const before = kb(file);
  const doc = await io.read(file);
  await doc.transform(
    weld(),
    dedup(),
    prune({ keepAttributes: false }),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 8 }),
  );
  pack(doc);
  await io.write(file, doc);
  return [file, before, kb(file)];
}

async function rig(file, keep) {
  const before = kb(file);
  const doc = await io.read(file);
  const root_ = doc.getRoot();

  for (const animation of root_.listAnimations()) {
    if (keep.includes(animation.getName())) continue;
    // Channels and samplers first, or the keyframe accessors outlive the clip.
    for (const channel of animation.listChannels()) channel.dispose();
    for (const sampler of animation.listSamplers()) sampler.dispose();
    animation.dispose();
  }
  const missing = keep.filter((name) => !root_.listAnimations().some((a) => a.getName() === name));
  if (missing.length) throw new Error(`${file}: missing clips ${missing.join(", ")}`);

  for (const node of root_.listNodes()) {
    if (node.getMesh()) node.setMesh(null);
    if (node.getSkin()) node.setSkin(null);
  }
  for (const mesh of root_.listMeshes()) mesh.dispose();
  for (const skin of root_.listSkins()) skin.dispose();

  await doc.transform(resample(), dedup(), prune({ keepLeaves: true }));
  pack(doc);
  await io.write(file, doc);
  return [file, before, kb(file)];
}

/** Stored as it is, only packed. For files whose geometry must not move. */
async function packOnly(file) {
  const bin = file.replace(/\.gltf$/, ".bin");
  const size = () => kb(file) + (file.endsWith(".gltf") ? kb(bin) : 0);
  const before = size();
  const doc = await io.read(file);
  pack(doc);
  await io.write(file, doc);
  return [file, before, size()];
}

const rows = [];
for (const dir of CHARACTER_DIRS) {
  for (const name of readdirSync(join(kaykit, dir)).filter((n) => n.endsWith(".glb"))) {
    rows.push(await character(join(kaykit, dir, name)));
  }
}
for (const [name, keep] of Object.entries(RIG_CLIPS)) {
  rows.push(await rig(join(kaykit, "animations", name), keep));
}
for (const name of readdirSync(join(kaykit, "dungeon")).filter((n) => n.endsWith(".gltf"))) {
  rows.push(await packOnly(join(kaykit, "dungeon", name)));
}

let before = 0;
let after = 0;
for (const [file, b, a] of rows) {
  before += b;
  after += a;
  console.log(`${String(b).padStart(5)} kB -> ${String(a).padStart(5)} kB  ${file.slice(root.length + 1)}`);
}
console.log(`total ${before} kB -> ${after} kB`);
