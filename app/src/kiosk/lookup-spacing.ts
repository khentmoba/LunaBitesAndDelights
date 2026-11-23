// Nominatim asks for at most one request a second. The map page fires a reverse
// lookup on every pan stop and a search can overlap it, so without spacing the
// kiosk bursts past that limit and gets its IP throttled — every delivery
// address then degrades to raw coordinates.
//
// The slot is claimed at send time, never at wait time: a lookup the shopper
// abandoned must not push the schedule forward, or a few seconds of pin
// adjusting would leave the address several seconds behind the pin.

export const MIN_LOOKUP_GAP_MS = 1000;

let nextLookupAt = 0;

/** 0 when the caller now owns the next slot; otherwise how long until one is free. */
export function claimLookupSlot(nowMs = Date.now()): number {
  if (nowMs < nextLookupAt) return nextLookupAt - nowMs;
  nextLookupAt = nowMs + MIN_LOOKUP_GAP_MS;
  return 0;
}

/** Forgets any claimed slot. */
export function resetLookupSpacing(): void {
  nextLookupAt = 0;
}

/** Resolves true once this caller may send; false when it was abandoned first. */
export async function waitForLookupSlot(signal?: AbortSignal): Promise<boolean> {
  for (;;) {
    if (signal?.aborted) return false;
    const waitMs = claimLookupSlot();
    if (waitMs <= 0) return true;
    if (await sleepUntilAborted(waitMs, signal)) return false;
  }
}

/** Resolves true when the signal aborted, false when the delay simply elapsed. */
function sleepUntilAborted(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(false);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(true);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
