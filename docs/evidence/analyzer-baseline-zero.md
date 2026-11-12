# Analyzer baseline: 87 → 0

## What was wrong

`tool/analyzer_baseline.txt` held `87`, and the analyzer reported exactly 87.
The baseline was accurate, but it left no slack: CI would accept any count up to
87, so a change could add issues while removing others and still pass.

This change clears all 87 and sets the baseline to `0`, so any new info or
warning fails CI.

## What changed

| Rule | Count | Fix |
| --- | --- | --- |
| `deprecated_member_use` — `withOpacity` | 54 | `withValues(alpha: …)` |
| `deprecated_member_use` — App Check providers | 5 | `providerAndroid` / `providerApple` / `providerWeb` |
| `deprecated_member_use` — `dart:js`, `desiredAccuracy` | 2 | `dart:js_interop` split; `locationSettings:` |
| `avoid_print` | 10 | `stdout.writeln` / `stderr.writeln` in the CLI tool |
| `use_build_context_synchronously` | 4 | dropped the unused `context` param; `mounted` now guards `State.context` |
| `unnecessary_brace_in_string_interps` | 3 | removed braces |
| `curly_braces_in_flow_control_structures` | 3 | braces |
| `subtype_of_sealed_class` | 2 | documented `// ignore:` (see below) |
| `unnecessary_underscores` | 1 | `(_, __)` → `(_, _)` |
| `unintended_html_in_doc_comment` | 1 | backticked the `<key>` placeholder |
| `must_be_immutable` | 1 | `late final payload` |
| `avoid_web_libraries_in_flutter` | 1 | web code moved to `location_web.dart` |

61 of the 87 were auto-fixable and were applied by the Dart tool's quick-fix
(`withOpacity`, the brace and string-interp rules, and the underscore rule),
not by hand. They are behavior-identical, but they are in the diff, so they are
listed here.

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

`tool/analyzer_baseline.txt` now reads `0`.

## Not verified locally

The `rules` job needs Java 21 for the Firestore emulator; this machine has Java
8, so `npm run test:rules` exits with `firebase-tools no longer supports Java
version before 21`. CI runs it on Java 21 and passes. This change touches no
rules files.
