import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// Every shipped model is packed with EXT_meshopt_compression - see
// scripts/optimize-models.mjs. The decoder is a small WASM blob inlined in
// the module, so it adds no request of its own.
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { publicUrl } from "./publicUrl";

interface ManifestEntry {
  url: string;
  name: string;
  group: string;
  bytes: number;
}

export interface LoadedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

const MANIFEST_URL = publicUrl("assets/kaykit/manifest.json");

/*
 * three's loader cache stays OFF.
 *
 * Every KayKit .gltf in a pack points at the same texture, so turning
 * `THREE.Cache` on to collapse those duplicate fetches looks like free money.
 * It is not: with the cache enabled, every one of the nine textures in the
 * scene came back with `image` undefined — the PNGs downloaded (200 OK) but
 * never reached the materials. The dungeon drew untextured, and three warned
 * "Texture marked for update but no image data found" once per texture per
 * frame, which is where the ~90,000 console messages in a two-minute session
 * were coming from.
 *
 * Measured both ways on the same page: cache on, 9 of 9 textures had no image;
 * cache off, 9 of 9 carried a 1024px bitmap. The duplicate downloads are the
 * cheaper problem, and `shareTextures` below takes most of that back anyway.
 */
THREE.Cache.enabled = false;

/** Texture slots the KayKit materials actually use, in load order. */
const TEXTURE_SLOTS = ["map", "normalMap", "emissiveMap", "roughnessMap", "metalnessMap"] as const;

/**
 * Animation-only files.
 *
 * KayKit 2.0 ships characters with no embedded clips and puts the motion in
 * shared rig files instead, so every character on the same rig reuses one set.
 * These are loaded once and handed to any character model that arrived empty.
 */
const SHARED_CLIP_PATTERNS: RegExp[] = [
  /^rig_medium_general$/,
  /^rig_medium_movementbasic$/,
];

/**
 * Which model to use for each thing the game draws.
 *
 * These are regular expressions rather than file names because the KayKit packs
 * are unzipped by hand and their exact naming varies between releases. The
 * first pattern that matches a file in the manifest wins, so the lists go from
 * most to least specific.
 */
export const MODEL_PATTERNS: Record<string, RegExp[]> = {
  // Dungeon structure
  floor: [/^floor_tile_large$/, /^floor_tile_small$/, /^floor_tile/, /^floor_dirt/],
  wall: [/^wall$/, /^wall_arched$/, /^wall_/],
  entrance: [/^stairs_/, /^stairs$/, /^door_/, /^doorway/],
  core: [/^chest_gold$/, /^chest$/, /^banner_red$/],

  /*
   * The player, seen from behind their own eyes.
   *
   * A warden is a monster, not a person, so this is a monster: the imp from
   * the Bestiary kit, baked down by scripts/bake-warden.mjs. Its motion is a
   * second file because the kit ships none - see warden_clips, and
   * public/assets/warden/SOURCE.md for where both came from.
   *
   * The skeleton stays as a fallback: before the bake has been run there is
   * no imp, and a warden with no body at all would leave the camera that
   * follows it with nothing to follow.
   */
  warden: [/^warden$/, /^skeleton_rogue$/, /^skeleton_warrior$/],
  /** Motion for the warden, on the same rig. Carries no mesh of its own. */
  warden_clips: [/^warden-clips$/],
  /** A second body for the warden, unlocked as a skin: see src/game/skins.ts. */
  warden_puglin: [/^warden-puglin$/],

  // Minions — the Skeletons pack ships one .glb per class.
  // Keys are prefixed because "mage" exists on both sides: a skeleton mage
  // minion and a mage adventurer are different models.
  m_warrior: [/^skeleton_rogue$/, /^skeleton_warrior$/, /skeleton.*warrior/],
  m_mage: [/^skeleton_mage$/, /skeleton.*mage/],
  // The big one with the shield holds the road; the small one is the cheap
  // body there are many of. Same pack, same rig, same shared clips.
  m_guard: [/^skeleton_warrior$/],
  m_grunt: [/^skeleton_minion$/],

  // Adventurers, also used for converts. Each class has its own model.
  a_knight: [/^knight$/],
  a_barbarian: [/^barbarian$/],
  a_rogue: [/^rogue$/, /^rogue_hooded$/],
  a_ranger: [/^ranger$/],
  a_mage: [/^mage$/],

  // Traps
  spike: [/^floor_tile_big_spikes$/, /spikes/],
  arrow: [/^wall_arrowslit/, /crossbow/, /^bow$/],
  rockfall: [/^rocks/, /rubble/, /^floor_tile_large_rocks$/],
  flame: [/^torch/, /^brazier/, /candle/],

  // Room props
  treasury: [/^chest_gold$/, /^coin/, /^chest$/],
  vault: [/^barrel_large$/, /^barrel/, /^crate/],
  barracks: [/^weaponrack/, /^banner_blue$/, /^banner/],
  altar: [/^altar/, /^candle/, /^pillar/],
  workshop: [/^table_medium$/, /^table_small$/, /^table/, /anvil/],
  jail: [/^wall_gated/, /gated/, /^cage/, /^chain/],

  // Dressing.
  //
  // The pack ships 211 dungeon props and the game was using eleven of them, so
  // a finished dungeon read as corridors of bare stone with two landmarks in
  // it. These fill the walls and the empty floor, and give each room type a
  // few different things to put on its four tiles instead of the same model
  // four times over.
  prop_torch: [/^torch$/, /^torch_/, /^candle_triple$/],
  prop_barrel: [/^barrel_large$/, /^barrel_small$/, /^barrel/],
  prop_box: [/^box_stacked$/, /^box_small$/, /^box_large$/],
  prop_pillar: [/^pillar_decorated$/, /^pillar$/, /^column$/],
  prop_coin_large: [/^coin_stack_large$/, /^coin_stack/],
  prop_coin_small: [/^coin_stack_small$/, /^coin$/],
  prop_bed: [/^bed_frame$/, /^bed_decorated$/, /^bed/],
  prop_shelf: [/^shelf_large$/, /^shelf_small$/, /^shelf/],
  prop_candle: [/^candle_lit$/, /^candle_thin_lit$/, /^candle/],
  prop_table: [/^table_long$/, /^table_medium$/, /^table/],
  prop_banner: [/^banner_shield_red$/, /^banner_triple_red$/, /^banner_red$/],
};

/**
 * Loads KayKit models on demand and hands out clones.
 *
 * Everything here is optional: when a pack has not been unzipped yet the
 * manifest is empty, `get` returns null, and the renderer keeps its primitive
 * placeholders. The game is playable either way.
 */
export class ModelLibrary {
  private entries: ManifestEntry[] = [];
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private cache = new Map<string, LoadedModel | null>();
  private pending = new Map<string, Promise<LoadedModel | null>>();
  private sharedClips: THREE.AnimationClip[] | null = null;
  /** One Texture per image file, shared by every model that references it. */
  private textures = new Map<string, THREE.Texture>();
  private ready = false;
  private initTask: Promise<void> | null = null;

  get available(): boolean {
    return this.entries.length > 0;
  }

  get count(): number {
    return this.entries.length;
  }

  /**
   * Reads the manifest. Safe to call when no assets have been added yet, and
   * safe to call from two places at once.
   *
   * The second part is not free: this used to set a `ready` flag before
   * awaiting the fetch, so a concurrent caller was told the library was ready
   * while the manifest was still in flight and got an empty entry list. The
   * in-flight promise is shared instead, so every caller waits for the same
   * fetch and sees the same result.
   */
  init(): Promise<void> {
    if (this.ready) return Promise.resolve();
    this.initTask ??= this.readManifest().finally(() => {
      this.ready = true;
      this.initTask = null;
    });
    return this.initTask;
  }

  private async readManifest(): Promise<void> {
    try {
      const response = await fetch(MANIFEST_URL);
      if (!response.ok) return;
      const data = (await response.json()) as { models?: ManifestEntry[] };
      // The manifest is written with root-absolute URLs; rebase them once here
      // so every loader downstream gets a path that works under the verse.
      this.entries = (data.models ?? []).map((entry) => ({
        ...entry,
        url: publicUrl(entry.url),
      }));
    } catch {
      // No manifest yet — placeholders it is.
      this.entries = [];
    }
  }

  private resolve(key: string): ManifestEntry | null {
    const patterns = MODEL_PATTERNS[key];
    if (!patterns) return null;
    for (const pattern of patterns) {
      const hit = this.entries.find((entry) => pattern.test(entry.name));
      if (hit) return hit;
    }
    return null;
  }

  /** Loads (once) and returns the model for a key, or null when unavailable. */
  async load(key: string): Promise<LoadedModel | null> {
    if (this.cache.has(key)) return this.cache.get(key)!;

    const existing = this.pending.get(key);
    if (existing) return existing;

    const entry = this.resolve(key);
    if (!entry) {
      this.cache.set(key, null);
      return null;
    }

    const task = this.loader
      .loadAsync(entry.url)
      .then((gltf) => {
        this.shareTextures(gltf.scene, entry.url);
        const model: LoadedModel = { scene: gltf.scene, animations: gltf.animations };
        this.cache.set(key, model);
        return model;
      })
      .catch(() => {
        // A corrupt or half-extracted pack must not take the game down.
        this.cache.set(key, null);
        return null;
      })
      .finally(() => this.pending.delete(key));

    this.pending.set(key, task);
    return task;
  }

  /**
   * Points every material at one Texture per image file.
   *
   * A pack's models each parse their own copy of the shared palette PNG, so
   * twenty-five dungeon props meant twenty-five 1024x1024 bitmaps uploaded to
   * the GPU — the same pixels, over and over, for tens of megabytes of video
   * memory on a phone. Keying by the image's own URL collapses them to one.
   *
   * The losing duplicate is disposed here rather than left to the collector,
   * because it may already have been uploaded by the time this runs.
   */
  private shareTextures(scene: THREE.Group, modelUrl: string): void {
    // The identity of an image, without an image URL to hand: GLTFLoader
    // decodes through createImageBitmap where it can, and an ImageBitmap
    // remembers nothing about where it came from. The glTF's own texture name
    // plus the folder the model was loaded from names the same file just as
    // exactly — every model in a KayKit pack sits beside the one palette PNG
    // it references — and cannot collide across packs.
    const folder = modelUrl.slice(0, modelUrl.lastIndexOf("/") + 1);

    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        for (const slot of TEXTURE_SLOTS) {
          const standard = material as unknown as Record<string, THREE.Texture | null>;
          const texture = standard[slot];
          if (!texture?.name) continue;

          const id = `${folder}${texture.name}#${slot}`;
          const shared = this.textures.get(id);
          if (!shared) {
            this.textures.set(id, texture);
          } else if (shared !== texture) {
            standard[slot] = shared;
            material.needsUpdate = true;
            texture.dispose();
          }
        }
      }
    });
  }

  /**
   * A fresh instance of a model. Skinned meshes go through SkeletonUtils so
   * each clone keeps its own bones and can be animated independently.
   */
  instantiate(model: LoadedModel): THREE.Object3D {
    let skinned = false;
    model.scene.traverse((child) => {
      if ((child as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
    });
    return skinned ? cloneSkinned(model.scene) : model.scene.clone(true);
  }

  /**
   * Clips from the shared rig files, loaded once.
   * Empty when the animation files were not copied in.
   */
  async loadSharedClips(): Promise<THREE.AnimationClip[]> {
    if (this.sharedClips) return this.sharedClips;

    const urls = SHARED_CLIP_PATTERNS.map(
      (pattern) => this.entries.find((entry) => pattern.test(entry.name))?.url,
    ).filter((url): url is string => Boolean(url));

    const clips: THREE.AnimationClip[] = [];
    for (const url of urls) {
      try {
        const gltf = await this.loader.loadAsync(url);
        clips.push(...gltf.animations);
      } catch {
        // A missing animation file just means characters stand still.
      }
    }

    this.sharedClips = clips;
    return clips;
  }

  /** Which keys actually resolved, for diagnostics in the UI. */
  report(): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const key of Object.keys(MODEL_PATTERNS)) {
      out[key] = this.resolve(key)?.name ?? null;
    }
    return out;
  }
}

/** Scales a model so its widest horizontal side fits `target` tiles. */
export function fitToTile(object: THREE.Object3D, target: number): void {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);

  const widest = Math.max(size.x, size.z);
  if (widest > 0) {
    const scale = target / widest;
    object.scale.setScalar(scale);
  }

  // Re-measure after scaling so the model sits on the floor rather than
  // straddling it, whatever origin the artist used.
  const scaledBox = new THREE.Box3().setFromObject(object);
  object.position.y -= scaledBox.min.y;
}
