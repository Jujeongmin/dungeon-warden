import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
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

// Every KayKit .gltf in a pack points at the same texture and its own .bin, and
// each load fetches them again on its own — one page load asked for
// dungeon_texture.png thirteen times. three's loader cache is keyed by URL and
// makes those duplicates free.
THREE.Cache.enabled = true;

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

  // Minions — the Skeletons pack ships one .glb per class.
  // Keys are prefixed because "mage" exists on both sides: a skeleton mage
  // minion and a mage adventurer are different models.
  m_warrior: [/^skeleton_warrior$/, /skeleton.*warrior/],
  m_mage: [/^skeleton_mage$/, /skeleton.*mage/],

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
  private loader = new GLTFLoader();
  private cache = new Map<string, LoadedModel | null>();
  private pending = new Map<string, Promise<LoadedModel | null>>();
  private sharedClips: THREE.AnimationClip[] | null = null;
  private ready = false;

  get available(): boolean {
    return this.entries.length > 0;
  }

  get count(): number {
    return this.entries.length;
  }

  /** Reads the manifest. Safe to call when no assets have been added yet. */
  async init(): Promise<void> {
    if (this.ready) return;
    this.ready = true;
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
