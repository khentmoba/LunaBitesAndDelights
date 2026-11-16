import { priceOf } from './menu';

export interface StorefrontRow {
  pick: string;
  photo: string;
  name: string;
  price: number;
  promo?: boolean;
}

export interface StorefrontGroup {
  title: string;
  stamp?: string;
  note?: string;
  rows: StorefrontRow[];
}

function row(pick: string, photo: string, name: string, priceId?: string, promo = false): StorefrontRow {
  const hash = pick.indexOf('#');
  const id = priceId ?? (hash < 0 ? pick : pick.slice(0, hash));
  const variant = hash < 0 || priceId ? undefined : pick.slice(hash + 1);
  return {
    pick,
    photo,
    name,
    price: priceOf(id, variant),
    ...(promo ? { promo: true } : {}),
  };
}

export const storefrontMenuColumns: StorefrontGroup[][] = [
  [
    {
      title: 'Shawarma favorites',
      rows: [
        row('s1#Solo', 'images/poster_shawarma_wrap.webp', 'Shawarma Wrap'),
        row('s2', 'images/shawarma_all_meat.webp', 'Shawarma All Meat'),
        row('s6', 'images/poster_shawarma_nachos.webp', 'Shawarma Nachos'),
        row('s7', 'images/poster_shawarma_quesadilla.webp', 'Shawarma Quesadilla'),
        row('s5', 'images/poster_shawarma_fries.webp', 'Shawarma Fries'),
        row('s1#Buy 1 Take 1', 'images/poster_shawarma_wrap.webp', 'Wrap, buy 1 take 1', undefined, true),
      ],
    },
    {
      title: 'Combo meals',
      rows: [
        row('c1', 'images/owner_combo_1.webp', 'Combo 1 · burger + fries'),
        row('c2', 'images/owner_combo_2.webp', 'Combo 2 · shawarma wrap + fries'),
        row('sc1', 'images/owner_super_combo_1.webp', 'Super Combo 1 · burger + fries + drink'),
        row('sc2', 'images/owner_super_combo_2.webp', 'Super Combo 2 · wrap + fries + drink'),
        row('c3', 'images/owner_combo_3.webp', 'Combo 3 · 2 burgers + regular fries + 2 drinks', undefined, true),
        row('c4_wrap_burger', 'images/owner_combo_4.webp', 'Combo 4 · wrap + burger + fries'),
        row('s10', 'images/owner_combo_6.webp', 'Combo 6 · wrap + shawarma burger + drink'),
        row('c4', 'images/combo_promo_halo_fries_wrap.webp', 'Combo Promo · halo-halo + fries + wrap'),
        row('e1', 'images/quesadilla_extra.webp', 'Quesadilla'),
      ],
    },
  ],
  [
    {
      title: 'French fries',
      rows: [
        row('fd1', 'images/owner_d1.webp', 'D1 · fries + drink'),
        row('fd2', 'images/owner_d2.webp', 'D2 · fries + hotdog + drink'),
        row('fd3', 'images/owner_d3.webp', 'D3 · fries + hotdog + cheesestick + drink'),
        row('fd4', 'images/owner_d4.webp', 'D4 · fries + hotdog + cheesestick + fried siomai + drink'),
        row('f4', 'images/poster_fries_b1t1.webp', 'Fries, buy 1 take 1'),
        row('f3', 'images/poster_fries_large.webp', 'Large Fries'),
        row('f5', 'images/poster_fries_bucket.webp', 'Bucket Fries'),
        row('f2', 'images/poster_fries_terra.webp', 'Terra Fries · 3 flavors'),
        row('s8#Buddy (1–2 pax)', 'images/poster_overload.webp', 'Fries & Nachos Overload · Buddy, 1–2 pax'),
        row('s8#Barkada (3–5 pax)', 'images/poster_overload.webp', 'Fries & Nachos Overload · Barkada, 3–5 pax'),
      ],
    },
  ],
  [
    {
      title: 'Burger favorites',
      stamp: 'B1T1',
      note: 'All burgers below are buy 1 take 1.',
      rows: [
        row('b1', 'images/poster_burger_patty.webp', 'Burger Patty'),
        row('b2', 'images/ham_cheese.webp', 'Ham & Cheese'),
        row('b3', 'images/poster_cheese_burger.webp', 'Cheese Burger'),
        row('b4', 'images/burger_with_egg.webp', 'Burger with Egg'),
        row('b5', 'images/poster_cheese_egg_burger.webp', 'Cheese & Egg Burger'),
        row('s4', 'images/poster_shawarma_burger.webp', 'Shawarma Burger'),
      ],
    },
    {
      title: 'Sweet · cold',
      rows: [
        row('c_3for100', 'images/coolers_3_for_100.webp', 'Coolers, any three'),
        row('@drinks', 'images/three_large_coolers.webp', 'Coolers, solo · 8 flavors', 'c_taro'),
        row('e5', 'images/owner_ube_halo.webp', 'Ube Halo Ice Cream'),
        row('e3', 'images/owner_mango_graham.webp', 'Mango Graham Ice Cream'),
        row('e6', 'images/owner_choco_oreo.webp', 'Choco Oreo Ice Cream'),
        row('e7', 'images/owner_vanilla_cheese.webp', 'Vanilla Cheese Ice Cream'),
        row('e4', 'images/owner_leche_flan.webp', 'Luna Leche Flan'),
        row('mc1', 'images/milo_dinosaur.webp', 'Milo Dinosaur'),
        row('mc2', 'images/milo_float.webp', 'Milo Float'),
        row('mc3', 'images/milo_crunch.webp', 'Milo Crunch'),
        row('mc4', 'images/milo_oreo.webp', 'Milo Oreo'),
        row('oc1', 'images/oreo_cookies_cream.webp', 'Cookies & Cream Overload'),
        row('oc2', 'images/oreo_chocolate.webp', 'Chocolate Oreo'),
        row('oc3', 'images/oreo_strawberry.webp', 'Strawberry Oreo'),
        row('oc4', 'images/oreo_milo_float.webp', 'Milo Oreo Float'),
        row('cf_coke', 'images/coke_float.webp', 'Coke Float'),
        row('cf_chuckie', 'images/chuckie_float.webp', 'Chuckie Float'),
        row('cf_cnc', 'images/cookies_cream_float.webp', 'Cookies and Cream Float'),
        row('cf_latte', 'images/cafe_latte.webp', 'Cafe Latte'),
        row('cf_macchiato', 'images/caramel_macchiato.webp', 'Caramel Macchiato'),
        row('cf_cappuccino', 'images/ice_cappuccino.webp', 'Ice Cappuccino'),
        row('cf_choc_coffee', 'images/chocolate_coffee.webp', 'Chocolate Coffee'),
        row('ls1', 'images/lemon_classic.webp', 'Classic Lemonade'),
        row('ls5', 'images/blue_lemonade.webp', 'Blue Lemonade'),
        row('ls3', 'images/lemon_strawberry.webp', 'Lemon Strawberry'),
        row('ls4', 'images/lemon_cucumber.webp', 'Lemon Cucumber'),
      ],
    },
  ],
];
