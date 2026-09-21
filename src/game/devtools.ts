/**
 * Console handle for scripted testing and debugging.
 *
 * Only installed in development builds. `window.__dw.stepBy(n)` steps a
 * running wave by hand, which is how a stage is played through in a hidden
 * tab: requestAnimationFrame is frozen while a page is hidden.
 */
export function installDevTools(handle: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  (window as unknown as Record<string, unknown>).__dw = handle;
}

/**
 * Lets the console call any server function directly, which is how the
 * server-side paths get exercised without building UI for each one.
 */
export function installServerProbe(call: (fn: string, args: unknown[]) => Promise<unknown>): void {
  if (!import.meta.env.DEV) return;
  (window as unknown as Record<string, unknown>).__call = call;
}
