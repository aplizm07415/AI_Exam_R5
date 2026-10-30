# Integration validation — 2026-10-30

## Git history

- 115 unique source commits retained; none pruned.
- Five source branches retained under `history/`.
- Original author and committer timestamps checked against the source objects for every source commit.
- All source-parent relationships checked using the composed original-to-sanitized commit mapping.
- Every imported source commit is reachable from the R3 and R4 histories connected by the integration commit.

## Secret and privacy checks

- Gitleaks v8.30.1: all imported branch histories scanned with full history and inline allow-comments ignored; no remaining findings in the sanitized history.
- Independent object audit: no occurrences of the previously detected credential values, recognized credential formats, unexpected private email addresses, literal credential candidates, or excluded file paths.
- Historical PNG EXIF/text metadata stripped without re-encoding the image pixels.
- Scanner reports containing original sensitive values remain outside this repository and are not committed or pushed.

Automated scanning has limits; a zero-finding result is not a guarantee that every possible secret encoding or privacy issue has been identified. No detected credential was tested against its live provider.

## Current R4 verification

Executed from `versions/r4/exam-app-template/` after the history cleanup and folder integration:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run audit:data
```

- Existing automated tests: **112 passed, 0 failed, 0 skipped**.
- Structural data audit completed: 2,474 questions checked, 2,452 available for practice, 22 quarantined.
- Empty explanations, missing correct-option IDs, duplicated option text, replacement characters, malformed quality metadata, and quarantined-question inclusion: 0 in the reported checks.
- Follow-up indicators remain, including 2,449 questions without structured source/check-date fields, 46 items requiring figure/condition review, and 7 explanations requiring review of assumed conditions. These are recorded limits, not claims that all questions have been expertly verified.

Tests use the existing Node/API and browser-event harnesses and mocked SQL boundaries. No production database, real-browser visual session, or mobile hardware session was used in this integration validation. Historical R1/R2/R3 builds and their cloud deployments were not revalidated.
