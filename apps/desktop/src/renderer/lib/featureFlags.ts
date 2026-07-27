/**
 * UI version flag. The Apple-glass-glow redesign is now the **default**
 * shell. The legacy Discord-style dashboard is still in the tree as an
 * escape hatch — boot it with `VITE_OLD_UI=1 pnpm dev` (or via
 * `pnpm dev:classic`). The old code path will be removed once we're
 * confident no regressions remain.
 *
 * Historical note: the original gating was inverted (`VITE_NEW_UI=1`
 * opted INTO glass). Flipping the default was a deliberate launch
 * decision so a default `pnpm dev` / `pnpm build` always ships glass.
 * If you find yourself reading this because the old UI booted by
 * surprise, you're probably running an old build — rebuild and retry.
 */
export const NEW_UI_ENABLED: boolean =
  (import.meta as any).env?.VITE_OLD_UI !== '1' &&
  (import.meta as any).env?.VITE_OLD_UI !== 'true'
