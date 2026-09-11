/**
 * Bakes the warden — the monster the player is — out of two asset packs.
 *
 * Both are downloaded by hand into `art-src/` and neither is committed: the
 * licences allow shipping the models inside a game but not redistributing the
 * packs themselves, and the raw files are 47MB and 18MB against a budget where
 * the whole rest of the game is under a megabyte.
 *
 *   Bestiary - Dungeon Monsters Kit (Quaternius, QAL) — the body. Rigged to
 *   the Unreal mannequin skeleton, and shipped with no animation at all.
 *
 *   Universal Animation Library 2 (Quaternius, CC0) — the motion, on that same
 *   skeleton, which is the whole reason these two were chosen together.
 *
 * What comes out is three files: a body with its textures cut to something a
 * phone can hold, the locomotion clips it actually plays with the library's
 * own mannequin thrown away, and the same body cut down to a pair of arms
 * for the view from inside its head. Run with:
 *
 *   node scripts/bake-warden.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, quantize, resample, textureCompress, weld } from "@gltf-transform/functions";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const src = join(root, "art-src");
const out = join(root, "public/assets/warden");

/** The body, and the clips it is given. */
const BODY = join(src, "bestiary/Exports/GLB (Godot-Unreal)/Imp.glb");
const CLIPS = join(src, "ual2/Unreal-Godot/UAL2_Standard.glb");

/*
 * Two motions, chosen for a monster rather than for a person.
 *
 * The library is built for an adventurer - it has sword combos, farming and a
 * phone call. First-person mode is inspection-only, so the zombie idle and
 * walk are the only clips it needs.
 */
const WANTED = {
  Zombie_Idle_Loop: "idle",
  Zombie_Walk_Fwd_Loop: "walk",
};

/** How big a texture may be after baking. The body fills a corner of the view. */
const TEXTURE_SIZE = 512;

/** Which bones count as an arm, when cutting the view model out of the body. */
const ARM_BONES = /^(clavicle|upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)_/;

async function main() {
  for (const file of [BODY, CLIPS]) {
    if (!existsSync(file)) {
      console.error(`missing ${file}`);
      console.error("Unzip the two packs into art-src/bestiary and art-src/ual2 first.");
      process.exit(1);
    }
  }
  mkdirSync(out, { recursive: true });

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

  // --- the body ------------------------------------------------------------
  const body = await io.read(BODY);
  /*
   * The occlusion/roughness/metalness map goes.
   *
   * It is the single heaviest texture in the pack and it is describing a
   * surface nobody will ever inspect: this model is seen as two arms at the
   * bottom of the screen, in a corridor lit by one torch. Flat roughness says
   * the same thing there for nothing.
   */
  for (const material of body.getRoot().listMaterials()) {
    material.setOcclusionTexture(null);
    material.setMetallicRoughnessTexture(null);
    material.setRoughnessFactor(0.85);
    material.setMetallicFactor(0);
  }
  await body.transform(
    weld(),
    dedup(),
    prune({ keepAttributes: false }),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [TEXTURE_SIZE, TEXTURE_SIZE] }),
    // Positions and weights at 14 and 8 bits rather than full floats: three.js
    // reads the quantization extension natively, and it is most of the file.
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 8 }),
  );
  const bodyNodes = new Set(body.getRoot().listNodes().map((node) => node.getName()));
  await io.write(join(out, "warden.glb"), body);

  // --- the clips -----------------------------------------------------------
  const clips = await io.read(CLIPS);
  const root_ = clips.getRoot();

  for (const animation of root_.listAnimations()) {
    const rename = WANTED[animation.getName()];
    if (rename) {
      animation.setName(rename);

      /*
       * The animation library's mannequin has a few finger and foot-tip
       * joints that the imp does not. Three.js can ignore those tracks, but
       * it reports every missing target for every copy of the rig, which
       * floods the console as soon as first-person mode creates its body and
       * view-arms mixers. Keep only channels the shipped body can actually
       * bind, then drop samplers that no surviving channel uses.
       */
      for (const channel of animation.listChannels()) {
        const target = channel.getTargetNode();
        if (!target || !bodyNodes.has(target.getName())) channel.dispose();
      }
      const usedSamplers = new Set(
        animation.listChannels().map((channel) => channel.getSampler()).filter(Boolean),
      );
      for (const sampler of animation.listSamplers()) {
        if (!usedSamplers.has(sampler)) sampler.dispose();
      }
      continue;
    }
    /*
     * Channels and samplers go by hand.
     *
     * Disposing the animation alone leaves its samplers holding the keyframe
     * accessors, so every one of the thirty-nine clips nobody asked for stays
     * in the buffer - six megabytes of motion for four clips. Cut the
     * samplers and the prune below can actually free them.
     */
    for (const channel of animation.listChannels()) channel.dispose();
    for (const sampler of animation.listSamplers()) sampler.dispose();
    animation.dispose();
  }

  /*
   * The library's own mannequin is dropped: the tracks name bones, and the
   * bones are what the body brings. Keeping the mesh would ship a second
   * character nobody draws.
   */
  for (const mesh of root_.listMeshes()) mesh.dispose();
  for (const node of root_.listNodes()) {
    if (node.getMesh() === null && node.getSkin() !== null) node.setSkin(null);
  }
  for (const skin of root_.listSkins()) skin.dispose();

  await clips.transform(resample(), dedup(), prune({ keepLeaves: true }));
  await io.write(join(out, "warden-clips.glb"), clips);

  // --- the arms ------------------------------------------------------------
  await bakeArms(io);

  const size = (file) => `${(readFileSync(file).byteLength / 1024).toFixed(0)}KB`;
  console.log(`warden.glb        ${size(join(out, "warden.glb"))}`);
  console.log(`warden-clips.glb  ${size(join(out, "warden-clips.glb"))}`);
  console.log(`warden-arms.glb   ${size(join(out, "warden-arms.glb"))}`);

  const kept = Object.values(WANTED).join(", ");
  writeFileSync(
    join(out, "SOURCE.md"),
    [
      "# Where the warden came from",
      "",
      "Baked by `scripts/bake-warden.mjs` from two Quaternius packs that are",
      "downloaded by hand into `art-src/` and never committed:",
      "",
      "- **Bestiary - Dungeon Monsters Kit** (Quaternius Asset License) — the body,",
      "  `Imp.glb`. Commercial use allowed, no credit required; the pack itself may",
      "  not be redistributed as an asset pack, which is why only the baked result",
      "  lives here.",
      "- **Universal Animation Library 2** (CC0) — the motion. Both are rigged to",
      "  the same Unreal mannequin skeleton, which is what lets one drive the other.",
      "",
      `Clips kept: ${kept}. Textures cut to ${TEXTURE_SIZE}px WebP, ORM dropped.`,
      "",
    ].join("\n"),
  );
}

/**
 * The same body, with everything that is not an arm cut away.
 *
 * A first-person view needs arms, and no free pack ships a monster's. What
 * it does ship is a whole monster weighted to a named skeleton - so the arms
 * can be taken out of it here, by keeping only the triangles whose vertices
 * are held by an arm bone. Head, chest, legs and tail go; what is left is
 * two arms, their claws, and the mace, on the same rig running the same
 * clips as the body in the room.
 *
 * Done by weight rather than by hand because the alternative is opening a
 * modelling tool, and a script that re-runs is worth more than a file
 * nobody can rebuild.
 */
async function bakeArms(io) {
  const document = await io.read(join(out, "warden.glb"));
  const root = document.getRoot();

  for (const skin of root.listSkins()) {
    const joints = skin.listJoints();
    const arm = new Set();
    joints.forEach((joint, index) => {
      if (ARM_BONES.test(joint.getName())) arm.add(index);
    });
    if (arm.size === 0) continue;

    for (const mesh of root.listMeshes()) {
      for (const primitive of mesh.listPrimitives()) {
        const joints0 = primitive.getAttribute("JOINTS_0");
        const weights0 = primitive.getAttribute("WEIGHTS_0");
        const indices = primitive.getIndices();
        if (!joints0 || !weights0 || !indices) continue;

        // A vertex belongs to the arms when most of its weight does.
        const held = new Uint8Array(joints0.getCount());
        const j = [0, 0, 0, 0];
        const w = [0, 0, 0, 0];
        for (let v = 0; v < held.length; v += 1) {
          joints0.getElement(v, j);
          weights0.getElement(v, w);
          let share = 0;
          for (let k = 0; k < 4; k += 1) if (arm.has(j[k])) share += w[k];
          held[v] = share > 0.5 ? 1 : 0;
        }

        const kept = [];
        for (let i = 0; i < indices.getCount(); i += 3) {
          const a = indices.getScalar(i);
          const b = indices.getScalar(i + 1);
          const c = indices.getScalar(i + 2);
          if (held[a] && held[b] && held[c]) kept.push(a, b, c);
        }

        if (kept.length === 0) {
          primitive.dispose();
          continue;
        }
        indices.setArray(new Uint32Array(kept));
      }
      if (mesh.listPrimitives().length === 0) mesh.dispose();
    }
  }

  await document.transform(prune({ keepAttributes: false }));
  await io.write(join(out, "warden-arms.glb"), document);
}

await main();
