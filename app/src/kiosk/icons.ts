// Material Icons codepoints, as Flutter's Icons class names them. The glyphs
// come from app/public/kiosk/fonts/material-icons.woff2.
export const icons = {
  add: 0xe047,
  add_circle_outline: 0xe050,
  add_location_alt_outlined: 0xee44,
  add_rounded: 0xf537,
  arrow_back: 0xe092,
  check: 0xe156,
  check_circle: 0xe159,
  check_circle_outline_rounded: 0xf634,
  check_rounded: 0xf636,
  chevron_right: 0xe15f,
  clear: 0xe168,
  close: 0xe16a,
  delete_outline_rounded: 0xf696,
  dinner_dining_outlined: 0xefbf,
  edit_location_alt: 0xe21d,
  error_outline_rounded: 0xf712,
  fastfood_outlined: 0xf049,
  local_drink_outlined: 0xf179,
  location_on: 0xe3ab,
  location_on_outlined: 0xf193,
  lock_rounded: 0xf889,
  lunch_dining_outlined: 0xf1a8,
  map_outlined: 0xf1ae,
  more_vert: 0xe404,
  motorcycle_rounded: 0xf8e2,
  my_location: 0xe418,
  nightlight_round: 0xe42f,
  open_in_new_rounded: 0xf0034,
  outdoor_grill_rounded: 0xf003a,
  payment_rounded: 0xf0057,
  payments_rounded: 0xf0058,
  person_rounded: 0xf0071,
  phone_android_rounded: 0xf0078,
  phone_rounded: 0xf0083,
  point_of_sale_rounded: 0xf00ad,
  remove: 0xe516,
  remove_rounded: 0xf00f1,
  restaurant_menu: 0xe533,
  restaurant_outlined: 0xf316,
  rice_bowl_outlined: 0xf31b,
  search: 0xe567,
  shopping_bag_outlined: 0xf37d,
  shopping_cart_outlined: 0xf37f,
  storefront_rounded: 0xf01e1,
  warning_amber_rounded: 0xf02a0,
} as const;

export type IconName = keyof typeof icons;

export const glyph = (name: IconName): string => String.fromCodePoint(icons[name]);

/** MenuTheme.categoryIcon */
export function categoryIcon(sectionId: string): IconName {
  switch (sectionId) {
    case 'sulit_meals': return 'rice_bowl_outlined';
    case 'chicken_poppers': return 'restaurant_outlined';
    case 'shawarma': return 'lunch_dining_outlined';
    case 'fries': return 'fastfood_outlined';
    case 'combos': return 'dinner_dining_outlined';
    case 'extras': return 'add_circle_outline';
    case 'drinks': return 'local_drink_outlined';
    case 'burger_hotdog_combined': return 'lunch_dining_outlined';
    default: return 'restaurant_menu';
  }
}
