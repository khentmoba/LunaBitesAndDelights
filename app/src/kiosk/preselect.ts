// Storefront picks (`?pick=s1#Solo&pick=f4&pick=@drinks`) into cart lines and
// items that still need a choice. Same rules as lib/services/menu_preselect.dart.
import { menuSections, type MenuItem } from '../data/menu.ts';
import type { CartItem } from './cart';

export interface Preselection {
  ready: CartItem[];
  needsChoice: MenuItem[];
  sectionId: string | null;
  sectionPick: boolean;
}

export function resolvePicks(picks: Iterable<string>, now = Date.now()): Preselection {
  const ready: CartItem[] = [];
  const needsChoice: MenuItem[] = [];
  let sectionId: string | null = null;
  let pickedSection: string | null = null;
  let n = 0;
  let taken = 0;

  for (const pick of picks) {
    if (taken++ >= 80) break;
    if (pick.startsWith('@')) {
      const id = pick.slice(1);
      if (menuSections.some((s) => s.id === id)) pickedSection ??= id;
      continue;
    }
    const hash = pick.indexOf('#');
    const id = hash < 0 ? pick : pick.slice(0, hash);
    const label = hash < 0 ? null : pick.slice(hash + 1);

    let item: MenuItem | undefined;
    let itemSection: string | undefined;
    for (const section of menuSections) {
      for (const candidate of section.items) {
        if (candidate.id === id && !candidate.isHeader) {
          item = candidate;
          itemSection = section.id;
        }
      }
    }
    if (!item) continue;
    sectionId ??= itemSection ?? null;

    const variants = item.variants ?? [];
    const variant = label !== null && !item.allowMultiSelect ? variants.find((v) => v.label === label) : undefined;
    if (!variant && variants.length > 0) {
      if (!needsChoice.some((m) => m.id === item.id)) needsChoice.push(item);
      continue;
    }
    ready.push({
      id: `${now}-${n++}`,
      name: item.name,
      emoji: item.emoji,
      imageUrl: item.imageUrl ?? '',
      variant: variant?.label ?? '',
      price: variant?.price ?? item.price ?? 0,
      quantity: 1,
    });
  }
  return { ready, needsChoice, sectionId: pickedSection ?? sectionId, sectionPick: pickedSection !== null };
}

/** MenuItem.displayPrice: the cheapest positive variant, else the item price. */
export function displayPrice(item: MenuItem): number {
  const variants = item.variants ?? [];
  if (variants.length > 0) {
    const min = Math.min(...variants.map((v) => v.price));
    if (min > 0) return min;
  }
  return item.price ?? 0;
}

/** The promo tape on a card: its label, or BUY 1 TAKE 1. */
export const promoOf = (item: MenuItem): string | null =>
  item.promoLabel ?? (item.isBuy1Take1 ? 'BUY 1 TAKE 1' : null);
