# Agent Guidelines — Luna Bites & Delights

## Business Reference

- **Business:** Luna Bites & Delights — food & drink kiosk (good food, sweet drinks, moonlit vibes).
- **Facebook Page:** https://www.facebook.com/profile.php?id=100090686762896
  (canonical: https://www.facebook.com/p/Luna-Bites-Delights-100090686762896/)
  Use this page as the source of truth for brand copy, the intro/blurb, contact details, and
  promotional posts. Copy and photos posted there are what the landing page should showcase.
- **Location:** Purok 5, Poblacion Magallanes, Agusan Del Norte (near 7/11), Philippines.

## Subagents & Delegation

- **Do not use subagents or delegate work unless the user explicitly asks you to.** Complete implementation, research, testing, reviews, and documentation yourself by default.
- Invoking a skill, including `$impeccable`, does **not** authorize subagents. If a skill calls for delegated work, perform that step yourself unless the user explicitly authorizes delegation.

## UI Work

- **Always use the `$impeccable` skill for UI work**, including design, implementation, review, and changes to layout, styling, copy, motion, accessibility, or responsive behavior in the storefront or Flutter app. Read its `SKILL.md` from the available skill catalog before starting.
- Follow the applicable Impeccable workflow and the existing `PRODUCT.md`, `DESIGN.md`, and surface brief. Verify UI changes in the rendered app at the screen sizes they support before handing them off.

## Proof & Evidence Requirements (MANDATORY)

- **Always capture and commit concrete proof / evidence before handing off work or opening a PR.** Never rely on claims alone.
- **For UI / Visual changes:** Capture real rendered screenshots at supported viewports (e.g. mobile 320px/390px, tablet 768px, desktop 1440px) and save them to `docs/evidence/`.
- **For Backend / API / Integration features:** Produce tangible evidence of end-to-end functionality (e.g. test payloads, actual API output artifacts, verified live responses, or simulated message captures) and document the validation in `docs/evidence/<feature-name>.md`.
- **Embed visual proof in PR descriptions:** Every PR must embed visual proof and screenshots directly into the Evidence section using inline images (`![alt](url)` or `raw=true` URLs), not just text links, so reviewers see the proof immediately without clicking away.
- **Not enforced by CI:** the `proof` job was removed. Reviewers still check evidence; `tool/check_pr_proof.mjs` remains available for a local check.

## Branching & Deployment Rules

1. **Never push directly to `main`.**
   - Direct pushes to `main` trigger the automated production deploy workflow (`.github/workflows/firebase-hosting-merge.yml`).
   - Do NOT run manual production deployments (`firebase deploy`) without explicit user instruction.
   - Branch protection on `main` requires the `flutter`, `functions`, and `rules` checks.

2. **Always create a Pull Request (PR).**
   - Always use the `$file-pr` skill when making PRs.
   - Create a feature or fix branch (e.g., `fix/descriptive-name` or `feature/descriptive-name`).
   - Push to that branch and open a PR against `main` using `gh pr create`.
   - Let the user review and merge the PR when ready, unless the user says "full send". Then `$full-send` grants the merge once the gate passes.

3. **Verify locally before opening a PR:**
   - Run every job in `.github/workflows/pr-checks.yml` locally, and save the output to `docs/evidence/`.
   - Firestore rules: `firestore.rules` must match production. `cd functions && npm run check:rules-drift` checks it (read-only). Do not deploy rules without explicit user instruction.
   - Capture concrete proof artifacts in `docs/evidence/` and embed visual proof (`![alt](url)`) directly in the PR body.
