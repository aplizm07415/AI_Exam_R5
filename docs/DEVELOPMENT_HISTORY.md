# Development history

This chronology is based on the imported Git commits and project documents. It describes development periods, not continuous work, billed hours, or production usage.

| Period | Version | Evidence of development |
| --- | --- | --- |
| December 2025 | R1 | Base quiz application; frontend/backend fixes; repeated work on reload behavior, UI, and results charts |
| December 2025 | R2 main | Local and Azure storage support; question selection; history displays; unanswered-question mode; portal and count improvements |
| December 2025–July 2026 | R3 branch in the R2 repository | Study scheduling, spaced repetition, notes, cloud progress, handwriting and iPad/offline work, secondary-exam practice, AI-assisted study features, and commuting/paper-practice modes |
| August–September 2026 | R4 | Study plans and staged targets; explanations; archive and assessment changes; mobile layouts; data quality review; the explicit “I don't know” answer action |
| October 2026 | Review integration | Sanitized copies of the histories and version snapshots, assembled for private review |

R1 and R2 share Git ancestry. The R3 branch continues the history inside the R2 repository. R4 has its own Git root; its documents record reuse of study data from the earlier Azure-backed application. It is not presented as an uninterrupted R1→R4 Git branch.

## Original history branches

The following sanitized branches preserve their respective source histories:

- `history/r1/main`
- `history/r1/feature/new-ui`
- `history/r2/main`
- `history/r2/R3`
- `history/r4/main`

The original repositories are untouched. Author and committer timestamps and parent relationships are preserved in the sanitized copies. Personal author contact details are normalized to the owner's GitHub noreply identity. Original messages are retained except for privacy and credential replacements.

Browse the complete graph with:

```sh
git log --all --graph --date=short --format='%h %ad %s'
git log history/r2/R3
git log history/r4/main
```

The imported historical commits use their original repository-relative paths. The `versions/` folder layout is introduced by the integration commit; filtering `git log` only by a new `versions/` path will not show all of the earlier source history.

## Claude Code usage

The project owner confirms that Claude Code was used throughout these projects and will continue to be used for future improvements and other projects. Historical files also mention Gemini and Codex. These records are retained rather than rewritten to suggest exclusive use of any one assistant. Git commits alone do not establish which assistant was used for every action.
