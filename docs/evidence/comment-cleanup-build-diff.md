## Built site: origin/main vs this branch

Both built with `astro build` (17 pages). `diff -r build/app` over every file:

```diff
diff -r build/app/kiosk/index.html build/app/kiosk/index.html
14c14
<   // Storefront picks (?pick=...) ride along to the menu, as Flutter reads them after the splash.
---
>   // Storefront picks (?pick=...) ride along to the menu after the splash.
```

Files compared: 223. The only change is a comment inside an `is:inline` script, which Astro emits verbatim. Every CSS, JS and HTML file the browser runs is otherwise byte-identical, so the comment rewrites in app/src change nothing users see.
