/**
 * Resolves a path under `public/` against the deployment base.
 *
 * Verse8 serves a game from a sub-path, not from the domain root, which is why
 * `vite.config.ts` sets `base: "./"`. Vite rewrites imported and bundled URLs
 * itself, but anything fetched by hand at runtime — the asset manifests and the
 * model and sound files they list — would still ask the domain root for files
 * that live under the verse, and come back 404. Those go through here instead.
 */
export function publicUrl(path: string): string {
  const base = import.meta.env.BASE_URL || "./";
  return base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}
