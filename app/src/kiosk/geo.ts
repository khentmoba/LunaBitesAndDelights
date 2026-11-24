// Location lookups: Nominatim search and
// reverse lookups, a Google Maps browser key, and a best-effort browser position.
import { waitForLookupSlot } from './lookup-spacing.ts';
const SEARCH = 'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5';
const REVERSE = 'https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1';

/** Empty when no Google Maps key was built in; the map then shows no tiles. */
export const mapsKey = import.meta.env?.PUBLIC_GOOGLE_MAPS_KEY ?? '';

/** What the map page says when the browser cannot or will not report a position. */
export const LOCATION_UNAVAILABLE_MESSAGE = 'Location unavailable. Drag the map to set your pin.';

type Address = Record<string, string | undefined>;

export interface Place {
  lat: string;
  lon: string;
  display_name?: string;
  address?: Address;
}

/** 'road, suburb, city' from a Nominatim address object. */
export function shortAddress(address: Address | undefined): string {
  if (!address) return '';
  const parts: string[] = [];
  if (address.road) parts.push(address.road);
  if (address.suburb) parts.push(address.suburb);
  const city = address.city ?? address.town ?? address.village;
  if (city) parts.push(city);
  if (address.state && parts.length < 2) parts.push(address.state);
  return parts.join(', ');
}

export function combineSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const noop = () => {};
  if (typeof AbortSignal.timeout === 'function') {
    const timeout = AbortSignal.timeout(timeoutMs);
    if (!signal) return { signal: timeout, cleanup: noop };
    if (typeof AbortSignal.any === 'function') {
      return { signal: AbortSignal.any([signal, timeout]), cleanup: noop };
    }
  }
  // Older browsers: keep both the caller's abort and our deadline, and clear
  // the timer + listener as soon as the fetch settles so successful lookups
  // never leave dangling 8-second timers behind.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const cleanup = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  };
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  controller.signal.addEventListener('abort', cleanup, { once: true });
  return { signal: controller.signal, cleanup };
}

const MAX_GEO_CACHE = 100;
const reverseCache = new Map<string, { full: string; short: string }>();
const searchCache = new Map<string, Place[]>();

function cacheSet<V>(map: Map<string, V>, k: string, v: V): void {
  if (map.size >= MAX_GEO_CACHE) {
    const first = map.keys().next().value;
    if (first !== undefined) map.delete(first);
  }
  map.set(k, v);
}

/** Full and short display strings, both empty on failure. */
export async function reverseGeocode(lat: number, lng: number, signal?: AbortSignal): Promise<{ full: string; short: string }> {
  const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = reverseCache.get(cacheKey);
  if (cached) return cached;
  if (signal?.aborted) return { full: '', short: '' };
  let cleanup = () => {};
  try {
    if (!(await waitForLookupSlot(signal))) return { full: '', short: '' };
    const combined = combineSignal(signal, 8_000);
    cleanup = combined.cleanup;
    const res = await fetch(`${REVERSE}&lat=${lat}&lon=${lng}`, {
      headers: { 'Accept-Language': 'en' },
      signal: combined.signal,
    });
    if (!res.ok) return { full: '', short: '' };
    const data = (await res.json()) as { display_name?: string; address?: Address };
    const result = { full: (data.display_name ?? `${lat}, ${lng}`).slice(0, 300), short: shortAddress(data.address).slice(0, 300) };
    if (result.full) cacheSet(reverseCache, cacheKey, result);
    return result;
  } catch {
    return { full: '', short: '' };
  } finally {
    cleanup();
  }
}

/** Raw Nominatim results, [] on failure. */
export async function searchAddress(query: string, signal?: AbortSignal): Promise<Place[]> {
  const cacheKey = query.trim().toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;
  if (signal?.aborted) return [];
  let cleanup = () => {};
  try {
    if (!(await waitForLookupSlot(signal))) return [];
    const combined = combineSignal(signal, 8_000);
    cleanup = combined.cleanup;
    const res = await fetch(`${SEARCH}&q=${encodeURIComponent(query)}`, {
      headers: { 'Accept-Language': 'en' },
      signal: combined.signal,
    });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    const places = Array.isArray(data) ? (data as Place[]) : [];
    cacheSet(searchCache, cacheKey, places);
    return places;
  } catch {
    return [];
  } finally {
    cleanup();
  }
}

/** The browser's position, or null when it is unavailable, denied or slow. */
export function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => resolve(null), 12_000);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  });
}

export interface PendingLookupState {
  searchTimer: number;
  addressTimer: number;
  searchAbort: AbortController | null;
  reverseAbort: AbortController | null;
}

/** Cancels pending map geocode timers and aborts in-flight lookup requests. */
export function disposePendingLookups(
  state: PendingLookupState,
  clearFn: (id: number) => void = clearTimeout,
): void {
  if (state.searchTimer) {
    clearFn(state.searchTimer);
    state.searchTimer = 0;
  }
  if (state.addressTimer) {
    clearFn(state.addressTimer);
    state.addressTimer = 0;
  }
  state.searchAbort?.abort();
  state.searchAbort = null;
  state.reverseAbort?.abort();
  state.reverseAbort = null;
}
