import * as THREE from "three";
import { ModelLibrary, fitToTile, type LoadedModel } from "./ModelLibrary";

/**
 * Tool icons, baked from the models the tools actually place.
 *
 * A toolbar of fifteen Korean labels is a list you have to read. Icons make it
 * something you can scan — but a bought icon set has no barricade, no skeleton
 * mage and no spike plate in it, and drawing fifteen glyphs by hand would give
 * the player pictures that only approximate what lands on the board.
 *
 * The models are already loaded, so each tool is photographed instead: one
 * offscreen render per key, lit the same warm way as the dungeon, cached as a
 * data URL. The icon for a barricade *is* the barricade, at the same angle the
 * player sees it from.
 *
 * This costs one temporary WebGL context, used once at startup and released.
 */

/** Matches the scene's camera pitch, so an icon reads as the same object. */
const PITCH = THREE.MathUtils.degToRad(52);
const YAW = THREE.MathUtils.degToRad(35);

export async function bakeModelIcons(
  models: ModelLibrary,
  keys: string[],
  size = 96,
): Promise<Record<string, string>> {
  const icons: Record<string, string> = {};
  if (!models.available) return icons;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      // toDataURL reads the drawing buffer, which is otherwise cleared on
      // present.
      preserveDrawingBuffer: true,
    });
  } catch {
    // A second GL context is a reasonable thing for a device to refuse. The
    // toolbar falls back to labels alone.
    return icons;
  }

  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.setClearAlpha(0);

  /*
   * Lit much harder than the dungeon is.
   *
   * In the room these models are meant to sit in shadow between torches; at
   * 34 pixels on a dark panel that same lighting turns them into unreadable
   * silhouettes. An icon's job is to be recognised, so it gets a bright even
   * wash and a fill from below to keep the underside from going black.
   */
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xfff2dd, 2.6));
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(3, 6, 4);
  const fill = new THREE.DirectionalLight(0xffd9a8, 1.4);
  fill.position.set(-4, -2, -3);
  scene.add(key, fill);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);

  for (const modelKey of keys) {
    const model: LoadedModel | null = await models.load(modelKey);
    if (!model) continue;

    const object = models.instantiate(model);
    // One tile wide, so every icon is drawn to the same scale as its
    // neighbours rather than each filling its own frame.
    fitToTile(object, 1);

    const holder = new THREE.Group();
    holder.add(object);
    scene.add(holder);

    // Frame whatever the model turned out to be, with a little air.
    const bounds = new THREE.Box3().setFromObject(holder);
    const centre = bounds.getCenter(new THREE.Vector3());
    const radius = bounds.getSize(new THREE.Vector3()).length() * 0.5 || 1;
    const half = radius * 1.15;

    camera.left = -half;
    camera.right = half;
    camera.top = half;
    camera.bottom = -half;
    camera.updateProjectionMatrix();

    const distance = radius * 4;
    camera.position.set(
      centre.x + Math.sin(YAW) * Math.cos(PITCH) * distance,
      centre.y + Math.sin(PITCH) * distance,
      centre.z + Math.cos(YAW) * Math.cos(PITCH) * distance,
    );
    camera.lookAt(centre);

    renderer.render(scene, camera);
    icons[modelKey] = canvas.toDataURL("image/png");

    scene.remove(holder);
    // Deliberately not disposed. `instantiate` clones the node hierarchy but
    // every clone still points at the *same* geometry and material objects as
    // the model in ModelLibrary's cache — disposing them here destroyed the
    // textures the dungeon itself draws with, which showed up as
    // "Texture marked for update but no image data found" on every frame for
    // the rest of the session. Dropping the reference is enough; the shared
    // resources are meant to outlive this function.
  }

  renderer.dispose();
  // Release the context rather than waiting for the GC; devices cap how many
  // live contexts a page may hold, and the game still needs its own.
  renderer.forceContextLoss();

  return icons;
}
