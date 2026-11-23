// Nominatim asks for at most one request a second. The map page fires a reverse
// lookup on every `idle` (one per pan stop) and a search can overlap it, so
// without spacing the kiosk bursts past that limit and gets its IP throttled —
// every delivery address then degrades to raw coordinates.

export const MIN_LOOKUP_GAP_MS = 1000;

let nextLookupAt = 0;

/** How long to wait before the next upstream lookup may start; books its slot. */
export function reserveLookupSlot(nowMs = Date.now()): number {
  const waitMs = Math.max(0, nextLookupAt - nowMs);
  nextLookupAt = Math.max(nowMs, nextLookupAt) + MIN_LOOKUP_GAP_MS;
  return waitMs;
}

/** Forgets any booked slot. */
export function resetLookupSpacing(): void {
  nextLookupAt = 0;
}

/** Resolves once the next lookup is allowed to start. */
export function waitForLookupSlot(): Promise<void> {
  const waitMs = reserveLookupSlot();
  return waitMs > 0 ? new Promise((resolve) => setTimeout(resolve, waitMs)) : Promise.resolve();
}
