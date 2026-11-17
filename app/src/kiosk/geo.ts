// lib/services/geocoding.dart and location_web.dart: Nominatim search and
// reverse lookups, MapTiler tiles, and a best-effort browser position.
const SEARCH = 'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5';
const REVERSE = 'https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1';

const key = import.meta.env.PUBLIC_MAPTILER_KEY ?? '';
/** Empty when no MapTiler key was built in; the map then shows no tiles. */
export const tileUrl = key ? `https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=${key}` : '';

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

function combineSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal && 'any' in AbortSignal ? AbortSignal.any([signal, timeout]) : signal ?? timeout;
}

/** Full and short display strings, both empty on failure. */
export async function reverseGeocode(lat: number, lng: number, signal?: AbortSignal): Promise<{ full: string; short: string }> {
  try {
    const res = await fetch(`${REVERSE}&lat=${lat}&lon=${lng}`, {
      headers: { 'Accept-Language': 'en' },
      signal: combineSignal(signal, 8_000),
    });
    if (!res.ok) return { full: '', short: '' };
    const data = (await res.json()) as { display_name?: string; address?: Address };
    return { full: data.display_name ?? `${lat}, ${lng}`, short: shortAddress(data.address) };
  } catch {
    return { full: '', short: '' };
  }
}

/** Raw Nominatim results, [] on failure. */
export async function searchAddress(query: string, signal?: AbortSignal): Promise<Place[]> {
  try {
    const res = await fetch(`${SEARCH}&q=${encodeURIComponent(query)}`, {
      headers: { 'Accept-Language': 'en' },
      signal: combineSignal(signal, 8_000),
    });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    return Array.isArray(data) ? (data as Place[]) : [];
  } catch {
    return [];
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
