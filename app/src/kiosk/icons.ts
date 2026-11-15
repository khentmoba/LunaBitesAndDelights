// Material Icons codepoints, as Flutter's Icons class names them. The glyphs
// come from app/public/kiosk/fonts/material-icons.woff2.
export const icons = {
  access_time_rounded: 0xf51a,
  add: 0xe047,
  add_circle_outline: 0xe050,
  add_location_alt_outlined: 0xee44,
  add_rounded: 0xf537,
  analytics_rounded: 0xf561,
  arrow_back: 0xe092,
  arrow_forward_ios_rounded: 0xf579,
  arrow_forward_rounded: 0xf57a,
  backspace_outlined: 0xeeb5,
  badge_rounded: 0xf5a5,
  bar_chart_outlined: 0xeebc,
  bar_chart_rounded: 0xf5a9,
  check: 0xe156,
  check_box_outline_blank_outlined: 0xef45,
  check_box_outlined: 0xef46,
  check_circle: 0xe159,
  check_circle_outline_rounded: 0xf634,
  check_circle_rounded: 0xf635,
  check_rounded: 0xf636,
  chevron_right: 0xe15f,
  clear: 0xe168,
  clear_rounded: 0xf645,
  close: 0xe16a,
  copy_rounded: 0xf66c,
  dashboard_rounded: 0xf68e,
  delete_outline_rounded: 0xf696,
  delivery_dining_outlined: 0xefac,
  dinner_dining_outlined: 0xefbf,
  done_all_rounded: 0xf6d2,
  edit_location_alt: 0xe21d,
  error_outline_rounded: 0xf712,
  fastfood_outlined: 0xf049,
  history_rounded: 0xf7ef,
  hourglass_empty_outlined: 0xf111,
  hourglass_empty_rounded: 0xf7fe,
  hourglass_top_outlined: 0xf113,
  hourglass_top_rounded: 0xf800,
  leaderboard_rounded: 0xf848,
  local_drink_outlined: 0xf179,
  location_on: 0xe3ab,
  location_on_outlined: 0xf193,
  lock_outline_rounded: 0xf888,
  lock_rounded: 0xf889,
  logout_rounded: 0xf88b,
  lunch_dining_outlined: 0xf1a8,
  map_outlined: 0xf1ae,
  menu_book_rounded: 0xf8b4,
  monetization_on_rounded: 0xf8cf,
  more_vert: 0xe404,
  motorcycle_outlined: 0xf1f0,
  motorcycle_rounded: 0xf8e2,
  my_location: 0xe418,
  nightlight_round: 0xe42f,
  open_in_new_rounded: 0xf0034,
  outdoor_grill_outlined: 0xf248,
  outdoor_grill_rounded: 0xf003a,
  payment_rounded: 0xf0057,
  payments_rounded: 0xf0058,
  person_outline_rounded: 0xf006c,
  person_rounded: 0xf0071,
  phone_android_rounded: 0xf0078,
  phone_outlined: 0xf290,
  phone_rounded: 0xf0083,
  pin_rounded: 0xf009c,
  place_outlined: 0xf2ac,
  point_of_sale_outlined: 0xf2bb,
  point_of_sale_rounded: 0xf00ad,
  print_rounded: 0xf00c0,
  receipt_long_outlined: 0xf2ef,
  receipt_long_rounded: 0xf00e1,
  refresh_rounded: 0xf00e9,
  remove: 0xe516,
  remove_rounded: 0xf00f1,
  restaurant_menu: 0xe533,
  restaurant_outlined: 0xf316,
  rice_bowl_outlined: 0xf31b,
  search: 0xe567,
  search_rounded: 0xf013d,
  shopping_bag_outlined: 0xf37d,
  shopping_bag_rounded: 0xf016f,
  shopping_cart_outlined: 0xf37f,
  square: 0xf0570,
  storefront_outlined: 0xf3ef,
  storefront_rounded: 0xf01e1,
  sync_rounded: 0xf0207,
  task_alt_rounded: 0xf021a,
  telegram_rounded: 0xf0399,
  trending_up_rounded: 0xf0254,
  tv_rounded: 0xf025d,
  verified_user_rounded: 0xf026f,
  visibility_off_rounded: 0xf0292,
  visibility_rounded: 0xf0293,
  volume_off_rounded: 0xf0299,
  volume_up_rounded: 0xf029a,
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
