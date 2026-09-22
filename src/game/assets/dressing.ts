import * as THREE from "three";

/**
 * What turns a shared body into a tower of its own, and a level into a look.
 *
 * The skeleton pack has four bodies and seven towers, so three of them wear
 * a body another tower wears too. Each tower holds its own weapon, and three
 * carry a tint over their bones, so the crossbowman is not an archer and the
 * berserker is not a guard.
 *
 * The level shows in the kit: a weapon at level 1, something in the other
 * hand at level 2, a heavier piece and gilded bones at level 3. Drawn the
 * same on the board and, at level 1, in the toolbar icon.
 */

interface Gear {
  /** Right hand, every level. */
  weapon: string;
  /** Left hand, from level 2. */
  offhand: string;
  /** Left hand at level 3, where it is a heavier piece than level 2's. */
  offhand3?: string;
}

const GEAR: Record<string, Gear> = {
  m_warrior: { weapon: "w_bow", offhand: "w_arrows" },
  m_mage: { weapon: "w_staff", offhand: "w_book" },
  m_guard: { weapon: "w_blade", offhand: "w_shield_small", offhand3: "w_shield_large" },
  m_grunt: { weapon: "w_blade", offhand: "w_shield_small", offhand3: "w_shield_large" },
  m_crossbow: { weapon: "w_crossbow", offhand: "w_bolts" },
  m_berserker: { weapon: "w_axe", offhand: "w_axe" },
  m_shaman: { weapon: "w_wand", offhand: "w_book" },
};

/** What a tower of this kind holds at this level, by hand. */
export function gearFor(kind: string, tier: number): Array<{ key: string; hand: "r" | "l" }> {
  const gear = GEAR[kind];
  if (!gear) return [];
  const held: Array<{ key: string; hand: "r" | "l" }> = [{ key: gear.weapon, hand: "r" }];
  if (tier >= 2) held.push({ key: tier >= 3 ? (gear.offhand3 ?? gear.offhand) : gear.offhand, hand: "l" });
  return held;
}

/** Level 3's bones: gilded, laid over whatever tint the kind has. */
const GILDED = 0xffd98a;

/** The colour a tower's model is multiplied by, for its kind and level. */
export function tintFor(kind: string, tier: number): number {
  const base = new THREE.Color(UNIT_TINT[kind] ?? 0xffffff);
  if (tier >= 3) base.multiply(new THREE.Color(GILDED));
  return base.getHex();
}

/** A colour laid over the model's own, for towers that share a body. */
export const UNIT_TINT: Record<string, number> = {
  m_crossbow: 0xc6d4ff,
  m_berserker: 0xffab98,
  m_shaman: 0xb4f0a8,
};

/** Puts a piece of gear in one of a model's hands; does nothing if the rig has no hand slot. */
export function attachGear(body: THREE.Object3D, item: THREE.Object3D, hand: "r" | "l"): void {
  let slot: THREE.Object3D | null = null;
  // GLTFLoader strips the dot from "handslot.r".
  const name = hand === "r" ? /^handslot\.?r$/i : /^handslot\.?l$/i;
  body.traverse((child) => {
    if (!slot && name.test(child.name)) slot = child;
  });
  if (!slot) return;
  item.userData.gear = true;
  (slot as THREE.Object3D).add(item);
}

/** Takes off everything attachGear put on. */
export function removeGear(body: THREE.Object3D): void {
  const worn: THREE.Object3D[] = [];
  body.traverse((child) => {
    if (child.userData.gear) worn.push(child);
  });
  for (const item of worn) item.removeFromParent();
}

/** Multiplies every material colour on an object by a tint. Materials must be the object's own. */
export function tintObject(object: THREE.Object3D, tint: number): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) (material as THREE.MeshStandardMaterial).color?.multiply(new THREE.Color(tint));
  });
}

/**
 * Traps with nothing in the pack to show them, drawn instead: a web of
 * threads, and a ring of glowing runes. Flat pictures laid on the floor.
 */
export const DRAWN_TRAPS = ["web", "rune"] as const;

const drawnCache = new Map<string, HTMLCanvasElement>();

export function drawnTrapCanvas(kind: string): HTMLCanvasElement | null {
  if (!(DRAWN_TRAPS as readonly string[]).includes(kind)) return null;
  const cached = drawnCache.get(kind);
  if (cached) return cached;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const c = size / 2;
  g.lineCap = "round";
  if (kind === "web") {
    g.strokeStyle = "rgba(235, 238, 245, 0.95)";
    g.lineWidth = 3;
    const spokes = 8;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      g.beginPath();
      g.moveTo(c, c);
      g.lineTo(c + Math.cos(a) * 60, c + Math.sin(a) * 60);
      g.stroke();
    }
    g.lineWidth = 2.2;
    for (const r of [14, 27, 40, 53]) {
      g.beginPath();
      for (let i = 0; i <= spokes; i++) {
        const a = (i / spokes) * Math.PI * 2;
        // Each thread sags a little between the spokes.
        const mid = a - Math.PI / spokes;
        if (i === 0) g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
        else g.quadraticCurveTo(c + Math.cos(mid) * r * 0.86, c + Math.sin(mid) * r * 0.86, c + Math.cos(a) * r, c + Math.sin(a) * r);
      }
      g.stroke();
    }
  } else {
    g.shadowColor = "rgba(170, 120, 255, 1)";
    g.shadowBlur = 10;
    g.strokeStyle = "rgba(196, 160, 255, 1)";
    g.lineWidth = 4;
    g.beginPath();
    g.arc(c, c, 52, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(c, c, 38, 0, Math.PI * 2);
    g.stroke();
    // Six glyphs between the rings, and an arrow in the middle pointing back.
    g.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = c + Math.cos(a) * 45;
      const y = c + Math.sin(a) * 45;
      g.beginPath();
      g.moveTo(x - 4, y - 4);
      g.lineTo(x + 4, y + 4);
      g.moveTo(x + 4, y - 4);
      g.lineTo(x, y);
      g.stroke();
    }
    g.lineWidth = 5;
    g.beginPath();
    g.arc(c, c, 18, Math.PI * 0.2, Math.PI * 1.75);
    g.stroke();
    g.beginPath();
    g.moveTo(c + 18 * Math.cos(Math.PI * 0.2) - 9, c + 18 * Math.sin(Math.PI * 0.2) - 1);
    g.lineTo(c + 18 * Math.cos(Math.PI * 0.2), c + 18 * Math.sin(Math.PI * 0.2));
    g.lineTo(c + 18 * Math.cos(Math.PI * 0.2) + 2, c + 18 * Math.sin(Math.PI * 0.2) - 10);
    g.stroke();
  }
  drawnCache.set(kind, canvas);
  return canvas;
}
