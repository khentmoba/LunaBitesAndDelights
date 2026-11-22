# Agent Guidelines — Luna Bites & Delights

## Reference Map

- [PRODUCT.md](PRODUCT.md) — Stack (`app/` Astro + TypeScript, `functions/` Cloud Functions v2), menu & price rules, operating context, and brand commitments.
- [DESIGN.md](DESIGN.md) — Visual tokens, typography, and component specs ("Pink Order Pad").
- [CODING_STANDARDS.md](CODING_STANDARDS.md) — Review-time invariants: lease/retry semantics, server-authoritative pricing, secret binding, CSP parity, and frontend lifecycle hygiene.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Directory map, coupled cross-stack files, storefront inline-asset contract, and script locations.
- [docs/DEPLOYMENT_STATE.md](docs/DEPLOYMENT_STATE.md) — Provisioned Secret Manager keys, App Check enforcement status, and `firestore.rules` drift constraints.

## Business Reference

- **Business:** Luna Bites & Delights — food & drink kiosk (good food, sweet drinks, moonlit vibes).
- **Facebook Page:** https://www.facebook.com/profile.php?id=100090686762896
  (canonical: https://www.facebook.com/p/Luna-Bites-Delights-100090686762896/)
  Use this page as the source of truth for brand copy, the intro/blurb, contact details, and
  promotional posts. Copy and photos posted there are what the landing page should showcase.
- **Location:** Purok 5, Poblacion Magallanes, Agusan Del Norte (near 7/11), Philippines.

## UI Work

- **Always use the `$impeccable` skill for UI work**, including design, implementation, review, and changes to layout, styling, copy, motion, accessibility, or responsive behavior in the storefront, kiosk or staff pages (`app/`). Read its `SKILL.md` from the available skill catalog before starting.
- Follow the applicable Impeccable workflow and the existing `PRODUCT.md`, `DESIGN.md`, and surface brief. Verify UI changes in the rendered app at the screen sizes they support before handing them off.

## Proof & Evidence Requirements (MANDATORY)

- **Always capture and commit concrete proof / evidence before handing off work or opening a PR.** Never rely on claims alone.
- **For UI / Visual changes:** Capture real rendered screenshots at supported viewports (e.g. mobile 320px/390px, tablet 768px, desktop 1440px). Publish them with `node tool/publish_evidence.mjs <files>`: it pushes them to the `evidence` branch, never main, prints the `![alt](url)` lines to embed, and saves them to `.evidence-urls.md`. To compare before/after shots, run `node tool/png_diff.mjs` and open only the crops it writes.
- **For Backend / API / Integration features:** Produce tangible evidence of end-to-end functionality (e.g. test payloads, actual API output artifacts, verified live responses, or simulated message captures) and document the validation in `docs/evidence/<feature-name>.md`.
- **Embed visual proof in PR descriptions:** Every PR must embed visual proof and screenshots directly into the Evidence section using inline images (`![alt](url)` or `raw=true` URLs), not just text links, so reviewers see the proof immediately without clicking away. Validate locally with `node tool/check_pr_proof.mjs`.

## Branching & Deployment Rules

1. **Never push directly to `main`.**
   - Direct pushes to `main` trigger the automated production deploy workflow (`.github/workflows/firebase-hosting-merge.yml`).
   - Do NOT run manual production deployments (`firebase deploy`) without explicit user instruction.
   - Branch protection on `main` requires the `site`, `functions`, and `rules` checks.

2. **Always create a Pull Request (PR).**
   - Create a feature or fix branch (e.g., `fix/descriptive-name` or `feature/descriptive-name`).
   - Follow `$file-pr`: open a PR against `main` using `pull_request_create` when PR MCP tools are available, or `gh pr create` otherwise.
   - Let the user review and merge the PR when ready, unless the user says "full send". Then `$full-send` grants the merge once the gate passes.

3. **Verify locally before opening a PR:**
   - Run `npm run ci`. It auto-bootstraps missing dependencies, skips redundant `npm ci` runs when lockfiles match, executes every step of `.github/workflows/pr-checks.yml`, and writes `docs/evidence/ci-local.txt` on full runs (use `npm run ci -- --job=site` or `--no-evidence` during iterative dev to keep `docs/evidence/ci-local.txt` clean). Commit `docs/evidence/ci-local.txt` before opening the PR.
   - Firestore rules: `firestore.rules` must match production (`.github/workflows/rules-drift.yml`). `cd functions && npm run check:rules-drift` checks it when GCP credentials are set locally; do not edit or deploy `firestore.rules` without explicit user instruction (see `docs/DEPLOYMENT_STATE.md`).
