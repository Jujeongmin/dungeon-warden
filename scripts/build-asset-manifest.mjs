// Scans every model dropped under public/assets and writes a manifest the
// runtime uses to find them by name.
//
// The packs are downloaded by hand from itch.io, so the exact file names are
// not known ahead of time. Indexing whatever is actually there — instead of
// hard-coding paths — means a pack update or a renamed folder does not break
// the game.
//
// Usage: npm run assets

import { readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative, posix, sep, dirname } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = join(ROOT, "public");
// Every pack under public/assets. The manifest itself stays where it has
// always been, so the URL the runtime fetches does not move.
const MODEL_DIR = join(PUBLIC_DIR, "assets");
const MANIFEST = join(PUBLIC_DIR, "assets", "kaykit", "manifest.json");
const AUDIO_DIR = join(PUBLIC_DIR, "assets", "audio");

async function walk(dir, pattern) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full, pattern)));
    else if (pattern.test(entry.name)) files.push(full);
  }
  return files;
}

async function index(dir, pattern, extension) {
  await mkdir(dir, { recursive: true });
  const files = await walk(dir, pattern);

  const items = [];
  for (const file of files) {
    const rel = relative(PUBLIC_DIR, file).split(sep).join(posix.sep);
    const info = await stat(file);
    items.push({
      // Served path, which is what the loader fetches.
      url: "/" + rel,
      // Lowercased basename without extension, used for pattern matching.
      name: file.split(sep).pop().replace(extension, "").toLowerCase(),
      // Folder chain under the asset root, so a pack can be told from another.
      group: relative(dir, dirname(file)).split(sep).join("/").toLowerCase(),
      bytes: info.size,
    });
  }

  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

async function main() {
  const models = await index(MODEL_DIR, /\.(gltf|glb)$/i, /\.(gltf|glb)$/i);
  await writeFile(MANIFEST, JSON.stringify({ models }, null, 2));
  console.log(`Indexed ${models.length} model(s) -> public/assets/kaykit/manifest.json`);
  if (models.length === 0) {
    console.log("  Nothing found. Unzip the KayKit packs into public/assets/kaykit/.");
  }

  const sounds = await index(AUDIO_DIR, /\.(ogg|mp3|wav)$/i, /\.(ogg|mp3|wav)$/i);
  await writeFile(join(AUDIO_DIR, "manifest.json"), JSON.stringify({ sounds }, null, 2));
  console.log(`Indexed ${sounds.length} sound(s) -> public/assets/audio/manifest.json`);
  if (sounds.length === 0) {
    console.log("  Nothing found. Synthesised cues will be used instead.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
