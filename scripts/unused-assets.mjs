import fs from "node:fs";
import path from "node:path";

/**
 * Lists the model files the game never asks for.
 *
 * The KayKit packs ship 250+ models and the game resolves about forty of them.
 * Everything else is downloaded by every player and never drawn, so this finds
 * the difference — but only reports it. Deleting is a separate, deliberate act,
 * because getting the keep-list wrong deletes something the game needs and the
 * mistake does not show up until a raid draws a character that has no rig.
 *
 * That is not hypothetical: the first version of this read
 * SHARED_CLIP_PATTERNS by slicing to the first "]", which is the one in
 * `RegExp[]`, so it found no animation patterns and declared both rig files
 * unused. The characters kept their models and lost every animation they had.
 *
 * Run with: node scripts/unused-assets.mjs
 */

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(
  path.join(root, "src/game/assets/ModelLibrary.ts"),
  "utf8",
);

/** Reads one balanced [...] or {...} literal starting at the first bracket. */
function literalAfter(text, from, open, close) {
  const start = text.indexOf(open, from);
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${open} from ${from}`);
}

const modelPatterns = eval(
  "(" +
    literalAfter(source, source.indexOf("export const MODEL_PATTERNS"), "{", "}") +
    ")",
);

/*
 * Read from after the `=`, not from the declaration.
 *
 * `const SHARED_CLIP_PATTERNS: RegExp[] = [...]` has a `[` in the type
 * annotation, and it comes first. Starting the scan there reads `RegExp[]` as
 * the whole literal, evaluates to an empty array, and quietly reports both
 * animation rigs as unused — which is exactly how they got deleted the first
 * time this ran.
 */
const sharedPatterns = eval(
  literalAfter(
    source,
    source.indexOf("=", source.indexOf("const SHARED_CLIP_PATTERNS")),
    "[",
    "]",
  ),
);

const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "public/assets/kaykit/manifest.json"), "utf8"),
);
const entries = manifest.models;
const firstMatch = (patterns) => {
  for (const pattern of patterns) {
    const hit = entries.find((entry) => pattern.test(entry.name));
    if (hit) return hit;
  }
  return null;
};

const wanted = new Set();
const unresolved = [];
for (const [key, patterns] of Object.entries(modelPatterns)) {
  const hit = firstMatch(patterns);
  if (hit) wanted.add(hit.url);
  else unresolved.push(key);
}
for (const pattern of sharedPatterns) {
  const hit = entries.find((entry) => pattern.test(entry.name));
  if (hit) wanted.add(hit.url);
  else unresolved.push(String(pattern));
}

// A .gltf drags in its buffer and its images; a .glb carries its own.
const keep = new Set(["assets/kaykit/manifest.json"]);
for (const url of wanted) {
  const rel = url.replace(/^\//, "");
  keep.add(rel);
  if (!rel.endsWith(".gltf")) continue;

  const gltf = JSON.parse(fs.readFileSync(path.join(root, "public", rel), "utf8"));
  const dir = path.posix.dirname(rel);
  for (const list of [gltf.buffers, gltf.images]) {
    for (const item of list ?? []) {
      if (item.uri && !item.uri.startsWith("data:")) {
        keep.add(path.posix.join(dir, decodeURIComponent(item.uri)));
      }
    }
  }
}

const all = [];
const walk = (dir) => {
  for (const item of fs.readdirSync(path.join(root, "public", dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, item.name);
    if (item.isDirectory()) walk(rel);
    else all.push(rel);
  }
};
walk("assets/kaykit");

const unused = all.filter((file) => !keep.has(file)).sort();
const bytes = (files) =>
  files.reduce((sum, f) => sum + fs.statSync(path.join(root, "public", f)).size, 0);

if (unresolved.length > 0) {
  console.log("UNRESOLVED — refusing to trust this list:");
  for (const key of unresolved) console.log("  " + key);
  process.exitCode = 1;
} else {
  console.log(`keep   ${keep.size} files, ${(bytes([...keep]) / 1048576).toFixed(2)} MB`);
  console.log(`unused ${unused.length} files, ${(bytes(unused) / 1048576).toFixed(2)} MB`);
  if (unused.length > 0) {
    console.log("\nTo remove them (recoverable from git and from art-src/):");
    console.log("  node scripts/unused-assets.mjs --list | xargs -I{} git rm -q public/{}");
    console.log("  node scripts/build-asset-manifest.mjs");
  }
}

if (process.argv.includes("--list")) {
  for (const file of unused) console.log(file);
}
