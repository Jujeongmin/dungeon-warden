import * as THREE from "three";
import { TILE, type TileId } from "./types";
import { ModelLibrary, MODEL_PATTERNS, fitToTile, type LoadedModel } from "./assets/ModelLibrary";
import type { Grid } from "./grid";

const TILE_SIZE = 1;
const ROCK_HEIGHT = 0.9;
const FLOOR_HEIGHT = 0.12;

const PITCH = THREE.MathUtils.degToRad(52);
const MIN_DISTANCE = 8;
const MAX_DISTANCE = 70;
const FOV = 45;

// Pointer travel (px) beyond which a gesture counts as a camera drag, not a tap.
const TAP_SLOP = 6;

const COLORS: Record<TileId, number> = {
  [TILE.ROCK]: 0x4a423a,
  [TILE.FLOOR]: 0x8a7f6d,
  [TILE.ENTRANCE]: 0x4c7d4a,
  [TILE.CORE]: 0xb4712c,
};

export interface RendererCallbacks {
  onTileTap: (x: number, y: number) => void;
  onHoverChange: (tile: { x: number; y: number } | null) => void;
}

/** One drawable unit. The renderer stays ignorant of raid rules. */
export interface UnitView {
  id: string;
  x: number;
  y: number;
  kind: string;
  hp: number;
  maxHp: number;
  action?: "idle" | "walk" | "attack" | "down";
  /** Radians, matching the simulation's atan2(dx, dy) convention. */
  facing?: number;
}

/**
 * Animation clips, matched by name against whatever the model ships.
 * KayKit uses names like "Idle", "Walking_A", "1H_Melee_Attack_Chop", "Death_A".
 */
const CLIP_PATTERNS: Record<string, RegExp[]> = {
  idle: [/^idle_a$/i, /^idle$/i, /idle/i],
  walk: [/^walking_a$/i, /^walk/i, /^running_a$/i, /run/i],
  // The free tier ships no attack clips; Interact is the closest arm motion.
  // Adding a paid animation pack later lets the first patterns take over.
  attack: [/melee_attack/i, /attack/i, /shoot/i, /spellcast/i, /^interact$/i, /^throw$/i],
  down: [/^death_a$/i, /death/i, /defeat/i, /^die/i],
};

/** A flat tile decoration: a trap plate or a room floor. */
export interface MarkerView {
  id: string;
  x: number;
  y: number;
  kind: string;
  shape: "trap" | "room";
}

/** Placeholder colors, keyed the same way as MODEL_PATTERNS. */
const UNIT_COLORS: Record<string, number> = {
  m_warrior: 0xd8d2c4,
  m_mage: 0x9d8bd8,
  a_knight: 0xd86a4c,
  a_barbarian: 0xc4553a,
  a_rogue: 0xa8564e,
  a_ranger: 0xb08a4a,
  a_mage: 0xb05ac4,
};

const MARKER_COLORS: Record<string, number> = {
  spike: 0xb8b0a2,
  arrow: 0x8fae7e,
  rockfall: 0x8a7a63,
  flame: 0xd98443,
  treasury: 0xd4a94a,
  vault: 0x7f8fa6,
  barracks: 0xa86f5c,
  altar: 0x8f6fb0,
  workshop: 0x6f9a9a,
};

const UNIT_HEIGHT = 0.7;
const MARKER_HEIGHT = 0.16;

/**
 * Owns the three.js scene. Tiles are drawn with two InstancedMeshes (rock and
 * floor) so a 24x24 grid still costs a handful of draw calls once the KayKit
 * models replace these placeholder boxes — they share one 1024px atlas.
 */
export class DungeonRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private rockMesh: THREE.InstancedMesh | null = null;
  private floorMesh: THREE.InstancedMesh | null = null;
  private wallMesh: THREE.InstancedMesh | null = null;
  private highlight: THREE.Mesh;

  private unitGroup = new THREE.Group();
  private unitMeshes = new Map<string, THREE.Object3D>();
  private unitGeometry = new THREE.CapsuleGeometry(0.22, UNIT_HEIGHT * 0.5, 4, 8);

  private markerGroup = new THREE.Group();
  private markerMeshes = new Map<string, THREE.Object3D>();
  private trapGeometry = new THREE.BoxGeometry(0.72, MARKER_HEIGHT, 0.72);
  private roomGeometry = new THREE.BoxGeometry(0.94, MARKER_HEIGHT * 0.6, 0.94);

  private grid: Grid | null = null;
  private callbacks: RendererCallbacks;

  private target = new THREE.Vector3(0, 0, 0);
  private distance = 20;
  private yawStep = 0; // 0..3, snapped to 90-degree turns

  /** Once the player zooms, a resize must not yank the camera back. */
  private userAdjustedZoom = false;

  /** KayKit models when the packs are present; placeholders otherwise. */
  private models = new ModelLibrary();
  private loaded = new Map<string, LoadedModel | null>();
  private lastUnits: UnitView[] = [];
  private lastMarkers: MarkerView[] = [];
  private sharedClips: THREE.AnimationClip[] = [];

  /** Per-unit animation state, only populated when a model has clips. */
  private mixers = new Map<string, { mixer: THREE.AnimationMixer; current: string | null; actions: Map<string, THREE.AnimationAction> }>();
  private clock = new THREE.Clock();

  /** Transient combat effects: hit flashes and trap rings. */
  private flashes = new Map<string, number>();
  private rings: Array<{ mesh: THREE.Mesh; life: number }> = [];
  private ringGeometry = new THREE.RingGeometry(0.2, 0.34, 20);

  private hovered: { x: number; y: number } | null = null;
  private frameId = 0;
  private resizeObserver: ResizeObserver;
  private disposed = false;

  // pointer state
  private activePointers = new Map<number, THREE.Vector2>();
  private dragStart: THREE.Vector2 | null = null;
  private dragMoved = false;
  private pinchStartDistance = 0;
  private pinchStartCameraDistance = 0;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, callbacks: RendererCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x14120f);
    this.scene.fog = new THREE.Fog(0x14120f, 30, 60);

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);

    const ambient = new THREE.AmbientLight(0xffe9c4, 0.55);
    const key = new THREE.DirectionalLight(0xfff2d0, 1.15);
    key.position.set(6, 12, 4);
    const rim = new THREE.DirectionalLight(0x6fa8ff, 0.35);
    rim.position.set(-8, 6, -6);
    this.scene.add(ambient, key, rim);

    const highlightGeo = new THREE.BoxGeometry(
      TILE_SIZE * 0.98,
      ROCK_HEIGHT * 1.04,
      TILE_SIZE * 0.98,
    );
    this.highlight = new THREE.Mesh(
      highlightGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffd27a,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    this.scene.add(this.unitGroup);
    this.scene.add(this.markerGroup);

    this.attachPointerEvents();
    window.addEventListener("keydown", this.onKeyDown);

    // Models arrive asynchronously; anything already on screen is swapped in
    // place once they land, so the game is playable while they load.
    void this.preloadModels();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();

    this.loop();
  }

  setGrid(grid: Grid): void {
    this.grid = grid;
    this.target.set((grid.w - 1) / 2, 0, (grid.h - 1) / 2);
    this.userAdjustedZoom = false;
    this.fitToGrid();
    this.rebuildInstances();
  }

  /**
   * Pulls the camera back until the whole dungeon fits. Needed because a phone
   * in portrait is far narrower than the desktop pane, and a fixed distance
   * leaves the grid running off both edges there.
   */
  private fitToGrid(): void {
    const grid = this.grid;
    if (!grid) return;

    const aspect = this.camera.aspect || 1;
    // The grid is viewed at 45 degrees of yaw, so its screen footprint is the
    // diagonal rather than the side length.
    const span = Math.max(grid.w, grid.h) * Math.SQRT2 * 0.62;
    const halfFov = THREE.MathUtils.degToRad(FOV) / 2;

    const forHeight = span / Math.tan(halfFov);
    const forWidth = span / (Math.tan(halfFov) * aspect);

    this.distance = THREE.MathUtils.clamp(
      Math.max(forHeight, forWidth) * 0.72,
      MIN_DISTANCE,
      MAX_DISTANCE,
    );
  }

  /** Cheap path used after a dig: geometry counts change, so instances rebuild. */
  refresh(): void {
    this.rebuildInstances();
  }

  /**
   * Syncs the unit meshes with the given roster. Meshes are reused by id and
   * only created or disposed when the roster actually changes, so a 20 Hz
   * simulation does not churn geometry every frame.
   */
  setUnits(units: UnitView[]): void {
    this.lastUnits = units;
    const seen = new Set<string>();

    for (const unit of units) {
      seen.add(unit.id);
      let object = this.unitMeshes.get(unit.id);
      const usesModel = this.loaded.get(unit.kind) != null;

      if (!object) {
        const model = this.spawnModel(unit.kind, 0.8);
        object =
          model ??
          new THREE.Mesh(
            this.unitGeometry,
            new THREE.MeshLambertMaterial({ color: UNIT_COLORS[unit.kind] ?? 0xffffff }),
          );
        this.unitMeshes.set(unit.id, object);
        this.unitGroup.add(object);

        if (model) {
          // Characters ship without clips in KayKit 2.0, so they borrow the
          // shared rig animations.
          const own = this.loaded.get(unit.kind)?.animations ?? [];
          this.setupAnimation(unit.id, object, own.length > 0 ? own : this.sharedClips);
        }
      }

      // A model already sits on the floor thanks to fitToTile; the capsule is
      // centred on its own middle and needs lifting.
      object.position.set(unit.x, usesModel ? object.position.y : UNIT_HEIGHT, unit.y);
      if (unit.facing !== undefined) object.rotation.y = unit.facing;
      if (unit.action) this.playClip(unit.id, unit.action);

      // Wounded units darken rather than carrying a health bar, which would
      // need screen-space UI for something the player only glances at.
      const health = unit.maxHp > 0 ? Math.max(0, unit.hp / unit.maxHp) : 0;
      const flash = this.flashes.get(unit.id) ?? 0;
      DungeonRenderer.tint(
        object,
        // A hit whites the unit out for a moment, which is the only way to
        // read damage at a glance once several units are fighting.
        flash > 0 ? 0xffd9b0 : usesModel ? 0xffffff : (UNIT_COLORS[unit.kind] ?? 0xffffff),
        flash > 0 ? 1 + flash : 0.35 + 0.65 * health,
      );
    }

    for (const [id, object] of this.unitMeshes) {
      if (seen.has(id)) continue;
      this.disposeObject(this.unitGroup, object);
      this.unitMeshes.delete(id);
      this.mixers.delete(id);
      this.flashes.delete(id);
    }
  }

  /**
   * Loads every model the renderer knows how to use, then redraws what is
   * already on screen so placeholders are replaced in place.
   */
  private async preloadModels(): Promise<void> {
    await this.models.init();
    if (this.disposed || !this.models.available) return;

    await Promise.all([
      ...Object.keys(MODEL_PATTERNS).map(async (key) => {
        this.loaded.set(key, await this.models.load(key));
      }),
      this.models.loadSharedClips().then((clips) => {
        this.sharedClips = clips;
      }),
    ]);
    if (this.disposed) return;

    // Force a rebuild: the maps are keyed by id, so clearing them makes the
    // next sync recreate every object with its model.
    this.clearUnits();
    this.clearMarkers();
    this.setUnits(this.lastUnits);
    this.setMarkers(this.lastMarkers);
  }

  /**
   * A fresh instance of a model, scaled to the tile grid.
   *
   * Materials are cloned so one wounded minion does not darken every other
   * unit sharing the same source material.
   */
  private spawnModel(key: string, targetTiles: number): THREE.Object3D | null {
    const model = this.loaded.get(key);
    if (!model) return null;

    const object = this.models.instantiate(model);
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => m.clone())
        : mesh.material.clone();
    });

    fitToTile(object, targetTiles);
    return object;
  }

  /** Multiplies every material on an object, used for the wounded look. */
  private static tint(object: THREE.Object3D, base: number, factor: number): void {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const colored = material as THREE.MeshStandardMaterial;
        if (!colored.color) continue;
        colored.color.setHex(base);
        colored.color.multiplyScalar(factor);
      }
    });
  }

  private clearUnits(): void {
    for (const [, object] of this.unitMeshes) this.disposeObject(this.unitGroup, object);
    this.unitMeshes.clear();
  }

  private clearMarkers(): void {
    for (const [, object] of this.markerMeshes) this.disposeObject(this.markerGroup, object);
    this.markerMeshes.clear();
  }

  private disposeObject(parent: THREE.Object3D, object: THREE.Object3D): void {
    parent.remove(object);
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Geometry is shared with the source model, so only per-instance
      // materials are released here.
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) material.dispose();
    });
  }

  /**
   * Crossfades a unit into an animation state.
   * Does nothing when the model has no clips, which is the case for the
   * primitive placeholders.
   */
  private playClip(unitId: string, state: string): void {
    const entry = this.mixers.get(unitId);
    if (!entry || entry.current === state) return;

    const next = entry.actions.get(state);
    if (!next) return;

    const previous = entry.current ? entry.actions.get(entry.current) : null;
    next.reset().fadeIn(0.15).play();
    if (previous && previous !== next) previous.fadeOut(0.15);
    entry.current = state;
  }

  /** Builds the clip map for a freshly spawned model. */
  private setupAnimation(unitId: string, object: THREE.Object3D, clips: THREE.AnimationClip[]): void {
    if (clips.length === 0) return;

    const mixer = new THREE.AnimationMixer(object);
    const actions = new Map<string, THREE.AnimationAction>();

    for (const [state, patterns] of Object.entries(CLIP_PATTERNS)) {
      const clip = patterns.map((p) => clips.find((c) => p.test(c.name))).find(Boolean);
      if (!clip) continue;

      const action = mixer.clipAction(clip);
      // Death should hold on its last frame rather than looping.
      if (state === "down") {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      actions.set(state, action);
    }

    if (actions.size === 0) return;
    this.mixers.set(unitId, { mixer, current: null, actions });
  }

  /** Flags a unit to flash on its next frames. */
  flashUnit(unitId: string): void {
    this.flashes.set(unitId, 1);
  }

  /** Expanding ring on a tile, used when a trap fires. */
  spawnRing(x: number, y: number, color = 0xe8a44c): void {
    const mesh = new THREE.Mesh(
      this.ringGeometry,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, FLOOR_HEIGHT + 0.05, y);
    this.scene.add(mesh);
    this.rings.push({ mesh, life: 1 });
  }

  /** Screen position of a world tile, for HTML overlays like damage numbers. */
  project(x: number, y: number, height = UNIT_HEIGHT): { x: number; y: number } | null {
    const vector = new THREE.Vector3(x, height, y).project(this.camera);
    if (vector.z > 1) return null;

    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((vector.x + 1) / 2) * rect.width,
      y: ((1 - vector.y) / 2) * rect.height,
    };
  }

  /** Flat decorations for traps and room floors, synced the same way as units. */
  setMarkers(markers: MarkerView[]): void {
    this.lastMarkers = markers;
    const seen = new Set<string>();

    for (const marker of markers) {
      seen.add(marker.id);
      let object = this.markerMeshes.get(marker.id);
      const usesModel = this.loaded.get(marker.kind) != null;

      if (!object) {
        object =
          this.spawnModel(marker.kind, marker.shape === "trap" ? 0.7 : 0.85) ??
          new THREE.Mesh(
            marker.shape === "trap" ? this.trapGeometry : this.roomGeometry,
            new THREE.MeshLambertMaterial({
              color: MARKER_COLORS[marker.kind] ?? 0xffffff,
            }),
          );
        this.markerMeshes.set(marker.id, object);
        this.markerGroup.add(object);
      }

      // Sits just above the corridor floor so it reads as part of the tile.
      const lift = usesModel ? object.position.y : MARKER_HEIGHT / 2;
      object.position.set(marker.x, FLOOR_HEIGHT + lift, marker.y);
    }

    for (const [id, object] of this.markerMeshes) {
      if (seen.has(id)) continue;
      this.disposeObject(this.markerGroup, object);
      this.markerMeshes.delete(id);
    }
  }

  private rebuildInstances(): void {
    const grid = this.grid;
    if (!grid) return;

    this.disposeInstanced();

    const rockPositions: Array<{ x: number; y: number; tile: TileId }> = [];
    const floorPositions: Array<{ x: number; y: number; tile: TileId }> = [];
    grid.forEach((x, y, tile) => {
      if (tile === TILE.ROCK) rockPositions.push({ x, y, tile });
      else floorPositions.push({ x, y, tile });
    });

    // Rock stays a solid block: a dungeon kit has no 1x1 stone cube, because
    // its walls are panels meant to stand on the edge of a carved tile.
    this.rockMesh = this.buildInstanced(rockPositions, ROCK_HEIGHT, null);
    this.floorMesh = this.buildInstanced(floorPositions, FLOOR_HEIGHT, "floor");
    if (this.rockMesh) this.scene.add(this.rockMesh);
    if (this.floorMesh) this.scene.add(this.floorMesh);

    this.buildWalls(floorPositions);
  }

  /**
   * Stands a wall panel on every corridor edge that touches rock.
   *
   * This is how the kit is meant to be used, and it is what makes a dug
   * passage read as carved out of stone rather than as a stripe painted on a
   * field of cubes.
   */
  private buildWalls(floors: Array<{ x: number; y: number }>): void {
    const grid = this.grid;
    const proto = this.tileProto("wall", ROCK_HEIGHT);
    if (!grid || !proto) return;

    const steps: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const transforms: Array<{ x: number; z: number; rot: number }> = [];

    for (const floor of floors) {
      for (const [dx, dy] of steps) {
        const nx = floor.x + dx;
        const ny = floor.y + dy;
        const solid = !grid.inBounds(nx, ny) || grid.get(nx, ny) === TILE.ROCK;
        if (!solid) continue;

        transforms.push({
          x: floor.x + dx * 0.5,
          z: floor.y + dy * 0.5,
          // The panel is widest on X, so turning it by the edge direction makes
          // that width run along the edge.
          rot: Math.atan2(dx, dy),
        });
      }
    }

    if (transforms.length === 0) return;

    const mesh = new THREE.InstancedMesh(proto.geometry, proto.material.clone(), transforms.length);
    mesh.userData.sharedGeometry = true;

    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3(proto.scale, proto.scale, proto.scale);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();

    transforms.forEach((t, i) => {
      position.set(t.x, proto.lift, t.z);
      quaternion.setFromEuler(euler.set(0, t.rot, 0));
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    this.wallMesh = mesh;
    this.scene.add(mesh);
  }

  /**
   * Geometry for one tile, taken from a KayKit model when available.
   *
   * The packs share a single atlas texture, so every tile can still be drawn
   * with one InstancedMesh — the whole floor stays a handful of draw calls
   * whether it is boxes or real models.
   */
  private tileProto(
    key: string,
    fallbackHeight: number,
  ): { geometry: THREE.BufferGeometry; material: THREE.Material; scale: number; lift: number } | null {
    const model = this.loaded.get(key);
    if (!model) return null;

    let found: THREE.Mesh | null = null;
    model.scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!found && mesh.isMesh) found = mesh;
    });
    if (!found) return null;

    const mesh = found as THREE.Mesh;
    const geometry = mesh.geometry;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return null;

    const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    const scale = width > 0 ? TILE_SIZE / width : 1;

    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    return { geometry, material, scale, lift: -box.min.y * scale };
    void fallbackHeight;
  }

  private buildInstanced(
    items: Array<{ x: number; y: number; tile: TileId }>,
    height: number,
    modelKey: string | null,
  ): THREE.InstancedMesh | null {
    if (items.length === 0) return null;

    const proto = modelKey ? this.tileProto(modelKey, height) : null;

    const geo =
      proto?.geometry ?? new THREE.BoxGeometry(TILE_SIZE * 0.96, height, TILE_SIZE * 0.96);
    // No vertexColors on the fallback: the per-instance colors below drive the
    // shader through instanceColor, and enabling vertexColors without a
    // geometry color attribute renders everything black.
    const mat = proto ? proto.material.clone() : new THREE.MeshLambertMaterial();
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    mesh.userData.sharedGeometry = Boolean(proto);

    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3(
      proto?.scale ?? 1,
      proto?.scale ?? 1,
      proto?.scale ?? 1,
    );
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const color = new THREE.Color();

    items.forEach((item, i) => {
      position.set(item.x, proto ? proto.lift : height / 2, item.y);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
      // Models carry their own texture, so tinting is only for placeholders.
      color.setHex(proto ? 0xffffff : COLORS[item.tile]);
      mesh.setColorAt(i, color);
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }

  private disposeInstanced(): void {
    for (const mesh of [this.rockMesh, this.floorMesh, this.wallMesh]) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      // Model geometry belongs to the cached glTF and is reused by the next
      // rebuild; only geometry this renderer created is disposed.
      if (!mesh.userData.sharedGeometry) mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    this.rockMesh = null;
    this.floorMesh = null;
    this.wallMesh = null;
  }

  rotate(direction: 1 | -1): void {
    this.yawStep = (this.yawStep + direction + 4) % 4;
  }

  zoom(delta: number): void {
    this.userAdjustedZoom = true;
    this.distance = THREE.MathUtils.clamp(this.distance + delta, MIN_DISTANCE, MAX_DISTANCE);
  }

  private get yaw(): number {
    return (this.yawStep * Math.PI) / 2 + Math.PI / 4;
  }

  private updateCamera(): void {
    const y = this.yaw;
    const horizontal = Math.cos(PITCH) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(y) * horizontal,
      this.target.y + Math.sin(PITCH) * this.distance,
      this.target.z + Math.cos(y) * horizontal,
    );
    this.camera.lookAt(this.target);
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    const width = parent?.clientWidth ?? window.innerWidth;
    const height = parent?.clientHeight ?? window.innerHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (!this.userAdjustedZoom) this.fitToGrid();
  }

  private pointerToTile(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);

    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;

    const x = Math.round(hit.x);
    const y = Math.round(hit.z);
    if (!this.grid?.inBounds(x, y)) return null;
    return { x, y };
  }

  private setHovered(tile: { x: number; y: number } | null): void {
    const same =
      (tile === null && this.hovered === null) ||
      (tile !== null && this.hovered !== null && tile.x === this.hovered.x && tile.y === this.hovered.y);
    if (same) return;

    this.hovered = tile;
    if (tile) {
      this.highlight.position.set(tile.x, ROCK_HEIGHT / 2, tile.y);
      this.highlight.visible = true;
    } else {
      this.highlight.visible = false;
    }
    this.callbacks.onHoverChange(tile);
  }

  private attachPointerEvents(): void {
    const c = this.canvas;
    c.addEventListener("pointerdown", this.onPointerDown);
    c.addEventListener("pointermove", this.onPointerMove);
    c.addEventListener("pointerup", this.onPointerUp);
    c.addEventListener("pointercancel", this.onPointerUp);
    c.addEventListener("pointerleave", this.onPointerLeave);
    c.addEventListener("wheel", this.onWheel, { passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    this.activePointers.set(e.pointerId, new THREE.Vector2(e.clientX, e.clientY));

    if (this.activePointers.size === 1) {
      this.dragStart = new THREE.Vector2(e.clientX, e.clientY);
      this.dragMoved = false;
    } else if (this.activePointers.size === 2) {
      const [a, b] = [...this.activePointers.values()];
      this.pinchStartDistance = a.distanceTo(b);
      this.pinchStartCameraDistance = this.distance;
      this.dragMoved = true; // a pinch is never a tap
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const previous = this.activePointers.get(e.pointerId);

    if (!previous) {
      // Mouse hover with no button held.
      this.setHovered(this.pointerToTile(e.clientX, e.clientY));
      return;
    }

    const current = new THREE.Vector2(e.clientX, e.clientY);

    if (this.activePointers.size >= 2) {
      this.activePointers.set(e.pointerId, current);
      const [a, b] = [...this.activePointers.values()];
      const spread = a.distanceTo(b);
      if (this.pinchStartDistance > 0) {
        this.userAdjustedZoom = true;
        const ratio = this.pinchStartDistance / Math.max(spread, 1);
        this.distance = THREE.MathUtils.clamp(
          this.pinchStartCameraDistance * ratio,
          MIN_DISTANCE,
          MAX_DISTANCE,
        );
      }
      return;
    }

    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    this.activePointers.set(e.pointerId, current);

    if (this.dragStart && current.distanceTo(this.dragStart) > TAP_SLOP) {
      this.dragMoved = true;
    }
    if (!this.dragMoved) return;

    // Pan along the camera's own axes so dragging feels the same at every yaw.
    const speed = this.distance * 0.0016;
    const y = this.yaw;
    const right = new THREE.Vector3(Math.cos(y), 0, -Math.sin(y));
    const forward = new THREE.Vector3(Math.sin(y), 0, Math.cos(y));
    this.target.addScaledVector(right, -dx * speed);
    this.target.addScaledVector(forward, -dy * speed);
    this.setHovered(null);
  };

  private onPointerUp = (e: PointerEvent): void => {
    const wasSingle = this.activePointers.size === 1;
    this.activePointers.delete(e.pointerId);
    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }

    if (wasSingle && !this.dragMoved && e.button !== 2) {
      const tile = this.pointerToTile(e.clientX, e.clientY);
      if (tile) this.callbacks.onTileTap(tile.x, tile.y);
    }

    if (this.activePointers.size === 0) {
      this.dragStart = null;
      this.dragMoved = false;
      this.pinchStartDistance = 0;
    }
  };

  private onPointerLeave = (): void => {
    this.setHovered(null);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.zoom(e.deltaY * 0.012);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "q" || e.key === "Q") this.rotate(-1);
    if (e.key === "e" || e.key === "E") this.rotate(1);
  };

  private loop = (): void => {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(this.loop);

    const delta = this.clock.getDelta();
    for (const entry of this.mixers.values()) entry.mixer.update(delta);
    this.updateEffects(delta);

    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  };

  /** Advances hit flashes and trap rings. */
  private updateEffects(delta: number): void {
    for (const [id, value] of this.flashes) {
      const next = value - delta * 4;
      if (next <= 0) this.flashes.delete(id);
      else this.flashes.set(id, next);
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.life -= delta * 1.6;

      if (ring.life <= 0) {
        this.scene.remove(ring.mesh);
        (ring.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        continue;
      }

      const grown = 1 + (1 - ring.life) * 2.2;
      ring.mesh.scale.setScalar(grown);
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = ring.life * 0.9;
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    window.removeEventListener("keydown", this.onKeyDown);

    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onPointerDown);
    c.removeEventListener("pointermove", this.onPointerMove);
    c.removeEventListener("pointerup", this.onPointerUp);
    c.removeEventListener("pointercancel", this.onPointerUp);
    c.removeEventListener("pointerleave", this.onPointerLeave);
    c.removeEventListener("wheel", this.onWheel);

    this.disposeInstanced();
    this.clearUnits();
    this.clearMarkers();

    for (const ring of this.rings) {
      this.scene.remove(ring.mesh);
      (ring.mesh.material as THREE.Material).dispose();
    }
    this.rings = [];
    this.ringGeometry.dispose();
    this.unitGeometry.dispose();
    this.trapGeometry.dispose();
    this.roomGeometry.dispose();
    this.highlight.geometry.dispose();
    (this.highlight.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
