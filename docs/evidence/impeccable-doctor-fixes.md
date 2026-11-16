# Impeccable Doctor Fixes Evidence

## 1. Initial `impeccable doctor --json` finding

```json
{
  "id": "surface-brief-orphaned",
  "artifact": "surface brief",
  "path": ".impeccable\\surfaces\\lib-screens-menu-page-dart.md",
  "severity": "mention",
  "summary": "1 persisted surface brief(s) name a primary target that no longer exists: .impeccable\\surfaces\\lib-screens-menu-page-dart.md → lib/screens/menu_page.dart.",
  "fix": "Ask whether the surface moved (repoint the brief) or was removed (delete the brief). Until then the brief is authority for a file that is gone."
}
```

## 2. Resolution

- Repointed `.impeccable/surfaces/lib-screens-menu-page-dart.md` `primary_target` from `lib/screens/menu_page.dart` to `app/src/pages/kiosk/menu.astro`.
- Updated `related_targets` to existing Astro kiosk files (`app/src/layouts/Kiosk.astro`, `app/src/kiosk/tokens.css`, `app/src/pages/kiosk/cart.astro`, `app/src/pages/kiosk/checkout.astro`, `app/src/pages/kiosk/index.astro`, `app/src/pages/kiosk/receipt.astro`, `app/src/data/menu.ts`).
- Updated the `## Scope` description from Flutter to Astro.

## 3. Verification

### `impeccable doctor --json` (after fix)

```json
{
  "projectRoot": "C:\\Users\\Admin\\.t3\\worktrees\\LunaBites and Delights\\t3-3d96374f-4a308b2d4381f47a",
  "repoRoot": "C:\\Users\\Admin\\.t3\\worktrees\\LunaBites and Delights\\t3-3d96374f-4a308b2d4381f47a",
  "isMonorepo": false,
  "productPath": "PRODUCT.md",
  "designPath": "DESIGN.md",
  "platform": "adaptive",
  "ruleRegistryAvailable": true,
  "findings": [],
  "workspaces": []
}
```

### Local Site Checks

- `app`: `npm run check` (`astro check`): 0 errors, 0 warnings, 0 hints (53 files).
- `app`: `npm run build` (`astro build`): 17 pages built cleanly.
- root: `npm run test:site`: 52/52 tests passed.
