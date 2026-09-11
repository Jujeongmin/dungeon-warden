/**
 * Cuts a pair of arms out of a whole body, by bone weight.
 *
 * A first-person view needs arms, and none of the free packs ship a monster's
 * or a skeleton's on their own. What they do ship is a whole body weighted to
 * a named rig - so the arms can be taken out of it here, by keeping only the
 * triangles whose vertices are held by an arm bone. Head, chest, legs, tail
 * and cape go; what is left is two arms on the same rig, running the same
 * clips as the body standing in the room.
 *
 * Done by weight rather than by hand because the alternative is opening a
 * modelling tool, and a script that re-runs is worth more than a file nobody
 * can rebuild.
 */
import { prune } from "@gltf-transform/functions";

/**
 * Which bones count as an arm, in both of the naming conventions in use here.
 *
 * The Bestiary imp is rigged to the Unreal mannequin, which separates the
 * fingers and joins words with an underscore; KayKit's skeletons use a
 * shorter rig with a dot. Matching both means one cut serves every body the
 * game can put a camera inside.
 */
export const ARM_BONES =
  /^(clavicle|upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)_|^(upperarm|lowerarm|wrist|hand|handslot)\.[lr]$/;

/** How much of a vertex has to hang off an arm before it counts as one. */
const ARM_SHARE = 0.5;

/**
 * Strips `document` down to its arms, in place.
 *
 * Returns false when the rig carries no arm bone this knows the name of, so a
 * caller can skip writing a file that would have come out empty.
 */
export function cutArms(document) {
  const root = document.getRoot();
  const skins = root.listSkins();
  if (skins.length === 0) return false;

  const arm = new Set();
  for (const skin of skins) {
    skin.listJoints().forEach((joint, index) => {
      if (ARM_BONES.test(joint.getName())) arm.add(index);
    });
  }
  if (arm.size === 0) return false;

  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const joints0 = primitive.getAttribute("JOINTS_0");
      const weights0 = primitive.getAttribute("WEIGHTS_0");
      const indices = primitive.getIndices();

      /*
       * Anything unskinned is dressing, and dressing is not an arm.
       *
       * KayKit hangs a hood and a cape off the rig as plain meshes rather
       * than skinned ones. A weight test cannot reach them, and left alone
       * they would be the only thing the camera could see.
       */
      if (!joints0 || !weights0 || !indices) {
        primitive.dispose();
        continue;
      }

      // A vertex belongs to the arms when most of its weight does.
      const held = new Uint8Array(joints0.getCount());
      const j = [0, 0, 0, 0];
      const w = [0, 0, 0, 0];
      for (let v = 0; v < held.length; v += 1) {
        joints0.getElement(v, j);
        weights0.getElement(v, w);
        let share = 0;
        for (let k = 0; k < 4; k += 1) if (arm.has(j[k])) share += w[k];
        held[v] = share > ARM_SHARE ? 1 : 0;
      }

      // Keep a triangle only when all three corners are arm, then rewrite the
      // index buffer; prune throws away the vertices nothing points at.
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

  return root.listMeshes().length > 0;
}

/** Cuts, then drops everything the cut left unreferenced. */
export async function cutArmsAndPrune(document) {
  if (!cutArms(document)) return false;
  await document.transform(prune({ keepAttributes: false }));
  return true;
}
