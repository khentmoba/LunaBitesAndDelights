# Analyzer baseline: 87 → 0

## What was wrong

`tool/analyzer_baseline.txt` held `87`, but the analyzer was actually reporting
26 issues. The baseline was stale and 61 issues too generous, so CI would have
accepted 61 new infos or warnings without complaint.

## What changed

| Rule | Count | Fix |
| --- | --- | --- |
| `deprecated_member_use` (`withOpacity`) | 7 | `withValues(alpha: …)` |
| `deprecated_member_use` (App Check providers) | 5 | `providerAndroid` / `providerApple` / `providerWeb` |
| `deprecated_member_use` (`dart:js`, `desiredAccuracy`) | 2 | `dart:js_interop` split; `locationSettings:` |
| `avoid_web_libraries_in_flutter` | 1 | web code moved to `location_web.dart` |
| `use_build_context_synchronously` | 4 | dropped the unused `context` param; `mounted` now guards `State.context` |
| `avoid_print` | 10 | `stdout.writeln` / `stderr.writeln` in the CLI tool |
| `subtype_of_sealed_class` | 2 | documented `// ignore:` (see below) |
| `must_be_immutable` | 1 | `late final payload` |
| `unintended_html_in_doc_comment` | 1 | backticked the `<key>` placeholder |
| `curly_braces_in_flow_control_structures` | 3 | braces |

The seven `withOpacity` rewrites were applied by the Dart language tool's
quick-fix, not by hand. They are the documented replacement and change no
behaviour, but they are in the diff, so they are listed here.

## The two suppressions

`test/order_service_test.dart` fakes `CollectionReference` and
`DocumentReference`, which Firestore 6 sealed. A hand-rolled fake cannot satisfy
a sealed interface. The alternatives were a mocking package plus codegen for one
regression test, or two narrow `// ignore:` lines with the reason written down.
The second was taken; the comment sits above the declarations.

## Proof

```text
$ flutter analyze
No issues found! (ran in 1.8s)

$ node tool/check_analyzer_baseline.mjs analyze.txt
Analyzer issues: 0 (baseline 0).
```

`tool/analyzer_baseline.txt` now reads `0`, so any new info or warning fails CI.

## Not verified locally

The `rules` job needs Java 21 for the Firestore emulator; this machine has Java
8, so `npm run test:rules` exits with `firebase-tools no longer supports Java
version before 21`. CI runs it on Java 21. This change touches no rules files.
