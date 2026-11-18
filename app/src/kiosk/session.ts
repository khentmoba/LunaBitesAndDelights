// Kiosk session: the open menu section and the
// dining mode, per tab.
const CATEGORY = 'luna.category';
const DINING = 'luna.dining';
export const DEFAULT_CATEGORY = 'sulit_meals';

export type DiningMode = 'eatIn' | 'takeOut';

function get(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice lasts until the page changes.
  }
}

export const kioskSession = {
  category: (): string => get(CATEGORY) ?? DEFAULT_CATEGORY,
  setCategory: (id: string): void => set(CATEGORY, id),
  diningMode: (): DiningMode | null => get(DINING) as DiningMode | null,
  setDiningMode: (mode: DiningMode): void => set(DINING, mode),
  reset(): void {
    set(CATEGORY, null);
    set(DINING, null);
  },
};
